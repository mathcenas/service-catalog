# MikroTik — scripts y comandos RouterOS

Scripts que se ejecutan **en el router** (Terminal de Winbox o SSH) y lo que corre en el VPS para monitorearlo.

| Archivo | Dónde corre | Función |
|---------|-------------|---------|
| `setup.rsc` | Router (una vez) | Usuario `monitor` de solo lectura (REST) + syslog de seguridad hacia el VPS |
| `net-topology-report.rsc` | Router (scheduler, cada 1 h) | Manda el router y sus vecinos (LLDP/CDP/MNDP) a la topología del portal |
| `scripts/linux/mk-monitor.sh` | VPS (cron, cada 5 min) | Recursos, ping a un equipo interno, sesiones REST; alerta por cambios |
| `scripts/linux/mk-syslog.sh` | VPS (servicio systemd) | Recibe el syslog del router: logins fallidos y desde IPs desconocidas |
| `scripts/linux/mk-wifi-report.sh` | VPS (cron, cada 1 h) | Dispositivos Wi-Fi al reporte del portal (ver abajo) |

Orden para un cliente nuevo: **1.** `setup.rsc` en el router → **2.** sitio del VPS en `mk-monitor.conf` → **3.** `net-topology-report.rsc` → **4.** `mk-wifi-report.sh`.

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
