#!/bin/bash
# =============================================================
# mikrotik-heartbeat.sh — Lee logs de MikroTik y envía última
# métrica al Service Catalog como heartbeat (source: mikrotik).
#
# Usar junto con ingest-telemetry.py para la serie histórica.
#
# Búsqueda de config (en orden):
#   1. Arg CLI  2. /etc/mikrotik-ingest.env  3. $SCRIPT_DIR/.env
#
# Cron (cada minuto):
#   * * * * * /srv/scripts/mikrotik/mikrotik-heartbeat.sh
# =============================================================

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"

if [[ -n "${1:-}" && -f "$1" ]]; then
  ENV_FILE="$1"
elif [[ -f /etc/mikrotik-ingest.env ]]; then
  ENV_FILE=/etc/mikrotik-ingest.env
elif [[ -f "$SCRIPT_DIR/.env" ]]; then
  ENV_FILE="$SCRIPT_DIR/.env"
else
  echo "ERROR: no se encontró archivo de configuración" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"

_BASE_URL="${SUPABASE_URL%%/functions/v1*}"
HEARTBEAT_URL="${_BASE_URL}/functions/v1/ingest-heartbeat"

: "${SUPABASE_ANON_KEY:?}" "${INGEST_SECRET:?}"

LOG_DIR="${MIKROTIK_LOG_DIR:-/srv/network-monitor/network-monitor/historial}"
STATE_DIR="${MIKROTIK_STATE_DIR:-$SCRIPT_DIR/state}"
LOG_LOCAL="${LOG_FILE:-/var/log/mikrotik-heartbeat.log}"

mkdir -p "$STATE_DIR"

# ---------- Mapeo desde archivo externo ----------
# Formato de /etc/mikrotik-map.env (o MIKROTIK_MAP_FILE):
#   RegionalSur=uuid-del-service-id
#   RegionalNorte=uuid-del-service-id
#   # Kuma opcional:
#   RegionalSur_kuma=https://kuma.midominio.com/api/push/AbCdEfGhIj
MAP_FILE="${MIKROTIK_MAP_FILE:-/etc/mikrotik-map.env}"
[ -f "$SCRIPT_DIR/map.env" ] && MAP_FILE="$SCRIPT_DIR/map.env"

declare -A SERVICE_MAP
declare -A KUMA_MAP

