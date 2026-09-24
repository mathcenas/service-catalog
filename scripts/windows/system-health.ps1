# =============================================================
# system-health.ps1 — Hardware + red + speedtest (opcional)
# Schedulear en Task Scheduler cada 1 hora
# Requiere: config.ps1 en la misma carpeta
#
# ACTUALIZAR (PowerShell, correr como Admin):
#   $dest = "C:\Scripts\system-health.ps1"
#   Invoke-WebRequest -Uri "https://raw.githubusercontent.com/mathcenas/service-catalog/main/scripts/windows/system-health.ps1" -OutFile $dest
# =============================================================

. "$PSScriptRoot\config.ps1"
[System.Net.WebRequest]::DefaultWebProxy = New-Object System.Net.WebProxy

$SCRIPT_VERSION = "1.5.1"

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$OutputEncoding = [System.Text.Encoding]::UTF8

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
Get-ChildItem "$LogDir\system-health-*.log" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-90) } | Remove-Item -Force

$headers = @{
    "Content-Type"    = "application/json"
    "apikey"          = $ANON_KEY
    "Authorization"   = "Bearer $ANON_KEY"
    "X-Ingest-Secret" = $INGEST_SECRET
}

# ---------- 1. HARDWARE (CPU / RAM / Disco C:) ----------
try {
    $cpuObj    = Get-CimInstance Win32_Processor
    $cpuUsage  = ($cpuObj | Measure-Object -Property LoadPercentage -Average).Average
    $cpuName   = ($cpuObj | Select-Object -First 1).Name -replace '\s+', ' '
    $cpuCores  = ($cpuObj | Measure-Object -Property NumberOfCores -Sum).Sum
    $cpuThreads = ($cpuObj | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum

    $os        = Get-CimInstance Win32_OperatingSystem
    $ramUsePct = [math]::Round((($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) / $os.TotalVisibleMemorySize) * 100, 1)
    $ramTotalGB = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)

    $diskC      = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
    $diskUsePct = [math]::Round((($diskC.Size - $diskC.FreeSpace) / $diskC.Size) * 100, 1)
    $diskFreeGB = [math]::Round($diskC.FreeSpace / 1GB, 1)
} catch {
    $cpuUsage = 0; $cpuName = $null; $cpuCores = 0; $cpuThreads = 0
    $ramUsePct = 0; $ramTotalGB = 0; $diskUsePct = 0; $diskFreeGB = 0
}

$hwStatus = if   ($diskUsePct -gt 90 -or $ramUsePct -gt 92 -or $cpuUsage -gt 95) { "failed" }
            elseif ($diskUsePct -gt 75 -or $ramUsePct -gt 80 -or $cpuUsage -gt 80) { "warning" }
            else { "success" }

# ---------- SMART (salud de discos físicos) ----------
$CHECK_SMART = if (
    Get-Variable 'CHECK_SMART' -ErrorAction SilentlyContinue
) { $CHECK_SMART } else { $true }

$diskSmartList = @()

