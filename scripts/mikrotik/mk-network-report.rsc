# ==============================================================
# mk-network-report.rsc  v1.0.0
# Manda al portal Cenas IT cómo está armada la red del router:
#   - redes LAN, WAN e IP pública (PPPoE / DHCP / IP Cloud)
#   - nombre DDNS de IP Cloud
#   - túneles WireGuard: peers, endpoint, redes permitidas, último handshake
#   - IPsec: peers y policies, con su estado (ph2-state)
# Si un túnel que este router debería mantener está caído, el reporte sale
# en "failed" con el problema en "issues" y el portal abre un ticket.
#
# NO manda claves privadas (ni de WireGuard ni de IPsec): solo claves públicas.
#
# INSTALACIÓN:
#   1. En el portal, el router tiene que existir como servicio (tipo Router / Firewall).
#      Copiá su id y su ingest secret y completá las variables de abajo.
#   2. System → Scripts → Add: nombre "mk-network-report", pegar este contenido.
#   3. System → Scheduler → Add: intervalo 1h,
#      On Event: /system/script/run mk-network-report
#   4. Probá: /system/script/run mk-network-report
#      y mirá el log: /log print where message~"mk-network"
#
# Requiere RouterOS 7.13 o más nuevo (usa :serialize para armar el JSON)
# y salida a internet desde el router.
#
# Túneles que se vigilan:
#   - Peers WireGuard con endpoint (este router llama al otro extremo: sitio remoto).
#     Caído = más de 5 min sin handshake.
#   - Peers WireGuard del lado del centro (sin endpoint): solo si el peer tiene
#     "[monitor]" en el comentario.
#   - Policies IPsec activas (no template) que no están en ph2-state=established.
# ==============================================================

# ── Configuración (editá estos valores) ──────────────────────
:local serviceId     "SERVICE_ID_AQUI"
:local ingestSecret  "INGEST_SECRET_AQUI"
:local supabaseUrl   "https://TU_PROJECT.supabase.co"
:local supabaseAnon  "TU_ANON_KEY_AQUI"
# Minutos sin handshake para dar un túnel WireGuard por caído
:local wgDownMinutes 5
# ─────────────────────────────────────────────────────────────

:local scriptVersion "1.0.0"
:local issues [:toarray ""]

# ── Redes (LAN / WAN) ─────────────────────────────────────────
:local lans [:toarray ""]
:local wans [:toarray ""]
:local publicIp ""
:foreach a in=[/ip/address/find where disabled=no] do={
  :local addr  [/ip/address/get $a address]
  :local iface [/ip/address/get $a interface]
  :local net   [/ip/address/get $a network]
  :local slash [:find $addr "/"]
  :local ip    [:pick $addr 0 $slash]
  :local pfx   [:pick $addr ($slash + 1) [:len $addr]]
  :local ipT   [:toip $ip]
  :local isPrivate (($ipT in 10.0.0.0/8) || ($ipT in 172.16.0.0/12) || ($ipT in 192.168.0.0/16) || ($ipT in 100.64.0.0/10))
  :local isWg ([:len [/interface/wireguard/find where name=$iface]] > 0)
  :local isPppoe ([:len [/interface/pppoe-client/find where name=$iface]] > 0)
  :local isDhcpWan ([:len [/ip/dhcp-client/find where interface=$iface]] > 0)
  :local entry {"interface"=$iface; "address"=$addr; "network"=($net . "/" . $pfx)}
  :if ($isPppoe || $isDhcpWan || !$isPrivate) do={
    :set ($wans->[:len $wans]) $entry
    :if (!$isPrivate && $publicIp = "") do={ :set publicIp $ip }
  } else={
    :if (!$isWg) do={ :set ($lans->[:len $lans]) $entry }
  }
}

# IP Cloud (DDNS de MikroTik) — sirve también para la IP pública detrás de otro router
:local ddnsName ""
:local cloudIp ""
:do { :set ddnsName [/ip/cloud/get dns-name] } on-error={}
:do { :set cloudIp [:tostr [/ip/cloud/get public-address]] } on-error={}
:if ($publicIp = "" && $cloudIp != "") do={ :set publicIp $cloudIp }

