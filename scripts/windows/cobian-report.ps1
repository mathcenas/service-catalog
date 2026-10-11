# =============================================================
# cobian-report.ps1 — Parsea logs de Cobian Reflector y reporta
# al Service Catalog (ingest-backup).
#
# Schedulear en Task Scheduler justo después de que termine Cobian
# (ej: 5 minutos después de la hora programada del backup):
#   pwsh.exe -NonInteractive -ExecutionPolicy Bypass -File "C:\Scripts\cobian-report.ps1"
#
# Requiere: config.ps1 en la misma carpeta con $SMB_SERVICE_ID y
# $SMB_INGEST_SECRET configurados.
# =============================================================

. "$PSScriptRoot\config.ps1"
[System.Net.WebRequest]::DefaultWebProxy = New-Object System.Net.WebProxy

$SCRIPT_VERSION = "1.0.0"

if (-not (Get-Command Invoke-Kuma -ErrorAction SilentlyContinue)) {
    function Invoke-Kuma { param([string]$Status, [string]$Msg) }
}

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$OutputEncoding = [System.Text.Encoding]::UTF8

# ---------- Config ----------
$COBIAN_LOG_DIR = "C:\Program Files\Cobian Reflector\Logs"
$TASK_NAME      = "Compartida"   # texto que aparece en el nombre de la carpeta de destino

# ---------- Log ----------
$LogDir  = "$PSScriptRoot\logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$LogFile = "$LogDir\cobian-report-$(Get-Date -Format 'yyyy-MM').log"
function Write-Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
    Add-Content -Path $LogFile -Value $line
    Write-Host $line
}
Get-ChildItem "$LogDir\cobian-report-*.log" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-90) } | Remove-Item -Force

$headers = @{
    "Content-Type"    = "application/json"
    "apikey"          = $ANON_KEY
    "Authorization"   = "Bearer $ANON_KEY"
    "X-Ingest-Secret" = $SMB_INGEST_SECRET
}

function Send-BackupReport($status, $jobName, $sizeBytes, $durationSeconds, $details, $backedUpAt) {
    $body = @{
        service_id        = $SMB_SERVICE_ID
        job_name          = $jobName
        status            = $status
        size_bytes        = $sizeBytes
        duration_seconds  = $durationSeconds
        details           = $details
        backed_up_at      = $backedUpAt
        script_version    = $SCRIPT_VERSION
    } | ConvertTo-Json -Compress -Depth 5
    try {
        Invoke-RestMethod -Uri $INGEST_URL -Method POST -Headers $headers -Body $body -ErrorAction Stop | Out-Null
        Write-Log "✅ Reportado: $status — $jobName"
    } catch {
        Write-Log "❌ ERROR al reportar: $_"
    }
    Invoke-Kuma -Status $(if ($status -eq 'failed') { 'down' } elseif ($status -eq 'warning') { 'warn' } else { 'up' }) -Msg $jobName
}

# ---------- Parsear log de hoy ----------
$today   = Get-Date -Format 'yyyy-MM-dd'
$logFile = Join-Path $COBIAN_LOG_DIR "Cobian Reflector $today.txt"

if (-not (Test-Path $logFile)) {
    Write-Log "No se encontró log de hoy: $logFile"
    Send-BackupReport "failed" "Cobian — $TASK_NAME" 0 0 "Log no encontrado: $logFile" (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    exit 1
}

$content = Get-Content $logFile -Raw -Encoding UTF8

# Extraer bloques de tarea (puede haber más de una ejecución por día)
$blocks = [regex]::Matches($content, '(?s)\*\* Backup for the task.*?(?=\*\* Backup for the task|\z)')

if ($blocks.Count -eq 0) {
    Write-Log "No se encontraron bloques de tarea en el log"
    Send-BackupReport "failed" "Cobian — $TASK_NAME" 0 0 "Sin bloques de tarea en log" (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    exit 1
}

# Tomar el último bloque del día
$block = $blocks[$blocks.Count - 1].Value

# Extraer timestamp de inicio
$startMatch = [regex]::Match($block, '(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) \*\* Backup for the task')
$backedUpAt = if ($startMatch.Success) {
    [datetime]::ParseExact($startMatch.Groups[1].Value, 'yyyy-MM-dd HH:mm:ss', $null).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
} else {
    (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
}

# Extraer estadísticas: "Processed files: X. Backed up files: Y. Backup size: Z MB."
$statsMatch = [regex]::Match($block, 'Processed files:\s*(\d+).*?Backed up files:\s*(\d+).*?Backup size:\s*([\d\.]+)\s*(MB|GB|KB|TB)')
$processedFiles = if ($statsMatch.Success) { [int]$statsMatch.Groups[1].Value } else { 0 }
$backedUpFiles  = if ($statsMatch.Success) { [int]$statsMatch.Groups[2].Value } else { 0 }
$sizeValue      = if ($statsMatch.Success) { [double]$statsMatch.Groups[3].Value } else { 0 }
$sizeUnit       = if ($statsMatch.Success) { $statsMatch.Groups[4].Value } else { "MB" }
$sizeBytes = switch ($sizeUnit) {
    "KB" { [long]($sizeValue * 1KB) }
    "MB" { [long]($sizeValue * 1MB) }
    "GB" { [long]($sizeValue * 1GB) }
    "TB" { [long]($sizeValue * 1TB) }
    default { 0 }
}

# Extraer errores y duración: "Number of errors: X. Time elapsed: H hours, M minutes, S seconds."
$errMatch = [regex]::Match($block, 'Number of errors:\s*(\d+).*?Time elapsed:\s*(\d+)\s*hours?,\s*(\d+)\s*minutes?,\s*(\d+)\s*seconds?')
$errorCount      = if ($errMatch.Success) { [int]$errMatch.Groups[1].Value } else { 0 }
$durationSeconds = if ($errMatch.Success) {
    [int]$errMatch.Groups[2].Value * 3600 + [int]$errMatch.Groups[3].Value * 60 + [int]$errMatch.Groups[4].Value
} else { 0 }

# Detectar tipo de errores críticos
$diskFull    = $block -match 'Espacio en disco insuficiente|insufficient disk space|not enough space'
$errorLines  = ([regex]::Matches($block, '^ERR ', [System.Text.RegularExpressions.RegexOptions]::Multiline)).Count

# Determinar status
$hasEnded    = $block -match 'The backup has ended\.'
$hasErrors   = $block -match 'There are errors'
$status = if (-not $hasEnded) {
    "failed"
} elseif ($diskFull) {
    "failed"
} elseif ($hasErrors -or $errorCount -gt 0) {
    "warning"
} else {
    "success"
}

# Armar detalle
$sizeMB  = [math]::Round($sizeBytes / 1MB, 1)
$details = "$backedUpFiles archivos copiados de $processedFiles procesados — ${sizeMB} MB"
if ($diskFull) { $details += " — ⚠️ Disco lleno en destino" }
elseif ($errorCount -gt 0) { $details += " — $errorCount errores" }

Write-Log "Resultado: $status | $details | Duración: ${durationSeconds}s"

Send-BackupReport $status "Cobian — $TASK_NAME" $sizeBytes $durationSeconds $details $backedUpAt
