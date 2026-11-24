# =============================================================
# kopia-report.ps1 — Reporta snapshots recientes de Kopia
# al Service Catalog via ingest-backup
#
# Correr via Task Scheduler después de que terminen los snapshots.
# Lee el último snapshot de cada fuente configurada en Kopia (de los últimos 40 días)
# y lo reporta junto con cada cuánto corre esa fuente según su política de Kopia,
# para que un job semanal no aparezca vencido en un servicio diario. Volver a mandar
# el mismo snapshot no duplica nada (el portal lo reconoce por fecha).
#
# Ejemplo Task Scheduler (diario a las 7am):
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Scripts\kopia-report.ps1"
# =============================================================

. "$PSScriptRoot\config.ps1"
[System.Net.WebRequest]::DefaultWebProxy = New-Object System.Net.WebProxy

$SCRIPT_VERSION = "1.4.0"

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$OutputEncoding = [System.Text.Encoding]::UTF8

# Parse-KopiaDate: parsea fechas de Kopia independiente del locale del sistema.
# Kopia devuelve MM/dd/yyyy HH:mm:ss o yyyy-MM-ddTHH:mm:ssZ según versión.
function Parse-KopiaDate([string]$s) {
    if (-not $s) { return $null }
    $ic   = [System.Globalization.CultureInfo]::InvariantCulture
    $fmts = @(
        "MM/dd/yyyy HH:mm:ss",
        "yyyy-MM-ddTHH:mm:ssZ",
        "yyyy-MM-ddTHH:mm:ss",
        "yyyy-MM-dd HH:mm:ss"
    )
    foreach ($fmt in $fmts) {
        try { return [datetime]::ParseExact($s, $fmt, $ic) } catch {}
    }
    try { return [datetime]::Parse($s, $ic) } catch {}
    return $null
}

# ---------- Log local con retención mensual ----------
$LogDir = "$PSScriptRoot\logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$LogFile = "$LogDir\kopia-report-$(Get-Date -Format 'yyyy-MM').log"
function Write-Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
    Add-Content -Path $LogFile -Value $line
    Write-Host $line
}
Get-ChildItem "$LogDir\kopia-report-*.log" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-90) } | Remove-Item -Force

