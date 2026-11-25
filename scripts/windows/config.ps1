# =============================================================
# config.ps1 - Configuracion por cliente/servidor
# Copiar este archivo por cada cliente y ajustar los valores
# =============================================================
$SCRIPT_VERSION = "1.6.5"

$INGEST_URL    = "https://aguxbtvwljaonagannuz.supabase.co/functions/v1/ingest-backup"
$HEARTBEAT_URL = "https://aguxbtvwljaonagannuz.supabase.co/functions/v1/ingest-heartbeat"
$ANON_KEY      = "REEMPLAZAR_CON_SUPABASE_ANON_KEY"
$INGEST_SECRET = "REEMPLAZAR_CON_INGEST_SECRET_DEL_SERVICIO"
$SERVICE_ID    = "REEMPLAZAR_CON_UUID_DEL_SERVICIO"

# ---------- smb-check.ps1 ----------
# Carpeta compartida a monitorear (dejar vacio si no se usa smb-check.ps1)
$SMB_SERVICE_ID    = ""   # UUID del servicio en la app (distinto al $SERVICE_ID del server)
$SMB_INGEST_SECRET = ""   # Ingest secret del servicio SMB (Settings del servicio en la app)

# Otros servicios del catalogo que corren en este mismo equipo (ej: un sistema contable
# instalado en el server). Cada uno recibe una copia del heartbeat de hardware (system-health).
# $EXTRA_HEALTH_SERVICES = @(
#     @{ Name = "Contabilidad"; ServiceId = "UUID-DEL-SERVICIO"; IngestSecret = "INGEST_SECRET_DEL_SERVICIO" }
# )
$EXTRA_HEALTH_SERVICES = @()
$SMB_KUMA_PUSH_URL = ""   # Push monitor de Kuma para el share (distinto al del server)
$SMB_PATH          = ""   # Ruta local de la carpeta compartida, ej: C:\Compartidos\Ventas

# Ventana de busqueda para veeam-agent-report.ps1
# Diario: 25  |  Semanal: 170  (7 dias + 2 hs de margen)
$VEEAM_LOOKBACK_HOURS = 25

# Servicio al que reportan veeam-report.ps1 y veeam-agent-report.ps1 (vacio = $SERVICE_ID).
# Para que los backups de Veeam figuren en el servicio de la carpeta compartida:
#   $VEEAM_SERVICE_ID    = $SMB_SERVICE_ID
#   $VEEAM_INGEST_SECRET = $SMB_INGEST_SECRET
$VEEAM_SERVICE_ID    = ""
$VEEAM_INGEST_SECRET = ""

# IP privada de Tailscale del servidor de destino (cloud del cliente)
# Si se configura, kopia-report.ps1 verifica conectividad antes de reportar
# Dejar vacio para omitir el chequeo
$TAILSCALE_IP  = ""

# Equipos de Tailscale a los que no se les controla el vencimiento de clave (separados por coma).
# Ej: notebooks que se dejan con vencimiento a propósito. Los servidores van con "Disable key expiry".
$TAILSCALE_IGNORE = ""

# Prueba de VPN (system-health): un puerto TCP del otro lado del túnel. Si no responde, ticket.
# Ej. Carral → Facturación de Regional por WireGuard:
#   $VPN_CHECKS = @( @{ name = "WireGuard a Regional (RDP Facturación)"; host = "10.10.10.1"; port = 3389 } )
$VPN_CHECKS = @()

# Uptime Kuma - Push Monitors (opcional)
# Pegar la URL base de cada monitor tipo Push. Si esta vacio, no se pinga.
# Ejemplo: https://kuma.midominio.com/api/push/AbCdEfGhIj
$KUMA_PUSH_URL        = ""   # fallback generico (si los especificos estan vacios, se usa este)
$KUMA_PUSH_URL_HEALTH = ""   # system-health.ps1
$KUMA_PUSH_URL_BACKUP = ""   # kopia-report.ps1 / veeam-agent-report.ps1 / kls-report.ps1

