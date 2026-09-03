#!/bin/bash
# =============================================================
# parse-samba-logins.sh — Acumula historial de logins SMB desde syslog
#
# ACTUALIZAR (NAS):
#   curl -fsSL https://raw.githubusercontent.com/mathcenas/service-catalog/main/scripts/nas/parse-samba-logins.sh \
#     -o /usr/local/bin/parse-samba-logins.sh && chmod +x /usr/local/bin/parse-samba-logins.sh
# Corre cada hora via cron antes que report-smb-acl.sh
#
# Cron sugerido:
#   50 * * * * /usr/local/bin/parse-samba-logins.sh
#
# Salida: /srv/dev-disk-by-label-NASFiles/.nas-acl/last_logins.json
# Formato por usuario:
#   {"last_login": "2026-08-28 11:27", "accesses": [{"machine":..., "timestamp":..., "ip":...}, ...]}
#
# Fuente: syslog con líneas tipo:
#   smbd_audit: machine (ipv4:IP:port) connect to service X initially as user USERNAME
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

YEAR = datetime.now().year
MAX_ACCESSES = 20  # máximo de entradas por usuario (una por equipo distinto)

RE_LINE = re.compile(
    r'^(\w{3}\s+\d+\s+\d{2}:\d{2}:\d{2})\s+\S+\s+smbd_audit:\s+'
    r'(\S+)\s+\(ipv4:([^:]+):\d+\)\s+connect to service \S+ initially as user\s+(\S+)',
    re.IGNORECASE
)

SKIP_USERS = {'root', 'nobody', 'guest', 'anonymous'}

# Valid machine: Windows hostname (alphanum+hyphen) or IP address
VALID_MACHINE = re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9\-]*$|^\d{1,3}(\.\d{1,3}){3}$')

def is_valid_machine(name):
    return bool(name) and len(name) <= 63 and bool(VALID_MACHINE.match(name))

# Leer syslog y recolectar todos los eventos de esta sesión
# {user -> {machine -> timestamp_str}} — guardamos el más reciente por máquina
new_events = {}  # user -> {machine -> (timestamp, ip)}

try:
    with open(syslog_file, errors='replace') as f:
        for line in f:
            m = RE_LINE.search(line)
            if not m:
                continue
            ts_str, machine, ip, user = m.group(1), m.group(2), m.group(3), m.group(4).lower()
            if user in SKIP_USERS:
                continue
            if not is_valid_machine(machine):
                continue
            try:
                ts = datetime.strptime(f'{YEAR} {ts_str}', '%Y %b %d %H:%M:%S').strftime('%Y-%m-%d %H:%M:%S')
            except Exception:
                continue
            if user not in new_events:
                new_events[user] = {}
            # Guardar el más reciente por máquina
            existing_ts = new_events[user].get(machine, ('',))[0]
            if ts > existing_ts:
                new_events[user][machine] = (ts, ip)
except Exception as e:
    print(f'[parse-logins] error leyendo syslog: {e}', file=sys.stderr)

# Merge con estado acumulado
updated = 0
for user, machines in new_events.items():
    entry = state.get(user, {'last_login': '', 'accesses': []})
    accesses = {a['machine']: a for a in entry.get('accesses', [])}

    for machine, (ts, ip) in machines.items():
        existing_ts = accesses.get(machine, {}).get('timestamp', '')
        if ts > existing_ts:
            accesses[machine] = {'machine': machine, 'timestamp': ts, 'ip': ip}
            updated += 1

    # Ordenar por timestamp desc, limitar a MAX_ACCESSES
    sorted_accesses = sorted(accesses.values(), key=lambda x: x['timestamp'], reverse=True)[:MAX_ACCESSES]
    last_login = sorted_accesses[0]['timestamp'] if sorted_accesses else entry.get('last_login', '')

    state[user] = {'last_login': last_login, 'accesses': sorted_accesses}

with open(state_file, 'w') as f:
    json.dump(state, f, indent=2)

total_accesses = sum(len(v.get('accesses', [])) for v in state.values())
print(f'[parse-logins] {updated} accesos actualizados, {len(state)} usuarios, {total_accesses} entradas totales')
PYEOF

log "Listo. Estado en $STATE_FILE"
