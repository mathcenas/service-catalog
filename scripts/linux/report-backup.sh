#!/bin/bash
# =============================================================
# report-backup.sh — Reporta un snapshot de rsnapshot/rsync
# Uso: report-backup.sh <job_name> <exit_code> <snapshot_dir>
# Ejemplo: report-backup.sh "OMV Daily" 0 /srv/uuid.../daily.0
# Requiere: /etc/backup-ingest.env
# =============================================================

source /etc/backup-ingest.env

JOB_NAME="${1:-unknown}"
EXIT_CODE="${2:-1}"
SNAPSHOT_DIR="$3"

STATUS="success"
[ "$EXIT_CODE" != "0" ] && STATUS="failed"

SIZE_BYTES=0
if [ -n "$SNAPSHOT_DIR" ] && [ -d "$SNAPSHOT_DIR" ]; then
  RAW=$(timeout 60 du -sb "$SNAPSHOT_DIR" 2>/dev/null | awk '{print $1}')
  SIZE_BYTES=${RAW:-0}
fi

RESPONSE=$(curl -s -X POST "$INGEST_URL" \
  -H "Content-Type: application/json" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "X-Ingest-Secret: $INGEST_SECRET" \
  -d "{
    \"service_id\": \"$SERVICE_ID\",
    \"job_name\": \"$JOB_NAME\",
    \"status\": \"$STATUS\",
    \"size_bytes\": $SIZE_BYTES,
    \"details\": \"rsnapshot exit_code=$EXIT_CODE snapshot=$SNAPSHOT_DIR\"
  }")

echo "[backup-report] $JOB_NAME → $STATUS size=$(numfmt --to=iec $SIZE_BYTES 2>/dev/null || echo ${SIZE_BYTES}B) | $RESPONSE"