# ---------- system-health.ps1 - secciones opcionales ----------
# Poner $false en los checks que el cliente NO usa para que no
# aparezcan como "failed" en telemetria.
$CHECK_RDP       = $true   # $false si el cliente no usa Remote Desktop
$CHECK_SPEEDTEST = $true   # $false si no hay herramienta speedtest instalada
$CHECK_SMART     = $true   # $false en VMs (discos virtuales no reportan SMART real)
$CHECK_OS_UPDATES = $true  # actualizaciones pendientes de Windows (solo lectura, 1 consulta por dia)
$CHECK_DISK_EVENTS = $true  # errores de disco en el Visor de eventos (detecta discos detras de RAID)
$DISK_EVENT_HOURS  = 24     # horas hacia atras que se revisan
$CHECK_DISK_INIT   = $true  # discos sin inicializar o desconectados
$CHECK_DYNAMIC_RAID = $true  # espejos armados en Administracion de discos (discos dinamicos), leidos con diskpart
$CHECK_HYPERV_CHECKPOINTS = $true   # puntos de control viejos de Hyper-V (se omite si no hay Hyper-V)
$CHECKPOINT_MAX_DAYS = 7            # dias para considerar viejo un punto de control
$CHECKPOINT_IGNORE   = "*_replica,*replica*"   # VMs a ignorar (las replicas usan puntos de control a proposito)
$CHECK_KOPIA_MAINTENANCE   = $true  # kopia-report: revisar que el mantenimiento del repositorio corra
$KOPIA_MAINTENANCE_MAX_DAYS = 3      # dias sin mantenimiento completo para avisar
$KOPIA_TASK_USER   = ""      # usuario de Windows de KopiaUI (ej. "PC"): setup-scheduled-tasks registra la tarea de Kopia con ese usuario
$KOPIA_REPORT_TIME = "19:30" # hora de la tarea de Kopia (despues del snapshot diario)
# $KOPIA_EXE    = "C:\Users\PC\AppData\Local\Programs\KopiaUI\resources\server\kopia.exe"  # si la tarea corre con otro usuario
# $KOPIA_CONFIG = "C:\Users\PC\AppData\Roaming\kopia\repository.config"
$CPU_WATCH_ENABLED   = $false   # cpu-watch.ps1: vigilar picos de CPU en una franja (setup-scheduled-tasks registra la tarea)
$CPU_WATCH_START     = "12:30"
$CPU_WATCH_END       = "15:30"
$CPU_WATCH_THRESHOLD = 80        # % de CPU total que cuenta como pico

function Invoke-Kuma {
    param([string]$Status, [string]$Msg, [string]$Url = "")
    $target = if ($Url) { $Url } else { $KUMA_PUSH_URL }
    if (-not $target) { return }
    $base = $target -replace '\?.*', ''
    $u    = "${base}?status=${Status}&msg=$([uri]::EscapeDataString($Msg))&ping=0"
    try { Invoke-RestMethod -Uri $u -Method Get -TimeoutSec 10 | Out-Null } catch {}
}
function Invoke-KumaHealth { param([string]$Status, [string]$Msg)
    $url = if ($KUMA_PUSH_URL_HEALTH) { $KUMA_PUSH_URL_HEALTH } else { $KUMA_PUSH_URL }
    Invoke-Kuma -Status $Status -Msg $Msg -Url $url
}
function Invoke-KumaBackup { param([string]$Status, [string]$Msg)
    $url = if ($KUMA_PUSH_URL_BACKUP) { $KUMA_PUSH_URL_BACKUP } else { $KUMA_PUSH_URL }
    Invoke-Kuma -Status $Status -Msg $Msg -Url $url
}

# ---------- vmware-backup (Backup-WorkstationVMs.ps1) ----------
# Dejar en blanco / $null los que no aplican al cliente.

# Ruta al vmrun.exe (dejar vacío para usar la ubicación por defecto)
$VM_VMRUN_PATH     = ""   # ej: "C:\Program Files (x86)\VMware\VMware Workstation\vmrun.exe"

# Carpeta raíz donde están guardadas las VMs (para auto-descubrir *.vmx)
# El script busca un nivel de profundidad: $VM_ROOT_DIR\<nombre-vm>\<nombre-vm>.vmx
# Si se deja vacío, el script lee el inventario de VMware (%APPDATA%\VMware\inventory.vmls)
$VM_ROOT_DIR       = ""   # ej: "D:\VMs"

