#!/usr/bin/env python3
"""
ingest-telemetry.py — Lee logs de MikroTik y sube la serie histórica a device_telemetry.

Formato de log esperado (una línea por minuto):
  [2026-08-07T11:11:46.493Z] METRICAS | CPU: 15% | RAM: 40.6% | WAN In: 16.15 Mbps | IPsec: OFFLINE

Configuración en este mismo archivo (sección CONFIG) o via variables de entorno.

Correr cada 5 minutos vía cron:
  */5 * * * * /usr/bin/python3 /srv/scripts/mikrotik/ingest-telemetry.py >> /var/log/mikrotik-ingest.log 2>&1

Montar en docker-compose (si corre desde contenedor):
  volumes:
    - /srv/network-monitor/network-monitor/historial:/data/mikrotik:ro
    - /srv/scripts/mikrotik/state:/data/mikrotik-state
"""

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import urllib.request
import urllib.error

# ============================================================
# CONFIG — ajustar o sobreescribir con variables de entorno
# ============================================================

SUPABASE_URL     = os.getenv("SUPABASE_URL", "https://REEMPLAZAR.supabase.co")
SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")   # service_role, no anon

# Directorio donde están los *.log de cada router
LOG_DIR   = Path(os.getenv("MIKROTIK_LOG_DIR", "/srv/network-monitor/network-monitor/historial"))
STATE_DIR = Path(os.getenv("MIKROTIK_STATE_DIR", "/srv/scripts/mikrotik/state"))

# Mapeo nombre_de_archivo (sin .log) → service_id, leído desde map.env
# Formato del archivo:
#   RegionalSur=uuid-del-service-id
#   RegionalNorte=uuid-del-service-id
#   RegionalSur_kuma=https://...  (ignorado por este script, es para el heartbeat)
_MAP_FILE = Path(os.getenv("MIKROTIK_MAP_FILE", "/etc/mikrotik-map.env"))
_local_map = Path(__file__).parent / "map.env"
if _local_map.exists():
    _MAP_FILE = _local_map

def _load_map(path: Path) -> dict[str, str]:
    result: dict[str, str] = {}
    if not path.exists():
        return result
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key, val = key.strip(), val.strip()
        if not key.endswith("_kuma"):
            result[key] = val
    return result

SERVICE_MAP: dict[str, str] = _load_map(_MAP_FILE)

# Cuántas filas mandar por request (Supabase acepta hasta ~1000)
BATCH_SIZE = 200

# ============================================================

LOG_LINE_RE = re.compile(
    r"\[(?P<ts>[^\]]+)\].*METRICAS"
    r".*CPU:\s*(?P<cpu>[0-9.]+)%"
    r".*RAM:\s*(?P<ram>[0-9.]+)%"
    r".*WAN In:\s*(?P<wan>[0-9.]+)\s*Mbps"
    r".*IPsec:\s*(?P<ipsec>\S+)"
)


def log(msg: str) -> None:
    print(f"{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')} {msg}", flush=True)


def supabase_get(path: str) -> list | dict:
    url = f"{SUPABASE_URL.rstrip('/')}/rest/v1/{path}"
    req = urllib.request.Request(url, headers={
        "apikey": SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())


def supabase_insert(table: str, rows: list[dict]) -> None:
    url = f"{SUPABASE_URL.rstrip('/')}/rest/v1/{table}"
    data = json.dumps(rows).encode()
    req = urllib.request.Request(url, data=data, method="POST", headers={
        "apikey": SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    })
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            if r.status not in (200, 201):
                log(f"ERROR insert HTTP {r.status}")
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        log(f"ERROR insert HTTP {e.code}: {body[:200]}")
        raise


def get_user_id(service_id: str) -> str | None:
    try:
        rows = supabase_get(f"services?select=user_id&id=eq.{service_id}&limit=1")
        return rows[0]["user_id"] if rows else None
    except Exception as e:
        log(f"ERROR obteniendo user_id para {service_id}: {e}")
        return None


def load_state(state_file: Path) -> str:
    try:
        return state_file.read_text().strip()
    except FileNotFoundError:
        return ""


def save_state(state_file: Path, ts: str) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    state_file.write_text(ts)


def process_router(log_file: Path, service_id: str) -> None:
    name = log_file.stem
    state_file = STATE_DIR / f"{name}.last"
    last_ts = load_state(state_file)

    user_id = get_user_id(service_id)
    if not user_id:
        log(f"SKIP {name} — no se encontró user_id para service {service_id}")
        return

    new_rows: list[dict] = []
    latest_ts = last_ts

    try:
        lines = log_file.read_text(errors="replace").splitlines()
    except Exception as e:
        log(f"ERROR leyendo {log_file}: {e}")
        return

    for line in lines:
        m = LOG_LINE_RE.search(line)
        if not m:
            continue
        ts = m.group("ts")
        if ts <= last_ts:
            continue

        cpu  = float(m.group("cpu"))
        ram  = float(m.group("ram"))
        wan  = float(m.group("wan"))
        ipsec_raw = m.group("ipsec").upper()
        ipsec_online = ipsec_raw == "ONLINE"

        new_rows.append({
            "user_id":     user_id,
            "service_id":  service_id,
            "hostname":    name,
            "cpu_pct":     cpu,
            "ram_pct":     ram,
            "wan_in_mbps": wan,
            "bandwidth_in_bps": int(wan * 1_000_000),
            "ipsec_online": ipsec_online,
            "recorded_at": ts,
        })

        if ts > latest_ts:
            latest_ts = ts

    if not new_rows:
        log(f"OK {name} — sin nuevos renglones")
        return

    # Batch insert
    total = len(new_rows)
    for i in range(0, total, BATCH_SIZE):
        batch = new_rows[i:i + BATCH_SIZE]
        supabase_insert("device_telemetry", batch)

    save_state(state_file, latest_ts)
    log(f"OK {name} — {total} filas insertadas (último: {latest_ts})")


def main() -> None:
    if not SERVICE_ROLE_KEY:
        log("ERROR: SUPABASE_SERVICE_KEY no configurado")
        sys.exit(1)

    if not LOG_DIR.is_dir():
        log(f"ERROR: LOG_DIR no encontrado: {LOG_DIR}")
        sys.exit(1)

    if not SERVICE_MAP:
        log(f"ERROR: SERVICE_MAP vacío — crear {_MAP_FILE} con entradas NombreLog=service_uuid")
        sys.exit(1)

    for log_file in sorted(LOG_DIR.glob("*.log")):
        name = log_file.stem
        service_id = SERVICE_MAP.get(name)
        if not service_id:
            log(f"SKIP {name} — sin SERVICE_MAP entry")
            continue
        try:
            process_router(log_file, service_id)
        except Exception as e:
            log(f"ERROR {name}: {e}")


if __name__ == "__main__":
    main()
