# =============================================================
# Backup-WorkstationVMs.ps1 — Backup nocturno de VMs de VMware Workstation
# Version: 1.1.0
# PowerShell 5.1 compatible. Sin módulos externos.
#
# Configuracion: ..\config.ps1 (compartido con los demás scripts del cliente)
# Variables requeridas en config.ps1: $VM_DEST_ROOT
# Variables opcionales: $VM_VMRUN_PATH, $VM_ROOT_DIR, $VM_RETENTION,
#                       $VM_MIN_FREE_GB, $VM_SUSPEND_TIMEOUT, $VM_LOG_DIR
# Variables de telemetria (ya en config.ps1): $INGEST_URL, $ANON_KEY,
#                       $INGEST_SECRET, $SERVICE_ID
#
# Descubrimiento de VMs (en orden de preferencia):
#   1. $VM_ROOT_DIR configurado → busca *.vmx un nivel adentro  (\<vm>\<vm>.vmx)
#   2. Inventario de VMware Workstation (%APPDATA%\VMware\inventory.vmls)
#
# ACTUALIZAR:
#   Invoke-WebRequest -Uri "https://raw.githubusercontent.com/mathcenas/service-catalog/main/scripts/windows/vmware-backup/Backup-WorkstationVMs.ps1" -OutFile "$PSScriptRoot\Backup-WorkstationVMs.ps1"
#
# Uso:
#   powershell.exe -NonInteractive -ExecutionPolicy Bypass -File "Backup-WorkstationVMs.ps1"
# =============================================================

[CmdletBinding()]
param()

Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
$SCRIPT_VERSION = "1.1.0"

# ---------- Cargar config.ps1 ----------
$configPath = Join-Path $PSScriptRoot "..\config.ps1"
if (-not (Test-Path $configPath)) {
    Write-Error "config.ps1 no encontrado en: $configPath"
    exit 1
}
. $configPath

# Validar mínimo requerido
if (-not $VM_DEST_ROOT) {
    Write-Error "`$VM_DEST_ROOT no está configurado en config.ps1"
    exit 1
}

# ---------- Logging ----------
$logDir = if ($VM_LOG_DIR) { $VM_LOG_DIR } else { "$PSScriptRoot\logs" }
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$runStamp = Get-Date -Format 'yyyyMMdd-HHmm'
$logFile  = "$logDir\backup-${runStamp}.log"

function Write-Log {
    param([string]$Msg, [string]$Level = 'INFO')
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [$Level] $Msg"
    Add-Content -Path $logFile -Value $line -Encoding UTF8
    Write-Host $line
}

# Rotar logs > 30 días
Get-ChildItem "$logDir\backup-*.log" -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
    Remove-Item -Force -ErrorAction SilentlyContinue

Write-Log "=== Backup-WorkstationVMs v$SCRIPT_VERSION | dest=$VM_DEST_ROOT ==="

# ---------- Lock file ----------
$lockFile = "$env:TEMP\vmbackup.lock"
if (Test-Path $lockFile) {
    $lockedPid = (Get-Content $lockFile -ErrorAction SilentlyContinue) -as [int]
    if ($lockedPid -and (Get-Process -Id $lockedPid -ErrorAction SilentlyContinue)) {
        Write-Log "Ya hay una ejecucion en curso (PID $lockedPid). Saliendo." 'WARN'
        exit 0
    }
    Write-Log "Lock de ejecucion anterior (PID $lockedPid ya no existe). Limpiando." 'WARN'
    Remove-Item $lockFile -Force
}
$PID | Out-File $lockFile -Encoding ascii -Force

# ---------- Espacio libre (funciona con UNC) ----------
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

# ---------- vmrun ----------
$vmrun = if ($VM_VMRUN_PATH) { $VM_VMRUN_PATH } else { 'C:\Program Files (x86)\VMware\VMware Workstation\vmrun.exe' }

if (-not (Test-Path $vmrun)) {
    Write-Log "vmrun.exe no encontrado: $vmrun" 'ERROR'
    Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
    exit 1
}

function Get-RunningVMPaths {
    $out = & $vmrun list 2>&1
    @($out | Where-Object { $_ -match '\.vmx' } | ForEach-Object { $_.Trim() })
}

