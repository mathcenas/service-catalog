# =============================================================
# backup-folder-check.ps1 — Verifica carpetas de respaldo en disco
# Reporta la carpeta más reciente al Service Catalog (ingest-backup),
# igual que veeam-report.ps1, para que aparezca en el historial
# de backups del servicio.
#
# Schedulear en Task Scheduler (ej: diario a las 8am):
#   pwsh.exe -NonInteractive -ExecutionPolicy Bypass -File "C:\Scripts\backup-folder-check.ps1"
#
# Requiere: config.ps1 en la misma carpeta con SERVICE_ID del
# servicio de respaldo (puede ser distinto al de system-health)
# =============================================================

. "$PSScriptRoot\config.ps1"
[System.Net.WebRequest]::DefaultWebProxy = New-Object System.Net.WebProxy

$SCRIPT_VERSION = "1.1.0"

# Invoke-Kuma puede no estar definida en todos los config.ps1
if (-not (Get-Command Invoke-Kuma -ErrorAction SilentlyContinue)) {
    function Invoke-Kuma { param([string]$Status, [string]$Msg) }
}

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$OutputEncoding = [System.Text.Encoding]::UTF8

# ---------- Config específica de este script ----------
$BACKUP_PATH      = "C:\Respaldos"   # carpeta raíz a monitorear
$MAX_AGE_HOURS    = 25               # alerta si la carpeta más nueva supera esto
$MIN_SIZE_MB      = 10               # alerta si la carpeta más nueva pesa menos que esto

# ---------- Log ----------
$LogDir  = "$PSScriptRoot\logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$LogFile = "$LogDir\backup-folder-check-$(Get-Date -Format 'yyyy-MM').log"
function Write-Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
    Add-Content -Path $LogFile -Value $line
    Write-Host $line
}
Get-ChildItem "$LogDir\backup-folder-check-*.log" |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-90) } |
    Remove-Item -Force

$headers = @{
    "Content-Type"    = "application/json"
    "apikey"          = $ANON_KEY
    "Authorization"   = "Bearer $ANON_KEY"
    "X-Ingest-Secret" = $SMB_INGEST_SECRET
}

# Usa INGEST_URL (ingest-backup) con el SERVICE_ID del servicio SMB/NAS
$BACKUP_INGEST_URL = $INGEST_URL

function Send-BackupReport($status, $jobName, $sizeBytes, $details, $backedUpAt) {
    $body = @{
        service_id       = $SMB_SERVICE_ID
        job_name         = $jobName
        status           = $status
        size_bytes       = $sizeBytes
        details          = $details
        backed_up_at     = $backedUpAt
        script_version   = $SCRIPT_VERSION
    } | ConvertTo-Json -Compress -Depth 5
    try {
        Invoke-RestMethod -Uri $BACKUP_INGEST_URL -Method POST -Headers $headers -Body $body -ErrorAction Stop | Out-Null
        Write-Log "✅ Backup reportado: $status — $jobName"
    } catch {
        Write-Log "❌ ERROR al reportar backup: $_"
    }
    Invoke-Kuma -Status $(if ($status -eq 'failed') { 'down' } elseif ($status -eq 'warning') { 'warn' } else { 'up' }) -Msg $jobName
}

# ---------- Validar config ----------
if (-not $SMB_SERVICE_ID -or $SMB_SERVICE_ID -eq "") {
    Write-Log "ERROR: \$SMB_SERVICE_ID no está configurado en config.ps1"
    exit 1
}
if (-not $SMB_INGEST_SECRET -or $SMB_INGEST_SECRET -eq "") {
    Write-Log "ERROR: \$SMB_INGEST_SECRET no está configurado en config.ps1"
    exit 1
}

# ---------- Verificar carpeta raíz ----------
if (-not (Test-Path $BACKUP_PATH)) {
    Write-Log "ERROR: no se encontró $BACKUP_PATH"
    Send-BackupReport "failed" "Backup Carpetas" 0 "Carpeta raíz no encontrada: $BACKUP_PATH" (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    exit 1
}

# ---------- Buscar carpeta más reciente ----------
$folders = Get-ChildItem -Path $BACKUP_PATH -Directory |
    Sort-Object LastWriteTime -Descending

if (-not $folders) {
    Write-Log "ERROR: no hay carpetas en $BACKUP_PATH"
    Send-BackupReport "failed" "Backup Carpetas" 0 "Sin carpetas en $BACKUP_PATH" (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    exit 1
}

$latest      = $folders[0]
$latestDate  = $latest.LastWriteTime
$ageHours    = [math]::Round(((Get-Date) - $latestDate).TotalHours, 1)
$latestName  = $latest.Name

# ---------- Tamaño de la carpeta más reciente ----------
$sizeBytes = 0
try {
    $sizeBytes = [long](
        (Get-ChildItem -Path $latest.FullName -Recurse -File -ErrorAction SilentlyContinue |
         Measure-Object -Property Length -Sum).Sum)
} catch {}
$sizeMB = [math]::Round($sizeBytes / 1MB, 1)

Write-Log "Última carpeta: $latestName | Edad: ${ageHours}h | Tamaño: ${sizeMB} MB | Total carpetas: $($folders.Count)"

# ---------- Evaluación ----------
$status  = "success"
$issues  = @()

if ($ageHours -gt $MAX_AGE_HOURS) {
    $status = "failed"
    $issues += "Sin respaldo nuevo hace ${ageHours}h (máx ${MAX_AGE_HOURS}h)"
}

if ($sizeMB -lt $MIN_SIZE_MB -and $sizeMB -gt 0) {
    if ($status -eq "success") { $status = "warning" }
    $issues += "Carpeta muy pequeña: ${sizeMB} MB (mín ${MIN_SIZE_MB} MB)"
}

$details = if ($issues.Count -gt 0) {
    "$latestName — " + ($issues -join " | ")
} else {
    "$latestName (${ageHours}h, ${sizeMB} MB) — $($folders.Count) carpetas"
}

$backedUpAt = $latestDate.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

Send-BackupReport $status "Backup Carpetas - $BACKUP_PATH" $sizeBytes $details $backedUpAt
