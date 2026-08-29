# =============================================================
# device-report.ps1 — Reporte de equipo para Service Catalog
#
# Recopila: hostname, IP LAN, usuario Windows, usuario M365,
# usuario NAS, OS, Office/M365, Copilot.
#
# Opciones de despliegue:
#   A) GPO Logon Script: corre al iniciar sesion cada usuario
#   B) Task Scheduler: cada hora, al inicio del sistema, etc.
#   C) Manual: el admin lo corre y luego importa el CSV
#
# Uso:
#   .\device-report.ps1            # usa el CSV_DESTINO configurado abajo
#   .\device-report.ps1 -Console   # muestra resultado en pantalla tambien
# =============================================================

# ╔══════════════════════════════════════════════════════════════╗
# ║               CONFIGURAR POR CLIENTE                        ║
# ╠══════════════════════════════════════════════════════════════╣
# ║  Cambiar CSV_DESTINO segun donde guardar el archivo CSV.    ║
# ║  Puede ser una carpeta del NAS, un disco local, o USB.      ║
# ╚══════════════════════════════════════════════════════════════╝

$CSV_DESTINO = "\\NAS\IT\device-report.csv"
#$CSV_DESTINO = "\\SYNOLOGY\AdminShared\device-report.csv"
#$CSV_DESTINO = "C:\Temp\device-report.csv"    # solo para prueba local

# Nombre NetBIOS del NAS (para detectar credenciales guardadas).
# Si no se usa la columna UsuarioNAS, dejar en blanco.
$NAS_HOSTNAME = "NAS"

# ──────────────────────────────────────────────────────────────

param([switch]$Console)
Set-StrictMode -Version Latest
$ErrorActionPreference = "SilentlyContinue"

# ── Hostname ──────────────────────────────────────────────────
$hostname = $env:COMPUTERNAME

# ── Usuario Windows logueado ──────────────────────────────────
$localUser = $env:USERNAME

# ── Usuario M365 (cuenta firmada en Office) ───────────────────
# Lee las identidades guardadas en el perfil del usuario actual.
$m365User = ""
$idRoot = "HKCU:\SOFTWARE\Microsoft\Office\16.0\Common\Identity\Identities"
if (Test-Path $idRoot) {
    $accounts = Get-ChildItem $idRoot -ErrorAction SilentlyContinue |
        ForEach-Object { Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue } |
        Where-Object { $_.EmailAddress -or $_.FriendlyName } |
        Sort-Object { $_.ConnectedAccount } -Descending
    if ($accounts) {
        $best = $accounts | Where-Object { $_.EmailAddress } | Select-Object -First 1
        if (-not $best) { $best = $accounts[0] }
        $m365User = if ($best.EmailAddress) { $best.EmailAddress } else { $best.FriendlyName }
    }
}

# Fallback: leer de la clave Teams/OneDrive si Office no registra nada
if (-not $m365User) {
    $odPath = "HKCU:\SOFTWARE\Microsoft\OneDrive\Accounts"
    if (Test-Path $odPath) {
        $odAcct = Get-ChildItem $odPath -ErrorAction SilentlyContinue |
            ForEach-Object { Get-ItemProperty $_.PSPath } |
            Where-Object { $_.UserEmail } | Select-Object -First 1
        if ($odAcct) { $m365User = $odAcct.UserEmail }
    }
}

# ── Usuario NAS (credencial guardada en Windows) ──────────────
# Busca en el Credential Manager (cmdkey) la entrada que corresponde al NAS.
$nasUser = ""
if ($NAS_HOSTNAME) {
    $cmdkeyOut = (cmdkey /list 2>$null) -join "`n"
    # Buscar bloque que mencione el NAS y extraer el User de la linea siguiente
    if ($cmdkeyOut -match "(?i)$([regex]::Escape($NAS_HOSTNAME))[\s\S]*?User:\s*(\S+)") {
        $nasUser = $Matches[1]
    }
}

