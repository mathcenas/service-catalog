# =============================================================
# veeam-report.ps1 — Reporta jobs de Veeam Backup & Replication
# Requiere: config.ps1 en la misma carpeta
# Configurar como Post-Job script en cada job de Veeam, o
# schedulear en Task Scheduler una vez por día
# =============================================================

. "$PSScriptRoot\config.ps1"
[System.Net.WebRequest]::DefaultWebProxy = New-Object System.Net.WebProxy

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$OutputEncoding = [System.Text.Encoding]::UTF8

# ---------- Log local con retención mensual ----------
$LogDir  = "$PSScriptRoot\logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$LogFile = "$LogDir\veeam-report-$(Get-Date -Format 'yyyy-MM').log"
function Write-Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
    Add-Content -Path $LogFile -Value $line
    Write-Host $line
}
Get-ChildItem "$LogDir\veeam-report-*.log" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-31) } | Remove-Item -Force

Add-PSSnapin VeeamPSSnapIn -ErrorAction SilentlyContinue

# Todos los jobs completados en las últimas 25 horas
$since    = (Get-Date).AddHours(-25)
$sessions = Get-VBRBackupSession | Where-Object { $_.State -eq "Stopped" -and $_.EndTime -gt $since } | Sort-Object EndTime -Descending

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

foreach ($session in $sessions) {
    $status = switch ($session.Result) {
        "Success" { "success" }
        "Warning" { "warning" }
        "Failed"  { "failed" }
        default   { "warning" }
    }

    $sizeBytes    = if ($session.BackupStats.BackupSize -gt 0) { [long]($session.BackupStats.BackupSize) } else { [long]($session.Progress.ProcessedSize) }
    $durationSecs = [int]($session.EndTime - $session.CreationTime).TotalSeconds
    $jobName      = "Veeam - $($session.JobName)"
    $details      = "result=$($session.Result) transferredGB=$([math]::Round($session.BackupStats.TransferedSize/1GB,2)) dedupRatio=$($session.BackupStats.DedupRatio)"
    $backedUpAt   = $session.EndTime.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

    $body = @{
        service_id       = $SERVICE_ID
        job_name         = $jobName
        status           = $status
        size_bytes       = $sizeBytes
        duration_seconds = $durationSecs
        details          = $details
        backed_up_at     = $backedUpAt
    } | ConvertTo-Json

    try {
        Invoke-RestMethod -Uri $INGEST_URL -Method POST -Headers $headers -Body $body | Out-Null
        Write-Log "✅ $jobName → $status | $([math]::Round($sizeBytes/1GB,2)) GB | $([math]::Round($durationSecs/60,1)) min"
    } catch {
        Write-Log "❌ $jobName Error: $($_.Exception.Message)"
    }
}
