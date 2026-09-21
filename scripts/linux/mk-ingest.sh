#!/usr/bin/env bash
# =============================================================
# mk-ingest.sh — Envía telemetría y eventos MikroTik a Supabase
# Cron sugerido: */5 * * * * /srv/network-monitor/mk-ingest.sh
# Requiere: mk-ingest.conf en la misma carpeta (ver ejemplo abajo)
# =============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF_FILE="${SCRIPT_DIR}/mk-ingest.conf"

if [[ ! -f "$CONF_FILE" ]]; then
  echo "[mk-ingest] ERROR: config file not found: $CONF_FILE"
  exit 1
fi

# shellcheck source=/dev/null
source "$CONF_FILE"

# Required vars from conf: SUPABASE_URL, HISTORIAL_DIR
# Per-device mapping: MK_DEVICES is an associative array
# MK_DEVICES[<service_id>]="<ingest_secret>"
: "${SUPABASE_URL:?MK_INGEST: SUPABASE_URL not set in $CONF_FILE}"
: "${HISTORIAL_DIR:?MK_INGEST: HISTORIAL_DIR not set in $CONF_FILE}"

TELEMETRY_URL="${SUPABASE_URL}/functions/v1/ingest-telemetry"
EVENTS_URL="${SUPABASE_URL}/functions/v1/ingest-events"

LOG_DIR="${SCRIPT_DIR}/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="${LOG_DIR}/mk-ingest-$(date +%Y-%m).log"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "$LOG_FILE"; }

# Remove log files older than 90 days
find "$LOG_DIR" -name "mk-ingest-*.log" -mtime +90 -delete 2>/dev/null || true

post_json() {
  local url="$1" secret="$2" payload="$3" file_label="$4"
  local http_code
  http_code=$(curl -s -o /tmp/mk_ingest_resp.txt -w "%{http_code}" \
    -X POST "$url" \
    -H "Content-Type: application/json" \
    -H "X-Ingest-Secret: $secret" \
    --data-raw "$payload" \
    --max-time 15)

  local resp
  resp=$(cat /tmp/mk_ingest_resp.txt 2>/dev/null || echo "")

  if [[ "$http_code" == "201" ]]; then
    log "✅ $file_label → $url ($http_code)"
    return 0
  else
    log "❌ $file_label → $url ($http_code) $resp"
    return 1
  fi
}

# ---------- Process telemetry files ----------
shopt -s nullglob
for f in "${HISTORIAL_DIR}"/telemetry_*.json; do
  filename=$(basename "$f")
  # Extract service_id from filename: telemetry_<service_id>.json
  service_id="${filename#telemetry_}"
  service_id="${service_id%.json}"

  if [[ -z "${MK_DEVICES[$service_id]+_}" ]]; then
    log "⚠️  $filename — service_id not in MK_DEVICES, skipping"
    continue
  fi
  secret="${MK_DEVICES[$service_id]}"

  # Wrap file content under telemetry key if not already wrapped
  raw=$(cat "$f")
  # If file is already { service_id, telemetry: {...} } keep as-is, else wrap
  if echo "$raw" | grep -q '"telemetry"'; then
    payload="$raw"
  else
    payload="{\"service_id\":\"${service_id}\",\"telemetry\":${raw}}"
  fi

  if post_json "$TELEMETRY_URL" "$secret" "$payload" "$filename"; then
    # Archive processed file
    mv "$f" "${f%.json}.sent"
  fi
done

# ---------- Process events files ----------
for f in "${HISTORIAL_DIR}"/events_*.json; do
  filename=$(basename "$f")
  service_id="${filename#events_}"
  service_id="${service_id%.json}"

  if [[ -z "${MK_DEVICES[$service_id]+_}" ]]; then
    log "⚠️  $filename — service_id not in MK_DEVICES, skipping"
    continue
  fi
  secret="${MK_DEVICES[$service_id]}"

  raw=$(cat "$f")
  # Accept array or single object; wrap in { service_id, events: [...] }
  if echo "$raw" | grep -qE '^\['; then
    payload="{\"service_id\":\"${service_id}\",\"events\":${raw}}"
  elif echo "$raw" | grep -q '"events"'; then
    payload="$raw"
  else
    payload="{\"service_id\":\"${service_id}\",\"events\":[${raw}]}"
  fi

  if post_json "$EVENTS_URL" "$secret" "$payload" "$filename"; then
    mv "$f" "${f%.json}.sent"
  fi
done

# ---------- Cleanup sent files older than 7 days ----------
find "${HISTORIAL_DIR}" -name "*.sent" -mtime +7 -delete 2>/dev/null || true
