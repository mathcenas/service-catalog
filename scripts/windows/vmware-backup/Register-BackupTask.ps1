# =============================================================
# Register-BackupTask.ps1 — Registra la tarea en el Programador de tareas
# Ejecutar como Administrador.
# =============================================================

[CmdletBinding()]
param(
    [string]$TaskName   = "VMware Workstation Backup - Nocturno",
    [string]$ScriptPath = "$PSScriptRoot\Backup-WorkstationVMs.ps1",
    [string]$RunAsUser  = "",        # Dejar vacio = pedir interactivo
    [string]$StartTime  = "03:30"
)

$ErrorActionPreference = 'Stop'

# Validar que el script existe
if (-not (Test-Path $ScriptPath)) {
    Write-Error "Script no encontrado: $ScriptPath"
    exit 1
}

# Usuario bajo el que corre la tarea
# IMPORTANTE: NO usar SYSTEM — vmrun necesita ver las VMs del usuario que las registró.
# Usar la cuenta que normalmente inicia sesión en el host, o una cuenta de servicio de dominio.
if (-not $RunAsUser) {
    $RunAsUser = Read-Host "Usuario para ejecutar la tarea (ej: DOMINIO\usuario o .\LocalUser)"
}
$password = Read-Host "Contrasena para '$RunAsUser'" -AsSecureString
$plainPwd = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
)

$psExe = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$args  = "-NonInteractive -ExecutionPolicy Bypass -File `"$ScriptPath`""

$action  = New-ScheduledTaskAction -Execute $psExe -Argument $args -WorkingDirectory (Split-Path $ScriptPath)
$trigger = New-ScheduledTaskTrigger -Daily -At $StartTime
$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Hours 6) `
    -MultipleInstances IgnoreNew `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable:$false

# Eliminar tarea anterior si existe
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -RunLevel Highest `
    -User $RunAsUser `
    -Password $plainPwd `
    -Force | Out-Null

Write-Host ""
Write-Host "Tarea registrada correctamente:" -ForegroundColor Green
Write-Host "  Nombre   : $TaskName"
Write-Host "  Script   : $ScriptPath"
Write-Host "  Usuario  : $RunAsUser"
Write-Host "  Horario  : diario a las $StartTime"
Write-Host ""
Write-Host "Para probar ahora:"
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'"
