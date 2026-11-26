# ==============================================================
# mk-baseline.rsc  v1.0.0
# Estándar Cenas para los MikroTik de los clientes. Aplica lo que falta SIN pisar lo que
# ya está y sin cortar servicio. Lo que puede cortar (mover la IP al bridge, loop-protect,
# cerrar Winbox) NO lo toca: solo lo avisa, para hacerlo fuera de hora.
#
# Qué aplica:
#   1. Apaga servicios del router inseguros o que no se usan: telnet, ftp, www, api, api-ssl
#      (Winbox, SSH y www-ssl quedan como están)
#   2. Log a disco de critical, interface y netwatch (no se pierde al reiniciar)
#   3. Netwatch cada 10 s: gateway del proveedor, Internet (8.8.8.8) y los equipos de $netwatchHosts
#   4. Si la VPN PPTP está prendida:
#        - lista "pais-uy" (script uy-list, ver mk-uy-list.rsc) y su scheduler semanal
#        - la regla que acepta PPTP pasa a aceptar solo desde Uruguay
#        - excepción para el monitoreo (lista "kuma", $kumaIps)
#        - bloqueo de fuerza bruta: 3+ conexiones en un par de minutos = 1 h bloqueada
#   5. Deshabilita (no borra) las reglas que aceptan SSTP / L2TP / IPsec si esos servicios
#      están apagados y no hay túneles IPsec
#   6. Scheduler de mk-network-report si falta
# Qué solo avisa:
#   - IP de la LAN en un puerto del bridge en vez del bridge
#   - falta la regla final "drop all not coming from LAN" o la lista WAN está vacía
#   - Winbox abierto a todo Internet
#   - usuario "admin" habilitado
#   - reglas de PPTP en mal orden
#
# INSTALACIÓN:
#   1. Instalá antes mk-network-report (y uy-list si el router tiene PPTP).
#   2. System → Scripts → Add: nombre "mk-baseline", pegar este contenido y completar la configuración.
#   3. Corré: /system/script/run mk-baseline
#      La salida lista cada cambio (+) y cada aviso (!). También queda en /log con "[baseline]".
#   Se puede correr las veces que haga falta: lo que ya está no se vuelve a agregar.
#   Al terminar manda un reporte nuevo al portal (Telemetría → Routers).
# ==============================================================

# ── Configuración ────────────────────────────────────────────
# IPs del monitoreo (Uptime Kuma) que chequean la VPN desde afuera de Uruguay. Ej: {"203.0.113.10"}
:local kumaIps [:toarray ""]
# Equipos de la LAN a vigilar con netwatch: {"IP"="nombre"}. Ej: {"192.168.1.100"="facturacion"; "192.168.1.250"="NAS"}
:local netwatchHosts [:toarray ""]
# Apagar telnet, ftp, www, api y api-ssl
:local disableInsecure true
# PPTP: limitar a Uruguay + bloqueo de fuerza bruta (false = no tocar la VPN de este router)
:local pptpProtect true
# Cada cuánto corre mk-network-report si hay que crearle el scheduler
:local reportEvery 8h
# ─────────────────────────────────────────────────────────────

:local changes 0
:local warns 0

# ── 1. Servicios del router ──────────────────────────────────
:if ($disableInsecure) do={
  :foreach n in={"telnet";"ftp";"www";"api";"api-ssl"} do={
    :foreach s in=[/ip/service/find where name=$n disabled=no] do={
      /ip/service/set $s disabled=yes
      :put ("+ servicio " . $n . " apagado")
      :log warning ("[baseline] servicio " . $n . " apagado")
      :set changes ($changes + 1)
    }
  }
}

# ── 2. Log a disco ───────────────────────────────────────────
:foreach t in={"critical";"interface";"netwatch"} do={
  :local found false
  :foreach lg in=[/system/logging/find where action="disk"] do={
    :if ([:typeof [:find [:tostr [/system/logging/get $lg topics]] $t]] = "num") do={ :set found true }
  }
  :if (!$found) do={
    :do {
      /system/logging/add topics=$t action=disk
      :put ("+ log a disco: " . $t)
      :set changes ($changes + 1)
    } on-error={ :put ("! no se pudo agregar el log a disco de " . $t) ; :set warns ($warns + 1) }
  }
}

