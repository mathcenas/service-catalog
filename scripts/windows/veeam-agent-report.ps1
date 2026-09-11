# =============================================================
# veeam-agent-report.ps1 — Reporta jobs de Veeam Agent for Windows
# Para servidores/PCs standalone sin Veeam B&R central
# Lee sesiones desde el Event Log de Windows (fuente: Veeam Agent)
# Requiere: config.ps1 en la misma carpeta
# =============================================================

. "$PSScriptRoot\config.ps1"
$SCRIPT_VERSION = "1.0.1"
[System.Net.WebRequest]::DefaultWebProxy = New-Object System.Net.WebProxy

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$OutputEncoding = [System.Text.Encoding]::UTF8

# ---------- Log local ----------
$LogDir  = "$PSScriptRoot\logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$LogFile = "$LogDir\veeam-agent-report-$(Get-Date -Format 'yyyy-MM').log"
function Write-Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
    Write-Host $line
}
Get-ChildItem "$LogDir\veeam-agent-report-*.log" -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-90) } |
    Remove-Item -Force

# ---------- Leer sesiones del Event Log ----------
# Veeam Agent escribe en el log "Application" con source "Veeam Agent"
# EventId 190 = job finalizado (Success/Warning/Failed)
# Ventana de búsqueda: ajustar en config.ps1 según frecuencia del job
# Diario: 25 hs | Semanal: 170 hs (7 días + 2 hs de margen)
$lookbackHours = if ($VEEAM_LOOKBACK_HOURS) { $VEEAM_LOOKBACK_HOURS } else { 25 }
$since = (Get-Date).AddHours(-$lookbackHours)

$events = @()
try {
    # Veeam Agent escribe en su propio log "Veeam Agent", EventId 190 = job finalizado
    $events = Get-WinEvent -FilterHashtable @{
        LogName   = 'Veeam Agent'
        Id        = 190
        StartTime = $since
    } -ErrorAction Stop | Sort-Object TimeCreated -Descending
} catch {
    Write-Log "No completed sessions found in last $lookbackHours hours"
    Invoke-Kuma -Status "warn" -Msg "Sin backup Veeam en $lookbackHours hs"
    exit
}

if (-not $events -or $events.Count -eq 0) {
    Write-Log "No completed sessions found in last 25 hours"
    Invoke-Kuma -Status "warn" -Msg "Sin backup Veeam en 25 hs"
    exit
}

$headers = @{
    "Content-Type"    = "application/json"
    "apikey"          = $ANON_KEY
    "Authorization"   = "Bearer $ANON_KEY"
    "X-Ingest-Secret" = $INGEST_SECRET
}

$reported = 0

foreach ($ev in $events) {
    $msg = $ev.Message

    # Formato real: "Veeam Agent 'Job NOMBRE' finished with Warning/Success/Failed"
    $status = "warning"
    if ($msg -match 'finished successfully|finished with Success') { $status = "success" }
    elseif ($msg -match 'finished with Warning') { $status = "warning" }
    elseif ($msg -match 'finished with (Error|Fail)') { $status = "failed" }

    # Extraer nombre del job
    $jobName = "Veeam Agent"
    if ($msg -match "'([^']+)'\s+finished") { $jobName = $Matches[1] }

    # Extraer espacio libre si aparece en el mensaje
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
        Write-Log "$icon $jobName → $status"
        $reported++
    } catch {
        Write-Log "❌ $jobName Error al enviar: $($_.Exception.Message)"
    }
}

$lastMsg   = $events[0].Message
$kumaStatus = if ($lastMsg -match 'finished with (Error|Fail)') { 'down' } elseif ($lastMsg -match 'finished with Warning') { 'warn' } else { 'up' }
Invoke-Kuma -Status $kumaStatus -Msg "Veeam: $reported sesión/es | últimas $lookbackHours hs"

Write-Log "Fin — $reported sesión/es reportadas"
