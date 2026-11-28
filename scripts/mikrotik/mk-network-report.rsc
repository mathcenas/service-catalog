# ==============================================================
# mk-network-report.rsc  v1.3.1
# Manda al portal Cenas IT cómo está armada la red del router:
#   - redes LAN, WAN e IP pública (PPPoE / DHCP / IP Cloud)
#   - nombre DDNS de IP Cloud
#   - túneles WireGuard: peers, endpoint, redes permitidas, último handshake
#   - IPsec: peers y policies, con su estado (ph2-state)
#   - vecinos por LLDP/CDP/MNDP (switches, APs, otros MikroTik) con el puerto de cada enlace:
#     el portal arma con eso el mapa del sitio (reemplaza a net-topology-report.rsc)
#   - equipos de la LAN (ARP + tabla del bridge): IP, MAC y puerto del router por el que se los ve.
#     El mapa muestra en qué puerto está cada servidor, o detrás de qué switch
#   - seguridad (1.3.0): servicios del router, VPN encendidas, puertos abiertos a Internet,
#     bloqueo de fuerza bruta, netwatch y logs a disco. El portal lo compara con el estándar
#     Cenas (ver mk-baseline.rsc) y abre un ticket si el firewall no bloquea lo que entra de Internet
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

:local scriptVersion "1.3.1"
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

# ── IPsec ──────────────────────────────────────────────────
:local ipsecPolicies [:toarray ""]
# Peers con alguna policy establecida (active-peers no siempre trae el nombre del peer)
:local upPeers ","

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
    :if ($state = "established") do={ :set upPeers ($upPeers . $peer . ",") }
    :set ($ipsecPolicies->[:len $ipsecPolicies]) {"src_address"=$src; "dst_address"=$dst; "peer"=$peer; "disabled"=$dis; "ph2_state"=$state; "comment"=$comment}
  }
}

# ── IPsec: peers ─────────────────────────────────────────────────────
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
    :if (($apPeer != "" && $apPeer = $pName) || ($pAddr != "" && $apRemote != "" && [:typeof [:find $pAddr $apRemote]] = "num")) do={
      :set active true
      :set activeRemote $apRemote
      :do { :set activeUptime [:tostr [/ip/ipsec/active-peers/get $ap uptime]] } on-error={}
    }
  }
  :if ([:typeof [:find $upPeers ("," . $pName . ",")]] = "num") do={ :set active true }
  :set ($ipsecPeers->[:len $ipsecPeers]) {"name"=$pName; "address"=$pAddr; "disabled"=$pDis; "established"=$active; "remote_address"=$activeRemote; "uptime"=$activeUptime}
}

