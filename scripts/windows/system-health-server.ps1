# =============================================================
# system-health-server.ps1 — Windows Server: Hardware + Red + RDP
# Schedulear en Task Scheduler cada 5 minutos
# Requiere: config.ps1 en la misma carpeta
#
# ACTUALIZAR (PowerShell, correr como Admin):
#   $dest = "C:\Scripts\system-health-server.ps1"
#   Invoke-WebRequest -Uri "https://raw.githubusercontent.com/mathcenas/service-catalog/main/scripts/windows/system-health-server.ps1" -OutFile $dest
# =============================================================

. "$PSScriptRoot\config.ps1"
[System.Net.WebRequest]::DefaultWebProxy = New-Object System.Net.WebProxy

$SCRIPT_VERSION = "1.11.1"

# ---------- IPs (pública WAN + local) ----------
$publicIp = $null
try {
    $publicIp = (Invoke-RestMethod -Uri "https://api.ipify.org" -TimeoutSec 5 -ErrorAction Stop).Trim()
} catch {
    try {
        $publicIp = (Invoke-RestMethod -Uri "https://checkip.amazonaws.com" -TimeoutSec 5 -ErrorAction Stop).Trim()
    } catch {}
}

$localIp = $null
try {
    $localIp = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
        Where-Object { $_.PrefixOrigin -ne 'WellKnown' -and $_.IPAddress -notmatch '^127\.' } |
        Sort-Object { $_.InterfaceMetric } |
        Select-Object -First 1).IPAddress
} catch {}

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$OutputEncoding = [System.Text.Encoding]::UTF8

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
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-90) } |
    Remove-Item -Force

$headers = @{
    "Content-Type"    = "application/json; charset=utf-8"
    "apikey"          = $ANON_KEY
    "Authorization"   = "Bearer $ANON_KEY"
    "X-Ingest-Secret" = $INGEST_SECRET
}

# ---------- 1. HARDWARE (CPU / RAM / Disco C:) ----------
# Get-Counter usa nombres en el idioma del SO — fallback a CimInstance que es neutral
try {
    $cpuUsage = [math]::Round(
        (Get-Counter '\Processor(_Total)\% Processor Time' -ErrorAction Stop).CounterSamples.CookedValue, 1)
} catch {
    try {
        $cpuUsage = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
    } catch {
        $cpuUsage = 0
    }
}