# ── 3. Netwatch ──────────────────────────────────────────────
:local nw [:toarray ""]
:local gw ""
:do {
  :foreach r in=[/ip/route/find where dst-address=0.0.0.0/0 active=yes] do={
    :if ($gw = "") do={ :set gw [:tostr [/ip/route/get $r gateway]] }
  }
} on-error={}
:if ([:typeof [:toip $gw]] = "ip") do={ :set ($nw->$gw) "gateway" }
:set ($nw->"8.8.8.8") "internet"
:foreach h,c in=$netwatchHosts do={ :set ($nw->$h) $c }
:foreach h,c in=$nw do={
  :if ([:len [/tool/netwatch/find where host=$h]] = 0) do={
    :do {
      /tool/netwatch/add host=$h interval=10s timeout=1s comment=$c \
        down-script=(":log warning \"NW DOWN " . $c . " " . $h . "\"") \
        up-script=(":log info \"NW UP " . $c . " " . $h . "\"")
      :put ("+ netwatch: " . $c . " (" . $h . ")")
      :set changes ($changes + 1)
    } on-error={ :put ("! no se pudo agregar netwatch " . $h) ; :set warns ($warns + 1) }
  }
}

# ── 4. VPN PPTP: solo Uruguay + monitoreo, con bloqueo de fuerza bruta ──
:local pptpOn false
:do { :set pptpOn [/interface/pptp-server/server/get enabled] } on-error={}
:if ($pptpOn && !$pptpProtect) do={
  :put "! PPTP prendido y sin tocar (pptpProtect=false)"
  :set warns ($warns + 1)
}
:if ($pptpOn && $pptpProtect) do={
  :if ([:len [/system/script/find where name="uy-list"]] = 0) do={
    :put "! PPTP prendido pero falta el script uy-list (mk-uy-list.rsc): no se limita a Uruguay"
    :set warns ($warns + 1)
  } else={
    :if ([:len [/system/scheduler/find where name="uy-list"]] = 0) do={
      /system/scheduler/add name=uy-list interval=7d start-time=04:00:00 on-event="/system/script/run uy-list"
      :put "+ scheduler semanal de uy-list"
      :set changes ($changes + 1)
    }
    :if ([:len [/ip/firewall/address-list/find where list="pais-uy"]] = 0) do={
      :do { /system/script/run uy-list } on-error={}
    }
  }

  :foreach k in=$kumaIps do={
    :if ([:len [/ip/firewall/address-list/find where list="kuma" address=$k]] = 0) do={
      /ip/firewall/address-list/add list=kuma address=$k comment="Monitoreo Cenas (Kuma)"
      :put ("+ lista kuma: " . $k)
      :set changes ($changes + 1)
    }
  }

  # Regla que acepta PPTP desde cualquier lado -> solo Uruguay (si la lista ya está cargada)
  :local uyN [:len [/ip/firewall/address-list/find where list="pais-uy"]]
  :local openRule ""
  :foreach r in=[/ip/firewall/filter/find where chain=input action=accept disabled=no dst-port="1723"] do={
    :local sal ""
    :local sa ""
    :do { :set sal [:tostr [/ip/firewall/filter/get $r src-address-list]] } on-error={}
    :do { :set sa [:tostr [/ip/firewall/filter/get $r src-address]] } on-error={}
    :if ($sal = "" && $sa = "") do={
      :if ($uyN > 50) do={
        /ip/firewall/filter/set $r src-address-list=pais-uy
        :put "+ PPTP: ahora solo acepta desde Uruguay (pais-uy)"
        :set changes ($changes + 1)
      } else={
        :put "! PPTP abierto a todo Internet y la lista pais-uy está vacía: corré uy-list y volvé a correr mk-baseline"
        :set warns ($warns + 1)
      }
    }
    :if ($sal = "pais-uy" && $openRule = "") do={ :set openRule $r }
    :if ($sal = "" && $sa = "" && $openRule = "") do={ :set openRule $r }
  }

  # Excepción para el monitoreo, justo antes de la regla de PPTP
  :if ([:len $kumaIps] > 0 && $openRule != "" && [:len [/ip/firewall/filter/find where chain=input action=accept dst-port="1723" src-address-list="kuma"]] = 0) do={
    /ip/firewall/filter/add chain=input action=accept protocol=tcp dst-port=1723 src-address-list=kuma comment="PPTP para Kuma" place-before=$openRule
    :put "+ PPTP: excepción para el monitoreo (lista kuma)"
    :set changes ($changes + 1)
  }

  # Fuerza bruta: 4 reglas al principio de input, en este orden
  :if ([:len [/ip/firewall/filter/find where chain=input action=drop src-address-list="pptp-block"]] = 0) do={
    :local inputRules [/ip/firewall/filter/find where chain=input]
    :if ([:len $inputRules] > 0) do={
      :local first ($inputRules->0)
      /ip/firewall/filter/add chain=input action=drop protocol=tcp dst-port=1723 src-address-list=pptp-block comment="PPTP bloqueados" place-before=$first
      /ip/firewall/filter/add chain=input action=add-src-to-address-list connection-state=new protocol=tcp dst-port=1723 src-address-list=pptp-s2 address-list=pptp-block address-list-timeout=1h comment="PPTP s2->block" place-before=$first
      /ip/firewall/filter/add chain=input action=add-src-to-address-list connection-state=new protocol=tcp dst-port=1723 src-address-list=pptp-s1 address-list=pptp-s2 address-list-timeout=1m comment="PPTP s1->s2" place-before=$first
      /ip/firewall/filter/add chain=input action=add-src-to-address-list connection-state=new protocol=tcp dst-port=1723 src-address-list="!kuma" address-list=pptp-s1 address-list-timeout=1m comment="PPTP anti fuerza bruta" place-before=$first
      :put "+ PPTP: bloqueo de fuerza bruta (4 reglas al principio)"
      :set changes ($changes + 1)
    }
  } else={
    # Ya existe: verificar que esté antes de la regla que acepta PPTP
    :local posBlock -1
    :local posAccept -1
    :local i 0
    :foreach r in=[/ip/firewall/filter/find where chain=input] do={
      :local sal ""
      :local dp ""
      :local act [/ip/firewall/filter/get $r action]
      :do { :set sal [:tostr [/ip/firewall/filter/get $r src-address-list]] } on-error={}
      :do { :set dp [:tostr [/ip/firewall/filter/get $r dst-port]] } on-error={}
      :if ($posBlock < 0 && $act = "drop" && $sal = "pptp-block") do={ :set posBlock $i }
      :if ($posAccept < 0 && $act = "accept" && $dp = "1723") do={ :set posAccept $i }
      :set i ($i + 1)
    }
    :if ($posAccept >= 0 && $posBlock > $posAccept) do={
      :put "! Las reglas de fuerza bruta de PPTP están DESPUÉS de la que acepta PPTP: no actúan. Subilas al principio de input."
      :set warns ($warns + 1)
    }
  }
}

