#!/bin/bash
# =============================================================
# system-health.sh — Métricas de hardware de VPS Linux
#
# ACTUALIZAR (Linux/NAS):
#   curl -fsSL https://raw.githubusercontent.com/mathcenas/service-catalog/main/scripts/linux/system-health.sh \
#     -o /srv/scripts/system-health.sh && chmod +x /srv/scripts/system-health.sh
# Version: 1.6.0
# al Service Catalog como heartbeat (source: system-health)
# Correr cada hora via cron:
#   0 * * * * /srv/scripts/system-health.sh
# =============================================================

SCRIPT_VERSION="1.6.0"

# ---------- Verificación de dependencias ----------
if ! command -v jq >/dev/null 2>&1; then
  echo "jq no encontrado — instalando..." >&2
  if command -v apt-get >/dev/null 2>&1; then
    apt-get install -y -qq jq >/dev/null 2>&1
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y -q jq >/dev/null 2>&1
  elif command -v yum >/dev/null 2>&1; then
    yum install -y -q jq >/dev/null 2>&1
  fi
  if ! command -v jq >/dev/null 2>&1; then
    echo "ERROR: no se pudo instalar jq automáticamente. Ejecuta 'apt install jq' manualmente." >&2
    exit 1
  fi
  echo "jq instalado correctamente." >&2
fi

# ---------- Cargar .env ----------
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
LOG_FILE="${LOG_FILE:-${SCRIPT_DIR}/system-health.log}"
LOG_RETAIN_DAYS=90
DOCKER_IGNORE="${DOCKER_IGNORE:-}"

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

# Crear carpeta de logs si no existe
LOG_DIR="$(dirname "$LOG_FILE")"
mkdir -p "$LOG_DIR" 2>/dev/null || true

# Rotar diariamente: renombrar system-health.log → system-health-YYYY-MM-DD.log al primer run del día
LOG_DATE_FILE="${LOG_FILE%.log}-$(date '+%Y-%m-%d').log"
if [ -f "$LOG_FILE" ] && [ ! -f "$LOG_DATE_FILE" ] && [ -s "$LOG_FILE" ]; then
  mv "$LOG_FILE" "$LOG_DATE_FILE"
fi

# Borrar logs con más de 90 días
find "$LOG_DIR" -maxdepth 1 -name "system-health-????-??-??.log" -mtime +"$LOG_RETAIN_DAYS" -delete 2>/dev/null || true

# Forzar locale C para que los decimales usen punto
export LC_ALL=C LANG=C

