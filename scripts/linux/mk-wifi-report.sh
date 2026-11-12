#!/usr/bin/env bash
# =============================================================
# mk-wifi-report.sh — Dispositivos conectados al Wi-Fi de cada MikroTik
#
# Lee por REST API la tabla de registración Wi-Fi del router y la cruza con
# los leases DHCP (IP, nombre de equipo, comentario) y la tabla ARP. Lo manda
# al portal (ingest-wifi-clients), que guarda primera y última vez vista de
# cada dispositivo. Reporte en Telemetría → Wi-Fi.
#
# Soporta los tres sabores de Wi-Fi de RouterOS:
#   /interface/wifi        (RouterOS 7.13+, paquete wifi)
#   /interface/wifiwave2   (RouterOS 7 anteriores)
#   /interface/wireless    (paquete wireless clásico)
#   /caps-man              (CAPsMAN clásico: APs gestionados por el router)
#
# Usa la misma config que mk-monitor.sh (mk-monitor.conf): SERVICE_ID,
# INGEST_SECRET, ROUTER_IP, ROUTER_USER, ROUTER_PASS de cada sitio.
# Opcional por sitio: SITE_N_WIFI="false" para no reportar ese router.
#
# CRON (crontab -e) — cada hora:
#   7 * * * * /srv/network-monitor/mk-wifi-report.sh >> /srv/network-monitor/logs/mk-wifi-report.log 2>&1
#
# Requiere: curl, jq. El usuario "monitor" (setup.rsc) es de solo lectura y alcanza.
# =============================================================

SCRIPT_VERSION="1.1.0"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF_FILE="${1:-${SCRIPT_DIR}/mk-monitor.conf}"

if [[ ! -f "$CONF_FILE" ]]; then
  echo "ERROR: config no encontrada: $CONF_FILE" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "$CONF_FILE"

: "${SUPABASE_URL:?mk-wifi-report: SUPABASE_URL no configurado}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-$ANON_KEY}"
: "${SUPABASE_ANON_KEY:?mk-wifi-report: SUPABASE_ANON_KEY (o ANON_KEY) no configurado}"
: "${SITE_COUNT:?mk-wifi-report: SITE_COUNT no configurado}"
command -v jq >/dev/null || { echo "ERROR: falta jq (apt install jq)" >&2; exit 1; }

INGEST_URL="${SUPABASE_URL}/functions/v1/ingest-wifi-clients"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }

# GET a la REST API del router. Imprime el JSON (o "[]" si falla / no existe el menú).
router_get() {
  local ip="$1" user="$2" pass="$3" path="$4" body code
  body=$(curl -ks --max-time 15 -u "${user}:${pass}" -w '\n%{http_code}' "https://${ip}/rest${path}" 2>/dev/null)
  code="${body##*$'\n'}"
  body="${body%$'\n'*}"
  if [[ "$code" == "200" ]] && echo "$body" | jq -e 'type == "array"' >/dev/null 2>&1; then
    echo "$body"
  else
    echo "[]"
  fi
}

