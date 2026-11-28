# MikroTik — scripts y comandos RouterOS

Scripts que se ejecutan **en el router** (Terminal de Winbox o SSH) y lo que corre en el VPS para monitorearlo.

| Archivo | Dónde corre | Función |
|---------|-------------|---------|
| `setup.rsc` | Router (una vez) | Usuario `monitor` de solo lectura (REST) + syslog de seguridad hacia el VPS |
| `net-topology-report.rsc` | Router (scheduler, cada 1 h) | Manda el router y sus vecinos (LLDP/CDP/MNDP) a la topología del portal |
| `mk-network-report.rsc` | Router (scheduler, cada 1–8 h) | Redes LAN/WAN, IP pública, DDNS, túneles WireGuard e IPsec, vecinos LLDP (arma el mapa) y seguridad (1.3.0); ticket si un túnel se cae o el firewall no bloquea Internet |
| `mk-baseline.rsc` | Router (a mano, las veces que haga falta) | Aplica el **estándar Cenas** sin cortar servicio (ver abajo) |
| `mk-uy-list.rsc` | Router (script `uy-list`, scheduler semanal) | Lista `pais-uy` con los rangos de IP de Uruguay para limitar la VPN PPTP |
| `scripts/linux/mk-monitor.sh` | VPS (cron, cada 5 min) | Recursos, ping a un equipo interno, sesiones REST; alerta por cambios |
| `scripts/linux/mk-syslog.sh` | VPS (servicio systemd) | Recibe el syslog del router: logins fallidos y desde IPs desconocidas |
| `scripts/linux/mk-wifi-report.sh` | VPS (cron, cada 1 h) | Dispositivos Wi-Fi al reporte del portal (ver abajo) |

## Estándar Cenas (`mk-baseline.rsc`)

Todo MikroTik de cliente tiene que quedar con:

| Área | Estándar |
|---|---|
| Monitoreo | `mk-network-report` con scheduler · netwatch del gateway, Internet y servidores clave · log a disco (critical, interface, netwatch) |
| Servicios del router | telnet, ftp, www, api y api-ssl apagados · Winbox limitado (pendiente: IP fija + WireGuard) · usuario `admin` deshabilitado |
| VPN de usuarios | PPTP solo desde Uruguay (`pais-uy`) + excepción del monitoreo (`kuma`) + bloqueo de fuerza bruta · SSTP / L2TP apagados si no se usan |
| VPN entre sitios | WireGuard, con `[monitor]` en el comentario del peer del lado del centro |
| Firewall | regla de fábrica "drop all not coming from LAN" activa y `ether1` en la lista WAN · reglas de VPN sin uso deshabilitadas |
| LAN | IP del router en el bridge (no en un puerto) · loop-protect en los puertos que van a switches |

Se aplica con `mk-baseline` (sección 4) y se controla en el portal: **Telemetría → Routers** muestra cada router con su
puntaje (ej. 8/10) y lo que le falta; el cliente ve en su portal un resumen sin detalles técnicos.

**Orden para un router nuevo:**
1. Cargar el router en el portal como servicio (tipo Router / Firewall), con **sitio** y telemetría activada.
2. `mk-network-report` (sección 3) con su scheduler: el router ya aparece en el portal y arma el mapa.
3. Si tiene VPN PPTP: `uy-list` (sección 5).
4. `mk-baseline` (sección 4) y resolver fuera de hora lo que avise.
5. Opcional, si el VPS llega al router: `setup.rsc` + `mk-monitor.conf` (sección 1) y `mk-wifi-report.sh`.
   `net-topology-report.rsc` ya no hace falta: `mk-network-report` 1.1.0+ manda los vecinos.

## 1. `setup.rsc` — usuario de monitoreo y syslog

Requiere RouterOS 7. **No lleva datos de ingest**: el router no le manda nada al portal, es el VPS el que lo consulta por REST. Los `SERVICE_ID` / `INGEST_SECRET` van en `mk-monitor.conf` del VPS.

