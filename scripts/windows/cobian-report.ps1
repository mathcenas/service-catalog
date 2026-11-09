# =============================================================
# cobian-report.ps1 — Parsea logs de Cobian Reflector y reporta
# al Service Catalog (ingest-backup).
#
# Schedulear en Task Scheduler justo después de que termine Cobian
# (ej: 5 minutos después de la hora programada del backup):
#   pwsh.exe -NonInteractive -ExecutionPolicy Bypass -File "C:\Scripts\cobian-report.ps1"
#
# Reporta TODAS las tasks del log del día (ej: Respaldo-DiscoK y
# Respaldo-DiscoV) en un único resumen. Si al correr hay una task
# todavía en curso, espera (cada 5 min, hasta -MaxWaitMinutes) a que
# termine antes de reportar, así se puede schedulear a la misma hora
# que arranca Cobian sin que una copia larga quede como "failed".
#
# Requiere: config.ps1 en la misma carpeta con $SMB_SERVICE_ID y
# $SMB_INGEST_SECRET configurados.
# =============================================================

param(
    [int]$MaxWaitMinutes = 600
)

. "$PSScriptRoot\config.ps1"
[System.Net.WebRequest]::DefaultWebProxy = New-Object System.Net.WebProxy

$SCRIPT_VERSION = "1.3.0"

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

function Send-BackupReport($status, $jobName, $tasks, $totalBytes, $totalSeconds, $backedUpAt) {
    # $tasks = array de PSCustomObject con campos job, status, size (GB), dur (min)
    $detailsJson = $tasks | ForEach-Object {
        @{
            job    = $_.job
            status = $_.status
            size   = [math]::Round($_.sizeBytes / 1GB, 2)
            dur    = [math]::Round($_.durationSeconds / 60, 1)
        }
    } | ConvertTo-Json -Compress -Depth 3 -AsArray

    $body = @{
        service_id       = $SMB_SERVICE_ID
        job_name         = $jobName
        status           = $status
        size_bytes       = $totalBytes
        duration_seconds = $totalSeconds
        details          = $detailsJson
        backed_up_at     = $backedUpAt
        script_version   = $SCRIPT_VERSION
    } | ConvertTo-Json -Compress -Depth 5
    try {
        Invoke-RestMethod -Uri $INGEST_URL -Method POST -Headers $headers -Body $body -ErrorAction Stop | Out-Null
        Write-Log "  ✅ Reportado: [$status] $jobName ($($tasks.Count) tarea(s))"
    } catch {
        Write-Log "  ❌ ERROR al reportar: $_"
    }
    Invoke-Kuma -Status $(if ($status -eq 'failed') { 'down' } elseif ($status -eq 'warning') { 'warn' } else { 'up' }) -Msg $jobName
}