if (-not $CHECK_SMART) {

    Write-Log "⏭️ SMART — omitido (CHECK_SMART = false en config.ps1)"

} else {

    try {

        $physDisks = Get-PhysicalDisk -ErrorAction Stop

        foreach ($pd in $physDisks) {

            if ($pd.BusType -eq 'NVMe') { $devType = 'NVMe' }
            elseif ($pd.MediaType -eq 'SSD') { $devType = 'SSD' }
            elseif ($pd.MediaType -eq 'HDD') { $devType = 'HDD' }
            else { $devType = [string]$pd.MediaType }

            $smartStatus = [string]$pd.HealthStatus
            $opStatus    = [string]$pd.OperationalStatus

            $tempC       = $null
            $pohours     = $null
            $readErrors  = $null
            $writeErrors = $null
            $wearLevel   = $null

            try {
                $rel = Get-StorageReliabilityCounter `
                    -PhysicalDisk $pd `
                    -ErrorAction Stop

                if ($null -ne $rel.Temperature -and $rel.Temperature -gt 0) {
                    $tempC = [int]$rel.Temperature
                }
                if ($null -ne $rel.PowerOnHours) {
                    $pohours = [int]$rel.PowerOnHours
                }
                if ($null -ne $rel.ReadErrorsUncorrected) {
                    $readErrors = [int]$rel.ReadErrorsUncorrected
                }
                if ($null -ne $rel.WriteErrorsUncorrected) {
                    $writeErrors = [int]$rel.WriteErrorsUncorrected
                }
                if ($null -ne $rel.Wear -and $rel.Wear -ge 0) {
                    $wearLevel = [int]$rel.Wear
                }
            } catch {}

            $capGB  = if ($pd.Size -gt 0) { [math]::Round($pd.Size / 1GB, 0) } else { $null }
            $capStr = if ($capGB) { "${capGB} GB" } else { "" }

            switch ($smartStatus) {
                'Healthy'   { $dStatus = 'ok' }
                'Warning'   { $dStatus = 'warning' }
                'Unhealthy' { $dStatus = 'error' }
                default     { $dStatus = 'warning' }
            }

            if ($null -ne $tempC) {
                if ($tempC -gt 65) { $dStatus = 'error' }
                elseif ($tempC -gt 55 -and $dStatus -eq 'ok') { $dStatus = 'warning' }
            }
            if ($null -ne $wearLevel) {
                if ($wearLevel -gt 90) { $dStatus = 'error' }
                elseif ($wearLevel -gt 75 -and $dStatus -eq 'ok') { $dStatus = 'warning' }
            }

            $uncorrectableErrors = 0
            if ($null -ne $readErrors)  { $uncorrectableErrors += $readErrors }
            if ($null -ne $writeErrors) { $uncorrectableErrors += $writeErrors }
            if ($uncorrectableErrors -gt 0 -and $dStatus -eq 'ok') { $dStatus = 'warning' }

            if ($dStatus -eq 'warning' -and $hwStatus -eq 'success') { $hwStatus = 'warning' }
            if ($dStatus -eq 'error') { $hwStatus = 'failed' }

            $diskSmartList += @{
                dev                  = [string]$pd.DeviceId
                type                 = $devType
                model                = [string]$pd.FriendlyName
                serial               = [string]$pd.SerialNumber
                capacity             = $capStr
                smart_health         = $smartStatus
                operational_status   = $opStatus
                status               = $dStatus
                temp_c               = $tempC
                power_on_hours       = $pohours
                pct_used             = $wearLevel
                read_uncorrectable   = $readErrors
                write_uncorrectable  = $writeErrors
                uncorrectable_errors = $uncorrectableErrors
            }
        }

    } catch {
        Write-Log "⚠️ SMART: $($_.Exception.Message)"
    }
} # end CHECK_SMART

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
            $sizeGB  = if ($vd.Size      -gt 0) { [math]::Round($vd.Size      / 1GB, 1) } else { $null }
            $allocGB = if ($vd.FootprintOnPool -gt 0) { [math]::Round($vd.FootprintOnPool / 1GB, 1) } else { $null }
            $raidList += @{
                pool             = $pool.FriendlyName
                name             = $vd.FriendlyName
                resiliency       = $vd.ResiliencySettingName   # Mirror / Parity / Simple
                health           = $vd.HealthStatus
                operational      = $vd.OperationalStatus
                status           = $rStatus
                size_gb          = $sizeGB
                allocated_gb     = $allocGB
            }
        }
    }
} catch {}

$hwBody = @{
    service_id = $SERVICE_ID
    source     = "system-health"
    status     = $hwStatus
    message    = "CPU: $cpuUsage% | RAM: $ramUsePct% | Disk C: $diskUsePct%"
    payload    = @{
        cpu_pct        = $cpuUsage
        cpu_name       = $cpuName
        cpu_cores      = $cpuCores
        cpu_threads    = $cpuThreads
        ram_pct        = $ramUsePct
        ram_total_gb   = $ramTotalGB
        disk_pct       = $diskUsePct
        disk_free_gb   = $diskFreeGB
        disk_smart     = $diskSmartList
        disk_raid      = $raidList
        script_version = $SCRIPT_VERSION
    }
} | ConvertTo-Json -Depth 5

try {
    Invoke-RestMethod -Uri $HEARTBEAT_URL -Method POST -Headers $headers -Body $hwBody | Out-Null
    Write-Log "✅ system-health → $hwStatus | CPU: $cpuUsage% | RAM: $ramUsePct% | Disk: $diskUsePct%"
} catch {
    Write-Log "❌ system-health Error: $($_.Exception.Message)"
}

# ---------- 2. RED (ping + speedtest) ----------
$targetHost = "1.1.1.1"
$pingCount  = 5

