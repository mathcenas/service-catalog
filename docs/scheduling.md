# Scheduling — Crontab y Administrador de Tareas

Referencia de todos los scripts del panel y cómo schedulearlos.

---

## Linux — Crontab

Editar con `crontab -e` (como root, o el usuario que corre los scripts).

```cron
# ─── Service Catalog Scripts ────────────────────────────────────────────────

# System health (métricas CPU/RAM/disco) — cada hora
0 * * * * /usr/local/bin/system-health.sh >> /var/log/system-health.log 2>&1

# Mikrotik heartbeat (procesa logs de red) — cada minuto
* * * * * /srv/network-monitor/mikrotik-heartbeat.sh >> /var/log/mikrotik-heartbeat.log 2>&1

# Report backup rsnapshot/rsync (llamar desde el post-job o schedulear)
# Uso: report-backup.sh "<nombre_job>" <exit_code> <directorio_snapshot>
# 0 8 * * * /usr/local/bin/report-backup.sh "Daily Backup" 0 /mnt/backup/daily.0

# ─── NAS (OpenMediaVault) ───────────────────────────────────────────────────

# Snapshot de permisos SMB — semanal, lunes 6am
0 6 * * 1 /usr/local/bin/report-smb-acl.sh >> /var/log/nas-smb-acl.log 2>&1

# Reporte de todos los backups NAS — diario 8am
0 8 * * * /usr/local/bin/report-all-backups.sh >> /var/log/nas-backup-report.log 2>&1

# ─── ACL Export (onboarding/offboarding) ────────────────────────────────────

# Exportar revisiones ACL al sistema de onboarding — semanal, lunes 7am
0 7 * * 1 cd /srv/acl-export && /usr/bin/python3 acl-export.py >> /var/log/acl-export.log 2>&1
```

### Instalación de scripts en Linux

```bash
# Copiar script al sistema
cp system-health.sh /usr/local/bin/system-health.sh
chmod +x /usr/local/bin/system-health.sh

# Copiar y completar configuración
cp system-health.env.example /etc/backup-ingest.env
chmod 600 /etc/backup-ingest.env
nano /etc/backup-ingest.env
```

### Variables de entorno (Linux)

Cada script busca la config en este orden:
1. Argumento CLI: `./script.sh /ruta/custom.env`
2. `/etc/backup-ingest.env`
3. `.env` en el mismo directorio del script

Archivo mínimo `/etc/backup-ingest.env`:
```bash
SUPABASE_URL="https://PROYECTO.supabase.co"
SUPABASE_ANON_KEY="REEMPLAZAR"
INGEST_SECRET="REEMPLAZAR"
SERVICE_ID="REEMPLAZAR-UUID"

# Uptime Kuma (opcional)
KUMA_PUSH_URL=""
```

---

## Windows — Administrador de Tareas

### Configuración inicial

1. Copiar los scripts a `C:\Scripts\`
2. Editar `C:\Scripts\config.ps1` con los valores del cliente:

```powershell
$INGEST_URL    = "https://PROYECTO.supabase.co/functions/v1/ingest-backup"
$HEARTBEAT_URL = "https://PROYECTO.supabase.co/functions/v1/ingest-heartbeat"
$ANON_KEY      = "REEMPLAZAR_CON_ANON_KEY"
$INGEST_SECRET = "REEMPLAZAR_CON_INGEST_SECRET"
$SERVICE_ID    = "REEMPLAZAR_CON_UUID"
$KUMA_PUSH_URL = ""   # opcional
```

3. Permitir ejecución de scripts (una vez por máquina, como administrador):
```powershell
Set-ExecutionPolicy RemoteSigned -Scope LocalMachine
```

---

### Crear tareas desde PowerShell (como Administrador)

#### System Health — cada hora

```powershell
$action  = New-ScheduledTaskAction -Execute "powershell.exe" `
             -Argument "-NonInteractive -ExecutionPolicy Bypass -File C:\Scripts\system-health.ps1"
$trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Hours 1) -Once -At (Get-Date)
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
Register-ScheduledTask -TaskName "ServiceCatalog - System Health" `
  -Action $action -Trigger $trigger -Settings $settings `
  -RunLevel Highest -Force
```

#### Veeam Report — diario 8am

```powershell
$action  = New-ScheduledTaskAction -Execute "powershell.exe" `
             -Argument "-NonInteractive -ExecutionPolicy Bypass -File C:\Scripts\veeam-report.ps1"
$trigger = New-ScheduledTaskTrigger -Daily -At "08:00"
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
Register-ScheduledTask -TaskName "ServiceCatalog - Veeam Report" `
  -Action $action -Trigger $trigger -Settings $settings `
  -RunLevel Highest -Force
```

#### SMB ACL Report — semanal, lunes 6am

```powershell
$action  = New-ScheduledTaskAction -Execute "powershell.exe" `
             -Argument "-NonInteractive -ExecutionPolicy Bypass -File C:\Scripts\report-smb-acl.ps1"
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At "06:00"
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
Register-ScheduledTask -TaskName "ServiceCatalog - SMB ACL Report" `
  -Action $action -Trigger $trigger -Settings $settings `
  -RunLevel Highest -Force
```

#### Veeam Agent Report — diario 9am

```powershell
$action  = New-ScheduledTaskAction -Execute "powershell.exe" `
             -Argument "-NonInteractive -ExecutionPolicy Bypass -File C:\Scripts\veeam-agent-report.ps1"
$trigger = New-ScheduledTaskTrigger -Daily -At "09:00"
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
Register-ScheduledTask -TaskName "ServiceCatalog - Veeam Agent Report" `
  -Action $action -Trigger $trigger -Settings $settings `
  -RunLevel Highest -Force
```

#### Kopia Report — diario 9am

```powershell
$action  = New-ScheduledTaskAction -Execute "powershell.exe" `
             -Argument "-NonInteractive -ExecutionPolicy Bypass -File C:\Scripts\kopia-report.ps1"
$trigger = New-ScheduledTaskTrigger -Daily -At "09:00"
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
Register-ScheduledTask -TaskName "ServiceCatalog - Kopia Report" `
  -Action $action -Trigger $trigger -Settings $settings `
  -RunLevel Highest -Force
```

#### Server Snapshot — diario 7am

```powershell
$action  = New-ScheduledTaskAction -Execute "powershell.exe" `
             -Argument "-NonInteractive -ExecutionPolicy Bypass -File C:\Scripts\server-snapshot.ps1"
$trigger = New-ScheduledTaskTrigger -Daily -At "07:00"
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
Register-ScheduledTask -TaskName "ServiceCatalog - Server Snapshot" `
  -Action $action -Trigger $trigger -Settings $settings `
  -RunLevel Highest -Force
```

---

### Veeam — configurar como Post-Job Script

Para que `veeam-report.ps1` se ejecute automáticamente al terminar cada job:

1. Abrir Veeam Backup & Replication
2. Editar el job → **Storage** → **Advanced** → pestaña **Scripts**
3. En **Post-job script** ingresar:
   ```
   powershell.exe -NonInteractive -ExecutionPolicy Bypass -File C:\Scripts\veeam-report.ps1
   ```

---

### Verificar tareas creadas

```powershell
Get-ScheduledTask | Where-Object { $_.TaskName -like "ServiceCatalog*" } | Select-Object TaskName, State
```

### Ver último resultado de una tarea

```powershell
(Get-ScheduledTaskInfo -TaskName "ServiceCatalog - System Health").LastTaskResult
# 0 = OK, cualquier otro = error
```
