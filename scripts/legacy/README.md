# Scripts legacy

Scripts del pipeline original de MikroTik (anterior a Fase 1).
Reemplazados por `linux/mk-monitor.sh` y `linux/mk-syslog.sh`.

| Archivo | Reemplazado por |
|---------|----------------|
| `mikrotik/mikrotik-heartbeat.sh` | `linux/mk-monitor.sh` |
| `mikrotik/mk-ingest.sh` | `linux/mk-monitor.sh` + `linux/mk-syslog.sh` |
| `mikrotik/ingest-telemetry.py` | `linux/mk-monitor.sh` |
| `mikrotik/mikrotik.env.example` | `linux/mk-monitor.conf.example` |
| `mikrotik/map.env.example` | `linux/mk-monitor.conf.example` |
| `mikrotik/mk-ingest.conf.example` | `linux/mk-monitor.conf.example` |
