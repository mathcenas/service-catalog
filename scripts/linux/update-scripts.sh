#!/bin/bash
# =============================================================
# update-scripts.sh — Auto-actualización de scripts Linux
#
# Descarga la última versión de los scripts desde GitHub y los
# instala en /srv/scripts/ (o INSTALL_DIR si se sobreescribe).
#
# Uso:
#   ./update-scripts.sh              # actualiza todos
#   ./update-scripts.sh --check      # solo compara versiones, no instala
#   ./update-scripts.sh --force      # instala aunque la versión sea igual
#
# Cron cada 48h (ejemplo):
#   0 4 */2 * * /srv/scripts/update-scripts.sh >> /var/log/update-scripts.log 2>&1
#
# Variables de entorno opcionales:
#   INSTALL_DIR   directorio destino   (default: /srv/scripts)
#   GITHUB_REPO   owner/repo           (default: mathcenas/service-catalog)
#   GITHUB_BRANCH rama                 (default: main)
# =============================================================

set -euo pipefail

SCRIPT_VERSION="1.0.0"
GITHUB_REPO="${GITHUB_REPO:-mathcenas/service-catalog}"
GITHUB_BRANCH="${GITHUB_BRANCH:-main}"
INSTALL_DIR="${INSTALL_DIR:-/srv/scripts}"
RAW_BASE="https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}/scripts/linux"

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
  ["mikrotik-heartbeat.sh"]="scripts/linux/mikrotik-heartbeat.sh"
  ["update-scripts.sh"]="scripts/linux/update-scripts.sh"
)

# ── helpers ──────────────────────────────────────────────────
log()  { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
ok()   { echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✓ $*"; }
warn() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠ $*"; }
err()  { echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✗ $*" >&2; }

get_version() {
  local file="$1"
  grep -m1 'SCRIPT_VERSION=' "$file" 2>/dev/null | sed 's/.*="\?//;s/"\?.*//' || echo "0.0.0"
}

version_gt() {
  # returns 0 (true) if $1 > $2 using sort -V
  [[ "$(printf '%s\n' "$1" "$2" | sort -V | tail -1)" == "$1" && "$1" != "$2" ]]
}

# ── main ─────────────────────────────────────────────────────
log "update-scripts.sh v${SCRIPT_VERSION} — repo: ${GITHUB_REPO}@${GITHUB_BRANCH}"

if ! command -v curl >/dev/null 2>&1; then
  err "curl no está instalado"; exit 1
fi

mkdir -p "$INSTALL_DIR"

updated=0
skipped=0
errors=0

for script_name in "${!SCRIPTS[@]}"; do
  repo_path="${SCRIPTS[$script_name]}"
  dest="${INSTALL_DIR}/${script_name}"
  url="https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}/${repo_path}"

  # Descargar a temp
  tmp=$(mktemp /tmp/update-script-XXXXXX)
  http_code=$(curl -sSL -w "%{http_code}" -o "$tmp" "$url" 2>/dev/null)

  if [[ "$http_code" != "200" ]]; then
    warn "${script_name}: HTTP ${http_code} — saltando"
    rm -f "$tmp"
    (( errors++ )) || true
    continue
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
    rm -f "$tmp"
    continue
  fi

  if [[ "$FORCE" == "false" ]] && ! version_gt "$remote_ver" "$local_ver"; then
    log "${script_name}: al día (${local_ver}) — sin cambios"
    rm -f "$tmp"
    (( skipped++ )) || true
    continue
  fi

  # No sobreescribir este mismo script mientras corre (se reemplaza al final)
  if [[ "$script_name" == "update-scripts.sh" && "$dest" -ef "$0" ]]; then
    cp "$tmp" "${dest}.new"
    chmod +x "${dest}.new"
    rm -f "$tmp"
    ok "${script_name}: ${local_ver} → ${remote_ver} (se aplicará en el próximo arranque)"
    (( updated++ )) || true
    continue
  fi

  cp "$tmp" "$dest"
  chmod +x "$dest"
  rm -f "$tmp"
  ok "${script_name}: ${local_ver} → ${remote_ver}"
  (( updated++ )) || true
done

# Aplicar actualización pendiente de este mismo script
if [[ -f "${INSTALL_DIR}/update-scripts.sh.new" ]]; then
  mv "${INSTALL_DIR}/update-scripts.sh.new" "${INSTALL_DIR}/update-scripts.sh"
  chmod +x "${INSTALL_DIR}/update-scripts.sh"
  log "update-scripts.sh reemplazado — activo en la próxima ejecución"
fi

if [[ "$CHECK_ONLY" == "false" ]]; then
  log "Listo — actualizados: ${updated} · sin cambios: ${skipped} · errores: ${errors}"
fi
