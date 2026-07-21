#!/usr/bin/env bash
#
# backup.sh - Backup genérico para VPS con Docker + notificación a Uptime Kuma (push monitor)
#             + reporte a Supabase ingest
#
# Uso:
#   ./backup.sh [ruta-al-.env]
#   Si no se pasa ruta, busca ".env" en el mismo directorio que el script.
#
# Requiere: bash, tar, gzip, find, curl, docker (si se usa PG_CONTAINERS),
#           rsync (si DEST_TYPE=rsync), rclone (si DEST_TYPE=rclone)

set -euo pipefail

# ---------- Localizar y cargar el .env ----------
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
ENV_FILE="${1:-$SCRIPT_DIR/.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: no se encontró el archivo de configuración: $ENV_FILE" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"

# ---------- Defaults ----------
HOST_TAG="${HOST_TAG:-$(hostname -s)}"
SRC_DIRS="${SRC_DIRS:-/srv}"
EXCLUDE_PATTERNS="${EXCLUDE_PATTERNS:-}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/vps-kuma}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
DEST_TYPE="${DEST_TYPE:-local}"        # local | rsync | rclone
RSYNC_DEST="${RSYNC_DEST:-}"
RSYNC_SSH_KEY="${RSYNC_SSH_KEY:-}"
RCLONE_REMOTE="${RCLONE_REMOTE:-}"
PG_CONTAINERS="${PG_CONTAINERS:-}"
KUMA_PUSH_URL="${KUMA_PUSH_URL:-}"
LOCK_FILE="${LOCK_FILE:-/tmp/vps-backup-kuma-${HOST_TAG}.lock}"

RESEND_API_KEY="${RESEND_API_KEY:-}"
RESEND_FROM="${RESEND_FROM:-}"
RESEND_TO="${RESEND_TO:-}"
EMAIL_ON_SUCCESS="${EMAIL_ON_SUCCESS:-false}"
EMAIL_ON_FAILURE="${EMAIL_ON_FAILURE:-true}"

# Supabase ingest (opcional — si no se configura, el backup funciona igual)
INGEST_URL="${INGEST_URL:-}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-}"
INGEST_SECRET="${INGEST_SECRET:-}"
SERVICE_ID="${SERVICE_ID:-}"

# ---------- Logging ----------
LOG_FILE="${LOG_FILE:-$SCRIPT_DIR/backup.log}"
exec > >(while IFS= read -r line; do printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$line"; done | tee -a "$LOG_FILE") 2>&1
echo "===== Iniciando backup de ${HOST_TAG:-$(hostname -s)} ====="

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
STAGING_DIR="$BACKUP_ROOT/staging-$TIMESTAMP"
ARCHIVE_NAME="${HOST_TAG}_${TIMESTAMP}.tar.gz"
ARCHIVE_PATH="$BACKUP_ROOT/$ARCHIVE_NAME"
START_TS=$(date +%s)

# ---------- Lock para evitar corridas superpuestas ----------
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  echo "Ya hay un backup corriendo para $HOST_TAG (lock: $LOCK_FILE). Salgo." >&2
  exit 1
fi

# ---------- Notificación a Kuma ----------
notify_kuma() {
  local status="$1"   # up | down
  local msg="$2"
  if [[ -z "$KUMA_PUSH_URL" ]]; then
    return 0
  fi
  local base_url="${KUMA_PUSH_URL%%\?*}"
  local elapsed=$(( $(date +%s) - START_TS ))
  curl -fsS --max-time 15 -G "$base_url" \
    --data-urlencode "status=${status}" \
    --data-urlencode "msg=${msg}" \
    --data-urlencode "ping=${elapsed}000" \
    >/dev/null || echo "WARN: no se pudo notificar a Kuma" >&2
}

# ---------- Reporte a Supabase ingest ----------
report_ingest() {
  local status="$1"     # success | failed
  local size_bytes="$2"
  local duration="$3"
  local details="$4"

  if [[ -z "$INGEST_URL" || -z "$SERVICE_ID" || -z "$INGEST_SECRET" ]]; then
    return 0
  fi

  local backed_up_at
  backed_up_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  curl -fsS --max-time 15 -X POST "$INGEST_URL" \
    -H "Content-Type: application/json" \
    -H "apikey: ${SUPABASE_ANON_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
    -H "X-Ingest-Secret: ${INGEST_SECRET}" \
    -d "{
      \"service_id\": \"${SERVICE_ID}\",
      \"job_name\": \"${HOST_TAG} backup\",
      \"status\": \"${status}\",
      \"size_bytes\": ${size_bytes},
      \"duration_seconds\": ${duration},
      \"backed_up_at\": \"${backed_up_at}\",
      \"details\": \"${details}\"
    }" >/dev/null \
    || echo "WARN: no se pudo reportar al ingest de Supabase" >&2
}

