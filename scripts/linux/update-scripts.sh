#!/bin/bash
# =============================================================
# update-scripts.sh — Auto-actualización de scripts Linux
# v1.3.0
#
# Uso:
#   ./update-scripts.sh              # actualiza todos
#   ./update-scripts.sh --check      # solo compara versiones, no instala
#   ./update-scripts.sh --force      # instala aunque la versión sea igual
#
# CRON (crontab -e):
#   0 4 */2 * * /srv/scripts/update-scripts.sh >> /var/log/update-scripts.log 2>&1
#
# Variables de entorno opcionales:
#   INSTALL_DIR   directorio destino   (default: /srv/scripts)
#   GITHUB_REPO   owner/repo           (default: mathcenas/service-catalog)
#   GITHUB_BRANCH rama                 (default: main)
# =============================================================

SCRIPT_VERSION="1.3.0"
GITHUB_REPO="${GITHUB_REPO:-mathcenas/service-catalog}"
GITHUB_BRANCH="${GITHUB_BRANCH:-main}"
INSTALL_DIR="${INSTALL_DIR:-/srv/scripts}"
LOG_FILE="${INSTALL_DIR}/update-scripts.log"
VERSIONS_FILE="${INSTALL_DIR}/installed-versions.json"
LOG_MAX_BYTES=1048576  # 1 MB

CHECK_ONLY=false
FORCE=false
for arg in "$@"; do
  [[ "$arg" == "--check" ]] && CHECK_ONLY=true
  [[ "$arg" == "--force" ]] && FORCE=true
done

# Scripts a gestionar: nombre_local → ruta en repo
declare -A SCRIPTS=(
  ["system-health.sh"]="scripts/linux/system-health.sh"
  ["backup.sh"]="scripts/linux/backup.sh"
  ["report-backup.sh"]="scripts/linux/report-backup.sh"
  # mikrotik-heartbeat.sh ya no existe en el repo (daba error en cada corrida): lo reemplaza mk-monitor.sh
  ["mk-monitor.sh"]="scripts/linux/mk-monitor.sh"
  ["mk-wifi-report.sh"]="scripts/linux/mk-wifi-report.sh"
  ["mk-syslog.sh"]="scripts/linux/mk-syslog.sh"
  ["update-scripts.sh"]="scripts/linux/update-scripts.sh"
)
# Nota: *.env y *.env.example no se actualizan para no sobreescribir config local.

# ── log ──────────────────────────────────────────────────────
mkdir -p "$INSTALL_DIR"

rotate_log() {
  if [[ -f "$LOG_FILE" ]]; then
    local size
    size=$(stat -c%s "$LOG_FILE" 2>/dev/null || echo 0)
    if (( size > LOG_MAX_BYTES )); then
      mv "$LOG_FILE" "${LOG_FILE%.log}-$(date '+%Y%m%d').log" 2>/dev/null || true
    fi
  fi
}
rotate_log

_log_line() {
  local line="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
  echo "$line"
  echo "$line" >> "$LOG_FILE" 2>/dev/null || true
}
log()  { _log_line "$*"; }
ok()   { _log_line "✓ $*"; }
warn() { _log_line "⚠ $*"; }
err()  { _log_line "✗ $*" >&2; echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✗ $*" >> "$LOG_FILE" 2>/dev/null || true; }

# ── helpers ──────────────────────────────────────────────────
get_version() {
  local file="$1"
  grep -m1 'SCRIPT_VERSION=' "$file" 2>/dev/null \
    | sed 's/.*SCRIPT_VERSION=["'\'']\{0,1\}//;s/["'\''].*//' \
    || echo "0.0.0"
}

version_gt() {
  [[ "$(printf '%s\n' "$1" "$2" | sort -V | tail -1)" == "$1" && "$1" != "$2" ]]
}

sha256_file() {
  local file="$1"
  sha256sum "$file" 2>/dev/null | awk '{print $1}' || echo ""
}

backup_script() {
  local dest="$1"
  [[ -f "$dest" ]] && cp "$dest" "${dest}.bak" 2>/dev/null || true
}

