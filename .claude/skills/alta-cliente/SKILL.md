---
name: alta-cliente
description: Checklist para dar de alta un cliente nuevo (o un equipo nuevo de un cliente) en el Service Catalog de Cenas IT — portal (cliente, sitio, servicios, contactos, ingest secrets), servidores Windows/Linux, NAS, backups (Veeam, Cobian, Kopia, VMware Workstation), MikroTik, Wi-Fi (MikroTik, UniFi, Deco, Google Wifi) e inventario de equipos. Usar cuando el usuario diga "doy de alta a…", "cliente nuevo", "agregar un server/router/NAS a…", "qué le falta a X para reportar", o pida armar los archivos de configuración (config.ps1, .env, mk-monitor.conf) de un cliente.
---

# Alta de cliente en el Service Catalog

Objetivo: que cada equipo del cliente reporte al portal (heartbeats, backups, red) y que el cliente reciba sus reportes. Se trabaja de afuera hacia adentro: **primero el portal** (porque de ahí salen los `SERVICE_ID` e `INGEST_SECRET`), después cada equipo, al final la verificación.

## 0. Relevamiento (preguntar solo lo que falte)

Antes de armar nada, conseguí esto. Si el usuario ya lo dijo, no lo vuelvas a preguntar.

- **Sitios**: ¿una oficina o varias? (cada una es un `site`). Ojo: no crear sitios duplicados con el mismo nombre.
- **Router**: marca y versión. MikroTik → ¿RouterOS 7? (RouterOS 6 no tiene REST API).
- **Wi-Fi**: MikroTik / UniFi (APs sueltos o UDM) / TP-Link Deco / Google Wifi / otro.
- **Servidores**: por cada uno, Windows o Linux, qué corre (archivos, sistema contable, VMs, Docker) y si es físico o VM.
- **Backups**: herramienta por equipo (Veeam B&R, Veeam Agent, Cobian, Kopia, `backup.sh`, VMware Workstation) y frecuencia esperada (diaria, días hábiles, semanal).
- **Carpetas compartidas**: dónde viven (Windows o NAS OMV) y si el cliente quiere la revisión semestral de accesos.
- **PCs**: ¿tienen agente de ManageEngine/Zoho Endpoint Central? (para el inventario).
- **Contactos**: quién recibe alertas, resúmenes y roadmap (nombre, email, rol, frecuencia).
- **Uptime Kuma**: ¿ya hay monitores o página de estado para el cliente?

## 1. Portal

1. **Cliente**: datos, email principal, alternativo y CC.
2. **Contactos** (Clientes → contactos): con `digest_frequency` correcta. Al crearlos se manda la bienvenida.
3. **Sitio(s)**: uno por oficina.
4. **Servicios**: uno por cosa que querés ver con estado propio, no uno por máquina. Ejemplos:
   - Servidor (el hardware/SO) → recibe `system-health`.
   - Carpeta compartida → recibe `smb-check` y, si corresponde, los backups de Veeam/Cobian de esa carpeta.
   - Sistema contable en el mismo server → va en `$EXTRA_HEALTH_SERVICES` del server (copia del heartbeat).
   - Router MikroTik → recibe `mk-monitor` (heartbeat) y es el servicio que "absorbe" al router en el mapa.
   - Wi-Fi Deco/UniFi si no hay MikroTik → recibe el reporte Wi-Fi.
   - "Inventario de equipos" → solo para `device-report.ps1` (su secret queda en todas las PCs: no reutilizar el de un server).
   En cada servicio: asignar el **sitio**, cargar IP (y MAC si se sabe: así absorbe lo que descubre el router), **frecuencia de backup esperada**, `telemetry_enabled` solo si de verdad va a reportar (si no, aparece como "Nunca reportó"), y `uptime_status_url` si tiene página en Kuma.
5. **Ingest secret**: Editar servicio → panel de telemetría → Generar. Ahí se copian `Service ID` y `secret` (y la línea lista para `$EXTRA_HEALTH_SERVICES`).
6. **TaskTracker** (opcional): `clients.task_tracker_id` + proyecto por defecto en `task_tracker_projects`, si querés que los backups vencidos creen tareas.
7. **Link del portal del cliente** (share token) para mandarle.

## 2. Por equipo

