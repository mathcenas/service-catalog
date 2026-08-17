# =============================================================
# backup-folder-check.ps1 — Verifica carpetas de respaldo en disco
# Reporta la carpeta más reciente y alerta si no hay una nueva
# en las últimas 25 horas.
#
# Schedulear en Task Scheduler (ej: diario a las 8am):
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Scripts\backup-folder-check.ps1"
#
# Requiere: config.ps1 en la misma carpeta con SERVICE_ID del
# servicio de respaldo (puede ser distinto al de system-health)
# =============================================================

. "$PSScriptRoot\config.ps1"
[System.Net.WebRequest]::DefaultWebProxy = New-Object System.Net.WebProxy

$SCRIPT_VERSION = "1.0.0"

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
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-31) } |
    Remove-Item -Force

$headers = @{
    "Content-Type"    = "application/json"
    "apikey"          = $ANON_KEY
    "Authorization"   = "Bearer $ANON_KEY"
    "X-Ingest-Secret" = $INGEST_SECRET
}

function Send-Heartbeat($status, $message, $payload) {
    $body = @{
        service_id = $SERVICE_ID
        source     = "backup-folder"
        status     = $status
        message    = $message
        payload    = $payload
    } | ConvertTo-Json -Compress -Depth 5
    try {
        Invoke-RestMethod -Uri $HEARTBEAT_URL -Method POST -Headers $headers -Body $body -ErrorAction Stop | Out-Null
        Write-Log "Heartbeat enviado: $status — $message"
    } catch {
        Write-Log "ERROR al enviar heartbeat: $_"
    }
    Invoke-Kuma -Status $(if ($status -eq 'error') { 'down' } elseif ($status -eq 'warning') { 'warn' } else { 'up' }) -Msg $message
}

# ---------- Verificar carpeta raíz ----------
if (-not (Test-Path $BACKUP_PATH)) {
    Write-Log "ERROR: no se encontró $BACKUP_PATH"
    Send-Heartbeat "error" "Carpeta de respaldos no encontrada: $BACKUP_PATH" @{ path = $BACKUP_PATH }
    exit 1
}

# ---------- Buscar carpeta más reciente ----------
$folders = Get-ChildItem -Path $BACKUP_PATH -Directory |
    Sort-Object LastWriteTime -Descending

if (-not $folders) {
    Write-Log "ERROR: no hay carpetas en $BACKUP_PATH"
    Send-Heartbeat "error" "Sin carpetas de respaldo en $BACKUP_PATH" @{ path = $BACKUP_PATH }
    exit 1
}

$latest      = $folders[0]
$latestDate  = $latest.LastWriteTime
$ageHours    = [math]::Round(((Get-Date) - $latestDate).TotalHours, 1)
$latestName  = $latest.Name

# ---------- Tamaño de la carpeta más reciente ----------
$sizeMB = 0
try {
    $sizeMB = [math]::Round(
        (Get-ChildItem -Path $latest.FullName -Recurse -File -ErrorAction SilentlyContinue |
         Measure-Object -Property Length -Sum).Sum / 1MB, 1)
} catch {}

Write-Log "Última carpeta: $latestName | Edad: ${ageHours}h | Tamaño: ${sizeMB} MB | Total carpetas: $($folders.Count)"

# ---------- Evaluación ----------
$status  = "ok"
$issues  = @()

if ($ageHours -gt $MAX_AGE_HOURS) {
    $status = "error"
    $issues += "Sin respaldo nuevo hace ${ageHours}h (máx ${MAX_AGE_HOURS}h)"
}

if ($sizeMB -lt $MIN_SIZE_MB -and $sizeMB -gt 0) {
    if ($status -eq "ok") { $status = "warning" }
    $issues += "Carpeta muy pequeña: ${sizeMB} MB (mín ${MIN_SIZE_MB} MB)"
}

if ($issues.Count -gt 0) {
    $message = ($issues -join " | ")
} else {
    $message = "Respaldo OK - $latestName (${ageHours}h, ${sizeMB} MB)"
}

$payload = @{
    latest_folder  = $latestName
    latest_date    = $latestDate.ToString("yyyy-MM-ddTHH:mm:ss")
    age_hours      = $ageHours
    size_mb        = $sizeMB
    total_folders  = $folders.Count
    backup_path    = $BACKUP_PATH
    script_version = $SCRIPT_VERSION
}

Send-Heartbeat $status $message $payload
