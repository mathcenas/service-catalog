# =============================================================
# setup.rsc — Configuración de monitoreo en RouterOS 7
#
# INSTRUCCIONES:
#   1. Editar las variables al inicio (IP_VPS, PASS_MONITOR). No lleva datos de ingest:
#      el router no le manda nada al portal, el VPS lo consulta por REST.
#   2. Copiar y pegar en Terminal de Winbox o SSH al router
#   3. Verificar desde el VPS:
#        curl -k -u monitor:CLAVE https://IP_ROUTER/rest/system/resource
#
# Requiere RouterOS 7.x. El script habilita la REST API (www-ssl) con un
# certificado propio si no tiene uno, y abre el 443 en el firewall SOLO para IP_VPS.
# =============================================================

# ---- EDITAR ANTES DE EJECUTAR ----
:local IP_VPS        "1.2.3.4"        # IP pública del VPS colector
:local PASS_MONITOR  "cambiar_esto"   # Contraseña para el usuario monitor
:local SYSLOG_PORT   5140             # Puerto UDP en el VPS (default 5140)
# ----------------------------------

# 0. REST API: servicio www-ssl con certificado + firewall solo para el VPS
:if ([:len [/certificate/find where name="cenas-rest"]] = 0) do={
  /certificate/add name=cenas-rest common-name=cenas-rest days-valid=3650 key-usage=digital-signature,key-encipherment,tls-server
  /certificate/sign cenas-rest
  :delay 5s
}
:local curCert [/ip/service/get [find where name="www-ssl"] certificate]
:if ($curCert = "" || $curCert = "none") do={
  /ip/service/set [find where name="www-ssl"] certificate=cenas-rest
}
/ip/service/set [find where name="www-ssl"] disabled=no
# Si www-ssl ya tenía "Available From" cargado, sumamos el VPS (si estaba vacío, queda abierto y lo limita el firewall)
:local allowed [/ip/service/get [find where name="www-ssl"] address]
:if ([:len $allowed] > 0 && [:len [:find [:tostr $allowed] $IP_VPS]] = 0) do={
  /ip/service/set [find where name="www-ssl"] address=($allowed, "$IP_VPS/32")
}
:if ([:len [/ip/firewall/filter/find where comment="Cenas IT - REST desde VPS"]] = 0) do={
  :local firstInput [/ip/firewall/filter/find where chain=input]
  :if ([:len $firstInput] > 0) do={
    /ip/firewall/filter/add chain=input protocol=tcp dst-port=443 src-address=$IP_VPS action=accept \
      comment="Cenas IT - REST desde VPS" place-before=[:pick $firstInput 0]
  } else={
    /ip/firewall/filter/add chain=input protocol=tcp dst-port=443 src-address=$IP_VPS action=accept \
      comment="Cenas IT - REST desde VPS"
  }
}

# 1. Grupo de solo lectura con acceso REST
/user/group
add name=cenas-monitor \
    policy=read,api,rest-api,!write,!policy,!test,!winbox,!password,!web,!ftp,!reboot,!ssh,!telnet,!sensitive \
    comment="Cenas IT - monitoreo read-only"

# 2. Usuario de monitoreo restringido a la IP del VPS
/user
add name=monitor \
    group=cenas-monitor \
    password=$PASS_MONITOR \
    address=$IP_VPS \
    comment="Cenas IT - colector"

# 3. Acción de syslog remoto (solo hacia el VPS)
/system/logging/action
add name=cenassyslog \
    target=remote \
    remote=$IP_VPS \
    remote-port=$SYSLOG_PORT \
    remote-log-format=syslog \
    src-address=0.0.0.0 \
    comment="Cenas IT - eventos de seguridad"

# 4. Reglas de syslog: solo eventos de seguridad relevantes
/system/logging
add topics=account action=cenassyslog comment="Logins (exitosos y fallidos)"
add topics=ppp,error action=cenassyslog comment="Errores PPP"

# 5. Verificación
:put "=== Usuario monitor ==="
/user print where name=monitor

:put "=== Grupo cenas-monitor ==="
/user/group print where name=cenas-monitor

:put "=== Syslog action ==="
/system/logging/action print where name=cenassyslog

:put "=== REST (www-ssl) ==="
/ip/service print where name=www-ssl
/ip/firewall/filter print where comment="Cenas IT - REST desde VPS"

:put "=== Logging rules ==="
/system/logging print where action=cenassyslog

:put "OK - Setup completo. Probá: curl -k https://<IP_ROUTER>/rest/system/resource -u monitor:<pass>"
