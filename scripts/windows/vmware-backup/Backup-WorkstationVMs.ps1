# =============================================================
# Backup-WorkstationVMs.ps1 — Backup nocturno de VMs de VMware Workstation
# Version: 1.0.0
# PowerShell 5.1 compatible. Sin módulos externos.
#
# ACTUALIZAR:
#   Invoke-WebRequest -Uri "https://raw.githubusercontent.com/mathcenas/service-catalog/main/scripts/windows/vmware-backup/Backup-WorkstationVMs.ps1" -OutFile "$PSScriptRoot\Backup-WorkstationVMs.ps1"
#
# Uso:
#   powershell.exe -NonInteractive -ExecutionPolicy Bypass -File "Backup-WorkstationVMs.ps1"
#   powershell.exe -NonInteractive -ExecutionPolicy Bypass -File "Backup-WorkstationVMs.ps1" -Config "D:\Scripts\backup-config.json"
# =============================================================

[CmdletBinding()]
param(
    [string]$Config = "$PSScriptRoot\backup-config.json"
)

Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
$SCRIPT_VERSION = "1.0.0"

# ---------- Cargar config ----------
if (-not (Test-Path $Config)) {
    Write-Error "Archivo de configuracion no encontrado: $Config"
    exit 1
}
try {
    $cfg = Get-Content $Config -Raw | ConvertFrom-Json
} catch {
    Write-Error "Error al parsear ${Config}: $_"
    exit 1
}

# ---------- Logging ----------
$logDir = if ($cfg.logPath) { $cfg.logPath } else { "$PSScriptRoot\logs" }
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$runStamp = Get-Date -Format 'yyyyMMdd-HHmm'
$logFile  = "$logDir\backup-${runStamp}.log"

function Write-Log {
    param([string]$Msg, [string]$Level = 'INFO')
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [$Level] $Msg"
    Add-Content -Path $logFile -Value $line -Encoding UTF8
    Write-Host $line
}

# Rotar logs > 30 dias
Get-ChildItem "$logDir\backup-*.log" -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
    Remove-Item -Force -ErrorAction SilentlyContinue

Write-Log "=== Backup-WorkstationVMs v$SCRIPT_VERSION | cliente=$($cfg.client) host=$($cfg.host) ==="

# ---------- Lock file (evitar ejecuciones simultaneas) ----------
$lockFile = "$env:TEMP\vmbackup-$($cfg.client).lock"
if (Test-Path $lockFile) {
    $lockedPid = (Get-Content $lockFile -ErrorAction SilentlyContinue) -as [int]
    if ($lockedPid -and (Get-Process -Id $lockedPid -ErrorAction SilentlyContinue)) {
        Write-Log "Ya hay una ejecucion en curso (PID $lockedPid). Saliendo." 'WARN'
        exit 0
    }
    Write-Log "Lock de ejecucion anterior encontrado (PID $lockedPid ya no existe). Limpiando." 'WARN'
    Remove-Item $lockFile -Force
}
$PID | Out-File $lockFile -Encoding ascii -Force

