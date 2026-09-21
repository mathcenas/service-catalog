#!/usr/bin/env bash
# =============================================================
# mk-ingest.sh — Envía telemetría y eventos MikroTik a Supabase
# Cron sugerido (crontab -e):
#   */5 * * * * /srv/network-monitor/mk-ingest.sh >> /srv/network-monitor/logs/mk-ingest.log 2>&1
# Requiere: mk-ingest.conf en la misma carpeta (ver mk-ingest.conf.example)
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

# Required vars: SUPABASE_URL, HISTORIAL_DIR
# MK_DEVICES[<site_name>]="<service_uuid>:<ingest_secret>"
# donde site_name es el identificador en el nombre del archivo JSON
: "${SUPABASE_URL:?mk-ingest: SUPABASE_URL not set}"
: "${HISTORIAL_DIR:?mk-ingest: HISTORIAL_DIR not set}"

TELEMETRY_URL="${SUPABASE_URL}/functions/v1/ingest-telemetry"
EVENTS_URL="${SUPABASE_URL}/functions/v1/ingest-events"

LOG_DIR="${SCRIPT_DIR}/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="${LOG_DIR}/mk-ingest-$(date +%Y-%m).log"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "$LOG_FILE"; }

find "$LOG_DIR" -name "mk-ingest-*.log" -mtime +90 -delete 2>/dev/null || true

post_json() {
  local url="$1" secret="$2" payload="$3" file_label="$4"
  local http_code resp
  http_code=$(curl -s -o /tmp/mk_ingest_resp.txt -w "%{http_code}" \
    -X POST "$url" \
    -H "Content-Type: application/json" \
    -H "X-Ingest-Secret: $secret" \
    --data-raw "$payload" \
    --max-time 15)
  resp=$(cat /tmp/mk_ingest_resp.txt 2>/dev/null || echo "")
  if [[ "$http_code" == "201" ]]; then
    log "✅ $file_label → $http_code"
    return 0
  else
    log "❌ $file_label → $http_code $resp"
    return 1
  fi
}

# Extrae service_id y secret del mapa por nombre de sitio
# MK_DEVICES["RegionalSur"]="uuid:secret"
lookup_device() {
  local site_name="$1"
  if [[ -z "${MK_DEVICES[$site_name]+_}" ]]; then
    return 1
  fi
  local entry="${MK_DEVICES[$site_name]}"
  DEVICE_SERVICE_ID="${entry%%:*}"
  DEVICE_SECRET="${entry#*:}"
}

shopt -s nullglob

# ---------- Telemetría ----------
for f in "${HISTORIAL_DIR}"/telemetry_*.json; do
  filename=$(basename "$f")
  site_name="${filename#telemetry_}"
  site_name="${site_name%.json}"

  if ! lookup_device "$site_name"; then
    log "⚠️  $filename — '$site_name' no está en MK_DEVICES, omitiendo"
    continue
  fi

  raw=$(cat "$f")
  if echo "$raw" | grep -q '"telemetry"'; then
    payload="$raw"
  else
    payload="{\"service_id\":\"${DEVICE_SERVICE_ID}\",\"telemetry\":${raw}}"
  fi

  if post_json "$TELEMETRY_URL" "$DEVICE_SECRET" "$payload" "$filename"; then
    mv "$f" "${f%.json}.sent"
  fi
done

# ---------- Eventos ----------
for f in "${HISTORIAL_DIR}"/events_*.json; do
  filename=$(basename "$f")
  site_name="${filename#events_}"
  site_name="${site_name%.json}"

  if ! lookup_device "$site_name"; then
    log "⚠️  $filename — '$site_name' no está en MK_DEVICES, omitiendo"
    continue
  fi

  raw=$(cat "$f")
  if echo "$raw" | grep -qE '^\s*\['; then
    payload="{\"service_id\":\"${DEVICE_SERVICE_ID}\",\"events\":${raw}}"
  elif echo "$raw" | grep -q '"events"'; then
    payload="$raw"
  else
    payload="{\"service_id\":\"${DEVICE_SERVICE_ID}\",\"events\":[${raw}]}"
  fi

  if post_json "$EVENTS_URL" "$DEVICE_SECRET" "$payload" "$filename"; then
    mv "$f" "${f%.json}.sent"
  fi
done

# Limpia archivos enviados con más de 7 días
find "${HISTORIAL_DIR}" -name "*.sent" -mtime +7 -delete 2>/dev/null || true
