# =============================================================
# update-scripts.ps1 - Auto-actualizacion de scripts Windows
#
# Descarga la ultima version de los scripts desde GitHub y los
# instala en el mismo directorio donde esta este script
# (normalmente C:\Scripts\ o donde lo pongas).
#
# Uso:
#   .\update-scripts.ps1              # actualiza todos
#   .\update-scripts.ps1 -Check       # solo compara versiones
#   .\update-scripts.ps1 -Force       # instala aunque la version sea igual
#
# Tarea programada cada 48h (ejecutar como admin, una sola vez):
#   $trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Hours 48) -Once -At (Get-Date)
#   $action  = New-ScheduledTaskAction -Execute "pwsh.exe" `
#                -Argument "-NonInteractive -File `"$PSScriptRoot\update-scripts.ps1`""
#   Register-ScheduledTask -TaskName "ServiceCatalog-UpdateScripts" `
#                          -Trigger $trigger -Action $action -RunLevel Highest
#
# Variables de entorno opcionales:
#   GITHUB_REPO    owner/repo      (default: mathcenas/service-catalog)
#   GITHUB_BRANCH  rama            (default: main)
# =============================================================
param(
  [switch]$Check,
  [switch]$Force
)

$SCRIPT_VERSION = "1.3.2"
$UPDATER_VERSION = $SCRIPT_VERSION   # config.ps1 también define $SCRIPT_VERSION y la pisa al leerlo

$ErrorActionPreference = "SilentlyContinue"

# TLS 1.2 explicito (requerido por GitHub en entornos con PS5 / .NET 4.x)
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$GithubRepo   = if ($env:GITHUB_REPO)   { $env:GITHUB_REPO }   else { "mathcenas/service-catalog" }
$GithubBranch = if ($env:GITHUB_BRANCH) { $env:GITHUB_BRANCH } else { "main" }
$InstallDir   = $PSScriptRoot
$RawBase      = "https://raw.githubusercontent.com/$GithubRepo/$GithubBranch"
$LogFile      = Join-Path $InstallDir "update-scripts.log"
$VersionsFile = Join-Path $InstallDir "installed-versions.json"

# Scripts a gestionar: nombre_local -> ruta en repo
$Scripts = [ordered]@{
  "config.ps1"                    = "scripts/windows/config.ps1"
  "system-health.ps1"             = "scripts/windows/system-health.ps1"
  "system-health-server.ps1"      = "scripts/windows/system-health-server.ps1"
  "backup-folder-check.ps1"       = "scripts/windows/backup-folder-check.ps1"
  "veeam-agent-report.ps1"        = "scripts/windows/veeam-agent-report.ps1"
  "veeam-report.ps1"              = "scripts/windows/veeam-report.ps1"
  "veeam-restore-test-report.ps1" = "scripts/windows/veeam-restore-test-report.ps1"
  "kopia-report.ps1"              = "scripts/windows/kopia-report.ps1"
  "cobian-report.ps1"             = "scripts/windows/cobian-report.ps1"
  "ad-backup.ps1"                 = "scripts/windows/ad-backup.ps1"
  "report-smb-acl.ps1"            = "scripts/windows/report-smb-acl.ps1"
  "smb-check.ps1"                 = "scripts/windows/smb-check.ps1"
  "device-report.ps1"             = "scripts/windows/device-report.ps1"
  "setup-scheduled-tasks.ps1"     = "scripts/windows/setup-scheduled-tasks.ps1"
  "update-scripts.ps1"            = "scripts/windows/update-scripts.ps1"
  # Herramientas que se corren a mano o solo en algunos clientes: se mantienen al día igual
  "cobian-backfill.ps1"           = "scripts/windows/cobian-backfill.ps1"
  "kls-report.ps1"                = "scripts/windows/kls-report.ps1"
  "server-snapshot.ps1"           = "scripts/windows/server-snapshot.ps1"
  "cpu-watch.ps1"                 = "scripts/windows/cpu-watch.ps1"
  "cristar-backup-report.ps1"     = "scripts/windows/cristar-backup-report.ps1"
}
# Nota: config.ps1 se actualiza pero NO sobreescribe - se guarda como config.ps1.new
# para que puedas revisar cambios antes de aplicarlos.