# ---------- CPU ----------
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
DISK_MOUNTS_JSON="[]"
if [[ -n "${DISK_MOUNTS:-}" ]]; then
  mounts_arr=()
  for mnt in $DISK_MOUNTS; do
    [[ ! -d "$mnt" ]] && continue
    mnt_info=$(df -B1 "$mnt" 2>/dev/null | awk 'NR==2 {print $2, $4, $5}')
    [[ -z "$mnt_info" ]] && continue
    mnt_total=$(echo "$mnt_info" | awk '{print $1}')
    mnt_free=$(echo "$mnt_info" | awk '{print $2}')
    mnt_pct=$(echo "$mnt_info" | awk '{print $3}' | tr -d '%')
    mnt_free_gb=$(awk -v f="$mnt_free" 'BEGIN { printf "%.1f", f / 1073741824 }')
    mnt_total_gb=$(awk -v t="$mnt_total" 'BEGIN { printf "%.1f", t / 1073741824 }')

    item=$(jq -n --arg mnt "$mnt" \
                 --argjson pct "${mnt_pct:-0}" \
                 --argjson free "$mnt_free_gb" \
                 --argjson total "$mnt_total_gb" \
                 '{mount: $mnt, pct: $pct, free_gb: $free, total_gb: $total}')
    mounts_arr+=("$item")

    if [ "${mnt_pct:-0}" -ge 90 ]; then
      STATUS="failed"; ISSUES="${ISSUES}Disco ${mnt} lleno (${mnt_pct}%) "
    elif [ "${mnt_pct:-0}" -ge 75 ]; then
      [ "$STATUS" = "success" ] && STATUS="warning"
      ISSUES="${ISSUES}Disco ${mnt} alto (${mnt_pct}%) "
    fi
  done
  if [ ${#mounts_arr[@]} -gt 0 ]; then
    DISK_MOUNTS_JSON=$(printf '%s\n' "${mounts_arr[@]}" | jq -s '.')
  fi
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
  SMB_RAW=$(smbstatus -b 2>/dev/null | awk 'NR>2 && /[0-9]/ {print $2, $4}' || true)
  if [[ -n "$SMB_RAW" ]]; then
    smb_arr=()
    while IFS= read -r line; do
      user=$(echo "$line" | awk '{print $1}')
      machine=$(echo "$line" | awk '{print $2}')
      item=$(jq -n --arg user "$user" --arg machine "$machine" '{user: $user, machine: $machine}')
      smb_arr+=("$item")
    done <<< "$SMB_RAW"
    SMB_SESSION_COUNT=${#smb_arr[@]}
    SMB_SESSIONS_JSON=$(printf '%s\n' "${smb_arr[@]}" | jq -s '.')
  fi
fi

# ---------- Docker containers ----------
DOCKER_JSON="[]"
DOCKER_DOWN=""
if command -v docker >/dev/null 2>&1; then
  doc_arr=()
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    cname=$(echo "$line" | awk -F'|' '{print $1}')
    cstate=$(echo "$line" | awk -F'|' '{print $2}')
    cstatus=$(echo "$line" | awk -F'|' '{print $3}')

    # Ignorar containers en DOCKER_IGNORE (lista separada por comas)
    if [[ -n "$DOCKER_IGNORE" && ",$DOCKER_IGNORE," =~ ,"$cname", ]]; then
      continue
    fi

    item=$(jq -n --arg name "$cname" --arg state "$cstate" --arg status "$cstatus" \
           '{name: $name, state: $state, status: $status}')
    doc_arr+=("$item")
    if [[ "$cstate" != "running" ]]; then
      DOCKER_DOWN="${DOCKER_DOWN}${cname}(${cstate}) "
    fi
  done < <(docker ps -a --format '{{.Names}}|{{.State}}|{{.Status}}' 2>/dev/null || true)
  if [ ${#doc_arr[@]} -gt 0 ]; then
    DOCKER_JSON=$(printf '%s\n' "${doc_arr[@]}" | jq -s '.')
  fi
  if [[ -n "$DOCKER_DOWN" ]]; then
    [ "$STATUS" = "success" ] && STATUS="warning"
    ISSUES="${ISSUES}Containers caídos: ${DOCKER_DOWN}"
  fi
fi

# ---------- Port checks ----------
PORT_CHECKS_JSON="[]"
port_arr=()
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
  pok=$([[ "$prc" == "0" ]] && echo true || echo false)

  item=$(jq -n --arg name "$pname" \
               --arg host "$phost" \
               --argjson port "$pport" \
               --argjson ok "$pok" \
               --argjson latency "$platency" \
               '{name: $name, host: $host, port: $port, ok: $ok, latency_ms: $latency}')
  port_arr+=("$item")

  if [[ "$prc" != "0" ]]; then
    [ "$STATUS" = "success" ] && STATUS="warning"
    ISSUES="${ISSUES}Puerto ${pname}:${pport} cerrado "
  fi
done
if [ ${#port_arr[@]} -gt 0 ]; then
  PORT_CHECKS_JSON=$(printf '%s\n' "${port_arr[@]}" | jq -s '.')
fi

# ---------- Disk SMART health ----------
DISK_SMART_JSON="[]"
if command -v smartctl >/dev/null 2>&1; then
  SMART_DISKS=()
  for d in /dev/sd{a..z} /dev/nvme{0..9}; do
    [[ -b "$d" ]] && SMART_DISKS+=("$d")
  done

  smart_arr=()
  for dev in "${SMART_DISKS[@]}"; do
    smart_health=$(smartctl -H "$dev" 2>/dev/null | grep -i "overall-health\|SMART overall\|result:" | awk -F': ' '{print $2}' | tr -d '[:space:]')
    [[ -z "$smart_health" ]] && smart_health="UNKNOWN"

    smart_info=$(smartctl -i "$dev" 2>/dev/null)
    dev_model=$(echo "$smart_info" | grep -i "Device Model\|Model Number\|Model Family" | head -1 | awk -F': ' '{gsub(/^[ \t]+/,"",$2); print $2}')
    dev_serial=$(echo "$smart_info" | grep -i "Serial Number\|Serial number" | head -1 | awk -F': ' '{gsub(/^[ \t]+/,"",$2); print $2}')
    dev_capacity=$(echo "$smart_info" | grep -i "User Capacity\|Namespace 1 Size" | head -1 | awk -F':' '{gsub(/^[ \t]+/,"",$2); gsub(/\[.*\]/,""); print $2}' | xargs)
    dev_rpm=$(echo "$smart_info" | grep -i "Rotation Rate" | head -1 | awk -F': ' '{gsub(/^[ \t]+/,"",$2); print $2}')
    [[ "$dev_rpm" =~ [Ss]olid[[:space:]][Ss]tate|[Ss][Ss][Dd]|"Solid State Drive" ]] && dev_type="SSD" || { [[ "$dev" == /dev/nvme* ]] && dev_type="NVMe" || dev_type="HDD"; }
    [[ "$dev" == /dev/nvme* ]] && dev_type="NVMe"

    smart_attrs=$(smartctl -A "$dev" 2>/dev/null)

    temp_c=$(echo "$smart_attrs" | awk '/Temperature_Celsius|Airflow_Temperature|Temperature/ {for(i=1;i<=NF;i++) if($i~/^[0-9]+$/ && $i<100 && $i>0) {print $i; exit}}')
    if [[ -z "$temp_c" ]]; then
      temp_c=$(smartctl -A "$dev" 2>/dev/null | grep -i "Temperature:" | awk '{print $2}')
    fi
    [[ -z "$temp_c" ]] && temp_c="null" || temp_c=$(echo "$temp_c" | tr -d '[:space:]')

    poh=$(echo "$smart_attrs" | awk '/Power_On_Hours/ {print $10}')
    if [[ -z "$poh" ]]; then
      poh=$(smartctl -A "$dev" 2>/dev/null | grep -i "Power On Hours" | awk '{print $NF}' | tr -d ',')
    fi
    [[ -z "$poh" || ! "$poh" =~ ^[0-9]+$ ]] && poh="null"

    pct_used=$(echo "$smart_attrs" | awk '/Wear_Leveling_Count|Media_Wearout_Indicator|SSD_Life_Left/ {print $4}')
    if [[ -z "$pct_used" ]]; then
      pct_used=$(smartctl -A "$dev" 2>/dev/null | grep -i "Percentage Used:" | awk '{print $3}' | tr -d '%')
    fi
    [[ -z "$pct_used" || ! "$pct_used" =~ ^[0-9]+$ ]] && pct_used="null"

    tbw=$(echo "$smart_attrs" | awk '/Total_LBAs_Written/ {lba=$10} END {if(lba) printf "%.1f", lba*512/1e12}')
    [[ -z "$tbw" ]] && tbw=$(smartctl -A "$dev" 2>/dev/null | grep -i "Data Units Written" | awk '{print $NF}' | tr -d ',')
    [[ -z "$tbw" ]] && tbw="null"

    reallocated=$(echo "$smart_attrs" | awk '/Reallocated_Sector_Ct/ {print $10}')
    [[ -z "$reallocated" || ! "$reallocated" =~ ^[0-9]+$ ]] && reallocated="null"

    case "${smart_health^^}" in
      PASSED|OK) disk_status="ok" ;;
      FAILED*)   disk_status="error" ;;
      *)         disk_status="warning" ;;
    esac
    if [[ "$temp_c" != "null" && "$temp_c" -gt 65 ]] 2>/dev/null; then disk_status="error"; fi
    if [[ "$temp_c" != "null" && "$temp_c" -gt 55 ]] 2>/dev/null && [[ "$disk_status" == "ok" ]]; then disk_status="warning"; fi
    if [[ "$reallocated" != "null" && "$reallocated" -gt 0 ]] 2>/dev/null && [[ "$disk_status" == "ok" ]]; then disk_status="warning"; fi
    if [[ "$pct_used" != "null" && "$pct_used" -gt 80 ]] 2>/dev/null; then
      [[ "$pct_used" -gt 90 ]] 2>/dev/null && disk_status="error" || disk_status="warning"
    fi
    [[ "$disk_status" == "error" || "$disk_status" == "warning" ]] && STATUS="warning"

    item=$(jq -n \
      --arg dev "$dev" \
      --arg type "$dev_type" \
      --arg model "$dev_model" \
      --arg serial "$dev_serial" \
      --arg capacity "$dev_capacity" \
      --arg smart_health "$smart_health" \
      --arg status "$disk_status" \
      --argjson temp "${temp_c:-null}" \
      --argjson poh "${poh:-null}" \
      --argjson pct_used "${pct_used:-null}" \
      --argjson tbw "${tbw:-null}" \
      --argjson reallocated "${reallocated:-null}" \
      '{
        dev: $dev,
        type: $type,
        model: $model,
        serial: $serial,
        capacity: $capacity,
        smart_health: $smart_health,
        status: $status,
        temp_c: $temp,
        power_on_hours: $poh,
        pct_used: $pct_used,
        tbw: $tbw,
        reallocated_sectors: $reallocated
      }')
    smart_arr+=("$item")
  done
  if [ ${#smart_arr[@]} -gt 0 ]; then
    DISK_SMART_JSON=$(printf '%s\n' "${smart_arr[@]}" | jq -s '.')
  fi
fi

# ---------- DB checks ----------
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

  DB_PAYLOAD=$(jq -n \
    --arg service_id "$db_service_id" \
    --arg source "db-check" \
    --arg status "$db_status" \
    --arg message "$db_message" \
    --arg db_name "$db_name" \
    --arg db_host "$db_host" \
    --argjson db_port "$db_port" \
    --arg db_type "$db_type" \
    --argjson latency "$db_latency" \
    --arg script_version "$SCRIPT_VERSION" \
    '{
      service_id: $service_id,
      source: $source,
      status: $status,
      message: $message,
      payload: {
        db_name: $db_name,
        db_host: $db_host,
        db_port: $db_port,
        db_type: $db_type,
        latency_ms: $latency,
        script_version: $script_version
      }
    }')

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
PAYLOAD=$(jq -n \
  --arg service_id "$SERVICE_ID" \
  --arg source "system-health" \
  --arg status "$STATUS" \
  --arg message "$MESSAGE" \
  --argjson cpu_pct "$CPU_PCT" \
  --argjson load_avg "$LOAD1" \
  --argjson ram_pct "$RAM_PCT" \
  --argjson disk_pct "$DISK_PCT" \
  --argjson disk_free_gb "$DISK_FREE_GB" \
  --arg uptime_str "$UPTIME_STR" \
  --argjson uptime_secs "$UPTIME_SECS" \
  --arg issues "$ISSUES" \
  --argjson smb_count "$SMB_SESSION_COUNT" \
  --argjson smb_sessions "$SMB_SESSIONS_JSON" \
  --argjson disk_mounts "$DISK_MOUNTS_JSON" \
  --argjson docker "$DOCKER_JSON" \
  --argjson ports "$PORT_CHECKS_JSON" \
  --argjson smart "$DISK_SMART_JSON" \
  --arg script_version "$SCRIPT_VERSION" \
  '{
    service_id: $service_id,
    source: $source,
    status: $status,
    message: $message,
    payload: {
      cpu_pct: $cpu_pct,
      load_avg: $load_avg,
      ram_pct: $ram_pct,
      disk_pct: $disk_pct,
      disk_free_gb: $disk_free_gb,
      uptime_str: $uptime_str,
      uptime_seconds: $uptime_secs,
      issues: $issues,
      smb_session_count: $smb_count,
      smb_sessions: $smb_sessions,
      disk_mounts: $disk_mounts,
      docker_containers: $docker,
      port_checks: $ports,
      disk_smart: $smart,
      script_version: $script_version
    }
  }')

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