1. Editá las variables del principio: `IP_VPS`, `PASS_MONITOR` y `SYSLOG_PORT` (5140 por defecto). Nada más.
2. Pegá el contenido en **New Terminal**.
3. Verificá desde el VPS:
   ```bash
   curl -k -u monitor:CLAVE https://IP_ROUTER/rest/system/resource
   ```

Qué crea:
- REST API: habilita `www-ssl` (con un certificado propio `cenas-rest` si no tenía uno) y una regla al principio del firewall `input` que acepta el 443 **solo desde `IP_VPS`**. Si www-ssl ya tenía "Available From" cargado, le suma la IP del VPS.
- Grupo `cenas-monitor` (solo lectura + API/REST, sin winbox/ssh/write) y usuario `monitor` que **solo puede entrar desde la IP del VPS**.
- Acción de syslog `cenassyslog` hacia `IP_VPS:SYSLOG_PORT` con los temas `account` (logins) y `ppp,error`.

Después agregá el router a `mk-monitor.conf` en el VPS (`SITE_N_SERVICE_ID`, `SITE_N_INGEST_SECRET`, `SITE_N_ROUTER_IP`, `SITE_N_ROUTER_PASS`…) y asegurate de que el servicio `mk-syslog` esté corriendo (`systemctl status mk-syslog`).

> RouterOS 6 no tiene REST API: `setup.rsc`, `mk-monitor.sh` y `mk-wifi-report.sh` no funcionan. Para esos routers usá el importador manual del reporte Wi-Fi (más abajo).

## 2. `net-topology-report.rsc` — topología del sitio

Manda el router y todos sus vecinos (switches, APs, otros MikroTik que se anuncian por LLDP/CDP/MNDP) con los puertos de cada enlace a la topología del portal.

1. En el portal, el cliente tiene que tener el **sitio** creado; copiá su `id` (tabla `sites`).
2. Editá las variables del principio:
   - `siteId`: id del sitio.
   - `ingestSecret`: el ingest secret de **cualquier servicio de ese cliente** (se valida contra el cliente del sitio).
   - `supabaseUrl` y `supabaseAnon`.
3. **System → Scripts → Add**: nombre `net-topology-report`, pegar el contenido.
4. **System → Scheduler → Add**: intervalo `1h`, On Event: `/system/script/run net-topology-report`.
5. Probá a mano: `/system script run net-topology-report` y mirá el log (`/log print where message~"net-topology"`).

Requiere RouterOS 7 y salida a internet desde el router. Que los switches y APs tengan LLDP/CDP activado para aparecer como vecinos.

**Cómo se ve en el mapa** (Infraestructura → Topología):
- Cada vecino llega clasificado por lo que anuncia: router, switch, AP, teléfono IP o equipo final.
- El mapa muestra solo la **infraestructura** (routers, switches, APs) y los enlaces con el puerto en cada punta. Teléfonos y PCs quedan en **"Descubiertos"**, donde podés mostrarlos u ocultar cualquier equipo.
- Si un equipo descubierto es un **servicio que cargaste a mano** (misma MAC o misma IP), el servicio lo "absorbe": se ve un solo nodo, el del servicio, y el servicio completa la MAC y el modelo si no los tenía. También se puede vincular a mano desde "Descubiertos".
- El estado del router sale del heartbeat que manda `mk-monitor.sh` (v1.1.0) cada 5 minutos, y si el servicio tiene página de Uptime Kuma, un monitor caído en Kuma lo marca en rojo.

## 3. `mk-network-report.rsc` — redes y VPN del router

Lo manda **el router** directo al portal (no necesita el VPS ni el usuario `monitor`), así que sirve también para routers que el VPS no alcanza. Requiere **RouterOS 7.13+**.

Qué reporta (heartbeat `mk-network` del servicio del router):
- **Redes**: cada IP del router separada en LAN y WAN (PPPoE, DHCP client o IP pública), la **IP pública** y el nombre **DDNS** de IP Cloud.
- **WireGuard**: interfaces y peers (nombre, endpoint, redes permitidas, último handshake, tráfico). Solo claves **públicas**: las privadas nunca salen del router.
- **IPsec**: peers (establecido o no) y policies con su `ph2-state`.

