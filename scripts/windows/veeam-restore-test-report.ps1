# =============================================================
# veeam-restore-test-report.ps1 — Reporta el resultado de una
# prueba de restauración de Veeam al Service Catalog
# Ejecutar manualmente después de cada prueba de restore
# Requiere: config.ps1 en la misma carpeta
# =============================================================

. "$PSScriptRoot\config.ps1"

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$OutputEncoding = [System.Text.Encoding]::UTF8

# ---------- Log local con retención mensual ----------
$LogDir  = "$PSScriptRoot\logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$LogFile = "$LogDir\veeam-restore-test-$(Get-Date -Format 'yyyy-MM').log"
function Write-Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
    Add-Content -Path $LogFile -Value $line
    Write-Host $line
}
Get-ChildItem "$LogDir\veeam-restore-test-*.log" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-31) } | Remove-Item -Force

Add-PSSnapin VeeamPSSnapIn -ErrorAction SilentlyContinue

# Buscar la última sesión de restore completada (últimas 48h)
$since = (Get-Date).AddHours(-48)
$session = Get-VBRRestoreSession | Where-Object { $_.EndTime -gt $since } | Sort-Object EndTime -Descending | Select-Object -First 1

if (-not $session) {
    Write-Log "No restore sessions found in last 48 hours."
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
    Write-Log "✅ Restore test reported: $result | $details"
} catch {
    Write-Log "❌ Error reporting restore test: $($_.Exception.Message)"
}
