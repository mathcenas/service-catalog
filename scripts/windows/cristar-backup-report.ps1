# =============================================================
# cristar-backup-report.ps1 — Reporta backup del software Cristar
# Lee el log acumulado y filtra las entradas del día de hoy
# Schedulear en Task Scheduler después de que termina el backup
# Requiere: config.ps1 en la misma carpeta
# =============================================================

. "$PSScriptRoot\config.ps1"

$LOG_PATH = "C:\Sistema\Temp\Backup_log"
$today    = (Get-Date).ToString("dd/MM/yyyy")

if (-not (Test-Path $LOG_PATH)) {
    Write-Host "❌ Log no encontrado: $LOG_PATH"
    exit 1
}

# Filtrar solo líneas de hoy
$lines = Get-Content $LOG_PATH | Where-Object { $_.StartsWith($today) }

if (-not $lines) {
    Write-Host "No hay entradas de hoy en el log"
    exit
}

# Detectar errores
$hasError = $lines | Where-Object { $_ -match "error|fallo|fail" -and $_ -notmatch "OK" }
$status   = if ($hasError) { "failed" } else { "success" }

# Contar archivos subidos OK
$uploaded = @($lines | Where-Object { $_ -match "Subido OK" })

# Sumar tamaños — formato: "(7,5 MiB)" o "(0,4 MiB)"
$totalBytes = 0
$lines | Where-Object { $_ -match "\((\d+[,\.]\d+)\s*(MiB|KiB|GiB)\)" } | ForEach-Object {
    if ($_ -match "\((\d+[,\.]\d+)\s*(MiB|KiB|GiB)\)") {
        $num  = [double]($matches[1] -replace ',', '.')
        $unit = $matches[2]
        $totalBytes += switch ($unit) {
            "GiB" { $num * 1073741824 }
            "MiB" { $num * 1048576 }
            "KiB" { $num * 1024 }
        }
    }
}

$body = @{
    service_id = $SERVICE_ID
    job_name   = "Cristar - Respaldo BD + Nube"
    status     = $status
    size_bytes = [long]$totalBytes
    details    = "archivos_subidos=$($uploaded.Count) log=$LOG_PATH"
} | ConvertTo-Json

$headers = @{
    "Content-Type"    = "application/json"
    "apikey"          = $ANON_KEY
    "Authorization"   = "Bearer $ANON_KEY"
    "X-Ingest-Secret" = $INGEST_SECRET
}

try {
    Invoke-RestMethod -Uri $INGEST_URL -Method POST -Headers $headers -Body $body | Out-Null
    Write-Host "✅ Cristar backup → $status | $($uploaded.Count) archivos | $([math]::Round($totalBytes/1MB,1)) MB"
} catch {
    Write-Host "❌ Error: $($_.Exception.Message)"
}
