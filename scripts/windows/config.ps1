# =============================================================
# config.ps1 — Configuración por cliente/servidor
# Copiar este archivo por cada cliente y ajustar los valores
# =============================================================
$SCRIPT_VERSION = "1.2.1"

$INGEST_URL    = "https://aguxbtvwljaonagannuz.supabase.co/functions/v1/ingest-backup"
$HEARTBEAT_URL = "https://aguxbtvwljaonagannuz.supabase.co/functions/v1/ingest-heartbeat"
$ANON_KEY      = "REEMPLAZAR_CON_SUPABASE_ANON_KEY"
$INGEST_SECRET = "REEMPLAZAR_CON_INGEST_SECRET_DEL_SERVICIO"
$SERVICE_ID    = "REEMPLAZAR_CON_UUID_DEL_SERVICIO"

# ---------- smb-check.ps1 ----------
# Carpeta compartida a monitorear (dejar vacío si no se usa smb-check.ps1)
$SMB_SERVICE_ID    = ""   # UUID del servicio en la app (distinto al $SERVICE_ID del server)
$SMB_INGEST_SECRET = ""   # Ingest secret del servicio SMB (Settings del servicio en la app)
$SMB_KUMA_PUSH_URL = ""   # Push monitor de Kuma para el share (distinto al del server)
$SMB_PATH          = ""   # Ruta local de la carpeta compartida, ej: C:\Compartidos\Ventas

# Ventana de búsqueda para veeam-agent-report.ps1
# Diario → 25  |  Semanal → 170  (7 días + 2 hs de margen)
$VEEAM_LOOKBACK_HOURS = 25

# IP privada de Tailscale del servidor de destino (cloud del cliente)
# Si se configura, kopia-report.ps1 verifica conectividad antes de reportar
# Dejar vacío para omitir el chequeo
$TAILSCALE_IP  = ""

# Uptime Kuma — Push Monitors (opcional)
# Pegar la URL base de cada monitor tipo Push. Si está vacío, no se pinga.
# Ejemplo: https://kuma.midominio.com/api/push/AbCdEfGhIj
$KUMA_PUSH_URL        = ""   # fallback genérico (si los específicos están vacíos, se usa este)
$KUMA_PUSH_URL_HEALTH = ""   # system-health.ps1
$KUMA_PUSH_URL_BACKUP = ""   # kopia-report.ps1 / veeam-agent-report.ps1 / kls-report.ps1

# ---------- system-health.ps1 — secciones opcionales ----------
# Poner $false en los checks que el cliente NO usa para que no
# aparezcan como "failed" en telemetría.
$CHECK_RDP       = $true   # $false si el cliente no usa Remote Desktop
$CHECK_SPEEDTEST = $true   # $false si no hay herramienta speedtest instalada
$CHECK_SMART     = $true   # $false en VMs (discos virtuales no reportan SMART real)

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
