#!/usr/bin/env bash
# =============================================================
# mk-monitor.sh — Chequeos activos MikroTik (Fase 1)
#
# Checks por sitio cada 5 min:
#   1. Ping desde el router al RDP target (/rest/tool/ping)
#   4. Recursos del sistema (/rest/system/resource) — CPU, RAM, uptime
#   5. Sesiones activas (/rest/user/active) — detecta fuga de sesiones REST
#
# Alerta cuando cambia el estado; avisa cuando recupera.
# Estado persistido en archivos locales (STATE_DIR).
#
# CRON (crontab -e):
#   */5 * * * * /srv/network-monitor/mk-monitor.sh >> /srv/network-monitor/logs/mk-monitor.log 2>&1
#
# ACTUALIZAR:
#   curl -fsSL https://raw.githubusercontent.com/mathcenas/service-catalog/main/scripts/linux/mk-monitor.sh \
#     -o /srv/network-monitor/mk-monitor.sh && chmod +x /srv/network-monitor/mk-monitor.sh
#
# Version: 1.0.0
# =============================================================
set -euo pipefail

SCRIPT_VERSION="1.0.0"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF_FILE="${1:-${SCRIPT_DIR}/mk-monitor.conf}"

if [[ ! -f "$CONF_FILE" ]]; then
  echo "ERROR: config no encontrada: $CONF_FILE" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "$CONF_FILE"

: "${SUPABASE_URL:?mk-monitor: SUPABASE_URL no configurado}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-$ANON_KEY}"
: "${SUPABASE_ANON_KEY:?mk-monitor: SUPABASE_ANON_KEY (o ANON_KEY) no configurado}"
: "${SITE_COUNT:?mk-monitor: SITE_COUNT no configurado}"

LOG_DIR="${LOG_DIR:-${SCRIPT_DIR}/logs}"
STATE_DIR="${STATE_DIR:-${SCRIPT_DIR}/state}"
mkdir -p "$LOG_DIR" "$STATE_DIR"

LOG_FILE="${LOG_DIR}/mk-monitor-$(date '+%Y-%m').log"
EVENTS_URL="${SUPABASE_URL}/functions/v1/ingest-events"

# Rotar log si pasa 5MB
if [[ -f "$LOG_FILE" && "$(stat -c%s "$LOG_FILE" 2>/dev/null || echo 0)" -gt 5242880 ]]; then
  mv "$LOG_FILE" "${LOG_FILE%.log}-$(date '+%Y%m%d%H%M').log"
fi

log()  { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "$LOG_FILE"; }
warn() { log "WARN $*"; }

# ---------- Helpers ----------

# Lee estado previo de un check: "ok" | "alert" | ""
read_state() {
  local file="${STATE_DIR}/${1}.state"
  cat "$file" 2>/dev/null || echo ""
}

# Guarda estado de un check
write_state() {
  echo "$2" > "${STATE_DIR}/${1}.state"
}

# Guarda contador (para brute-force, etc.)
read_count() { cat "${STATE_DIR}/${1}.count" 2>/dev/null || echo "0"; }
write_count() { echo "$2" > "${STATE_DIR}/${1}.count"; }

# Llama REST API del router con autenticación básica
# Retorna el body o "" en caso de error; exit code != 0 si HTTP != 200
router_rest() {
  local ip="$1" user="$2" pass="$3" path="$4"
  curl -ks --max-time 10 \
    -u "${user}:${pass}" \
    "https://${ip}/rest${path}" 2>/dev/null
}

router_rest_post() {
  local ip="$1" user="$2" pass="$3" path="$4" data="$5"
  curl -ks --max-time 15 \
    -X POST \
    -H "Content-Type: application/json" \
    -u "${user}:${pass}" \
    -d "$data" \
    "https://${ip}/rest${path}" 2>/dev/null
}

# Envía un evento a Supabase via ingest-events
send_event() {
  local service_id="$1" ingest_secret="$2" event_type="$3" status="$4" message="$5" detail="$6"
  local payload
  payload=$(jq -n \
    --arg service_id  "$service_id" \
    --arg event_type  "$event_type" \
    --arg status      "$status" \
    --arg message     "$message" \
    --argjson detail  "$detail" \
    --arg version     "$SCRIPT_VERSION" \
    '{
      service_id: $service_id,
      events: [{
        event_type: $event_type,
        status:     $status,
        message:    $message,
        timestamp:  (now | todate),
        detail:     ($detail + {script_version: $version})
      }]
    }')

  local http_code
  http_code=$(curl -s -o /dev/null -w "%{http_code}" \
    --max-time 15 \
    -X POST "$EVENTS_URL" \
    -H "Content-Type: application/json" \
    -H "apikey: $SUPABASE_ANON_KEY" \
    -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
    -H "X-Ingest-Secret: $ingest_secret" \
    -d "$payload")
  echo "$http_code"
}

# ---------- Checks ----------

