#!/bin/bash
# =============================================================
# mikrotik-heartbeat.sh — Lee logs de Mikrotik y envía métricas
# al Service Catalog como heartbeat (source: mikrotik)
# Correr cada minuto via cron:
#   * * * * * /srv/network-monitor/mikrotik-heartbeat.sh
# =============================================================

# ---------- Config global ----------
SUPABASE_URL="https://REEMPLAZAR.supabase.co"
ANON_KEY="REEMPLAZAR_CON_ANON_KEY"
INGEST_SECRET="REEMPLAZAR_CON_INGEST_SECRET"
HEARTBEAT_URL="${SUPABASE_URL}/functions/v1/ingest-heartbeat"

LOG_DIR="/srv/network-monitor/network-monitor/historial"
STATE_DIR="/srv/network-monitor/state"
LOG_LOCAL="/srv/network-monitor/mikrotik-heartbeat.log"

mkdir -p "$STATE_DIR"

# ---------- Mapeo nombre_archivo → SERVICE_ID ----------
# Agregar una línea por cada cliente / router
declare -A SERVICE_MAP
SERVICE_MAP["RegionalSur"]="UUID-DEL-SERVICIO-REGIONAL-SUR"
SERVICE_MAP["RegionalNorte"]="UUID-DEL-SERVICIO-REGIONAL-NORTE"
# SERVICE_MAP["NombreArchivo"]="UUID-DEL-SERVICIO"

# ---------- Thresholds ----------
WARN_CPU=80;  ERROR_CPU=95
WARN_RAM=85;  ERROR_RAM=92
WARN_WAN=0    # Mbps mínimo esperado (0 = no chequear)

# ---------- Logger ----------
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "$LOG_LOCAL"; }

# Rotar log local si pasa de 5MB
if [ -f "$LOG_LOCAL" ] && [ "$(stat -c%s "$LOG_LOCAL" 2>/dev/null || echo 0)" -gt 5242880 ]; then
  mv "$LOG_LOCAL" "${LOG_LOCAL%.log}-$(date '+%Y%m').log"
fi

# ---------- Procesar cada log ----------
for LOG_FILE in "$LOG_DIR"/*.log; do
  [ -f "$LOG_FILE" ] || continue

  CLIENT_NAME=$(basename "$LOG_FILE" .log)
  SERVICE_ID="${SERVICE_MAP[$CLIENT_NAME]}"

  if [ -z "$SERVICE_ID" ] || [ "$SERVICE_ID" = "UUID-DEL-SERVICIO-"* ]; then
    log "SKIP $CLIENT_NAME — sin SERVICE_ID configurado"
    continue
  fi

  # Última línea METRICAS
  LAST_LINE=$(grep "METRICAS" "$LOG_FILE" | tail -1)
  [ -z "$LAST_LINE" ] && continue

  # Timestamp de la línea
  LINE_TS=$(echo "$LAST_LINE" | grep -oP '\[\K[^\]]+')

  # Evitar reenviar la misma línea
  STATE_FILE="$STATE_DIR/${CLIENT_NAME}.last"
  LAST_SENT=$(cat "$STATE_FILE" 2>/dev/null || echo "")
  if [ "$LINE_TS" = "$LAST_SENT" ]; then
    continue
  fi

  # ---------- Parsear métricas ----------
  CPU=$(echo "$LAST_LINE"   | grep -oP 'CPU: \K[0-9.]+')
  RAM=$(echo "$LAST_LINE"   | grep -oP 'RAM: \K[0-9.]+')
  WAN=$(echo "$LAST_LINE"   | grep -oP 'WAN In: \K[0-9.]+')
  IPSEC=$(echo "$LAST_LINE" | grep -oP 'IPsec: \K\S+')

  CPU=${CPU:-0}; RAM=${RAM:-0}; WAN=${WAN:-0}; IPSEC=${IPSEC:-UNKNOWN}

  # ---------- Status ----------
  STATUS="ok"
  ISSUES=""

  if (( $(echo "$CPU > $ERROR_CPU" | bc -l) )); then
    STATUS="error"; ISSUES="CPU alta (${CPU}%) "
  elif (( $(echo "$CPU > $WARN_CPU" | bc -l) )); then
    [ "$STATUS" = "ok" ] && STATUS="warning"; ISSUES="CPU alta (${CPU}%) "
  fi

  if (( $(echo "$RAM > $ERROR_RAM" | bc -l) )); then
    STATUS="error"; ISSUES="${ISSUES}RAM alta (${RAM}%) "
  elif (( $(echo "$RAM > $WARN_RAM" | bc -l) )); then
    [ "$STATUS" = "ok" ] && STATUS="warning"; ISSUES="${ISSUES}RAM alta (${RAM}%) "
  fi

  if [ "$IPSEC" = "OFFLINE" ]; then
    [ "$STATUS" = "ok" ] && STATUS="warning"
    ISSUES="${ISSUES}IPsec OFFLINE "
  fi

  ISSUES=$(echo "$ISSUES" | xargs)  # trim
  [ -z "$ISSUES" ] && ISSUES="Normal"

  MESSAGE="CPU: ${CPU}% | RAM: ${RAM}% | WAN: ${WAN} Mbps | IPsec: ${IPSEC}"

  # ---------- Payload JSON ----------
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

  # ---------- Enviar ----------
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$HEARTBEAT_URL" \
    -H "Content-Type: application/json" \
    -H "apikey: $ANON_KEY" \
    -H "Authorization: Bearer $ANON_KEY" \
    -H "X-Ingest-Secret: $INGEST_SECRET" \
    -d "$PAYLOAD")

  if [ "$HTTP_CODE" = "200" ]; then
    echo "$LINE_TS" > "$STATE_FILE"
    log "✓ $CLIENT_NAME → $STATUS | $MESSAGE"
  else
    log "✗ $CLIENT_NAME → HTTP $HTTP_CODE"
  fi
done
