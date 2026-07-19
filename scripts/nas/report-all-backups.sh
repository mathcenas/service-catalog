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

  SIZE_BYTES=0
  RAW=$(timeout 60 du -sb "$SNAP_DIR" 2>/dev/null | awk '{print $1}')
  SIZE_BYTES=${RAW:-0}

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
