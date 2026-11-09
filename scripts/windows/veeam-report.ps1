# =============================================================
# veeam-report.ps1 — Reporta jobs de Veeam Backup & Replication
# Requiere: config.ps1 en la misma carpeta
# Configurar como Post-Job script en cada job de Veeam, o
# schedulear en Task Scheduler una vez por día
# =============================================================

# El módulo de Veeam pide una versión concreta de PowerShell: Veeam 12 usa Windows PowerShell 5.1
# (en pwsh falla con "SSslOptions threw an exception") y Veeam 13 exige PowerShell 7.6 o superior.
# Se lee lo que pide el módulo instalado y, si la sesión actual no sirve, se relanza el script.
function Find-VeeamManifest {
    $m = Get-Module -ListAvailable -Name Veeam.Backup.PowerShell -ErrorAction SilentlyContinue |
         Sort-Object Version -Descending | Select-Object -First 1
    if ($m) { return $m.Path }
    foreach ($p in @(
        "$env:ProgramFiles\Veeam\Backup and Replication\Console\Veeam.Backup.PowerShell\Veeam.Backup.PowerShell.psd1",
        "$env:ProgramFiles\Veeam\Backup and Replication\Console\Veeam.Backup.PowerShell.psd1")) {
        if (Test-Path $p) { return $p }
    }
    return $null
}

if (-not $env:SC_VEEAM_RELAUNCHED) {
    $veeamRequired = $null
    $veeamManifest = Find-VeeamManifest
    if ($veeamManifest) {
        try { $veeamRequired = [version](Import-PowerShellDataFile $veeamManifest).PowerShellVersion } catch {}
    }
    $relaunchWith = $null
    if ($veeamRequired -and $PSVersionTable.PSVersion -lt $veeamRequired) {
        $pwsh = (Get-Command pwsh -ErrorAction SilentlyContinue).Source
        if (-not $pwsh) { $pwsh = "$env:ProgramFiles\PowerShell\7\pwsh.exe" }
        $pwshVersion = $null
        if (Test-Path $pwsh) {
            try { $pwshVersion = [version]((& $pwsh -NoProfile -Command '$PSVersionTable.PSVersion.ToString()') -replace '-.*$', '') } catch {}
        }
        if (-not $pwshVersion -or $pwshVersion -lt $veeamRequired) {
            throw "El módulo de Veeam requiere PowerShell $veeamRequired o superior (instalado: $(if ($pwshVersion) { $pwshVersion } else { 'ninguno' })). Actualizar con: winget upgrade Microsoft.PowerShell (o winget install Microsoft.PowerShell)"
        }
        $relaunchWith = $pwsh
    } elseif ($PSVersionTable.PSEdition -eq 'Core' -and (-not $veeamRequired -or $veeamRequired.Major -lt 7)) {
        $relaunchWith = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    }
    if ($relaunchWith) {
        $env:SC_VEEAM_RELAUNCHED = '1'
        & $relaunchWith -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath @args
        exit $LASTEXITCODE
    }
}

$_scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
. "$_scriptDir\config.ps1"
$SCRIPT_VERSION = "1.1.0"
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

$veeamManifest = Find-VeeamManifest
if ($veeamManifest) {
    try { Import-Module $veeamManifest -ErrorAction Stop }
    catch { throw "No se pudo cargar el módulo de Veeam ($veeamManifest): $_" }
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

# Servicio al que se reportan los backups (VEEAM_SERVICE_ID en config.ps1; vacío = $SERVICE_ID)
$BackupServiceId    = if ($VEEAM_SERVICE_ID)    { $VEEAM_SERVICE_ID }    else { $SERVICE_ID }
$BackupIngestSecret = if ($VEEAM_INGEST_SECRET) { $VEEAM_INGEST_SECRET } else { $INGEST_SECRET }

$headers = @{
    "Content-Type"    = "application/json"
    "apikey"          = $ANON_KEY
    "Authorization"   = "Bearer $ANON_KEY"
    "X-Ingest-Secret" = $BackupIngestSecret
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
        service_id       = $BackupServiceId
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
    service_id       = $BackupServiceId
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