# ── Vecinos (LLDP/CDP/MNDP) para el mapa del sitio ───────────
# Mismo criterio que net-topology-report.rsc: el portal muestra en el mapa la infraestructura
# (router, switch, AP) y deja teléfonos y PCs en "Descubiertos".
:local routerMac ""
:foreach iface in=[/interface/ethernet/find] do={
  :if ($routerMac = "") do={ :set routerMac [/interface/ethernet/get $iface mac-address] }
}
:local routerLanIp ""
:if ([:len $lans] > 0) do={
  :local a (($lans->0)->"address")
  :set routerLanIp [:pick $a 0 [:find $a "/"]]
}
:local topoDevices [:toarray ""]
:local topoEdges [:toarray ""]
:set ($topoDevices->0) {"name"=[/system/identity/get name]; "device_type"="router"; "ip_address"=$routerLanIp; "mac_address"=$routerMac; "model"=[/system/resource/get board-name]; "status"="online"}
:foreach n in=[/ip/neighbor/find] do={
  :local nMac ""
  :do { :set nMac [:tostr [/ip/neighbor/get $n mac-address]] } on-error={}
  :if ($nMac != "") do={
    :local nIp ""
    :local nName ""
    :local nPlatform ""
    :local nBoard ""
    :local nCaps ""
    :local nIface ""
    :local nRemote ""
    :do { :set nIp [:tostr [/ip/neighbor/get $n address]] } on-error={}
    :do { :set nName [:tostr [/ip/neighbor/get $n identity]] } on-error={}
    :do { :set nPlatform [:tostr [/ip/neighbor/get $n platform]] } on-error={}
    :do { :set nBoard [:tostr [/ip/neighbor/get $n board]] } on-error={}
    :do { :set nCaps [:tostr [/ip/neighbor/get $n system-caps-enabled]] } on-error={}
    :if ($nCaps = "") do={ :do { :set nCaps [:tostr [/ip/neighbor/get $n system-caps]] } on-error={} }
    :do { :set nIface [:tostr [/ip/neighbor/get $n interface]] } on-error={}
    :do { :set nRemote [:tostr [/ip/neighbor/get $n interface-name]] } on-error={}
    :local hasName ($nName != "")
    :if (!$hasName) do={ :set nName $nMac }
    :local all ("$nPlatform $nBoard")
    :local nType "endpoint"
    :if ([:typeof [:find $nCaps "bridge"]] = "num" || [:typeof [:find $nCaps "switch"]] = "num") do={ :set nType "switch_managed" }
    :if ([:typeof [:find $nCaps "router"]] = "num") do={ :set nType "router" }
    :if ([:typeof [:find $nCaps "wlan"]] = "num" || [:typeof [:find $nCaps "wap"]] = "num") do={ :set nType "ap" }
    :if ([:typeof [:find $nCaps "telephone"]] = "num") do={ :set nType "phone" }
    :if ([:typeof [:find $all "MikroTik"]] = "num") do={ :set nType "router" }
    :if ([:typeof [:find $all "CRS"]] = "num" || [:typeof [:find $all "CSS"]] = "num") do={ :set nType "switch_managed" }
    :if ([:typeof [:find $all "cAP"]] = "num" || [:typeof [:find $all "wAP"]] = "num" || [:typeof [:find $all "UAP"]] = "num" || [:typeof [:find $all "U6"]] = "num" || [:typeof [:find $all "U7"]] = "num") do={ :set nType "ap" }
    :if ([:typeof [:find $all "USW"]] = "num" || [:typeof [:find $all "US-"]] = "num") do={ :set nType "switch_managed" }
    :if (!$hasName && $nCaps = "" && $nPlatform = "") do={ :set nType "endpoint" }
    :set ($topoDevices->[:len $topoDevices]) {"name"=$nName; "device_type"=$nType; "ip_address"=$nIp; "mac_address"=$nMac; "model"=[:pick $all 0 80]; "status"="online"}
    # Los vecinos que el router ve por un túnel no son enlaces físicos
    :if ([:len [/interface/wireguard/find where name=$nIface]] = 0) do={
      :set ($topoEdges->[:len $topoEdges]) {"source_mac"=$routerMac; "target_mac"=$nMac; "source_port"=$nIface; "target_port"=$nRemote; "link_type"="utp"}
    }
  }
}

# ── Equipos de la LAN: IP, MAC y puerto donde el router los ve ──
# El puerto sale de la tabla del bridge (MAC → ether); si no hay bridge, es la interfaz del ARP.
:local hosts [:toarray ""]
:foreach a in=[/ip/arp/find] do={
  :if ([:len $hosts] < 300) do={
    :local hIp ""
    :local hMac ""
    :local hIface ""
    :do { :set hIp [:tostr [/ip/arp/get $a address]] } on-error={}
    :do { :set hMac [:tostr [/ip/arp/get $a mac-address]] } on-error={}
    :do { :set hIface [:tostr [/ip/arp/get $a interface]] } on-error={}
    :local hIpT [:toip $hIp]
    :local hPriv (($hIpT in 10.0.0.0/8) || ($hIpT in 172.16.0.0/12) || ($hIpT in 192.168.0.0/16))
    :if ($hMac != "" && $hPriv && [:len [/interface/wireguard/find where name=$hIface]] = 0) do={
      :local hPort ""
      :do {
        :foreach b in=[/interface/bridge/host/find where mac-address=$hMac] do={
          :if ($hPort = "") do={
            :local isLocal false
            :do { :set isLocal [/interface/bridge/host/get $b local] } on-error={}
            :if (!$isLocal) do={ :set hPort [:tostr [/interface/bridge/host/get $b on-interface]] }
          }
        }
      } on-error={}
      :if ($hPort = "") do={ :set hPort $hIface }
      :set ($hosts->[:len $hosts]) {"ip"=$hIp; "mac"=$hMac; "port"=$hPort}
    }
  }
}

