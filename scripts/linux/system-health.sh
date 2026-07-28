#!/bin/bash
# =============================================================
# system-health.sh — Métricas de hardware de VPS Linux
# al Service Catalog como heartbeat (source: system-health)
# Correr cada hora via cron:
#   0 * * * * /srv/scripts/system-health.sh
# =============================================================

# ---------- Config (editar estos valores) ----------
SUPABASE_URL="https://REEMPLAZAR.supabase.co"
ANON_KEY="REEMPLAZAR_CON_ANON_KEY"
INGEST_SECRET="REEMPLAZAR_CON_INGEST_SECRET"
SERVICE_ID="REEMPLAZAR_CON_SERVICE_ID"

# ---------- Internos ----------
HEARTBEAT_URL="${SUPABASE_URL}/functions/v1/ingest-heartbeat"
LOG_FILE="/var/log/system-health.log"
MAX_LOG_BYTES=5242880  # 5 MB

# ---------- Logger ----------
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "$LOG_FILE"; }

# Rotar log si pasa de 5 MB
if [ -f "$LOG_FILE" ] && [ "$(stat -c%s "$LOG_FILE" 2>/dev/null || echo 0)" -gt "$MAX_LOG_BYTES" ]; then
  mv "$LOG_FILE" "${LOG_FILE%.log}-$(date '+%Y%m').log"
fi

# ---------- CPU ----------
# Promedio de carga del último minuto normalizado por cantidad de cores
CORES=$(nproc)
LOAD1=$(awk '{print $1}' /proc/loadavg)
CPU_PCT=$(awk -v load="$LOAD1" -v cores="$CORES" 'BEGIN { pct = (load / cores) * 100; if (pct > 100) pct = 100; printf "%.1f", pct }')

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
STATUS="ok"
ISSUES=""

CPU_INT=${CPU_PCT%.*}
RAM_INT=${RAM_PCT%.*}
DISK_INT=${DISK_PCT%.*}

if [ "${CPU_INT:-0}" -ge 95 ]; then
  STATUS="error"; ISSUES="CPU alta (${CPU_PCT}%) "
elif [ "${CPU_INT:-0}" -ge 80 ]; then
  STATUS="warning"; ISSUES="CPU alta (${CPU_PCT}%) "
fi

if [ "${RAM_INT:-0}" -ge 92 ]; then
  STATUS="error"; ISSUES="${ISSUES}RAM alta (${RAM_PCT}%) "
elif [ "${RAM_INT:-0}" -ge 80 ]; then
  [ "$STATUS" = "ok" ] && STATUS="warning"
  ISSUES="${ISSUES}RAM alta (${RAM_PCT}%) "
fi

if [ "${DISK_INT:-0}" -ge 90 ]; then
  STATUS="error"; ISSUES="${ISSUES}Disco lleno (${DISK_PCT}%) "
elif [ "${DISK_INT:-0}" -ge 75 ]; then
  [ "$STATUS" = "ok" ] && STATUS="warning"
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
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "X-Ingest-Secret: $INGEST_SECRET" \
  -d "$PAYLOAD")

if [ "$HTTP_CODE" = "200" ]; then
  log "✓ system-health → $STATUS | $MESSAGE"
else
  log "✗ system-health → HTTP $HTTP_CODE"
  exit 1
fi