check_rdp_ping() {
  local site="$1" service_id="$2" secret="$3"
  local router_ip="$4" router_user="$5" router_pass="$6" rdp_target="$7"
  local state_key="${site}_rdp"

  [[ -z "$rdp_target" ]] && return 0

  local resp
  resp=$(router_rest_post "$router_ip" "$router_user" "$router_pass" \
    "/tool/ping" \
    "{\"address\":\"${rdp_target}\",\"count\":\"3\"}" 2>/dev/null || echo "")

  # RouterOS devuelve array; si hay "received":0 en todos los paquetes → falla
  local received=0
  if [[ -n "$resp" ]]; then
    received=$(echo "$resp" | jq '[.[].received // 0] | add // 0' 2>/dev/null || echo "0")
  fi

  local prev_state
  prev_state=$(read_state "$state_key")

  if [[ "$received" -eq 0 ]] || [[ -z "$resp" ]]; then
    # Sin respuesta
    if [[ "$prev_state" != "alert" ]]; then
      write_state "$state_key" "alert"
      local http
      http=$(send_event "$service_id" "$secret" "rdp_unreachable" "error" \
        "[$site] RDP ${rdp_target} no alcanzable desde el router" \
        "{\"rdp_target\":\"${rdp_target}\",\"router_ip\":\"${router_ip}\"}")
      log "🔴 [$site] RDP ${rdp_target} CAÍDO — evento enviado (HTTP $http)"
    else
      log "⚠️  [$site] RDP ${rdp_target} sigue caído (ya alertado)"
    fi
  else
    # Responde
    if [[ "$prev_state" == "alert" ]]; then
      write_state "$state_key" "ok"
      local http
      http=$(send_event "$service_id" "$secret" "rdp_recovered" "ok" \
        "[$site] RDP ${rdp_target} recuperado (${received}/3 paquetes)" \
        "{\"rdp_target\":\"${rdp_target}\",\"received\":${received}}")
      log "✅ [$site] RDP ${rdp_target} RECUPERADO — evento enviado (HTTP $http)"
    else
      write_state "$state_key" "ok"
      log "✓ [$site] RDP ${rdp_target} OK (${received}/3)"
    fi
  fi
}

check_system_resource() {
  local site="$1" service_id="$2" secret="$3"
  local router_ip="$4" router_user="$5" router_pass="$6"

  local resp
  resp=$(router_rest "$router_ip" "$router_user" "$router_pass" "/system/resource" 2>/dev/null || echo "")

  if [[ -z "$resp" ]] || ! echo "$resp" | jq -e '.uptime' >/dev/null 2>&1; then
    log "⚠️  [$site] /system/resource no responde — router fuera de línea?"
    return 0
  fi

  local uptime cpu_load free_mem total_mem bad_blocks write_sect_since_reboot
  uptime=$(echo "$resp" | jq -r '.uptime // ""')
  cpu_load=$(echo "$resp" | jq -r '."cpu-load" // 0')
  free_mem=$(echo "$resp" | jq -r '."free-memory" // 0')
  total_mem=$(echo "$resp" | jq -r '."total-memory" // 1')
  bad_blocks=$(echo "$resp" | jq -r '."bad-blocks" // 0')
  write_sect_since_reboot=$(echo "$resp" | jq -r '."write-sect-since-reboot" // 0')

  local ram_pct
  ram_pct=$(awk -v f="$free_mem" -v t="$total_mem" 'BEGIN { printf "%.0f", (1 - f/t) * 100 }')

  # Detección de reinicio: uptime muy corto (< 10 min = 600s)
  # RouterOS uptime: "1d2h3m4s" → convertir a segundos
  local uptime_secs=0
  uptime_secs=$(echo "$uptime" | awk '{
    s=$0
    d=0; h=0; m=0; sec=0
    match(s,/([0-9]+)d/,a); if (RSTART) d=a[1]
    match(s,/([0-9]+)h/,a); if (RSTART) h=a[1]
    match(s,/([0-9]+)m/,a); if (RSTART) m=a[1]
    match(s,/([0-9]+)s/,a); if (RSTART) sec=a[1]
    print d*86400 + h*3600 + m*60 + sec
  }')

  local reboot_state_key="${site}_reboot"
  local prev_reboot_state
  prev_reboot_state=$(read_state "$reboot_state_key")
  local prev_uptime
  prev_uptime=$(read_count "${site}_uptime_secs")

  # Si el uptime disminuyó respecto al check anterior → reinicio detectado
  if [[ "$uptime_secs" -gt 0 && "$prev_uptime" -gt 0 && "$uptime_secs" -lt "$prev_uptime" ]]; then
    if [[ "$prev_reboot_state" != "alert" ]]; then
      write_state "$reboot_state_key" "alert"
      local http
      http=$(send_event "$service_id" "$secret" "router_reboot" "warning" \
        "[$site] Router reiniciado (uptime: ${uptime})" \
        "{\"uptime\":\"${uptime}\",\"uptime_secs\":${uptime_secs}}")
      log "🔄 [$site] REINICIO detectado (uptime ${uptime}) — HTTP $http"
    fi
  else
    write_state "$reboot_state_key" "ok"
  fi
  write_count "${site}_uptime_secs" "$uptime_secs"

  # CPU alta sostenida (> 80% — se acumula en contador de checks consecutivos)
  local cpu_state_key="${site}_cpu_high"
  local cpu_count
  cpu_count=$(read_count "$cpu_state_key")
  if [[ "$cpu_load" -ge 80 ]]; then
    cpu_count=$((cpu_count + 1))
    write_count "$cpu_state_key" "$cpu_count"
    # 3 checks consecutivos × 5 min = 15 min sostenidos
    if [[ "$cpu_count" -ge 3 && "$(read_state "${site}_cpu")" != "alert" ]]; then
      write_state "${site}_cpu" "alert"
      local http
      http=$(send_event "$service_id" "$secret" "cpu_high" "warning" \
        "[$site] CPU alta ${cpu_load}% por más de 15 min" \
        "{\"cpu_pct\":${cpu_load},\"ram_pct\":${ram_pct},\"uptime\":\"${uptime}\"}")
      log "🔴 [$site] CPU ${cpu_load}% sostenida — HTTP $http"
    else
      log "⚠️  [$site] CPU ${cpu_load}% (check ${cpu_count}/3)"
    fi
  else
    if [[ "$(read_state "${site}_cpu")" == "alert" ]]; then
      write_state "${site}_cpu" "ok"
      local http
      http=$(send_event "$service_id" "$secret" "cpu_recovered" "ok" \
        "[$site] CPU normalizada (${cpu_load}%)" \
        "{\"cpu_pct\":${cpu_load}}")
      log "✅ [$site] CPU normalizada — HTTP $http"
    fi
    write_count "$cpu_state_key" "0"
    write_state "${site}_cpu" "ok"
    log "✓ [$site] recursos OK | CPU: ${cpu_load}% | RAM: ${ram_pct}% | Up: ${uptime}"
  fi
}

