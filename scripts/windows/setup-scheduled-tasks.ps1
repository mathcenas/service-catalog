# =============================================================
# setup-scheduled-tasks.ps1 — Registra o actualiza las tareas
# programadas del Service Catalog usando PowerShell 7 (pwsh.exe)
#
# Ejecutar UNA VEZ como Administrador desde PowerShell 7:
#   pwsh -ExecutionPolicy Bypass -File C:\Scripts\setup-scheduled-tasks.ps1
#
# Re-ejecutar si cambian los horarios o se agrega una nueva tarea.
# Las tareas existentes se actualizan en lugar de duplicarse.
# =============================================================

#Requires -RunAsAdministrator

# Con versión para que update-scripts.ps1 lo actualice (sin versión nunca se bajaba de nuevo)
$SCRIPT_VERSION = "1.1.0"

$ScriptsDir = $PSScriptRoot

# Detectar pwsh.exe
$PwshPath = (Get-Command pwsh -ErrorAction SilentlyContinue)?.Source
if (-not $PwshPath) {
    $PwshPath = "$env:ProgramFiles\PowerShell\7\pwsh.exe"
}
if (-not (Test-Path $PwshPath)) {
    Write-Error "No se encontró pwsh.exe. Instalá PowerShell 7 primero: https://aka.ms/powershell"
    exit 1
}
Write-Host "Usando: $PwshPath" -ForegroundColor Cyan

$CommonArgs = "-NonInteractive -ExecutionPolicy Bypass"
$TaskUser   = "SYSTEM"

# Kopia (y el chequeo de Tailscale que va con él) tiene que correr con el usuario de KopiaUI: la
# conexión al repositorio y su contraseña quedan guardadas en el perfil de ese usuario (Administrador
# de credenciales). Con SYSTEM no encuentra kopia.exe o no puede abrir el repositorio.
# config.ps1: $KOPIA_TASK_USER = "PC" (o "DOMINIO\usuario") y opcional $KOPIA_REPORT_TIME = "19:30"
$cfgFile = Join-Path $ScriptsDir "config.ps1"
$setupVersion = $SCRIPT_VERSION
if (Test-Path $cfgFile) { . $cfgFile }
$SCRIPT_VERSION = $setupVersion
$KopiaUser = if (Get-Variable 'KOPIA_TASK_USER' -ErrorAction SilentlyContinue) { [string]$KOPIA_TASK_USER } else { '' }
$KopiaTime = if ((Get-Variable 'KOPIA_REPORT_TIME' -ErrorAction SilentlyContinue) -and $KOPIA_REPORT_TIME) { [string]$KOPIA_REPORT_TIME } else { '19:30' }

# ---------- Definición de tareas ----------
# Cada entrada: TaskName, Script, Trigger (objeto), Description
$Tasks = @(

    @{
        Name        = "ServiceCatalog-SystemHealth"
        Script      = "system-health.ps1"
        Trigger     = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Minutes 60) -Once -At (Get-Date)
        Description = "Reporta CPU, RAM, disco, RDP y AnyDesk al Service Catalog. Cada 1 hora."
    }

    @{
        Name        = "ServiceCatalog-VeeamReport"
        Script      = "veeam-report.ps1"
        Trigger     = New-ScheduledTaskTrigger -Daily -At "07:00"
        Description = "Reporta jobs de Veeam completados al Service Catalog. Diario a las 07:00."
    }

    @{
        Name        = "ServiceCatalog-VeeamAgentReport"
        Script      = "veeam-agent-report.ps1"
        Trigger     = New-ScheduledTaskTrigger -Daily -At "07:15"
        Description = "Reporta jobs de Veeam Agent al Service Catalog. Diario a las 07:15."
    }

    @{
        Name        = "ServiceCatalog-BackupFolderCheck"
        Script      = "backup-folder-check.ps1"
        Trigger     = New-ScheduledTaskTrigger -Daily -At "07:30"
        Description = "Verifica carpetas de backup locales. Diario a las 07:30."
    }

    @{
        Name        = "ServiceCatalog-UpdateScripts"
        Script      = "update-scripts.ps1"
        Trigger     = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Hours 48) -Once -At (Get-Date)
        Description = "Auto-actualiza los scripts desde GitHub. Cada 48 horas."
    }

)