function Test-VMRunning([string]$Vmx) {
    $running = Get-RunningVMPaths
    $norm = $Vmx.ToLower().Replace('/', '\')
    $running | Where-Object { $_.ToLower().Replace('/', '\') -eq $norm }
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

# ---------- Auto-descubrir VMs ----------
function Get-VMList {
    $found = @()

    # Opción 1: directorio raíz configurado → una subcarpeta por VM
    if ($VM_ROOT_DIR -and (Test-Path $VM_ROOT_DIR)) {
        Write-Log "Descubriendo VMs en: $VM_ROOT_DIR"
        $vmxFiles = @(Get-ChildItem $VM_ROOT_DIR -Recurse -Filter '*.vmx' -Depth 2 -ErrorAction SilentlyContinue)
        foreach ($f in $vmxFiles) {
            $found += [PSCustomObject]@{ name = $f.BaseName; vmx = $f.FullName }
        }
        if ($found.Count -gt 0) {
            Write-Log "  $($found.Count) VM(s) encontrada(s) en $VM_ROOT_DIR"
            return $found
        }
        Write-Log "  Ningún .vmx encontrado en $VM_ROOT_DIR — probando inventario." 'WARN'
    }

    # Opción 2: inventario de VMware Workstation
    $inventoryPath = "$env:APPDATA\VMware\inventory.vmls"
    if (Test-Path $inventoryPath) {
        Write-Log "Descubriendo VMs desde inventario: $inventoryPath"
        $content = Get-Content $inventoryPath -Raw -ErrorAction SilentlyContinue
        # Extraer todas las líneas "indexN.filename = ..."
        $matches_ = [regex]::Matches($content, 'index\d+\.filename\s*=\s*"([^"]+\.vmx)"')
        foreach ($m in $matches_) {
            $vmxPath = $m.Groups[1].Value -replace '/', '\'
            if (Test-Path $vmxPath) {
                $found += [PSCustomObject]@{ name = [System.IO.Path]::GetFileNameWithoutExtension($vmxPath); vmx = $vmxPath }
            }
        }
        if ($found.Count -gt 0) {
            Write-Log "  $($found.Count) VM(s) encontrada(s) en inventario"
            return $found
        }
        Write-Log "  Ningún .vmx válido en inventario." 'WARN'
    }

    Write-Log "No se encontraron VMs. Configurar VM_ROOT_DIR en config.ps1 o registrar VMs en VMware Workstation." 'ERROR'
    return $found
}

$vmList = Get-VMList
if ($vmList.Count -eq 0) {
    Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
    exit 1
}

Write-Log "VMs a procesar: $($vmList | ForEach-Object { $_.name } | Sort-Object)"

# ---------- Parámetros operativos ----------
$destRoot          = $VM_DEST_ROOT
$minFreeBytes      = [long](if ($VM_MIN_FREE_GB)      { $VM_MIN_FREE_GB }      else { 20 }) * 1GB
$suspendTimeoutSec = [int] (if ($VM_SUSPEND_TIMEOUT)  { $VM_SUSPEND_TIMEOUT }  else { 600 })
$retentionCopies   = [int] (if ($VM_RETENTION)        { $VM_RETENTION }        else { 3 })

# Nombre del cliente = parte del dominio del servidor o nombre corto del host
$clientTag = $env:COMPUTERNAME

# ---------- Validar destino ANTES de tocar cualquier VM ----------
Write-Log "Verificando destino: $destRoot"
$globalAbort = $false
if (-not (Test-Path $destRoot)) {
    Write-Log "Destino no accesible: $destRoot — abortando sin tocar ninguna VM." 'ERROR'
    $globalAbort = $true
} else {
    $destFree = Get-FreeSpaceBytes $destRoot
    Write-Log "Espacio libre en destino: $([math]::Round($destFree/1GB,1)) GB"
}

# ---------- Procesar cada VM ----------
$allResults = @()

# ---------- Notificación: backup iniciado ----------
if (-not $globalAbort -and $VM_EVENT_URL -and $INGEST_SECRET -and $SERVICE_ID -and $ANON_KEY) {
    $vmNamesJson = '[' + (($vmList | ForEach-Object { """$($_.name)""" }) -join ',') + ']'
    $startBody = "{""service_id"":""$SERVICE_ID"",""event_type"":""vm_maintenance_start"",""host"":""$env:COMPUTERNAME"",""vms"":$vmNamesJson}"
    $notifHeaders = @{
        "Content-Type"    = "application/json; charset=utf-8"
        "apikey"          = $ANON_KEY
        "Authorization"   = "Bearer $ANON_KEY"
        "X-Ingest-Secret" = $INGEST_SECRET
    }
    try {
        Invoke-RestMethod -Uri $VM_EVENT_URL -Method POST -Headers $notifHeaders -Body ([System.Text.Encoding]::UTF8.GetBytes($startBody)) -ErrorAction Stop | Out-Null
        Write-Log "Notificación enviada: backup iniciado ($($vmList.Count) VM(s))"
    } catch {
        Write-Log "WARN: notificación fallida: $_" 'WARN'
    }
}

if (-not $globalAbort) {
    foreach ($vm in $vmList) {
        $vmName = $vm.name
        $vmx    = $vm.vmx
        Write-Log "--- VM: $vmName ($vmx) ---"

        $vmStart    = Get-Date
        $wasRunning = $false
        $vmStatus   = 'failed'
        $vmBytes    = 0L
        $vmDurSec   = 0
        $vmError    = ''
        $destPath   = ''

        try {
            if (-not (Test-Path $vmx)) { throw "VMX no encontrado: $vmx" }

            # 1. Estado inicial
            $wasRunning = [bool](Test-VMRunning $vmx)
            Write-Log "  [$vmName] Estado: $(if ($wasRunning) {'CORRIENDO'} else {'APAGADA'})"

            # 2. Espacio
            $vmDir       = Split-Path $vmx
            $vmSizeBytes = Get-FolderSizeBytes $vmDir
            $required    = $vmSizeBytes + $minFreeBytes
            $destFree    = Get-FreeSpaceBytes $destRoot
            Write-Log "  [$vmName] VM=$([math]::Round($vmSizeBytes/1GB,2))GB libre=$([math]::Round($destFree/1GB,1))GB requerido=$([math]::Round($required/1GB,2))GB"
            if ($destFree -gt 0 -and $destFree -lt $required) {
                throw "Espacio insuficiente: libre=$([math]::Round($destFree/1GB,1))GB requerido=$([math]::Round($required/1GB,2))GB"
            }

            # 3. Suspender si corría
            if ($wasRunning) {
                Write-Log "  [$vmName] Suspendiendo..."
                & $vmrun -T ws suspend $vmx 2>&1 | ForEach-Object { Write-Log "    vmrun: $_" }
                Write-Log "  [$vmName] Esperando suspension (timeout ${suspendTimeoutSec}s)..."
                if (-not (Wait-VMSuspended $vmx $suspendTimeoutSec)) {
                    throw "Timeout esperando suspension de $vmName"
                }
                Write-Log "  [$vmName] Suspendida."
            }

            # 4. Robocopy
            $datestamp = Get-Date -Format 'yyyy-MM-dd_HHmm'
            $destPath  = "$destRoot\$clientTag\$vmName\$datestamp"
            $vmDir     = Split-Path $vmx
            Write-Log "  [$vmName] Copiando: $vmDir -> $destPath"

            $roboArgs = @(
                $vmDir, $destPath,
                '/E', '/COPY:DAT', '/R:2', '/W:5', '/NP', '/NFL', '/NDL', '/MT:8',
                '/XF', '*.lck',
                '/LOG+:' + $logFile
            )
            & robocopy @roboArgs
            $roboExit = $LASTEXITCODE
            if ($roboExit -ge 8) { throw "robocopy fallo con exit code $roboExit" }
            if ($roboExit -ge 4) { Write-Log "  [$vmName] robocopy exit=$roboExit (advertencia)" 'WARN' }

            # 5. Verificar
            $destVmx   = Join-Path $destPath (Split-Path $vmx -Leaf)
            if (-not (Test-Path $destVmx)) { throw "Verificacion: .vmx no encontrado en destino ($destVmx)" }
            $destBytes = Get-FolderSizeBytes $destPath
            $pctDiff   = if ($vmSizeBytes -gt 0) { [math]::Abs($destBytes - $vmSizeBytes) * 100 / $vmSizeBytes } else { 0 }
            if ($pctDiff -gt 5) {
                Write-Log "  [$vmName] Diferencia de tamaño $([math]::Round($pctDiff,1))%" 'WARN'
                $vmStatus = 'warning'
            } else {
                $vmStatus = 'success'
            }
            $vmBytes = $destBytes
            Write-Log "  [$vmName] OK — $([math]::Round($destBytes/1GB,2)) GB copiados"

            # 6. Retención
            $vmDestDir = "$destRoot\$clientTag\$vmName"
            $copies = @(Get-ChildItem $vmDestDir -Directory -ErrorAction SilentlyContinue | Sort-Object Name)
            if ($copies.Count -gt $retentionCopies) {
                $toDelete = $copies | Select-Object -First ($copies.Count - $retentionCopies)
                foreach ($old in $toDelete) {
                    Write-Log "  [$vmName] Eliminando copia antigua: $($old.Name)"
                    Remove-Item $old.FullName -Recurse -Force -ErrorAction SilentlyContinue
                }
            }

        } catch {
            $vmError  = $_.ToString()
            $vmStatus = 'failed'
            Write-Log "  [$vmName] ERROR: $vmError" 'ERROR'
        } finally {
            # Reanudar SIEMPRE si estaba corriendo
            if ($wasRunning) {
                Write-Log "  [$vmName] Reanudando VM..."
                try {
                    & $vmrun -T ws start $vmx nogui 2>&1 | Out-Null
                    if (Wait-VMStarted $vmx) {
                        Write-Log "  [$vmName] VM reanudada."
                    } else {
                        Write-Log "  [$vmName] CRITICO: la VM no aparecio en vmrun list tras 120s!" 'ERROR'
                        $vmStatus = 'critical'
                    }
                } catch {
                    Write-Log "  [$vmName] CRITICO: error al reanudar: $_" 'ERROR'
                    $vmStatus = 'critical'
                }
            }

            $vmDurSec = [int]((Get-Date) - $vmStart).TotalSeconds
            Write-Log "  [$vmName] Fin — status=$vmStatus bytes=$vmBytes dur=${vmDurSec}s"
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

$hasCritical = $allResults | Where-Object { $_.status -eq 'critical' }
$hasFailed   = $allResults | Where-Object { $_.status -eq 'failed' }
$exitCode    = if ($hasCritical) { 2 } elseif ($hasFailed -or $globalAbort) { 1 } else { 0 }

# ---------- Telemetría ----------
if ($INGEST_URL -and $INGEST_SECRET -and $SERVICE_ID -and $ANON_KEY) {
    $rowsJson = @($allResults | ForEach-Object {
        $sizeGB = [math]::Round($_.sizeBytes / 1GB, 2)
        $durMin = [math]::Round($_.durationSeconds / 60, 1)
        "{""job"":""$($_.job)"",""status"":""$($_.status)"",""size"":$sizeGB,""dur"":$durMin}"
    })
    $detailsJson = '[' + ($rowsJson -join ',') + ']'

    $globalStatus = if ($hasCritical -or $hasFailed -or $globalAbort) { 'failed' }
                    elseif ($allResults | Where-Object { $_.status -eq 'warning' }) { 'warning' }
                    else { 'success' }

    $totalBytes = ($allResults | Measure-Object -Property sizeBytes -Sum).Sum
    $totalSec   = ($allResults | Measure-Object -Property durationSeconds -Sum).Sum
    $vmCount    = $allResults.Count
    $jobLabel   = "VMware Workstation — Resumen diario ($vmCount VM$(if ($vmCount -ne 1) {'s'}))"
    $backedUpAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

    $body = "{""service_id"":""$SERVICE_ID"",""job_name"":""$jobLabel"",""status"":""$globalStatus"",""size_bytes"":$totalBytes,""duration_seconds"":$totalSec,""backed_up_at"":""$backedUpAt"",""details"":$(($detailsJson | ConvertTo-Json)),""script_version"":""$SCRIPT_VERSION""}"

    $headers = @{
        "Content-Type"    = "application/json; charset=utf-8"
        "apikey"          = $ANON_KEY
        "Authorization"   = "Bearer $ANON_KEY"
        "X-Ingest-Secret" = $INGEST_SECRET
    }

    try {
        Invoke-RestMethod -Uri $INGEST_URL -Method POST -Headers $headers -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -ErrorAction Stop | Out-Null
        Write-Log "Telemetria enviada: [$globalStatus] $vmCount VM(s)"
    } catch {
        Write-Log "WARN: telemetria fallida: $_" 'WARN'
    }

    Invoke-KumaBackup -Status $(if ($globalStatus -eq 'success') { 'up' } elseif ($globalStatus -eq 'warning') { 'warn' } else { 'down' }) -Msg $jobLabel
} else {
    Write-Log "Telemetria omitida: INGEST_URL / INGEST_SECRET / SERVICE_ID / ANON_KEY no configurados en config.ps1" 'WARN'
}

# ---------- Limpiar lock ----------
Remove-Item $lockFile -Force -ErrorAction SilentlyContinue

Write-Log "=== Fin. Exit code: $exitCode ==="
exit $exitCode