El portal actualiza solo la IP pública, la IP LAN, el modelo, la versión de RouterOS, el DDNS y las redes LAN del servicio.

**Alertas**: si un túnel está caído el reporte sale en `failed` y se abre un ticket "Problema en el equipo" con el detalle (se cierra solo con dos reportes limpios). Se vigilan:
- peers WireGuard con `endpoint-address` (el sitio remoto que llama al centro): caído si pasan más de 5 min sin handshake;
- del lado del centro, solo los peers con **`[monitor]` en el comentario** (los peers de notebooks o celulares no deberían alertar);
- policies IPsec habilitadas que no están en `established`.

**Versiones:**

| Versión | Agrega |
|---|---|
| 1.1.0 | Vecinos LLDP/CDP/MNDP para el mapa (reemplaza a `net-topology-report.rsc`) |
| 1.1.1 | Intervalo del scheduler (`report_interval_s`): el portal ajusta a eso cuándo da el dato por viejo |
| 1.2.0 | **Equipos de la LAN** (ARP + tabla del bridge: IP, MAC y puerto del router). El mapa muestra en qué puerto está cada servidor y **deduce los switches no administrables**: 3 o más equipos físicos por un mismo puerto (las máquinas virtuales no cuentan) |
| 1.3.0 | **Seguridad**: servicios del router, VPN encendidas y usuarios conectados, puertos que acepta el firewall (y si están limitados a una lista), IPs bloqueadas, netwatch, log a disco, IP de la LAN en un puerto del bridge, usuario `admin`. **Ticket automático** si falta la regla final del firewall |
| 1.3.1 | Corrige el error de sintaxis en RouterOS 7.17+ (el servidor OpenVPN pasó a ser una lista) |
| 1.3.2 | Detecta bien la regla `drop … in-interface-list=!LAN` (antes daba falso aviso de firewall abierto en algunas versiones) |

**Actualizar el script** sin perder la configuración: abrí el script en el router, copiá tus cuatro valores
(`serviceId`, `ingestSecret`, `supabaseUrl`, `supabaseAnon`), pegá la versión nueva entera y volvé a poner esos valores.
El scheduler no se toca.

**Desde la 1.1.0 también manda los vecinos LLDP/CDP/MNDP** (switches, APs, otros MikroTik, con el puerto de cada enlace) al mapa del **sitio del servicio del router**: no hace falta instalar además `net-topology-report.rsc`. El router tiene que tener un sitio asignado.

**El mapa se arma solo** con lo que manda el router: la nube de **Internet** en su WAN (salvo que hayas dibujado una a mano), los **túneles WireGuard e IPsec** (una red remota que no es de ningún router del mapa aparece como "Sitio …"), los equipos descubiertos por LLDP con sus puertos y, para los servidores de la LAN del router que no tienen otro enlace, una línea punteada **"LAN"** hasta el router.

**En el mapa** (Infraestructura → Topología): cada túnel vigilado se dibuja como enlace "VPN / Túnel" (violeta, rojo si está caído). Si el otro extremo es otro router del mismo mapa se unen los dos (por nombre DDNS, IP pública o redes LAN); si es de otro sitio u otro cliente aparece un nodo "Otro extremo de la VPN".

**En el portal del cliente**: un servicio de tipo **VPN** con `specifications.vpn = {"protocol":"WireGuard","peer":"<nombre del peer>","sites":"A ↔ B","access":"Escritorio remoto a 10.10.10.1"}` muestra el estado del túnel ("conectado · último contacto hace…") tomado del reporte del router del mismo cliente que tiene ese peer.

