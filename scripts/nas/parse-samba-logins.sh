#!/bin/bash
# =============================================================
# parse-samba-logins.sh — Acumula últimos logins SMB desde syslog
# Corre cada hora via cron antes que report-smb-acl.sh
#
# Cron sugerido:
#   50 * * * * /usr/local/bin/parse-samba-logins.sh
#
# Salida: /srv/dev-disk-by-label-NASFiles/.nas-acl/last_logins.json
# Formato: {"usuario": {"machine": "equipo", "timestamp": "2026-08-28 10:30:00", "ip": "192.168.1.x"}}
#
# Fuente: syslog con líneas tipo:
#   smbd_audit: acer-mariano (ipv4:192.168.1.150:60008) connect to service X initially as user mariano
# =============================================================

set -euo pipefail

SYSLOG="${SYSLOG:-/var/log/syslog}"
STATE_DIR="${STATE_DIR:-/srv/dev-disk-by-label-NASFiles/.nas-acl}"
STATE_FILE="$STATE_DIR/last_logins.json"
LOG_FILE="${LOG_FILE:-/var/log/nas-smb-acl.log}"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') [parse-logins] $*" | tee -a "$LOG_FILE"; }

mkdir -p "$STATE_DIR"
[[ -f "$STATE_FILE" ]] || echo '{}' > "$STATE_FILE"

log "Parseando syslog ($SYSLOG) ..."

python3 - "$SYSLOG" "$STATE_FILE" <<'PYEOF'
import sys, re, json
from datetime import datetime

syslog_file = sys.argv[1]
state_file  = sys.argv[2]

try:
    with open(state_file) as f:
        state = json.load(f)
except Exception:
    state = {}

# Formato syslog: "Aug 28 11:27:04 nas smbd_audit:   machine (ipv4:IP:port) connect to service X initially as user USERNAME"
# El año no está en syslog — usamos el año actual
YEAR = datetime.now().year

RE_LINE = re.compile(
    r'^(\w{3}\s+\d+\s+\d{2}:\d{2}:\d{2})\s+\S+\s+smbd_audit:\s+'
    r'(\S+)\s+\(ipv4:([^:]+):\d+\)\s+connect to service \S+ initially as user\s+(\S+)',
    re.IGNORECASE
)

SKIP_USERS = {'root', 'nobody', 'guest', 'anonymous'}

updated = 0
try:
    with open(syslog_file, errors='replace') as f:
        for line in f:
            m = RE_LINE.search(line)
            if not m:
                continue
            ts_str, machine, ip, user = m.group(1), m.group(2), m.group(3), m.group(4).lower()
            if user in SKIP_USERS:
                continue
            # Normalizar timestamp: "Aug 28 11:27:04" -> "2026-08-28 11:27:04"
            try:
                ts = datetime.strptime(f'{YEAR} {ts_str}', '%Y %b %d %H:%M:%S').strftime('%Y-%m-%d %H:%M:%S')
            except Exception:
                continue
            existing = state.get(user, {})
            if not existing or ts > existing.get('timestamp', ''):
                state[user] = {'machine': machine, 'timestamp': ts, 'ip': ip}
                updated += 1
except Exception as e:
    print(f'[parse-logins] error: {e}', file=sys.stderr)

with open(state_file, 'w') as f:
    json.dump(state, f, indent=2)

print(f'[parse-logins] {updated} entradas actualizadas, {len(state)} usuarios en estado')
PYEOF

log "Listo. Estado en $STATE_FILE"
