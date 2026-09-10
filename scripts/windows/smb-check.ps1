# =============================================================
# smb-check.ps1 — Verifica acceso a carpeta compartida (SMB)
# Monitorea que el share esté accesible y con contenido reciente.
#
# Schedulear en Task Scheduler (ej: cada 1 hora):
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Scripts\smb-check.ps1"
#
# Requiere: config.ps1 en la misma carpeta con las variables:
#   $SMB_SERVICE_ID  — ID del servicio en la app (distinto al del server)
#   $SMB_PATH        — Path UNC, ej: \\servidor\carpeta
#   $SMB_USER        — Usuario de solo lectura
#   $SMB_PASS        — Contraseña en texto plano
# =============================================================

. "$PSScriptRoot\config.ps1"
[System.Net.WebRequest]::DefaultWebProxy = New-Object System.Net.WebProxy

$SCRIPT_VERSION = "1.0.0"

if (-not (Get-Command Invoke-Kuma -ErrorAction SilentlyContinue)) {
    function Invoke-Kuma { param([string]$Status, [string]$Msg) }
}

function Invoke-SmbKuma {
    param([string]$Status, [string]$Msg)
    if (-not $SMB_KUMA_PUSH_URL) { return }
    $base = $SMB_KUMA_PUSH_URL -replace '\?.*', ''
    $url  = "${base}?status=${Status}&msg=$([uri]::EscapeDataString($Msg))&ping=0"
    try { Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 10 | Out-Null } catch {}
}

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$OutputEncoding = [System.Text.Encoding]::UTF8

# ---------- Log ----------
$LogDir  = "$PSScriptRoot\logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$LogFile = "$LogDir\smb-check-$(Get-Date -Format 'yyyy-MM').log"
function Write-Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
    Add-Content -Path $LogFile -Value $line
    Write-Host $line
}
Get-ChildItem "$LogDir\smb-check-*.log" |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-90) } |
    Remove-Item -Force

$headers = @{
    "Content-Type"    = "application/json"
    "apikey"          = $ANON_KEY
    "Authorization"   = "Bearer $ANON_KEY"
    "X-Ingest-Secret" = $SMB_INGEST_SECRET
}

function Send-Heartbeat($status, $message, $payload) {
    $body = @{
        service_id = $SMB_SERVICE_ID
        source     = "smb-check"
        status     = $status
        message    = $message
        payload    = $payload
    } | ConvertTo-Json -Compress -Depth 5
    try {
        Invoke-RestMethod -Uri $HEARTBEAT_URL -Method POST -Headers $headers -Body $body -ErrorAction Stop | Out-Null
        Write-Log "Heartbeat enviado: $status — $message"
    } catch {
        Write-Log "ERROR al enviar heartbeat: $_"
    }
    Invoke-SmbKuma -Status $(if ($status -eq 'error') { 'down' } elseif ($status -eq 'warning') { 'warn' } else { 'up' }) -Msg $message
}

# ---------- Montar share con credenciales ----------
$shareName = ($SMB_PATH -replace '^\\\\[^\\]+\\', '') -replace '\\.*', ''
$mountResult = $null

# Limpiar conexión previa si existe
net use $SMB_PATH /delete 2>$null | Out-Null

try {
    $secPass = ConvertTo-SecureString $SMB_PASS -AsPlainText -Force
    $cred    = New-Object System.Management.Automation.PSCredential($SMB_USER, $secPass)
    New-PSDrive -Name "SMBCheck" -PSProvider FileSystem -Root $SMB_PATH -Credential $cred -ErrorAction Stop | Out-Null
    $mountResult = "ok"
} catch {
    Write-Log "ERROR al montar $SMB_PATH : $_"
    Send-Heartbeat "error" "No se pudo acceder al share: $SMB_PATH" @{
        path           = $SMB_PATH
        error          = $_.Exception.Message
        script_version = $SCRIPT_VERSION
    }
    exit 1
}

# ---------- Verificar acceso y contenido ----------
try {
    $items = Get-ChildItem -Path "SMBCheck:\" -ErrorAction Stop
    $itemCount = $items.Count

    # Archivo o carpeta más reciente
    $latest = $items | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    $latestName = if ($latest) { $latest.Name } else { "(vacío)" }
    $latestDate = if ($latest) { $latest.LastWriteTime } else { $null }
    $ageHours   = if ($latestDate) { [math]::Round(((Get-Date) - $latestDate).TotalHours, 1) } else { $null }

    # Espacio disponible en el share
    $freeGB = $null
    try {
        $drive = Get-PSDrive -Name "SMBCheck" -ErrorAction SilentlyContinue
        if ($drive -and $drive.Free) {
            $freeGB = [math]::Round($drive.Free / 1GB, 2)
        }
    } catch {}

    $status  = "ok"
    $issues  = @()

    if ($itemCount -eq 0) {
        $status = "warning"
        $issues += "Share accesible pero vacío"
    }

    if ($freeGB -ne $null -and $freeGB -lt 1) {
        $status = if ($status -eq "ok") { "warning" } else { $status }
        $issues += "Espacio libre bajo: ${freeGB} GB"
    }

    $message = if ($issues.Count -gt 0) {
        $issues -join " | "
    } else {
        "Share OK — $itemCount elementos | Último: $latestName$(if ($ageHours -ne $null) { " (${ageHours}h)" })"
    }

    Write-Log "Share: $SMB_PATH | Items: $itemCount | Último: $latestName | Libre: ${freeGB} GB"

    $payload = @{
        path           = $SMB_PATH
        item_count     = $itemCount
        latest_item    = $latestName
        latest_date    = if ($latestDate) { $latestDate.ToString("yyyy-MM-ddTHH:mm:ss") } else { $null }
        age_hours      = $ageHours
        free_gb        = $freeGB
        script_version = $SCRIPT_VERSION
    }

    Send-Heartbeat $status $message $payload

} catch {
    Write-Log "ERROR al leer $SMB_PATH : $_"
    Send-Heartbeat "error" "Error al leer el share: $($_.Exception.Message)" @{
        path           = $SMB_PATH
        error          = $_.Exception.Message
        script_version = $SCRIPT_VERSION
    }
} finally {
    Remove-PSDrive -Name "SMBCheck" -ErrorAction SilentlyContinue
    net use $SMB_PATH /delete 2>$null | Out-Null
}