# ── 5. Reglas que aceptan VPN que no se usan ─────────────────
:local sstpOn false
:local l2tpOn false
:do { :set sstpOn [/interface/sstp-server/server/get enabled] } on-error={}
:do { :set l2tpOn [/interface/l2tp-server/server/get enabled] } on-error={}
:local ipsecTunnels 0
:foreach p in=[/ip/ipsec/policy/find where dynamic=no disabled=no] do={
  :local tpl false
  :do { :set tpl [/ip/ipsec/policy/get $p template] } on-error={}
  :if (!$tpl) do={ :set ipsecTunnels ($ipsecTunnels + 1) }
}
:foreach r in=[/ip/firewall/filter/find where chain=input action=accept disabled=no] do={
  :local cmt ""
  :local proto ""
  :do { :set cmt [:tostr [/ip/firewall/filter/get $r comment]] } on-error={}
  :do { :set proto [:tostr [/ip/firewall/filter/get $r protocol]] } on-error={}
  :local why ""
  :if (!$sstpOn && $cmt~"[Ss][Ss][Tt][Pp]") do={ :set why "SSTP apagado" }
  :if (!$l2tpOn && $cmt~"[Ll]2[Tt][Pp]") do={ :set why "L2TP apagado" }
  :if (!$l2tpOn && $ipsecTunnels = 0 && ($cmt~"[Ii][Pp][Ss][Ee][Cc]|[Ii][Kk][Ee]" || $proto = "ipsec-esp")) do={ :set why "sin túneles IPsec ni L2TP" }
  :if ($why != "") do={
    /ip/firewall/filter/disable $r
    :put ("+ regla deshabilitada (" . $why . "): " . $cmt)
    :set changes ($changes + 1)
  }
}

