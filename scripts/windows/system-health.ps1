# =============================================================
# system-health.ps1 — Hardware + red + speedtest (opcional)
# Schedulear en Task Scheduler cada 1 hora
# Requiere: config.ps1 en la misma carpeta
# =============================================================

. "$PSScriptRoot\config.ps1"

# ---------- Log local con retención mensual ----------
$LogDir  = "$PSScriptRoot\logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$LogFile = "$LogDir\system-health-$(Get-Date -Format 'yyyy-MM').log"
function Write-Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
    Add-Content -Path $LogFile -Value $line
    Write-Host $line
}
# Borrar logs de más de 31 días
Get-ChildItem "$LogDir\system-health-*.log" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-31) } | Remove-Item -Force

$headers = @{
    "Content-Type"    = "application/json"
    "apikey"          = $ANON_KEY
    "Authorization"   = "Bearer $ANON_KEY"
    "X-Ingest-Secret" = $INGEST_SECRET
}

# ---------- 1. HARDWARE (CPU / RAM / Disco C:) ----------
try {
    $cpuUsage  = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
    $os        = Get-CimInstance Win32_OperatingSystem
    $ramUsePct = [math]::Round((($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) / $os.TotalVisibleMemorySize) * 100, 1)
    $ramTotalGB = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)

    $diskC      = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
    $diskUsePct = [math]::Round((($diskC.Size - $diskC.FreeSpace) / $diskC.Size) * 100, 1)
    $diskFreeGB = [math]::Round($diskC.FreeSpace / 1GB, 1)
} catch {
    $cpuUsage = 0; $ramUsePct = 0; $ramTotalGB = 0; $diskUsePct = 0; $diskFreeGB = 0
}

$hwStatus = if   ($diskUsePct -gt 90 -or $ramUsePct -gt 92 -or $cpuUsage -gt 95) { "error" }
            elseif ($diskUsePct -gt 75 -or $ramUsePct -gt 80 -or $cpuUsage -gt 80) { "warning" }
            else { "ok" }

$hwBody = @{
    service_id = $SERVICE_ID
    source     = "system-health"
    status     = $hwStatus
    message    = "CPU: $cpuUsage% | RAM: $ramUsePct% | Disk C: $diskUsePct%"
    payload    = @{
        cpu_pct      = $cpuUsage
        ram_pct      = $ramUsePct
        ram_total_gb = $ramTotalGB
        disk_pct     = $diskUsePct
        disk_free_gb = $diskFreeGB
    }
} | ConvertTo-Json -Depth 3

try {
    Invoke-RestMethod -Uri $HEARTBEAT_URL -Method POST -Headers $headers -Body $hwBody | Out-Null
    Write-Log "✅ system-health → $hwStatus | CPU: $cpuUsage% | RAM: $ramUsePct% | Disk: $diskUsePct%"
} catch {
    Write-Log "❌ system-health Error: $($_.Exception.Message)"
}

# ---------- 2. RED (ping + packet loss) ----------
$targetHost = "1.1.1.1"
$pingCount  = 5
$pingResult = Test-Connection -ComputerName $targetHost -Count $pingCount -ErrorAction SilentlyContinue

if ($pingResult) {
    $received   = ($pingResult | Where-Object { $_.ResponseTime -ne $null }).Count
    $packetLoss = [math]::Round((($pingCount - $received) / $pingCount) * 100, 1)
    $avgPing    = [math]::Round(($pingResult | Measure-Object -Property ResponseTime -Average).Average, 1)
} else {
    $packetLoss = 100; $avgPing = 0
}

$netStatus = if ($packetLoss -eq 100) { "error" }
             elseif ($packetLoss -gt 15 -or $avgPing -gt 150) { "warning" }
             else { "ok" }

# Speedtest (opcional — requiere speedtest.exe en C:\Scripts\)
$downloadMbps = 0; $uploadMbps = 0
$speedtestPath = "$PSScriptRoot\speedtest.exe"
if (Test-Path $speedtestPath) {
    try {
        $speedData    = & $speedtestPath --format=json --accept-license --accept-gdpr 2>$null | ConvertFrom-Json
        $downloadMbps = [math]::Round($speedData.download.bandwidth / 125000, 1)
        $uploadMbps   = [math]::Round($speedData.upload.bandwidth / 125000, 1)
    } catch {}
}

$netPayload = @{
    ping_ms         = $avgPing
    packet_loss_pct = $packetLoss
}
if ($downloadMbps -gt 0) {
    $netPayload.download_mbps = $downloadMbps
    $netPayload.upload_mbps   = $uploadMbps
}

$netMsg = "Ping: ${avgPing}ms | Loss: ${packetLoss}%"
if ($downloadMbps -gt 0) { $netMsg += " | Down: ${downloadMbps} Mbps | Up: ${uploadMbps} Mbps" }

$netBody = @{
    service_id = $SERVICE_ID
    source     = "speedtest"
    status     = $netStatus
    message    = $netMsg
    payload    = $netPayload
} | ConvertTo-Json -Depth 3

try {
    Invoke-RestMethod -Uri $HEARTBEAT_URL -Method POST -Headers $headers -Body $netBody | Out-Null
    Write-Log "✅ speedtest → $netStatus | $netMsg"
} catch {
    Write-Log "❌ speedtest Error: $($_.Exception.Message)"
}
