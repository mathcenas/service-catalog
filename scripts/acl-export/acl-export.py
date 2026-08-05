#!/usr/bin/env python3
"""
acl-export.py — Exporta revisiones ACL completadas al sistema de onboarding/offboarding.

Lee revisiones pendientes desde Supabase y escribe un JSON por revisión
en OUTPUT_DIR (carpeta compartida con el contenedor de onboarding).

Solo exporta usuarios con acción "eliminar" o "cambiar".
Lleva un registro local de las revisiones ya exportadas para no duplicar.

Schedulear semanalmente:
  0 6 * * 1 /usr/bin/python3 /srv/acl-export/acl-export.py
"""

import os
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests

# ---------- Config ----------
SUPABASE_URL   = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY   = os.environ["SUPABASE_SERVICE_KEY"]   # service role key
OUTPUT_DIR     = Path(os.environ.get("OUTPUT_DIR", "/data/acl-pending"))
STATE_FILE     = Path(os.environ.get("STATE_FILE", "/data/acl-export-state.json"))
LOG_FILE       = os.environ.get("LOG_FILE", "/var/log/acl-export.log")

# ---------- Logging ----------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger(__name__)

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}


def load_state() -> set:
    """Devuelve el conjunto de token IDs ya exportados."""
    if STATE_FILE.exists():
        try:
            data = json.loads(STATE_FILE.read_text())
            return set(data.get("exported", []))
        except Exception:
            pass
    return set()


def save_state(exported: set) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps({"exported": sorted(exported)}, indent=2))


def fetch_submitted_reviews() -> list:
    """Trae revisiones completadas con sus relaciones."""
    url = (
        f"{SUPABASE_URL}/rest/v1/acl_review_tokens"
        "?select=id,token,submitted_at,responses,service_id,client_id"
        ",services(name,business_name)"
        ",clients(company_name,contact_name)"
        "&submitted_at=not.is.null"
        "&order=submitted_at.asc"
    )
    resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    return resp.json()


def build_output(review: dict) -> dict | None:
    """
    Construye el dict a escribir. Devuelve None si no hay acciones pendientes.
    """
    responses = review.get("responses") or []
    pending = [
        {
            "user":   r["name"],
            "action": r["action"],
            "note":   r.get("note", ""),
        }
        for r in responses
        if r.get("action") in ("eliminar", "cambiar")
    ]

    if not pending:
        return None

    svc = review.get("services") or {}
    cli = review.get("clients") or {}

    return {
        "generated_at":    datetime.now(timezone.utc).isoformat(),
        "review_id":       review["id"],
        "reviewed_at":     review["submitted_at"],
        "service":         svc.get("business_name") or svc.get("name") or review["service_id"],
        "client":          cli.get("company_name") or review.get("client_id", ""),
        "pending_actions": pending,
    }


def write_output(data: dict, review_id: str) -> Path:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = OUTPUT_DIR / f"acl_{ts}_{review_id[:8]}.json"
    filename.write_text(json.dumps(data, ensure_ascii=False, indent=2))
    return filename


def main() -> None:
    log.info("=== acl-export inicio ===")

    exported = load_state()
    reviews  = fetch_submitted_reviews()
    log.info(f"Revisiones completadas en Supabase: {len(reviews)}")

    new_exports = 0
    skipped     = 0

    for review in reviews:
        rid = review["id"]

        if rid in exported:
            skipped += 1
            continue

        data = build_output(review)
        if data is None:
            log.info(f"  {rid[:8]}... sin acciones pendientes, marcando como procesado")
            exported.add(rid)
            continue

        path = write_output(data, rid)
        exported.add(rid)
        new_exports += 1
        log.info(
            f"  {rid[:8]}... → {path.name} "
            f"({len(data['pending_actions'])} accion(es): "
            f"{', '.join(a['user'] for a in data['pending_actions'])})"
        )

    save_state(exported)
    log.info(
        f"=== fin: {new_exports} exportado(s), {skipped} ya procesado(s) ==="
    )


if __name__ == "__main__":
    main()
