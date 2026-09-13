# =============================================================
# kls-report.ps1 — Reporta resultado de backup KLS al Service Catalog
#
# Leer el log más reciente de KLS en una carpeta y reportar
# estado, duración y tamaño comprimido via ingest-backup.
#
# Correr via Task Scheduler justo después de que termine el job KLS.
# Requiere: config.ps1 en la misma carpeta
#
# Ejemplo Task Scheduler:
#   Programa: powershell.exe
#   Argumentos: -NoProfile -ExecutionPolicy Bypass -File "C:\Scripts\kls-report.ps1"
# =============================================================

. "$PSScriptRoot\config.ps1"
[System.Net.WebRequest]::DefaultWebProxy = New-Object System.Net.WebProxy

$SCRIPT_VERSION = "1.0.1"

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$OutputEncoding = [System.Text.Encoding]::UTF8

# ╔══════════════════════════════════════════════════════════════╗
# ║               CONFIGURAR POR CLIENTE                        ║
# ╚══════════════════════════════════════════════════════════════╝

# Carpeta donde KLS guarda los logs (configurado en KLS → Log → Save Log to → Custom Folder)
$KLS_LOG_DIR = "C:\Temp"

# Nombre del job KLS tal como aparece en el log: "Running backup job: <nombre>"
# Dejar vacío para tomar el log más reciente sin filtrar por nombre.
$KLS_JOB_NAME = ""

# Cuántos minutos hacia atrás buscar el log (evita procesar logs viejos)
$KLS_LOOKBACK_MINUTES = 90

# SERVICE_ID y credenciales vienen de config.ps1.
# Si este backup usa un SERVICE_ID distinto al del servidor, definirlo acá:
# $SERVICE_ID    = "UUID-DEL-SERVICIO-KLS"
# $INGEST_SECRET = "INGEST-SECRET-DEL-SERVICIO-KLS"

# ──────────────────────────────────────────────────────────────

# ---------- Log local ----------
$LogDir  = "$PSScriptRoot\logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$LogFile = "$LogDir\kls-report-$(Get-Date -Format 'yyyy-MM').log"
function Write-Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
    Add-Content -Path $LogFile -Value $line
    Write-Host $line
}
Get-ChildItem "$LogDir\kls-report-*.log" -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-90) } | Remove-Item -Force

# ---------- Buscar log más reciente ----------
$since = (Get-Date).AddMinutes(-$KLS_LOOKBACK_MINUTES)

$logFiles = Get-ChildItem -Path $KLS_LOG_DIR -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -in @('.log', '.txt') -and $_.LastWriteTime -gt $since } |
    Sort-Object LastWriteTime -Descending

if ($KLS_JOB_NAME) {
    $logFiles = $logFiles | Where-Object {
        (Get-Content $_.FullName -TotalCount 5 -ErrorAction SilentlyContinue) -match [regex]::Escape($KLS_JOB_NAME)
    }
}

if (-not $logFiles) {
    Write-Log "No se encontraron logs de KLS en los últimos $KLS_LOOKBACK_MINUTES minutos en $KLS_LOG_DIR"
    exit 0
}

$logFile = $logFiles[0]
Write-Log "Procesando log: $($logFile.Name)"
$content = Get-Content $logFile.FullName -Encoding UTF8 -ErrorAction Stop

# ---------- Parsear resultado ----------
$jobFinished   = $content | Where-Object { $_ -match 'Job finished\.' }
$hasError      = $content | Where-Object { $_ -match '\bError\b|\bFailed\b|\bfailed\b' }

$status = if ($jobFinished -and -not $hasError) { "success" }
          elseif ($jobFinished -and $hasError)   { "warning" }
          else                                    { "failed" }

# Duración: "Time elapsed: 00:01:15"
$duration = 0
$elapsedLine = $content | Where-Object { $_ -match 'Time elapsed:' } | Select-Object -Last 1
if ($elapsedLine -match 'Time elapsed:\s+(\d+):(\d+):(\d+)') {
    $duration = [int]$Matches[1] * 3600 + [int]$Matches[2] * 60 + [int]$Matches[3]
}

# Tamaño comprimido: "Compressed size: 423,75 MB (444,330,213 bytes)"
$sizeBytes = 0
$sizeLine = $content | Where-Object { $_ -match 'Compressed size:' } | Select-Object -Last 1
if ($sizeLine -match '\((\d[\d,\.]+)\s+bytes\)') {
    $sizeBytes = [long]($Matches[1] -replace '[,\.](?=\d{3})', '' -replace ',', '.')
}
# Fallback: tamaño sin comprimir
if ($sizeBytes -eq 0) {
    $sizeLine2 = $content | Where-Object { $_ -match 'Archive Size:' } | Select-Object -Last 1
    if ($sizeLine2 -match '\((\d[\d,\.]+)\s+bytes\)') {
        $sizeBytes = [long]($Matches[1] -replace '[,\.](?=\d{3})', '' -replace ',', '.')
    }
}

# Timestamp de fin: "Completed on: 13/9/2026 19:15:23"
$backedUpAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$completedLine = $content | Where-Object { $_ -match 'Completed on:' } | Select-Object -Last 1
if ($completedLine -match 'Completed on:\s+(.+)') {
    $ic = [System.Globalization.CultureInfo]::InvariantCulture
    $fmts = @("d/M/yyyy H:mm:ss","dd/MM/yyyy HH:mm:ss","M/d/yyyy H:mm:ss","MM/dd/yyyy HH:mm:ss")
    foreach ($fmt in $fmts) {
        try {
            $dt = [datetime]::ParseExact($Matches[1].Trim(), $fmt, $ic)
            $backedUpAt = $dt.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
            break
        } catch {}
    }
}

# Nombre del job
$jobName = $logFile.BaseName
$jobLine = $content | Where-Object { $_ -match 'Running backup job:' } | Select-Object -First 1
if ($jobLine -match 'Running backup job:\s+(.+)') { $jobName = $Matches[1].Trim() }

$details = "log=$($logFile.Name) duration=${duration}s size=${sizeBytes}bytes"
Write-Log "KLS $status - $jobName - ${duration}s - $sizeBytes bytes"

# ---------- Reportar a Supabase ----------
$headers = @{
    "Content-Type"    = "application/json"
    "apikey"          = $ANON_KEY
    "Authorization"   = "Bearer $ANON_KEY"
    "X-Ingest-Secret" = $INGEST_SECRET
}

$body = @{
    service_id       = $SERVICE_ID
    job_name         = $jobName
    status           = $status
    size_bytes       = $sizeBytes
    duration_seconds = $duration
    backed_up_at     = $backedUpAt
    details          = $details
    script_version   = $SCRIPT_VERSION
} | ConvertTo-Json

try {
    Invoke-RestMethod -Uri $INGEST_URL -Method POST -Headers $headers -Body $body -TimeoutSec 30 | Out-Null
    Write-Log "  Reporte enviado OK"
} catch {
    Write-Log "  ERROR enviando reporte: $($_.Exception.Message)"
}

Invoke-Kuma -Status $(if ($status -eq 'failed') { 'down' } else { 'up' }) -Msg "KLS $jobName $status"