report_site() {
  local site="$1" service_id="$2" secret="$3" ip="$4" user="$5" pass="$6"

  # Tabla de registración: el primer menú que responda con datos
  local reg="[]" flavor="" ifaces="[]"
  for f in wifi wifiwave2 wireless; do
    reg=$(router_get "$ip" "$user" "$pass" "/interface/${f}/registration-table")
    if [[ "$(echo "$reg" | jq 'length')" -gt 0 ]]; then
      flavor="$f"
      ifaces=$(router_get "$ip" "$user" "$pass" "/interface/${f}")
      break
    fi
  done
  if [[ -z "$flavor" ]]; then
    reg=$(router_get "$ip" "$user" "$pass" "/caps-man/registration-table")
    [[ "$(echo "$reg" | jq 'length')" -gt 0 ]] && flavor="capsman"
  fi

  local leases arp
  leases=$(router_get "$ip" "$user" "$pass" "/ip/dhcp-server/lease")
  arp=$(router_get "$ip" "$user" "$pass" "/ip/arp")
  # Vecinos (MNDP/LLDP/CDP): nombre de switches, APs y otros equipos de red
  local neighbors
  neighbors=$(router_get "$ip" "$user" "$pass" "/ip/neighbor")

  # Normalizar a: mac, ip, hostname, comment, ssid, interface, signal, tx_rate, rx_rate, uptime
  local clients
  clients=$(jq -n \
    --argjson reg "$reg" --argjson ifaces "$ifaces" --argjson leases "$leases" --argjson arp "$arp" --argjson nb "$neighbors" '
    def up: ascii_upcase;
    def num: ((tostring | capture("(?<n>-?[0-9]+)") | .n | tonumber)? // null);
    ($ifaces | map({ key: .name, value: (.ssid // ."configuration.ssid" // null) }) | from_entries) as $ssidByIf
    | ($leases | map(select(."mac-address") | { key: (."mac-address" | up), value: . }) | from_entries) as $lease
    | ($arp | map(select(."mac-address") | { key: (."mac-address" | up), value: .address }) | from_entries) as $arpIp
    | ($nb | map(select(."mac-address" and .identity) | { key: (."mac-address" | up), value: .identity }) | from_entries) as $nbName
    | $reg
    | map(select(."mac-address"))
    | map(
        (."mac-address" | up) as $mac
        | ($lease[$mac] // {}) as $l
        | {
            mac:       $mac,
            ip:        ($l."active-address" // $l.address // $arpIp[$mac] // ."last-ip" // null),
            hostname:  ($l."host-name" // $nbName[$mac] // null),
            comment:   ($l.comment // .comment // null),
            ssid:      (.ssid // $ssidByIf[.interface] // null),
            interface: (.interface // null),
            signal:    ((.signal // ."signal-strength" // ."rx-signal") | if . == null then null else num end),
            tx_rate:   (."tx-rate" // null),
            rx_rate:   (."rx-rate" // null),
            uptime:    (.uptime // null)
          }
      )')

  local count
  count=$(echo "$clients" | jq 'length')

  if [[ -z "$flavor" ]]; then
    # Sin Wi-Fi en el router (o sin permisos): no mandar nada, así no marca a todos como desconectados
    log "[$site] sin tabla de registración Wi-Fi (el router no tiene Wi-Fi, o no responde) — se omite"
    return 0
  fi

  local payload http
  payload=$(jq -n --arg sid "$service_id" --arg ver "$SCRIPT_VERSION" --arg fl "$flavor" --argjson c "$clients" \
    '{ service_id: $sid, script_version: $ver, flavor: $fl, clients: $c }')
  http=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 -X POST "$INGEST_URL" \
    -H "Content-Type: application/json" \
    -H "apikey: ${SUPABASE_ANON_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
    -H "X-Ingest-Secret: ${secret}" \
    -d "$payload")
  log "[$site] ${count} dispositivo(s) Wi-Fi (${flavor}) — HTTP ${http}"
}

log "mk-wifi-report.sh v${SCRIPT_VERSION}"
for i in $(seq 1 "$SITE_COUNT"); do
  v="SITE_${i}_NAME";          name="${!v:-}"
  v="SITE_${i}_SERVICE_ID";    sid="${!v:-}"
  v="SITE_${i}_INGEST_SECRET"; sec="${!v:-}"
  v="SITE_${i}_ROUTER_IP";     rip="${!v:-}"
  v="SITE_${i}_ROUTER_USER";   ru="${!v:-monitor}"
  v="SITE_${i}_ROUTER_PASS";   rp="${!v:-}"
  v="SITE_${i}_WIFI";          wifi="${!v:-true}"

  if [[ "$wifi" == "false" ]]; then log "[$name] Wi-Fi desactivado en la config — se omite"; continue; fi
  if [[ -z "$name" || -z "$sid" || -z "$sec" || -z "$rip" || -z "$rp" ]]; then
    log "SKIP SITE_${i} — configuración incompleta"
    continue
  fi
  report_site "$name" "$sid" "$sec" "$rip" "$ru" "$rp"
done
