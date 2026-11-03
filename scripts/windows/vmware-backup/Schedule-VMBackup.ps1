# =============================================================
# Schedule-VMBackup.ps1 — Pre-programador del backup de VMs
# Version: 1.0.0
# PowerShell 5.1 compatible.
#
# Corre una vez por noche (ej: 22:00). Mide el tamaño actual de
# las VMs, estima cuánto tardará el backup y reprograma la tarea
# "VMware Workstation Backup - Nocturno" para que termine antes
# de $VM_FINISH_BY (configurado en config.ps1).
#
# Si el tiempo calculado ya pasó (ej: corre muy tarde), programa
# el backup para la misma noche de todos modos con un aviso.
# =============================================================

[CmdletBinding()]
param(
    [string]$TaskName = "VMware Workstation Backup - Nocturno"
)

Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
$SCRIPT_VERSION = "1.0.0"

# ---------- Config ----------
$configPath = Join-Path $PSScriptRoot "..\config.ps1"
if (-not (Test-Path $configPath)) { Write-Error "config.ps1 no encontrado: $configPath"; exit 1 }
. $configPath

$logDir = if ($VM_LOG_DIR) { $VM_LOG_DIR } else { "$PSScriptRoot\logs" }
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$logFile = "$logDir\schedule-$(Get-Date -Format 'yyyy-MM').log"

function Write-Log([string]$Msg, [string]$Level = 'INFO') {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [$Level] $Msg"
    Add-Content $logFile $line -Encoding UTF8
    Write-Host $line
}

Write-Log "=== Schedule-VMBackup v$SCRIPT_VERSION ==="

# ---------- Parámetros de cálculo ----------
$finishByStr   = if ($VM_FINISH_BY)       { $VM_FINISH_BY }       else { "06:30" }
$throughputMBs = if ($VM_THROUGHPUT_MBPS) { [double]$VM_THROUGHPUT_MBPS } else { 100 }

# Tiempo de suspensión estimado por VM (segundos). Conservador: asume todas corriendo.
$suspendEstSec  = 90
# Buffer de seguridad al final (minutos)
$bufferMin      = 15

# ---------- Descubrir VMs y medir tamaños ----------
function Get-VMList {
    $found = @()
    if ($VM_ROOT_DIR -and (Test-Path $VM_ROOT_DIR)) {
        $vmxFiles = @(Get-ChildItem $VM_ROOT_DIR -Recurse -Filter '*.vmx' -Depth 2 -ErrorAction SilentlyContinue)
        foreach ($f in $vmxFiles) { $found += [PSCustomObject]@{ name = $f.BaseName; vmx = $f.FullName } }
        if ($found.Count -gt 0) { return $found }
    }
    $inv = "$env:APPDATA\VMware\inventory.vmls"
    if (Test-Path $inv) {
        $content = Get-Content $inv -Raw -ErrorAction SilentlyContinue
        $ms = [regex]::Matches($content, 'index\d+\.filename\s*=\s*"([^"]+\.vmx)"')
        foreach ($m in $ms) {
            $p = $m.Groups[1].Value -replace '/', '\'
            if (Test-Path $p) { $found += [PSCustomObject]@{ name = [System.IO.Path]::GetFileNameWithoutExtension($p); vmx = $p } }
        }
    }
    return $found
}

function Get-FolderSizeBytes([string]$Path) {
    $total = 0L
    Get-ChildItem $Path -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object { $total += $_.Length }
    return $total
}

$vmList = Get-VMList
if ($vmList.Count -eq 0) {
    Write-Log "No se encontraron VMs — no se reprogramará la tarea." 'WARN'
    exit 0
}

Write-Log "VMs encontradas: $($vmList.Count)"

$totalBytes = 0L
foreach ($vm in $vmList) {
    $dir   = Split-Path $vm.vmx
    $bytes = Get-FolderSizeBytes $dir
    $gb    = [math]::Round($bytes / 1GB, 2)
    Write-Log "  $($vm.name): $gb GB"
    $totalBytes += $bytes
}

