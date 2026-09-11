# =============================================================
# smb-check.ps1 — Monitoreo y reporte ACL de carpeta compartida SMB
#
# Corre en el mismo servidor que hostea la carpeta compartida.
# Hace dos cosas:
#   1. Health check: verifica acceso, items, espacio libre → heartbeat
#   2. ACL snapshot: usuarios locales + permisos por share → ingest-nas-acl
#
# Schedulear en Task Scheduler (ej: cada 1 hora para health, semanal para ACL):
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Scripts\smb-check.ps1"
#
# Para correr solo el ACL snapshot manualmente:
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Scripts\smb-check.ps1" -AclOnly
#
# Requiere en config.ps1:
#   $SMB_SERVICE_ID    — UUID del servicio en la app
#   $SMB_INGEST_SECRET — Ingest secret del servicio SMB
#   $SMB_KUMA_PUSH_URL — Push monitor de Kuma para el share
#   $SMB_PATH          — Ruta local de la carpeta, ej: C:\Compartidos\Ventas
#                        o ruta UNC local: \\localhost\Ventas
# =============================================================

param([switch]$AclOnly)

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
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
    Write-Host $line
}
Get-ChildItem "$LogDir\smb-check-*.log" -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-90) } |
    Remove-Item -Force

$BaseUrl          = ($INGEST_URL -replace '/functions/v1/.*', '')
if (-not $BaseUrl) { $BaseUrl = ($HEARTBEAT_URL -replace '/functions/v1/.*', '') }
$AclIngestUrl     = "$BaseUrl/functions/v1/ingest-nas-acl"

$headersHeartbeat = @{
    "Content-Type"    = "application/json"
    "apikey"          = $ANON_KEY
    "Authorization"   = "Bearer $ANON_KEY"
    "X-Ingest-Secret" = $SMB_INGEST_SECRET
}
$headersAcl = @{
    "Content-Type"    = "application/json"
    "apikey"          = $ANON_KEY
    "Authorization"   = "Bearer $ANON_KEY"
    "X-Ingest-Secret" = $SMB_INGEST_SECRET
}

Write-Log "=== inicio smb-check | HOST=$env:COMPUTERNAME | AclOnly=$AclOnly ==="

# ==============================================================
# PARTE 1 — HEALTH CHECK (omitir si -AclOnly)
# ==============================================================
if (-not $AclOnly) {

    if (-not $SMB_PATH) {
        Write-Log "ERROR: SMB_PATH no configurado en config.ps1"
        exit 1
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
            Invoke-RestMethod -Uri $HEARTBEAT_URL -Method POST -Headers $headersHeartbeat -Body $body -ErrorAction Stop | Out-Null
            Write-Log "Heartbeat: $status — $message"
        } catch {
            Write-Log "ERROR heartbeat: $_"
        }
        Invoke-SmbKuma -Status $(if ($status -eq 'error') { 'down' } elseif ($status -eq 'warning') { 'warn' } else { 'up' }) -Msg $message
    }

    if (-not (Test-Path $SMB_PATH)) {
        Write-Log "ERROR: ruta no encontrada: $SMB_PATH"
        Send-Heartbeat "error" "Ruta no encontrada: $SMB_PATH" @{ path = $SMB_PATH; script_version = $SCRIPT_VERSION }
        exit 1
    }

    try {
        $items     = Get-ChildItem -Path $SMB_PATH -ErrorAction Stop
        $itemCount = $items.Count
        $latest    = $items | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        $latestName = if ($latest) { $latest.Name } else { "(vacío)" }
        $latestDate = if ($latest) { $latest.LastWriteTime } else { $null }
        $ageHours   = if ($latestDate) { [math]::Round(((Get-Date) - $latestDate).TotalHours, 1) } else { $null }

        $freeGB = $null
        try {
            $drive  = Split-Path -Qualifier $SMB_PATH
            $disk   = Get-PSDrive -Name $drive.TrimEnd(':') -ErrorAction SilentlyContinue
            if ($disk -and $disk.Free) { $freeGB = [math]::Round($disk.Free / 1GB, 2) }
        } catch {}

        $status = "ok"
        $issues = @()
        if ($itemCount -eq 0) { $status = "warning"; $issues += "Carpeta vacía" }
        if ($freeGB -ne $null -and $freeGB -lt 1) {
            $status = if ($status -eq "ok") { "warning" } else { $status }
            $issues += "Espacio libre bajo: ${freeGB} GB"
        }

        $message = if ($issues.Count -gt 0) { $issues -join " | " } else {
            "Share OK — $itemCount elementos | Último: $latestName$(if ($ageHours -ne $null) { " (${ageHours}h)" })"
        }

        Write-Log "Path: $SMB_PATH | Items: $itemCount | Último: $latestName | Libre: ${freeGB} GB"

        Send-Heartbeat $status $message @{
            path           = $SMB_PATH
            item_count     = $itemCount
            latest_item    = $latestName
            latest_date    = if ($latestDate) { $latestDate.ToString("yyyy-MM-ddTHH:mm:ss") } else { $null }
            age_hours      = $ageHours
            free_gb        = $freeGB
            script_version = $SCRIPT_VERSION
        }

    } catch {
        Write-Log "ERROR al leer $SMB_PATH : $_"
        Send-Heartbeat "error" "Error al leer la carpeta: $($_.Exception.Message)" @{
            path           = $SMB_PATH
            error          = $_.Exception.Message
            script_version = $SCRIPT_VERSION
        }
        exit 1
    }
}

