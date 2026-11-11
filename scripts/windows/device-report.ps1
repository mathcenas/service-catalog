param([switch]$Console)
# =============================================================
# device-report.ps1 — Inventario de equipo para Service Catalog
# v2.0.0
#
# ── Qué hace ─────────────────────────────────────────────────
# Junta los datos del equipo y del usuario logueado y los manda
# directo al portal (pestaña Software → "Reporte automático"):
#   Hostname, IP LAN, usuario Windows, usuario M365, usuario NAS,
#   SO, Office/M365, Copilot, fabricante/modelo/serie, RAM, disco.
# Cada equipo actualiza su propia fila (no duplica). Opcionalmente
# también escribe el CSV compartido de la v1 ($CSV_DESTINO).
#
# ── Correr como el USUARIO, no como SYSTEM ───────────────────
# M365, NAS y ubicaciones de confianza de Office se leen del perfil
# del usuario (HKCU / cmdkey). Como SYSTEM salen vacíos.
#   A) ManageEngine Endpoint Central → Custom Script → User,
#      en cada inicio de sesión:
#        powershell.exe -NoProfile -ExecutionPolicy Bypass -File device-report.ps1
#   B) GPO → Logon Script del usuario
#   C) Manual: .\device-report.ps1 -Console
#
# ── Configuración por cliente ────────────────────────────────
# Editar "CONFIGURAR POR CLIENTE" más abajo, o dejar al lado un
# device-report.config.ps1 con las mismas variables (pisa los valores
# de acá y sobrevive a update-scripts.ps1).
#   $PORTAL_URL / $ANON_KEY            — igual que en config.ps1
#   $DEVICE_SERVICE_ID / $DEVICE_INGEST_SECRET
#        Servicio del cliente al que se asocian los equipos. Usar uno
#        dedicado ("Inventario de equipos"): el secret queda en todas
#        las PCs, así no expone el de un server o backup.
#   $NAS_HOSTNAME, $OFFICE_TRUSTED_PATHS, $CSV_DESTINO (opcional)
# =============================================================

$SCRIPT_VERSION = "2.0.0"

# ╔══════════════════════════════════════════════════════════════╗
# ║               CONFIGURAR POR CLIENTE                        ║
# ╚══════════════════════════════════════════════════════════════╝

# Portal (mismos valores que en config.ps1 de los servers)
$PORTAL_URL           = "https://PROYECTO.supabase.co"
$ANON_KEY             = ""
$DEVICE_SERVICE_ID    = ""   # UUID del servicio "Inventario de equipos" del cliente
$DEVICE_INGEST_SECRET = ""   # Ingest secret de ese servicio (Editar servicio → Telemetría)

# CSV compartido (modo v1). Dejar vacío para reportar solo al portal.
$CSV_DESTINO = ""
#$CSV_DESTINO = "\\NAS\IT\device-report.csv"

# Nombre NetBIOS del NAS (para detectar credenciales guardadas y para
# agregar como ubicación de confianza en Office).
$NAS_HOSTNAME = "NAS"

# Carpetas del NAS que se agregan como ubicaciones de confianza en Office.
# Puede ser la raiz del share o una subcarpeta especifica.
# Dejar vacío (@()) para no tocar la configuracion de Office.
$OFFICE_TRUSTED_PATHS = @(
    "\\$NAS_HOSTNAME\Documentos"
    #"\\$NAS_HOSTNAME\Compartido"
    #"\\$NAS_HOSTNAME\Proyectos"
)

# ──────────────────────────────────────────────────────────────

# Override local (no lo pisa update-scripts.ps1)
if (Test-Path "$PSScriptRoot\device-report.config.ps1") { . "$PSScriptRoot\device-report.config.ps1" }

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

