#!/usr/bin/env bash
# =============================================================
# mk-syslog.sh — Receptor syslog UDP para eventos MikroTik
#
# Escucha en un puerto UDP, parsea mensajes de RouterOS y envía
# eventos de seguridad a Supabase:
#   - Check 2: login fallido (brute-force: > 10 en 1h = 1 alerta agrupada)
#   - Check 3: login exitoso desde IP no conocida
#
# INSTALACIÓN como servicio systemd:
#   sudo cp /srv/network-monitor/mk-syslog.sh /usr/local/bin/mk-syslog
#   sudo chmod +x /usr/local/bin/mk-syslog
#   sudo cp /srv/network-monitor/mk-syslog.service /etc/systemd/system/
#   sudo systemctl daemon-reload
#   sudo systemctl enable --now mk-syslog
#
# ACTUALIZAR:
#   curl -fsSL https://raw.githubusercontent.com/mathcenas/service-catalog/main/scripts/linux/mk-syslog.sh \
#     -o /srv/network-monitor/mk-syslog.sh && chmod +x /srv/network-monitor/mk-syslog.sh
#
# Requiere: socat, jq
#
# Version: 1.0.0
# =============================================================

SCRIPT_VERSION="1.0.0"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF_FILE="${1:-${SCRIPT_DIR}/mk-monitor.conf}"

if [[ ! -f "$CONF_FILE" ]]; then
  echo "ERROR: config no encontrada: $CONF_FILE" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "$CONF_FILE"

: "${SUPABASE_URL:?SUPABASE_URL no configurado}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-$ANON_KEY}"
: "${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY (o ANON_KEY) no configurado}"
: "${SITE_COUNT:?SITE_COUNT no configurado}"

LOG_DIR="${LOG_DIR:-${SCRIPT_DIR}/logs}"
STATE_DIR="${STATE_DIR:-${SCRIPT_DIR}/state}"
mkdir -p "$LOG_DIR" "$STATE_DIR"

LOG_FILE="${LOG_DIR}/mk-syslog-$(date '+%Y-%m').log"
EVENTS_URL="${SUPABASE_URL}/functions/v1/ingest-events"

# Puerto en el que escucha este script (debe coincidir con SYSLOG_PORT en setup.rsc)
LISTEN_PORT="${SYSLOG_PORT:-5140}"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "$LOG_FILE"; }

# ---------- Mapear IP de router → (SERVICE_ID, INGEST_SECRET, KNOWN_IPS) ----------
declare -A ROUTER_MAP_SID
declare -A ROUTER_MAP_SEC
declare -A ROUTER_MAP_KNOWN
declare -A ROUTER_MAP_NAME

for i in $(seq 1 "$SITE_COUNT"); do
  rip_var="SITE_${i}_ROUTER_IP";    rip="${!rip_var:-}"
  sid_var="SITE_${i}_SERVICE_ID";   sid="${!sid_var:-}"
  sec_var="SITE_${i}_INGEST_SECRET"; sec="${!sec_var:-}"
  knw_var="SITE_${i}_KNOWN_IPS";    knw="${!knw_var:-}"
  nm_var="SITE_${i}_NAME";          nm="${!nm_var:-}"
  [[ -z "$rip" || -z "$sid" ]] && continue
  ROUTER_MAP_SID["$rip"]="$sid"
  ROUTER_MAP_SEC["$rip"]="$sec"
  ROUTER_MAP_KNOWN["$rip"]="$knw"
  ROUTER_MAP_NAME["$rip"]="$nm"
done

# ---------- Helpers ----------