# ── IPs LAN (excluir loopback y APIPA) ───────────────────────
$ips = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
        $_.IPAddress -notmatch '^127\.' -and
        $_.IPAddress -notmatch '^169\.254\.' -and
        $_.PrefixOrigin -ne 'WellKnown'
    } | Select-Object -ExpandProperty IPAddress)
$lanIp = if ($ips.Count -gt 0) { $ips[0] } else { "" }

# ── Sistema Operativo ─────────────────────────────────────────
$osInfo = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
$os = if ($osInfo) { $osInfo.Caption -replace '\s+', ' ' } else { "" }

# ── Office / M365 ─────────────────────────────────────────────
$officeVersion = ""
$hasCopilot    = $false

# Click-to-Run (M365, Office 2019+)
$c2rPaths = @(
    "HKLM:\SOFTWARE\Microsoft\Office\ClickToRun\Configuration",
    "HKLM:\SOFTWARE\Wow6432Node\Microsoft\Office\ClickToRun\Configuration"
)
foreach ($path in $c2rPaths) {
    if (Test-Path $path) {
        $c2r  = Get-ItemProperty $path -ErrorAction SilentlyContinue
        $ver  = $c2r.VersionToReport
        $prod = $c2r.ProductReleaseIds
        if ($ver) {
            $build = ($ver -split '\.')[0..1] -join '.'
            if     ($prod -match 'O365')  { $officeVersion = "Microsoft 365 Apps ($build)" }
            elseif ($prod -match '2024')  { $officeVersion = "Office 2024 ($build)" }
            elseif ($prod -match '2021')  { $officeVersion = "Office 2021 ($build)" }
            elseif ($prod -match '2019')  { $officeVersion = "Office 2019 ($build)" }
            else                          { $officeVersion = "Office C2R ($build)" }
        }
        if ($prod -match 'Copilot') { $hasCopilot = $true }
        break
    }
}

# MSI legacy (Office 2013/2016)
if (-not $officeVersion) {
    $msiKeys = Get-ChildItem "HKLM:\SOFTWARE\Microsoft\Office" -ErrorAction SilentlyContinue |
        Where-Object { $_.PSChildName -match '^\d+\.\d+$' } |
        Sort-Object { [version]$_.PSChildName } -Descending
    if ($msiKeys) {
        $officeVersion = switch ($msiKeys[0].PSChildName) {
            "16.0" { "Office 2016/2019" }
            "15.0" { "Office 2013" }
            "14.0" { "Office 2010" }
            default { "Office $($msiKeys[0].PSChildName)" }
        }
    }
}

# Copilot via AppxPackage si no se detectó por C2R
if (-not $hasCopilot) {
    $hasCopilot = [bool](Get-AppxPackage -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'Copilot' })
}

# ── Construir fila ─────────────────────────────────────────────
$ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

$row = [PSCustomObject]@{
    Timestamp   = $ts
    Hostname    = $hostname
    IP          = $lanIp
    LocalUser   = $localUser
    M365User    = $m365User
    NASUser     = $nasUser
    OS          = $os
    Office      = $officeVersion
    Copilot     = if ($hasCopilot) { "true" } else { "false" }
}

if ($Console) { $row | Format-Table -AutoSize }

# ── Escribir CSV ───────────────────────────────────────────────
$csvFile = $CSV_DESTINO
$dir = Split-Path $csvFile -Parent
if ($dir -and -not (Test-Path $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
}

$headers = @("Timestamp","Hostname","IP","LocalUser","M365User","NASUser","OS","Office","Copilot")
$line    = ($headers | ForEach-Object { $row.$_ }) -join ","

if (Test-Path $csvFile) {
    $existing   = Get-Content $csvFile -Encoding UTF8
    $headerLine = $existing[0]
    $otherRows  = $existing[1..($existing.Count - 1)] | Where-Object { $_ -notmatch "^$([regex]::Escape($hostname))," }
    @($headerLine) + $otherRows + $line | Set-Content $csvFile -Encoding UTF8
} else {
    @(($headers -join ","), $line) | Set-Content $csvFile -Encoding UTF8
}

Write-Host "[$hostname] device-report actualizado: $csvFile" -ForegroundColor Green
