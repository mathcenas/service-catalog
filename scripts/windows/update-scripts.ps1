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

$SCRIPT_VERSION = "1.1.0"

$ErrorActionPreference = "Stop"

$GithubRepo   = if ($env:GITHUB_REPO)   { $env:GITHUB_REPO }   else { "mathcenas/service-catalog" }
$GithubBranch = if ($env:GITHUB_BRANCH) { $env:GITHUB_BRANCH } else { "main" }
$InstallDir   = $PSScriptRoot   # mismo directorio que este script
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
  "report-smb-acl.ps1"            = "scripts/windows/report-smb-acl.ps1"
  "smb-check.ps1"                 = "scripts/windows/smb-check.ps1"
  "server-snapshot.ps1"           = "scripts/windows/server-snapshot.ps1"
  "device-report.ps1"             = "scripts/windows/device-report.ps1"
  "update-scripts.ps1"            = "scripts/windows/update-scripts.ps1"
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

function Download-Temp {
  param([string]$Url)
  $tmp = [System.IO.Path]::GetTempFileName()
  try {
    Invoke-WebRequest -Uri $Url -OutFile $tmp -UseBasicParsing -ErrorAction Stop
    if ((Get-Item $tmp).Length -lt 100) {
      throw "Archivo sospechosamente pequeno ($((Get-Item $tmp).Length) bytes)"
    }
    return $tmp
  } catch {
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    Warn "  Error descargando ${Url}: $($_.Exception.Message)"
    return $null
  }
}

function Write-VersionsFile {
  $versions = [ordered]@{}
  foreach ($scriptName in $Scripts.Keys) {
    $dest = Join-Path $InstallDir $scriptName
    $ver  = Get-ScriptVersion -Path $dest
    if ($ver -gt [version]"0.0.0") {
      $versions[$scriptName] = $ver.ToString()
    }
  }
  $versions | ConvertTo-Json | Set-Content -Path $VersionsFile -Encoding UTF8
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

$updated = 0; $skipped = 0; $errors = 0
$selfUpdatePending = $null

foreach ($scriptName in $Scripts.Keys) {
  $repoPath = $Scripts[$scriptName]
  $dest     = Join-Path $InstallDir $scriptName
  $url      = "$RawBase/$repoPath"

  $tmp = Download-Temp -Url $url
  if (-not $tmp) {
    $errors++
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
    $updated++
    continue
  }

  # update-scripts.ps1 -> reemplazar despues del loop para no pisar el script en ejecucion
  if ($scriptName -eq "update-scripts.ps1" -and $dest -eq $MyInvocation.MyCommand.Path) {
    $selfUpdatePending = @{ tmp = $tmp; dest = $dest; from = $localVer; to = $remoteVer }
    continue
  }

  Move-Item $tmp $dest -Force
  Ok "${scriptName}: $localVer -> $remoteVer"
  $updated++
}

# Auto-actualizacion de este script (al final, una vez terminado el loop)
if ($selfUpdatePending) {
  Move-Item $selfUpdatePending.tmp $selfUpdatePending.dest -Force
  Ok "update-scripts.ps1: $($selfUpdatePending.from) -> $($selfUpdatePending.to)"
  $updated++
}

if (-not $Check) {
  Log "Listo - actualizados: $updated - sin cambios: $skipped - errores: $errors"
  Write-VersionsFile
  Log "Versiones guardadas en installed-versions.json"
}