# Cada cuánto corre (scheduler): el portal ajusta a eso cuándo da el dato por viejo o el router por caído
:local reportEvery 0
:do {
  :local sch [/system/scheduler/find where on-event~"mk-network-report"]
  :if ([:len $sch] > 0) do={ :set reportEvery [:tonum [/system/scheduler/get ($sch->0) interval]] }
} on-error={}

# ── Seguridad: se compara en el portal con el estándar Cenas (mk-baseline.rsc) ──
:local svcList [:toarray ""]
:foreach s in=[/ip/service/find] do={
  :local sAddr ""
  :do { :set sAddr [:tostr [/ip/service/get $s address]] } on-error={}
  :set ($svcList->[:len $svcList]) {"name"=[/ip/service/get $s name]; "port"=[/ip/service/get $s port]; "disabled"=[/ip/service/get $s disabled]; "address"=$sAddr}
}
:local vpnPptp false
:local vpnSstp false
:local vpnL2tp false
:local vpnOvpn false
:do { :set vpnPptp [/interface/pptp-server/server/get enabled] } on-error={}
:do { :set vpnSstp [/interface/sstp-server/server/get enabled] } on-error={}
:do { :set vpnL2tp [/interface/l2tp-server/server/get enabled] } on-error={}
# OpenVPN: hasta 7.16 es un único servidor (get enabled); desde 7.17 es una lista (find).
# Con :parse el comando se interpreta al correr, así la versión que no corresponde no rompe el script.
:do {
  :set vpnOvpn [[:parse ":return [/interface/ovpn-server/server/get enabled]"]]
} on-error={
  :do { :set vpnOvpn ([:len [[:parse ":return [/interface/ovpn-server/server/find where disabled=no]"]]] > 0) } on-error={}
}
:local pppActive 0
:local pppSecrets 0
:do { :set pppActive [:len [/ppp/active/find]] } on-error={}
:do { :set pppSecrets [:len [/ppp/secret/find where disabled=no]] } on-error={}

# Regla final de fábrica: descarta lo que entra desde Internet
:local dropWan (([:len [/ip/firewall/filter/find where chain=input action=drop disabled=no in-interface-list="!LAN"]] + [:len [/ip/firewall/filter/find where chain=input action=drop disabled=no in-interface-list="WAN"]]) > 0)
:local wanList ([:len [/interface/list/member/find where list="WAN"]] > 0)
:local pptpBrute ([:len [/ip/firewall/filter/find where chain=input action=drop disabled=no src-address-list="pptp-block"]] > 0)
:local blockedIps [:len [/ip/firewall/address-list/find where list="pptp-block"]]
:local uyRanges [:len [/ip/firewall/address-list/find where list="pais-uy"]]

# Puertos que el firewall acepta en el router (input): a quién (lista/IP) o a todos
:local fwPorts [:toarray ""]
:foreach r in=[/ip/firewall/filter/find where chain=input action=accept disabled=no] do={
  :local dp ""
  :local proto ""
  :local sal ""
  :local sa ""
  :local iil ""
  :local ii ""
  :local cs ""
  :local cmt ""
  :do { :set dp [:tostr [/ip/firewall/filter/get $r dst-port]] } on-error={}
  :do { :set proto [:tostr [/ip/firewall/filter/get $r protocol]] } on-error={}
  :do { :set sal [:tostr [/ip/firewall/filter/get $r src-address-list]] } on-error={}
  :do { :set sa [:tostr [/ip/firewall/filter/get $r src-address]] } on-error={}
  :do { :set iil [:tostr [/ip/firewall/filter/get $r in-interface-list]] } on-error={}
  :do { :set ii [:tostr [/ip/firewall/filter/get $r in-interface]] } on-error={}
  :do { :set cs [:tostr [/ip/firewall/filter/get $r connection-state]] } on-error={}
  :do { :set cmt [:tostr [/ip/firewall/filter/get $r comment]] } on-error={}
  :if ($dp != "" && $cs = "" && $iil != "LAN") do={
    :local only $sal
    :if ($only = "") do={ :set only $sa }
    :set ($fwPorts->[:len $fwPorts]) {"port"=$dp; "protocol"=$proto; "only_from"=$only; "in_interface"=$ii; "comment"=[:pick $cmt 0 60]}
  }
}

