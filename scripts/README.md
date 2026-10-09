# Scripts de Monitoreo e Integración

Scripts para reportar backups, salud del sistema y eventos de red al Service Catalog.

## Estructura

```
scripts/
├── windows/
│   ├── config.ps1                    # Configuración por cliente (SERVICE_ID, INGEST_SECRET, etc.)
│   ├── veeam-report.ps1              # Veeam Backup & Replication (servidor central)
│   ├── veeam-agent-report.ps1        # Veeam Agent for Windows (standalone)
│   ├── veeam-restore-test-report.ps1 # Resultado de prueba de restauración
│   ├── kopia-report.ps1              # Kopia Backup — hook after-snapshot → ingest-backup
│   ├── system-health.ps1             # CPU / RAM / Disco C: + speedtest → ingest-heartbeat
│   ├── system-health-server.ps1      # Windows Server: hardware + red + RDP → ingest-heartbeat
│   ├── server-snapshot.ps1           # Lee RDS_Telemetry.csv → ingest-heartbeat (source: server-snapshot)
│   └── cristar-backup-report.ps1     # Software de facturación Cristar (lee log)
├── linux/
│   ├── backup.sh                     # Backup completo de VPS (tar + rsync/rclone + reporte)
│   ├── backup.env.example            # Plantilla de configuración para backup.sh
│   ├── backup-ingest.env             # Configuración para report-backup.sh (rsnapshot standalone)
│   ├── report-backup.sh              # Reporte individual de snapshot rsnapshot/rsync
│   ├── system-health.sh              # CPU / RAM / Disco / Uptime de VPS → ingest-heartbeat
│   ├── system-health.env.example     # Plantilla de configuración para system-health.sh
│   ├── mikrotik-heartbeat.sh         # Lee logs de Mikrotik por cliente → ingest-heartbeat
│   ├── mk-ingest.sh                  # Envía telemetría y eventos MikroTik (JSON files) → Supabase
│   ├── mk-ingest.conf.example        # Plantilla de configuración para mk-ingest.sh
│   ├── mk-monitor.sh                 # Chequeos activos vía REST API (ping RDP, CPU, sesiones)
│   ├── mk-monitor.conf.example       # Plantilla de configuración para mk-monitor.sh y mk-syslog.sh
│   ├── mk-syslog.sh                  # Daemon receptor syslog UDP — logins, brute-force → ingest-events
│   └── mk-syslog.service             # Unidad systemd para mk-syslog.sh
├── mikrotik/
│   └── setup.rsc                     # Comandos RouterOS: usuario monitor + syslog remoto
└── nas/
    ├── backup-ingest.env             # Configuración NAS OpenMediaVault
    └── report-all-backups.sh         # Reporte de todos los snapshots del NAS/OMV al panel
```

---

## MikroTik — Monitoreo activo + syslog (Fase 1)

Tres scripts coordinados que corren en el **VPS que tiene acceso al router**
(puede ser el VPS del cliente). Los datos van siempre a nuestro Supabase vía HTTPS.

```
Router MikroTik
  │
  ├── REST API (HTTPS :443) ──────→ mk-monitor.sh  (cron cada 5 min)
  │    /rest/tool/ping              • ping al RDP target
  │    /rest/system/resource        • CPU, RAM, uptime, detección de reinicios
  │    /rest/user/active            • sesiones activas
  │
  └── Syslog UDP :5140 ───────────→ mk-syslog.sh   (daemon systemd)
       topics=account,ppp,error     • brute-force: >10 fallos/IP/hora → 1 alerta
                                    • login desde IP desconocida → alerta inmediata
```

Ambos scripts leen la **misma** `mk-monitor.conf` y envían eventos via `ingest-events`.

### 1. Configurar el router (una vez por sitio)

Pegar en Terminal de Winbox o SSH — o usar el archivo `mikrotik/setup.rsc`:

```routeros
# Reemplazar <IP_VPS> y <PASSWORD> antes de ejecutar
/user/group add name=cenas-monitor \
    policy=read,api,rest-api,!write,!policy,!test,!winbox,!password,!web,!ftp,!reboot,!ssh,!telnet,!sensitive

/user add name=monitor group=cenas-monitor password="<PASSWORD>" address=<IP_VPS>

/system/logging/action add name=cenassyslog target=remote \
    remote=<IP_VPS> remote-port=5140 remote-log-format=bsd

/system/logging add topics=account action=cenassyslog
/system/logging add topics=ppp,error action=cenassyslog
```

Verificar que la REST API esté habilitada: **IP → Services → api-ssl** debe estar activo.

### 2. Instalar scripts en el VPS