Instalación:
1. El router tiene que estar cargado como servicio (tipo Router / Firewall) con **telemetría activada**. Copiá su `id` y su ingest secret.
2. Editá las variables del principio: `serviceId`, `ingestSecret`, `supabaseUrl`, `supabaseAnon`.
3. **System → Scripts → Add**: nombre `mk-network-report`, pegar el contenido.
4. **System → Scheduler → Add**: intervalo de `1h` a `8h`, On Event: `/system/script/run mk-network-report`. El script manda su intervalo (1.1.1+) y el portal ajusta a eso cuándo da el dato por viejo (1,5×) y cuándo abre "Dejó de reportar". Para controlar la VPN más seguido, sumá la prueba desde un servidor (`$VPN_CHECKS` en `config.ps1`).
5. Probá: `/system/script/run mk-network-report` y `/log print where message~"mk-network"`.

## 4. `mk-baseline.rsc` — aplicar el estándar Cenas

Se corre **a mano**, las veces que haga falta: aplica lo que falta y no repite lo que ya está. No toca lo que puede cortar
servicio. Requiere RouterOS 7.13+.

1. **System → Scripts → Add**: nombre `mk-baseline`, pegar el contenido.
2. Completá la configuración del principio:

   | Variable | Para qué | Ejemplo |
   |---|---|---|
   | `kumaIps` | IPs del monitoreo (Uptime Kuma) que chequean la VPN desde afuera de Uruguay | `{"203.0.113.10"}` |
   | `netwatchHosts` | Equipos de la LAN a vigilar con netwatch | `{"192.168.1.100"="facturacion"; "192.168.1.250"="NAS"}` |
   | `disableInsecure` | Apagar telnet, ftp, www, api y api-ssl | `true` |
   | `pptpProtect` | Limitar PPTP a Uruguay + fuerza bruta. `false` = no tocar la VPN de este router | `true` |
   | `reportEvery` | Intervalo del scheduler de `mk-network-report` si hay que crearlo | `8h` |
3. Corré `/system/script/run mk-baseline`. Imprime cada cambio con `+` y cada aviso con `!`, y al final manda un reporte
   nuevo al portal. También queda en el log: `/log print where message~"baseline"`.

**Aplica:**
- apaga telnet, ftp, www, api y api-ssl (Winbox, SSH y www-ssl quedan como están);
- log a disco de `critical`, `interface` y `netwatch` (no se pierde al reiniciar);
- netwatch cada 10 s del gateway del proveedor, de Internet (8.8.8.8) y de `netwatchHosts`; cada caída y vuelta queda en el log como `NW DOWN …` / `NW UP …`;
- si la VPN PPTP está prendida: scheduler semanal de `uy-list`, la regla que acepta PPTP pasa a aceptar solo `pais-uy`, regla "PPTP para Kuma" antes de esa, y el **bloqueo de fuerza bruta** (4 reglas al principio de `input`, ver abajo);
- deshabilita (no borra) las reglas que aceptan SSTP, L2TP o IPsec si esos servicios están apagados y no hay túneles IPsec;
- crea el scheduler de `mk-network-report` si falta.

**Solo avisa** (para hacer fuera de hora): IP de la LAN en un puerto del bridge, falta la regla final del firewall o la
lista WAN está vacía, Winbox abierto a todo Internet, usuario `admin` habilitado, reglas de fuerza bruta en mal orden.

**Bloqueo de fuerza bruta (PPTP).** Una IP que abre 3 o más conexiones nuevas en un par de minutos queda bloqueada 1 hora
(lista `pptp-block`); Kuma está exceptuado. **El orden importa**: las cuatro reglas tienen que estar antes de la que acepta
PPTP y antes de "accept established"; si quedan después no hacen nada.

```
1. PPTP bloqueados          drop                     src-address-list=pptp-block
2. PPTP s2->block           add-src-to-address-list  pptp-s2 -> pptp-block (1h)
3. PPTP s1->s2              add-src-to-address-list  pptp-s1 -> pptp-s2 (1m)
4. PPTP anti fuerza bruta   add-src-to-address-list  !kuma -> pptp-s1 (1m)
5. defconf: accept established…
   …
   PPTP para Kuma           accept 1723 src-address-list=kuma
   allow pptp               accept 1723 src-address-list=pais-uy
```

Para revisar: `/ip firewall filter print stats where comment~"PPTP"` y `/ip firewall address-list print where list=pptp-block`.

