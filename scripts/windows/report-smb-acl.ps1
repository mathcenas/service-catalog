# =============================================================
# report-smb-acl.ps1 — Snapshot de usuarios y permisos SMB en Windows
# Envía al Service Catalog para visualización y exportación.
# Requiere: config.ps1 en la misma carpeta
# Schedulear (opcional, ej: semanalmente):
#   schtasks /create /tn "SMB ACL Report" /tr "powershell -File C:\Scripts\report-smb-acl.ps1" /sc weekly /d MON /st 06:00
# =============================================================

. "$PSScriptRoot\config.ps1"
[System.Net.WebRequest]::DefaultWebProxy = New-Object System.Net.WebProxy

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$OutputEncoding = [System.Text.Encoding]::UTF8

# ---------- Log ----------
$LogDir  = "$PSScriptRoot\logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$LogFile = "$LogDir\smb-acl-$(Get-Date -Format 'yyyy-MM').log"
function Write-Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
    Write-Host $line
}
Get-ChildItem "$LogDir\smb-acl-*.log" -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-31) } |
    Remove-Item -Force

# ---------- URL del endpoint ----------
# Extraer base URL de SUPABASE_URL o INGEST_URL y construir el endpoint propio
$BaseUrl = ($INGEST_URL -replace '/functions/v1/.*', '')
if (-not $BaseUrl) { $BaseUrl = ($HEARTBEAT_URL -replace '/functions/v1/.*', '') }
$AclIngestUrl = "$BaseUrl/functions/v1/ingest-nas-acl"

$headers = @{
    "Content-Type"    = "application/json"
    "apikey"          = $ANON_KEY
    "Authorization"   = "Bearer $ANON_KEY"
    "X-Ingest-Secret" = $INGEST_SECRET
}

Write-Log "=== inicio report-smb-acl ==="
Write-Log "HOST=$env:COMPUTERNAME | SERVICE_ID=$SERVICE_ID"

# ---------- Shares SMB ----------
Write-Log "Recopilando shares SMB..."

$shares = @()
try {
    $smbShares = Get-SmbShare | Where-Object { $_.Special -eq $false }

    foreach ($share in $smbShares) {
        $perms = @()
        try {
            $access = Get-SmbShareAccess -Name $share.Name -ErrorAction Stop
            foreach ($ace in $access) {
                $accessRight = switch ($ace.AccessRight) {
                    'Full'   { 'read/write' }
                    'Change' { 'read/write' }
                    'Read'   { 'read only' }
                    default  { 'no access' }
                }
                $aceType = if ($ace.AccountName -match '\\') { $ace.AccountName.Split('\')[1] } else { $ace.AccountName }
                # Determinar si es usuario o grupo
                $objType = 'user'
                try {
                    $grp = [ADSI]"WinNT://./$aceType,group" 2>$null
                    if ($grp.Name) { $objType = 'group' }
                } catch {}

                $perms += @{
                    type   = $objType
                    name   = $aceType
                    access = $accessRight
                    perms  = if ($ace.AccessRight -eq 'Read') { 5 } elseif ($ace.AccessRight -eq 'Full' -or $ace.AccessRight -eq 'Change') { 7 } else { 0 }
                }
            }
        } catch {
            Write-Log "WARN: no se pudo obtener permisos de '$($share.Name)': $_"
        }

        $shares += @{
            smb_name    = $share.Name
            folder_name = $share.Name
            rel_path    = $share.Path
            comment     = $share.Description
            readonly    = $false
            guest_access = $false
            enabled     = $true
            users       = @($perms | Where-Object { $_.type -eq 'user' })
            groups      = @($perms | Where-Object { $_.type -eq 'group' })
        }
    }
} catch {
    Write-Log "ERROR al obtener shares SMB: $_"
    exit 1
}

# ---------- Usuarios locales ----------
Write-Log "Recopilando usuarios locales..."

$users = @()
try {
    $localUsers = Get-LocalUser | Where-Object { $_.Enabled -eq $true }
    foreach ($u in $localUsers) {
        $groups = @()
        try {
            $groups = (Get-LocalGroup | Where-Object {
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

# ---------- Payload ----------
$payload = @{
    service_id   = $SERVICE_ID
    hostname     = $env:COMPUTERNAME
    generated_at = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    shares       = $shares
    users        = $users
} | ConvertTo-Json -Depth 6 -Compress

# ---------- Enviar ----------
Write-Log "Enviando a $AclIngestUrl ..."
try {
    $response = Invoke-RestMethod -Uri $AclIngestUrl -Method Post -Headers $headers -Body $payload -ErrorAction Stop
    Write-Log "OK: shares=$($response.shares) usuarios=$($response.users)"
    Write-Log "=== fin OK ==="
    Invoke-Kuma -Status "up" -Msg "smb-acl OK | shares=$($response.shares) users=$($response.users)"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Write-Log "ERROR HTTP $code | $_"
    Invoke-Kuma -Status "down" -Msg "smb-acl error HTTP $code"
    exit 1
}