function Parse-TaskBlock($block) {
    # Nombre de la task — aparece al inicio: Backing up the task "Files-task"
    $taskNameMatch = [regex]::Match($block, 'Backing up the task "([^"]+)"')
    $taskName = if ($taskNameMatch.Success) { $taskNameMatch.Groups[1].Value } else { "Unknown" }

    # Timestamp de inicio
    $startMatch = [regex]::Match($block, '(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) Backing up the task')
    $backedUpAt = if ($startMatch.Success) {
        [datetime]::ParseExact($startMatch.Groups[1].Value, 'yyyy-MM-dd HH:mm:ss', $null).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    } else {
        (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    }

    # Stats globales del bloque
    $statsMatch = [regex]::Match($block, 'Processed files:\s*(\d+).*?Backed up files:\s*(\d+).*?Backup size:\s*([\d\.]+)\s*(MB|GB|KB|TB)')
    $processedFiles = if ($statsMatch.Success) { [int]$statsMatch.Groups[1].Value } else { 0 }
    $backedUpFiles  = if ($statsMatch.Success) { [int]$statsMatch.Groups[2].Value } else { 0 }
    $sizeValue      = if ($statsMatch.Success) { [double]$statsMatch.Groups[3].Value } else { 0 }
    $sizeUnit       = if ($statsMatch.Success) { $statsMatch.Groups[4].Value } else { "MB" }
    $totalSizeBytes = switch ($sizeUnit) {
        "KB" { [long]($sizeValue * 1KB) }
        "MB" { [long]($sizeValue * 1MB) }
        "GB" { [long]($sizeValue * 1GB) }
        "TB" { [long]($sizeValue * 1TB) }
        default { 0 }
    }

    # Duración total
    $errMatch = [regex]::Match($block, 'Number of errors:\s*(\d+).*?Time elapsed:\s*(\d+)\s*hours?,\s*(\d+)\s*minutes?,\s*(\d+)\s*seconds?')
    $errorCount      = if ($errMatch.Success) { [int]$errMatch.Groups[1].Value } else { 0 }
    $durationSeconds = if ($errMatch.Success) {
        [int]$errMatch.Groups[2].Value * 3600 + [int]$errMatch.Groups[3].Value * 60 + [int]$errMatch.Groups[4].Value
    } else { 0 }

    $hasEnded = $block -match '\*\* Backup for the task .+ has ended \*\*'

    # ── Parsear por destino ──────────────────────────────────────────────────
    # Cada destino aparece como: Backing up "..." to "X:\ruta\..."
    # Extraemos todas las letras de unidad únicas mencionadas como destino
    $destDrives = [regex]::Matches($block, 'to "([A-Za-z]):\\') |
        ForEach-Object { $_.Groups[1].Value.ToUpper() } |
        Select-Object -Unique

    # Destinos con errores de creación de directorio (disco lleno, ruta no existe, etc.)
    # Formato: "V:\ruta" couldn't be created: (112) mensaje: [V:\ruta]
    $failedDrives = [regex]::Matches($block, '"([A-Za-z]):\\[^"]*" couldn''t be created') |
        ForEach-Object { $_.Groups[1].Value.ToUpper() } |
        Select-Object -Unique

    # Errores de acceso denegado (copia o listado de directorio fuente)
    # Se asocian a los destinos del bloque completo ya que ocurren al leer la fuente
    $accessDeniedCount = ([regex]::Matches($block, 'Acceso denegado|Access is denied|\(5\) Acceso') | Measure-Object).Count

    # Disco lleno por destino — línea: "V:\ruta..." couldn't be created: (112) Espacio en disco insuficiente
    $diskFullDrives = [regex]::Matches($block, '"([A-Za-z]):\\[^"]*" couldn''t be created:[^`n]*(?:Espacio en disco insuficiente|insufficient disk space|not enough space|112)') |
        ForEach-Object { $_.Groups[1].Value.ToUpper() } |
        Select-Object -Unique

    # Si no se detectaron destinos, caer en modo legacy (un solo reporte global)
    if ($destDrives.Count -eq 0) {
        $diskFull = $block -match 'Espacio en disco insuficiente|insufficient disk space|not enough space|\(112\)'
        $pathFail = $block -match "couldn't be created.*?\(3\)|El sistema no puede encontrar la ruta"
        $status = if (-not $hasEnded) { "failed" }
                  elseif ($diskFull)  { "failed" }
                  elseif ($pathFail -or ($errorCount -gt 0)) { "warning" }
                  else { "success" }
        $sizeMB = [math]::Round($totalSizeBytes / 1MB, 1)
        $details = "$backedUpFiles archivos — ${sizeMB} MB"
        if ($errorCount -gt 0) { $details += " — $errorCount errores" }
        return @([PSCustomObject]@{
            TaskName        = $taskName
            JobName         = $taskName
            Status          = $status
            SizeBytes       = $totalSizeBytes
            DurationSeconds = $durationSeconds
            Details         = $details
            BackedUpAt      = $backedUpAt
        })
    }

    # Construir un resultado por destino
    $results = @()
    foreach ($drive in ($destDrives + $failedDrives | Select-Object -Unique | Sort-Object)) {
        $isFailed   = $failedDrives -contains $drive
        $isDiskFull = $diskFullDrives -contains $drive

        $destStatus = if (-not $hasEnded) { "failed" }
                      elseif ($isDiskFull) { "failed" }
                      elseif ($isFailed)   { "warning" }
                      elseif ($accessDeniedCount -gt 0) { "warning" }
                      else { "success" }

        # Tamaño: destinos fallidos (disco lleno) no transfirieron datos
        $destSize = if ($isDiskFull) { 0 } else { [long]($totalSizeBytes / [math]::Max(($destDrives | Where-Object { $diskFullDrives -notcontains $_ }).Count, 1)) }

        $destDetails = if ($isDiskFull)                  { "Disco lleno — backup no completado ($errorCount errores)" }
                       elseif ($isFailed)                { "Destino con errores de escritura" }
                       elseif ($accessDeniedCount -gt 0) { "$backedUpFiles archivos copiados — $accessDeniedCount archivo(s) con acceso denegado" }
                       else                              { "$backedUpFiles archivos copiados" }

        $results += [PSCustomObject]@{
            TaskName        = $taskName
            JobName         = "$taskName → ${drive}:"
            Status          = $destStatus
            SizeBytes       = $destSize
            DurationSeconds = if ($isFailed) { 0 } else { $durationSeconds }
            Details         = $destDetails
            BackedUpAt      = $backedUpAt
        }
    }

    return $results
}

# ---------- Parsear log de hoy ----------
$today   = Get-Date -Format 'yyyy-MM-dd'
$logPath = Join-Path $COBIAN_LOG_DIR "Cobian Reflector $today.txt"

if (-not (Test-Path $logPath)) {
    Write-Log "No se encontró log de hoy: $logPath"
    $fallbackTask = @([PSCustomObject]@{ job = "Cobian Reflector"; status = "failed"; sizeBytes = 0; durationSeconds = 0 })
    Send-BackupReport "failed" "Cobian Reflector — Resumen diario (1 job)" $fallbackTask 0 0 (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    exit 1
}

$content = Get-Content $logPath -Raw -Encoding UTF8

# Si la última task del log todavía no terminó, esperar. Durante una copia larga
# Cobian no escribe nada en el log por horas, así que no se puede usar la fecha
# de modificación del archivo para decidir: se espera hasta MaxWaitMinutes.
$waited = 0
while (-not [string]::IsNullOrWhiteSpace($content)) {
    $lastStart = [regex]::Matches($content, 'Backing up the task "([^"]+)"') | Select-Object -Last 1
    if (-not $lastStart) { break }
    $tail = $content.Substring($lastStart.Index)
    if ($tail -match '\*\* Backup for the task .+ has ended \*\*') { break }
    if ($waited -ge $MaxWaitMinutes) {
        Write-Log "La task '$($lastStart.Groups[1].Value)' sigue sin terminar después de $waited min — se reporta como fallida"
        break
    }
    Write-Log "Task '$($lastStart.Groups[1].Value)' en curso — esperando 5 min ($waited/$MaxWaitMinutes)"
    Start-Sleep -Seconds 300
    $waited += 5
    $content = Get-Content $logPath -Raw -Encoding UTF8
}

if ([string]::IsNullOrWhiteSpace($content)) {
    Write-Log "Log de hoy existe pero está vacío: $logPath — backup aún no ejecutado"
    exit 0
}

# Separar en bloques por task (cada "Backing up the task" abre uno)
# El cierre es la línea "** Backup for the task ... has ended **" + las dos líneas de stats
$blocks = [regex]::Matches($content, '(?s)(?=\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} Backing up the task).*?(?=\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} Backing up the task|\z)')

if ($blocks.Count -eq 0) {
    Write-Log "No se encontraron bloques de tarea en el log"
    $fallbackTask = @([PSCustomObject]@{ job = "Cobian Reflector"; status = "failed"; sizeBytes = 0; durationSeconds = 0 })
    Send-BackupReport "failed" "Cobian Reflector — Resumen diario (1 job)" $fallbackTask 0 0 (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    exit 1
}

Write-Log "Log de hoy: $logPath — $($blocks.Count) bloque(s) encontrado(s)"

# Parsear bloques — múltiples ejecuciones del mismo job_name: quedarse con la última
$seen = @{}
foreach ($m in $blocks) {
    $parsed = @(Parse-TaskBlock $m.Value)
    foreach ($p in $parsed) {
        $seen[$p.JobName] = $p
    }
}

$toReport = @($seen.Values | Sort-Object BackedUpAt)
if ($TASK_FILTER -ne "") {
    $toReport = @($toReport | Where-Object { $_.TaskName -match [regex]::Escape($TASK_FILTER) })
}

if ($toReport.Count -eq 0) {
    Write-Log "Ninguna task coincide con el filtro '$TASK_FILTER'"
    exit 0
}

foreach ($t in $toReport) {
    Write-Log "Job: $($t.JobName) | $($t.Status) | $($t.Details)"
}

# Armar array de rows para el JSON (tabla en el email/portal)
$taskRows = @($toReport | ForEach-Object {
    [PSCustomObject]@{
        job             = $_.JobName
        status          = $_.Status
        sizeBytes       = $_.SizeBytes
        durationSeconds = $_.DurationSeconds
    }
})

# Status global: failed si alguno falló, warning si alguno tuvo warning, success si todos OK
$globalStatus = if ($taskRows | Where-Object { $_.status -eq 'failed' }) { 'failed' }
               elseif ($taskRows | Where-Object { $_.status -eq 'warning' }) { 'warning' }
               else { 'success' }

$totalBytes   = ($taskRows | Measure-Object -Property sizeBytes -Sum).Sum
$totalSeconds = ($taskRows | Measure-Object -Property durationSeconds -Sum).Sum
$backedUpAt   = ($toReport | Sort-Object BackedUpAt | Select-Object -Last 1).BackedUpAt
$jobCount     = $taskRows.Count
$jobLabel     = "Cobian Reflector — Resumen diario ($jobCount destino$(if ($jobCount -ne 1) {'s'}))"

Send-BackupReport $globalStatus $jobLabel $taskRows $totalBytes $totalSeconds $backedUpAt

Write-Log "Listo — $jobCount destino(s) reportados [$globalStatus]"
