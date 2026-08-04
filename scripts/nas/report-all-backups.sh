#!/bin/bash
# =============================================================
# report-all-backups.sh — Reporta todos los snapshots del NAS
# Schedulear en crontab: 0 8 * * * /usr/local/bin/report-all-backups.sh
# Requiere: /etc/backup-ingest.env con los paths configurados
# =============================================================

# ---------- Cargar .env ----------
# Orden: arg CLI → /etc/backup-ingest.env → $SCRIPT_DIR/.env
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
if [[ -n "${1:-}" && -f "$1" ]]; then
  ENV_FILE="$1"
elif [[ -f /etc/backup-ingest.env ]]; then
  ENV_FILE=/etc/backup-ingest.env
elif [[ -f "$SCRIPT_DIR/.env" ]]; then
  ENV_FILE="$SCRIPT_DIR/.env"
else
  echo "ERROR: no se encontró archivo de configuración" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"

if [[ -z "$INGEST_URL" && -n "$SUPABASE_URL" ]]; then
  INGEST_URL="${SUPABASE_URL}/functions/v1/ingest-backup"
fi

LOG_FILE="${LOG_FILE:-/var/log/nas-backup-report.log}"
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "$LOG_FILE"; }

log "=== inicio ==="
log "INGEST_URL=$INGEST_URL"
log "SERVICE_ID=$SERVICE_ID"

report() {
  local JOB_NAME="$1"
  local SNAP_DIR="$2"

  if [ ! -d "$SNAP_DIR" ]; then
    log "SKIP $JOB_NAME — directorio no existe: $SNAP_DIR"
    return
  fi

  # du en grandes directorios NAS puede tardar minutos; usamos cache de 25h
  local CACHE_FILE="/tmp/du_cache_$(echo "$SNAP_DIR" | md5sum | cut -c1-8)"
  local SIZE_BYTES=0
  local CACHE_USED="no"

  if [ -f "$CACHE_FILE" ] && [ $(( $(date +%s) - $(stat -c %Y "$CACHE_FILE") )) -lt 90000 ]; then
    SIZE_BYTES=$(cat "$CACHE_FILE")
    CACHE_USED="si (cache)"
  else
    log "$JOB_NAME — calculando du en $SNAP_DIR ..."
    RAW=$(timeout 600 du -sbl "$SNAP_DIR" 2>/dev/null | awk '{print $1}')
    SIZE_BYTES=${RAW:-0}
    echo "$SIZE_BYTES" > "$CACHE_FILE"
  fi

  log "$JOB_NAME — size=$SIZE_BYTES bytes ($(numfmt --to=iec $SIZE_BYTES 2>/dev/null || echo ${SIZE_BYTES}B)) cache=$CACHE_USED"

  local HTTP_CODE
  HTTP_CODE=$(curl -s -o /tmp/nas_curl_body.txt -w "%{http_code}" -X POST "$INGEST_URL" \
    -H "Content-Type: application/json" \
    -H "apikey: $SUPABASE_ANON_KEY" \
    -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
    -H "X-Ingest-Secret: $INGEST_SECRET" \
    -d "{\"service_id\":\"$SERVICE_ID\",\"job_name\":\"$JOB_NAME\",\"status\":\"success\",\"size_bytes\":$SIZE_BYTES,\"details\":\"snapshot=$SNAP_DIR\"}")

  local BODY
  BODY=$(cat /tmp/nas_curl_body.txt 2>/dev/null)
  log "$JOB_NAME — HTTP $HTTP_CODE | $BODY"
}

report "NAS Daily → RespaldoD"   "$SNAP_RESPALDOD_DAILY"
report "NAS Weekly → RespaldoD"  "$SNAP_RESPALDOD_WEEKLY"
report "NAS Monthly → RespaldoD" "$SNAP_RESPALDOD_MONTHLY"
report "NAS Daily → Mayo25"      "$SNAP_MAYO25_DAILY"
report "NAS Weekly → Mayo25"     "$SNAP_MAYO25_WEEKLY"
report "NAS Daily → Respaldo-B"  "$SNAP_RESPALDOB_DAILY"
report "NAS Weekly → Respaldo-B" "$SNAP_RESPALDOB_WEEKLY"
report "NAS Yearly → Respaldo-B" "$SNAP_RESPALDOB_YEARLY"
report "NAS Sync"                "$SYNC_DIR"