if [[ -f "$MAP_FILE" ]]; then
  while IFS='=' read -r key val; do
    [[ "$key" =~ ^#|^[[:space:]]*$ ]] && continue
    key=$(echo "$key" | xargs)
    val=$(echo "$val" | xargs)
    if [[ "$key" == *_kuma ]]; then
      KUMA_MAP["${key%_kuma}"]="$val"
    else
      SERVICE_MAP["$key"]="$val"
    fi
  done < "$MAP_FILE"
else
  log "WARN: no se encontró map file ($MAP_FILE) — ningún router configurado"
fi

# ---------- Thresholds ----------
WARN_CPU=80;  ERROR_CPU=95
WARN_RAM=85;  ERROR_RAM=92

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "$LOG_LOCAL"; }

# Rotar log local si pasa de 5 MB
if [ -f "$LOG_LOCAL" ] && [ "$(stat -c%s "$LOG_LOCAL" 2>/dev/null || echo 0)" -gt 5242880 ]; then
  mv "$LOG_LOCAL" "${LOG_LOCAL%.log}-$(date '+%Y%m').log"
fi

notify_kuma() {
  local push_url="$1" status="$2" msg="$3"
  [[ -z "$push_url" ]] && return 0
  local base_url="${push_url%%\?*}"
  curl -fsS --max-time 10 -G "$base_url" \
    --data-urlencode "status=${status}" \
    --data-urlencode "msg=${msg}" \
    --data-urlencode "ping=0" \
    >/dev/null 2>&1 || true
}

for LOG_FILE in "$LOG_DIR"/*.log; do
  [ -f "$LOG_FILE" ] || continue

  CLIENT_NAME=$(basename "$LOG_FILE" .log)
  SERVICE_ID="${SERVICE_MAP[$CLIENT_NAME]:-}"

  if [[ -z "$SERVICE_ID" || "$SERVICE_ID" == uuid-del-* ]]; then
    log "SKIP $CLIENT_NAME — sin SERVICE_ID configurado"
    continue
  fi

  LAST_LINE=$(grep "METRICAS" "$LOG_FILE" | tail -1)
  [ -z "$LAST_LINE" ] && continue

  LINE_TS=$(echo "$LAST_LINE" | grep -oP '\[\K[^\]]+')

  STATE_FILE="$STATE_DIR/${CLIENT_NAME}.heartbeat"
  LAST_SENT=$(cat "$STATE_FILE" 2>/dev/null || echo "")
  if [ "$LINE_TS" = "$LAST_SENT" ]; then
    continue
  fi

  CPU=$(echo "$LAST_LINE"   | grep -oP 'CPU: \K[0-9.]+')
  RAM=$(echo "$LAST_LINE"   | grep -oP 'RAM: \K[0-9.]+')
  WAN=$(echo "$LAST_LINE"   | grep -oP 'WAN In: \K[0-9.]+')
  IPSEC=$(echo "$LAST_LINE" | grep -oP 'IPsec: \K\S+')

  CPU=${CPU:-0}; RAM=${RAM:-0}; WAN=${WAN:-0}; IPSEC=${IPSEC:-UNKNOWN}

  STATUS="success"
  ISSUES=""

  (( $(echo "$CPU > $ERROR_CPU" | bc -l) )) && { STATUS="failed";  ISSUES="CPU alta (${CPU}%) "; }
  (( $(echo "$CPU > $WARN_CPU"  | bc -l) )) && [[ "$STATUS" = "success" ]] && { STATUS="warning"; ISSUES="CPU alta (${CPU}%) "; }
  (( $(echo "$RAM > $ERROR_RAM" | bc -l) )) && { STATUS="failed";  ISSUES="${ISSUES}RAM alta (${RAM}%) "; }
  (( $(echo "$RAM > $WARN_RAM"  | bc -l) )) && [[ "$STATUS" = "success" ]] && { STATUS="warning"; ISSUES="${ISSUES}RAM alta (${RAM}%) "; }
  [[ "$IPSEC" = "OFFLINE" ]] && [[ "$STATUS" = "success" ]] && { STATUS="warning"; ISSUES="${ISSUES}IPsec OFFLINE "; }

  ISSUES=$(echo "$ISSUES" | xargs)
  [ -z "$ISSUES" ] && ISSUES="Normal"
  MESSAGE="CPU: ${CPU}% | RAM: ${RAM}% | WAN: ${WAN} Mbps | IPsec: ${IPSEC}"

  PAYLOAD=$(cat <<EOF
{
  "service_id": "$SERVICE_ID",
  "source": "mikrotik",
  "status": "$STATUS",
  "message": "$MESSAGE",
  "payload": {
    "timestamp": "$LINE_TS",
    "cpu_pct": $CPU,
    "ram_pct": $RAM,
    "wan_in_mbps": $WAN,
    "ipsec_status": "$IPSEC",
    "client": "$CLIENT_NAME",
    "issues": "$ISSUES"
  }
}
EOF
)

  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$HEARTBEAT_URL" \
    -H "Content-Type: application/json" \
    -H "apikey: $SUPABASE_ANON_KEY" \
    -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
    -H "X-Ingest-Secret: $INGEST_SECRET" \
    -d "$PAYLOAD")

  KUMA_URL="${KUMA_MAP[$CLIENT_NAME]:-}"
  if [ "$HTTP_CODE" = "200" ]; then
    echo "$LINE_TS" > "$STATE_FILE"
    log "✓ $CLIENT_NAME → $STATUS | $MESSAGE"
    notify_kuma "$KUMA_URL" "up" "mikrotik $CLIENT_NAME | $MESSAGE"
  else
    log "✗ $CLIENT_NAME → HTTP $HTTP_CODE"
    notify_kuma "$KUMA_URL" "down" "mikrotik $CLIENT_NAME error HTTP $HTTP_CODE"
  fi
done