```bash
# Dependencias
apt install -y socat jq

# Descargar scripts
curl -fsSL https://raw.githubusercontent.com/mathcenas/service-catalog/main/scripts/linux/mk-monitor.sh \
  -o /usr/local/bin/mk-monitor && chmod +x /usr/local/bin/mk-monitor

curl -fsSL https://raw.githubusercontent.com/mathcenas/service-catalog/main/scripts/linux/mk-syslog.sh \
  -o /usr/local/bin/mk-syslog && chmod +x /usr/local/bin/mk-syslog

# Configuración (completar con datos reales)
curl -fsSL https://raw.githubusercontent.com/mathcenas/service-catalog/main/scripts/linux/mk-monitor.conf.example \
  -o /srv/network-monitor/mk-monitor.conf
# → editar /srv/network-monitor/mk-monitor.conf
```

### 3. Configurar mk-monitor.conf

El `SERVICE_ID` e `INGEST_SECRET` se generan en el Service Catalog:
**Servicios → [servicio Router/Switch] → Editar → Setup monitoreo MikroTik** — los bloques
para copiar ya están pre-rellenados con los valores del servicio.

```bash
SUPABASE_URL="https://aguxbtvwljaonagannuz.supabase.co"
ANON_KEY="<supabase-anon-key>"
SITE_COUNT=1

SITE_1_NAME="RegionalSur"
SITE_1_SERVICE_ID="<uuid-del-servicio>"
SITE_1_INGEST_SECRET="<ingest-secret>"
SITE_1_ROUTER_IP="192.168.88.1"
SITE_1_ROUTER_USER="monitor"
SITE_1_ROUTER_PASS="<contraseña>"
SITE_1_RDP_TARGET="192.168.88.150"        # dejar vacío si no aplica
SITE_1_KNOWN_IPS="192.168.88.0/24,1.2.3.4"  # IPs desde las que se permite login
```

### 4. Activar cron y daemon

```bash
# mk-monitor: cron cada 5 minutos
(crontab -l 2>/dev/null; echo "*/5 * * * * /usr/local/bin/mk-monitor /srv/network-monitor/mk-monitor.conf >> /srv/network-monitor/logs/mk-monitor.log 2>&1") | crontab -

# mk-syslog: servicio systemd persistente
curl -fsSL https://raw.githubusercontent.com/mathcenas/service-catalog/main/scripts/linux/mk-syslog.service \
  -o /etc/systemd/system/mk-syslog.service

# Editar ExecStart para apuntar a la conf correcta si es necesario
systemctl daemon-reload
systemctl enable --now mk-syslog
systemctl status mk-syslog
```

### 5. Firewall en el VPS (opcional pero recomendado)

```bash
# Aceptar syslog UDP solo desde las IPs de los routers
ufw allow from <IP_ROUTER> to any port 5140 proto udp
# Si el router usa DDNS, actualizar esta regla cuando cambie la IP
```

### Flujo completo

```
[Router MikroTik]                    [VPS colector]                [Supabase]
      │                                    │
      │  REST HTTPS /rest/tool/ping  ──→  mk-monitor.sh  ──→  ingest-events  ──→  device_events
      │  REST HTTPS /rest/system/resource       (cada 5 min)
      │  REST HTTPS /rest/user/active
      │
      │  Syslog UDP :5140  ──────────→  mk-syslog.sh   ──→  ingest-events  ──→  device_events
           topics=account,ppp,error        (daemon)
```

Los eventos aparecen en el portal bajo el servicio correspondiente.
El `INGEST_SECRET` es el único credencial que autentica qué servicio es —
el VPS del cliente solo necesita salida HTTPS al exterior.

---

## Windows — Configuración inicial

1. Copiar carpeta `windows/` al servidor (ej: `C:\Scripts\`)
2. Editar `config.ps1` con los valores del cliente:
   - `INGEST_URL`, `HEARTBEAT_URL`, `ANON_KEY`, `INGEST_SECRET`, `SERVICE_ID`
3. Si un servidor tiene **múltiples servicios** en el portal (ej: Veeam + Kopia con SERVICE_IDs distintos), crear un `config-nombre.ps1` por cada uno y ajustar el dot-source en cada script.
4. Schedulear con Task Scheduler (ver sección por script)

### system-health.ps1 — Métricas de hardware cada 1 hora

```powershell
$Action = New-ScheduledTaskAction `
  -Execute "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" `
  -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\Scripts\system-health.ps1"'
$Trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Hours 1) -Once -At "00:00"
$Settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName "System Health Monitor" `
  -Action $Action -Trigger $Trigger -Settings $Settings -User "SYSTEM" -RunLevel Highest -Force
```

### system-health-server.ps1 — Windows Server: hardware + red + RDP cada 5 minutos

```powershell
$Action = New-ScheduledTaskAction `
  -Execute "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" `
  -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\Scripts\system-health-server.ps1"'
$Trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Minutes 5) -Once -At "00:00"
$Settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
Register-ScheduledTask -TaskName "System Health Server" `
  -Action $Action -Trigger $Trigger -Settings $Settings -User "SYSTEM" -RunLevel Highest -Force
