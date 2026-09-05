#!/bin/bash
# =============================================================
# system-health.sh — Métricas de hardware de VPS Linux
#
# ACTUALIZAR (Linux/NAS):
#   curl -fsSL https://raw.githubusercontent.com/mathcenas/service-catalog/main/scripts/linux/system-health.sh \
#     -o /usr/local/bin/system-health.sh && chmod +x /usr/local/bin/system-health.sh
# Version: 1.0.0
# al Service Catalog como heartbeat (source: system-health)
# Correr cada hora via cron:
#   0 * * * * /srv/scripts/system-health.sh
# =============================================================

SCRIPT_VERSION="1.3.0"

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

# ---------- Discos adicionales ----------
# DISK_MOUNTS="/data /backup /srv"  (espacio-separado en .env, opcional)
DISK_MOUNTS_JSON="[]"
if [[ -n "${DISK_MOUNTS:-}" ]]; then
  DISK_MOUNTS_JSON="["
  first_mount=1
  for mnt in $DISK_MOUNTS; do
    [[ ! -d "$mnt" ]] && continue
    mnt_info=$(df -B1 "$mnt" 2>/dev/null | awk 'NR==2 {print $2, $4, $5}')
    [[ -z "$mnt_info" ]] && continue
    mnt_total=$(echo "$mnt_info" | awk '{print $1}')
    mnt_free=$(echo "$mnt_info" | awk '{print $2}')
    mnt_pct=$(echo "$mnt_info" | awk '{print $3}' | tr -d '%')
    mnt_free_gb=$(awk -v f="$mnt_free" 'BEGIN { printf "%.1f", f / 1073741824 }')
    mnt_total_gb=$(awk -v t="$mnt_total" 'BEGIN { printf "%.1f", t / 1073741824 }')
    [[ $first_mount -eq 0 ]] && DISK_MOUNTS_JSON+=","
    DISK_MOUNTS_JSON+="{\"mount\":\"${mnt}\",\"pct\":${mnt_pct},\"free_gb\":${mnt_free_gb},\"total_gb\":${mnt_total_gb}}"
    first_mount=0
    # Alerta si algún mount adicional está lleno
    if [ "${mnt_pct:-0}" -ge 90 ]; then
      STATUS="failed"; ISSUES="${ISSUES}Disco ${mnt} lleno (${mnt_pct}%) "
    elif [ "${mnt_pct:-0}" -ge 75 ]; then
      [ "$STATUS" = "success" ] && STATUS="warning"
      ISSUES="${ISSUES}Disco ${mnt} alto (${mnt_pct}%) "
    fi
  done
  DISK_MOUNTS_JSON+="]"
fi

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

# ---------- Samba sessions ----------
SMB_SESSIONS_JSON="[]"
SMB_SESSION_COUNT=0
if command -v smbstatus >/dev/null 2>&1; then
  # smbstatus -b: brief, one line per session: PID  username  group  machine  proto
  SMB_RAW=$(smbstatus -b 2>/dev/null | awk 'NR>2 && /[0-9]/ {print $2, $4}' || true)
  if [[ -n "$SMB_RAW" ]]; then
    SMB_SESSION_COUNT=$(echo "$SMB_RAW" | wc -l | tr -d ' ')
    SMB_SESSIONS_JSON="["
    first=1
    while IFS= read -r line; do
      user=$(echo "$line" | awk '{print $1}')
      machine=$(echo "$line" | awk '{print $2}')
      [[ $first -eq 0 ]] && SMB_SESSIONS_JSON+=","
      SMB_SESSIONS_JSON+="{\"user\":\"${user}\",\"machine\":\"${machine}\"}"
      first=0
    done <<< "$SMB_RAW"
    SMB_SESSIONS_JSON+="]"
  fi
fi

# ---------- Docker containers ----------
DOCKER_JSON="[]"
DOCKER_DOWN=""
if command -v docker >/dev/null 2>&1; then
  DOCKER_JSON="["
  first_doc=1
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    cname=$(echo "$line" | awk -F'|' '{print $1}')
    cstate=$(echo "$line" | awk -F'|' '{print $2}')
    cstatus=$(echo "$line" | awk -F'|' '{print $3}')
    [[ $first_doc -eq 0 ]] && DOCKER_JSON+=","
    DOCKER_JSON+="{\"name\":\"${cname}\",\"state\":\"${cstate}\",\"status\":\"${cstatus}\"}"
    first_doc=0
    if [[ "$cstate" != "running" ]]; then
      DOCKER_DOWN="${DOCKER_DOWN}${cname}(${cstate}) "
    fi
  done < <(docker ps -a --format '{{.Names}}|{{.State}}|{{.Status}}' 2>/dev/null || true)
  DOCKER_JSON+="]"
  if [[ -n "$DOCKER_DOWN" ]]; then
    [ "$STATUS" = "success" ] && STATUS="warning"
    ISSUES="${ISSUES}Containers caídos: ${DOCKER_DOWN}"
  fi
fi