write_versions_file() {
  local entries=""
  local first=true
  for sname in "${!SCRIPTS[@]}"; do
    local dest="${INSTALL_DIR}/${sname}"
    [[ -f "$dest" ]] || continue
    local ver sha mtime
    ver=$(get_version "$dest")
    sha=$(sha256_file "$dest")
    mtime=$(date -r "$dest" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date '+%Y-%m-%d %H:%M:%S')
    [[ "$first" == "true" ]] && first=false || entries+=","
    entries+="
  \"${sname}\": {\"version\": \"${ver}\", \"sha256\": \"${sha}\", \"updated\": \"${mtime}\"}"
  done
  printf '{%s\n}\n' "$entries" > "$VERSIONS_FILE" 2>/dev/null || true
}

# Reporta al portal qué versiones quedaron instaladas (source "update-scripts").
# Usa el mismo .env que system-health.sh; sin config o sin jq, no manda nada.
send_updater_report() {
  (
    set +e
    local env_file=""
    for f in /etc/backup-ingest.env "${INSTALL_DIR}/.env"; do [[ -f "$f" ]] && { env_file="$f"; break; }; done
    [[ -z "$env_file" ]] && exit 0
    command -v jq >/dev/null 2>&1 || { warn "jq no está instalado — no se reporta al portal"; exit 0; }
    # shellcheck disable=SC1090
    source "$env_file"
    local anon="${SUPABASE_ANON_KEY:-$ANON_KEY}"
    [[ -z "$SUPABASE_URL" || -z "$anon" || -z "$INGEST_SECRET" || -z "$SERVICE_ID" ]] && exit 0

    local installed="{}"
    for sname in "${!SCRIPTS[@]}"; do
      [[ -f "${INSTALL_DIR}/${sname}" ]] || continue
      installed=$(jq -c --arg k "$sname" --arg v "$(get_version "${INSTALL_DIR}/${sname}")" '. + {($k): $v}' <<<"$installed")
    done
    local cron_line
    cron_line=$( (crontab -l 2>/dev/null; cat /etc/cron.d/* 2>/dev/null) | grep -v '^\s*#' | grep -m1 'update-scripts' )
    local status="success"; (( errors > 0 )) && status="warning"

    local body
    body=$(jq -n \
      --arg sid "$SERVICE_ID" --arg st "$status" \
      --arg msg "Actualizados: ${updated} | Sin cambios: ${skipped} | Errores: ${errors}" \
      --arg branch "$GITHUB_BRANCH" --arg ver "$SCRIPT_VERSION" --arg cron "$cron_line" \
      --argjson installed "$installed" \
      --rawfile upd "$UPDATED_LIST" --rawfile errs "$ERROR_LIST" \
      '{service_id:$sid, source:"update-scripts", status:$st, message:$msg,
        payload:{platform:"linux", branch:$branch, installed:$installed,
          updated:($upd|split("\n")|map(select(length>0))),
          errors:($errs|split("\n")|map(select(length>0))),
          task:(if $cron=="" then null else {name:"cron", schedule:$cron} end),
          script_version:$ver}}')
    code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${SUPABASE_URL}/functions/v1/ingest-heartbeat" \
      -H "Content-Type: application/json" -H "apikey: ${anon}" -H "Authorization: Bearer ${anon}" \
      -H "X-Ingest-Secret: ${INGEST_SECRET}" --data "$body")
    [[ "$code" =~ ^2 ]] && log "Reporte enviado al portal" || warn "No se pudo reportar al portal (HTTP ${code})"
  )
}

# ── main ─────────────────────────────────────────────────────
log "update-scripts.sh v${SCRIPT_VERSION} — repo: ${GITHUB_REPO}@${GITHUB_BRANCH}"

if ! command -v curl >/dev/null 2>&1; then
  err "curl no está instalado"; exit 1
fi

updated=0
skipped=0
errors=0

# Scripts seguros de ejecutar inmediatamente después de actualizarse
SAFE_TO_RUN=("system-health.sh")
AUTO_RUN_LIST=$(mktemp)
UPDATED_LIST=$(mktemp)
ERROR_LIST=$(mktemp)

for script_name in "${!SCRIPTS[@]}"; do
  (
    # subshell — un error no detiene el loop
    set +e
    repo_path="${SCRIPTS[$script_name]}"
    dest="${INSTALL_DIR}/${script_name}"
    url="https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}/${repo_path}"

    tmp=$(mktemp /tmp/update-script-XXXXXX)

    http_code=$(curl -sSL --retry 3 --retry-delay 3 --retry-connrefused \
      -w "%{http_code}" -o "$tmp" "$url" 2>/dev/null)

    if [[ "$http_code" != "200" ]]; then
      warn "${script_name}: HTTP ${http_code} — saltando"
      echo "${script_name}: HTTP ${http_code}" >> "$ERROR_LIST"
      rm -f "$tmp"; exit 1
    fi

    # Validar tamaño mínimo (< 50 bytes = respuesta vacía o de error)
    local_size=$(stat -c%s "$tmp" 2>/dev/null || echo 0)
    if (( local_size < 50 )); then
      warn "${script_name}: archivo sospechosamente pequeño (${local_size} bytes) — descartado"
      echo "${script_name}: archivo vacío" >> "$ERROR_LIST"
      rm -f "$tmp"; exit 1
    fi

    remote_ver=$(get_version "$tmp")
    local_ver="0.0.0"
    [[ -f "$dest" ]] && local_ver=$(get_version "$dest")

    if [[ "$CHECK_ONLY" == "true" ]]; then
      if version_gt "$remote_ver" "$local_ver"; then
        log "${script_name}: actualización disponible ${local_ver} → ${remote_ver}"
      else
        log "${script_name}: al día (${local_ver})"
      fi
      rm -f "$tmp"; exit 0
    fi

    if [[ "$FORCE" == "false" ]] && ! version_gt "$remote_ver" "$local_ver"; then
      log "${script_name}: al día (${local_ver}) — sin cambios"
      rm -f "$tmp"; exit 2
    fi

    sha=$(sha256_file "$tmp")

    # update-scripts.sh → guardar como .new, aplicar después del loop
    if [[ "$script_name" == "update-scripts.sh" ]]; then
      cp "$tmp" "${dest}.new"
      chmod +x "${dest}.new"
      rm -f "$tmp"
      ok "${script_name}: ${local_ver} → ${remote_ver} | sha256: ${sha:0:16}… (se aplicará al finalizar)"
      echo "${script_name} ${local_ver} -> ${remote_ver}" >> "$UPDATED_LIST"
      exit 0
    fi

    backup_script "$dest"
    cp "$tmp" "$dest"
    chmod +x "$dest"
    rm -f "$tmp"
    ok "${script_name}: ${local_ver} → ${remote_ver} | sha256: ${sha:0:16}…"
    echo "${script_name} ${local_ver} -> ${remote_ver}" >> "$UPDATED_LIST"

    # Marcar para auto-ejecución si es seguro
    for safe in "${SAFE_TO_RUN[@]}"; do
      if [[ "$script_name" == "$safe" ]]; then
        echo "$dest" >> "$AUTO_RUN_LIST"
        break
      fi
    done
    exit 0
  )
  rc=$?
  case $rc in
    0) (( updated++ )) || true ;;
    2) (( skipped++ )) || true ;;
    *) (( errors++  )) || true ;;
  esac
done

if [[ "$CHECK_ONLY" == "false" ]]; then
  write_versions_file
  log "Listo — actualizados: ${updated} · sin cambios: ${skipped} · errores: ${errors}"
  send_updater_report
fi
rm -f "$UPDATED_LIST" "$ERROR_LIST"

# Ejecutar scripts recién actualizados (B)
if [[ -s "$AUTO_RUN_LIST" ]]; then
  while IFS= read -r script; do
    log "▶ Ejecutando $(basename "$script") (recién actualizado)..."
    bash "$script" &
  done < "$AUTO_RUN_LIST"
fi
rm -f "$AUTO_RUN_LIST"

# Aplicar actualización de este mismo script y relanzar (A)
if [[ -f "${INSTALL_DIR}/update-scripts.sh.new" ]]; then
  mv "${INSTALL_DIR}/update-scripts.sh.new" "${INSTALL_DIR}/update-scripts.sh"
  chmod +x "${INSTALL_DIR}/update-scripts.sh"
  log "↩ update-scripts.sh actualizado — relanzando nueva versión..."
  exec "${INSTALL_DIR}/update-scripts.sh" "$@"
fi
