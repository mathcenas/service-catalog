#!/bin/bash
# =============================================================
# report-smb-acl.sh — Snapshot de usuarios y permisos SMB en OMV
# Envía al Service Catalog para visualización y exportación.
#
# Usar las mismas variables que backup-ingest.env:
#   SUPABASE_URL, SUPABASE_ANON_KEY, INGEST_SECRET, SERVICE_ID
#
# Uso:
#   ./report-smb-acl.sh                   # detecta env automáticamente
#   ./report-smb-acl.sh /ruta/custom.env  # env alternativo
#
# Orden de búsqueda del env:
#   1. Arg CLI  2. /etc/backup-ingest.env  3. $SCRIPT_DIR/.env
#
# Schedulear (opcional, ej: semanalmente):
#   0 6 * * 1 /usr/local/bin/report-smb-acl.sh
# =============================================================

set -euo pipefail

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

# Siempre usar el endpoint propio — ignorar INGEST_URL del env (que apunta a ingest-backup)
ACL_INGEST_URL="${SUPABASE_URL}/functions/v1/ingest-nas-acl"

if [[ -z "${SUPABASE_URL:-}" || -z "${SUPABASE_ANON_KEY:-}" || -z "${INGEST_SECRET:-}" || -z "${SERVICE_ID:-}" ]]; then
  echo "ERROR: faltan variables (SUPABASE_URL, SUPABASE_ANON_KEY, INGEST_SECRET, SERVICE_ID)" >&2
  exit 1
fi

LOG_FILE="${LOG_FILE:-/var/log/nas-smb-acl.log}"
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "$LOG_FILE"; }

OMV_CONFIG="${OMV_CONFIG:-/etc/openmediavault/config.xml}"

if [[ ! -f "$OMV_CONFIG" ]]; then
  log "ERROR: no se encontró config de OMV en $OMV_CONFIG"
  exit 1
fi

log "=== inicio report-smb-acl ==="
log "CONFIG=$OMV_CONFIG"
log "SERVICE_ID=$SERVICE_ID"

HOSTNAME_VAL=$(hostname -f 2>/dev/null || hostname)
GENERATED_AT=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

# ---------- Parsear usuarios OMV ----------
# Los usuarios están en /config/system/usermanagement/users/user
parse_users() {
  xmllint --xpath '//system/usermanagement/users/user/name/text()' "$OMV_CONFIG" 2>/dev/null \
    | tr '\n' ',' | sed 's/,$//' || true
}

# ---------- Parsear shared folders ----------
# Cada sharedfolder tiene: uuid, name, reldirpath, privileges/privilege*
parse_shares_json() {
  python3 - "$OMV_CONFIG" <<'PYEOF'
import sys, xml.etree.ElementTree as ET, json

tree = ET.parse(sys.argv[1])
root = tree.getroot()

# Mapa uuid -> shared folder info
sf_map = {}
for sf in root.findall('.//sharedfolder'):
    uuid = sf.findtext('uuid', '').strip()
    name = sf.findtext('name', '').strip()
    relpath = sf.findtext('reldirpath', '').strip()
    comment = sf.findtext('comment', '').strip()

    privs = []
    for p in sf.findall('privileges/privilege'):
        ptype = p.findtext('type', '').strip()   # user | group
        pname = p.findtext('name', '').strip()
        perms = p.findtext('perms', '0').strip()
        # OMV perms: 7=read/write, 5=read only, 0=no access
        if perms == '7':
            access = 'read/write'
        elif perms == '5':
            access = 'read only'
        else:
            access = 'no access'
        privs.append({'type': ptype, 'name': pname, 'access': access, 'perms': int(perms)})

    sf_map[uuid] = {
        'folder_name': name,
        'rel_path': relpath,
        'comment': comment,
        'privileges': privs,
    }

# SMB shares: enlazar con sharedfolder por sharedfolderref
shares = []
for share in root.findall('.//smb/shares/share'):
    sfref = share.findtext('sharedfolderref', '').strip()
    smb_name = share.findtext('name', '').strip()
    smb_comment = share.findtext('comment', '').strip()
    readonly = share.findtext('readonly', '0').strip() == '1'
    guest = share.findtext('guest', 'no').strip()
    enable = share.findtext('enable', '1').strip() == '1'

    sf = sf_map.get(sfref, {})
    users_access = [p for p in sf.get('privileges', []) if p['type'] == 'user']
    groups_access = [p for p in sf.get('privileges', []) if p['type'] == 'group']

    shares.append({
        'smb_name': smb_name or sf.get('folder_name', sfref),
        'folder_name': sf.get('folder_name', ''),
        'rel_path': sf.get('rel_path', ''),
        'comment': smb_comment or sf.get('comment', ''),
        'readonly': readonly,
        'guest_access': guest != 'no',
        'enabled': enable,
        'users': users_access,
        'groups': groups_access,
    })

# Usuarios OMV
users = []
for u in root.findall('.//system/usermanagement/users/user'):
    uname = u.findtext('name', '').strip()
    uid = u.findtext('uid', '').strip()
    comment = u.findtext('comment', '').strip()
    groups_el = u.findall('groups/groupname')
    ugroups = [g.text.strip() for g in groups_el if g.text]
    if uname:
        users.append({'name': uname, 'uid': uid, 'comment': comment, 'groups': ugroups})

print(json.dumps({'shares': shares, 'users': users}))
PYEOF
}

log "Parseando config OMV..."
PARSED=$(parse_shares_json)

if [[ -z "$PARSED" ]]; then
  log "ERROR: no se pudo parsear el config XML"
  exit 1
fi

TMP_PARSED=$(mktemp /tmp/nas_acl_parsed.XXXXXX)
echo "$PARSED" > "$TMP_PARSED"

SHARE_COUNT=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(len(d['shares']))" "$TMP_PARSED")
USER_COUNT=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(len(d['users']))" "$TMP_PARSED")
log "Shares SMB: $SHARE_COUNT | Usuarios OMV: $USER_COUNT"

# ---------- Payload ----------
PAYLOAD=$(python3 -c "
import json, sys
data = json.load(open(sys.argv[1]))
payload = {
    'service_id':   sys.argv[2],
    'hostname':     sys.argv[3],
    'generated_at': sys.argv[4],
    'shares':       data['shares'],
    'users':        data['users'],
}
print(json.dumps(payload))
" "$TMP_PARSED" "$SERVICE_ID" "$HOSTNAME_VAL" "$GENERATED_AT")

rm -f "$TMP_PARSED"

# ---------- Enviar ----------
log "Enviando a $ACL_INGEST_URL ..."
HTTP_CODE=$(curl -s -o /tmp/nas_acl_body.txt -w "%{http_code}" -X POST "$ACL_INGEST_URL" \
  -H "Content-Type: application/json" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "X-Ingest-Secret: $INGEST_SECRET" \
  -d "$PAYLOAD")

BODY=$(cat /tmp/nas_acl_body.txt 2>/dev/null)
log "HTTP $HTTP_CODE | $BODY"

if [[ "$HTTP_CODE" == "201" ]]; then
  log "=== OK: $SHARE_COUNT shares, $USER_COUNT usuarios enviados ==="
else
  log "=== ERROR: respuesta inesperada ==="
  exit 1
fi
