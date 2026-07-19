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
│   ├── backup-ingest.env           # Configuración por servidor Linux
│   └── report-backup.sh            # Reporte individual de snapshot rsnapshot/rsync
└── nas/
    ├── backup-ingest.env           # Configuración NAS OpenMediaVault (con paths)
    └── report-all-backups.sh       # Reporte de todos los snapshots del NAS
```

## Instalación Windows

1. Copiar carpeta `windows/` a `C:\scripts\`
2. Editar `config.ps1` con los valores del cliente
3. Schedulear en Task Scheduler o configurar como Post-Job en Veeam

## Instalación Linux / NAS

```bash
cp backup-ingest.env /etc/backup-ingest.env
chmod 600 /etc/backup-ingest.env
cp report-backup.sh /usr/local/bin/report-backup.sh
chmod +x /usr/local/bin/report-backup.sh
```

Editar `/etc/backup-ingest.env` con SERVICE_ID e INGEST_SECRET del servicio en el catálogo.

### Crontab NAS

```cron
0 8 * * * /usr/local/bin/report-all-backups.sh
```

## Edge Functions utilizadas

| Script | Edge Function |
|--------|--------------|
| veeam-report.ps1 | `ingest-backup` |
| veeam-agent-report.ps1 | `ingest-backup` |
| cristar-backup-report.ps1 | `ingest-backup` |
| report-backup.sh | `ingest-backup` |
| report-all-backups.sh | `ingest-backup` |
| system-health.ps1 | `ingest-heartbeat` |
