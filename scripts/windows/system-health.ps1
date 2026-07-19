# =============================================================
# system-health.ps1 — Reporta disco C: y RAM al heartbeat
# Schedulear en Task Scheduler cada 1 hora
# Requiere: config.ps1 en la misma carpeta
# =============================================================

. "$PSScriptRoot\config.ps1"

$disk = Get-PSDrive C | Select-Object Used, Free
$ram  = Get-WmiObject Win32_OperatingSystem

$diskUsedPct = [math]::Round(($disk.Used / ($disk.Used + $disk.Free)) * 100, 1)
$ramUsedPct  = [math]::Round((1 - $ram.FreePhysicalMemory / $ram.TotalVisibleMemorySize) * 100, 1)

$status = if ($diskUsedPct -gt 90 -or $ramUsedPct -gt 90) { "error" }
          elseif ($diskUsedPct -gt 75 -or $ramUsedPct -gt 75) { "warning" }
          else { "ok" }

$body = @{
    service_id = $SERVICE_ID
    source     = "system-health"
    status     = $status
    message    = "Disk C: $diskUsedPct% | RAM: $ramUsedPct%"
    payload    = @{
        disk_used_pct = $diskUsedPct
        ram_used_pct  = $ramUsedPct
        disk_free_gb  = [math]::Round($disk.Free / 1GB, 1)
        ram_total_gb  = [math]::Round($ram.TotalVisibleMemorySize / 1MB, 1)
    }
} | ConvertTo-Json -Depth 3

$headers = @{
    "Content-Type"  = "application/json"
    "apikey"        = $ANON_KEY
    "Authorization" = "Bearer $ANON_KEY"
}

try {
    Invoke-RestMethod -Uri $HEARTBEAT_URL -Method POST -Headers $headers -Body $body | Out-Null
    Write-Host "✅ Health → $status | Disk: $diskUsedPct% | RAM: $ramUsedPct%"
} catch {
    Write-Host "❌ Error: $($_.Exception.Message)"
}