# ---------- Funcion: espacio libre (funciona con UNC) ----------
# Agrega el tipo solo una vez por proceso
if (-not ([System.Management.Automation.PSTypeName]'WinDiskFree').Type) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class WinDiskFree {
    [DllImport("kernel32.dll", CharSet=CharSet.Auto, SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetDiskFreeSpaceEx(
        string lpPath,
        out ulong lpFreeBytesAvailable,
        out ulong lpTotalBytes,
        out ulong lpTotalFreeBytes);
}
'@ -ErrorAction SilentlyContinue
}

function Get-FreeSpaceBytes([string]$Path) {
    [ulong]$free = 0; [ulong]$total = 0; [ulong]$tfree = 0
    if ([WinDiskFree]::GetDiskFreeSpaceEx($Path, [ref]$free, [ref]$total, [ref]$tfree)) {
        return [long]$free
    }
    return -1L
}

function Get-FolderSizeBytes([string]$Path) {
    $total = 0L
    Get-ChildItem $Path -Recurse -File -ErrorAction SilentlyContinue |
        ForEach-Object { $total += $_.Length }
    return $total
}

# ---------- Funciones vmrun ----------
$vmrun = if ($cfg.vmrunPath) { $cfg.vmrunPath } else { 'C:\Program Files (x86)\VMware\VMware Workstation\vmrun.exe' }

function Get-RunningVMPaths {
    $out = & $vmrun list 2>&1
    @($out | Where-Object { $_ -match '\.vmx' } | ForEach-Object { $_.Trim() })
}

function Test-VMRunning([string]$Vmx) {
    $running = Get-RunningVMPaths
    $normalVmx = $Vmx.ToLower().Replace('/', '\')
    $running | Where-Object { $_.ToLower().Replace('/', '\') -eq $normalVmx }
}

function Wait-VMSuspended([string]$Vmx, [int]$TimeoutSec) {
    $vmDir    = Split-Path $Vmx
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $stillUp = Test-VMRunning $Vmx
        $locks   = @(Get-ChildItem "$vmDir\*.lck" -ErrorAction SilentlyContinue)
        if (-not $stillUp -and $locks.Count -eq 0) { return $true }
        Start-Sleep -Seconds 10
    }
    return $false
}

function Wait-VMStarted([string]$Vmx, [int]$TimeoutSec = 120) {
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if (Test-VMRunning $Vmx) { return $true }
        Start-Sleep -Seconds 10
    }
    return $false
}

# ---------- Validar vmrun ----------
if (-not (Test-Path $vmrun)) {
    Write-Log "vmrun.exe no encontrado: $vmrun" 'ERROR'
    Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
    exit 1
}

# ---------- Validar destino ANTES de tocar cualquier VM ----------
$destRoot          = $cfg.destinationRoot
$minFreeBytes      = [long]$cfg.minFreeSpaceMarginGB * 1GB
$suspendTimeoutSec = if ($cfg.suspendTimeoutSec) { [int]$cfg.suspendTimeoutSec } else { 600 }
$retentionCopies   = if ($cfg.retentionCopies) { [int]$cfg.retentionCopies } else { 3 }

Write-Log "Verificando destino: $destRoot"
if (-not (Test-Path $destRoot)) {
    Write-Log "Destino no accesible: $destRoot — abortando sin tocar ninguna VM." 'ERROR'
    # Telemetria de fallo global
    $allResults = @($cfg.vms | ForEach-Object {
        [PSCustomObject]@{ job = $_.name; status = 'failed'; sizeBytes = 0L; durationSeconds = 0 }
    })
    # (se reporta al final del bloque try)
    $globalAbort = $true
} else {
    $globalAbort = $false
    $destFree = Get-FreeSpaceBytes $destRoot
    Write-Log "Espacio libre en destino: $([math]::Round($destFree/1GB,1)) GB"
}

# ---------- Procesar cada VM ----------
$allResults = @()

if (-not $globalAbort) {
    foreach ($vm in $cfg.vms) {
        $vmName = $vm.name
        $vmx    = $vm.vmx
        Write-Log "--- VM: $vmName ---"

        $vmStart    = Get-Date
        $wasRunning = $false
        $vmStatus   = 'failed'
        $vmBytes    = 0L
        $vmDurSec   = 0
        $vmError    = ''
        $destPath   = ''

        try {
            # 0. Validar vmx existe
            if (-not (Test-Path $vmx)) {
                throw "VMX no encontrado: $vmx"
            }

            # 0b. VM encriptada sin password configurado → saltar
            $encEnv = $vm.encryptionPasswordEnv
            $vmPass = $null
            if ($encEnv) {
                $vmPass = [System.Environment]::GetEnvironmentVariable($encEnv, 'Machine')
                if (-not $vmPass) {
                    Write-Log "  [$vmName] Variable de entorno '$encEnv' no encontrada — saltando VM." 'WARN'
                    $vmStatus = 'skipped'
                    $vmError  = "encryptionPasswordEnv '$encEnv' no encontrada"
                    continue
                }
            }

            # 1. Estado inicial
            $wasRunning = [bool](Test-VMRunning $vmx)
            Write-Log "  [$vmName] Estado inicial: $(if ($wasRunning) {'CORRIENDO'} else {'APAGADA'})"

            # 2. Chequeo de espacio
            $vmDir       = Split-Path $vmx
            $vmSizeBytes = Get-FolderSizeBytes $vmDir
            $required    = $vmSizeBytes + $minFreeBytes
            $destFree    = Get-FreeSpaceBytes $destRoot
            Write-Log "  [$vmName] Tamaño VM: $([math]::Round($vmSizeBytes/1GB,2)) GB | Libre destino: $([math]::Round($destFree/1GB,1)) GB | Requerido (con margen): $([math]::Round($required/1GB,2)) GB"
            if ($destFree -gt 0 -and $destFree -lt $required) {
                throw "Espacio insuficiente en destino: libre=$([math]::Round($destFree/1GB,1))GB requerido=$([math]::Round($required/1GB,2))GB"
            }

            # 3. Suspender si estaba corriendo
            $suspendStart = Get-Date
            if ($wasRunning) {
                Write-Log "  [$vmName] Suspendiendo..."
                if ($vmPass) {
                    & $vmrun -T ws -vp $vmPass suspend $vmx 2>&1 | ForEach-Object { Write-Log "    vmrun: $_" }
                } else {
                    & $vmrun -T ws suspend $vmx 2>&1 | ForEach-Object { Write-Log "    vmrun: $_" }
                }
                Write-Log "  [$vmName] Esperando suspension completa (timeout ${suspendTimeoutSec}s)..."
                if (-not (Wait-VMSuspended $vmx $suspendTimeoutSec)) {
                    throw "Timeout esperando suspension de $vmName"
                }
                $suspendSec = [int]((Get-Date) - $suspendStart).TotalSeconds
                Write-Log "  [$vmName] Suspendida en ${suspendSec}s"
            }

            # 4. Copiar con robocopy
            $datestamp  = Get-Date -Format 'yyyy-MM-dd_HHmm'
            $destPath   = "$destRoot\$($cfg.client)\$vmName\$datestamp"
            $vmDir      = Split-Path $vmx
            Write-Log "  [$vmName] Copiando: $vmDir -> $destPath"

            $roboArgs = @(
                $vmDir, $destPath,
                '/E', '/COPY:DAT', '/R:2', '/W:5', '/NP', '/NFL', '/NDL', '/MT:8',
                '/XF', '*.lck',
                '/LOG+:' + $logFile
            )
            & robocopy @roboArgs
            $roboExit = $LASTEXITCODE

            if ($roboExit -ge 8) {
                throw "robocopy fallo con exit code $roboExit"
            }
            if ($roboExit -ge 4) {
                Write-Log "  [$vmName] robocopy exit=$roboExit (advertencia — archivos distintos en destino, no es un error)" 'WARN'
            }

            # 5. Verificar
            $destVmx = Join-Path $destPath (Split-Path $vmx -Leaf)
            if (-not (Test-Path $destVmx)) {
                throw "Verificacion fallida: .vmx no encontrado en destino ($destVmx)"
            }
            $destBytes = Get-FolderSizeBytes $destPath
            $pctDiff   = if ($vmSizeBytes -gt 0) { [math]::Abs($destBytes - $vmSizeBytes) * 100 / $vmSizeBytes } else { 0 }
            if ($pctDiff -gt 5) {
                Write-Log "  [$vmName] ADVERTENCIA: diferencia de tamanio $([math]::Round($pctDiff,1))% (origen=$([math]::Round($vmSizeBytes/1GB,2))GB destino=$([math]::Round($destBytes/1GB,2))GB)" 'WARN'
                $vmStatus = 'warning'
            } else {
                $vmStatus = 'success'
            }
            $vmBytes  = $destBytes
            Write-Log "  [$vmName] Copia verificada OK ($([math]::Round($destBytes/1GB,2)) GB)"

            # 7. Retencion (solo si la copia verifico OK)
            $clientDestDir = "$destRoot\$($cfg.client)\$vmName"
            $copies = @(Get-ChildItem $clientDestDir -Directory -ErrorAction SilentlyContinue |
                Sort-Object Name)
            if ($copies.Count -gt $retentionCopies) {
                $toDelete = $copies | Select-Object -First ($copies.Count - $retentionCopies)
                foreach ($old in $toDelete) {
                    Write-Log "  [$vmName] Eliminando copia antigua: $($old.FullName)"
                    Remove-Item $old.FullName -Recurse -Force -ErrorAction SilentlyContinue
                }
            }

        } catch {
            $vmError  = $_.ToString()
            $vmStatus = 'failed'
            Write-Log "  [$vmName] ERROR: $vmError" 'ERROR'
        } finally {
            # 6. Reanudar SIEMPRE si estaba corriendo (incluso si la copia fallo)
            if ($wasRunning) {
                Write-Log "  [$vmName] Reanudando VM..."
                try {
                    if ($vmPass) {
                        & $vmrun -T ws -vp $vmPass start $vmx nogui 2>&1 | Out-Null
                    } else {
                        & $vmrun -T ws start $vmx nogui 2>&1 | Out-Null
                    }
                    if (Wait-VMStarted $vmx) {
                        Write-Log "  [$vmName] VM reanudada correctamente."
                    } else {
                        Write-Log "  [$vmName] CRITICO: la VM no volvio a aparecer en vmrun list despues de 120s!" 'ERROR'
                        $vmStatus = 'critical'
                    }
                } catch {
                    Write-Log "  [$vmName] CRITICO: error al reanudar la VM: $_" 'ERROR'
                    $vmStatus = 'critical'
                }
            }

            $vmDurSec = [int]((Get-Date) - $vmStart).TotalSeconds
            Write-Log "  [$vmName] Finalizado — status=$vmStatus bytes=$vmBytes duracion=${vmDurSec}s"
        }

        $allResults += [PSCustomObject]@{
            job             = $vmName
            status          = $vmStatus
            sizeBytes       = $vmBytes
            durationSeconds = $vmDurSec
            error           = $vmError
            destination     = $destPath
        }
    }
}

# ---------- Resumen ----------
Write-Log "=== RESUMEN ==="
foreach ($r in $allResults) {
    Write-Log "  $($r.job): $($r.status) | $([math]::Round($r.sizeBytes/1GB,2)) GB | $($r.durationSeconds)s$(if ($r.error) {' | ' + $r.error})"
}

# Exit code
$hasCritical = $allResults | Where-Object { $_.status -eq 'critical' }
$hasFailed   = $allResults | Where-Object { $_.status -eq 'failed' }
$exitCode    = if ($hasCritical) { 2 } elseif ($hasFailed -or $globalAbort) { 1 } else { 0 }

# ---------- Telemetria (ingest-backup, mismo formato que Cobian/backup.sh) ----------
$telCfg = $cfg.telemetry
if ($telCfg -and $telCfg.enabled) {
    $serviceId  = [System.Environment]::GetEnvironmentVariable($telCfg.serviceIdEnv, 'Machine')
    $secret     = [System.Environment]::GetEnvironmentVariable($telCfg.secretEnv, 'Machine')
    $anonKey    = [System.Environment]::GetEnvironmentVariable($telCfg.anonKeyEnv, 'Machine')
    $ingestUrl  = $telCfg.ingestUrl

    if ($serviceId -and $secret -and $anonKey -and $ingestUrl) {
        # Construir array JSON de VMs manualmente (PS 5.1: -AsArray no existe)
        $rowsJson = @($allResults | ForEach-Object {
            $sizeGB = [math]::Round($_.sizeBytes / 1GB, 2)
            $durMin = [math]::Round($_.durationSeconds / 60, 1)
            "{""job"":""$($_.job)"",""status"":""$($_.status)"",""size"":$sizeGB,""dur"":$durMin}"
        })
        $detailsJson = '[' + ($rowsJson -join ',') + ']'

        $globalStatus = if ($hasCritical) { 'failed' }
                        elseif ($hasFailed -or $globalAbort) { 'failed' }
                        elseif ($allResults | Where-Object { $_.status -eq 'warning' }) { 'warning' }
                        else { 'success' }

        $totalBytes   = ($allResults | Measure-Object -Property sizeBytes -Sum).Sum
        $totalSec     = ($allResults | Measure-Object -Property durationSeconds -Sum).Sum
        $backedUpAt   = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        $vmCount      = $allResults.Count
        $jobLabel     = "VMware Workstation — Resumen diario ($vmCount VM$(if ($vmCount -ne 1) {'s'}))"

        $body = "{
  ""service_id"": ""$serviceId"",
  ""job_name"": ""$jobLabel"",
  ""status"": ""$globalStatus"",
  ""size_bytes"": $totalBytes,
  ""duration_seconds"": $totalSec,
  ""backed_up_at"": ""$backedUpAt"",
  ""details"": $(($detailsJson | ConvertTo-Json)),
  ""script_version"": ""$SCRIPT_VERSION""
}"

        $headers = @{
            "Content-Type"    = "application/json; charset=utf-8"
            "apikey"          = $anonKey
            "Authorization"   = "Bearer $anonKey"
            "X-Ingest-Secret" = $secret
        }

        try {
            Invoke-RestMethod -Uri $ingestUrl -Method POST -Headers $headers -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -ErrorAction Stop | Out-Null
            Write-Log "Telemetria enviada: [$globalStatus] $vmCount VM(s)"
        } catch {
            Write-Log "WARN: no se pudo enviar telemetria: $_" 'WARN'
        }
    } else {
        Write-Log "Telemetria omitida: variables de entorno incompletas (serviceIdEnv=$($telCfg.serviceIdEnv) secretEnv=$($telCfg.secretEnv))" 'WARN'
    }
}

# ---------- Limpiar lock ----------
Remove-Item $lockFile -Force -ErrorAction SilentlyContinue

Write-Log "=== Fin. Exit code: $exitCode ==="
exit $exitCode
