#!/bin/bash
# =============================================================
# parse-samba-logins.sh — Acumula últimos logins SMB desde logs de Samba
# Corre cada hora via cron antes que reporte-smb-acl.sh
#
# Cron sugerido:
#   50 * * * * /usr/local/bin/parse-samba-logins.sh
#   0  6 * * * /usr/local/bin/report-smb-acl.sh
#
# Salida: /srv/dev-disk-by-label-NASFiles/.nas-acl/last_logins.json
# Formato: {"usuario": {"machine": "equipo", "timestamp": "2026-08-28T10:30:00", "ip": "192.168.1.x"}, ...}
# =============================================================

set -euo pipefail

SAMBA_LOG_DIR="${SAMBA_LOG_DIR:-/var/log/samba}"
STATE_DIR="${STATE_DIR:-/srv/dev-disk-by-label-NASFiles/.nas-acl}"
STATE_FILE="$STATE_DIR/last_logins.json"
LOG_FILE="${LOG_FILE:-/var/log/nas-smb-acl.log}"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') [parse-logins] $*" | tee -a "$LOG_FILE"; }

mkdir -p "$STATE_DIR"

# Inicializar si no existe
[[ -f "$STATE_FILE" ]] || echo '{}' > "$STATE_FILE"

log "Parseando logs de Samba en $SAMBA_LOG_DIR ..."

python3 - "$SAMBA_LOG_DIR" "$STATE_FILE" <<'PYEOF'
import sys, os, re, json
from datetime import datetime

log_dir    = sys.argv[1]
state_file = sys.argv[2]

# Cargar estado acumulado
try:
    with open(state_file) as f:
        state = json.load(f)
except Exception:
    state = {}

# Regex para líneas de timestamp de Samba: [2026/08/28 10:30:00.123456,  1]
RE_TS   = re.compile(r'^\[(\d{4}/\d{2}/\d{2} \d{2}:\d{2}:\d{2})')
# Autenticación exitosa: "session setup" con usuario
RE_AUTH = re.compile(r'(?:user|User|authenticated user|session setup ok)\s*[:\[]?\s*[\'"]?(\w[\w\-\.]+)', re.IGNORECASE)
# Alternativa: "Allowing session setup for user ..."
RE_AUTH2 = re.compile(r'(?:session setup for user|connect to service .+ initially as user)\s+(\w[\w\-\.]+)', re.IGNORECASE)

def parse_log(filepath, machine):
    """Lee un log de Samba y retorna {usuario: (timestamp_str, machine, ip)} del último login."""
    logins = {}
    current_ts = None
    try:
        with open(filepath, errors='replace') as f:
            for line in f:
                m = RE_TS.match(line)
                if m:
                    current_ts = m.group(1).replace('/', '-', 2)  # 2026-08-28 10:30:00
                    continue
                if current_ts:
                    for rx in (RE_AUTH, RE_AUTH2):
                        m2 = rx.search(line)
                        if m2:
                            user = m2.group(1).lower()
                            # Ignorar nombres genéricos / sistema
                            if user in ('root', 'nobody', 'guest', 'anonymous', 'smbd', 'nmbd'):
                                continue
                            # Guardar solo el más reciente por usuario en este archivo
                            if user not in logins or current_ts > logins[user][0]:
                                logins[user] = (current_ts, machine)
                            break
    except Exception:
        pass
    return logins

updated = 0
for fname in os.listdir(log_dir):
    if not fname.startswith('log.'):
        continue
    machine = fname[4:]  # quitar "log."
    if not machine or machine in ('smbd', 'nmbd', 'winbindd', ''):
        continue

    fpath = os.path.join(log_dir, fname)
    if os.path.getsize(fpath) == 0:
        continue

    # Extraer IP del nombre si es numérico, sino el nombre es el equipo
    ip = machine if re.match(r'^\d+\.\d+\.\d+\.\d+$', machine) else ''

    for user, (ts, mach) in parse_log(fpath, machine).items():
        existing = state.get(user, {})
        if not existing or ts > existing.get('timestamp', ''):
            state[user] = {'machine': mach, 'timestamp': ts, 'ip': ip}
            updated += 1

with open(state_file, 'w') as f:
    json.dump(state, f, indent=2)

print(f'[parse-logins] {updated} entradas actualizadas, {len(state)} usuarios en estado')
PYEOF

log "Listo. Estado en $STATE_FILE"