check_active_sessions() {
  local site="$1" service_id="$2" secret="$3"
  local router_ip="$4" router_user="$5" router_pass="$6"

  local resp
  resp=$(router_rest "$router_ip" "$router_user" "$router_pass" "/user/active" 2>/dev/null || echo "")

  [[ -z "$resp" ]] && return 0

  local count
  count=$(echo "$resp" | jq 'length' 2>/dev/null || echo "0")

  local state_key="${site}_sessions"
  if [[ "$count" -gt 50 ]]; then
    if [[ "$(read_state "$state_key")" != "alert" ]]; then
      write_state "$state_key" "alert"
      local http
      http=$(send_event "$service_id" "$secret" "sessions_high" "warning" \
        "[$site] Sesiones activas inusualmente altas: ${count}" \
        "{\"session_count\":${count}}")
      log "🔴 [$site] ${count} sesiones activas — HTTP $http"
    else
      log "⚠️  [$site] ${count} sesiones activas (ya alertado)"
    fi
  else
    write_state "$state_key" "ok"
    log "✓ [$site] sesiones: ${count}"
  fi
}

# ---------- Loop por sitio ----------

for i in $(seq 1 "$SITE_COUNT"); do
  SITE_NAME_VAR="SITE_${i}_NAME";           SITE_NAME="${!SITE_NAME_VAR:-}"
  SITE_SID_VAR="SITE_${i}_SERVICE_ID";      SITE_SID="${!SITE_SID_VAR:-}"
  SITE_SEC_VAR="SITE_${i}_INGEST_SECRET";   SITE_SEC="${!SITE_SEC_VAR:-}"
  SITE_RIP_VAR="SITE_${i}_ROUTER_IP";       SITE_RIP="${!SITE_RIP_VAR:-}"
  SITE_RU_VAR="SITE_${i}_ROUTER_USER";      SITE_RU="${!SITE_RU_VAR:-monitor}"
  SITE_RP_VAR="SITE_${i}_ROUTER_PASS";      SITE_RP="${!SITE_RP_VAR:-}"
  SITE_RDP_VAR="SITE_${i}_RDP_TARGET";      SITE_RDP="${!SITE_RDP_VAR:-}"

  if [[ -z "$SITE_NAME" || -z "$SITE_SID" || -z "$SITE_SEC" || -z "$SITE_RIP" || -z "$SITE_RP" ]]; then
    warn "SKIP SITE_${i} — configuración incompleta"
    continue
  fi

  log "--- [$SITE_NAME] iniciando checks ---"
  check_rdp_ping         "$SITE_NAME" "$SITE_SID" "$SITE_SEC" "$SITE_RIP" "$SITE_RU" "$SITE_RP" "$SITE_RDP"
  check_system_resource  "$SITE_NAME" "$SITE_SID" "$SITE_SEC" "$SITE_RIP" "$SITE_RU" "$SITE_RP"
  check_active_sessions  "$SITE_NAME" "$SITE_SID" "$SITE_SEC" "$SITE_RIP" "$SITE_RU" "$SITE_RP"
done
