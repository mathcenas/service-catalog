# =============================================================
# veeam-agent-report.ps1 — Reporta jobs de Veeam Agent for Windows
# Para servidores/PCs standalone sin Veeam B&R central
# Requiere: config.ps1 en la misma carpeta
# =============================================================

. "$PSScriptRoot\config.ps1"

Add-PSSnapin VeeamAgentPSSnapIn -ErrorAction SilentlyContinue

$since    = (Get-Date).AddHours(-25)
$sessions = Get-VBRComputerBackupJobSession | Where-Object { $_.State -eq "Stopped" -and $_.EndTime -gt $since } | Sort-Object EndTime -Descending

if (-not $sessions) {
    Write-Host "No completed sessions found in last 25 hours"
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

    $sizeBytes    = [long]($session.Progress.ProcessedUsedSize)
    $durationSecs = [int]($session.EndTime - $session.CreationTime).TotalSeconds
    $jobName      = "Veeam Agent - $($session.JobName)"
    $details      = "result=$($session.Result) processedGB=$([math]::Round($sizeBytes/1GB,2))"

    $body = @{
        service_id       = $SERVICE_ID
        job_name         = $jobName
        status           = $status
        size_bytes       = $sizeBytes
        duration_seconds = $durationSecs
        details          = $details
    } | ConvertTo-Json

    try {
        Invoke-RestMethod -Uri $INGEST_URL -Method POST -Headers $headers -Body $body | Out-Null
        Write-Host "✅ $jobName → $status | $([math]::Round($sizeBytes/1GB,2)) GB | $([math]::Round($durationSecs/60,1)) min"
    } catch {
        Write-Host "❌ $jobName Error: $($_.Exception.Message)"
    }
}
