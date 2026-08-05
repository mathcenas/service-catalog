#!/bin/bash
# =============================================================
# system-health.sh — Métricas de hardware de VPS Linux
# al Service Catalog como heartbeat (source: system-health)
# Correr cada hora via cron:
#   0 * * * * /srv/scripts/system-health.sh
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
  echo "ERROR: no se encontró archivo de configuración (intentado: /etc/backup-ingest.env, $SCRIPT_DIR/.env)" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"

# Compatibilidad: acepta ANON_KEY como alias de SUPABASE_ANON_KEY
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-$ANON_KEY}"

if [[ -z "$SUPABASE_URL" || -z "$SUPABASE_ANON_KEY" || -z "$INGEST_SECRET" || -z "$SERVICE_ID" ]]; then
  echo "ERROR: faltan variables en $ENV_FILE (SUPABASE_URL, SUPABASE_ANON_KEY, INGEST_SECRET, SERVICE_ID)" >&2
  exit 1
fi

# ---------- Internos ----------
HEARTBEAT_URL="${SUPABASE_URL}/functions/v1/ingest-heartbeat"
KUMA_PUSH_URL="${KUMA_PUSH_URL:-}"
LOG_FILE="${LOG_FILE:-/var/log/system-health.log}"
MAX_LOG_BYTES=5242880  # 5 MB

# ---------- Logger ----------
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "$LOG_FILE"; }

notify_kuma() {
  [[ -z "$KUMA_PUSH_URL" ]] && return 0
  local base_url="${KUMA_PUSH_URL%%\?*}"
  curl -fsS --max-time 10 -G "$base_url" \
    --data-urlencode "status=${1}" \
    --data-urlencode "msg=${2}" \
    --data-urlencode "ping=0" \
    >/dev/null 2>&1 || true
}

# Rotar log si pasa de 5 MB
if [ -f "$LOG_FILE" ] && [ "$(stat -c%s "$LOG_FILE" 2>/dev/null || echo 0)" -gt "$MAX_LOG_BYTES" ]; then
  mv "$LOG_FILE" "${LOG_FILE%.log}-$(date '+%Y%m').log"
fi

# Forzar locale C para que los decimales usen punto (evita coma en locales es/pt)
export LC_ALL=C LANG=C

# ---------- CPU ----------
# Promedio de carga del último minuto normalizado por cantidad de cores
CORES=$(nproc)
LOAD1=$(awk '{print $1}' /proc/loadavg)
CPU_PCT=$(awk -v l="$LOAD1" -v cores="$CORES" 'BEGIN { pct = (l / cores) * 100; if (pct > 100) pct = 100; printf "%.1f", pct }')

# ---------- RAM ----------
RAM_INFO=$(free -b | awk '/^Mem:/ {print $2, $3}')
RAM_TOTAL=$(echo "$RAM_INFO" | awk '{print $1}')
RAM_USED=$(echo "$RAM_INFO" | awk '{print $2}')
RAM_PCT=$(awk -v used="$RAM_USED" -v total="$RAM_TOTAL" 'BEGIN { printf "%.1f", (used / total) * 100 }')

# ---------- Disco / ----------
DISK_INFO=$(df -B1 / | awk 'NR==2 {print $2, $4, $5}')
DISK_TOTAL=$(echo "$DISK_INFO" | awk '{print $1}')
DISK_FREE_B=$(echo "$DISK_INFO" | awk '{print $2}')
DISK_PCT=$(echo "$DISK_INFO" | awk '{print $3}' | tr -d '%')
DISK_FREE_GB=$(awk -v free="$DISK_FREE_B" 'BEGIN { printf "%.1f", free / 1073741824 }')

# ---------- Uptime ----------
UPTIME_SECS=$(awk -F. '{print $1}' /proc/uptime)
UPTIME_DAYS=$(( UPTIME_SECS / 86400 ))
UPTIME_HRS=$(( (UPTIME_SECS % 86400) / 3600 ))
if [ "$UPTIME_DAYS" -gt 0 ]; then
  UPTIME_STR="${UPTIME_DAYS}d ${UPTIME_HRS}h"
else
  UPTIME_STR="${UPTIME_HRS}h"
fi

# ---------- Status ----------
STATUS="success"
ISSUES=""

CPU_INT=${CPU_PCT%.*}
RAM_INT=${RAM_PCT%.*}
DISK_INT=${DISK_PCT%.*}

if [ "${CPU_INT:-0}" -ge 95 ]; then
  STATUS="failed"; ISSUES="CPU alta (${CPU_PCT}%) "
elif [ "${CPU_INT:-0}" -ge 80 ]; then
  STATUS="warning"; ISSUES="CPU alta (${CPU_PCT}%) "
fi

if [ "${RAM_INT:-0}" -ge 92 ]; then
  STATUS="failed"; ISSUES="${ISSUES}RAM alta (${RAM_PCT}%) "
elif [ "${RAM_INT:-0}" -ge 80 ]; then
  [ "$STATUS" = "success" ] && STATUS="warning"
  ISSUES="${ISSUES}RAM alta (${RAM_PCT}%) "
fi

if [ "${DISK_INT:-0}" -ge 90 ]; then
  STATUS="failed"; ISSUES="${ISSUES}Disco lleno (${DISK_PCT}%) "
elif [ "${DISK_INT:-0}" -ge 75 ]; then
  [ "$STATUS" = "success" ] && STATUS="warning"
  ISSUES="${ISSUES}Disco alto (${DISK_PCT}%) "
fi

ISSUES=$(echo "$ISSUES" | xargs)
[ -z "$ISSUES" ] && ISSUES="Normal"

MESSAGE="CPU: ${CPU_PCT}% | RAM: ${RAM_PCT}% | Disk: ${DISK_PCT}% (${DISK_FREE_GB} GB free) | Up: ${UPTIME_STR}"

# ---------- Payload ----------
PAYLOAD=$(cat <<EOF
{
  "service_id": "$SERVICE_ID",
  "source": "system-health",
  "status": "$STATUS",
  "message": "$MESSAGE",
  "payload": {
    "cpu_pct": $CPU_PCT,
    "load_avg": $LOAD1,
    "ram_pct": $RAM_PCT,
    "disk_pct": $DISK_PCT,
    "disk_free_gb": $DISK_FREE_GB,
    "uptime_str": "$UPTIME_STR",
    "uptime_seconds": $UPTIME_SECS,
    "issues": "$ISSUES"
  }
}
EOF
)

# ---------- Enviar ----------
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$HEARTBEAT_URL" \
  -H "Content-Type: application/json" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "X-Ingest-Secret: $INGEST_SECRET" \
  -d "$PAYLOAD")

if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "201" ]]; then
  log "✓ system-health → $STATUS | $MESSAGE"
  notify_kuma "up" "system-health OK | $MESSAGE"
else
  log "✗ system-health → HTTP $HTTP_CODE"
  notify_kuma "down" "system-health error HTTP $HTTP_CODE"
  exit 1
fi
