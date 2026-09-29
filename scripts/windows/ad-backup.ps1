# ==========================================
# ad-backup.ps1 v1.1.0
# Backup AD + LDIF + GPO + Supabase Telemetry
# Windows Server 2022
# ==========================================

$SCRIPT_VERSION = "1.1.0"

# ---------------------------
# 1. Cargar config.ps1
# ---------------------------
. "$PSScriptRoot\config.ps1"

# ---------------------------
# 2. Validar variables
# ---------------------------
$requiredVars = @{
    SERVICE_ID    = $SERVICE_ID
    INGEST_SECRET = $INGEST_SECRET
    INGEST_URL    = $INGEST_URL
}

foreach ($kv in $requiredVars.GetEnumerator()) {
    if ([string]::IsNullOrWhiteSpace($kv.Value)) {
        throw "Variable requerida no definida: $($kv.Key)"
    }
}

# ---------------------------
# 3. Parámetros generales
# ---------------------------
$BackupRoot        = "E:\Backups\AD"
$SystemStateVolume = "E:\"
$LogRoot           = "C:\Scripts\logs"

if (!(Test-Path $BackupRoot)) { New-Item -ItemType Directory -Path $BackupRoot | Out-Null }
if (!(Test-Path $LogRoot))    { New-Item -ItemType Directory -Path $LogRoot    | Out-Null }

$Date      = Get-Date -Format "yyyy-MM-dd_HH-mm"
$StartTime = Get-Date

$LDIFPath = Join-Path $BackupRoot "LDIF_$Date"
$GPOPath  = Join-Path $BackupRoot "GPO_$Date"

New-Item -ItemType Directory -Path $LDIFPath | Out-Null
New-Item -ItemType Directory -Path $GPOPath  | Out-Null

$LogFile = Join-Path $LogRoot "ad-backup_$Date.log"
"Backup iniciado: $Date" | Out-File $LogFile

# ==========================================
# 4. System State Backup
# ==========================================
"Ejecutando System State Backup..." | Tee-Object -FilePath $LogFile -Append

$SystemStateResult = wbadmin start systemstatebackup -backuptarget:$SystemStateVolume -quiet 2>&1
$SystemStateResult | Tee-Object -FilePath $LogFile -Append

$SystemStateStatus = if ($SystemStateResult -match "Error|ERROR") { "failed" } else { "success" }

"System State finalizado con estado: $SystemStateStatus" | Tee-Object -FilePath $LogFile -Append

# ==========================================
# 5. LDIF Export
# ==========================================
"Exportando objetos del AD en LDIF..." | Tee-Object -FilePath $LogFile -Append

$DomainDN = (Get-ADDomain).DistinguishedName
$LDIFFile = Join-Path $LDIFPath "AD_export_$Date.ldif"

$LDIFResult = ldifde -f $LDIFFile -d $DomainDN -p subtree -l "*" 2>&1
$LDIFResult | Tee-Object -FilePath $LogFile -Append

$LDIFStatus = if ($LDIFResult -match "Error|ERROR") { "failed" } else { "success" }

"Export LDIF finalizado con estado: $LDIFStatus" | Tee-Object -FilePath $LogFile -Append

# ==========================================
# 6. GPO Backup
# ==========================================
"Respaldando GPO..." | Tee-Object -FilePath $LogFile -Append

Import-Module GroupPolicy

$GPOResult = Backup-GPO -All -Path $GPOPath -Comment "Backup GPO $Date" 2>&1
$GPOResult | Tee-Object -FilePath $LogFile -Append

$GPOStatus = if ($GPOResult -match "Error|ERROR") { "failed" } else { "success" }

"Backup de GPO finalizado con estado: $GPOStatus" | Tee-Object -FilePath $LogFile -Append

# ==========================================
# 7. Estado global y payload
# ==========================================
$EndTime  = Get-Date
$Duration = [int]($EndTime - $StartTime).TotalSeconds

