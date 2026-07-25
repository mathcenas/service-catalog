# =============================================================
# server-snapshot.ps1 — Lee RDS_Backup_Monitor.csv y envía
# filas nuevas al Service Catalog Telemetry
# Schedulear en Task Scheduler cada 1–5 minutos
# Requiere: config.ps1 en la misma carpeta
# =============================================================

. "$PSScriptRoot\config.ps1"

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
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

# ---------- Fuentes ----------
$CsvFile   = "C:\Monitor\RDS_Telemetry.csv"
$StateFile = "C:\Monitor\lastposition.txt"

# ---------- Thresholds ----------
$WarnCpuPct         = 80
$WarnDiskLatencyMs  = 50
$WarnDiskQueue      = 10
$ErrorCpuPct        = 95
$ErrorDiskLatencyMs = 150
$ErrorDiskQueue     = 30

# ---------- Verificar CSV ----------
if (-not (Test-Path $CsvFile)) {
    Write-Log "❌ CSV no encontrado: $CsvFile"
    exit 1
}

# ---------- Leer posición anterior ----------
$lastLine = 0
if (Test-Path $StateFile) {
    $val = Get-Content $StateFile -Raw
    if ($val -match '^\d+$') { $lastLine = [int]$val }
}

# ---------- Leer filas nuevas ----------
$allLines = Get-Content $CsvFile
$totalLines = $allLines.Count

if ($totalLines -le 1) {
    Write-Log "Sin datos en el CSV"
    exit
}

# La línea 0 es el header — filas de datos arrancan en índice 1
$newLines = if ($lastLine -lt 1) {
    # Primera vez: solo la última fila para no enviar todo el historial
    $allLines[$totalLines - 1]
} else {
    # Solo filas nuevas desde la última posición conocida
    $allLines[($lastLine)..($totalLines - 1)]
}

if (-not $newLines) {
    Write-Log "Sin filas nuevas (última posición: $lastLine / total: $totalLines)"
    exit
}

# ---------- Parsear header ----------
$header = $allLines[0] -split ','

$headers = @{
    "Content-Type"    = "application/json"
    "apikey"          = $ANON_KEY
    "Authorization"   = "Bearer $ANON_KEY"
    "X-Ingest-Secret" = $INGEST_SECRET
}

# ---------- Enviar cada fila nueva ----------
$sent = 0
foreach ($rawLine in @($newLines)) {
    if ([string]::IsNullOrWhiteSpace($rawLine)) { continue }

    # Parsear CSV simple (sin campos con comas internas)
    $cols = $rawLine -split ','
    $row  = @{}
    for ($i = 0; $i -lt $header.Count -and $i -lt $cols.Count; $i++) {
        $row[$header[$i].Trim()] = $cols[$i].Trim()
    }

    # Extraer campos — se adaptan a los nombres de columna del CSV
    $cpu_percent           = [double]($row['cpu_percent']           ?? $row['CPU_Percent']           ?? 0)
    $disk_latency_ms       = [double]($row['disk_latency_ms']       ?? $row['Disk_Latency_ms']       ?? 0)
    $disk_queue            = [int]   ($row['disk_queue']            ?? $row['Disk_Queue']            ?? 0)
    $rdp_sessions          = [int]   ($row['rdp_sessions']          ?? $row['RDP_Sessions']          ?? 0)
    $tcp3389               = [int]   ($row['tcp3389_connections']   ?? $row['TCP3389']               ?? 0)
    $smb_sessions          = [int]   ($row['smb_sessions']          ?? $row['SMB_Sessions']          ?? 0)
    $smb_open_files        = [int]   ($row['smb_open_files']        ?? $row['SMB_Open_Files']        ?? 0)
    $rdp_disconnect_events = [int]   ($row['rdp_disconnect_events'] ?? $row['RDP_Disconnect_Events'] ?? 0)
    $top_process           = [string]($row['top_process']           ?? $row['Top_Process']           ?? '')
    $probable_cause        = [string]($row['probable_cause']        ?? $row['Probable_Cause']        ?? 'Normal')
    $timestamp             = [string]($row['timestamp']             ?? $row['Timestamp']             ?? (Get-Date -Format "yyyy-MM-ddTHH:mm:ss"))

    $gateway_raw  = $row['gateway_ping']  ?? $row['Gateway_Ping']  ?? 'True'
    $internet_raw = $row['internet_ping'] ?? $row['Internet_Ping'] ?? 'True'
    $gateway_ping  = $gateway_raw  -notin 'False','0','false','no'
    $internet_ping = $internet_raw -notin 'False','0','false','no'

    # ---------- Status ----------
    $isError = ($cpu_percent -gt $ErrorCpuPct) -or
               ($disk_latency_ms -gt $ErrorDiskLatencyMs) -or
               ($disk_queue -gt $ErrorDiskQueue) -or
               (-not $internet_ping -and -not $gateway_ping)

    $isWarn  = ($cpu_percent -gt $WarnCpuPct) -or
               ($disk_latency_ms -gt $WarnDiskLatencyMs) -or
               ($disk_queue -gt $WarnDiskQueue) -or
               (-not $internet_ping)

    $status = if ($isError) { "error" } elseif ($isWarn) { "warning" } else { "ok" }

    $message = "CPU: $cpu_percent% | Disk: ${disk_latency_ms}ms / Q:$disk_queue | RDP: $rdp_sessions | $probable_cause"

    $payload = @{
        timestamp             = $timestamp
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

    try {
        Invoke-RestMethod -Uri $HEARTBEAT_URL -Method POST -Headers $headers -Body $body | Out-Null
        Write-Log "✅ server-snapshot → $status | $message"
        $sent++
    } catch {
        Write-Log "❌ server-snapshot Error: $($_.Exception.Message)"
    }
}

# ---------- Guardar nueva posición ----------
$totalLines | Set-Content $StateFile
Write-Log "Enviadas $sent filas nuevas (posición actualizada a $totalLines)"