# ---------- Port checks ----------
# Formato en .env: PORT_1_NAME="Web", PORT_1_HOST="localhost", PORT_1_PORT=80
# (sin INGEST_SECRET — van incluidos en el payload principal de system-health)
PORT_CHECKS_JSON="[]"
for i in $(seq 1 20); do
  pname_var="PORT_${i}_NAME";  pname="${!pname_var:-}"
  [[ -z "$pname" ]] && break
  phost_var="PORT_${i}_HOST";  phost="${!phost_var:-localhost}"
  pport_var="PORT_${i}_PORT";  pport="${!pport_var:-}"
  [[ -z "$pport" ]] && continue
  pt0=$(date +%s%3N)
  nc -z -w3 "$phost" "$pport" >/dev/null 2>&1; prc=$?
  pt1=$(date +%s%3N)
  platency=$((pt1 - pt0))
  pok=$([[ "$prc" == "0" ]] && echo "true" || echo "false")
  [[ "$PORT_CHECKS_JSON" == "[]" ]] && PORT_CHECKS_JSON="["
  [[ "$PORT_CHECKS_JSON" != "[" ]] && PORT_CHECKS_JSON+=","
  PORT_CHECKS_JSON+="{\"name\":\"${pname}\",\"host\":\"${phost}\",\"port\":${pport},\"ok\":${pok},\"latency_ms\":${platency}}"
  if [[ "$prc" != "0" ]]; then
    [ "$STATUS" = "success" ] && STATUS="warning"
    ISSUES="${ISSUES}Puerto ${pname}:${pport} cerrado "
  fi
done
[[ "$PORT_CHECKS_JSON" != "[]" && "$PORT_CHECKS_JSON" != "[" ]] && PORT_CHECKS_JSON+="]"

# ---------- DB checks ----------
# Formato en .env: DB_1_INGEST_SECRET, DB_1_NAME, DB_1_HOST, DB_1_PORT, DB_1_TYPE
# Tipos soportados: PostgreSQL, MySQL, MariaDB, Redis, MongoDB, MSSQL, (cualquier otro → nc)
check_db() {
  local host="$1" port="$2" engine="$3"
  local t0 t1
  t0=$(date +%s%3N)
  case "${engine,,}" in
    postgresql|postgres)
      if command -v pg_isready >/dev/null 2>&1; then
        pg_isready -h "$host" -p "$port" -t 3 >/dev/null 2>&1; local rc=$?
      else
        nc -z -w3 "$host" "$port" >/dev/null 2>&1; local rc=$?
      fi ;;
    mysql|mariadb)
      if command -v mysqladmin >/dev/null 2>&1; then
        mysqladmin ping -h "$host" -P "$port" --connect-timeout=3 >/dev/null 2>&1; local rc=$?
      else
        nc -z -w3 "$host" "$port" >/dev/null 2>&1; local rc=$?
      fi ;;
    redis)
      if command -v redis-cli >/dev/null 2>&1; then
        redis-cli -h "$host" -p "$port" --no-auth-warning PING >/dev/null 2>&1; local rc=$?
      else
        nc -z -w3 "$host" "$port" >/dev/null 2>&1; local rc=$?
      fi ;;
    *)
      nc -z -w3 "$host" "$port" >/dev/null 2>&1; local rc=$? ;;
  esac
  t1=$(date +%s%3N)
  echo "$rc $((t1 - t0))"
}

for i in $(seq 1 10); do
  db_secret_var="DB_${i}_INGEST_SECRET"
  db_secret="${!db_secret_var:-}"
  [[ -z "$db_secret" ]] && break

  db_service_id_var="DB_${i}_SERVICE_ID"
  db_service_id="${!db_service_id_var:-}"
  [[ -z "$db_service_id" ]] && { log "✗ db-check [DB $i] → falta DB_${i}_SERVICE_ID"; continue; }

  db_name_var="DB_${i}_NAME";  db_name="${!db_name_var:-DB $i}"
  db_host_var="DB_${i}_HOST";  db_host="${!db_host_var:-localhost}"
  db_port_var="DB_${i}_PORT";  db_port="${!db_port_var:-5432}"
  db_type_var="DB_${i}_TYPE";  db_type="${!db_type_var:-PostgreSQL}"

  result=$(check_db "$db_host" "$db_port" "$db_type")
  db_rc=$(echo "$result" | awk '{print $1}')
  db_latency=$(echo "$result" | awk '{print $2}')

  if [[ "$db_rc" == "0" ]]; then
    db_status="ok"
    db_message="Conectividad OK | ${db_name} (${db_host}:${db_port}) | ${db_latency}ms"
  else
    db_status="error"
    db_message="Sin conexión | ${db_name} (${db_host}:${db_port})"
  fi

  DB_PAYLOAD=$(cat <<DBEOF
{
  "service_id": "$db_service_id",
  "source": "db-check",
  "status": "$db_status",
  "message": "$db_message",
  "payload": {
    "db_name": "$db_name",
    "db_host": "$db_host",
    "db_port": $db_port,
    "db_type": "$db_type",
    "latency_ms": $db_latency,
    "script_version": "$SCRIPT_VERSION"
  }
}
DBEOF
)

  DB_HTTP=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$HEARTBEAT_URL" \
    -H "Content-Type: application/json" \
    -H "apikey: $SUPABASE_ANON_KEY" \
    -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
    -H "X-Ingest-Secret: $db_secret" \
    -d "$DB_PAYLOAD")

  if [[ "$DB_HTTP" == "200" || "$DB_HTTP" == "201" ]]; then
    log "✓ db-check [${db_name}] → $db_status | $db_message"
  else
    log "✗ db-check [${db_name}] → HTTP $DB_HTTP"
  fi
done

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
    "issues": "$ISSUES",
    "smb_session_count": $SMB_SESSION_COUNT,
    "smb_sessions": $SMB_SESSIONS_JSON,
    "disk_mounts": $DISK_MOUNTS_JSON,
    "docker_containers": $DOCKER_JSON,
    "port_checks": $PORT_CHECKS_JSON,
    "script_version": "$SCRIPT_VERSION"
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