# ---------- Registro ----------
foreach ($t in $Tasks) {
    $scriptPath = Join-Path $ScriptsDir $t.Script

    if (-not (Test-Path $scriptPath)) {
        Write-Warning "Script no encontrado, se omite: $scriptPath"
        continue
    }

    $action  = New-ScheduledTaskAction `
        -Execute $PwshPath `
        -Argument "$CommonArgs -File `"$scriptPath`""

    $settings = New-ScheduledTaskSettingsSet `
        -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
        -RestartCount 1 `
        -RestartInterval (New-TimeSpan -Minutes 5) `
        -StartWhenAvailable

    $principal = New-ScheduledTaskPrincipal `
        -UserId $TaskUser `
        -LogonType ServiceAccount `
        -RunLevel Highest

    $existing = Get-ScheduledTask -TaskName $t.Name -ErrorAction SilentlyContinue

    if ($existing) {
        Set-ScheduledTask -TaskName $t.Name `
            -Action $action `
            -Trigger $t.Trigger `
            -Settings $settings `
            -Principal $principal | Out-Null
        Write-Host "  ACTUALIZADA  $($t.Name)" -ForegroundColor Yellow
    } else {
        Register-ScheduledTask `
            -TaskName    $t.Name `
            -Action      $action `
            -Trigger     $t.Trigger `
            -Settings    $settings `
            -Principal   $principal `
            -Description $t.Description | Out-Null
        Write-Host "  REGISTRADA   $($t.Name)" -ForegroundColor Green
    }
}

# ---------- Kopia + Tailscale con el usuario de KopiaUI ----------
$kopiaScript = Join-Path $ScriptsDir "kopia-report.ps1"
if ((Test-Path $kopiaScript) -and $KopiaUser) {
    Write-Host ""
    Write-Host "Kopia: la tarea corre con el usuario $KopiaUser (el de KopiaUI)." -ForegroundColor Cyan
    Write-Host "Windows pide su contraseña para poder correrla aunque no haya sesión iniciada." -ForegroundColor Cyan
    $cred = Get-Credential -UserName $KopiaUser -Message "Contraseña de Windows de $KopiaUser (para la tarea de Kopia)"
    if ($cred) {
        $kAction   = New-ScheduledTaskAction -Execute $PwshPath -Argument "$CommonArgs -File `"$kopiaScript`""
        $kTrigger  = New-ScheduledTaskTrigger -Daily -At $KopiaTime
        $kSettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 1) -RestartCount 1 `
                        -RestartInterval (New-TimeSpan -Minutes 5) -StartWhenAvailable
        $existing = Get-ScheduledTask -TaskName "ServiceCatalog-KopiaReport" -ErrorAction SilentlyContinue
        if ($existing) { Unregister-ScheduledTask -TaskName "ServiceCatalog-KopiaReport" -Confirm:$false }
        Register-ScheduledTask -TaskName "ServiceCatalog-KopiaReport" -Action $kAction -Trigger $kTrigger -Settings $kSettings `
            -User $cred.UserName -Password $cred.GetNetworkCredential().Password -RunLevel Highest `
            -Description "Reporta snapshots y mantenimiento de Kopia y el estado de Tailscale. Diario a las $KopiaTime, con el usuario de KopiaUI." | Out-Null
        Write-Host "  REGISTRADA   ServiceCatalog-KopiaReport ($($cred.UserName), $KopiaTime)" -ForegroundColor Green

        # Otras tareas que corren kopia-report.ps1 (instalaciones viejas): se deshabilitan para no duplicar
        Get-ScheduledTask | Where-Object {
            $_.TaskName -ne "ServiceCatalog-KopiaReport" -and ($_.Actions | Where-Object { "$($_.Arguments)" -match 'kopia-report\.ps1' })
        } | ForEach-Object {
            Disable-ScheduledTask -TaskName $_.TaskName -TaskPath $_.TaskPath | Out-Null
            Write-Host "  DESHABILITADA $($_.TaskName) (también corría kopia-report.ps1, usuario $($_.Principal.UserId))" -ForegroundColor Yellow
        }
    }
} elseif (Test-Path $kopiaScript) {
    Write-Host ""
    Write-Warning "Hay kopia-report.ps1 pero no `$KOPIA_TASK_USER en config.ps1: la tarea de Kopia no se registra (con SYSTEM no puede abrir el repositorio)."
}

Write-Host ""
Write-Host "Tareas configuradas con: $PwshPath" -ForegroundColor Cyan
Write-Host "Para ver el estado: Get-ScheduledTask | Where-Object TaskName -like 'ServiceCatalog-*' | Select TaskName,State"