## 5. `mk-uy-list.rsc` — lista de Uruguay (`pais-uy`)

Baja los rangos de IP de Uruguay (ipdeny.com) a la lista `pais-uy`. Si la descarga falla o viene vacía, no toca la lista que hay.

1. **System → Scripts → Add**: nombre **`uy-list`** (así lo busca `mk-baseline`), pegar el contenido.
2. Corré `/system/script/run uy-list` y verificá: `/ip firewall address-list print count-only where list=pais-uy` (del orden de 100–200 rangos).
3. El scheduler semanal lo crea `mk-baseline`. A mano: `/system scheduler add name=uy-list interval=7d start-time=04:00:00 on-event="/system/script/run uy-list"`.

**Las excepciones no van en `pais-uy`**: esa lista se borra y se vuelve a cargar cada semana. Van en otra lista con su
propia regla, como `kuma` para el monitoreo.

Un usuario que viaja al exterior no se va a poder conectar a la VPN mientras esté afuera.

## 6. Recetas

**IP de la LAN al bridge** (fuera de hora; si entrás por la IP pública no te cortás):
```
/ip address set [find address="192.168.1.1/24"] interface=bridge
/ip dhcp-server set [find interface=ether2] interface=bridge
```
Para volver atrás: lo mismo con `interface=ether2`. Si los usuarios de VPN reciben IPs de la LAN, el proxy-arp va en el
bridge: `/interface bridge set bridge arp=proxy-arp`.

**Loop-protect** en el puerto que va a los switches (si detecta un loop apaga el puerto 5 minutos y lo deja en el log;
por eso, fuera de hora):
```
/interface ethernet set ether2 loop-protect=on loop-protect-disable-time=5m
```

**Ver qué se cayó** (con el netwatch y el log a disco de `mk-baseline`):
```
/log print where message~"NW "
```
Si cae el gateway o Internet, es el proveedor; si caen solo equipos de la LAN, es la LAN o esos equipos.

**Reglas de firewall por número**: los números (`disable 1,2,3`, `move 4 destination=6`) son los del **último `print`** y
cambian cuando se agregan o mueven reglas. `destination=N` deja la regla **antes de la regla N**, no en la posición N.
Siempre que se pueda, usá `[find comment="…"]` en lugar de números.

**WireGuard entre sitios** (coexiste con IPsec): interfaz propia en un puerto que no esté en uso (ej. `wg-sitios`,
UDP 13232), MTU 1412, una /24 de túnel (ej. 10.10.10.0/24), masquerade desde el túnel hacia la LAN si el otro lado no
tiene ruta de vuelta, y `[monitor]` en el comentario del peer del lado del centro para que el portal lo vigile. El sitio
remoto sin IP fija pone el endpoint con el DDNS de IP Cloud del centro (`…sn.mynetname.net`) y `persistent-keepalive=25s`.

## Reporte de dispositivos Wi-Fi

`scripts/linux/mk-wifi-report.sh` corre en el VPS de monitoreo, al lado de `mk-monitor.sh`, y usa la misma `mk-monitor.conf`.
Lee la tabla de registración Wi-Fi del router (`/interface/wifi`, `wifiwave2`, `wireless` o `caps-man`), la cruza con los leases DHCP y ARP, y la manda al portal (Telemetría → Wi-Fi, con exportación a PDF).

```bash
curl -fsSL https://raw.githubusercontent.com/mathcenas/service-catalog/main/scripts/linux/mk-wifi-report.sh \
  -o /srv/network-monitor/mk-wifi-report.sh && chmod +x /srv/network-monitor/mk-wifi-report.sh
# crontab -e  (cada hora)
7 * * * * /srv/network-monitor/mk-wifi-report.sh >> /srv/network-monitor/logs/mk-wifi-report.log 2>&1
```

- Para que un dispositivo aparezca con nombre, poné un comentario en su lease DHCP en el router.
- `SITE_N_WIFI="false"` en la config saltea un router sin Wi-Fi.
- El usuario `monitor` de solo lectura (`setup.rsc`) alcanza.