Generá los archivos de configuración ya completos con los IDs y secrets del paso 1. **Nunca** los escribas dentro del repo ni los commitees: van en el scratchpad o como texto en la respuesta, y el usuario los copia al equipo.

### Servidor Windows
- Carpeta `C:\Scripts\`. Bajar `update-scripts.ps1` y correrlo una vez: instala los scripts y después se actualiza solo cada 48 h (solo vuelve a ejecutar los que ya estaban instalados).
- `config.ps1` (ASCII, sin acentos ni BOM): `$ANON_KEY`, `$SERVICE_ID`, `$INGEST_SECRET`; `$CHECK_RDP/$CHECK_SMART/$CHECK_SPEEDTEST` en `$false` donde no aplique (VMs sin SMART); `$EXTRA_HEALTH_SERVICES`; Kuma push si hay.
- Tareas: `pwsh -ExecutionPolicy Bypass -File C:\Scripts\setup-scheduled-tasks.ps1` (como admin) registra system-health (cada 1 h), Veeam (07:00/07:15), backup-folder-check y update-scripts.
- Usar **solo uno** de `system-health.ps1` o `system-health-server.ps1` por equipo.
- **Carpeta compartida**: `$SMB_SERVICE_ID`, `$SMB_INGEST_SECRET`, `$SMB_PATH`. Si la carpeta es del propio Windows: `D:\Compartida` o `\\localhost\Compartida` (manda heartbeat + ACL). Si es de otro equipo (NAS): ruta **UNC**, nunca `Z:` (las letras mapeadas no existen en la tarea programada); en ese caso `smb-check` hace solo heartbeat y el ACL lo manda el NAS.
- **Veeam B&R**: `veeam-report.ps1`. Veeam 12 → `powershell.exe` (PS 5.1); Veeam 13 → `pwsh` 7.6+ (el script se relanza solo según el módulo). Si los backups son de la carpeta compartida: `$VEEAM_SERVICE_ID = $SMB_SERVICE_ID` y `$VEEAM_INGEST_SECRET = $SMB_INGEST_SECRET`.
- **Veeam Agent**: `veeam-agent-report.ps1` (`$VEEAM_LOOKBACK_HOURS` 25 diario / 170 semanal).
- **Cobian**: `cobian-report.ps1` con `pwsh` (usa `-AsArray`); reporta todas las tasks del día y espera a las que siguen corriendo. Revisar que la tarea no se corte antes de 10 h.
- **VMs de VMware Workstation**: `vmware-backup\` (la tarea con el usuario que abre las VMs, no SYSTEM). Ver `scripts/windows/vmware-backup/README.md`.
- **AD**: `ad-backup.ps1` si es controlador de dominio.

### Servidor Linux / VPS
- `/srv/scripts/`, `update-scripts.sh` en cron (`0 4 */2 * *`).
- `system-health.sh` + `.env` (desde `system-health.env.example`, `chmod 600`), cron cada hora. En VMs: `CHECK_SMART="false"`. Docker: `DOCKER_IGNORE` para los contenedores parados a propósito.
- Backups: `backup.sh` + `.env` (desde `backup.env.example`), con `EMAIL_ON_SUCCESS="false"` (el portal ya avisa).

### NAS OMV
- `scripts/nas/report-smb-acl.sh` con el `backup-ingest.env` del NAS (`SERVICE_ID` del servicio del NAS) para el reporte de accesos.
- Backups del NAS: `scripts/nas/report-all-backups.sh`.

### MikroTik (RouterOS 7)
Ver `scripts/mikrotik/README.md`. Orden:
1. `setup.rsc` en el router: solo `IP_VPS` y `PASS_MONITOR` (no lleva ingest). Habilita www-ssl y abre 443 solo al VPS. Verificar desde el VPS: `curl -k -u monitor:CLAVE https://IP/rest/system/resource`.
2. Bloque `SITE_N_*` en `mk-monitor.conf` del VPS (service ID + secret del servicio del router, IP, clave de `monitor`, `RDP_TARGET` si hay un equipo clave para pingear). Subir `SITE_COUNT`.
3. `net-topology-report.rsc` en el router (System → Scripts + Scheduler 1 h) con `siteId` y el secret de cualquier servicio del cliente.
4. Wi-Fi: si el router da Wi-Fi o tiene CAPsMAN, lo cubre `mk-wifi-report.sh` en el VPS (misma config).
- RouterOS 6: sin REST → nada de lo anterior funciona; usar el importador manual (Telemetría → Wi-Fi → Importar) o actualizar a 7.

