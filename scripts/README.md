# Scripts de Monitoreo e Integración

Scripts para reportar backups y salud del sistema al Service Catalog.

## Estructura

```
scripts/
├── windows/
│   ├── config.ps1                    # Configuración por cliente (SERVICE_ID, INGEST_SECRET, etc.)
│   ├── veeam-report.ps1              # Veeam Backup & Replication (servidor central)
│   ├── veeam-agent-report.ps1        # Veeam Agent for Windows (standalone)
│   ├── veeam-restore-test-report.ps1 # Resultado de prueba de restauración
│   ├── system-health.ps1             # CPU / RAM / Disco C: + speedtest → ingest-heartbeat
│   ├── system-health-server.ps1      # Windows Server: hardware + red + RDP → ingest-heartbeat
│   ├── server-snapshot.ps1           # Lee RDS_Telemetry.csv → ingest-heartbeat (source: server-snapshot)
│   └── cristar-backup-report.ps1     # Software de facturación Cristar (lee log)
├── linux/
│   ├── backup.sh                     # Backup completo de VPS (tar + rsync/rclone + reporte)
│   ├── backup.env.example            # Plantilla de configuración para backup.sh
│   ├── backup-ingest.env             # Configuración para report-backup.sh (rsnapshot standalone)
│   ├── report-backup.sh              # Reporte individual de snapshot rsnapshot/rsync
│   └── mikrotik-heartbeat.sh         # Lee logs de Mikrotik por cliente → ingest-heartbeat
└── nas/
    ├── backup-ingest.env             # Configuración NAS OpenMediaVault (con paths de snapshots)
    └── report-all-backups.sh         # Reporte de todos los snapshots del NAS/OMV al panel
```

---

## Windows — Configuración inicial

1. Copiar carpeta `windows/` al servidor (ej: `C:\Scripts\`)
2. Editar `config.ps1` con los valores del cliente:
   - `SUPABASE_URL`, `ANON_KEY`, `INGEST_SECRET`, `SERVICE_ID`
3. Schedulear con Task Scheduler (ver sección por script)

### system-health.ps1 — Métricas de hardware cada 1 hora

Reporta CPU, RAM y disco C: al heartbeat. Opcional: speedtest si hay `speedtest.exe` en la carpeta.

```powershell
$Action = New-ScheduledTaskAction `
  -Execute "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" `
  -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\Scripts\system-health.ps1"'

$Trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Hours 1) -Once -At "00:00"

$Settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

Register-ScheduledTask `
  -TaskName "System Health Monitor" `
  -Action $Action -Trigger $Trigger -Settings $Settings `
  -User "SYSTEM" -RunLevel Highest -Force
```

### system-health-server.ps1 — Windows Server: hardware + red + RDP cada 5 minutos

```powershell
$Action = New-ScheduledTaskAction `
  -Execute "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" `
  -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\Scripts\system-health-server.ps1"'

$Trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Minutes 5) -Once -At "00:00"

$Settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 2)

Register-ScheduledTask `
  -TaskName "System Health Server" `
  -Action $Action -Trigger $Trigger -Settings $Settings `
  -User "SYSTEM" -RunLevel Highest -Force
```

### server-snapshot.ps1 — Lee RDS_Telemetry.csv una vez por día (1pm)

```powershell
$Action = New-ScheduledTaskAction `
  -Execute "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" `
  -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\Scripts\server-snapshot.ps1"'

$Trigger = New-ScheduledTaskTrigger -Daily -At "13:00"

$Settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 2)

Register-ScheduledTask `
  -TaskName "ServerSnapshot" `
  -Action $Action -Trigger $Trigger -Settings $Settings `
  -User "SYSTEM" -RunLevel Highest -Force
```

### veeam-report.ps1 — Como Post-Job script en Veeam

En cada job de Veeam: **Edit Job → Storage → Advanced → Scripts → Post-job script**:
```
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Scripts\veeam-report.ps1"
```

O schedulear en Task Scheduler una vez por día después de que terminen los jobs:
```powershell
$Trigger = New-ScheduledTaskTrigger -Daily -At "07:00"
```

---

## Linux — Backup de VPS (`backup.sh`)

```bash
cp backup.sh /srv/cloud-backup/backup.sh
cp backup.env.example /srv/cloud-backup/.env
chmod +x /srv/cloud-backup/backup.sh
chmod 600 /srv/cloud-backup/.env
# Crontab: todos los días a las 2am
0 2 * * * /srv/cloud-backup/backup.sh
```

## Linux — Reporte rsnapshot (`report-backup.sh`)

```bash
cp backup-ingest.env /etc/backup-ingest.env
chmod 600 /etc/backup-ingest.env
cp report-backup.sh /usr/local/bin/report-backup.sh
chmod +x /usr/local/bin/report-backup.sh
# Llamar después de cada snapshot:
report-backup.sh "Daily Backup" $? /srv/snapshots/daily.0
```

## Linux — Mikrotik Heartbeat (`mikrotik-heartbeat.sh`)

Lee el último registro METRICAS de cada archivo `.log` en el directorio de historial y envía
las métricas (CPU, RAM, WAN, IPsec) al heartbeat. Un archivo de estado evita reenviar la misma línea.

```bash
cp mikrotik-heartbeat.sh /srv/network-monitor/
chmod +x /srv/network-monitor/mikrotik-heartbeat.sh
# Editar: SUPABASE_URL, ANON_KEY, INGEST_SECRET y SERVICE_MAP
```

Agregar un `SERVICE_MAP` por cada cliente dentro del script:
```bash
SERVICE_MAP["RegionalSur"]="uuid-del-servicio"
SERVICE_MAP["RegionalNorte"]="uuid-del-servicio"
```

```bash
# Crontab: cada minuto
* * * * * /srv/network-monitor/mikrotik-heartbeat.sh
```

## NAS / OpenMediaVault (`report-all-backups.sh`)

```bash
cp backup-ingest.env /etc/backup-ingest.env
chmod 600 /etc/backup-ingest.env
cp report-all-backups.sh /usr/local/bin/report-all-backups.sh
chmod +x /usr/local/bin/report-all-backups.sh
# Crontab: todos los días a las 8am
0 8 * * * /usr/local/bin/report-all-backups.sh
```

---

## Edge Functions utilizadas

| Script | Edge Function |
|--------|--------------|
| `backup.sh` | `ingest-backup` |
| `veeam-report.ps1` | `ingest-backup` |
| `veeam-agent-report.ps1` | `ingest-backup` |
| `veeam-restore-test-report.ps1` | `ingest-backup` |
| `cristar-backup-report.ps1` | `ingest-backup` |
| `report-backup.sh` | `ingest-backup` |
| `report-all-backups.sh` | `ingest-backup` |
| `system-health.ps1` | `ingest-heartbeat` |
| `system-health-server.ps1` | `ingest-heartbeat` |
| `server-snapshot.ps1` | `ingest-heartbeat` |
| `mikrotik-heartbeat.sh` | `ingest-heartbeat` |
