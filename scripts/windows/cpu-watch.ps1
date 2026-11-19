# =============================================================
# cpu-watch.ps1 — Vigila el CPU en una franja horaria (por defecto 12:30 a 15:30) y, en los
# minutos en que pasa el umbral, anota qué procesos lo están usando y cuántos usuarios.
# Al terminar la franja manda un resumen al Service Catalog (heartbeat "cpu-watch"): sirve para
# saber qué causa los picos y para mostrar antes/después de un cambio (por ejemplo bajar vCPU).
#
# Lo registra setup-scheduled-tasks.ps1 si $CPU_WATCH_ENABLED = $true en config.ps1.
# Opciones (config.ps1):
#   $CPU_WATCH_START     = "12:30"   # comienzo de la franja
#   $CPU_WATCH_END       = "15:30"   # fin de la franja
#   $CPU_WATCH_THRESHOLD = 80        # % de CPU total que cuenta como pico
#   $CPU_WATCH_INTERVAL  = 60        # segundos entre mediciones
# =============================================================

. "$PSScriptRoot\config.ps1"
[System.Net.WebRequest]::DefaultWebProxy = New-Object System.Net.WebProxy

$SCRIPT_VERSION = "1.0.0"

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$OutputEncoding = [System.Text.Encoding]::UTF8

$LogDir = "$PSScriptRoot\logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$LogFile = "$LogDir\cpu-watch-$(Get-Date -Format 'yyyy-MM').log"
function Write-Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
    Add-Content -Path $LogFile -Value $line
    Write-Host $line
}
Get-ChildItem "$LogDir\cpu-watch-*.log" -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-90) } | Remove-Item -Force

function Opt($name, $default) { $v = Get-Variable $name -ValueOnly -ErrorAction SilentlyContinue; if ($null -ne $v -and "$v" -ne '') { $v } else { $default } }
$startStr  = [string](Opt 'CPU_WATCH_START' '12:30')
$endStr    = [string](Opt 'CPU_WATCH_END' '15:30')
$threshold = [int](Opt 'CPU_WATCH_THRESHOLD' 80)
$interval  = [int](Opt 'CPU_WATCH_INTERVAL' 60)

$today   = (Get-Date).Date
$endTime = $today.Add([TimeSpan]::Parse($endStr))
if ((Get-Date) -ge $endTime) { Write-Log "La franja ($startStr a $endStr) ya terminó hoy: nada que hacer"; exit 0 }

$ncpu = [int](Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors
if ($ncpu -lt 1) { $ncpu = 1 }
Write-Log "=== inicio: franja $startStr a $endStr, umbral $threshold%, cada $interval s, $ncpu procesadores lógicos ==="

# Las clases Win32_PerfFormattedData no dependen del idioma de Windows (los contadores "\Processor(*)" sí)
$timeline = New-Object System.Collections.Generic.List[object]
$byProc   = @{}   # nombre -> @{ sum; hits; users (HashSet) }
$peaks    = 0
$maxCpu   = 0

while ((Get-Date) -lt $endTime) {
    $now = Get-Date
    try {
        $total = [int](Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'").PercentProcessorTime
    } catch { Start-Sleep -Seconds $interval; continue }
    $timeline.Add(@{ t = $now.ToString('HH:mm'); cpu = $total })
    if ($total -gt $maxCpu) { $maxCpu = $total }

    if ($total -ge $threshold) {
        $peaks++
        try {
            $procs = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process |
                     Where-Object { $_.Name -notin '_Total', 'Idle' -and $_.PercentProcessorTime -gt 0 } |
                     Sort-Object PercentProcessorTime -Descending | Select-Object -First 8
            foreach ($p in $procs) {
                $name = ($p.Name -replace '#\d+$', '')
                # PercentProcessorTime es relativo a un núcleo: se pasa a % del CPU total del equipo
                $pct  = [math]::Round($p.PercentProcessorTime / $ncpu, 1)
                if (-not $byProc.ContainsKey($name)) { $byProc[$name] = @{ sum = 0.0; hits = 0; users = New-Object System.Collections.Generic.HashSet[string] } }
                $byProc[$name].sum  += $pct
                $byProc[$name].hits += 1
                try {
                    $u = (Get-Process -Id $p.IDProcess -IncludeUserName -ErrorAction Stop).UserName
                    if ($u) { [void]$byProc[$name].users.Add(($u -split '\\')[-1]) }
                } catch {}
            }
        } catch { Write-Log "No se pudieron leer los procesos: $($_.Exception.Message)" }
        Write-Log "Pico: CPU $total%"
    }
    Start-Sleep -Seconds $interval
}

$samples = $timeline.Count
if ($samples -eq 0) { Write-Log "Sin mediciones"; exit 0 }
$avg = [math]::Round((($timeline | ForEach-Object { $_.cpu }) | Measure-Object -Average).Average, 1)

$top = @($byProc.GetEnumerator() | ForEach-Object {
    [pscustomobject]@{
        name        = $_.Key
        avg_pct     = [math]::Round($_.Value.sum / [math]::Max(1, $peaks), 1)  # % promedio del CPU total durante los picos
        seen_in     = $_.Value.hits                                              # en cuántas mediciones de pico apareció
        users_count = $_.Value.users.Count
        users       = @($_.Value.users | Select-Object -First 15)
    }
} | Sort-Object avg_pct -Descending | Select-Object -First 8)

$status = if ($peaks -eq 0) { 'success' } elseif ($peaks -lt 5) { 'success' } else { 'warning' }
$topTxt = ($top | Select-Object -First 3 | ForEach-Object { "$($_.name) $($_.avg_pct)%" }) -join ', '
$message = if ($peaks) { "CPU $startStr a $endStr`: $peaks min por encima de $threshold% (máx $maxCpu%, prom $avg%). Más uso en los picos: $topTxt" }
           else { "CPU $startStr a $endStr`: sin picos por encima de $threshold% (máx $maxCpu%, prom $avg%)" }

$body = @{
    service_id = $SERVICE_ID
    source     = "cpu-watch"
    status     = $status
    message    = $message
    payload    = @{
        window = "$startStr-$endStr"; threshold = $threshold; interval_s = $interval; logical_cpus = $ncpu
        samples = $samples; peak_samples = $peaks; max_cpu = $maxCpu; avg_cpu = $avg
        top_processes = $top
        timeline = @($timeline)
        script_version = $SCRIPT_VERSION
    }
} | ConvertTo-Json -Depth 6

$headers = @{ "Content-Type" = "application/json; charset=utf-8"; "apikey" = $ANON_KEY; "Authorization" = "Bearer $ANON_KEY"; "X-Ingest-Secret" = $INGEST_SECRET }
try {
    Invoke-RestMethod -Uri $HEARTBEAT_URL -Method POST -Headers $headers -Body ([Text.Encoding]::UTF8.GetBytes($body)) | Out-Null
    Write-Log "Resumen enviado: $message"
} catch {
    Write-Log "ERROR al enviar el resumen: $($_.Exception.Message)"
}
Write-Log "=== fin ==="
