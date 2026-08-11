# =============================================================
# kopia-report.ps1 — Reporta snapshots recientes de Kopia
# al Service Catalog via ingest-backup
#
# Correr via Task Scheduler después de que terminen los snapshots.
# Lee los últimos snapshots de todas las fuentes configuradas en Kopia
# y reporta los completados en las últimas 25 horas.
#
# Ejemplo Task Scheduler (diario a las 7am):
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Scripts\kopia-report.ps1"
# =============================================================

. "$PSScriptRoot\config.ps1"
[System.Net.WebRequest]::DefaultWebProxy = New-Object System.Net.WebProxy

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

# ---------- Chequeo Tailscale (opcional) ----------
if ($TAILSCALE_IP) {
    $ping = Test-Connection -ComputerName $TAILSCALE_IP -Count 2 -Quiet -ErrorAction SilentlyContinue
    if (-not $ping) {
        Write-Log "ERROR: Tailscale no responde en $TAILSCALE_IP — no se puede verificar el repo remoto"
        $body = @{
            service_id       = $SERVICE_ID
            job_name         = "Tailscale VPN"
            status           = "failed"
            size_bytes       = 0
            duration_seconds = 0
            backed_up_at     = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
            details          = "Sin conectividad Tailscale a $TAILSCALE_IP"
        } | ConvertTo-Json -Compress
        $headers = @{
            "Content-Type"    = "application/json"
            "apikey"          = $ANON_KEY
            "Authorization"   = "Bearer $ANON_KEY"
            "X-Ingest-Secret" = $INGEST_SECRET
        }
        try { Invoke-RestMethod -Uri $INGEST_URL -Method POST -Headers $headers -Body $body | Out-Null } catch {}
        Invoke-Kuma -Status "down" -Msg "Tailscale $TAILSCALE_IP sin respuesta"
        exit 1
    }
    Write-Log "Tailscale OK — $TAILSCALE_IP responde"
}

# ---------- Buscar kopia.exe ----------
$kopiaExe = $null
$kandidatos = @(
    "$env:LOCALAPPDATA\Programs\KopiaUI\resources\server\kopia.exe",
    "C:\Program Files\KopiaUI\resources\server\kopia.exe",
    "C:\Program Files\Kopia\kopia.exe",
    "kopia.exe"
)
foreach ($k in $kandidatos) {
    if (Test-Path $k -ErrorAction SilentlyContinue) { $kopiaExe = $k; break }
    try { if (Get-Command $k -ErrorAction Stop) { $kopiaExe = $k; break } } catch {}
}
# Búsqueda dinámica en Downloads de todos los usuarios si no se encontró
if (-not $kopiaExe) {
    $found = Get-ChildItem "C:\Users" -Recurse -Filter "kopia.exe" -ErrorAction SilentlyContinue |
             Where-Object { $_.FullName -notlike "*\cache\*" } |
             Select-Object -First 1
    if ($found) { $kopiaExe = $found.FullName }
}
if (-not $kopiaExe) {
    Write-Log "ERROR: no se encontró kopia.exe"
    exit 1
}

# ---------- Leer snapshots de las últimas 25 horas ----------
$since = (Get-Date).AddHours(-25).ToUniversalTime()

try {
    $jsonOutput = & $kopiaExe snapshot list --all --json 2>$null
    $snapshots  = $jsonOutput | ConvertFrom-Json
} catch {
    Write-Log "ERROR: no se pudo obtener lista de snapshots: $_"
    exit 1
}

$recent = $snapshots | Where-Object {
    $end = [datetime]::Parse($_.endTime)
    $end -gt $since
}

if (-not $recent) {
    Write-Log "No hay snapshots en las últimas 25 horas"
    exit 0
}

# ---------- Headers ----------
$headers = @{
    "Content-Type"    = "application/json"
    "apikey"          = $ANON_KEY
    "Authorization"   = "Bearer $ANON_KEY"
    "X-Ingest-Secret" = $INGEST_SECRET
}

# ---------- Reportar uno por source ----------
# Agrupar por path y tomar el más reciente de cada uno
$byPath = $recent | Group-Object { $_.source.path } | ForEach-Object { $_.Group | Sort-Object endTime -Descending | Select-Object -First 1 }

foreach ($snap in $byPath) {
    $path    = $snap.source.path
    $jobName = "Kopia: $path"

    $startDt  = [datetime]::Parse($snap.startTime)
    $endDt    = [datetime]::Parse($snap.endTime)
    $duration = [int]($endDt - $startDt).TotalSeconds

    $sizeBytes = 0
    try { $sizeBytes = [long]($snap.stats.totalSize) } catch {}

    $errorCount = 0
    try { $errorCount = [int]($snap.stats.errorCount) } catch {}

    $status     = if ($errorCount -gt 0) { "failed" } else { "success" }
    $backedUpAt = $endDt.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    $details    = "id=$($snap.id) files=$($snap.stats.fileCount + $snap.stats.cachedFiles) errors=$errorCount"

    Write-Log "Kopia $status - $jobName - ${duration}s - $sizeBytes bytes"

    $body = @{
        service_id       = $SERVICE_ID
        job_name         = $jobName
        status           = $status
        size_bytes       = $sizeBytes
        duration_seconds = $duration
        backed_up_at     = $backedUpAt
        details          = $details
    } | ConvertTo-Json -Compress

    try {
        Invoke-RestMethod -Uri $INGEST_URL -Method POST -Headers $headers -Body $body -ErrorAction Stop | Out-Null
        Write-Log "  Reporte enviado OK"
    } catch {
        Write-Log "  ERROR al enviar: $_"
    }
}