### Wi-Fi según marca
- **UniFi APs sueltos**: adoptarlos en la controladora del VPS (`scripts/unifi/README.md`; en el MikroTik `/ip dns static add name=unifi address=IP_VPS`), crear un site por cliente y sumarlo a `unifi-report.json`.
- **UDM / Cloud Gateway**: `unifi-wifi-report.py` con `"unifi_os": true`, desde un equipo de la red.
- **TP-Link Deco**: `scripts/linux/deco-wifi-report.py` en un Linux o Windows con Python de la red (diario).
- **Google Wifi / Nest**: no tiene API. Dejarlo en modo bridge detrás del router para que el router vea los equipos.

### PCs (inventario)
- `device-report.ps1` v2 con el servicio "Inventario de equipos" (`$PORTAL_URL`, `$ANON_KEY`, `$DEVICE_SERVICE_ID`, `$DEVICE_INGEST_SECRET`, `$NAS_HOSTNAME`).
- Con Endpoint Central: Custom Script de tipo **User** (no Computer/SYSTEM), en cada inicio de sesión: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File device-report.ps1`.

## 3. Verificación (no dar el alta por terminada sin esto)

- Telemetría: cada servicio con `telemetry_enabled` tiene heartbeat reciente (< 2 h). Si no: ver la sección de errores.
- Backups: al menos un registro por servicio de backup; la frecuencia esperada está cargada (si no, alerta a las 26 h aunque el backup sea semanal).
- Dashboard → "Para hoy": el cliente no aparece con "Sin señal" ni "Nunca reportó".
- Mapa de red: el router sale con estado (heartbeat de `mk-monitor`), los equipos descubiertos de infraestructura aparecen, y los servicios cargados absorbieron a sus equipos (si no, vincular desde "Descubiertos").
- Wi-Fi: hay dispositivos en Telemetría → Wi-Fi para el router/AP del cliente.
- Contactos: llegó el mail de bienvenida.

## 4. Errores que ya nos pasaron

| Síntoma | Causa | Solución |
|---|---|---|
| `JWT failed verification` | `$ANON_KEY` mal copiada en `config.ps1` / `.env` | Copiar la anon key correcta del proyecto |
| 401 en ingest | Secret de otro servicio | Revisar que `SERVICE_ID` e `INGEST_SECRET` sean del mismo servicio |
| Caracteres raros / error de parseo en PS 5.1 | Script con acentos guardado sin BOM | Scripts con acentos: UTF-8 **con** BOM. `config.ps1`: ASCII sin BOM |
| `SSslOptions threw an exception` (Veeam) | Módulo de Veeam 12 cargado en `pwsh` | Correr con `powershell.exe` |
| Veeam 13 pide PowerShell 7.6 | pwsh viejo o ausente | `winget install Microsoft.PowerShell` |
| ACL con carpetas del Windows en el servicio del NAS | `smb-check` con `$SMB_PATH = "Z:"` (versión < 1.1.0) | Actualizar y usar ruta UNC |
| "Ruta no encontrada" en la tarea | Unidad mapeada que no existe para SYSTEM | Ruta UNC en `$SMB_PATH` |
| Dos system-health reportando en el mismo server | Se instalaron los dos scripts | Dejar uno solo y borrar la tarea del otro |
| Backup "vencido" con backup semanal | Frecuencia esperada sin cargar (default 26 h) | Cargar la frecuencia en el servicio |
| Cron del portal da 401 | Vault (`cron_anon_key`) con valor mal cargado | `vault.update_secret` con la anon key real |
| Router en el mapa como "Nunca reportó" | `mk-monitor.sh` < 1.1.0 (no mandaba heartbeat) | Actualizar `mk-monitor.sh` |

## Cómo responder

1. Resumí lo relevado y lo que falta (una lista corta de preguntas, solo lo imprescindible).
2. Dá el plan por equipo en el orden de este documento, con los archivos de configuración completos listos para copiar (fuera del repo).
3. Terminá con el checklist de verificación del paso 3 adaptado a ese cliente.
4. Si algo del repo no coincide con este documento (un script cambió de nombre o de variables), seguí al repo y avisá para actualizar la skill.
