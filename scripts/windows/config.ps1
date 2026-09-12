# =============================================================
# config.ps1 — Configuración por cliente/servidor
# Copiar este archivo por cada cliente y ajustar los valores
# =============================================================
$SCRIPT_VERSION = "1.0.0"

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

$KUMA_PUSH_URL = ""
# Uptime Kuma — Push Monitor (opcional)
# Pegar la URL base del monitor tipo Push. Si está vacío, no se pinga.
# Ejemplo: https://kuma.midominio.com/api/push/AbCdEfGhIj
$KUMA_PUSH_URL = ""

function Invoke-Kuma {
    param([string]$Status, [string]$Msg)
    if (-not $KUMA_PUSH_URL) { return }
    $base = $KUMA_PUSH_URL -replace '\?.*', ''
    $url  = "${base}?status=${Status}&msg=$([uri]::EscapeDataString($Msg))&ping=0"
    try { Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 10 | Out-Null } catch {}
}
