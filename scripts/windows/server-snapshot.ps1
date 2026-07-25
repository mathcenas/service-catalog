# =============================================================
# server-snapshot.ps1 — Snapshot del estado del servidor Windows
# Diseñado para correr como Post-Job script en Veeam, o cada
# 5 minutos en Task Scheduler
# Requiere: config.ps1 en la misma carpeta
# =============================================================

. "$PSScriptRoot\config.ps1"

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# ---------- Log local con retención mensual ----------
$LogDir  = "$PSScriptRoot\logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$LogFile = "$LogDir\server-snapshot-$(Get-Date -Format 'yyyy-MM').log"
function Write-Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
    Add-Content -Path $LogFile -Value $line
    Write-Host $line
}
Get-ChildItem "$LogDir\server-snapshot-*.log" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-31) } | Remove-Item -Force

# ---------- Thresholds ----------
$WarnCpuPct        = 80
$WarnDiskLatencyMs = 50
$WarnDiskQueue     = 10
$ErrorCpuPct       = 95
$ErrorDiskLatencyMs = 150
$ErrorDiskQueue    = 30

# ---------- Recolección de métricas ----------

# CPU
$cpu_percent = [math]::Round(
    (Get-CimInstance Win32_Processor | Measure-Object LoadPercentage -Average).Average, 1)

# Disco (_Total)
try {
    $diskPerf = Get-CimInstance Win32_PerfFormattedData_PerfDisk_LogicalDisk |
                Where-Object { $_.Name -eq "_Total" }
    $disk_queue      = [int]$diskPerf.CurrentDiskQueueLength
    $disk_latency_ms = [math]::Round($diskPerf.AvgDisksecPerTransfer * 1000, 2)
} catch {
    $disk_queue = 0; $disk_latency_ms = 0
}

# Sesiones RDP
try {
    $rdp_sessions = (quser 2>$null | Select-Object -Skip 1 | Where-Object { $_ -match '\S' }).Count
} catch {
    $rdp_sessions = 0
}

# Conexiones TCP 3389 establecidas
try {
    $tcp3389 = (Get-NetTCPConnection -LocalPort 3389 -State Established -ErrorAction SilentlyContinue).Count
} catch {
    $tcp3389 = 0
}

# Gateway y ping
try {
    $gateway = (Get-NetRoute -DestinationPrefix "0.0.0.0/0" |
                Sort-Object RouteMetric |
                Select-Object -First 1).NextHop
    $gateway_ping = if ($gateway) { Test-Connection $gateway -Count 1 -Quiet } else { $false }
} catch {
    $gateway = $null; $gateway_ping = $false
}

$internet_ping = Test-Connection "8.8.8.8" -Count 1 -Quiet

# SMB
try {
    $smb_sessions   = (Get-SmbSession  -ErrorAction SilentlyContinue).Count
    $smb_open_files = (Get-SmbOpenFile -ErrorAction SilentlyContinue).Count
} catch {
    $smb_sessions = 0; $smb_open_files = 0
}

# Eventos de desconexión RDP (últimos 30 segundos — IDs 24 y 39)
try {
    $rdp_disconnect_events = (
        Get-WinEvent -FilterHashtable @{
            LogName   = 'Microsoft-Windows-TerminalServices-LocalSessionManager/Operational'
            StartTime = (Get-Date).AddSeconds(-30)
        } -ErrorAction SilentlyContinue |
        Where-Object { $_.Id -in 24, 39 }
    ).Count
} catch {
    $rdp_disconnect_events = 0
}

# Proceso más pesado por CPU
try {
    $top_process = (Get-Process | Sort-Object CPU -Descending | Select-Object -First 1).ProcessName
} catch {
    $top_process = "unknown"
}

# ---------- Status y probable_cause ----------
$causes = @()

if ($cpu_percent      -gt $WarnCpuPct)        { $causes += "CPU alta ($cpu_percent%)" }
if ($disk_latency_ms  -gt $WarnDiskLatencyMs)  { $causes += "Latencia disco alta ($disk_latency_ms ms)" }
if ($disk_queue       -gt $WarnDiskQueue)       { $causes += "Cola de disco alta ($disk_queue)" }
if (-not $internet_ping)                        { $causes += "Sin internet" }
if (-not $gateway_ping)                         { $causes += "Sin gateway" }

$probable_cause = if ($causes.Count -gt 0) { $causes -join " | " } else { "Normal" }

$isError = ($cpu_percent -gt $ErrorCpuPct) -or
           ($disk_latency_ms -gt $ErrorDiskLatencyMs) -or
           ($disk_queue -gt $ErrorDiskQueue) -or
           (-not $internet_ping -and -not $gateway_ping)

$isWarn  = ($cpu_percent -gt $WarnCpuPct) -or
           ($disk_latency_ms -gt $WarnDiskLatencyMs) -or
           ($disk_queue -gt $WarnDiskQueue) -or
           (-not $internet_ping)

$status = if ($isError) { "error" } elseif ($isWarn) { "warning" } else { "ok" }

# ---------- Mensaje corto para el log/card ----------
$message = "CPU: $cpu_percent% | Disk: ${disk_latency_ms}ms / Q:$disk_queue | RDP: $rdp_sessions | $probable_cause"

# ---------- Payload ----------
$payload = @{
    timestamp             = (Get-Date -Format "yyyy-MM-ddTHH:mm:ss")
    cpu_percent           = $cpu_percent
    disk_latency_ms       = $disk_latency_ms
    disk_queue            = $disk_queue
    rdp_sessions          = $rdp_sessions
    tcp3389_connections   = $tcp3389
    gateway_ping          = $gateway_ping
    internet_ping         = $internet_ping
    smb_sessions          = $smb_sessions
    smb_open_files        = $smb_open_files
    rdp_disconnect_events = $rdp_disconnect_events
    top_process           = $top_process
    probable_cause        = $probable_cause
}

$body = @{
    service_id = $SERVICE_ID
    source     = "server-snapshot"
    status     = $status
    message    = $message
    payload    = $payload
} | ConvertTo-Json -Depth 3

$headers = @{
    "Content-Type"    = "application/json"
    "apikey"          = $ANON_KEY
    "Authorization"   = "Bearer $ANON_KEY"
    "X-Ingest-Secret" = $INGEST_SECRET
}

try {
    Invoke-RestMethod -Uri $HEARTBEAT_URL -Method POST -Headers $headers -Body $body | Out-Null
    Write-Log "✅ server-snapshot → $status | $message"
} catch {
    Write-Log "❌ server-snapshot Error: $($_.Exception.Message)"
}