# ==============================================================
# PARTE 2 — ACL SNAPSHOT (siempre corre, o solo con -AclOnly)
# ==============================================================
Write-Log "Recopilando shares SMB y usuarios..."

$shares = @()
try {
    foreach ($share in (Get-SmbShare | Where-Object { $_.Special -eq $false })) {
        $perms = @()
        try {
            foreach ($ace in (Get-SmbShareAccess -Name $share.Name -ErrorAction Stop)) {
                $accessRight = switch ($ace.AccessRight) {
                    'Full'   { 'read/write' }
                    'Change' { 'read/write' }
                    'Read'   { 'read only' }
                    default  { 'no access' }
                }
                $aceName = if ($ace.AccountName -match '\\') { $ace.AccountName.Split('\')[1] } else { $ace.AccountName }
                $objType = 'user'
                try {
                    $grp = [ADSI]"WinNT://./$aceName,group" 2>$null
                    if ($grp.Name) { $objType = 'group' }
                } catch {}
                $perms += @{
                    type   = $objType
                    name   = $aceName
                    access = $accessRight
                    perms  = if ($ace.AccessRight -eq 'Read') { 5 } elseif ($ace.AccessRight -in 'Full','Change') { 7 } else { 0 }
                }
            }
        } catch {
            Write-Log "WARN: permisos de '$($share.Name)': $_"
        }

        # Espacio del disco donde vive el share
        $diskInfo = @{}
        if ($share.Path) {
            try {
                $qualifier = Split-Path -Qualifier $share.Path
                $driveObj  = Get-PSDrive -Name $qualifier.TrimEnd(':') -ErrorAction SilentlyContinue
                if ($driveObj) {
                    $totalGB = [math]::Round(($driveObj.Used + $driveObj.Free) / 1GB, 1)
                    $freeGB  = [math]::Round($driveObj.Free / 1GB, 2)
                    $usedPct = if (($driveObj.Used + $driveObj.Free) -gt 0) {
                        [math]::Round($driveObj.Used / ($driveObj.Used + $driveObj.Free) * 100)
                    } else { 0 }
                    $diskInfo = @{ disk_total_gb = $totalGB; disk_free_gb = $freeGB; disk_used_pct = $usedPct }
                }
            } catch {}
        }

        $entry = @{
            smb_name     = $share.Name
            folder_name  = $share.Name
            rel_path     = $share.Path
            comment      = $share.Description
            readonly     = $false
            guest_access = $false
            enabled      = $true
            users        = @($perms | Where-Object { $_.type -eq 'user' })
            groups       = @($perms | Where-Object { $_.type -eq 'group' })
        }
        foreach ($k in $diskInfo.Keys) { $entry[$k] = $diskInfo[$k] }
        $shares += $entry
    }
} catch {
    Write-Log "ERROR al obtener shares: $_"
}

$users = @()
try {
    foreach ($u in (Get-LocalUser | Where-Object { $_.Enabled -eq $true })) {
        $groups = @()
        try {
            $groups = @(Get-LocalGroup | Where-Object {
                (Get-LocalGroupMember -Group $_.Name -ErrorAction SilentlyContinue |
                    Where-Object { $_.Name -like "*\$($u.Name)" }).Count -gt 0
            } | Select-Object -ExpandProperty Name)
        } catch {}

        $lastLogin = $null
        if ($u.LastLogon -and $u.LastLogon -gt [datetime]'1970-01-01') {
            $lastLogin = $u.LastLogon.ToString('ddd, dd MMM yyyy HH:mm:ss UTC')
        }

        $users += @{
            name       = $u.Name
            uid        = $u.SID.Value
            comment    = $u.Description
            groups     = $groups
            last_login = $lastLogin
        }
    }
} catch {
    Write-Log "ERROR al obtener usuarios: $_"
}

Write-Log "Shares: $($shares.Count) | Usuarios: $($users.Count)"

$aclPayload = @{
    service_id   = $SMB_SERVICE_ID
    hostname     = $env:COMPUTERNAME
    generated_at = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    shares       = $shares
    users        = $users
} | ConvertTo-Json -Depth 6 -Compress

Write-Log "Enviando ACL snapshot a $AclIngestUrl ..."
try {
    $response = Invoke-RestMethod -Uri $AclIngestUrl -Method Post -Headers $headersAcl -Body $aclPayload -ErrorAction Stop
    Write-Log "ACL OK: shares=$($response.shares) usuarios=$($response.users)"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Write-Log "ERROR ACL HTTP $code | $_"
}

Write-Log "=== fin smb-check ==="