$pingResult = Test-Connection `
    -ComputerName $targetHost `
    -Count $pingCount `
    -ErrorAction SilentlyContinue

if ($pingResult) {
    $received   = @($pingResult).Count
    $packetLoss = [math]::Round((($pingCount - $received) / $pingCount) * 100, 1)
    $avgPing    = [math]::Round(
        ($pingResult | Measure-Object -Property ResponseTime -Average).Average, 1)
} else {
    $packetLoss = 100
    $avgPing    = 0
}

# Speedtest (opcional — requiere speedtest.exe en la misma carpeta)
$CHECK_SPEEDTEST = if (
    Get-Variable 'CHECK_SPEEDTEST' -ErrorAction SilentlyContinue
) { $CHECK_SPEEDTEST } else { $true }

$downloadMbps  = 0
$uploadMbps    = 0
$speedtestPath = "$PSScriptRoot\speedtest.exe"

if ($CHECK_SPEEDTEST -and (Test-Path $speedtestPath)) {
    try {
        $speedData    = & $speedtestPath --format=json --accept-license --accept-gdpr 2>$null | ConvertFrom-Json
        $downloadMbps = [math]::Round($speedData.download.bandwidth / 125000, 1)
        $uploadMbps   = [math]::Round($speedData.upload.bandwidth / 125000, 1)
    } catch {}
}

if ($CHECK_SPEEDTEST) {

    # Determinar disponibilidad de ICMP y evaluación de calidad
    $icmpAvailable  = ($packetLoss -lt 100)
    $speedAvailable = ($downloadMbps -gt 0)

    if (!$icmpAvailable -and !$speedAvailable) {
        $netStatus = "failed"
        $quality   = "offline"
    } elseif (!$icmpAvailable -and $speedAvailable) {
        # ICMP bloqueado por firewall pero internet funciona — no es falla real
        $netStatus = "success"
        $quality   = "good"
    } elseif ($packetLoss -gt 15 -or $avgPing -gt 150) {
        $netStatus = "warning"
        $quality   = "degraded"
    } elseif ($packetLoss -gt 0 -or $avgPing -gt 80) {
        $netStatus = "warning"
        $quality   = "fair"
    } else {
        $netStatus = "success"
        $quality   = "good"
    }

    $netPayload = @{
        ping_ms         = $avgPing
        packet_loss_pct = $packetLoss
        quality         = $quality
        icmp_available  = $icmpAvailable
    }
    if ($downloadMbps -gt 0) {
        $netPayload.download_mbps = $downloadMbps
        $netPayload.upload_mbps   = $uploadMbps
    }

    if (!$icmpAvailable -and $speedAvailable) {
        $netMsg = "Quality: $quality | ICMP: unavailable | Down: ${downloadMbps} Mbps | Up: ${uploadMbps} Mbps"
    } else {
        $netMsg = "Quality: $quality | Ping: ${avgPing}ms | Loss: ${packetLoss}%"
        if ($downloadMbps -gt 0) { $netMsg += " | Down: ${downloadMbps} Mbps | Up: ${uploadMbps} Mbps" }
    }

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
} else {
    $disabledBody = @{
        service_id = $SERVICE_ID; source = "speedtest"; status = "success"
        message = "Deshabilitado (CHECK_SPEEDTEST = false)"
        payload = @{ disabled = $true; script_version = $SCRIPT_VERSION }
    } | ConvertTo-Json -Depth 3
    try { Invoke-RestMethod -Uri $HEARTBEAT_URL -Method POST -Headers $headers -Body $disabledBody | Out-Null } catch {}
    Write-Log "⏭️ speedtest — omitido (CHECK_SPEEDTEST = false en config.ps1)"
}

# ---------- 3. Servicios de acceso remoto (RDP + AnyDesk) ----------

$CHECK_RDP = if (Get-Variable 'CHECK_RDP' -ErrorAction SilentlyContinue) { $CHECK_RDP } else { $true }

if ($CHECK_RDP) {
    # AnyDesk — leer ID
    $anydeskId = $null
    try {
        $anydeskId = (Get-ItemProperty -Path "HKLM:\SOFTWARE\AnyDesk" -Name "ad_id" -ErrorAction Stop).ad_id
    } catch {
        $confPath = "$env:ProgramData\AnyDesk\service.conf"
        if (Test-Path $confPath) {
            $adLine = Get-Content $confPath | Where-Object { $_ -match '^ad\.anynet\.id=' }
            if ($adLine) { $anydeskId = ($adLine -replace '^ad\.anynet\.id=', '').Trim() }
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

    # RDP — verificar TermService + puerto
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

    $rdpStatus = if   ($rdpSvcStatus -ne 'Running' -or -not $rdpListening) { "failed" }
                 elseif ($rdpRestarted)                                      { "warning" }
                 else                                                         { "success" }

    $rdpMsg = "TermService: $rdpSvcStatus | Puerto 3389: $(if ($rdpListening) {'escuchando'} else {'cerrado'})"
    if ($rdpRestarted) { $rdpMsg += " | AUTO-REINICIADO" }

    $rdpBody = @{
        service_id = $SERVICE_ID
        source     = "rdp"
        status     = $rdpStatus
        message    = $rdpMsg
        payload    = @{
            service_status   = $rdpSvcStatus
            port_listening   = $rdpListening
            auto_restarted   = $rdpRestarted
            anydesk_id       = $anydeskId
            anydesk_status   = $adStatus
            script_version   = $SCRIPT_VERSION
        }
    } | ConvertTo-Json -Depth 3

    try {
        Invoke-RestMethod -Uri $HEARTBEAT_URL -Method POST -Headers $headers -Body $rdpBody | Out-Null
        $icon = if ($rdpStatus -eq 'failed') {'❌'} elseif ($rdpStatus -eq 'warning') {'⚠️'} else {'✅'}
        Write-Log "$icon rdp → $rdpStatus | $rdpMsg"
    } catch {
        Write-Log "❌ rdp Error: $($_.Exception.Message)"
    }
} else {
    $disabledBody = @{
        service_id = $SERVICE_ID; source = "rdp"; status = "success"
        message = "Deshabilitado (CHECK_RDP = false)"
        payload = @{ disabled = $true; script_version = $SCRIPT_VERSION }
    } | ConvertTo-Json -Depth 3
    try { Invoke-RestMethod -Uri $HEARTBEAT_URL -Method POST -Headers $headers -Body $disabledBody | Out-Null } catch {}
    Write-Log "⏭️ rdp — omitido (CHECK_RDP = false en config.ps1)"
}

Invoke-KumaHealth -Status "up" -Msg "system-health OK"
