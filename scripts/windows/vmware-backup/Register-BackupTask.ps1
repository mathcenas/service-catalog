# =============================================================
# Register-BackupTask.ps1 — Registra las tareas en el Programador
# Ejecutar como Administrador.
#
# Registra dos tareas:
#   1. "VMware VM Scheduler"  — corre a las 22:00, calcula la hora
#      óptima de inicio y reprograma la tarea de backup.
#   2. "VMware Workstation Backup - Nocturno" — la copia real;
#      su hora de inicio es actualizada cada noche por la tarea 1.
# =============================================================

[CmdletBinding()]
param(
    [string]$BackupTaskName    = "VMware Workstation Backup - Nocturno",
    [string]$SchedulerTaskName = "VMware VM Scheduler",
    [string]$BackupScript      = "$PSScriptRoot\Backup-WorkstationVMs.ps1",
    [string]$SchedulerScript   = "$PSScriptRoot\Schedule-VMBackup.ps1",
    [string]$RunAsUser         = "",   # Dejar vacío = pedir interactivo
    [string]$SchedulerTime     = "22:00"
)

$ErrorActionPreference = 'Stop'

foreach ($f in @($BackupScript, $SchedulerScript)) {
    if (-not (Test-Path $f)) { Write-Error "Script no encontrado: $f"; exit 1 }
}

# Usuario — NO usar SYSTEM: vmrun necesita ver las VMs del usuario que las registró.
if (-not $RunAsUser) {
    $RunAsUser = Read-Host "Usuario para ejecutar las tareas (ej: DOMINIO\usuario o .\LocalUser)"
}
$password = Read-Host "Contrasena para '$RunAsUser'" -AsSecureString
$plainPwd = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
)

$psExe = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"

$commonSettings = New-ScheduledTaskSettingsSet `
    -MultipleInstances IgnoreNew `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable:$false

# ---------- Tarea 1: pre-programador (22:00) ----------
$schedAction  = New-ScheduledTaskAction -Execute $psExe `
    -Argument "-NonInteractive -ExecutionPolicy Bypass -File `"$SchedulerScript`"" `
    -WorkingDirectory (Split-Path $SchedulerScript)
$schedTrigger  = New-ScheduledTaskTrigger -Daily -At $SchedulerTime
$schedSettings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
    -MultipleInstances IgnoreNew `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable:$false

Unregister-ScheduledTask -TaskName $SchedulerTaskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask `
    -TaskName $SchedulerTaskName `
    -Action $schedAction `
    -Trigger $schedTrigger `
    -Settings $schedSettings `
    -RunLevel Highest `
    -User $RunAsUser `
    -Password $plainPwd `
    -Force | Out-Null

# ---------- Tarea 2: backup real (hora inicial placeholder, será actualizada a las 22:00) ----------
$backupAction  = New-ScheduledTaskAction -Execute $psExe `
    -Argument "-NonInteractive -ExecutionPolicy Bypass -File `"$BackupScript`"" `
    -WorkingDirectory (Split-Path $BackupScript)
$backupTrigger  = New-ScheduledTaskTrigger -Daily -At "03:30"   # placeholder — Schedule-VMBackup.ps1 lo recalcula
$backupSettings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Hours 6) `
    -MultipleInstances IgnoreNew `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable:$false

Unregister-ScheduledTask -TaskName $BackupTaskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask `
    -TaskName $BackupTaskName `
    -Action $backupAction `
    -Trigger $backupTrigger `
    -Settings $backupSettings `
    -RunLevel Highest `
    -User $RunAsUser `
    -Password $plainPwd `
    -Force | Out-Null

Write-Host ""
Write-Host "Tareas registradas:" -ForegroundColor Green
Write-Host "  '$SchedulerTaskName'  — diario a las $SchedulerTime"
Write-Host "    calcula hora optima y reprograma la tarea de backup"
Write-Host "  '$BackupTaskName'  — hora calculada cada noche"
Write-Host "    corre el backup real de las VMs"
Write-Host ""
Write-Host "Primer ciclo:"
Write-Host "  1. Ejecutar el pre-programador para calcular la hora de hoy:"
Write-Host "     Start-ScheduledTask -TaskName '$SchedulerTaskName'"
Write-Host "  2. Ver a qué hora quedó programado el backup:"
Write-Host "     (Get-ScheduledTask -TaskName '$BackupTaskName').Triggers"
