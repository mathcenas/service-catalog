# ==============================================================
# mk-uy-list.rsc  v1.0.0
# Arma la lista de direcciones "pais-uy" con los rangos de IP de Uruguay (ipdeny.com).
# La usa el firewall para aceptar la VPN PPTP solo desde Uruguay (ver mk-baseline.rsc).
#
# INSTALACIÓN (lo hace solo mk-baseline.rsc si el script existe):
#   1. System → Scripts → Add: nombre "uy-list", pegar este contenido.
#   2. System → Scheduler → Add: nombre "uy-list", intervalo 7d, start-time 04:00:00,
#      On Event: /system/script/run uy-list
#   3. Probá: /system/script/run uy-list
#      y mirá: /ip/firewall/address-list/print count-only where list=pais-uy
#
# Si la descarga falla o viene vacía NO toca la lista que ya hay.
# Las excepciones (ej. tu servidor de monitoreo) van en otra lista ("kuma"), no en pais-uy:
# esta se borra y se vuelve a cargar cada semana.
# ==============================================================

:do { /tool/fetch url="https://www.ipdeny.com/ipblocks/data/aggregated/uy-aggregated.zone" dst-path=uy.zone } on-error={ :log warning "uy-list: no se pudo descargar"; :error "fetch" }
:delay 2s
:local c [/file/get uy.zone contents]
:if ([:len $c] < 100) do={ :log warning "uy-list: lista vacia, no se toca"; :error "vacia" }
/ip/firewall/address-list/remove [find list=pais-uy]
:local start 0
:local end
:while ($start < [:len $c]) do={
  :set end [:find $c "\n" $start]
  :if ([:typeof $end] = "nil") do={ :set end [:len $c] }
  :local line [:pick $c $start $end]
  :if ([:len $line] > 6) do={ :do { /ip/firewall/address-list/add list=pais-uy address=$line } on-error={} }
  :set start ($end + 1)
}
/file/remove uy.zone
:log info ("uy-list: " . [:len [/ip/firewall/address-list/find list=pais-uy]] . " rangos de Uruguay")