$totalGB = [math]::Round($totalBytes / 1GB, 2)
Write-Log "Tamaño total: $totalGB GB"

# ---------- Estimar duración ----------
# Copia: totalBytes / throughput
$copySec     = if ($throughputMBs -gt 0) { [int]($totalBytes / ($throughputMBs * 1MB)) } else { 1800 }
# Suspensión: una por VM, secuencial
$suspendSec  = $vmList.Count * $suspendEstSec
# Buffer
$bufferSec   = $bufferMin * 60
# Total con 20% de margen adicional para variaciones reales
$estimatedSec = [int](($copySec + $suspendSec + $bufferSec) * 1.2)
$estimatedMin = [math]::Round($estimatedSec / 60, 0)

Write-Log "Estimacion: copia=${copySec}s + suspend=${suspendSec}s + buffer=${bufferSec}s + 20% margen = ${estimatedMin} min totales"

# ---------- Calcular hora de inicio ----------
$today      = Get-Date -Format 'yyyy-MM-dd'
$finishTime = [datetime]"$today $finishByStr"

# Si VM_FINISH_BY ya pasó hoy, usar mañana
if ($finishTime -lt (Get-Date)) {
    $finishTime = $finishTime.AddDays(1)
}

$startTime = $finishTime.AddSeconds(-$estimatedSec)

# Protección: no arrancar antes de las 00:00 del mismo día (caso extremo de VMs muy grandes)
$midnight = [datetime]"$($finishTime.ToString('yyyy-MM-dd')) 00:00"
if ($startTime -lt $midnight) {
    Write-Log "ADVERTENCIA: la estimacion ($estimatedMin min) supera la ventana nocturna disponible. Programando a las 00:00." 'WARN'
    $startTime = $midnight
}

$startStr = $startTime.ToString('HH:mm')
Write-Log "Programando backup: inicio=$startStr — estimado finish=$finishByStr — ventana=${estimatedMin}min"

# ---------- Actualizar trigger de la tarea ----------
try {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    $newTrigger = New-ScheduledTaskTrigger -Daily -At $startTime
    Set-ScheduledTask -TaskName $TaskName -Trigger $newTrigger -ErrorAction Stop | Out-Null
    Write-Log "Tarea '$TaskName' reprogramada a las $startStr"
} catch {
    Write-Log "ERROR al actualizar la tarea: $_" 'ERROR'
    Write-Log "Verificar que la tarea '$TaskName' existe y que este script corre como Administrador." 'ERROR'
    exit 1
}

# ---------- Notificación: aviso anticipado ----------
if ($VM_EVENT_URL -and $INGEST_SECRET -and $SERVICE_ID -and $ANON_KEY) {
    $body = "{""service_id"":""$SERVICE_ID"",""event_type"":""vm_maintenance_scheduled"",""host"":""$env:COMPUTERNAME"",""start_time"":""$startStr"",""finish_by"":""$finishByStr"",""estimated_min"":$estimatedMin,""vm_count"":$($vmList.Count),""total_gb"":$totalGB}"
    $headers = @{
        "Content-Type"    = "application/json; charset=utf-8"
        "apikey"          = $ANON_KEY
        "Authorization"   = "Bearer $ANON_KEY"
        "X-Ingest-Secret" = $INGEST_SECRET
    }
    try {
        Invoke-RestMethod -Uri $VM_EVENT_URL -Method POST -Headers $headers -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -ErrorAction Stop | Out-Null
        Write-Log "Notificación enviada: backup programado a las $startStr"
    } catch {
        Write-Log "WARN: notificación fallida: $_" 'WARN'
    }
} else {
    Write-Log "Notificaciones omitidas: VM_EVENT_URL o credenciales no configurados" 'WARN'
}

Write-Log "=== Listo ==="