# ---------- Chequeo Tailscale (opcional) ----------
# Se reporta como heartbeat "tailscale" (ok o caído, con latencia), no como un backup:
# antes un corte de la VPN aparecía como "backup fallido" y abría tickets de backup.
if ($TAILSCALE_IP) {
    $pings = @(Test-Connection -ComputerName $TAILSCALE_IP -Count 3 -ErrorAction SilentlyContinue)
    $tsOk  = $pings.Count -gt 0
    $rtt   = if ($tsOk) { [math]::Round(($pings | ForEach-Object { if ($_.PSObject.Properties['Latency']) { $_.Latency } else { $_.ResponseTime } } | Measure-Object -Average).Average, 0) } else { $null }
    $hbBody = @{
        service_id = $SERVICE_ID
        source     = "tailscale"
        status     = if ($tsOk) { "success" } else { "failed" }
        message    = if ($tsOk) { "Tailscale OK hacia $TAILSCALE_IP ($rtt ms)" } else { "Sin conectividad Tailscale a $TAILSCALE_IP" }
        payload    = @{ target_ip = $TAILSCALE_IP; reachable = $tsOk; rtt_ms = $rtt; purpose = "kopia"; script_version = $SCRIPT_VERSION }
    } | ConvertTo-Json -Depth 3
    $hbHeaders = @{ "Content-Type" = "application/json; charset=utf-8"; "apikey" = $ANON_KEY; "Authorization" = "Bearer $ANON_KEY"; "X-Ingest-Secret" = $INGEST_SECRET }
    try { Invoke-RestMethod -Uri $HEARTBEAT_URL -Method POST -Headers $hbHeaders -Body ([Text.Encoding]::UTF8.GetBytes($hbBody)) | Out-Null } catch { Write-Log "No se pudo reportar el estado de Tailscale: $($_.Exception.Message)" }
    if (-not $tsOk) {
        Write-Log "ERROR: Tailscale no responde en $TAILSCALE_IP — no se puede verificar el repo remoto"
        Invoke-KumaBackup -Status "down" -Msg "Tailscale $TAILSCALE_IP sin respuesta"
        exit 1
    }
    Write-Log "Tailscale OK — $TAILSCALE_IP responde ($rtt ms)"
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
# KopiaUI se instala en la carpeta del usuario: si la tarea corre con otro usuario (o SYSTEM),
# $env:LOCALAPPDATA no es el del que instaló KopiaUI. Buscar en todos los perfiles.
if (-not $kopiaExe) {
    $kopiaExe = Get-ChildItem "C:\Users\*\AppData\Local\Programs\KopiaUI\resources\server\kopia.exe" -ErrorAction SilentlyContinue |
                Select-Object -First 1 -ExpandProperty FullName
}
# $KOPIA_EXE (config.ps1) gana sobre la búsqueda
if ((Get-Variable 'KOPIA_EXE' -ErrorAction SilentlyContinue) -and $KOPIA_EXE -and (Test-Path $KOPIA_EXE)) { $kopiaExe = $KOPIA_EXE }
# Búsqueda dinámica en Downloads de todos los usuarios si no se encontró
if (-not $kopiaExe) {
    $found = Get-ChildItem "C:\Users" -Recurse -Filter "kopia.exe" -ErrorAction SilentlyContinue |
             Where-Object { $_.FullName -notlike "*\cache\*" } |
             Select-Object -First 1
    if ($found) { $kopiaExe = $found.FullName }
}
if (-not $kopiaExe) {
    Write-Log "ERROR: no se encontró kopia.exe (usuario $env:USERNAME). Definí `$KOPIA_EXE en config.ps1 o corré la tarea con el usuario de KopiaUI"
    exit 1
}

# Conexión al repositorio: la de KopiaUI está en %APPDATA%\kopia\repository.config del usuario que lo usa.
# Si la tarea corre con otro usuario, usar la de ese perfil ($KOPIA_CONFIG en config.ps1, o la que se encuentre).
$kopiaCfgArgs = @()
$cfgPath = if ((Get-Variable 'KOPIA_CONFIG' -ErrorAction SilentlyContinue) -and $KOPIA_CONFIG) { $KOPIA_CONFIG }
           elseif (Test-Path "$env:APPDATA\kopia\repository.config") { $null }
           else { Get-ChildItem "C:\Users\*\AppData\Roaming\kopia\repository.config" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName }
if ($cfgPath) { $kopiaCfgArgs = @("--config-file=$cfgPath"); Write-Log "Usando la conexión de Kopia de $cfgPath" }

# ---------- Mantenimiento del repositorio ----------
# Kopia limpia los datos de snapshots vencidos en el mantenimiento (rápido cada hora, completo cada
# día) y solo lo corre desde el equipo "dueño". Si el dueño es un equipo que ya no existe o no llega
# al repositorio, el repo crece sin que nadie se entere: se reporta como heartbeat "kopia-maintenance".
# $KOPIA_MAINTENANCE_MAX_DAYS (config.ps1): días sin mantenimiento completo para avisar (3 por defecto).
$CHECK_KOPIA_MAINTENANCE = if (Get-Variable 'CHECK_KOPIA_MAINTENANCE' -ErrorAction SilentlyContinue) { $CHECK_KOPIA_MAINTENANCE } else { $true }
$KOPIA_MAINTENANCE_MAX_DAYS = if (Get-Variable 'KOPIA_MAINTENANCE_MAX_DAYS' -ErrorAction SilentlyContinue) { [int]$KOPIA_MAINTENANCE_MAX_DAYS } else { 3 }
if ($CHECK_KOPIA_MAINTENANCE) {
    try {
        $mi = (& $kopiaExe maintenance info --json @kopiaCfgArgs 2>$null | Out-String) | ConvertFrom-Json -ErrorAction Stop
        # Formato de "kopia maintenance info --json": owner y schedule.runs en la raíz;
        # cada tarea es una lista (la más nueva primero) de { start, end, success, error?, extra[] }
        $owner = if ($mi.owner) { [string]$mi.owner } else { [string]$mi.params.owner }
        $runs  = $mi.schedule.runs
        $lastOf = {
            param($task)
            $list = @($runs.$task)
            if (-not $list.Count) { return $null }
            $list | Sort-Object { Parse-KopiaDate $_.end } -Descending | Select-Object -First 1
        }
        $gc    = & $lastOf 'snapshot-gc'
        $quick = & $lastOf 'compact-single-epoch'
        $gcEnd    = if ($gc)    { Parse-KopiaDate $gc.end }    else { $null }
        $quickEnd = if ($quick) { Parse-KopiaDate $quick.end } else { $null }
        # Tareas cuya última corrida falló
        $failedTasks = @()
        foreach ($t in $runs.PSObject.Properties) {
            $last = @($t.Value) | Sort-Object { Parse-KopiaDate $_.end } -Descending | Select-Object -First 1
            if ($last -and $last.success -eq $false) { $failedTasks += "$($t.Name): $([string]$last.error)" }
        }
        $gcDays = if ($gcEnd) { [math]::Round(((Get-Date).ToUniversalTime() - $gcEnd.ToUniversalTime()).TotalDays, 1) } else { $null }
        $mStatus = 'success'; $problems = @()
        if ($null -eq $gcDays)                        { $mStatus = 'warning'; $problems += "nunca corrió el mantenimiento completo" }
        elseif ($gcDays -gt $KOPIA_MAINTENANCE_MAX_DAYS) { $mStatus = 'failed'; $problems += "sin mantenimiento completo hace $gcDays días" }
        if ($failedTasks.Count)                       { $mStatus = 'failed'; $problems += $failedTasks }
        # El último GC dice cuánto ocupa el repositorio (snapshotGCStats.inUseContentSize) y cuánto liberó
        $inUseBytes = $null; $freedBytes = $null
        $gcStats = @($gc.extra) | Where-Object { $_.kind -eq 'snapshotGCStats' } | Select-Object -First 1
        if ($gcStats -and $gcStats.data) {
            $inUseBytes = [int64]$gcStats.data.inUseContentSize
            $freedBytes = [int64]$gcStats.data.deletedContentSize
        }
        $mBody = @{
            service_id = $SERVICE_ID
            source     = "kopia-maintenance"
            status     = $mStatus
            message    = if ($problems) { "Mantenimiento de Kopia: " + ($problems -join ' · ') } else { "Mantenimiento de Kopia OK (completo hace $gcDays días, dueño $owner)" }
            payload    = @{
                owner = $owner; owner_is_me = ($owner -ieq "$env:USERNAME@$env:COMPUTERNAME")
                last_full = if ($gcEnd) { $gcEnd.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ") } else { $null }
                last_quick = if ($quickEnd) { $quickEnd.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ") } else { $null }
                full_days_ago = $gcDays; failed_tasks = $failedTasks; in_use_bytes = $inUseBytes; freed_bytes = $freedBytes
                script_version = $SCRIPT_VERSION
            }
        } | ConvertTo-Json -Depth 4
        $mHeaders = @{ "Content-Type" = "application/json; charset=utf-8"; "apikey" = $ANON_KEY; "Authorization" = "Bearer $ANON_KEY"; "X-Ingest-Secret" = $INGEST_SECRET }
        Invoke-RestMethod -Uri $HEARTBEAT_URL -Method POST -Headers $mHeaders -Body ([Text.Encoding]::UTF8.GetBytes($mBody)) | Out-Null
        Write-Log "Mantenimiento: $mStatus (dueño $owner, completo hace $gcDays días)"
    } catch {
        Write-Log "No se pudo revisar el mantenimiento de Kopia: $($_.Exception.Message)"
    }
}

# ---------- Frecuencia de cada fuente según su política de Kopia ----------
# Devuelve las horas entre snapshots (24 = diario, 168 = semanal) o $null si es manual o no se sabe.
function Get-KopiaIntervalHours([string]$path) {
    try {
        $pj = & $kopiaExe policy show --json $path @kopiaCfgArgs 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $pj) { return $null }
        $pol = ($pj | Out-String) | ConvertFrom-Json
        $sch = $pol.scheduling
        if (-not $sch -and $pol.effective) { $sch = $pol.effective.scheduling }
        if (-not $sch) { return $null }
        if ($sch.manual) { return $null }
        if ($sch.intervalSeconds -and [double]$sch.intervalSeconds -gt 0) { return [math]::Round([double]$sch.intervalSeconds / 3600, 1) }
        $best = $null
        foreach ($expr in @($sch.cron)) {
            if (-not $expr) { continue }
            $f = ([string]$expr).Trim() -split '\s+'
            if ($f.Count -lt 5) { continue }
            $h = 24
            if ($f[2] -ne '*' -and $f[2] -ne '?') { $h = 720 }                       # día del mes: mensual
            elseif ($f[4] -ne '*' -and $f[4] -ne '?') {                               # día de la semana
                $days = 0
                foreach ($part in ($f[4] -split ',')) {
                    if ($part -match '^(\d)-(\d)$') { $days += [int]$matches[2] - [int]$matches[1] + 1 }
                    elseif ($part -match '-') { $days += 5 }   # MON-FRI y parecidos
                    else { $days++ }
                }
                $h = [math]::Round(168 / [math]::Max(1, $days), 1)
            } elseif ($f[1] -ne '*' -and $f[1] -ne '?') { $h = [math]::Round(24 / [math]::Max(1, ($f[1] -split ',').Count), 1) }
            else { $h = 1 }
            if ($best -eq $null -or $h -lt $best) { $best = $h }
        }
        if ($best -ne $null) { return $best }
        $tod = @($sch.timeOfDay | Where-Object { $_ })
        if ($tod.Count -gt 0) { return [math]::Round(24 / $tod.Count, 1) }
    } catch {}
    return $null
}

# ---------- Leer snapshots ----------
# El último de cada fuente aunque tenga más de un día: así un job semanal sigue informando su
# frecuencia todos los días (los reenvíos no duplican). Más de 40 días = fuente abandonada.
$since = (Get-Date).AddDays(-40).ToUniversalTime()

try {
    $kErr = Join-Path $env:TEMP "kopia-report-err.txt"
    $jsonOutput = & $kopiaExe snapshot list --all --json @kopiaCfgArgs 2>$kErr
    if ($LASTEXITCODE -ne 0) {
        # Antes el error se descartaba y quedaba como "no hay snapshots" (típico: la tarea corre con un
        # usuario que no tiene la contraseña del repositorio guardada)
        $msg = (Get-Content $kErr -ErrorAction SilentlyContinue | Select-Object -Last 3) -join ' '
        Write-Log "ERROR: kopia no pudo listar los snapshots (usuario $env:USERNAME): $msg"
        exit 1
    }
    $snapshots  = $jsonOutput | ConvertFrom-Json
} catch {
    Write-Log "ERROR: no se pudo obtener lista de snapshots: $_"
    exit 1
}

$recent = $snapshots | Where-Object {
    $end = Parse-KopiaDate $_.endTime
    $end -ne $null -and $end -gt $since
}

if (-not $recent) {
    Write-Log "No hay snapshots en los últimos 40 días"
    exit 0
}

# ---------- Headers ----------
$headers = @{
    "Content-Type"    = "application/json; charset=utf-8"
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

    $startDt  = Parse-KopiaDate $snap.startTime
    $endDt    = Parse-KopiaDate $snap.endTime
    if (-not $startDt -or -not $endDt) {
        Write-Log "WARN: fecha inválida en snapshot $($snap.id) — omitido"
        continue
    }
    $duration = [int]($endDt - $startDt).TotalSeconds

    $sizeBytes = 0
    try { $sizeBytes = [long]($snap.stats.totalSize) } catch {}

    $errorCount = 0
    try { $errorCount = [int]($snap.stats.errorCount) } catch {}

    $status     = if ($errorCount -gt 0) { "failed" } else { "success" }
    $backedUpAt = $endDt.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    $details    = "id=$($snap.id) files=$($snap.stats.fileCount + $snap.stats.cachedFiles) errors=$errorCount"
    $everyHours = Get-KopiaIntervalHours $path

    Write-Log "Kopia $status - $jobName - ${duration}s - $sizeBytes bytes"

    $body = @{
        service_id       = $SERVICE_ID
        job_name         = $jobName
        status           = $status
        size_bytes       = $sizeBytes
        duration_seconds = $duration
        backed_up_at     = $backedUpAt
        details          = $details
        expected_interval_hours = $everyHours
        script_version   = $SCRIPT_VERSION
    } | ConvertTo-Json -Compress
    if ($everyHours) { Write-Log "  Frecuencia según la política de Kopia: cada $everyHours h" }

    try {
        Invoke-RestMethod -Uri $INGEST_URL -Method POST -Headers $headers -Body ([Text.Encoding]::UTF8.GetBytes($body)) -ErrorAction Stop | Out-Null
        Write-Log "  Reporte enviado OK"
    } catch {
        Write-Log "  ERROR al enviar: $_"
    }

    if ($status -eq 'failed' -and (Get-Command Start-BackupRetry -ErrorAction SilentlyContinue)) {
        Start-BackupRetry -ScriptPath $MyInvocation.MyCommand.Path -LogFile $LogFile -SearchPattern 'failed|errors=[1-9]'
    }
}
