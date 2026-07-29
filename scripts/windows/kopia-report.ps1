# =============================================================
# kopia-report.ps1 — Reporta resultado de snapshot de Kopia
# al Service Catalog via ingest-backup
#
# Configurar en Kopia como after-snapshot hook:
#   kopia policy set --after-snapshot-root-action="powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Scripts\kopia-report.ps1" --global
# O desde KopiaUI: Policies → After Snapshot → Run Script
#
# Kopia pasa las siguientes variables de entorno al script:
#   KOPIA_SNAPSHOT_ID, KOPIA_SNAPSHOT_PATH, KOPIA_TASK_STATUS
#   KOPIA_SNAPSHOT_START_TIME, KOPIA_SNAPSHOT_END_TIME
#   KOPIA_CONTENT_COUNT, KOPIA_UPLOADED_BYTES, KOPIA_HASHED_BYTES
# =============================================================

. "$PSScriptRoot\config.ps1"

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$OutputEncoding = [System.Text.Encoding]::UTF8

# ---------- Log local con retención mensual ----------
$LogDir = "$PSScriptRoot\logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$LogFile = "$LogDir\kopia-report-$(Get-Date -Format 'yyyy-MM').log"
function Write-Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
    Add-Content -Path $LogFile -Value $line
    Write-Host $line
}
Get-ChildItem "$LogDir\kopia-report-*.log" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-31) } | Remove-Item -Force

# ---------- Leer variables de entorno de Kopia ----------
$kopiaStatus    = $env:KOPIA_TASK_STATUS        # SUCCESS | FAILED
$snapshotId     = $env:KOPIA_SNAPSHOT_ID
$snapshotPath   = $env:KOPIA_SNAPSHOT_PATH
$startTime      = $env:KOPIA_SNAPSHOT_START_TIME
$endTime        = $env:KOPIA_SNAPSHOT_END_TIME
$uploadedBytes  = $env:KOPIA_UPLOADED_BYTES
$hashedBytes    = $env:KOPIA_HASHED_BYTES
$contentCount   = $env:KOPIA_CONTENT_COUNT

# Fallback si el hook no pasó variables (ejecución manual)
if (-not $kopiaStatus) {
    Write-Log "WARN: KOPIA_TASK_STATUS no encontrado — ejecutando fuera de hook de Kopia"
    $kopiaStatus = "SUCCESS"
}

# ---------- Mapear status ----------
$status = if ($kopiaStatus -eq "SUCCESS") { "success" } else { "failed" }

# ---------- Calcular duración ----------
$durationSeconds = 0
if ($startTime -and $endTime) {
    try {
        $start = [datetime]::Parse($startTime)
        $end   = [datetime]::Parse($endTime)
        $durationSeconds = [int]($end - $start).TotalSeconds
    } catch {}
}

# ---------- Tamaño ----------
$sizeBytes = 0
if ($uploadedBytes) {
    try { $sizeBytes = [long]$uploadedBytes } catch {}
}
# Si no hubo datos nuevos (todo deduplicado), usar hashedBytes como referencia
if ($sizeBytes -eq 0 -and $hashedBytes) {
    try { $sizeBytes = [long]$hashedBytes } catch {}
}

# ---------- Nombre del job ----------
$hostname = $env:COMPUTERNAME
$jobName  = if ($snapshotPath) { "Kopia: $snapshotPath" } else { "Kopia: $hostname" }

# ---------- Detalles ----------
$details = "host=$hostname"
if ($snapshotId)   { $details += " id=$snapshotId" }
if ($contentCount) { $details += " files=$contentCount" }

$backedUpAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

Write-Log "Kopia snapshot - $status - $jobName - ${durationSeconds}s - $sizeBytes bytes"

# ---------- Enviar a ingest-backup ----------
$body = @{
    service_id       = $SERVICE_ID
    job_name         = $jobName
    status           = $status
    size_bytes       = $sizeBytes
    duration_seconds = $durationSeconds
    backed_up_at     = $backedUpAt
    details          = $details
} | ConvertTo-Json -Compress

$headers = @{
    "Content-Type"    = "application/json"
    "apikey"          = $ANON_KEY
    "Authorization"   = "Bearer $ANON_KEY"
    "X-Ingest-Secret" = $INGEST_SECRET
}

try {
    $response = Invoke-RestMethod -Uri $INGEST_URL -Method POST -Headers $headers -Body $body -ErrorAction Stop
    Write-Log "✓ Reporte enviado OK"
} catch {
    Write-Log "✗ Error al enviar reporte: $_"
    exit 1
}