# ── helpers ──────────────────────────────────────────────────
function Log  {
  param($msg)
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
  Write-Host $line
  try { Add-Content -Path $LogFile -Value $line -ErrorAction SilentlyContinue } catch {}
}
function Ok   { param($msg) Log "v $msg" }
function Warn { param($msg) Log "! $msg" }
function Err  { param($msg) Log "x $msg" }

function Get-ScriptVersion {
  param([string]$Path)
  if (-not (Test-Path $Path)) { return [version]"0.0.0" }
  $line = Select-String -Path $Path -Pattern '^\$SCRIPT_VERSION\s*=' | Select-Object -First 1
  if (-not $line) { return [version]"0.0.0" }
  $ver = ($line.Line -replace '.*=\s*"', '' -replace '".*', '').Trim()
  try { return [version]$ver } catch { return [version]"0.0.0" }
}

function Get-FileSha256 {
  param([string]$Path)
  try {
    $hash = Get-FileHash -Path $Path -Algorithm SHA256 -ErrorAction Stop
    return $hash.Hash.ToLower()
  } catch { return $null }
}

function Download-Temp {
  param([string]$Url)
  $tmp = [System.IO.Path]::GetTempFileName()
  try {
    Invoke-WebRequest -Uri $Url -OutFile $tmp -UseBasicParsing -ErrorAction Stop
    $size = (Get-Item $tmp).Length
    if ($size -lt 100) {
      throw "Archivo sospechosamente pequeno ($size bytes) - posible error de GitHub"
    }
    # Re-save with UTF-8 BOM so PS5.1 parses non-ASCII comments correctly
    $content = [System.IO.File]::ReadAllText($tmp, [System.Text.Encoding]::UTF8)
    [System.IO.File]::WriteAllText($tmp, $content, [System.Text.UTF8Encoding]::new($true))
    return $tmp
  } catch {
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    return $null
  }
}

function Backup-Script {
  param([string]$Path)
  if (-not (Test-Path $Path)) { return }
  try {
    Copy-Item $Path "$Path.bak" -Force -ErrorAction Stop
  } catch {}
}

function Write-VersionsFile {
  $versions = [ordered]@{}
  foreach ($scriptName in $Scripts.Keys) {
    $dest = Join-Path $InstallDir $scriptName
    if (-not (Test-Path $dest)) { continue }
    $ver  = Get-ScriptVersion -Path $dest
    $sha  = Get-FileSha256 -Path $dest
    $versions[$scriptName] = [ordered]@{
      version   = $ver.ToString()
      sha256    = $sha
      updated   = (Get-Item $dest).LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss")
    }
  }
  $versions | ConvertTo-Json -Depth 3 | Set-Content -Path $VersionsFile -Encoding UTF8
}