# ---------- Notificación por mail (Resend) ----------
send_email() {
  local status="$1"   # up | down
  local subject="$2"
  local body="$3"

  if [[ -z "$RESEND_API_KEY" || -z "$RESEND_FROM" || -z "$RESEND_TO" ]]; then
    return 0
  fi
  if [[ "$status" == "up" && "$EMAIL_ON_SUCCESS" != "true" ]]; then
    return 0
  fi
  if [[ "$status" == "down" && "$EMAIL_ON_FAILURE" != "true" ]]; then
    return 0
  fi
  if ! command -v jq >/dev/null 2>&1; then
    echo "WARN: 'jq' no está instalado, no se puede enviar mail via Resend" >&2
    return 0
  fi

  local to_json html_body payload response http_code body_resp
  to_json="$(printf '%s' "$RESEND_TO" | tr ',' '\n' | sed '/^[[:space:]]*$/d' | jq -R . | jq -s .)"
  html_body="$(printf '%s' "$body" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g; s/$/<br>/')"

  payload="$(jq -n \
    --arg from "$RESEND_FROM" \
    --argjson to "$to_json" \
    --arg subject "$subject" \
    --arg html "$html_body" \
    '{from: $from, to: $to, subject: $subject, html: $html}')"

  response="$(curl -sS --max-time 15 -w '\n%{http_code}' -X POST "https://api.resend.com/emails" \
    -H "Authorization: Bearer ${RESEND_API_KEY}" \
    -H "Content-Type: application/json" \
    -d "$payload")"
  http_code="$(printf '%s' "$response" | tail -n1)"
  body_resp="$(printf '%s' "$response" | sed '$d')"

  if [[ "$http_code" -lt 200 || "$http_code" -ge 300 ]]; then
    echo "WARN: Resend devolvió HTTP ${http_code}: ${body_resp}" >&2
  else
    echo "Mail enviado via Resend a: ${RESEND_TO}"
  fi
}

# ---------- Manejo de errores ----------
on_error() {
  local exit_code=$?
  local line=$1
  local elapsed=$(( $(date +%s) - START_TS ))
  local msg="Fallo en línea ${line} (exit ${exit_code}) en ${HOST_TAG}"
  echo "ERROR: $msg" >&2
  notify_kuma "down" "$msg"
  report_ingest "failed" "0" "$elapsed" "error at line ${line} exit_code=${exit_code}"
  send_email "down" "❌ Backup FALLÓ - ${HOST_TAG}" \
    "El backup de ${HOST_TAG} falló.
Línea: ${line}
Código de salida: ${exit_code}
Fecha: $(date '+%Y-%m-%d %H:%M:%S')
Revisar logs en el servidor para más detalle."
  rm -rf "$STAGING_DIR"
  exit "$exit_code"
}
trap 'on_error $LINENO' ERR

# ---------- Preparación ----------
mkdir -p "$BACKUP_ROOT" "$STAGING_DIR"

