#!/bin/bash
# =============================================================
# backfill-snapshots.sh — Registra historial de snapshots rsnapshot
#
# Lee la fecha de modificación de cada directorio snapshot y lo
# envía a ingest-backup con suppress_email=true (sin notificaciones).
#
# Uso: ./backfill-snapshots.sh [/etc/backup-ingest.env]
# =============================================================

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
ENV_FILE="${1:-/etc/backup-ingest.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: no se encontró $ENV_FILE" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"

if [[ -z "$INGEST_URL" && -n "$SUPABASE_URL" ]]; then
  INGEST_URL="${SUPABASE_URL}/functions/v1/ingest-backup"
fi

: "${SERVICE_ID:?SERVICE_ID no configurado}"
: "${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY no configurado}"
: "${INGEST_SECRET:?INGEST_SECRET no configurado}"

send_snapshot() {
  local job_name="$1"
  local snap_dir="$2"

  if [[ ! -d "$snap_dir" ]]; then
    echo "SKIP $job_name — no existe: $snap_dir"
    return
  fi

  # Fecha de modificación del directorio = cuando rsnapshot terminó
  local ts
  ts=$(stat -c '%Y' "$snap_dir" 2>/dev/null)
  if [[ -z "$ts" ]]; then
    echo "SKIP $job_name — no se pudo leer timestamp de $snap_dir"
    return
  fi

  local backed_up_at
  backed_up_at=$(date -u -d "@$ts" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -r "$ts" '+%Y-%m-%dT%H:%M:%SZ')

  local http
  http=$(curl -s -o /tmp/bf_body.txt -w "%{http_code}" -X POST "$INGEST_URL" \
    -H "Content-Type: application/json" \
    -H "apikey: $SUPABASE_ANON_KEY" \
    -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
    -H "X-Ingest-Secret: $INGEST_SECRET" \
    -d "$(jq -n \
      --arg service_id    "$SERVICE_ID" \
      --arg job_name      "$job_name" \
      --arg backed_up_at  "$backed_up_at" \
      --arg details       "backfill: $snap_dir" \
      '{
        service_id:     $service_id,
        job_name:       $job_name,
        status:         "success",
        backed_up_at:   $backed_up_at,
        details:        $details,
        suppress_email: true
      }')")

  local body
  body=$(cat /tmp/bf_body.txt 2>/dev/null)
  echo "[$http] $job_name — $backed_up_at | $body"
}

echo "=== Backfill snapshots → $SERVICE_ID ==="
echo "URL: $INGEST_URL"
echo ""

# ---- Mayo25 ----
BASE_MAYO="/srv/4a2b79fd-99f7-4846-8da0-ac286210c58a/Mayo25/NASFiles"
for i in 0 1 2 3 4 5 6; do
  [[ -d "$BASE_MAYO/daily.$i" ]] && send_snapshot "NAS Daily → Mayo25" "$BASE_MAYO/daily.$i"
done
for i in 0 1 2 3; do
  [[ -d "$BASE_MAYO/weekly.$i" ]] && send_snapshot "NAS Weekly → Mayo25" "$BASE_MAYO/weekly.$i"
done
for i in 0 1 2 3; do
  [[ -d "$BASE_MAYO/monthly.$i" ]] && send_snapshot "NAS Monthly → Mayo25" "$BASE_MAYO/monthly.$i"
done

# ---- RespaldoD ----
BASE_RD="/srv/932f6bc5-fe7f-4849-8120-102fff0cbf27/RespaldoD-Shared/NASFiles"
for i in 0 1 2 3 4 5 6; do
  [[ -d "$BASE_RD/daily.$i" ]] && send_snapshot "NAS Daily → RespaldoD" "$BASE_RD/daily.$i"
done
for i in 0 1 2 3; do
  [[ -d "$BASE_RD/weekly.$i" ]] && send_snapshot "NAS Weekly → RespaldoD" "$BASE_RD/weekly.$i"
done
for i in 0 1 2 3; do
  [[ -d "$BASE_RD/monthly.$i" ]] && send_snapshot "NAS Monthly → RespaldoD" "$BASE_RD/monthly.$i"
done

# ---- Respaldo-B ----
BASE_RB="/srv/38b5fd08-aafb-432c-9dbf-5617ed0d5ed1/Respaldo-B-Open/NASFiles"
for i in 0 1 2 3 4 5 6; do
  [[ -d "$BASE_RB/daily.$i" ]] && send_snapshot "NAS Daily → Respaldo-B" "$BASE_RB/daily.$i"
done
for i in 0 1 2; do
  [[ -d "$BASE_RB/weekly.$i" ]] && send_snapshot "NAS Weekly → Respaldo-B" "$BASE_RB/weekly.$i"
done
[[ -d "$BASE_RB/yearly.0" ]] && send_snapshot "NAS Yearly → Respaldo-B" "$BASE_RB/yearly.0"

echo ""
echo "=== Listo ==="