try {
    $cpuObj     = Get-CimInstance Win32_Processor
    $cpuName    = ($cpuObj | Select-Object -First 1).Name -replace '\s+', ' '
    $cpuCores   = ($cpuObj | Measure-Object -Property NumberOfCores -Sum).Sum
    $cpuThreads = ($cpuObj | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum
} catch {
    $cpuName = $null; $cpuCores = 0; $cpuThreads = 0
}

try {
    $ramAvailMB = (Get-Counter '\Memory\Available MBytes' -ErrorAction Stop).CounterSamples.CookedValue
    $os         = Get-CimInstance Win32_OperatingSystem
    $ramTotalMB = $os.TotalVisibleMemorySize / 1KB
    $ramUsePct  = [math]::Round((($ramTotalMB - $ramAvailMB) / $ramTotalMB) * 100, 1)
    $ramTotalGB = [math]::Round($ramTotalMB / 1024, 1)
} catch {
    try {
        $os         = Get-CimInstance Win32_OperatingSystem
        $ramTotalMB = $os.TotalVisibleMemorySize / 1KB
        $ramUsePct  = [math]::Round((($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) / $os.TotalVisibleMemorySize) * 100, 1)
        $ramTotalGB = [math]::Round($ramTotalMB / 1024, 1)
    } catch {
        $ramUsePct = 0; $ramTotalGB = 0
    }
}

try {
    $diskC      = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
    $diskUsePct = [math]::Round((($diskC.Size - $diskC.FreeSpace) / $diskC.Size) * 100, 1)
    $diskFreeGB = [math]::Round($diskC.FreeSpace / 1GB, 1)
} catch {
    $diskUsePct = 0; $diskFreeGB = 0
}

$hwStatus = if   ($diskUsePct -gt 90 -or $ramUsePct -gt 92 -or $cpuUsage -gt 95) { "failed" }
            elseif ($diskUsePct -gt 75 -or $ramUsePct -gt 80 -or $cpuUsage -gt 80) { "warning" }
            else { "success" }

# ---------- RAID / Storage Spaces ----------
$raidList = @()
try {
    $pools = Get-StoragePool -ErrorAction Stop | Where-Object { $_.IsPrimordial -eq $false }
    foreach ($pool in $pools) {
        $vdisks = Get-VirtualDisk -StoragePool $pool -ErrorAction SilentlyContinue
        foreach ($vd in $vdisks) {
            $rStatus = switch ($vd.HealthStatus) {
                'Healthy'   { 'ok' }
                'Warning'   { 'warning' }
                'Unhealthy' { 'error' }
                default     { 'warning' }
            }
            if ($rStatus -ne 'ok' -and $hwStatus -eq 'success') { $hwStatus = 'warning' }
            if ($rStatus -eq 'error') { $hwStatus = 'warning' }
            $sizeGB  = if ($vd.Size -gt 0) { [math]::Round($vd.Size / 1GB, 1) } else { $null }
            $allocGB = if ($vd.FootprintOnPool -gt 0) { [math]::Round($vd.FootprintOnPool / 1GB, 1) } else { $null }
            $raidList += @{
                pool         = $pool.FriendlyName
                name         = $vd.FriendlyName
                resiliency   = $vd.ResiliencySettingName
                health       = $vd.HealthStatus
                operational  = $vd.OperationalStatus
                status       = $rStatus
                size_gb      = $sizeGB
                allocated_gb = $allocGB
            }
        }
    }
} catch {}

# ---------- Errores de disco en el Visor de eventos ----------
# Discos detrás de una controladora RAID (Intel RST / iaStor, PERC, etc.) aparecen como un solo
# disco "Healthy" para Get-PhysicalDisk, aunque un disco físico esté fallando. Windows sí lo
# registra en el log System: se cuentan esos eventos de las últimas $DISK_EVENT_HOURS horas.
$CHECK_DISK_EVENTS = if (Get-Variable 'CHECK_DISK_EVENTS' -ErrorAction SilentlyContinue) { $CHECK_DISK_EVENTS } else { $true }
$DISK_EVENT_HOURS = if (Get-Variable 'DISK_EVENT_HOURS' -ErrorAction SilentlyContinue) { [int]$DISK_EVENT_HOURS } else { 24 }
$diskEvents = @()
$diskEventIssues = @()
if ($CHECK_DISK_EVENTS) { try {
    $evSince = (Get-Date).AddHours(-$DISK_EVENT_HOURS)
    # Proveedor → IDs graves (falla) y leves (aviso). Las controladoras RAID: cualquier error.
    $evRules = @(
        @{ p = 'disk';                   bad = @(7, 154);        warn = @(11, 51, 153) },
        @{ p = 'Microsoft-Windows-Ntfs'; bad = @(55, 140, 137);  warn = @(98) },
        @{ p = 'Ntfs';                   bad = @(55, 140, 137);  warn = @(98) }
    )
    foreach ($ctl in 'iaStorVD', 'iaStorAC', 'iaStorA', 'iaStorAVC', 'iaStorV', 'megasas', 'megasas2i', 'percsas2i', 'percsas3i', 'arcsas', 'HpCISSs3', 'SmartPqi') {
        $evRules += @{ p = $ctl; bad = 'error'; warn = @() }
    }
    foreach ($rule in $evRules) {
        $evs = $null
        try {
            $evs = Get-WinEvent -FilterHashtable @{ LogName = 'System'; ProviderName = $rule.p; Level = 1, 2, 3; StartTime = $evSince } -MaxEvents 5000 -ErrorAction Stop
        } catch { continue }   # proveedor inexistente o sin eventos
        foreach ($g in ($evs | Group-Object Id)) {
            $id = [int]$g.Name
            $first = $g.Group | Select-Object -Last 1
            $last  = $g.Group | Select-Object -First 1
            if ($rule.bad -eq 'error') { $sev = if ($last.Level -le 2) { 'error' } else { $null } }
            elseif ($id -in $rule.bad)  { $sev = 'error' }
            elseif ($id -in $rule.warn) { $sev = 'warning' }
            else { $sev = $null }
            if (-not $sev) { continue }
            $msg = [string]$last.Message
            $vol    = if ($msg -match 'Volum(?:e|en)Id:\s*([^;\s]+)') { $Matches[1] } else { $null }
            $serial = if ($msg -match '(?:serie del dispositivo|Device Serial Number):\s*(\S+)') { $Matches[1] }
                      elseif ($msg -match 'disk\s*:\s*(\S+)') { $Matches[1] } else { $null }
            $diskNo = if ($msg -match '(?:disco|disk)\s+(\d+)\b') { $Matches[1] } else { $null }
            $model  = if ($msg -match '(?:Modelo de dispositivo|Device Model):\s*(.+)') { $Matches[1].Trim() } else { $null }
            $diskEvents += @{
                source = $rule.p; id = $id; severity = $sev; count = $g.Count
                first  = $first.TimeCreated.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'")
                last   = $last.TimeCreated.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'")
                volume = $vol; serial = $serial; disk = $diskNo; model = $model
                sample = ($msg -split "`r?`n")[0].Trim()
            }
        }
    }
    foreach ($e in $diskEvents) {
        $what = switch -Regex ($e.source) {
            '^disk$' { if ($e.id -in 7, 154) { "error de hardware" } elseif ($e.id -eq 153) { "reintentos de lectura/escritura" } else { "errores de E/S" } }
            'Ntfs'   { "NTFS no pudo escribir" }
            default  { "controladora RAID ($($e.source))" }
        }
        $where = @()
        if ($e.disk)   { $where += "disco $($e.disk)" }
        if ($e.volume) { $where += $e.volume }
        if ($e.model)  { $where += $e.model }
        if ($e.serial) { $where += "serie $($e.serial)" }
        $diskEventIssues += "Visor de eventos: $($e.count)× $what$(if ($where) { ' (' + ($where -join ', ') + ')' })"
        if ($e.severity -eq 'error') { $hwStatus = 'failed' }
        elseif ($hwStatus -eq 'success') { $hwStatus = 'warning' }
    }
    if ($diskEvents.Count) { Write-Log "⚠️ Errores de disco en el Visor de eventos: $($diskEventIssues -join ' · ')" }
} catch {
    Write-Log "⚠️ Visor de eventos (discos): $($_.Exception.Message)"
} }

# ---------- Discos que Windows no puede usar ----------
# Un disco sin inicializar (RAW), desconectado (Offline) o que la controladora ve pero Windows
# no lista (se cayó) suele ser un disco que falló o que salió de un RAID.
$CHECK_DISK_INIT = if (Get-Variable 'CHECK_DISK_INIT' -ErrorAction SilentlyContinue) { $CHECK_DISK_INIT } else { $true }
$diskInitIssues = @()
if ($CHECK_DISK_INIT) {
    try {
        $wDisks = @(Get-Disk -ErrorAction Stop)
        foreach ($d in $wDisks) {
            $label = "Disco $($d.Number) $([string]$d.FriendlyName)$(if ($d.SerialNumber) { ' (serie ' + ([string]$d.SerialNumber).Trim() + ')' })"
            if ($d.PartitionStyle -eq 'RAW')        { $diskInitIssues += "${label}: sin inicializar" }
            elseif ($d.OperationalStatus -ne 'Online') { $diskInitIssues += "${label}: $($d.OperationalStatus)" }
        }
        $known = @($wDisks | ForEach-Object { [string]$_.Number })
        # Los discos de un grupo de Espacios de almacenamiento no aparecen en Get-Disk: no son una falla
        $pooled = @(Get-StoragePool -IsPrimordial $false -ErrorAction SilentlyContinue | Get-PhysicalDisk -ErrorAction SilentlyContinue | ForEach-Object { [string]$_.UniqueId })
        foreach ($pd in @(Get-PhysicalDisk -ErrorAction SilentlyContinue)) {
            if ($pd.DeviceId -ne $null -and ([string]$pd.DeviceId) -notin $known -and ([string]$pd.UniqueId) -notin $pooled) {
                $diskInitIssues += "Disco $($pd.DeviceId) $([string]$pd.FriendlyName) (serie $(([string]$pd.SerialNumber).Trim())): la controladora lo ve pero Windows no"
            }
        }
        if ($diskInitIssues.Count -and $hwStatus -eq 'success') { $hwStatus = 'warning' }
    } catch { Write-Log "⚠️ Discos: $($_.Exception.Message)" }
}

# ---------- Puntos de control viejos de Hyper-V ----------
# Una VM con un punto de control abierto escribe todo en un .avhdx que crece sin límite y
# puede llenar el disco del host (Hyper-V pausa la VM). Las réplicas (Veeam / Hyper-V Replica)
# usan puntos de control a propósito: se ignoran por nombre con $CHECKPOINT_IGNORE.
$CHECK_HYPERV_CHECKPOINTS = if (Get-Variable 'CHECK_HYPERV_CHECKPOINTS' -ErrorAction SilentlyContinue) { $CHECK_HYPERV_CHECKPOINTS } else { $true }
$CHECKPOINT_MAX_DAYS = if (Get-Variable 'CHECKPOINT_MAX_DAYS' -ErrorAction SilentlyContinue) { [int]$CHECKPOINT_MAX_DAYS } else { 7 }
$CHECKPOINT_IGNORE   = if (Get-Variable 'CHECKPOINT_IGNORE' -ErrorAction SilentlyContinue) { [string]$CHECKPOINT_IGNORE } else { '*_replica,*replica*' }
$hvCheckpoints = @()
$hvIssues = @()
if ($CHECK_HYPERV_CHECKPOINTS -and (Get-Command Get-VMSnapshot -ErrorAction SilentlyContinue)) {
    try {
        $cpIgnore = @($CHECKPOINT_IGNORE -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
        $cpLimit = (Get-Date).AddDays(-$CHECKPOINT_MAX_DAYS)
        foreach ($vm in @(Get-VM -ErrorAction Stop)) {
            if (@($cpIgnore | Where-Object { $vm.Name -like $_ }).Count) { continue }
            $snaps = @(Get-VMSnapshot -VMName $vm.Name -ErrorAction SilentlyContinue | Where-Object { $_.SnapshotType -ne 'Replica' -and $_.CreationTime -lt $cpLimit })
            if (-not $snaps.Count) { continue }
            $oldest = ($snaps | Sort-Object CreationTime | Select-Object -First 1).CreationTime
            $avhdxGB = 0
            foreach ($dir in @(Get-VMHardDiskDrive -VMName $vm.Name -ErrorAction SilentlyContinue | ForEach-Object { Split-Path $_.Path -Parent } | Sort-Object -Unique)) {
                $avhdxGB += (Get-ChildItem $dir -Filter *.avhdx -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum / 1GB
            }
            $avhdxGB = [math]::Round($avhdxGB, 1)
            $days = [int]((Get-Date) - $oldest).TotalDays
            $hvCheckpoints += @{ vm = $vm.Name; count = $snaps.Count; oldest = $oldest.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'"); days = $days; avhdx_gb = $avhdxGB }
            $hvIssues += "VM $($vm.Name): $($snaps.Count) punto(s) de control, el más viejo de hace $days días$(if ($avhdxGB) { " ($avhdxGB GB en .avhdx)" })"
        }
        if ($hvIssues.Count -and $hwStatus -eq 'success') { $hwStatus = 'warning' }
    } catch { Write-Log "⚠️ Hyper-V: $($_.Exception.Message)" }
}


# ---------- Actualizaciones del SO (solo lectura, no instala nada) ----------
# La consulta a Windows Update es lenta: se hace 1 vez por día y el resultado queda en cache.
function ConvertTo-UtcDate($v) {
    if (-not $v) { return $null }
    if ($v -is [datetime]) { return $v.ToUniversalTime() }
    try { return [datetime]::Parse([string]$v, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]'AssumeUniversal,AdjustToUniversal') } catch { return $null }
}
function Format-UtcDate($d) { if ($d) { $d.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'") } else { $null } }

$osUpdates = $null
$osuIssues = @()
if ($CHECK_OS_UPDATES -ne $false) {
    $osuCacheFile = Join-Path $PSScriptRoot "os-updates-cache.json"
    $osuCache = $null
    if (Test-Path $osuCacheFile) { try { $osuCache = Get-Content $osuCacheFile -Raw | ConvertFrom-Json } catch {} }
    $nowUtc     = (Get-Date).ToUniversalTime()
    $prevCheck  = if ($osuCache) { ConvertTo-UtcDate $osuCache.checked_at } else { $null }
    $osuFresh   = $prevCheck -and ($nowUtc - $prevCheck).TotalHours -lt 20

    $osuPending = $null; $osuSecurity = $null; $osuLast = $null; $checkedAt = $nowUtc
    if ($osuFresh) {
        $osuPending = $osuCache.pending; $osuSecurity = $osuCache.security
        $osuLast = $osuCache.last_installed_at; $checkedAt = $prevCheck
    } else {
        $osuJob = Start-Job -ScriptBlock {
            $searcher = (New-Object -ComObject Microsoft.Update.Session).CreateUpdateSearcher()
            $res = $searcher.Search("IsInstalled=0 and IsHidden=0 and Type='Software'")
            # Categorías "Security Updates" y "Critical Updates" (por GUID: el nombre depende del idioma)
            $secCats = @('0fa1201d-4330-4fa8-8ae9-b877473b6441', 'e6cf1350-c01b-414d-a61f-263d14d133b4')
            $sec = 0
            foreach ($u in $res.Updates) {
                $isSec = @('Critical', 'Important') -contains $u.MsrcSeverity
                foreach ($c in $u.Categories) { if ($secCats -contains ([string]$c.CategoryID).ToLower()) { $isSec = $true } }
                if ($isSec) { $sec++ }
            }
            $last = $null
            $n = $searcher.GetTotalHistoryCount()
            if ($n -gt 0) {
                foreach ($h in $searcher.QueryHistory(0, [math]::Min($n, 200))) {
                    # Operation 1 = instalación, ResultCode 2 = exitosa
                    if ($h.Operation -eq 1 -and $h.ResultCode -eq 2 -and ($null -eq $last -or $h.Date -gt $last)) { $last = $h.Date }
                }
            }
            [pscustomobject]@{ pending = $res.Updates.Count; security = $sec; last = if ($last) { $last.ToString('yyyy-MM-dd') } else { $null } }
        }
        $osuError = $null
        if (Wait-Job $osuJob -Timeout 300) {
            try {
                $r = Receive-Job $osuJob -ErrorAction Stop
                $osuPending = $r.pending; $osuSecurity = $r.security; $osuLast = $r.last
            } catch { $osuError = $_.Exception.Message }
        } else {
            $osuError = "timeout consultando Windows Update"
        }
        Remove-Job $osuJob -Force -ErrorAction SilentlyContinue
        if ($osuError) {
            Write-Log "⚠️ os-updates: $osuError"
            if ($osuCache) { $osuPending = $osuCache.pending; $osuSecurity = $osuCache.security; $osuLast = $osuCache.last_installed_at }
        }
        if (-not $osuLast) {
            try {
                $hf = Get-HotFix -ErrorAction Stop | Where-Object { $_.InstalledOn } | Sort-Object InstalledOn -Descending | Select-Object -First 1
                if ($hf) { $osuLast = $hf.InstalledOn.ToString('yyyy-MM-dd') }
            } catch {}
        }
    }

    $osuReboot = (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired') -or
                 (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending')

    if ($null -eq $osuPending) { Write-Log "⚠️ os-updates: sin datos (la consulta no devolvió resultados)" }
    if ($null -ne $osuPending) {
        $lastBoot = $null
        try { $lastBoot = (Get-CimInstance Win32_OperatingSystem -ErrorAction Stop).LastBootUpTime.ToUniversalTime() } catch {}
        $prevRebootSince = if ($osuCache) { ConvertTo-UtcDate $osuCache.reboot_since } else { $null }
        if ($prevRebootSince -and $lastBoot -and $prevRebootSince -lt $lastBoot) { $prevRebootSince = $null }
        $rebootSince = if ($osuReboot) { if ($prevRebootSince) { $prevRebootSince } else { $nowUtc } } else { $null }
        $prevSecSince = if ($osuCache) { ConvertTo-UtcDate $osuCache.security_since } else { $null }
        $secSince = if ([int]$osuSecurity -gt 0) { if ($prevSecSince) { $prevSecSince } else { $nowUtc } } else { $null }

        $osUpdates = [ordered]@{
            pending           = [int]$osuPending
            security          = [int]$osuSecurity
            reboot_required   = [bool]$osuReboot
            reboot_since      = Format-UtcDate $rebootSince
            security_since    = Format-UtcDate $secSince
            last_installed_at = $osuLast
            checked_at        = Format-UtcDate $checkedAt
        }
        try { $osUpdates | ConvertTo-Json | Set-Content -Path $osuCacheFile -Encoding UTF8 } catch {}
        $osuSrc = if ($osuFresh) { "cache" } else { "Windows Update" }
        Write-Log "✅ os-updates → $([int]$osuPending) pendientes ($([int]$osuSecurity) de seguridad) | reinicio: $(if ($osuReboot) {'sí'} else {'no'}) | último parche: $osuLast | fuente: $osuSrc"

        if ($secSince -and ($nowUtc - $secSince).TotalDays -ge 14) {
            $osuIssues += "$([int]$osuSecurity) parches de seguridad pendientes"
        }
        if ($rebootSince -and ($nowUtc - $rebootSince).TotalDays -ge 7) {
            $osuIssues += "Reinicio pendiente hace $([int][math]::Floor(($nowUtc - $rebootSince).TotalDays)) días"
        }
        if ($osuIssues.Count -gt 0 -and $hwStatus -eq 'success') { $hwStatus = 'warning' }
    }
}

# ---------- Uptime / issues (mismo formato que system-health.sh) ----------
$uptimeStr = $null; $uptimeSecs = $null
try {
    $boot       = (Get-CimInstance Win32_OperatingSystem -ErrorAction Stop).LastBootUpTime
    $up         = (Get-Date) - $boot
    $uptimeSecs = [int][math]::Floor($up.TotalSeconds)
    $uptimeStr  = if ($up.Days -gt 0) { "$($up.Days)d $($up.Hours)h" } else { "$($up.Hours)h" }
} catch {}

$issueList = @()
if     ($cpuUsage   -gt 80) { $issueList += "CPU alta ($cpuUsage%)" }
if     ($ramUsePct  -gt 80) { $issueList += "RAM alta ($ramUsePct%)" }
if     ($diskUsePct -gt 90) { $issueList += "Disco C lleno ($diskUsePct%)" }
elseif ($diskUsePct -gt 75) { $issueList += "Disco C alto ($diskUsePct%)" }
foreach ($r in $raidList) {
    if ($r.status -ne 'ok') { $issueList += "Volumen $($r.name): $($r.health)" }
}
$issueList += $diskEventIssues
$issueList += $diskInitIssues
$issueList += $hvIssues
# ---------- Tailscale: sesión y vencimiento de claves ----------
# Avisa si la sesión de este equipo venció o si la clave de este equipo o de otro del túnel
# vence en 7 días o menos (o ya venció). $TAILSCALE_IGNORE (config.ps1): nombres a ignorar,
# separados por coma (por ejemplo notebooks que se dejan con vencimiento a propósito).
$tailscale = $null
$tsExe = @("$env:ProgramFiles\Tailscale\tailscale.exe", "${env:ProgramFiles(x86)}\Tailscale\tailscale.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $tsExe) { $tsCmd = Get-Command tailscale -ErrorAction SilentlyContinue; if ($tsCmd) { $tsExe = $tsCmd.Source } }
if ($tsExe) {
    try {
        $tsStatus = (& $tsExe status --json 2>$null | Out-String) | ConvertFrom-Json -ErrorAction Stop
        $tsIgnore = @("$TAILSCALE_IGNORE" -split ',' | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_ })
        $tsNow = (Get-Date).ToUniversalTime()
        function Get-TsDays($exp) {
            if (-not $exp) { return $null }
            try { return [math]::Floor(([datetime]::Parse($exp).ToUniversalTime() - $tsNow).TotalDays) } catch { return $null }
        }
        $tsIssues = @()
        if ($tsStatus.BackendState -eq 'NeedsLogin') { $tsIssues += "Tailscale: la sesión de este equipo venció, hay que volver a iniciar sesión" }
        $selfDays = Get-TsDays $tsStatus.Self.KeyExpiry
        if ($null -ne $selfDays -and $selfDays -le 7) {
            $tsIssues += if ($selfDays -lt 0) { "Tailscale: la clave de este equipo venció" } else { "Tailscale: la clave de este equipo vence en $selfDays días" }
        }
        $tsPeers = @()
        if ($tsStatus.Peer) {
            foreach ($prop in $tsStatus.Peer.PSObject.Properties) {
                $pr = $prop.Value
                $pDays = Get-TsDays $pr.KeyExpiry
                $tsPeers += [ordered]@{
                    name = $pr.HostName; ip = @($pr.TailscaleIPs)[0]; os = $pr.OS; online = [bool]$pr.Online
                    last_seen = $pr.LastSeen; key_expiry = $pr.KeyExpiry; key_days_left = $pDays
                }
                if ($null -ne $pDays -and $pDays -le 7 -and $tsIgnore -notcontains "$($pr.HostName)".ToLower()) {
                    $tsIssues += if ($pDays -lt 0) { "Tailscale: la clave de $($pr.HostName) venció" } else { "Tailscale: la clave de $($pr.HostName) vence en $pDays días" }
                }
            }
        }
        $tailscale = [ordered]@{
            backend = $tsStatus.BackendState
            self    = [ordered]@{ name = $tsStatus.Self.HostName; ip = @($tsStatus.Self.TailscaleIPs)[0]; online = [bool]$tsStatus.Self.Online; key_expiry = $tsStatus.Self.KeyExpiry; key_days_left = $selfDays }
            peers   = $tsPeers
        }
        if ($tsIssues.Count -gt 0) {
            $issueList += $tsIssues
            if ($hwStatus -eq 'success') { $hwStatus = 'warning' }
        }
    } catch { Write-Log "Tailscale: no se pudo leer el estado ($($_.Exception.Message))" }
}

$issueList += $osuIssues
$issues = if ($issueList.Count -gt 0) { $issueList -join ' · ' } else { 'Normal' }

# ---------- Qué corre en este equipo (sugerencias para el portal) ----------
# Carpetas compartidas (sin las del sistema), impresoras compartidas y servicios conocidos.
# En el portal aparecen como "Detectado en el equipo" para sumarlos con un clic.
$serverRoles = [ordered]@{ shares = @(); printers = @(); services = @() }
try {
    $serverRoles.shares = @(Get-SmbShare -ErrorAction Stop | Where-Object { -not $_.Special -and $_.Name -notmatch '\$$' -and $_.Name -notin @('print$', 'IPC$') } |
        ForEach-Object { [ordered]@{ name = $_.Name; path = $_.Path; description = $_.Description } })
} catch {}
try {
    $serverRoles.printers = @(Get-Printer -ErrorAction Stop | Where-Object { $_.Shared } |
        ForEach-Object { [ordered]@{ name = $_.Name; share_name = $_.ShareName; driver = $_.DriverName } })
} catch {}
$knownServices = [ordered]@{
    'MSSQL*'            = 'SQL Server';       'postgresql*'   = 'PostgreSQL';        'MySQL*'       = 'MySQL'
    'W3SVC'             = 'IIS (sitios web)'; 'NTDS'          = 'Active Directory';  'DNS'          = 'DNS'
    'DHCPServer'        = 'DHCP';             'vmms'          = 'Hyper-V';           'Veeam*'       = 'Veeam'
    'Kopia*'            = 'Kopia';            'CobianReflector*' = 'Cobian Reflector'; 'AnyDesk'    = 'AnyDesk'
    'TeamViewer'        = 'TeamViewer';       'FileZilla*'    = 'FileZilla Server';  'Apache*'      = 'Apache'
}
try {
    $allSvc = Get-Service -ErrorAction Stop
    foreach ($pattern in $knownServices.Keys) {
        $hit = $allSvc | Where-Object { $_.Name -like $pattern } | Select-Object -First 1
        if ($hit) { $serverRoles.services += [ordered]@{ name = $knownServices[$pattern]; svc = $hit.Name; status = $hit.Status.ToString() } }
    }
} catch {}

$hwData = @{
    service_id = $SERVICE_ID
    source     = "system-health"
    status     = $hwStatus
    message    = "CPU: $cpuUsage% | RAM: $ramUsePct% | Disk C: $diskUsePct%"
    payload    = @{
        hostname       = $env:COMPUTERNAME
        cpu_pct        = $cpuUsage
        cpu_name       = $cpuName
        cpu_cores      = $cpuCores
        cpu_threads    = $cpuThreads
        ram_pct        = $ramUsePct
        ram_total_gb   = $ramTotalGB
        disk_pct       = $diskUsePct
        disk_free_gb   = $diskFreeGB
        uptime_str     = $uptimeStr
        uptime_seconds = $uptimeSecs
        issues         = $issues
        os_updates     = $osUpdates
        tailscale      = $tailscale
        server_roles   = $serverRoles
        disk_raid      = $raidList
        disk_events    = $diskEvents
        hyperv_checkpoints = $hvCheckpoints
        public_ip      = $publicIp
        local_ip       = $localIp
        is_server      = $true
        os_caption     = (Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue).Caption
        script_version = $SCRIPT_VERSION
    }
}
$hwBody = $hwData | ConvertTo-Json -Depth 5

try {
    Invoke-RestMethod -Uri $HEARTBEAT_URL -Method POST -Headers $headers -Body ([Text.Encoding]::UTF8.GetBytes($hwBody)) | Out-Null
    Write-Log "✅ system-health → $hwStatus | CPU: $cpuUsage% | RAM: $ramUsePct% | Disk: $diskUsePct%"
} catch {
    Write-Log "❌ system-health Error: $($_.Exception.Message)"
}

# ---------- Servicios extra en este mismo host ----------
# Cada servicio de $EXTRA_HEALTH_SERVICES (config.ps1) recibe una copia del heartbeat de hardware.
foreach ($extra in @($EXTRA_HEALTH_SERVICES)) {
    if (-not $extra -or -not $extra.ServiceId -or -not $extra.IngestSecret) { continue }
    $label = if ($extra.Name) { $extra.Name } else { $extra.ServiceId }
    $hwData.service_id = $extra.ServiceId
    $extraHeaders = $headers.Clone()
    $extraHeaders["X-Ingest-Secret"] = $extra.IngestSecret
    try {
        Invoke-RestMethod -Uri $HEARTBEAT_URL -Method POST -Headers $extraHeaders -Body ([Text.Encoding]::UTF8.GetBytes(($hwData | ConvertTo-Json -Depth 5))) | Out-Null
        Write-Log "✅ system-health [$label] → $hwStatus"
    } catch {
        Write-Log "❌ system-health [$label] Error: $($_.Exception.Message)"
    }
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
$netStatus = if   (-not $gatewayOk)                                        { "failed" }
             elseif (-not $internetOk)                                      { "failed" }
             elseif ($packetLoss -gt 10 -or $avgLatency -gt 200)           { "warning" }
             elseif ($packetLoss -gt 2  -or $avgLatency -gt 100)           { "warning" }
             else { "success" }

$netMsg = "GW: $(if ($gatewayOk) {'ok'} else {'❌'}) | Internet: $(if ($internetOk) {'ok'} else {'❌'}) | Ping: ${avgLatency}ms | Loss: ${packetLoss}%"

$netBody = @{
    service_id = $SERVICE_ID
    source     = "network"
    status     = $netStatus
    message    = $netMsg
    payload    = @{
        is_server       = $true
        gateway_ip      = $GatewayIP
        gateway_ok      = $gatewayOk
        internet_ok     = $internetOk
        ping_ms         = $avgLatency
        packet_loss_pct = $packetLoss
        script_version  = $SCRIPT_VERSION
    }
} | ConvertTo-Json -Depth 3

try {
    Invoke-RestMethod -Uri $HEARTBEAT_URL -Method POST -Headers $headers -Body ([Text.Encoding]::UTF8.GetBytes($netBody)) | Out-Null
    Write-Log "✅ network → $netStatus | $netMsg"
} catch {
    Write-Log "❌ network Error: $($_.Exception.Message)"
}

# ---------- 3. RDP + AnyDesk (Sesiones / TCP / Desconexiones / Disk Latency) ----------
$CHECK_RDP = if (Get-Variable 'CHECK_RDP' -ErrorAction SilentlyContinue) { $CHECK_RDP } else { $true }

if ($CHECK_RDP -ne $false) {

# AnyDesk — leer ID (v6 registry, v7 ProgramData, instalación por usuario en todos los perfiles)
$anydeskId = $null
try { $anydeskId = (Get-ItemProperty -Path "HKLM:\SOFTWARE\AnyDesk" -Name "ad_id" -ErrorAction Stop).ad_id } catch {}
if (-not $anydeskId) {
    $adFixed = @(
        "$env:ProgramData\AnyDesk\service.conf",
        "$env:ProgramData\AnyDesk\system.conf",
        "$env:ProgramData\AnyDesk\ad_anynet.cfg"
    )
    foreach ($c in $adFixed) {
        if (Test-Path $c) {
            $adLine = Get-Content $c -ErrorAction SilentlyContinue | Where-Object { $_ -match '^(ad\.anynet\.id|id)=' }
            if ($adLine) { $anydeskId = ($adLine[0] -replace '^(ad\.anynet\.id|id)=', '').Trim(); break }
        }
    }
}
if (-not $anydeskId) {
    $usersRoot = "$env:SystemDrive\Users"
    Get-ChildItem $usersRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        if ($anydeskId) { return }
        $candidates = @(
            "$($_.FullName)\AppData\Roaming\AnyDesk\service.conf",
            "$($_.FullName)\AppData\Roaming\AnyDesk\system.conf",
            "$($_.FullName)\AppData\Roaming\AnyDesk\ad_anynet.cfg"
        )
        foreach ($c in $candidates) {
            if (Test-Path $c) {
                $adLine = Get-Content $c -ErrorAction SilentlyContinue | Where-Object { $_ -match '^(ad\.anynet\.id|id)=' }
                if ($adLine) { $anydeskId = ($adLine[0] -replace '^(ad\.anynet\.id|id)=', '').Trim(); break }
            }
        }
    }
}

# AnyDesk — reiniciar si esta caido
$adService = Get-Service -Name "AnyDesk" -ErrorAction SilentlyContinue
$adStatus  = if ($adService) { $adService.Status.ToString() } else { "NotFound" }
if ($adService -and $adService.Status -ne 'Running') {
    try {
        Restart-Service -Name "AnyDesk" -Force -ErrorAction Stop
        $adStatus = "Restarted"
        Write-Log "⚠️ AnyDesk: servicio reiniciado automaticamente"
    } catch {
        Write-Log "❌ AnyDesk: no se pudo reiniciar: $($_.Exception.Message)"
    }
}

# Verificar y auto-reiniciar TermService si esta caido
$rdpService   = Get-Service -Name "TermService" -ErrorAction SilentlyContinue
$rdpSvcStatus = if ($rdpService) { $rdpService.Status.ToString() } else { "NotFound" }
$rdpListening = (Get-NetTCPConnection -LocalPort 3389 -State Listen -ErrorAction SilentlyContinue).Count -gt 0
$rdpRestarted = $false

if ($rdpService -and $rdpService.Status -ne 'Running') {
    try {
        Restart-Service -Name "TermService" -Force -ErrorAction Stop
        Start-Sleep -Seconds 3
        $rdpService   = Get-Service -Name "TermService" -ErrorAction SilentlyContinue
        $rdpSvcStatus = $rdpService.Status.ToString()
        $rdpListening = (Get-NetTCPConnection -LocalPort 3389 -State Listen -ErrorAction SilentlyContinue).Count -gt 0
        $rdpRestarted = $true
        Write-Log "⚠️ RDP: TermService estaba detenido - reiniciado automaticamente"
    } catch {
        Write-Log "❌ RDP: no se pudo reiniciar TermService: $($_.Exception.Message)"
    }
}

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

# Latencia de disco C: (segundos por operación) — contador en inglés, puede fallar en SO en español
try {
    $diskLatency = [math]::Round(
        (Get-Counter '\LogicalDisk(C:)\Avg. Disk sec/Transfer' -ErrorAction Stop).CounterSamples.CookedValue, 3)
} catch {
    $diskLatency = 0
}

# Límite de sesiones: leer del sistema, fallback a $RdpSessionWarning del config
try {
    $maxAllowed = (Get-WmiObject -Namespace "root\cimv2\TerminalServices" `
        -Class Win32_TerminalServiceSetting -ErrorAction Stop).MaxConnectionAllowed
    if (-not $maxAllowed -or $maxAllowed -eq 0) { $maxAllowed = $RdpSessionWarning }
} catch {
    $maxAllowed = $RdpSessionWarning
}
$rdpWarnThreshold = [math]::Floor($maxAllowed * 0.85)

$rdpStatus = if   ($rdpSvcStatus -ne 'Running' -or -not $rdpListening)  { "failed" }
             elseif ($sessions -ge $maxAllowed -or $disconnects -gt 3)  { "failed" }
             elseif ($sessions -ge $rdpWarnThreshold -or $rdpRestarted) { "warning" }
             elseif ($rdpConnections -eq 0 -and $sessions -gt 0)        { "warning" }
             else { "success" }

$diskIOStatus = if   ($diskLatency -gt 0.050) { "failed" }
                elseif ($diskLatency -gt 0.030) { "warning" }
                else { "success" }

$rdpOverallStatus = if ($diskIOStatus -eq "failed" -or $rdpStatus -eq "failed") { "failed" }
                    elseif ($diskIOStatus -eq "warning" -or $rdpStatus -eq "warning") { "warning" }
                    else { "success" }

$rdpMsg = "TermService: $rdpSvcStatus | Sessions: $sessions/$maxAllowed | TCP 3389: $rdpConnections | Disconnects (${RdpEventWindow}m): $disconnects | DiskIO: ${diskLatency}s"
if ($rdpRestarted) { $rdpMsg += " | AUTO-REINICIADO" }

$rdpBody = @{
    service_id = $SERVICE_ID
    source     = "rdp"
    status     = $rdpOverallStatus
    message    = $rdpMsg
    payload    = @{
        is_server           = $true
        service_status      = $rdpSvcStatus
        port_listening      = $rdpListening
        auto_restarted      = $rdpRestarted
        anydesk_id          = $anydeskId
        anydesk_status      = $adStatus
        rdp_sessions        = $sessions
        rdp_max_allowed     = $maxAllowed
        rdp_tcp_connections = $rdpConnections
        rdp_disconnects     = $disconnects
        disk_latency_sec    = $diskLatency
        disk_io_status      = $diskIOStatus
        script_version      = $SCRIPT_VERSION
    }
} | ConvertTo-Json -Depth 3

try {
    Invoke-RestMethod -Uri $HEARTBEAT_URL -Method POST -Headers $headers -Body ([Text.Encoding]::UTF8.GetBytes($rdpBody)) | Out-Null
    $icon = if ($rdpOverallStatus -eq 'failed') {'❌'} elseif ($rdpOverallStatus -eq 'warning') {'⚠️'} else {'✅'}
    Write-Log "$icon rdp → $rdpOverallStatus | TermService: $rdpSvcStatus | Sessions: $sessions | Disconnects: $disconnects | DiskIO: ${diskLatency}s$(if ($rdpRestarted) {' | AUTO-REINICIADO'})"
} catch {
    Write-Log "❌ rdp Error: $($_.Exception.Message)"
}

} else {
    $disabledBody = @{
        service_id = $SERVICE_ID; source = "rdp"; status = "success"
        message = "Deshabilitado (CHECK_RDP = false)"
        payload = @{ disabled = $true; is_server = $true; script_version = $SCRIPT_VERSION }
    } | ConvertTo-Json -Depth 3
    try { Invoke-RestMethod -Uri $HEARTBEAT_URL -Method POST -Headers $headers -Body ([Text.Encoding]::UTF8.GetBytes($disabledBody)) | Out-Null } catch {}
    Write-Log "⏭️ rdp — omitido (CHECK_RDP = false en config.ps1)"
}

# ---------- 4. LOG LOCAL DE PROCESOS (CSV, no va a Supabase) ----------
# Retención: archivos de más de 7 días se eliminan automáticamente
$ProcessLogFile = "$LogDir\processes-$(Get-Date -Format 'yyyy-MM-dd').csv"
Get-ChildItem "$LogDir\processes-*.csv" |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) } |
    Remove-Item -Force

# Top 10 procesos por CPU
try {
    $topCpuProcesses = Get-Process |
        Where-Object { $_.CPU -ne $null } |
        Sort-Object CPU -Descending |
        Select-Object -First 10 `
            @{ Name = 'Timestamp';   Expression = { Get-Date -Format 'yyyy-MM-dd HH:mm:ss' } },
            @{ Name = 'Type';        Expression = { 'cpu' } },
            ProcessName,
            Id,
            @{ Name = 'CPU';         Expression = { [math]::Round($_.CPU, 1) } },
            @{ Name = 'MemoryMB';    Expression = { [math]::Round($_.WorkingSet64 / 1MB, 1) } },
            @{ Name = 'IOReadMB';    Expression = { [math]::Round($_.IOReadBytes / 1MB, 2) } },
            @{ Name = 'IOWriteMB';   Expression = { [math]::Round($_.IOWriteBytes / 1MB, 2) } }

    $topCpuProcesses | Export-Csv $ProcessLogFile -Append -NoTypeInformation -Encoding UTF8
    Write-Log "✅ process-log → Top CPU: $($topCpuProcesses[0].ProcessName) ($($topCpuProcesses[0].CPU)s)"
} catch {
    Write-Log "⚠️ process-log CPU Error: $($_.Exception.Message)"
}

# Top 10 procesos por Disk IO
try {
    $topIOProcesses = Get-Process |
        Sort-Object { $_.IOReadBytes + $_.IOWriteBytes } -Descending |
        Select-Object -First 10 `
            @{ Name = 'Timestamp';   Expression = { Get-Date -Format 'yyyy-MM-dd HH:mm:ss' } },
            @{ Name = 'Type';        Expression = { 'io' } },
            ProcessName,
            Id,
            @{ Name = 'CPU';         Expression = { [math]::Round($_.CPU, 1) } },
            @{ Name = 'MemoryMB';    Expression = { [math]::Round($_.WorkingSet64 / 1MB, 1) } },
            @{ Name = 'IOReadMB';    Expression = { [math]::Round($_.IOReadBytes / 1MB, 2) } },
            @{ Name = 'IOWriteMB';   Expression = { [math]::Round($_.IOWriteBytes / 1MB, 2) } }

    $topIOProcesses | Export-Csv $ProcessLogFile -Append -NoTypeInformation -Encoding UTF8
    Write-Log "✅ process-log → Top IO: $($topIOProcesses[0].ProcessName) (R:$($topIOProcesses[0].IOReadMB)MB W:$($topIOProcesses[0].IOWriteMB)MB)"
} catch {
    Write-Log "⚠️ process-log IO Error: $($_.Exception.Message)"
}


# ---------- Red de seguridad del actualizador ----------
# Si update-scripts.ps1 no corrió en 3 días (tarea programada borrada, deshabilitada o que falla)
# o ni siquiera está, lo baja de GitHub y lo lanza en segundo plano. update-scripts deja su log
# al correr, así que esto no se repite hasta dentro de 3 días.
try {
    $updPath = Join-Path $PSScriptRoot 'update-scripts.ps1'
    $updLog  = Join-Path $PSScriptRoot 'update-scripts.log'
    $lastRun = if (Test-Path $updLog) { (Get-Item $updLog).LastWriteTime } else { $null }
    if (-not $lastRun -or ((Get-Date) - $lastRun).TotalDays -gt 3) {
        if (-not (Test-Path $updPath)) {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/mathcenas/service-catalog/main/scripts/windows/update-scripts.ps1' -OutFile $updPath -UseBasicParsing -ErrorAction Stop
            Write-Log "update-scripts.ps1 no estaba: descargado de GitHub"
        }
        $psExe = if (Get-Command pwsh -ErrorAction SilentlyContinue) { 'pwsh' } else { 'powershell' }
        Start-Process -FilePath $psExe -ArgumentList @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', "`"$updPath`"") -WindowStyle Hidden
        Write-Log "update-scripts no corre hace $(if ($lastRun) { [int]((Get-Date) - $lastRun).TotalDays } else { '?' }) días: lanzado en segundo plano"
    }
} catch { Write-Log "No se pudo lanzar update-scripts: $($_.Exception.Message)" }