$globalStatus = if (
    $SystemStateStatus -eq "success" -and
    $LDIFStatus        -eq "success" -and
    $GPOStatus         -eq "success"
) {
    "success"
} elseif (
    $SystemStateStatus -eq "failed" -or
    $LDIFStatus        -eq "failed" -or
    $GPOStatus         -eq "failed"
) {
    "failed"
} else {
    "warning"
}

# ==========================================
# 7.5 dsaSignature — verificar último backup AD
# Lee la metadata de replicación del DC para confirmar
# cuándo fue el último System State backup registrado.
# ==========================================
"Leyendo dsaSignature para verificar último backup AD..." | Tee-Object -FilePath $LogFile -Append

$adLastBackup      = $null
$adBackupPartitions = @()

try {
    Import-Module ActiveDirectory -ErrorAction Stop

    $domain = (Get-ADDomain -ErrorAction Stop).DNSRoot
    $ctx    = New-Object System.DirectoryServices.ActiveDirectory.DirectoryContext(
                  [System.DirectoryServices.ActiveDirectory.DirectoryContextType]::Domain, $domain)
    $dc     = [System.DirectoryServices.ActiveDirectory.DomainController]::FindOne($ctx)

    $namingContexts = (Get-ADRootDSE -ErrorAction Stop).namingContexts

    foreach ($partition in $namingContexts) {
        try {
            $meta = $dc.GetReplicationMetadata($partition)
            $sig  = $meta.Item("dsaSignature")
            if ($sig -and $sig.LastOriginatingChangeTime) {
                $ts = $sig.LastOriginatingChangeTime.ToUniversalTime().ToString("o")
                $adBackupPartitions += @{ partition = $partition; last_backup = $ts }
            }
        } catch {
            "  Partición $partition no disponible: $_" | Tee-Object -FilePath $LogFile -Append
        }
    }

    if ($adBackupPartitions.Count -gt 0) {
        $adLastBackup = ($adBackupPartitions |
            Sort-Object { [datetime]$_.last_backup } |
            Select-Object -Last 1).last_backup
        "dsaSignature OK — último backup AD: $adLastBackup" | Tee-Object -FilePath $LogFile -Append
    } else {
        "dsaSignature: no se encontraron particiones con metadata." | Tee-Object -FilePath $LogFile -Append
    }
} catch {
    "dsaSignature check falló: $_" | Tee-Object -FilePath $LogFile -Append
}

$detailsObj = @{
    systemstate = $SystemStateStatus
    ldif        = $LDIFStatus
    gpo         = $GPOStatus
    paths       = @{
        systemstate = "E:\WindowsImageBackup"
        ldif        = $LDIFPath
        gpo         = $GPOPath
    }
    log_file           = $LogFile
    script_version     = $SCRIPT_VERSION
    ad_last_backup     = $adLastBackup
    ad_backup_partitions = $adBackupPartitions
}

$body = @{
    service_id       = $SERVICE_ID
    job_name         = "nightly-ad-backup"
    status           = $globalStatus
    duration_seconds = $Duration
    backed_up_at     = $EndTime.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    details          = ($detailsObj | ConvertTo-Json -Compress)
} | ConvertTo-Json -Depth 5

# Guardar copia local para auditoría
$JsonOutFile = Join-Path $LogRoot "ad-backup_$Date.json"
$body | Out-File $JsonOutFile -Encoding UTF8

try { $null = $body | ConvertFrom-Json } catch {
    throw "JSON mal formado antes de enviar: $_"
}

# ==========================================
# 8. Enviar a Supabase
# ==========================================
$headers = @{
    "Content-Type"    = "application/json"
    "X-Ingest-Secret" = $INGEST_SECRET
}

Invoke-RestMethod -Uri $INGEST_URL -Method POST -Headers $headers -Body $body -TimeoutSec 30

"Backup completado. Estado: $globalStatus" | Tee-Object -FilePath $LogFile -Append
