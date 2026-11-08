# =============================================================
# cobian-backfill.ps1 — Carga los últimos N días de logs de
# Cobian Reflector al Service Catalog (ingest-backup).
#
# Uso:
#   pwsh.exe -NonInteractive -ExecutionPolicy Bypass -File "C:\Scripts\cobian-backfill.ps1"
#   pwsh.exe ... -File "C:\Scripts\cobian-backfill.ps1" -Days 60   # últimos 60 días
#   pwsh.exe ... -File "C:\Scripts\cobian-backfill.ps1" -DryRun     # muestra sin enviar
#
# Requiere: config.ps1 en la misma carpeta.
# =============================================================

param(
    [int]   $Days   = 30,
    [switch]$DryRun
)

. "$PSScriptRoot\config.ps1"
[System.Net.WebRequest]::DefaultWebProxy = New-Object System.Net.WebProxy

$SCRIPT_VERSION = "1.2.0"

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$OutputEncoding = [System.Text.Encoding]::UTF8

$COBIAN_LOG_DIR = "C:\Program Files\Cobian Reflector\Logs"
$TASK_FILTER    = ""

$LogDir = "$PSScriptRoot\logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$ScriptLog = "$LogDir\cobian-backfill-$(Get-Date -Format 'yyyy-MM').log"
function Write-Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
    Add-Content -Path $ScriptLog -Value $line
    Write-Host $line
}

$headers = @{
    "Content-Type"    = "application/json"
    "apikey"          = $ANON_KEY
    "Authorization"   = "Bearer $ANON_KEY"
    "X-Ingest-Secret" = $SMB_INGEST_SECRET
}

function Send-BackupReport($status, $jobName, $tasks, $totalBytes, $totalSeconds, $backedUpAt) {
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

    if ($DryRun) {
        Write-Log "  [DRY-RUN] [$status] $jobName — backed_up_at: $backedUpAt"
        return
    }
    try {
        Invoke-RestMethod -Uri $INGEST_URL -Method POST -Headers $headers -Body $body -ErrorAction Stop | Out-Null
        Write-Log "  ✅ Reportado: [$status] $jobName"
    } catch {
        Write-Log "  ❌ ERROR al reportar: $_"
    }
}

