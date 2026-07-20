# =============================================================
# veeam-restore-test-report.ps1 — Reporta el resultado de una
# prueba de restauración de Veeam al Service Catalog
# Ejecutar manualmente después de cada prueba de restore
# Requiere: config.ps1 en la misma carpeta
# =============================================================

. "$PSScriptRoot\config.ps1"

Add-PSSnapin VeeamPSSnapIn -ErrorAction SilentlyContinue

# Buscar la última sesión de restore completada (últimas 48h)
$since = (Get-Date).AddHours(-48)
$session = Get-VBRRestoreSession | Where-Object { $_.EndTime -gt $since } | Sort-Object EndTime -Descending | Select-Object -First 1

if (-not $session) {
    Write-Host "No restore sessions found in last 48 hours."
    exit
}

$result = switch ($session.Result) {
    "Success" { "success" }
    "Failed"  { "failed" }
    default   { "partial" }
}

$testedAt = $session.EndTime.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$details  = "RestoreJob=$($session.Name) Result=$($session.Result) Duration=$([math]::Round(($session.EndTime - $session.CreationTime).TotalMinutes,1))min"

$RESTORE_URL = $INGEST_URL -replace "ingest-backup", "ingest-restore-test"

$headers = @{
    "Content-Type"    = "application/json"
    "apikey"          = $ANON_KEY
    "Authorization"   = "Bearer $ANON_KEY"
    "X-Ingest-Secret" = $INGEST_SECRET
}

$body = @{
    service_id                = $SERVICE_ID
    last_restore_test_at      = $testedAt
    last_restore_test_result  = $result
    details                   = $details
} | ConvertTo-Json

try {
    Invoke-RestMethod -Uri $RESTORE_URL -Method POST -Headers $headers -Body $body | Out-Null
    Write-Host "✅ Restore test reported: $result | $details"
} catch {
    Write-Host "❌ Error reporting restore test: $($_.Exception.Message)"
}
