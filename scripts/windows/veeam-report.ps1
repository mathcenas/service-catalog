# =============================================================
# veeam-report.ps1 — Reporta jobs de Veeam Backup & Replication
# Requiere: config.ps1 en la misma carpeta
# Configurar como Post-Job script en cada job de Veeam, o
# schedulear en Task Scheduler una vez por día
# =============================================================

$_scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
. "$_scriptDir\config.ps1"
$SCRIPT_VERSION = "1.0.7"
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
[System.Net.WebRequest]::DefaultWebProxy = New-Object System.Net.WebProxy

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$OutputEncoding = [System.Text.Encoding]::UTF8

# ---------- Log local con retención mensual ----------
$LogDir  = "$_scriptDir\logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$LogFile = "$LogDir\veeam-report-$(Get-Date -Format 'yyyy-MM').log"
function Write-Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
    Add-Content -Path $LogFile -Value $line
    Write-Host $line
}
Get-ChildItem "$LogDir\veeam-report-*.log" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-90) } | Remove-Item -Force

# Veeam 12+: módulo PowerShell — forzar TLS12 antes de cargar para evitar SSslOptions error
$veeamModule = Get-Module -ListAvailable -Name Veeam.Backup.PowerShell -ErrorAction SilentlyContinue
if ($veeamModule) {
    try {
        Import-Module Veeam.Backup.PowerShell -ErrorAction Stop
    } catch {
        # Fallback: cargar desde ruta absoluta (BR 12 en Program Files)
        $veeamPsd = "C:\Program Files\Veeam\Backup and Replication\Console\Veeam.Backup.PowerShell.psd1"
        if (Test-Path $veeamPsd) {
            Import-Module $veeamPsd -ErrorAction Stop
        } else {
            throw "No se pudo cargar el módulo de Veeam: $_"
        }
    }
} else {
    Add-PSSnapin VeeamPSSnapIn -ErrorAction SilentlyContinue
}

# Sesión más reciente por job, completadas en las últimas 25 horas
$since    = (Get-Date).AddHours(-25)
$sessions = Get-VBRBackupSession |
    Where-Object { $_.State -eq "Stopped" -and $_.EndTime -gt $since } |
    Sort-Object EndTime -Descending |
    Group-Object JobName |
    ForEach-Object { $_.Group | Select-Object -First 1 }

if (-not $sessions) {
    Write-Log "No completed sessions found in last 25 hours"
    exit
}

$headers = @{
    "Content-Type"    = "application/json"
    "apikey"          = $ANON_KEY
    "Authorization"   = "Bearer $ANON_KEY"
    "X-Ingest-Secret" = $INGEST_SECRET
}

# ---------- Paso 1: registrar cada job individualmente (sin email) ----------
$summaryLines  = @()
$globalStatus  = "success"
$totalBytes    = [long]0
$totalDuration = [int]0
$lastBackupAt  = ""

foreach ($session in $sessions) {
    $status = switch ($session.Result) {
        "Success" { "success" }
        "Warning" { "warning" }
        "Failed"  { "failed" }
        default   { "warning" }
    }
    if ($status -eq "failed") { $globalStatus = "failed" }
    if ($status -eq "warning" -and $globalStatus -eq "success") { $globalStatus = "warning" }

    $skippedFiles = ($session.GetTaskSessions() | ForEach-Object { $_.Progress.SkippedItemsCount } | Measure-Object -Sum).Sum
    $sizeBytes    = if ($session.BackupStats.BackupSize -gt 0) { [long]($session.BackupStats.BackupSize) } else { [long]($session.Progress.ProcessedSize) }
    $durationSecs = [int]($session.EndTime - $session.CreationTime).TotalSeconds
    $jobName      = "Veeam - $($session.JobName)"
    $details      = "result=$($session.Result) skipped_files=$skippedFiles transferredGB=$([math]::Round($session.BackupStats.TransferedSize/1GB,2)) dedupRatio=$($session.BackupStats.DedupRatio)"
    $backedUpAt   = $session.EndTime.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

    $totalBytes    += $sizeBytes
    $totalDuration += $durationSecs
    $lastBackupAt   = $backedUpAt
    $summaryLines  += @{
        job    = $jobName
        result = $session.Result
        status = $status
        size   = [math]::Round($sizeBytes / 1GB, 2)
        dur    = [math]::Round($durationSecs / 60, 1)
    }

    $body = @{
        service_id       = $SERVICE_ID
        job_name         = $jobName
        status           = $status
        size_bytes       = $sizeBytes
        duration_seconds = $durationSecs
        details          = $details
        backed_up_at     = $backedUpAt
        script_version   = $SCRIPT_VERSION
        suppress_email   = $true
    } | ConvertTo-Json

    try {
        Invoke-RestMethod -Uri $INGEST_URL -Method POST -Headers $headers -Body $body | Out-Null
        Write-Log "✅ $jobName → $status | $([math]::Round($sizeBytes/1GB,2)) GB | $([math]::Round($durationSecs/60,1)) min"
        Invoke-Kuma -Status "up" -Msg "veeam $jobName OK"
    } catch {
        Write-Log "❌ $jobName Error: $($_.Exception.Message)"
        Invoke-Kuma -Status "down" -Msg "veeam $jobName error"
    }
}

# ---------- Paso 2: POST de resumen diario (dispara el email) ----------
$sessionCount = @($sessions).Count
$summaryText  = $summaryLines | ConvertTo-Json -Compress

$summaryBody = @{
    service_id       = $SERVICE_ID
    job_name         = "Veeam - Resumen diario ($sessionCount jobs)"
    status           = $globalStatus
    size_bytes       = $totalBytes
    duration_seconds = $totalDuration
    details          = $summaryText
    backed_up_at     = $lastBackupAt
    script_version   = $SCRIPT_VERSION
    suppress_email   = $false
} | ConvertTo-Json

try {
    Invoke-RestMethod -Uri $INGEST_URL -Method POST -Headers $headers -Body $summaryBody | Out-Null
    Write-Log "📧 Resumen diario enviado → $globalStatus | $([math]::Round($totalBytes/1GB,2)) GB total | $([math]::Round($totalDuration/60,1)) min total"
} catch {
    Write-Log "❌ Error enviando resumen diario: $($_.Exception.Message)"
}