# ── 6. Scheduler del reporte ─────────────────────────────────
:if ([:len [/system/script/find where name="mk-network-report"]] > 0) do={
  :if ([:len [/system/scheduler/find where on-event~"mk-network-report"]] = 0) do={
    /system/scheduler/add name=mk-network-report interval=$reportEvery on-event="/system/script/run mk-network-report"
    :put ("+ scheduler de mk-network-report cada " . $reportEvery)
    :set changes ($changes + 1)
  }
} else={
  :put "! Falta el script mk-network-report: el portal no ve este router"
  :set warns ($warns + 1)
}

# ── Avisos (no se tocan: pueden cortar servicio) ─────────────
:if (([:len [/ip/firewall/filter/find where chain=input action=drop disabled=no in-interface-list="!LAN"]] + [:len [/ip/firewall/filter/find where chain=input action=drop disabled=no in-interface-list="WAN"]]) = 0) do={
  :put "! FIREWALL: no hay regla que descarte lo que entra de Internet ('drop all not coming from LAN')"
  :set warns ($warns + 1)
}
:if ([:len [/interface/list/member/find where list="WAN"]] = 0) do={
  :put "! La lista de interfaces WAN está vacía"
  :set warns ($warns + 1)
}
:foreach a in=[/ip/address/find where disabled=no] do={
  :local ifc [/ip/address/get $a interface]
  :if ([:len [/interface/bridge/port/find where interface=$ifc]] > 0) do={
    :put ("! La IP " . [/ip/address/get $a address] . " está en " . $ifc . ", que es un puerto del bridge. Fuera de hora: /ip address set [find interface=" . $ifc . "] interface=bridge (y el DHCP server)")
    :set warns ($warns + 1)
  }
}
:local wbOpen false
:foreach r in=[/ip/firewall/filter/find where chain=input action=accept disabled=no dst-port="8291"] do={
  :local sal ""
  :local sa ""
  :do { :set sal [:tostr [/ip/firewall/filter/get $r src-address-list]] } on-error={}
  :do { :set sa [:tostr [/ip/firewall/filter/get $r src-address]] } on-error={}
  :if ($sal = "" && $sa = "") do={ :set wbOpen true }
}
:if ($wbOpen && [:len [/ip/service/find where name="winbox" disabled=no address=""]] > 0) do={
  :put "! Winbox (8291) abierto a todo Internet"
  :set warns ($warns + 1)
}
:if ([:len [/user/find where name="admin" disabled=no]] > 0) do={
  :put "! El usuario 'admin' está habilitado: crear un usuario propio y deshabilitarlo"
  :set warns ($warns + 1)
}

:put ("== mk-baseline: " . $changes . " cambio(s), " . $warns . " aviso(s)")
:log info ("[baseline] " . $changes . " cambio(s), " . $warns . " aviso(s)")
:if ([:len [/system/script/find where name="mk-network-report"]] > 0) do={
  :do { /system/script/run mk-network-report } on-error={}
}
