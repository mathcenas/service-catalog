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

$SCRIPT_VERSION = "1.1.0"

if (-not (Get-Command Invoke-Kuma -ErrorAction SilentlyContinue)) {
    function Invoke-Kuma { param([string]$Status, [string]$Msg) }
}

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$OutputEncoding = [System.Text.Encoding]::UTF8

# ---------- Config ----------
$COBIAN_LOG_DIR = "C:\Program Files\Cobian Reflector\Logs"

# Filtro opcional: si está vacío reporta todas las tasks del día.
# Si se completa (ej: "Compartida"), solo reporta tasks cuyo nombre contenga ese texto.
$TASK_FILTER = ""

# ---------- Log ----------
$LogDir  = "$PSScriptRoot\logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$ScriptLog = "$LogDir\cobian-report-$(Get-Date -Format 'yyyy-MM').log"
function Write-Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
    Add-Content -Path $ScriptLog -Value $line
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
        Write-Log "  ✅ Reportado: [$status] $jobName"
    } catch {
        Write-Log "  ❌ ERROR al reportar: $_"
    }
    Invoke-Kuma -Status $(if ($status -eq 'failed') { 'down' } elseif ($status -eq 'warning') { 'warn' } else { 'up' }) -Msg $jobName
}

function Parse-TaskBlock($block) {
    # Nombre de la task
    $taskNameMatch = [regex]::Match($block, '\*\* Backup for the task "([^"]+)"')
    $taskName = if ($taskNameMatch.Success) { $taskNameMatch.Groups[1].Value } else { "Unknown" }

    # Timestamp de inicio
    $startMatch = [regex]::Match($block, '(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) \*\* Backup for the task')
    $backedUpAt = if ($startMatch.Success) {
        [datetime]::ParseExact($startMatch.Groups[1].Value, 'yyyy-MM-dd HH:mm:ss', $null).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    } else {
        (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    }

    # Stats: "Processed files: X. Backed up files: Y. Backup size: Z MB."
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

    # Errores y duración
    $errMatch = [regex]::Match($block, 'Number of errors:\s*(\d+).*?Time elapsed:\s*(\d+)\s*hours?,\s*(\d+)\s*minutes?,\s*(\d+)\s*seconds?')
    $errorCount      = if ($errMatch.Success) { [int]$errMatch.Groups[1].Value } else { 0 }
    $durationSeconds = if ($errMatch.Success) {
        [int]$errMatch.Groups[2].Value * 3600 + [int]$errMatch.Groups[3].Value * 60 + [int]$errMatch.Groups[4].Value
    } else { 0 }

    # Tipos de error
    $diskFull   = $block -match 'Espacio en disco insuficiente|insufficient disk space|not enough space'
    $pathFail   = $block -match "couldn't be created.*?\(3\)|El sistema no puede encontrar la ruta"
    $hasEnded   = $block -match 'The backup has ended\.'
    $hasErrors  = $block -match 'There are errors'

    # Status: disco lleno > ruta faltante > errores genéricos
    $status = if (-not $hasEnded) {
        "failed"
    } elseif ($diskFull) {
        "failed"
    } elseif ($pathFail -or $hasErrors -or $errorCount -gt 0) {
        "warning"
    } else {
        "success"
    }

    # Detalle
    $sizeMB  = [math]::Round($sizeBytes / 1MB, 1)
    $details = "$backedUpFiles archivos copiados de $processedFiles procesados — ${sizeMB} MB"
    if ($diskFull)         { $details += " — Disco lleno en destino" }
    elseif ($pathFail)     { $details += " — Destino no disponible (unidad desconectada?)" }
    elseif ($errorCount -gt 0) { $details += " — $errorCount errores" }

    return [PSCustomObject]@{
        TaskName        = $taskName
        Status          = $status
        SizeBytes       = $sizeBytes
        DurationSeconds = $durationSeconds
        Details         = $details
        BackedUpAt      = $backedUpAt
    }
}

# ---------- Parsear log de hoy ----------
$today   = Get-Date -Format 'yyyy-MM-dd'
$logPath = Join-Path $COBIAN_LOG_DIR "Cobian Reflector $today.txt"

if (-not (Test-Path $logPath)) {
    Write-Log "No se encontró log de hoy: $logPath"
    Send-BackupReport "failed" "Cobian" 0 0 "Log no encontrado: $logPath" (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    exit 1
}

$content = Get-Content $logPath -Raw -Encoding UTF8

# Separar en bloques por task (cada "** Backup for the task" abre uno)
$blocks = [regex]::Matches($content, '(?s)(?=\*\* Backup for the task).*?(?=\*\* Backup for the task|\z)')

if ($blocks.Count -eq 0) {
    Write-Log "No se encontraron bloques de tarea en el log"
    Send-BackupReport "failed" "Cobian" 0 0 "Sin bloques de tarea en log" (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    exit 1
}

Write-Log "Log de hoy: $logPath — $($blocks.Count) bloque(s) encontrado(s)"

# Parsear y reportar cada bloque
# Si hay múltiples ejecuciones del mismo task en el día, quedarse con la última
$seen = @{}
foreach ($m in $blocks) {
    $parsed = Parse-TaskBlock $m.Value
    $seen[$parsed.TaskName] = $parsed
}

$toReport = $seen.Values | Sort-Object BackedUpAt
if ($TASK_FILTER -ne "") {
    $toReport = $toReport | Where-Object { $_.TaskName -match [regex]::Escape($TASK_FILTER) }
}

if (-not $toReport) {
    Write-Log "Ninguna task coincide con el filtro '$TASK_FILTER'"
    exit 0
}

foreach ($t in $toReport) {
    Write-Log "Task: $($t.TaskName) | $($t.Status) | $($t.Details)"
    Send-BackupReport $t.Status "Cobian — $($t.TaskName)" $t.SizeBytes $t.DurationSeconds $t.Details $t.BackedUpAt
}

Write-Log "Listo — $($toReport.Count) tarea(s) reportada(s)"