function Parse-TaskBlock($block) {
    $taskNameMatch = [regex]::Match($block, 'Backing up the task "([^"]+)"')
    $taskName = if ($taskNameMatch.Success) { $taskNameMatch.Groups[1].Value } else { "Unknown" }

    $startMatch = [regex]::Match($block, '(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) Backing up the task')
    $backedUpAt = if ($startMatch.Success) {
        [datetime]::ParseExact($startMatch.Groups[1].Value, 'yyyy-MM-dd HH:mm:ss', $null).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    } else {
        (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    }

    $statsMatch = [regex]::Match($block, 'Processed files:\s*(\d+).*?Backed up files:\s*(\d+).*?Backup size:\s*([\d\.]+)\s*(MB|GB|KB|TB)')
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

    $errMatch = [regex]::Match($block, 'Number of errors:\s*(\d+).*?Time elapsed:\s*(\d+)\s*hours?,\s*(\d+)\s*minutes?,\s*(\d+)\s*seconds?')
    $errorCount      = if ($errMatch.Success) { [int]$errMatch.Groups[1].Value } else { 0 }
    $durationSeconds = if ($errMatch.Success) {
        [int]$errMatch.Groups[2].Value * 3600 + [int]$errMatch.Groups[3].Value * 60 + [int]$errMatch.Groups[4].Value
    } else { 0 }

    $hasEnded = $block -match '\*\* Backup for the task .+ has ended \*\*'

    $destDrives = [regex]::Matches($block, 'to "([A-Za-z]):\\') |
        ForEach-Object { $_.Groups[1].Value.ToUpper() } |
        Select-Object -Unique

    $failedDrives = [regex]::Matches($block, '"([A-Za-z]):\\[^"]*" couldn''t be created') |
        ForEach-Object { $_.Groups[1].Value.ToUpper() } |
        Select-Object -Unique

    $diskFullDrives = [regex]::Matches($block, '"([A-Za-z]):\\[^"]*" couldn''t be created:[^`n]*(?:Espacio en disco insuficiente|insufficient disk space|not enough space|112)') |
        ForEach-Object { $_.Groups[1].Value.ToUpper() } |
        Select-Object -Unique

    $accessDeniedCount = ([regex]::Matches($block, 'Acceso denegado|Access is denied|\(5\) Acceso') | Measure-Object).Count

    if ($destDrives.Count -eq 0) {
        $diskFull = $block -match 'Espacio en disco insuficiente|insufficient disk space|not enough space|\(112\)'
        $pathFail = $block -match "couldn't be created.*?\(3\)|El sistema no puede encontrar la ruta"
        $status = if (-not $hasEnded) { "failed" }
                  elseif ($diskFull)  { "failed" }
                  elseif ($pathFail -or ($errorCount -gt 0)) { "warning" }
                  else { "success" }
        $sizeMB  = [math]::Round($totalSizeBytes / 1MB, 1)
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

    $results = @()
    foreach ($drive in ($destDrives + $failedDrives | Select-Object -Unique | Sort-Object)) {
        $isFailed   = $failedDrives -contains $drive
        $isDiskFull = $diskFullDrives -contains $drive

        $destStatus = if (-not $hasEnded) { "failed" }
                      elseif ($isDiskFull) { "failed" }
                      elseif ($isFailed)   { "warning" }
                      elseif ($accessDeniedCount -gt 0) { "warning" }
                      else { "success" }

        $okDrives = $destDrives | Where-Object { $diskFullDrives -notcontains $_ }
        $destSize = if ($isDiskFull) { 0 } else { [long]($totalSizeBytes / [math]::Max($okDrives.Count, 1)) }

        $destDetails = if ($isDiskFull)                  { "Disco lleno — backup no completado ($errorCount errores)" }
                       elseif ($isFailed)                { "Destino con errores de escritura" }
                       elseif ($accessDeniedCount -gt 0) { "$backedUpFiles archivos copiados — $accessDeniedCount archivo(s) con acceso denegado" }
                       else                              { "$backedUpFiles archivos copiados" }

        $results += [PSCustomObject]@{
            TaskName        = $taskName
            JobName         = "$taskName → ${drive}:"
            Status          = $destStatus
            SizeBytes       = $destSize
            DurationSeconds = if ($isDiskFull) { 0 } else { $durationSeconds }
            Details         = $destDetails
            BackedUpAt      = $backedUpAt
        }
    }
    return $results
}

# ---------- Main ----------
$mode = if ($DryRun) { "DRY-RUN" } else { "ENVÍO REAL" }
Write-Log "=== cobian-backfill.ps1 — últimos $Days días [$mode] ==="

$totalReported = 0
$totalSkipped  = 0

for ($i = $Days; $i -ge 1; $i--) {
    $date    = (Get-Date).AddDays(-$i)
    $dateStr = $date.ToString('yyyy-MM-dd')
    $logPath = Join-Path $COBIAN_LOG_DIR "Cobian Reflector $dateStr.txt"

    if (-not (Test-Path $logPath)) {
        Write-Log "[$dateStr] Sin log — omitiendo"
        $totalSkipped++
        continue
    }

    $content = Get-Content $logPath -Raw -Encoding UTF8
    if ([string]::IsNullOrWhiteSpace($content)) {
        Write-Log "[$dateStr] Log vacío — omitiendo"
        $totalSkipped++
        continue
    }

    $blocks = [regex]::Matches($content, '(?s)(?=\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} Backing up the task).*?(?=\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} Backing up the task|\z)')

    if ($blocks.Count -eq 0) {
        Write-Log "[$dateStr] Sin bloques de tarea — omitiendo"
        $totalSkipped++
        continue
    }

    Write-Log "[$dateStr] $($blocks.Count) bloque(s) encontrado(s)"

    $seen = @{}
    foreach ($m in $blocks) {
        $parsed = @(Parse-TaskBlock $m.Value)
        foreach ($p in $parsed) { $seen[$p.JobName] = $p }
    }

    $toReport = @($seen.Values | Sort-Object BackedUpAt)
    if ($TASK_FILTER -ne "") {
        $toReport = @($toReport | Where-Object { $_.TaskName -match [regex]::Escape($TASK_FILTER) })
    }

    if ($toReport.Count -eq 0) { continue }

    $taskRows = @($toReport | ForEach-Object {
        [PSCustomObject]@{
            job             = $_.JobName
            status          = $_.Status
            sizeBytes       = $_.SizeBytes
            durationSeconds = $_.DurationSeconds
        }
    })

    $globalStatus = if ($taskRows | Where-Object { $_.status -eq 'failed' }) { 'failed' }
                   elseif ($taskRows | Where-Object { $_.status -eq 'warning' }) { 'warning' }
                   else { 'success' }

    $totalBytes   = ($taskRows | Measure-Object -Property sizeBytes       -Sum).Sum
    $totalSeconds = ($taskRows | Measure-Object -Property durationSeconds -Sum).Sum
    $backedUpAt   = ($toReport | Sort-Object BackedUpAt | Select-Object -Last 1).BackedUpAt
    $jobCount     = $taskRows.Count
    $jobLabel     = "Cobian Reflector — Resumen diario ($jobCount destino$(if ($jobCount -ne 1) {'s'}))"

    Send-BackupReport $globalStatus $jobLabel $taskRows $totalBytes $totalSeconds $backedUpAt
    $totalReported++
}

Write-Log "=== Fin — $totalReported día(s) reportados, $totalSkipped omitidos ==="