# ── WireGuard ─────────────────────────────────────────────────
:local wgList [:toarray ""]
:foreach w in=[/interface/wireguard/find] do={
  :local wName [/interface/wireguard/get $w name]
  :local wAddr ""
  :foreach a in=[/ip/address/find where interface=$wName] do={
    :if ($wAddr = "") do={ :set wAddr [/ip/address/get $a address] }
  }
  :local peers [:toarray ""]
  :foreach p in=[/interface/wireguard/peers/find where interface=$wName] do={
    :local pName ""
    :do { :set pName [/interface/wireguard/peers/get $p name] } on-error={}
    :local pComment ""
    :do { :set pComment [:tostr [/interface/wireguard/peers/get $p comment]] } on-error={}
    :if ($pName = "") do={ :set pName $pComment }
    :local pDisabled [/interface/wireguard/peers/get $p disabled]
    :local pEndpoint [:tostr [/interface/wireguard/peers/get $p endpoint-address]]
    :local pPort [:tostr [/interface/wireguard/peers/get $p endpoint-port]]
    :local pCurrent ""
    :do { :set pCurrent [:tostr [/interface/wireguard/peers/get $p current-endpoint-address]] } on-error={}
    :local pAllowed [:tostr [/interface/wireguard/peers/get $p allowed-address]]
    :local pKeep ""
    :do { :set pKeep [:tostr [/interface/wireguard/peers/get $p persistent-keepalive]] } on-error={}
    :local pPub [/interface/wireguard/peers/get $p public-key]
    :local hs [/interface/wireguard/peers/get $p last-handshake]
    :local hsSec -1
    :if ([:typeof $hs] = "time") do={ :set hsSec [:tonum $hs] }
    :local rx 0
    :local tx 0
    :do { :set rx [/interface/wireguard/peers/get $p rx] } on-error={}
    :do { :set tx [/interface/wireguard/peers/get $p tx] } on-error={}

    # ¿Este router tiene que mantener el túnel arriba?
    :local watched false
    # Solo los peers con endpoint: este router llama al otro extremo (sitio remoto -> centro).
    # Los de notebooks y celulares (sin endpoint) no alertan aunque tengan keepalive.
    :if ($pEndpoint != "") do={ :set watched true }
    :if ([:typeof [:find $pComment "[monitor]"]] = "num") do={ :set watched true }
    :local up ($hsSec >= 0 && $hsSec <= ($wgDownMinutes * 60))
    :if ($watched && !$pDisabled && !$up) do={
      :local label $pName
      :if ($label = "") do={ :set label $pEndpoint }
      :if ($label = "") do={ :set label [:pick $pPub 0 8] }
      :if ($hsSec < 0) do={
        :set ($issues->[:len $issues]) ("VPN WireGuard " . $wName . " / " . $label . " caída: nunca se conectó")
      } else={
        :set ($issues->[:len $issues]) ("VPN WireGuard " . $wName . " / " . $label . " caída: sin conexión hace " . ($hsSec / 60) . " min")
      }
    }
    :set ($peers->[:len $peers]) {"name"=$pName; "comment"=$pComment; "disabled"=$pDisabled; "endpoint"=$pEndpoint; "endpoint_port"=$pPort; "current_endpoint"=$pCurrent; "allowed_address"=$pAllowed; "persistent_keepalive"=$pKeep; "public_key"=$pPub; "last_handshake_s"=$hsSec; "watched"=$watched; "up"=$up; "rx_bytes"=$rx; "tx_bytes"=$tx}
  }
  :set ($wgList->[:len $wgList]) {"name"=$wName; "address"=$wAddr; "listen_port"=[/interface/wireguard/get $w listen-port]; "mtu"=[/interface/wireguard/get $w mtu]; "public_key"=[/interface/wireguard/get $w public-key]; "disabled"=[/interface/wireguard/get $w disabled]; "running"=[/interface/wireguard/get $w running]; "peers"=$peers}
}