:local dnsRemote false
:do { :set dnsRemote [/ip/dns/get allow-remote-requests] } on-error={}
# IP de la LAN puesta en un puerto del bridge (en vez del bridge)
:local lanOnSlave [:toarray ""]
:foreach l in=$lans do={
  :local li ($l->"interface")
  :if ([:len [/interface/bridge/port/find where interface=$li]] > 0) do={ :set ($lanOnSlave->[:len $lanOnSlave]) $li }
}
:local loopProtect 0
:do { :set loopProtect [:len [/interface/ethernet/find where loop-protect="on"]] } on-error={}
:local nwList [:toarray ""]
:do {
  :foreach n in=[/tool/netwatch/find] do={
    :local nCmt ""
    :local nSince ""
    :local nStatus ""
    :do { :set nCmt [:tostr [/tool/netwatch/get $n comment]] } on-error={}
    :do { :set nSince [:tostr [/tool/netwatch/get $n since]] } on-error={}
    :do { :set nStatus [:tostr [/tool/netwatch/get $n status]] } on-error={}
    :set ($nwList->[:len $nwList]) {"host"=[:tostr [/tool/netwatch/get $n host]]; "comment"=$nCmt; "status"=$nStatus; "since"=$nSince; "disabled"=[/tool/netwatch/get $n disabled]}
  }
} on-error={}
:local diskTopics ""
:foreach lg in=[/system/logging/find where action="disk" disabled=no] do={
  :set diskTopics ($diskTopics . [:tostr [/system/logging/get $lg topics]] . ";")
}
:local adminUser ([:len [/user/find where name="admin" disabled=no]] > 0)

:if (!$dropWan) do={
  :set ($issues->[:len $issues]) "Firewall: el router no descarta lo que entra desde Internet (falta o está deshabilitada la regla 'drop all not coming from LAN')"
}
:local security {"services"=$svcList; "vpn_servers"={"pptp"=$vpnPptp; "sstp"=$vpnSstp; "l2tp"=$vpnL2tp; "ovpn"=$vpnOvpn}; "ppp_active"=$pppActive; "ppp_secrets"=$pppSecrets; "drop_wan"=$dropWan; "wan_list"=$wanList; "pptp_bruteforce"=$pptpBrute; "blocked_ips"=$blockedIps; "uy_ranges"=$uyRanges; "fw_ports"=$fwPorts; "dns_remote"=$dnsRemote; "lan_on_slave"=$lanOnSlave; "loop_protect_ports"=$loopProtect; "netwatch"=$nwList; "disk_logging"=$diskTopics; "admin_user"=$adminUser}

# ── Payload y envío ──────────────────────────────────────────
:local status "ok"
:local message ("Red OK: " . [:len $lans] . " LAN, " . [:len $wgList] . " WireGuard, " . [:len $ipsecPolicies] . " policies IPsec")
:if ([:len $issues] > 0) do={
  :set status "failed"
  :set message ([:len $issues] . " problema(s): " . [:pick ($issues->0) 0 150])
}

:local payload {"script_version"=$scriptVersion; "identity"=[/system/identity/get name]; "board"=[/system/resource/get board-name]; "routeros_version"=[/system/resource/get version]; "uptime"=[:tostr [/system/resource/get uptime]]; "public_ip"=$publicIp; "ddns_name"=$ddnsName; "lans"=$lans; "wans"=$wans; "wireguard"=$wgList; "ipsec_peers"=$ipsecPeers; "ipsec_policies"=$ipsecPolicies; "router_mac"=$routerMac; "report_interval_s"=$reportEvery; "hosts"=$hosts; "topology"={"devices"=$topoDevices; "edges"=$topoEdges}; "security"=$security; "issues"=$issues}
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