# Reporta al portal qué versiones quedaron instaladas y cuándo vuelve a correr.
# Usa SERVICE_ID / INGEST_SECRET de config.ps1; si no está configurado, no manda nada.
function Send-UpdaterReport {
  $cfg = Join-Path $InstallDir "config.ps1"
  if (-not (Test-Path $cfg)) { return }
  try { . $cfg } catch { Warn "config.ps1 no se pudo leer - no se reporta al portal"; return }
  if (-not $SERVICE_ID -or $SERVICE_ID -like "REEMPLAZAR*" -or -not $HEARTBEAT_URL) { return }

  $installed = [ordered]@{}
  foreach ($scriptName in $Scripts.Keys) {
    $dest = Join-Path $InstallDir $scriptName
    if (Test-Path $dest) { $installed[$scriptName] = (Get-ScriptVersion -Path $dest).ToString() }
  }

  # Tarea programada que corre este script (cualquier nombre)
  $task = $null
  try {
    $t = Get-ScheduledTask -ErrorAction Stop | Where-Object { ($_.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments)" }) -match 'update-scripts' } | Select-Object -First 1
    if ($t) {
      $i = $t | Get-ScheduledTaskInfo
      $task = [ordered]@{
        name        = $t.TaskName
        state       = $t.State.ToString()
        last_run    = if ($i.LastRunTime -and $i.LastRunTime.Year -gt 2000) { $i.LastRunTime.ToUniversalTime().ToString("o") } else { $null }
        next_run    = if ($i.NextRunTime) { $i.NextRunTime.ToUniversalTime().ToString("o") } else { $null }
        last_result = $i.LastTaskResult
      }
    }
  } catch {}

  $body = @{
    service_id = $SERVICE_ID
    source     = "update-scripts"
    status     = if ($errors -gt 0) { "warning" } else { "success" }
    message    = "Actualizados: $updated | Sin cambios: $skipped | Errores: $errors"
    payload    = [ordered]@{
      platform       = "windows"
      branch         = $GithubBranch
      installed      = $installed
      updated        = @($updatedList)
      errors         = @($errorList)
      task           = $task
      ps_version     = $PSVersionTable.PSVersion.ToString()
      script_version = $UPDATER_VERSION
    }
  } | ConvertTo-Json -Depth 5
  $h = @{ "Content-Type" = "application/json"; "apikey" = $ANON_KEY; "Authorization" = "Bearer $ANON_KEY"; "X-Ingest-Secret" = $INGEST_SECRET }
  try {
    Invoke-RestMethod -Uri $HEARTBEAT_URL -Method POST -Headers $h -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -ErrorAction Stop | Out-Null
    Log "Reporte enviado al portal"
  } catch { Warn "No se pudo reportar al portal: $($_.Exception.Message)" }
}

# Rotar log si supera 1 MB
try {
  if ((Test-Path $LogFile) -and (Get-Item $LogFile).Length -gt 1MB) {
    $archive = $LogFile -replace '\.log$', "-$(Get-Date -Format 'yyyyMMdd').log"
    Move-Item $LogFile $archive -Force
  }
} catch {}

# ── main ─────────────────────────────────────────────────────
Log "update-scripts.ps1 v$SCRIPT_VERSION - repo: $GithubRepo@$GithubBranch"

# Asegurar carpeta logs con permisos correctos (necesario en servidores de dominio)
$LogsDir = Join-Path $InstallDir "logs"
if (-not (Test-Path $LogsDir)) {
    New-Item -ItemType Directory -Path $LogsDir -Force | Out-Null
    icacls $LogsDir /grant "SYSTEM:(OI)(CI)F" /grant "Administrators:(OI)(CI)F" | Out-Null
    Log "Carpeta logs creada con permisos"
}

$updated = 0; $skipped = 0; $errors = 0
$updatedList = [System.Collections.Generic.List[string]]::new()
$errorList   = [System.Collections.Generic.List[string]]::new()
$selfUpdatePending = $null
$scriptsToRun = [System.Collections.Generic.List[string]]::new()

# Scripts seguros de ejecutar inmediatamente después de actualizarse
$SafeToRun = @(
  'system-health.ps1', 'system-health-server.ps1',
  'veeam-agent-report.ps1', 'veeam-report.ps1',
  'smb-check.ps1', 'report-smb-acl.ps1'
)

foreach ($scriptName in $Scripts.Keys) {
  try {
    $repoPath = $Scripts[$scriptName]
    $dest     = Join-Path $InstallDir $scriptName
    $url      = "$RawBase/$repoPath"

    $tmp = Download-Temp -Url $url
    if (-not $tmp) {
      Warn "${scriptName}: no se pudo descargar - saltando"
      $errors++; $errorList.Add("${scriptName}: no se pudo descargar")
      continue
    }

    $remoteVer = Get-ScriptVersion -Path $tmp
    $localVer  = Get-ScriptVersion -Path $dest

    if ($Check) {
      if ($remoteVer -gt $localVer) {
        Log "${scriptName}: actualizacion disponible $localVer -> $remoteVer"
      } else {
        Log "${scriptName}: al dia ($localVer)"
      }
      Remove-Item $tmp -Force
      continue
    }

    if (-not $Force -and $remoteVer -le $localVer) {
      Log "${scriptName}: al dia ($localVer) - sin cambios"
      Remove-Item $tmp -Force
      $skipped++
      continue
    }

    # config.ps1 -> guardar como .new para revision manual
    if ($scriptName -eq "config.ps1") {
      $newPath = "$dest.new"
      Move-Item $tmp $newPath -Force
      Ok "${scriptName}: $localVer -> $remoteVer (guardado como config.ps1.new - revisar antes de aplicar)"
      $updated++; $updatedList.Add("config.ps1.new $remoteVer")
      continue
    }

    # update-scripts.ps1 -> reemplazar despues del loop para no pisar el script en ejecucion
    if ($scriptName -eq "update-scripts.ps1" -and $dest -eq $MyInvocation.MyCommand.Path) {
      $selfUpdatePending = @{ tmp = $tmp; dest = $dest; from = $localVer; to = $remoteVer }
      continue
    }

    $sha = Get-FileSha256 -Path $tmp
    Backup-Script -Path $dest
    Move-Item $tmp $dest -Force
    Ok "${scriptName}: $localVer -> $remoteVer | sha256: $($sha.Substring(0,16))..."
    $updated++; $updatedList.Add("$scriptName $localVer -> $remoteVer")

    # Solo correr scripts que ya estaban instalados: uno recién bajado nunca se configuró
    # ni se programó en este equipo (ej: system-health-server.ps1 en una estación de trabajo).
    if ($SafeToRun -contains $scriptName -and $localVer -gt [version]"0.0.0") {
      $scriptsToRun.Add($dest)
    }

  } catch {
    Err "${scriptName}: error inesperado - $($_.Exception.Message)"
    $errors++; $errorList.Add("${scriptName}: $($_.Exception.Message)")
  }
}

# Auto-actualizacion de este script (al final, una vez terminado el loop)
if ($selfUpdatePending) {
  try {
    $sha = Get-FileSha256 -Path $selfUpdatePending.tmp
    Backup-Script -Path $selfUpdatePending.dest
    Move-Item $selfUpdatePending.tmp $selfUpdatePending.dest -Force
    Ok "update-scripts.ps1: $($selfUpdatePending.from) -> $($selfUpdatePending.to) | sha256: $($sha.Substring(0,16))..."
    $updated++; $updatedList.Add("update-scripts.ps1 $($selfUpdatePending.from) -> $($selfUpdatePending.to)")
  } catch {
    Err "update-scripts.ps1: error al auto-actualizar - $($_.Exception.Message)"
    $errors++; $errorList.Add("update-scripts.ps1: $($_.Exception.Message)")
  }
}

if (-not $Check) {
  Log "Listo - actualizados: $updated - sin cambios: $skipped - errores: $errors"
  Write-VersionsFile
  Log "Versiones guardadas en installed-versions.json"
  Send-UpdaterReport
}

# Ejecutar scripts recién actualizados
foreach ($s in $scriptsToRun) {
  $sName = [System.IO.Path]::GetFileName($s)
  Log "▶ Ejecutando $sName (recién actualizado)..."
  try {
    & $s
  } catch {
    Err "${sName}: error al ejecutar - $($_.Exception.Message)"
  }
}

# Relanzar este script si se auto-actualizó (A)
if ($selfUpdatePending -and (Test-Path $selfUpdatePending.dest)) {
  $ps = if (Get-Command pwsh -ErrorAction SilentlyContinue) { 'pwsh' } else { 'powershell' }
  Log "↩ Relanzando update-scripts.ps1 con la nueva versión..."
  & $ps -NonInteractive -File $selfUpdatePending.dest @PSBoundParameters
}
