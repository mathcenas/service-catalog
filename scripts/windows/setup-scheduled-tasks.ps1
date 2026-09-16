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

Write-Host ""
Write-Host "Tareas configuradas con: $PwshPath" -ForegroundColor Cyan
Write-Host "Para ver el estado: Get-ScheduledTask | Where-Object TaskName -like 'ServiceCatalog-*' | Select TaskName,State"