# ---------- Dump de Postgres (si hay contenedores configurados) ----------
if [[ -n "$PG_CONTAINERS" ]]; then
  mkdir -p "$STAGING_DIR/pgdumps"
  for container in $PG_CONTAINERS; do
    echo "Dumpeando Postgres del contenedor: $container"
    dump_file="$STAGING_DIR/pgdumps/${container}.sql.gz"
    pg_user="$(docker exec "$container" printenv POSTGRES_USER 2>/dev/null || echo postgres)"
    docker exec "$container" pg_dumpall -U "$pg_user" | gzip > "$dump_file"
  done
fi

# ---------- Armado del tar de los directorios fuente ----------
TAR_EXCLUDES=()
if [[ -n "$EXCLUDE_PATTERNS" ]]; then
  for pattern in $EXCLUDE_PATTERNS; do
    TAR_EXCLUDES+=(--exclude="$pattern")
  done
fi

echo "Comprimiendo: $SRC_DIRS"

for dir in $SRC_DIRS; do
  if [[ ! -e "$dir" ]]; then
    echo "ERROR: el path '$dir' (definido en SRC_DIRS) no existe en este servidor." >&2
    exit 1
  fi
done

# shellcheck disable=SC2086
tar czf "$STAGING_DIR/srv.tar.gz" "${TAR_EXCLUDES[@]}" $SRC_DIRS

tar czf "$ARCHIVE_PATH" -C "$STAGING_DIR" .
rm -rf "$STAGING_DIR"

ARCHIVE_SIZE="$(du -h "$ARCHIVE_PATH" | cut -f1)"
ARCHIVE_SIZE_BYTES="$(du -sb "$ARCHIVE_PATH" | cut -f1)"
echo "Backup local generado: $ARCHIVE_PATH ($ARCHIVE_SIZE)"

# ---------- Envío al destino ----------
case "$DEST_TYPE" in
  local)
    : # ya está en BACKUP_ROOT
    ;;
  rsync)
    if [[ -z "$RSYNC_DEST" ]]; then
      echo "ERROR: DEST_TYPE=rsync pero RSYNC_DEST no está seteado" >&2
      exit 1
    fi
    rsync_opts=(-avz)
    if [[ -n "$RSYNC_SSH_KEY" ]]; then
      rsync_opts+=(-e "ssh -i $RSYNC_SSH_KEY -o StrictHostKeyChecking=accept-new")
    fi
    rsync "${rsync_opts[@]}" "$ARCHIVE_PATH" "$RSYNC_DEST/"
    ;;
  rclone)
    if [[ -z "$RCLONE_REMOTE" ]]; then
      echo "ERROR: DEST_TYPE=rclone pero RCLONE_REMOTE no está seteado" >&2
      exit 1
    fi
    rclone copy "$ARCHIVE_PATH" "$RCLONE_REMOTE/"
    ;;
  *)
    echo "ERROR: DEST_TYPE desconocido: $DEST_TYPE (usar local|rsync|rclone)" >&2
    exit 1
    ;;
esac

# ---------- Rotación de backups locales viejos ----------
find "$BACKUP_ROOT" -maxdepth 1 -name "${HOST_TAG}_*.tar.gz" -mtime "+${RETENTION_DAYS}" -delete

# ---------- Notificación de éxito ----------
ELAPSED=$(( $(date +%s) - START_TS ))
notify_kuma "up" "OK ${HOST_TAG}: ${ARCHIVE_SIZE} en ${ELAPSED}s (dest=${DEST_TYPE})"
report_ingest "success" "$ARCHIVE_SIZE_BYTES" "$ELAPSED" "dest=${DEST_TYPE} dirs=${SRC_DIRS}"
send_email "up" "✅ Backup OK - ${HOST_TAG}" \
  "Backup de ${HOST_TAG} completado correctamente.
Archivo: ${ARCHIVE_NAME}
Tamaño: ${ARCHIVE_SIZE}
Duración: ${ELAPSED}s
Destino: ${DEST_TYPE}
Fecha: $(date '+%Y-%m-%d %H:%M:%S')"
echo "Backup completado OK en ${ELAPSED}s"