# Destino de backup (UNC o local)
$VM_DEST_ROOT      = ""   # ej: "\\NAS\backups-vms"

# Cuántas copias diarias conservar por VM
$VM_RETENTION      = 3

# Margen mínimo de espacio libre que debe quedar en destino (GB)
$VM_MIN_FREE_GB    = 20

# Timeout esperando que la VM suspenda (segundos)
$VM_SUSPEND_TIMEOUT = 600

# Carpeta de logs (vacío = misma carpeta que el script)
$VM_LOG_DIR        = ""

# Hora límite: las VMs deben estar de vuelta corriendo antes de esta hora
# Schedule-VMBackup.ps1 usa este valor para calcular el horario de inicio
$VM_FINISH_BY      = "06:30"

# Velocidad de transferencia al destino (MB/s). Sirve para estimar duración.
# Gigabit LAN a NAS = ~80-110 MB/s. SSD local = ~300+. Ajustar con datos reales.
$VM_THROUGHPUT_MBPS = 100

# URL de la función de notificaciones de mantenimiento VM.
# Si se deja vacío, no se envían notificaciones de suspend/start.
# Los SERVICE_ID, INGEST_SECRET y ANON_KEY de arriba se reusan.
$VM_EVENT_URL      = "https://aguxbtvwljaonagannuz.supabase.co/functions/v1/ingest-vm-event"

# ---------- Re-intento automático de backup ----------
# Llama a esto al final de un script si hubo warning/error.
# Escribe un script temporal, lo lanza detached (WindowStyle Hidden) y sale.
# El proceso secundario:
#   1. Espera $CheckAfterMinutes (default 15) y lee el log buscando $SearchPattern.
#   2. Si lo encuentra, espera los minutos restantes hasta $RetryAfterMinutes (default 60)
#      y re-ejecuta el mismo script con PowerShell.
function Start-BackupRetry {
    param(
        [string]$ScriptPath,
        [string]$LogFile,
        [string]$SearchPattern    = "warning|failed|ERROR",
        [int]   $CheckAfterMinutes = 15,
        [int]   $RetryAfterMinutes = 60
    )

    $checkSecs  = $CheckAfterMinutes * 60
    $retrySecs  = ($RetryAfterMinutes - $CheckAfterMinutes) * 60
    $logDir     = Split-Path $LogFile
    $retryLog   = "$logDir\retry-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"
    $tmpScript  = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "backup-retry-$([System.IO.Path]::GetRandomFileName()).ps1")

    $scriptContent = @"
Start-Sleep $checkSecs
function ts { Get-Date -Format 'yyyy-MM-dd HH:mm:ss' }
`$logFile  = '$($LogFile -replace "'","''")'
`$retryLog = '$($retryLog -replace "'","''")'
`$script   = '$($ScriptPath -replace "'","''")'
`$tmp      = '$($tmpScript -replace "'","''")'
if (Select-String -Path `$logFile -Pattern '$SearchPattern' -Quiet -ErrorAction SilentlyContinue) {
    Add-Content `$retryLog "`$(ts) [retry] Patron encontrado en `$logFile. Esperando $retrySecs s mas..."
    Start-Sleep $retrySecs
    Add-Content `$retryLog "`$(ts) [retry] Re-ejecutando: `$script"
    & powershell.exe -NonInteractive -ExecutionPolicy Bypass -File `$script 2>&1 | ForEach-Object { Add-Content `$retryLog `$_ }
    Add-Content `$retryLog "`$(ts) [retry] Fin del re-intento."
} else {
    Add-Content `$retryLog "`$(ts) [retry] Patron no encontrado en log. Sin re-intento."
}
Remove-Item `$tmp -Force -ErrorAction SilentlyContinue
"@

    $scriptContent | Out-File -FilePath $tmpScript -Encoding UTF8 -Force

    Start-Process -FilePath "powershell.exe" `
        -ArgumentList "-NonInteractive -ExecutionPolicy Bypass -File `"$tmpScript`"" `
        -WindowStyle Hidden

    Write-Host "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [retry] Programado: chequeo log en ${CheckAfterMinutes}min, re-run en ${RetryAfterMinutes}min si se detecta advertencia"
}
