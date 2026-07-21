#!/bin/bash
# =============================================================
# report-all-backups.sh — Reporta todos los snapshots del NAS
# Schedulear en crontab: 0 8 * * * /usr/local/bin/report-all-backups.sh
# Requiere: /etc/backup-ingest.env con los paths configurados
# =============================================================

source /etc/backup-ingest.env

report() {
  local JOB_NAME="$1"
  local SNAP_DIR="$2"

  if [ ! -d "$SNAP_DIR" ]; then
    echo "[backup-report] SKIP $JOB_NAME — directorio no existe: $SNAP_DIR"
    return
  fi

  # du en grandes directorios NAS puede tardar minutos; usamos cache de 25h
  local CACHE_FILE="/tmp/du_cache_$(echo "$SNAP_DIR" | md5sum | cut -c1-8)"
  local SIZE_BYTES=0

  if [ -f "$CACHE_FILE" ] && [ $(( $(date +%s) - $(stat -c %Y "$CACHE_FILE") )) -lt 90000 ]; then
    SIZE_BYTES=$(cat "$CACHE_FILE")
  else
    # -l cuenta cada hardlink como archivo independiente (rsnapshot usa hardlinks,
    # sin -l los snapshots weekly/monthly aparecen como 0 bytes en el frontend)
    RAW=$(timeout 600 du -sbl "$SNAP_DIR" 2>/dev/null | awk '{print $1}')
    SIZE_BYTES=${RAW:-0}
    echo "$SIZE_BYTES" > "$CACHE_FILE"
  fi

  curl -s -X POST "$INGEST_URL" \
    -H "Content-Type: application/json" \
    -H "apikey: $SUPABASE_ANON_KEY" \
    -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
    -H "X-Ingest-Secret: $INGEST_SECRET" \
    -d "{\"service_id\":\"$SERVICE_ID\",\"job_name\":\"$JOB_NAME\",\"status\":\"success\",\"size_bytes\":$SIZE_BYTES,\"details\":\"snapshot=$SNAP_DIR\"}" \
    > /dev/null

  echo "[backup-report] $JOB_NAME → success | $(numfmt --to=iec $SIZE_BYTES 2>/dev/null || echo ${SIZE_BYTES}B)"
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
