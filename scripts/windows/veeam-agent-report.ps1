# =============================================================
# veeam-agent-report.ps1 — Reporta jobs de Veeam Agent for Windows
# Para servidores/PCs standalone sin Veeam B&R central
# Lee sesiones desde el Event Log de Windows y las envía a Telemetría
# Requiere: config.ps1 en la misma carpeta
# =============================================================

. "$PSScriptRoot\config.ps1"
$SCRIPT_VERSION = "1.0.2"
[System.Net.WebRequest]::DefaultWebProxy = New-Object System.Net.WebProxy

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$OutputEncoding = [System.Text.Encoding]::UTF8

# ---------- Log local y Estado ----------
$LogDir    = "$PSScriptRoot\logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$LogFile   = "$LogDir\veeam-agent-report-$(Get-Date -Format 'yyyy-MM').log"
$StateFile = "$LogDir\last_processed_event.txt"

function Write-Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
    Write-Host $line
}

# Limpieza de logs antiguos (>90 días)
Get-ChildItem "$LogDir\veeam-agent-report-*.log" -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-90) } |
    Remove-Item -Force

# ---------- Leer Estado previo ----------
# Evita enviar duplicados a telemetría manteniendo el registro de la última ejecución
$lastProcessedTime = $null
if (Test-Path $StateFile) {
    $stateContent = Get-Content $StateFile -ErrorAction SilentlyContinue
    if ($stateContent) {
        try { $lastProcessedTime = [DateTime]::Parse($stateContent) } catch {}
    }
}

# Ventana de búsqueda (por defecto 25 hs)
$lookbackHours = if ($VEEAM_LOOKBACK_HOURS) { $VEEAM_LOOKBACK_HOURS } else { 25 }
$since = (Get-Date).AddHours(-$lookbackHours)

# Si el estado guardado es más reciente que el lookback, usamos esa fecha para no repetir
if ($lastProcessedTime -and $lastProcessedTime -gt $since) {
    $since = $lastProcessedTime.AddSeconds(1)
}

# ---------- Leer sesiones del Event Log ----------
$events = @()
try {
    # 1. Intentar en log dedicado 'Veeam Agent'
    $events = Get-WinEvent -FilterHashtable @{
        LogName   = 'Veeam Agent'
        Id        = 190
        StartTime = $since
    } -ErrorAction Stop
} catch {
    # 2. Fallback a log 'Application' con Provider 'Veeam Agent' (común en Win Server)
    try {
        $events = Get-WinEvent -FilterHashtable @{
            LogName      = 'Application'
            ProviderName = 'Veeam Agent'
            Id           = 190
            StartTime    = $since
        } -ErrorAction Stop
    } catch {
        $events = @()
    }
}

# Ordenar cronológicamente (del más antiguo al más reciente)
$events = $events | Sort-Object TimeCreated

if (-not $events -or $events.Count -eq 0) {
    Write-Log "Sin nuevos eventos de Veeam en las últimas $lookbackHours horas."
    if (Get-Command "Invoke-Kuma" -ErrorAction SilentlyContinue) {
        Invoke-Kuma -Status "warn" -Msg "Sin nuevos backups Veeam en $lookbackHours hs"
    }
    exit
}

$headers = @{
    "Content-Type"    = "application/json"
    "apikey"          = $ANON_KEY
    "Authorization"   = "Bearer $ANON_KEY"
    "X-Ingest-Secret" = $INGEST_SECRET
}

$reported = 0
$latestEventTime = $lastProcessedTime

foreach ($ev in $events) {
    $msg = $ev.Message

    # Determinar Status
    $status = "warning"
    if ($msg -match 'finished successfully|finished with Success') { $status = "success" }
    elseif ($msg -match 'finished with Warning') { $status = "warning" }
    elseif ($msg -match 'finished with (Error|Fail)') { $status = "failed" }

    # Extraer Nombre del Job
    $jobName = "Veeam Agent"
    if ($msg -match "'([^']+)'\s+finished") { $jobName = $Matches[1] }

    # Formatear detalles y recortar a 500 caracteres
    $details = ($msg -replace '\r?\n', ' ').Trim()
    if ($details.Length -gt 500) { $details = $details.Substring(0, 497) + '...' }

    $backedUpAt = $ev.TimeCreated.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

    $body = @{
        service_id       = $SERVICE_ID
        job_name         = $jobName
        status           = $status
        size_bytes       = 0
        duration_seconds = 0
        details          = $details
        backed_up_at     = $backedUpAt
        script_version   = $SCRIPT_VERSION
    } | ConvertTo-Json -Compress

    try {
        Invoke-RestMethod -Uri $INGEST_URL -Method POST -Headers $headers -Body $body -ErrorAction Stop | Out-Null
        $icon = if ($status -eq 'success') { '✅' } elseif ($status -eq 'warning') { '⚠️' } else { '❌' }
        Write-Log "$icon $jobName → $status ($backedUpAt)"
        $reported++

        # Actualizar puntero de fecha enviada
        if (-not $latestEventTime -or $ev.TimeCreated -gt $latestEventTime) {
            $latestEventTime = $ev.TimeCreated
        }
    } catch {
        Write-Log "❌ $jobName Error al enviar a telemetría: $($_.Exception.Message)"
    }
}

# Guardar estado para la próxima ejecución
if ($latestEventTime) {
    $latestEventTime.ToString("o") | Out-File -FilePath $StateFile -Encoding UTF8 -Force
}

# Notificación a Uptime Kuma con el estado del último evento
if ($events.Count -gt 0 -and (Get-Command "Invoke-Kuma" -ErrorAction SilentlyContinue)) {
    $lastMsg = $events[-1].Message
    $kumaStatus = if ($lastMsg -match 'finished with (Error|Fail)') { 'down' }
                  elseif ($lastMsg -match 'finished with Warning') { 'warn' }
                  else { 'up' }
    Invoke-Kuma -Status $kumaStatus -Msg "Veeam: $reported evento(s) enviado(s) | últimas $lookbackHours hs"
}

Write-Log "Fin — $reported evento(s) enviado(s) a telemetría."
