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
$since = (Get-Date).AddHours(-25)

$events = @()
try {
    # Veeam Agent escribe en su propio log "Veeam Agent" (no en Application)
    $events = Get-WinEvent -FilterHashtable @{
        LogName   = 'Veeam Agent'
        StartTime = $since
    } -ErrorAction Stop |
        Where-Object { $_.Message -match 'finish|success|warning|failed|error' } |
        Sort-Object TimeCreated -Descending
} catch {
    Write-Log "No se encontraron eventos de Veeam Agent en los últimos 25 hs"
    Invoke-Kuma -Status "warn" -Msg "Sin eventos de Veeam Agent"
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

    # Determinar resultado desde el mensaje del evento
    $status = "warning"
    if ($msg -match 'successfully|success' -and $msg -notmatch 'warning') {
        $status = "success"
    } elseif ($msg -match 'failed|error') {
        $status = "failed"
    } elseif ($msg -match 'warning|with warnings') {
        $status = "warning"
    }

    # Extraer nombre del job (ej: "Backup job 'MiJob' has been finished")
    $jobName = "Veeam Agent"
    if ($msg -match "job '([^']+)'") { $jobName = "Veeam Agent - $($Matches[1])" }
    elseif ($msg -match 'job "([^"]+)"') { $jobName = "Veeam Agent - $($Matches[1])" }

    # Extraer tamaño si está disponible en el mensaje
    $sizeBytes = 0
    if ($msg -match 'Processed:\s*([\d,\.]+)\s*GB') {
        $sizeBytes = [long]([double]($Matches[1] -replace ',','.') * 1GB)
    } elseif ($msg -match 'Processed:\s*([\d,\.]+)\s*MB') {
        $sizeBytes = [long]([double]($Matches[1] -replace ',','.') * 1MB)
    }

    $backedUpAt = $ev.TimeCreated.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

    # Truncar mensaje de detalles
    $details = ($msg -replace '\r?\n', ' ').Trim()
    if ($details.Length -gt 500) { $details = $details.Substring(0, 497) + '...' }

    $body = @{
        service_id       = $SERVICE_ID
        job_name         = $jobName
        status           = $status
        size_bytes       = $sizeBytes
        duration_seconds = 0
        details          = $details
        backed_up_at     = $backedUpAt
        script_version   = $SCRIPT_VERSION
    } | ConvertTo-Json -Compress

    try {
        Invoke-RestMethod -Uri $INGEST_URL -Method POST -Headers $headers -Body $body -ErrorAction Stop | Out-Null
        Write-Log "$(if ($status -eq 'success') { '✅' } elseif ($status -eq 'warning') { '⚠️' } else { '❌' }) $jobName → $status | $([math]::Round($sizeBytes/1GB,2)) GB"
        $reported++
    } catch {
        Write-Log "❌ $jobName Error al enviar: $($_.Exception.Message)"
    }
}

$kumaStatus = if ($events[0].Message -match 'failed|error') { 'down' } elseif ($events[0].Message -match 'warning') { 'warn' } else { 'up' }
Invoke-Kuma -Status $kumaStatus -Msg "Veeam: $reported sesiones reportadas"

Write-Log "Fin — $reported sesión/es reportadas"
