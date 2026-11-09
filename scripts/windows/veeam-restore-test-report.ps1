# =============================================================
# veeam-restore-test-report.ps1 — Reporta el resultado de una
# prueba de restauración de Veeam al Service Catalog
# Ejecutar manualmente después de cada prueba de restore
# Requiere: config.ps1 en la misma carpeta
# =============================================================

# El módulo de Veeam pide una versión concreta de PowerShell: Veeam 12 usa Windows PowerShell 5.1
# (en pwsh falla con "SSslOptions threw an exception") y Veeam 13 exige PowerShell 7.6 o superior.
# Se lee lo que pide el módulo instalado y, si la sesión actual no sirve, se relanza el script.
function Find-VeeamManifest {
    $m = Get-Module -ListAvailable -Name Veeam.Backup.PowerShell -ErrorAction SilentlyContinue |
         Sort-Object Version -Descending | Select-Object -First 1
    if ($m) { return $m.Path }
    foreach ($p in @(
        "$env:ProgramFiles\Veeam\Backup and Replication\Console\Veeam.Backup.PowerShell\Veeam.Backup.PowerShell.psd1",
        "$env:ProgramFiles\Veeam\Backup and Replication\Console\Veeam.Backup.PowerShell.psd1")) {
        if (Test-Path $p) { return $p }
    }
    return $null
}

if (-not $env:SC_VEEAM_RELAUNCHED) {
    $veeamRequired = $null
    $veeamManifest = Find-VeeamManifest
    if ($veeamManifest) {
        try { $veeamRequired = [version](Import-PowerShellDataFile $veeamManifest).PowerShellVersion } catch {}
    }
    $relaunchWith = $null
    if ($veeamRequired -and $PSVersionTable.PSVersion -lt $veeamRequired) {
        $pwsh = (Get-Command pwsh -ErrorAction SilentlyContinue).Source
        if (-not $pwsh) { $pwsh = "$env:ProgramFiles\PowerShell\7\pwsh.exe" }
        $pwshVersion = $null
        if (Test-Path $pwsh) {
            try { $pwshVersion = [version]((& $pwsh -NoProfile -Command '$PSVersionTable.PSVersion.ToString()') -replace '-.*$', '') } catch {}
        }
        if (-not $pwshVersion -or $pwshVersion -lt $veeamRequired) {
            throw "El módulo de Veeam requiere PowerShell $veeamRequired o superior (instalado: $(if ($pwshVersion) { $pwshVersion } else { 'ninguno' })). Actualizar con: winget upgrade Microsoft.PowerShell (o winget install Microsoft.PowerShell)"
        }
        $relaunchWith = $pwsh
    } elseif ($PSVersionTable.PSEdition -eq 'Core' -and (-not $veeamRequired -or $veeamRequired.Major -lt 7)) {
        $relaunchWith = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    }
    if ($relaunchWith) {
        $env:SC_VEEAM_RELAUNCHED = '1'
        & $relaunchWith -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath @args
        exit $LASTEXITCODE
    }
}

. "$PSScriptRoot\config.ps1"
[System.Net.WebRequest]::DefaultWebProxy = New-Object System.Net.WebProxy

$SCRIPT_VERSION = "1.0.2"

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$OutputEncoding = [System.Text.Encoding]::UTF8

# ---------- Log local con retención mensual ----------
$LogDir  = "$PSScriptRoot\logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$LogFile = "$LogDir\veeam-restore-test-$(Get-Date -Format 'yyyy-MM').log"
function Write-Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
    Add-Content -Path $LogFile -Value $line
    Write-Host $line
}
Get-ChildItem "$LogDir\veeam-restore-test-*.log" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-90) } | Remove-Item -Force

$veeamManifest = Find-VeeamManifest
if ($veeamManifest) {
    try { Import-Module $veeamManifest -ErrorAction Stop }
    catch { throw "No se pudo cargar el módulo de Veeam ($veeamManifest): $_" }
} else {
    Add-PSSnapin VeeamPSSnapIn -ErrorAction SilentlyContinue
}

# Buscar la última sesión de restore completada (últimas 48h)
$since = (Get-Date).AddHours(-48)
$session = Get-VBRRestoreSession | Where-Object { $_.EndTime -gt $since } | Sort-Object EndTime -Descending | Select-Object -First 1

if (-not $session) {
    Write-Log "No restore sessions found in last 48 hours."
    exit
}

$result = switch ($session.Result) {
    "Success" { "success" }
    "Failed"  { "failed" }
    default   { "partial" }
}

$testedAt = $session.EndTime.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$details  = "RestoreJob=$($session.Name) Result=$($session.Result) Duration=$([math]::Round(($session.EndTime - $session.CreationTime).TotalMinutes,1))min"

$RESTORE_URL = $INGEST_URL -replace "ingest-backup", "ingest-restore-test"

$headers = @{
    "Content-Type"    = "application/json"
    "apikey"          = $ANON_KEY
    "Authorization"   = "Bearer $ANON_KEY"
    "X-Ingest-Secret" = $INGEST_SECRET
}

$body = @{
    service_id                = $SERVICE_ID
    last_restore_test_at      = $testedAt
    last_restore_test_result  = $result
    details                   = $details
    script_version            = $SCRIPT_VERSION
} | ConvertTo-Json

try {
    Invoke-RestMethod -Uri $RESTORE_URL -Method POST -Headers $headers -Body $body | Out-Null
    Write-Log "✅ Restore test reported: $result | $details"
} catch {
    Write-Log "❌ Error reporting restore test: $($_.Exception.Message)"
}
