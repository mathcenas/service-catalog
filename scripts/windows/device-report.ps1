# =============================================================
# device-report.ps1 — Reporte de equipo para Service Catalog
#
# Recopila: hostname, IP LAN, usuario logueado, OS, Office/M365,
# Copilot y lo escribe en un CSV compartido del NAS.
#
# Opciones de despliegue:
#   A) GPO Logon Script: siempre actualiza al iniciar sesión
#   B) Task Scheduler: cada hora, al inicio, etc.
#   C) Manual: el admin lo corre y luego importa el CSV
#
# Uso:
#   .\device-report.ps1                                     # auto-detecta
#   .\device-report.ps1 -NasPath "\\NAS\DeviceReport"
#   .\device-report.ps1 -OutFile "C:\Temp\device-report.csv"
# =============================================================

param(
    [string]$NasPath  = "\\NAS\DeviceReport",  # Carpeta compartida en el NAS (ajustar nombre)
    [string]$OutFile  = "",                     # Si se especifica, escribe aqui en vez del NAS
    [switch]$Console                            # Muestra resultado en consola aunque escriba a archivo
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Hostname ──────────────────────────────────────────────────
$hostname = $env:COMPUTERNAME

# ── Usuario logueado actualmente ─────────────────────────────
# USERNAME da el usuario de la sesion actual (GPO logon = usuario que inicia sesion)
$loggedUser = $env:USERNAME

# ── IPs LAN (excluir loopback y APIPA) ──────────────────────
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

# ── Office / M365 ────────────────────────────────────────────
$officeVersion = ""
$hasCopilot    = $false

# Click-to-Run (M365, Office 2019+)
$c2rPaths = @(
    "HKLM:\SOFTWARE\Microsoft\Office\ClickToRun\Configuration",
    "HKLM:\SOFTWARE\Wow6432Node\Microsoft\Office\ClickToRun\Configuration"
)
foreach ($path in $c2rPaths) {
    if (Test-Path $path) {
        $c2r = Get-ItemProperty $path -ErrorAction SilentlyContinue
        $ver = $c2r.VersionToReport
        if ($ver) {
            $build = ($ver -split '\.')[0..1] -join '.'
            # Determinar producto
            $prod = $c2r.ProductReleaseIds
            if ($prod -match 'O365') {
                $officeVersion = "Microsoft 365 Apps ($build)"
            } elseif ($prod -match '2021') {
                $officeVersion = "Office 2021 ($build)"
            } elseif ($prod -match '2019') {
                $officeVersion = "Office 2019 ($build)"
            } else {
                $officeVersion = "Office C2R ($build)"
            }
        }
        break
    }
}

# MSI legacy (Office 2013/2016)
if (-not $officeVersion) {
    $msiKeys = Get-ChildItem "HKLM:\SOFTWARE\Microsoft\Office" -ErrorAction SilentlyContinue |
        Where-Object { $_.PSChildName -match '^\d+\.\d+$' } |
        Sort-Object { [version]$_.PSChildName } -Descending
    if ($msiKeys) {
        $verNum = $msiKeys[0].PSChildName
        $label  = switch ($verNum) {
            "16.0" { "Office 2016/2019" }
            "15.0" { "Office 2013" }
            "14.0" { "Office 2010" }
            default { "Office $verNum" }
        }
        $officeVersion = $label
    }
}

# Copilot: buscar en Apps de Windows (AppxPackage) o en archivos de programa
$copilotApp = Get-AppxPackage -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'Copilot' }
if (-not $copilotApp) {
    # Buscar via registro de Click-to-Run
    $c2rState = "HKLM:\SOFTWARE\Microsoft\Office\ClickToRun\Configuration"
    if (Test-Path $c2rState) {
        $prods = (Get-ItemProperty $c2rState -ErrorAction SilentlyContinue).ProductReleaseIds
        if ($prods -match 'Copilot') { $copilotApp = $true }
    }
}
$hasCopilot = [bool]$copilotApp

# ── Timestamp ─────────────────────────────────────────────────
$ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

# ── Construir row ─────────────────────────────────────────────
$row = [PSCustomObject]@{
    Timestamp   = $ts
    Hostname    = $hostname
    IP          = $lanIp
    LoggedUser  = $loggedUser
    OS          = $os
    Office      = $officeVersion
    Copilot     = if ($hasCopilot) { "true" } else { "false" }
}

if ($Console) {
    $row | Format-Table -AutoSize
}

# ── Escribir CSV ──────────────────────────────────────────────
$csvFile = if ($OutFile) {
    $OutFile
} else {
    Join-Path $NasPath "device-report.csv"
}

# Crear carpeta de destino si no existe (solo aplica para OutFile local)
$dir = Split-Path $csvFile -Parent
if ($dir -and -not (Test-Path $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
}

$headers = @("Timestamp","Hostname","IP","LoggedUser","OS","Office","Copilot")
$line = ($headers | ForEach-Object { $row.$_ }) -join ","

if (Test-Path $csvFile) {
    # Actualizar fila existente para este hostname (reemplazar si ya existe)
    $existing = Get-Content $csvFile -Encoding UTF8
    $headerLine = $existing[0]
    $otherRows  = $existing[1..($existing.Count - 1)] | Where-Object { $_ -notmatch "^$hostname," }
    @($headerLine) + $otherRows + $line | Set-Content $csvFile -Encoding UTF8
} else {
    # Crear con header
    @(($headers -join ","), $line) | Set-Content $csvFile -Encoding UTF8
}

Write-Host "[$hostname] device-report actualizado: $csvFile" -ForegroundColor Green