### Importar a mano (routers sin acceso desde el VPS)

En la terminal del router (Winbox → New Terminal). Los archivos quedan en **Files**; arrastralos a la PC y subilos en Telemetría → Wi-Fi → Importar.

```
/ip dhcp-server lease print terse file=dhcp-leases
/ip arp print terse file=arp
/ip neighbor print terse file=vecinos   # nombre de switches, APs y otros equipos de red
# Tabla Wi-Fi: la que corresponda a tu RouterOS
/interface wifi registration-table print terse file=wifi-clientes       # RouterOS 7.13+ (wifi)
/interface wifiwave2 registration-table print terse file=wifi-clientes  # RouterOS 7 anteriores
/interface wireless registration-table print terse file=wifi-clientes   # wireless clásico
/caps-man registration-table print terse file=wifi-clientes             # CAPsMAN
```

El ARP no trae nombres: los equipos con IP fija toman nombre de los vecinos (`/ip neighbor`), del inventario de equipos (device-report, por IP) o del nombre que les pongas en el portal (lápiz), que no se pisa al volver a importar.

Con la tabla Wi-Fi se importan solo los conectados al Wi-Fi (leases y ARP completan IP y nombre). Sin ella se usan los leases DHCP, eligiendo qué servidores DHCP son de la red Wi-Fi. También acepta el JSON de la REST API (`curl -k -u monitor:… https://ROUTER/rest/ip/dhcp-server/lease > leases.json`).


## Comandos útiles de diagnóstico

Sintaxis de RouterOS 6 (con espacios). En RouterOS 7 también funcionan.

### Ubicar un equipo (por MAC o IP)
```
/ip dhcp-server lease print detail where mac-address=FC:3F:DB:05:C5:11
/ip arp print where address=192.168.1.176
/interface bridge host print where mac-address=FC:3F:DB:05:C5:11    # puerto físico
/ip neighbor print detail where mac-address=FC:3F:DB:05:C5:11       # si se anuncia: nombre, tipo, puerto
```

### Qué está haciendo ahora
```
/ip firewall connection print where src-address~"192.168.1.176"
/tool torch interface=bridge src-address=192.168.1.176 dst-address=0.0.0.0/0 port=any
/ip dns cache all print where data="IP_DE_DESTINO"                  # a qué sitio corresponde una IP
```
Más legible desde Winbox: **Tools → Torch**, Src. Address `IP/32`, marcar Dst. Address y Port.
Ojo: las conexiones con flag **F** (FastTrack) no suman bytes en `/ip firewall connection`; para tráfico real usar Torch.

### Historial
El router no guarda historial por defecto: el log en memoria tiene ~1000 líneas y se borra al reiniciar.
```
/log print where message~"FC:3F:DB:05:C5:11"                        # asignaciones DHCP que queden en memoria
```
Para guardar asignaciones DHCP con fecha, en un archivo del router:
```
/system logging action add name=disco target=disk disk-file-name=dhcp-log disk-lines-per-file=5000 disk-file-count=4
/system logging add topics=dhcp action=disco
```
Registro puntual de sitios visitados (consultas DNS), solo por un tiempo y con aviso al cliente:
```
/system logging action add name=dnslog target=disk disk-file-name=dns-log disk-lines-per-file=10000 disk-file-count=5
/system logging add topics=dns action=dnslog
/log print where message~"192.168.1.176"
/system logging remove [find action=dnslog]                        # desactivar al terminar
```
Solo funciona si los equipos usan al router como DNS; el "DNS seguro" de Chrome/Firefox lo saltea. Se ven dominios, no páginas ni contenido.

## Junto a otros equipos

- **APs UniFi**: para que se adopten solos en la controladora del VPS (`scripts/unifi/`):
  ```
  /ip dns static add name=unifi address=IP_DEL_VPS
  ```
- **Google Wifi / Nest Wifi**: no tiene API. Dejarlo en **modo bridge** detrás del MikroTik, así el MikroTik reparte las IP y ve todos los equipos (DHCP/ARP). En modo NAT quedan ocultos detrás del Google Wifi.