```

### server-snapshot.ps1 — Lee RDS_Telemetry.csv una vez por día (1pm)

```powershell
$Action = New-ScheduledTaskAction `
  -Execute "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" `
  -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\Scripts\server-snapshot.ps1"'
$Trigger = New-ScheduledTaskTrigger -Daily -At "13:00"
$Settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
Register-ScheduledTask -TaskName "ServerSnapshot" `
  -Action $Action -Trigger $Trigger -Settings $Settings -User "SYSTEM" -RunLevel Highest -Force
```

### veeam-report.ps1 — Como Post-Job script en Veeam

En cada job: **Edit Job → Storage → Advanced → Scripts → Post-job script**:
```
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Scripts\veeam-report.ps1"
```

O schedulear diariamente después de que terminen los jobs:
```powershell
$Action = New-ScheduledTaskAction `
  -Execute "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" `
  -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\Scripts\veeam-report.ps1"'
$Trigger = New-ScheduledTaskTrigger -Daily -At "07:00"
$Settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName "Veeam Report" `
  -Action $Action -Trigger $Trigger -Settings $Settings -User "SYSTEM" -RunLevel Highest -Force
```

### kopia-report.ps1 — Reporte de snapshots Kopia (una vez por día)

Lee los snapshots de las últimas 25 horas vía `kopia snapshot list --all --json`.

> Si el servidor tiene dos servicios en el portal (ej: Kopia en nube + Veeam local), usar
> `config-cloud-backup.ps1` para Kopia y `config.ps1` para Veeam.

```powershell
$Action = New-ScheduledTaskAction `
  -Execute "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" `
  -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\Scripts\kopia-report.ps1"'
$Trigger = New-ScheduledTaskTrigger -Daily -At "07:00"
$Settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName "Kopia Report" `
  -Action $Action -Trigger $Trigger -Settings $Settings -User "SYSTEM" -RunLevel Highest -Force
```

---

## Linux — Backup de VPS (`backup.sh`)

```bash
cp backup.sh /srv/cloud-backup/backup.sh
cp backup.env.example /srv/cloud-backup/.env
chmod +x /srv/cloud-backup/backup.sh && chmod 600 /srv/cloud-backup/.env
# Crontab: todos los días a las 2am
0 2 * * * /srv/cloud-backup/backup.sh
```

## Linux — Reporte rsnapshot (`report-backup.sh`)

```bash
cp backup-ingest.env /etc/backup-ingest.env && chmod 600 /etc/backup-ingest.env
cp report-backup.sh /usr/local/bin/report-backup.sh && chmod +x /usr/local/bin/report-backup.sh
# Llamar después de cada snapshot:
report-backup.sh "Daily Backup" $? /srv/snapshots/daily.0
```

## Linux — Sistema de salud VPS (`system-health.sh`)

```bash
cp system-health.sh /srv/scripts/system-health.sh
cp system-health.env.example /srv/scripts/.env
chmod +x /srv/scripts/system-health.sh && chmod 600 /srv/scripts/.env
# Crontab: cada hora
0 * * * * /srv/scripts/system-health.sh
```

---

## NAS / OpenMediaVault (`report-all-backups.sh`)

```bash
cp backup-ingest.env /etc/backup-ingest.env && chmod 600 /etc/backup-ingest.env
cp report-all-backups.sh /usr/local/bin/report-all-backups.sh
chmod +x /usr/local/bin/report-all-backups.sh
# Crontab: todos los días a las 8am
0 8 * * * /usr/local/bin/report-all-backups.sh
```

---

## Edge Functions utilizadas

| Script | Edge Function | Tabla destino |
|--------|--------------|---------------|
| `backup.sh` | `ingest-backup` | `service_backups` |
| `kopia-report.ps1` | `ingest-backup` | `service_backups` |
| `veeam-report.ps1` | `ingest-backup` | `service_backups` |
| `veeam-agent-report.ps1` | `ingest-backup` | `service_backups` |
| `veeam-restore-test-report.ps1` | `ingest-backup` | `service_backups` |
| `cristar-backup-report.ps1` | `ingest-backup` | `service_backups` |
| `report-backup.sh` | `ingest-backup` | `service_backups` |
| `report-all-backups.sh` | `ingest-backup` | `service_backups` |
| `system-health.ps1` | `ingest-heartbeat` | `service_heartbeats` |
| `system-health-server.ps1` | `ingest-heartbeat` | `service_heartbeats` |
| `server-snapshot.ps1` | `ingest-heartbeat` | `service_heartbeats` |
| `system-health.sh` | `ingest-heartbeat` | `service_heartbeats` |
| `mikrotik-heartbeat.sh` | `ingest-heartbeat` | `service_heartbeats` |
| `mk-ingest.sh` | `ingest-telemetry` / `ingest-events` | `service_heartbeats` / `device_events` |
| `mk-monitor.sh` | `ingest-events` | `device_events` |
| `mk-syslog.sh` | `ingest-events` | `device_events` |
