# =============================================================
# system-health-server.ps1 — Windows Server: Hardware + Red + RDP
# Schedulear en Task Scheduler cada 5 minutos
# Requiere: config.ps1 en la misma carpeta
# =============================================================

. "$PSScriptRoot\config.ps1"

# ---------- Parámetros ----------
$TargetHost        = "8.8.8.8"
$PingCount         = 5
$RdpSessionWarning = 18   # warning si hay >= N sesiones activas
$RdpEventWindow    = 5    # minutos hacia atrás para buscar desconexiones

# ---------- Log local con retención mensual ----------
$LogDir  = "$PSScriptRoot\logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$LogFile = "$LogDir\system-health-server-$(Get-Date -Format 'yyyy-MM').log"
function Write-Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
    Add-Content -Path $LogFile -Value $line
    Write-Host $line
}
Get-ChildItem "$LogDir\system-health-server-*.log" |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-31) } |
    Remove-Item -Force

$headers = @{
    "Content-Type"    = "application/json"
    "apikey"          = $ANON_KEY
    "Authorization"   = "Bearer $ANON_KEY"
    "X-Ingest-Secret" = $INGEST_SECRET
}

# ---------- 1. HARDWARE (CPU / RAM / Disco C:) ----------
try {
    $cpuUsage   = [math]::Round(
        (Get-Counter '\Processor(_Total)\% Processor Time').CounterSamples.CookedValue, 1)
    $ramAvailMB = (Get-Counter '\Memory\Available MBytes').CounterSamples.CookedValue
    $os         = Get-CimInstance Win32_OperatingSystem
    $ramTotalMB = $os.TotalVisibleMemorySize / 1KB
    $ramUsePct  = [math]::Round((($ramTotalMB - $ramAvailMB) / $ramTotalMB) * 100, 1)
    $ramTotalGB = [math]::Round($ramTotalMB / 1024, 1)

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

# ---------- 2. RED (Gateway + Internet + Latencia / Pérdida) ----------

# Detectar gateway automáticamente
try {
    $GatewayIP = (Get-NetRoute -DestinationPrefix "0.0.0.0/0" |
                  Sort-Object RouteMetric |
                  Select-Object -First 1).NextHop
} catch {
    $GatewayIP = $null
}

$gatewayOk  = if ($GatewayIP) { Test-Connection $GatewayIP   -Count 1 -Quiet } else { $false }
$internetOk = Test-Connection $TargetHost -Count 1 -Quiet

# Latencia e internet con múltiples pings solo si hay conectividad
try {
    $pingResults = Test-Connection -ComputerName $TargetHost -Count $PingCount -ErrorAction Stop
    $avgLatency  = [math]::Round(
        ($pingResults | Measure-Object ResponseTime -Average).Average, 1)
    $packetLoss  = [math]::Round(
        (($PingCount - $pingResults.Count) / $PingCount) * 100, 1)
} catch {
    $avgLatency = 9999; $packetLoss = 100
}

# error = sin internet; warning = gateway ok pero internet lento/perdida; ok = todo bien
$netStatus = if   (-not $gatewayOk)                                        { "error" }
             elseif (-not $internetOk)                                      { "error" }
             elseif ($packetLoss -gt 10 -or $avgLatency -gt 200)           { "warning" }
             elseif ($packetLoss -gt 2  -or $avgLatency -gt 100)           { "warning" }
             else { "ok" }

$netMsg = "GW: $(if ($gatewayOk) {'ok'} else {'❌'}) | Internet: $(if ($internetOk) {'ok'} else {'❌'}) | Ping: ${avgLatency}ms | Loss: ${packetLoss}%"

$netBody = @{
    service_id = $SERVICE_ID
    source     = "network"
    status     = $netStatus
    message    = $netMsg
    payload    = @{
        gateway_ip      = $GatewayIP
        gateway_ok      = $gatewayOk
        internet_ok     = $internetOk
        ping_ms         = $avgLatency
        packet_loss_pct = $packetLoss
    }
} | ConvertTo-Json -Depth 3

try {
    Invoke-RestMethod -Uri $HEARTBEAT_URL -Method POST -Headers $headers -Body $netBody | Out-Null
    Write-Log "✅ network → $netStatus | $netMsg"
} catch {
    Write-Log "❌ network Error: $($_.Exception.Message)"
}

# ---------- 3. RDP (Sesiones / TCP / Desconexiones / Disk Latency) ----------

# Sesiones activas (quser)
try {
    $sessions = (quser 2>$null | Select-Object -Skip 1).Count
} catch {
    $sessions = 0
}

# Conexiones TCP establecidas en puerto 3389
try {
    $rdpConnections = (
        Get-NetTCPConnection -LocalPort 3389 -State Established -ErrorAction SilentlyContinue
    ).Count
} catch {
    $rdpConnections = 0
}

# Desconexiones recientes en Event Log (IDs: 24=disconnect, 25=reconnect, 39=session lost, 40=reconnect failed)
try {
    $since = (Get-Date).AddMinutes(-$RdpEventWindow)
    $events = Get-WinEvent -FilterHashtable @{
        LogName   = 'Microsoft-Windows-TerminalServices-LocalSessionManager/Operational'
        StartTime = $since
    } -ErrorAction SilentlyContinue
    $disconnects = ($events | Where-Object { $_.Id -in 24, 25, 39, 40 }).Count
} catch {
    $disconnects = 0
}

# Latencia de disco C: (segundos por operación)
try {
    $diskLatency = [math]::Round(
        (Get-Counter '\LogicalDisk(C:)\Avg. Disk sec/Transfer').CounterSamples.CookedValue, 3)
} catch {
    $diskLatency = 0
}

$rdpStatus = if   ($sessions -ge $RdpSessionWarning -or $disconnects -gt 3) { "warning" }
             elseif ($rdpConnections -eq 0 -and $sessions -gt 0)             { "warning" }
             else { "ok" }

$diskIOStatus = if   ($diskLatency -gt 0.050) { "error" }
                elseif ($diskLatency -gt 0.030) { "warning" }
                else { "ok" }

# El status general del POST es el peor de los dos
$rdpOverallStatus = if ($diskIOStatus -eq "error" -or $rdpStatus -eq "error") { "error" }
                    elseif ($diskIOStatus -eq "warning" -or $rdpStatus -eq "warning") { "warning" }
                    else { "ok" }

$rdpBody = @{
    service_id = $SERVICE_ID
    source     = "rdp"
    status     = $rdpOverallStatus
    message    = "Sessions: $sessions | TCP 3389: $rdpConnections | Disconnects (${RdpEventWindow}m): $disconnects | DiskIO: ${diskLatency}s"
    payload    = @{
        rdp_sessions        = $sessions
        rdp_tcp_connections = $rdpConnections
        rdp_disconnects     = $disconnects
        disk_latency_sec    = $diskLatency
        disk_io_status      = $diskIOStatus
    }
} | ConvertTo-Json -Depth 3

try {
    Invoke-RestMethod -Uri $HEARTBEAT_URL -Method POST -Headers $headers -Body $rdpBody | Out-Null
    Write-Log "✅ rdp → $rdpOverallStatus | Sessions: $sessions | Disconnects: $disconnects | DiskIO: ${diskLatency}s"
} catch {
    Write-Log "❌ rdp Error: $($_.Exception.Message)"
}
