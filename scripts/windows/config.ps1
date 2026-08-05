# =============================================================
# config.ps1 — Configuración por cliente/servidor
# Copiar este archivo por cada cliente y ajustar los valores
# =============================================================

$INGEST_URL    = "https://aguxbtvwljaonagannuz.supabase.co/functions/v1/ingest-backup"
$HEARTBEAT_URL = "https://aguxbtvwljaonagannuz.supabase.co/functions/v1/ingest-heartbeat"
$ANON_KEY      = "REEMPLAZAR_CON_SUPABASE_ANON_KEY"
$INGEST_SECRET = "REEMPLAZAR_CON_INGEST_SECRET_DEL_SERVICIO"
$SERVICE_ID    = "REEMPLAZAR_CON_UUID_DEL_SERVICIO"

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