# ── IPsec ─────────────────────────────────────────────────────
:local ipsecPeers [:toarray ""]
:foreach p in=[/ip/ipsec/peer/find] do={
  :local pName [/ip/ipsec/peer/get $p name]
  :local pAddr ""
  :do { :set pAddr [:tostr [/ip/ipsec/peer/get $p address]] } on-error={}
  :local pDis [/ip/ipsec/peer/get $p disabled]
  :local active false
  :local activeRemote ""
  :local activeUptime ""
  :foreach ap in=[/ip/ipsec/active-peers/find where state="established"] do={
    :local apId ""
    :do { :set apId [:tostr [/ip/ipsec/active-peers/get $ap id]] } on-error={}
    :local apRemote [:tostr [/ip/ipsec/active-peers/get $ap remote-address]]
    :local apPeer ""
    :do { :set apPeer [:tostr [/ip/ipsec/active-peers/get $ap peer]] } on-error={}
    :if ($apPeer = $pName || ($pAddr != "" && [:typeof [:find $pAddr $apRemote]] = "num")) do={
      :set active true
      :set activeRemote $apRemote
      :do { :set activeUptime [:tostr [/ip/ipsec/active-peers/get $ap uptime]] } on-error={}
    }
  }
  :set ($ipsecPeers->[:len $ipsecPeers]) {"name"=$pName; "address"=$pAddr; "disabled"=$pDis; "established"=$active; "remote_address"=$activeRemote; "uptime"=$activeUptime}
}

:local ipsecPolicies [:toarray ""]
:foreach p in=[/ip/ipsec/policy/find where dynamic=no] do={
  :local isTemplate false
  :do { :set isTemplate [/ip/ipsec/policy/get $p template] } on-error={}
  :if (!$isTemplate) do={
    :local src [:tostr [/ip/ipsec/policy/get $p src-address]]
    :local dst [:tostr [/ip/ipsec/policy/get $p dst-address]]
    :local peer ""
    :do { :set peer [:tostr [/ip/ipsec/policy/get $p peer]] } on-error={}
    :local dis [/ip/ipsec/policy/get $p disabled]
    :local state ""
    :do { :set state [:tostr [/ip/ipsec/policy/get $p ph2-state]] } on-error={}
    :local comment ""
    :do { :set comment [:tostr [/ip/ipsec/policy/get $p comment]] } on-error={}
    :if (!$dis && $state != "established") do={
      :set ($issues->[:len $issues]) ("VPN IPsec " . $src . " -> " . $dst . " (" . $peer . ") sin establecer: " . $state)
    }
    :set ($ipsecPolicies->[:len $ipsecPolicies]) {"src_address"=$src; "dst_address"=$dst; "peer"=$peer; "disabled"=$dis; "ph2_state"=$state; "comment"=$comment}
  }
}

# ── Payload y envío ──────────────────────────────────────────
:local status "ok"
:local message ("Red OK: " . [:len $lans] . " LAN, " . [:len $wgList] . " WireGuard, " . [:len $ipsecPolicies] . " policies IPsec")
:if ([:len $issues] > 0) do={
  :set status "failed"
  :set message ([:len $issues] . " problema(s): " . [:pick ($issues->0) 0 150])
}

:local payload {"script_version"=$scriptVersion; "identity"=[/system/identity/get name]; "board"=[/system/resource/get board-name]; "routeros_version"=[/system/resource/get version]; "uptime"=[:tostr [/system/resource/get uptime]]; "public_ip"=$publicIp; "ddns_name"=$ddnsName; "lans"=$lans; "wans"=$wans; "wireguard"=$wgList; "ipsec_peers"=$ipsecPeers; "ipsec_policies"=$ipsecPolicies; "issues"=$issues}
:local body {"service_id"=$serviceId; "source"="mk-network"; "status"=$status; "message"=$message; "payload"=$payload}

:local json ""
:do {
  :set json [:serialize to=json value=$body]
} on-error={
  :log error "[mk-network] no se pudo armar el JSON: hace falta RouterOS 7.13 o más nuevo"
  :error "mk-network: RouterOS viejo"
}

:do {
  /tool/fetch url=($supabaseUrl . "/functions/v1/ingest-heartbeat") http-method=post \
    http-header-field=("Content-Type: application/json,X-Ingest-Secret: " . $ingestSecret . ",apikey: " . $supabaseAnon . ",Authorization: Bearer " . $supabaseAnon) \
    http-data=$json output=none
  :log info ("[mk-network] reporte enviado: " . $status . " - " . $message)
} on-error={
  :log error "[mk-network] error al enviar el reporte"
}