# ── Hardware ─────────────────────────────────────────────────
$cs   = Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue
$bios = Get-CimInstance Win32_BIOS -ErrorAction SilentlyContinue
$disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$($env:SystemDrive)'" -ErrorAction SilentlyContinue
$hardware = @{
    manufacturer  = if ($cs)   { "$($cs.Manufacturer)".Trim() } else { "" }
    model         = if ($cs)   { "$($cs.Model)".Trim() } else { "" }
    serial        = if ($bios) { "$($bios.SerialNumber)".Trim() } else { "" }
    ram_gb        = if ($cs -and $cs.TotalPhysicalMemory) { [math]::Round($cs.TotalPhysicalMemory / 1GB, 1) } else { $null }
    disk_total_gb = if ($disk -and $disk.Size) { [math]::Round($disk.Size / 1GB, 1) } else { $null }
    disk_free_gb  = if ($disk -and $disk.Size) { [math]::Round($disk.FreeSpace / 1GB, 1) } else { $null }
    os_build      = if ($osInfo) { "$($osInfo.Version)" } else { "" }
    last_boot     = if ($osInfo -and $osInfo.LastBootUpTime) { $osInfo.LastBootUpTime.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ") } else { "" }
}

# ── Enviar al portal ──────────────────────────────────────────
if ($DEVICE_SERVICE_ID -and $DEVICE_INGEST_SECRET -and $ANON_KEY -and $PORTAL_URL -notmatch 'PROYECTO') {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $body = @{
        service_id     = $DEVICE_SERVICE_ID
        hostname       = $hostname
        ip             = $lanIp
        local_user     = $localUser
        m365_user      = $m365User
        nas_user       = $nasUser
        os             = $os
        office         = $officeVersion
        has_copilot    = [bool]$hasCopilot
        hardware       = $hardware
        script_version = $SCRIPT_VERSION
    } | ConvertTo-Json -Compress -Depth 4
    $reqHeaders = @{
        "apikey"          = $ANON_KEY
        "Authorization"   = "Bearer $ANON_KEY"
        "X-Ingest-Secret" = $DEVICE_INGEST_SECRET
    }
    try {
        Invoke-RestMethod -Uri "$($PORTAL_URL.TrimEnd('/'))/functions/v1/ingest-device-report" -Method POST `
            -Headers $reqHeaders -ContentType "application/json; charset=utf-8" `
            -Body ([Text.Encoding]::UTF8.GetBytes($body)) -ErrorAction Stop | Out-Null
        Write-Host "[$hostname] reportado al portal" -ForegroundColor Green
    } catch {
        Write-Host "[$hostname] ERROR al reportar al portal: $($_.Exception.Message)" -ForegroundColor Red
    }
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

# ── Escribir CSV (opcional, modo v1) ───────────────────────────
if ($CSV_DESTINO) {
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
}

# ── Ubicaciones de confianza en Office ────────────────────────
#
# PARA EL TÉCNICO:
#   Office bloquea archivos de red con la advertencia "Vista protegida" o
#   "Macros deshabilitadas" si la carpeta no está en la lista de ubicaciones
#   de confianza (Trusted Locations). Esta función la agrega por registro
#   para el usuario actual (HKCU), por lo que:
#     - No requiere permisos de administrador
#     - Se aplica solo al usuario que corre el script (ideal para GPO logon)
#     - Es permanente: sobrevive reinicios y actualizaciones de Office
#     - Efecto inmediato: no hace falta reiniciar Office, aplica en la
#       próxima apertura de un archivo desde esa ruta
#     - AllowSubFolders = 1 cubre todas las subcarpetas del share
#   Si el cliente tiene políticas de grupo (GPO) que bloquean Trusted
#   Locations personalizadas, esta escritura en HKCU no tendrá efecto
#   y habrá que configurarlo via GPO en Computer Configuration.

function Add-OfficeTrustedLocation {
    param([string]$Path, [string]$Description = "NAS compartido")

    # Detectar version instalada (prioriza la mas reciente)
    $officeVer = $null
    foreach ($v in @("16.0","15.0","14.0")) {
        if (Test-Path "HKCU:\SOFTWARE\Microsoft\Office\$v\Word\Security") {
            $officeVer = $v; break
        }
    }
    if (-not $officeVer) { return $false }

    $added = $false
    $apps = @("Word","Excel","PowerPoint")
    foreach ($app in $apps) {
        $root = "HKCU:\SOFTWARE\Microsoft\Office\$officeVer\$app\Security\Trusted Locations"
        if (-not (Test-Path $root)) { continue }

        # No duplicar si la ruta ya está registrada
        $alreadyExists = Get-ChildItem $root -ErrorAction SilentlyContinue |
            Where-Object {
                (Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue).Path -eq $Path
            }
        if ($alreadyExists) { continue }

        # Siguiente indice libre: Location0, Location1, ...
        $existing = (Get-ChildItem $root -ErrorAction SilentlyContinue |
            Where-Object { $_.PSChildName -match '^Location\d+$' } |
            ForEach-Object { [int]($_.PSChildName -replace 'Location','') } |
            Measure-Object -Maximum).Maximum
        $nextIdx = if ($null -eq $existing) { 0 } else { $existing + 1 }
        $newKey  = "$root\Location$nextIdx"

        New-Item -Path $newKey -Force | Out-Null
        Set-ItemProperty -Path $newKey -Name "Path"            -Value $Path
        Set-ItemProperty -Path $newKey -Name "Description"     -Value $Description
        Set-ItemProperty -Path $newKey -Name "AllowSubFolders" -Value 1 -Type DWord
        $added = $true
    }
    return $added
}

if ($OFFICE_TRUSTED_PATHS.Count -gt 0) {
    $newTrusted = [System.Collections.Generic.List[string]]::new()
    foreach ($p in $OFFICE_TRUSTED_PATHS) {
        $wasAdded = Add-OfficeTrustedLocation -Path $p -Description "NAS - $NAS_HOSTNAME"
        if ($wasAdded) { $newTrusted.Add($p) }
    }

    if ($newTrusted.Count -gt 0) {
        # Mensaje visible al usuario final (cuadro de diálogo de Windows)
        Add-Type -AssemblyName System.Windows.Forms
        $msg = "Se configuró correctamente tu acceso al servidor.$([Environment]::NewLine * 2)" +
               "Las siguientes carpetas de red ahora se abren sin advertencias en Word, Excel y PowerPoint:$([Environment]::NewLine)" +
               ($newTrusted | ForEach-Object { "  • $_" } | Out-String).TrimEnd() +
               "$([Environment]::NewLine * 2)No necesitás hacer nada más."
        [System.Windows.Forms.MessageBox]::Show(
            $msg,
            "Configuración completada",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Information
        ) | Out-Null
        Write-Host "[$hostname] Ubicaciones de confianza agregadas en Office." -ForegroundColor Cyan
    }
}
