# Scripts de Monitoreo e Integración

Scripts para reportar backups y salud del sistema al Service Catalog.

## Estructura

```
scripts/
├── windows/
│   ├── config.ps1                  # Configuración por cliente (SERVICE_ID, INGEST_SECRET, etc.)
│   ├── veeam-report.ps1            # Veeam Backup & Replication (servidor central)
│   ├── veeam-agent-report.ps1      # Veeam Agent for Windows (standalone)
│   ├── system-health.ps1           # Disco C: y RAM → ingest-heartbeat
│   └── cristar-backup-report.ps1   # Software de facturación Cristar (lee log)
├── linux/
│   ├── backup.sh                   # Backup completo de VPS (tar + rsync/rclone + reporte)
│   ├── backup.env.example          # Plantilla de configuración para backup.sh
│   ├── backup-ingest.env           # Configuración para report-backup.sh (rsnapshot standalone)
│   └── report-backup.sh            # Reporte individual de snapshot rsnapshot/rsync
└── nas/
    ├── backup-ingest.env           # Configuración NAS OpenMediaVault (con paths de snapshots)
    └── report-all-backups.sh       # Reporte de todos los snapshots del NAS/OMV al panel
```

## Windows

1. Copiar carpeta `windows/` al servidor (ej: `E:\SoporteIT\`)
2. Editar `config.ps1` con los valores del cliente
3. Schedulear en Task Scheduler o configurar como Post-Job en Veeam

## Linux — Backup de VPS (`backup.sh`)

Para VPS con Docker donde se quiere hacer backup de directorios + reporte automático al panel.

```bash
# En el servidor
cp backup.sh /srv/cloud-backup/backup.sh
cp backup.env.example /srv/cloud-backup/.env
chmod +x /srv/cloud-backup/backup.sh
chmod 600 /srv/cloud-backup/.env
```

Editar `.env` con los directorios (`SRC_DIRS`), retención (`RETENTION_DAYS`) y las 4 variables de ingest.

```bash
# Ejecutar manualmente para probar
/srv/cloud-backup/backup.sh

# Crontab: todos los días a las 2am
0 2 * * * /srv/cloud-backup/backup.sh
```

## Linux — Reporte rsnapshot (`report-backup.sh`)

Para servidores donde rsnapshot/rsync ya corre por separado y solo se quiere reportar el resultado.

```bash
cp backup-ingest.env /etc/backup-ingest.env
chmod 600 /etc/backup-ingest.env
cp report-backup.sh /usr/local/bin/report-backup.sh
chmod +x /usr/local/bin/report-backup.sh
```

Llamar después de cada snapshot:
```bash
report-backup.sh "Daily Backup" $? /srv/snapshots/daily.0
```

## NAS / OpenMediaVault (`report-all-backups.sh`)

Para NAS con OMV donde rsnapshot crea los snapshots. El script recorre todos los snapshots
del período y reporta cada uno al panel automáticamente.

```bash
cp backup-ingest.env /etc/backup-ingest.env
chmod 600 /etc/backup-ingest.env
cp report-all-backups.sh /usr/local/bin/report-all-backups.sh
chmod +x /usr/local/bin/report-all-backups.sh
```

```cron
# Crontab: todos los días a las 8am
0 8 * * * /usr/local/bin/report-all-backups.sh
```

## Edge Functions utilizadas

| Script | Edge Function |
|--------|--------------|
| `backup.sh` | `ingest-backup` |
| `veeam-report.ps1` | `ingest-backup` |
| `veeam-agent-report.ps1` | `ingest-backup` |
| `cristar-backup-report.ps1` | `ingest-backup` |
| `report-backup.sh` | `ingest-backup` |
| `report-all-backups.sh` | `ingest-backup` |
| `system-health.ps1` | `ingest-heartbeat` |