send_event() {
  local service_id="$1" ingest_secret="$2" event_type="$3" status="$4" message="$5" detail="$6"
  local payload
  payload=$(jq -n \
    --arg service_id "$service_id" \
    --arg event_type "$event_type" \
    --arg status     "$status" \
    --arg message    "$message" \
    --argjson detail "$detail" \
    --arg version    "$SCRIPT_VERSION" \
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
  curl -s -o /dev/null -w "%{http_code}" \
    --max-time 10 \
    -X POST "$EVENTS_URL" \
    -H "Content-Type: application/json" \
    -H "apikey: $SUPABASE_ANON_KEY" \
    -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
    -H "X-Ingest-Secret: $ingest_secret" \
    -d "$payload"
}

# Verifica si una IP está en una lista de IPs/CIDRs separadas por coma
ip_is_known() {
  local check_ip="$1" known_list="$2"
  [[ -z "$known_list" ]] && return 1

  IFS=',' read -ra entries <<< "$known_list"
  for entry in "${entries[@]}"; do
    entry=$(echo "$entry" | tr -d ' ')
    if [[ "$entry" == *"/"* ]]; then
      # CIDR — usar ipcalc si disponible, sino comparación simple de prefijo
      if command -v ipcalc >/dev/null 2>&1; then
        ipcalc -n -b "$check_ip/$( echo "$entry" | cut -d/ -f2)" 2>/dev/null | grep -q "$(ipcalc -n "$entry" 2>/dev/null | grep Network | awk '{print $2}')" && return 0
      else
        # Comparación de prefijo básica (funciona para /24 y similares)
        local prefix="${entry%.*}"
        [[ "$check_ip" == ${prefix}.* ]] && return 0
      fi
    else
      [[ "$check_ip" == "$entry" ]] && return 0
    fi
  done
  return 1
}

# ---------- Parser de línea syslog ----------
# RouterOS BSD syslog format:
#   <priority>timestamp hostname process: message
# Ejemplos:
#   <134>Oct  7 10:23:45 RegionalSur system,info,account user monitor logged in from 1.2.3.4 via rest
#   <134>Oct  7 10:24:01 RegionalSur system,error,account login failure for user admin from 2.3.4.5 via ssh

process_syslog_line() {
  local line="$1"
  local router_ip="$2"   # IP remota del paquete UDP

  local sid="${ROUTER_MAP_SID[$router_ip]:-}"
  local sec="${ROUTER_MAP_SEC[$router_ip]:-}"
  local known="${ROUTER_MAP_KNOWN[$router_ip]:-}"
  local site="${ROUTER_MAP_NAME[$router_ip]:-$router_ip}"

  [[ -z "$sid" ]] && return 0

  # ---- Login fallido ----
  if echo "$line" | grep -qiE "login failure|authentication failed|login failed"; then
    local src_ip=""
    src_ip=$(echo "$line" | grep -oP 'from \K[\d.]+' | head -1)
    [[ -z "$src_ip" ]] && return 0

    # Contador de fallos por IP en ventana de 1h
    local count_key="${site}_bruteforce_${src_ip//\./_}"
    local count_ts_key="${site}_bruteforce_${src_ip//\./_}_ts"
    local count ts_first
    count=$(cat "${STATE_DIR}/${count_key}" 2>/dev/null || echo "0")
    ts_first=$(cat "${STATE_DIR}/${count_ts_key}" 2>/dev/null || echo "0")
    local now
    now=$(date +%s)

    # Resetear contador si pasó más de 1h
    if [[ "$((now - ts_first))" -gt 3600 ]]; then
      count=0
      echo "$now" > "${STATE_DIR}/${count_ts_key}"
    fi

    count=$((count + 1))
    echo "$count" > "${STATE_DIR}/${count_key}"

    # Alertar solo al cruzar el umbral de 10, no en cada intento
    if [[ "$count" -eq 10 ]]; then
      local http
      http=$(send_event "$sid" "$sec" "login_bruteforce" "warning" \
        "[$site] Brute-force detectado: 10+ fallos desde ${src_ip} en 1h" \
        "{\"source_ip\":\"${src_ip}\",\"fail_count\":${count},\"site\":\"${site}\"}")
      log "🔴 [$site] brute-force ${src_ip} (${count} fallos) — HTTP $http"
    elif [[ "$count" -gt 10 && $(( count % 50 )) -eq 0 ]]; then
      # Re-alertar cada 50 intentos adicionales para no silenciar ataques largos
      local http
      http=$(send_event "$sid" "$sec" "login_bruteforce" "warning" \
        "[$site] Brute-force continuado: ${count} fallos desde ${src_ip}" \
        "{\"source_ip\":\"${src_ip}\",\"fail_count\":${count},\"site\":\"${site}\"}")
      log "🔴 [$site] brute-force ${src_ip} (${count} fallos) — HTTP $http"
    else
      log "⚠️  [$site] login fallido #${count} desde ${src_ip}"
    fi
    return 0
  fi

  # ---- Login exitoso ----
  if echo "$line" | grep -qiE "logged in|logged out" ; then
    # Solo nos interesa "logged in"
    echo "$line" | grep -qiE "logged in" || return 0

    local src_ip="" via="" username=""
    src_ip=$(echo "$line"  | grep -oP 'from \K[\d.]+' | head -1)
    via=$(echo "$line"     | grep -oP 'via \K\S+'     | head -1)
    username=$(echo "$line" | grep -oP 'user \K\S+'   | head -1)

    [[ -z "$src_ip" ]] && return 0

    if ip_is_known "$src_ip" "$known"; then
      log "✓ [$site] login ${username} desde ${src_ip} (conocida) via ${via}"
      return 0
    fi

    # IP desconocida — siempre alertar
    local http
    http=$(send_event "$sid" "$sec" "login_unknown_ip" "error" \
      "[$site] Login desde IP desconocida: ${src_ip} (user: ${username}, via: ${via})" \
      "{\"source_ip\":\"${src_ip}\",\"username\":\"${username}\",\"via\":\"${via}\",\"site\":\"${site}\"}")
    log "🔴 [$site] LOGIN DESCONOCIDO ${username}@${src_ip} via ${via} — HTTP $http"
    return 0
  fi
}

# ---------- Main loop ----------

if ! command -v socat >/dev/null 2>&1; then
  echo "ERROR: socat no encontrado. Instalá con: apt install socat" >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq no encontrado. Instalá con: apt install jq" >&2
  exit 1
fi

log "mk-syslog v${SCRIPT_VERSION} iniciado — escuchando UDP :${LISTEN_PORT}"

# socat escucha UDP y pasa cada datagrama a stdin en un fork
# FORK permite múltiples paquetes simultáneos
socat UDP-RECVFROM:"${LISTEN_PORT}",fork EXEC:"bash -c 'read -r line; echo \"\$SOCAT_PEERADDR \$line\"'" 2>/dev/null \
| while IFS= read -r full_line; do
    # Primer campo = IP remota del paquete UDP (inyectada por socat)
    router_src_ip=$(echo "$full_line" | awk '{print $1}')
    syslog_msg="${full_line#* }"
    log "SYSLOG [$router_src_ip] $syslog_msg"
    process_syslog_line "$syslog_msg" "$router_src_ip"
  done
