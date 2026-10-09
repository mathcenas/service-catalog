# =============================================================
# setup.rsc — Configuración de monitoreo en RouterOS 7
#
# INSTRUCCIONES:
#   1. Editar las variables al inicio (IP_VPS, PASS_MONITOR)
#   2. Copiar y pegar en Terminal de Winbox o SSH al router
#   3. Verificar con: /user print y /system logging print
#
# Requiere RouterOS 7.x con REST API habilitado.
# =============================================================

# ---- EDITAR ANTES DE EJECUTAR ----
:local IP_VPS        "1.2.3.4"        # IP pública del VPS colector
:local PASS_MONITOR  "cambiar_esto"   # Contraseña para el usuario monitor
:local SYSLOG_PORT   5140             # Puerto UDP en el VPS (default 5140)
# ----------------------------------

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

:put "=== Logging rules ==="
/system/logging print where action=cenassyslog

:put "OK - Setup completo. Probá: curl -k https://<IP_ROUTER>/rest/system/resource -u monitor:<pass>"
