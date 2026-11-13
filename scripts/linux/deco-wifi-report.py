#!/usr/bin/env python3
# =============================================================
# deco-wifi-report.py — Dispositivos conectados a un TP-Link Deco
#
# Lee la lista de clientes del Deco principal por su API local (la misma que
# usa la app, vía la librería tplinkrouterc6u) y la manda al portal
# (ingest-wifi-clients). Aparece en Telemetría → Wi-Fi, igual que los MikroTik.
#
# Corre en cualquier equipo de la red del cliente que llegue al Deco
# (un Linux, una Raspberry, o un Windows con Python).
#
# INSTALAR:
#   pip install tplinkrouterc6u requests
#   (Debian/Ubuntu: python3 -m venv /srv/deco && /srv/deco/bin/pip install tplinkrouterc6u requests)
#
# CONFIG: deco-report.env al lado del script (o ruta como primer argumento):
#   DECO_HOST="http://192.168.68.1"     # IP del Deco principal
#   DECO_PASSWORD="..."                 # contraseña de administración del Deco (la de la app)
#   SUPABASE_URL="https://PROYECTO.supabase.co"
#   SUPABASE_ANON_KEY="..."
#   SERVICE_ID="uuid del servicio del Deco en el portal"
#   INGEST_SECRET="ingest secret de ese servicio"
#   DECO_INCLUDE_WIRED="true"           # también los equipos por cable (default true)
#
# CRON (crontab -e) — una vez por día alcanza; semanal también funciona:
#   15 10 * * *  /srv/deco/bin/python /srv/scripts/deco-wifi-report.py >> /srv/scripts/logs/deco.log 2>&1
#   15 10 * * 1  ...   (solo los lunes)
#
# Uso:
#   ./deco-wifi-report.py              # envía
#   ./deco-wifi-report.py --dry-run    # muestra lo que mandaría, sin enviar
# =============================================================

import json
import os
import sys
from datetime import datetime
from pathlib import Path

SCRIPT_VERSION = "1.0.0"


def log(msg: str) -> None:
    print(f"{datetime.now():%Y-%m-%d %H:%M:%S} {msg}", flush=True)


def load_env(path: Path) -> dict:
    env = {}
    if not path.exists():
        return env
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.strip()
        # quitar comentario al final y comillas
        if value[:1] in "\"'":
            q = value[0]
            end = value.find(q, 1)
            value = value[1:end] if end > 0 else value[1:]
        else:
            value = value.split(" #", 1)[0].strip()
        env[key.strip()] = value
    return env


# Banda / red según el tipo de conexión que informa el Deco
BAND = {
    "host_2g": ("Principal", "2.4 GHz"), "host_5g": ("Principal", "5 GHz"),
    "host_5g_2": ("Principal", "5 GHz (2)"), "host_6g": ("Principal", "6 GHz"),
    "host_mlo": ("Principal", "MLO"),
    "guest_2g": ("Invitados", "2.4 GHz"), "guest_5g": ("Invitados", "5 GHz"),
    "guest_5g_2": ("Invitados", "5 GHz (2)"), "guest_6g": ("Invitados", "6 GHz"),
    "iot_2g": ("IoT", "2.4 GHz"), "iot_5g": ("IoT", "5 GHz"), "iot_6g": ("IoT", "6 GHz"),
    "wired": ("Cableado", "cable"),
}


def device_to_client(dev) -> dict | None:
    """Device de tplinkrouterc6u → formato de ingest-wifi-clients"""
    conn = getattr(getattr(dev, "type", None), "value", "unknown")
    net, band = BAND.get(conn, ("Desconocida", conn))
    mac = str(getattr(dev, "macaddr", "") or "").upper().replace("-", ":")
    if not mac or mac == "00:00:00:00:00:00":
        return None
    ip = str(getattr(dev, "ipaddr", "") or "")
    return {
        "mac": mac,
        "ip": None if ip in ("", "0.0.0.0") else ip,
        "hostname": (getattr(dev, "hostname", "") or "").strip() or None,
        "ssid": net,
        "interface": band,
        "signal": getattr(dev, "signal", None),
        "tx_rate": None,
        "rx_rate": None,
        "uptime": None,
        "_wired": conn == "wired",
    }


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry_run = "--dry-run" in sys.argv
    env_path = Path(args[0]) if args else Path(__file__).with_name("deco-report.env")
    cfg = {**load_env(env_path), **{k: v for k, v in os.environ.items() if k.startswith(("DECO_", "SUPABASE_", "SERVICE_ID", "INGEST_SECRET"))}}

    required = ["DECO_HOST", "DECO_PASSWORD", "SUPABASE_URL", "SUPABASE_ANON_KEY", "SERVICE_ID", "INGEST_SECRET"]
    missing = [k for k in required if not cfg.get(k)]
    if missing and not dry_run:
        log(f"ERROR: faltan variables en {env_path}: {', '.join(missing)}")
        return 1

    try:
        from tplinkrouterc6u import TPLinkDecoClient
    except ImportError:
        log("ERROR: falta la librería. Instalar con: pip install tplinkrouterc6u requests")
        return 1

    host = cfg.get("DECO_HOST", "http://192.168.68.1")
    if not host.startswith("http"):
        host = "http://" + host
    include_wired = cfg.get("DECO_INCLUDE_WIRED", "true").lower() != "false"

    log(f"deco-wifi-report.py v{SCRIPT_VERSION} — {host}")
    router = TPLinkDecoClient(host, cfg.get("DECO_PASSWORD", ""), verify_ssl=False)
    try:
        router.authorize()
        status = router.get_status()
    except Exception as e:  # login o firmware no soportado
        log(f"ERROR al leer el Deco: {e}")
        log("Revisá DECO_HOST (IP del Deco principal) y DECO_PASSWORD (contraseña de administración de la app).")
        return 1
    finally:
        try:
            router.logout()
        except Exception:
            pass

    clients = []
    for dev in status.devices or []:
        c = device_to_client(dev)
        if not c or (c["_wired"] and not include_wired):
            continue
        c.pop("_wired")
        clients.append(c)

    wifi = sum(1 for c in clients if c["ssid"] != "Cableado")
    log(f"{len(clients)} dispositivo(s) en línea ({wifi} por Wi-Fi, {len(clients) - wifi} por cable)")

    payload = {"service_id": cfg.get("SERVICE_ID"), "script_version": SCRIPT_VERSION, "flavor": "deco", "clients": clients}
    if dry_run:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
        return 0

    import requests
    url = cfg["SUPABASE_URL"].rstrip("/") + "/functions/v1/ingest-wifi-clients"
    try:
        r = requests.post(url, json=payload, timeout=30, headers={
            "apikey": cfg["SUPABASE_ANON_KEY"],
            "Authorization": f"Bearer {cfg['SUPABASE_ANON_KEY']}",
            "X-Ingest-Secret": cfg["INGEST_SECRET"],
        })
        log(f"Portal HTTP {r.status_code} {r.text[:200]}")
        return 0 if r.ok else 1
    except Exception as e:
        log(f"ERROR al enviar al portal: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
