#!/usr/bin/env python3
# =============================================================
# unifi-wifi-report.py — Clientes Wi-Fi de una controladora UniFi
#
# Lee los clientes conectados de cada site de la controladora (la del VPS,
# o un UDM / Cloud Gateway) y los manda al portal (ingest-wifi-clients).
# Aparecen en Telemetría → Wi-Fi, igual que MikroTik y Deco.
#
# Solo usa la librería estándar de Python 3 (no hace falta pip).
#
# CONFIG: unifi-report.json al lado del script (o ruta como primer argumento):
# {
#   "controller": "https://localhost:8443",   // controladora del VPS
#   "unifi_os": false,                        // true para UDM / Cloud Gateway / Cloud Key Gen2
#   "username": "reporte",                    // admin local de solo lectura (Settings → Admins)
#   "password": "...",
#   "supabase_url": "https://PROYECTO.supabase.co",
#   "supabase_anon_key": "...",
#   "include_wired": false,
#   "sites": [
#     { "site": "default", "service_id": "uuid", "ingest_secret": "..." },
#     { "site": "abc123de", "service_id": "uuid", "ingest_secret": "..." }
#   ]
# }
# "site" es el id corto del site (está en la URL de la UI: /manage/site/<id>/...).
#
# CRON (crontab -e) — cada hora:
#   20 * * * * /usr/bin/python3 /srv/unifi/unifi-wifi-report.py >> /srv/unifi/logs/report.log 2>&1
#
# Uso:  ./unifi-wifi-report.py [config.json] [--dry-run]
# =============================================================

import http.cookiejar
import json
import ssl
import sys
import urllib.request
from datetime import datetime
from pathlib import Path

SCRIPT_VERSION = "1.0.0"


def log(msg: str) -> None:
    print(f"{datetime.now():%Y-%m-%d %H:%M:%S} {msg}", flush=True)


class UniFi:
    def __init__(self, base: str, unifi_os: bool):
        self.base = base.rstrip("/")
        self.unifi_os = unifi_os
        # La controladora usa certificado autofirmado
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        self.csrf = None
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()),
            urllib.request.HTTPSHandler(context=ctx),
        )

    def _req(self, path: str, body=None):
        headers = {"Content-Type": "application/json"}
        if self.csrf:
            headers["X-CSRF-Token"] = self.csrf
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, headers=headers, method="POST" if data else "GET")
        with self.opener.open(req, timeout=30) as r:
            token = r.headers.get("X-CSRF-Token") or r.headers.get("X-Updated-CSRF-Token")
            if token:
                self.csrf = token
            raw = r.read()
            return json.loads(raw) if raw else {}

    def login(self, user: str, password: str) -> None:
        path = "/api/auth/login" if self.unifi_os else "/api/login"
        self._req(path, {"username": user, "password": password, "remember": False})

    def api(self, site: str, endpoint: str) -> list:
        prefix = "/proxy/network" if self.unifi_os else ""
        return self._req(f"{prefix}/api/s/{site}/{endpoint}").get("data", [])


def to_client(sta: dict, ap_names: dict) -> dict:
    wired = bool(sta.get("is_wired"))
    rate = lambda k: f"{round(sta[k] / 1000)} Mbps" if isinstance(sta.get(k), (int, float)) else None
    up = sta.get("uptime")
    return {
        "mac": (sta.get("mac") or "").upper(),
        "ip": sta.get("ip") or sta.get("last_ip"),
        "hostname": sta.get("hostname"),
        # El nombre puesto en la controladora (alias) va como comentario
        "comment": sta.get("name"),
        "ssid": "Cableado" if wired else sta.get("essid"),
        "interface": ap_names.get((sta.get("ap_mac") or "").lower()) or sta.get("ap_mac") or ("cable" if wired else None),
        "signal": sta.get("signal") if isinstance(sta.get("signal"), int) else None,
        "tx_rate": rate("tx_rate"),
        "rx_rate": rate("rx_rate"),
        "uptime": f"{up // 3600}h{(up % 3600) // 60}m" if isinstance(up, int) else None,
        "_wired": wired,
    }


def post(cfg: dict, site: dict, clients: list) -> str:
    url = cfg["supabase_url"].rstrip("/") + "/functions/v1/ingest-wifi-clients"
    body = json.dumps({"service_id": site["service_id"], "script_version": SCRIPT_VERSION,
                       "flavor": "unifi", "clients": clients}).encode()
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "Content-Type": "application/json",
        "apikey": cfg["supabase_anon_key"],
        "Authorization": f"Bearer {cfg['supabase_anon_key']}",
        "X-Ingest-Secret": site["ingest_secret"],
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return f"HTTP {r.status}"
    except urllib.error.HTTPError as e:
        return f"HTTP {e.code} {e.read()[:200].decode(errors='replace')}"


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry = "--dry-run" in sys.argv
    path = Path(args[0]) if args else Path(__file__).with_name("unifi-report.json")
    try:
        cfg = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        log(f"ERROR leyendo {path}: {e}")
        return 1

    log(f"unifi-wifi-report.py v{SCRIPT_VERSION} — {cfg.get('controller')}")
    ctl = UniFi(cfg["controller"], bool(cfg.get("unifi_os")))
    try:
        ctl.login(cfg["username"], cfg["password"])
    except Exception as e:
        log(f"ERROR de login en la controladora: {e}")
        return 1

    rc = 0
    for site in cfg.get("sites", []):
        name = site.get("site", "default")
        try:
            ap_names = {(d.get("mac") or "").lower(): d.get("name") or d.get("model")
                        for d in ctl.api(name, "stat/device")}
            stas = ctl.api(name, "stat/sta")
        except Exception as e:
            log(f"[{name}] ERROR leyendo el site: {e}")
            rc = 1
            continue
        clients = []
        for s in stas:
            c = to_client(s, ap_names)
            if not c["mac"] or (c["_wired"] and not cfg.get("include_wired")):
                continue
            c.pop("_wired")
            clients.append(c)
        if dry:
            log(f"[{name}] {len(clients)} cliente(s)")
            print(json.dumps(clients, indent=2, ensure_ascii=False))
            continue
        log(f"[{name}] {len(clients)} cliente(s) — {post(cfg, site, clients)}")
    return rc


if __name__ == "__main__":
    sys.exit(main())
