# ==============================================================
# net-topology-report.rsc
# Reporta la topología de red al portal Cenas IT
#
# INSTALACIÓN:
#   1. Editá las variables SITE_ID e INGEST_SECRET abajo
#   2. En el router: System → Scripts → Agregar con este contenido
#   3. En el router: System → Scheduler → cada 1 hora:
#      On Event: /system/script/run net-topology-report
#
# Requiere: RouterOS 7.x, acceso a internet desde el router
# v2: clasifica vecinos por system-caps (router / switch / AP / teléfono / equipo final)
# ==============================================================

# ── Configuración (editá estos valores) ──────────────────────
:local siteId        "SITE_ID_AQUI"
:local ingestSecret  "INGEST_SECRET_AQUI"
:local supabaseUrl   "https://TU_PROJECT.supabase.co"
:local supabaseAnon  "TU_ANON_KEY_AQUI"
# ─────────────────────────────────────────────────────────────

:local ingestUrl "$supabaseUrl/functions/v1/ingest-net-topology"

# ── Identidad del router ──────────────────────────────────────
:local routerName    [/system/identity/get name]
:local routerBoard   [/system/resource/get board-name]
:local routerVersion [/system/resource/get version]

# Primera IP en la tabla (la de gestión)
:local routerIp ""
:foreach a in=[/ip/address/find !dynamic] do={
  :if ($routerIp = "") do={
    :local raw [/ip/address/get $a address]
    :local slash [:find $raw "/"]
    :set routerIp [:pick $raw 0 $slash]
  }
}

# MAC del primer puerto ethernet
:local routerMac ""
:foreach iface in=[/interface/ethernet/find] do={
  :if ($routerMac = "") do={
    :set routerMac [/interface/ethernet/get $iface mac-address]
  }
}

# ── Construir lista de dispositivos ──────────────────────────
# Empezar con el router mismo
:local devJson "{\"name\":\"$routerName\",\"device_type\":\"router\",\"ip_address\":\"$routerIp\",\"mac_address\":\"$routerMac\",\"model\":\"$routerBoard\",\"status\":\"online\"}"

# Agregar vecinos vía LLDP/CDP (switches, APs, otros routers)
:foreach n in=[/ip/neighbor/find] do={
  :local nMac      [/ip/neighbor/get $n mac-address]
  :local nIp       ""
  :local nName     [/ip/neighbor/get $n identity]
  :local nPlatform ""
  :local nBoard    ""
  :local nCaps     ""

  :do { :set nIp       [/ip/neighbor/get $n address]  } on-error={}
  :do { :set nPlatform [/ip/neighbor/get $n platform] } on-error={}
  :do { :set nBoard    [/ip/neighbor/get $n board]    } on-error={}
  :do { :set nCaps     [:tostr [/ip/neighbor/get $n system-caps-enabled]] } on-error={}
  :if ($nCaps = "") do={ :do { :set nCaps [:tostr [/ip/neighbor/get $n system-caps]] } on-error={} }
  :local hasName ($nName != "")
  :if ($nName = "") do={ :set nName $nMac }

  # Tipo de equipo según lo que anuncia (system-caps) y la plataforma/modelo.
  # El portal muestra en el mapa solo infraestructura (router, switch, AP);
  # teléfonos y PCs quedan en la lista de "descubiertos".
  :local nType "endpoint"
  :local all ("$nPlatform $nBoard")
  :if ([:typeof [:find $nCaps "bridge"]] = "num" || [:typeof [:find $nCaps "switch"]] = "num") do={ :set nType "switch_managed" }
  :if ([:typeof [:find $nCaps "router"]] = "num") do={ :set nType "router" }
  :if ([:typeof [:find $nCaps "wlan"]] = "num" || [:typeof [:find $nCaps "wap"]] = "num") do={ :set nType "ap" }
  :if ([:typeof [:find $nCaps "telephone"]] = "num") do={ :set nType "phone" }
  :if ([:typeof [:find $all "MikroTik"]] = "num") do={ :set nType "router" }
  :if ([:typeof [:find $all "CRS"]] = "num" || [:typeof [:find $all "CSS"]] = "num") do={ :set nType "switch_managed" }
  :if ([:typeof [:find $all "cAP"]] = "num" || [:typeof [:find $all "wAP"]] = "num" || [:typeof [:find $all "UAP"]] = "num" || [:typeof [:find $all "U6"]] = "num" || [:typeof [:find $all "U7"]] = "num") do={ :set nType "ap" }
  :if ([:typeof [:find $all "USW"]] = "num" || [:typeof [:find $all "US-"]] = "num") do={ :set nType "switch_managed" }
  # Sin nombre ni capacidades: casi seguro una PC o un equipo final
  :if (!$hasName && $nCaps = "" && $nPlatform = "") do={ :set nType "endpoint" }

  :local nModel [:pick ("$nPlatform $nBoard") 0 80]
  :set devJson "$devJson,{\"name\":\"$nName\",\"device_type\":\"$nType\",\"ip_address\":\"$nIp\",\"mac_address\":\"$nMac\",\"model\":\"$nModel\",\"status\":\"online\"}"
}

# ── Construir links (router → cada vecino LLDP) ──────────────
:local edgeJson ""
:foreach n in=[/ip/neighbor/find] do={
  :local nMac     [/ip/neighbor/get $n mac-address]
  :local srcIface [/ip/neighbor/get $n interface]
  :local tgtIface ""
  :do { :set tgtIface [/ip/neighbor/get $n interface-name] } on-error={}

  :local linkEntry "{\"source_mac\":\"$routerMac\",\"target_mac\":\"$nMac\",\"source_port\":\"$srcIface\",\"target_port\":\"$tgtIface\",\"link_type\":\"utp\"}"
  :if ($edgeJson = "") do={
    :set edgeJson $linkEntry
  } else={
    :set edgeJson "$edgeJson,$linkEntry"
  }
}

# ── Payload final ─────────────────────────────────────────────
:local payload "{\"site_id\":\"$siteId\",\"source\":\"mikrotik\",\"devices\":[$devJson],\"edges\":[$edgeJson]}"

# ── POST al ingest ────────────────────────────────────────────
:do {
  /tool/fetch \
    url=$ingestUrl \
    http-method=post \
    http-header-field="Content-Type: application/json,X-Ingest-Secret: $ingestSecret,apikey: $supabaseAnon,Authorization: Bearer $supabaseAnon" \
    http-data=$payload \
    output=none

  :log info "[net-topology] reporte enviado OK: $routerName -> $siteId"
} on-error={
  :log error "[net-topology] error al enviar reporte para $routerName"
}
