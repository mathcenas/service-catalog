# MikroTik — Archivos de configuración RouterOS

Scripts que se ejecutan **en el router** (Terminal de Winbox o SSH).

| Archivo | Función |
|---------|---------|
| `setup.rsc` | Crea usuario `monitor` de solo lectura + syslog remoto hacia el VPS |
| `net-topology-report.rsc` | Exporta topología de red para el portal |

El monitoreo activo (REST API + syslog) corre en el VPS — ver `scripts/linux/mk-monitor.sh` y `scripts/linux/mk-syslog.sh`.
