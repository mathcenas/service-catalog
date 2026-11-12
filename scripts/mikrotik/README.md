# MikroTik — Archivos de configuración RouterOS

Scripts que se ejecutan **en el router** (Terminal de Winbox o SSH).

| Archivo | Función |
|---------|---------|
| `setup.rsc` | Crea usuario `monitor` de solo lectura + syslog remoto hacia el VPS |
| `net-topology-report.rsc` | Exporta topología de red para el portal |

El monitoreo activo (REST API + syslog) corre en el VPS — ver `scripts/linux/mk-monitor.sh` y `scripts/linux/mk-syslog.sh`.

## Reporte de dispositivos Wi-Fi

`scripts/linux/mk-wifi-report.sh` corre en el VPS de monitoreo, al lado de `mk-monitor.sh`, y usa la misma `mk-monitor.conf`.
Lee la tabla de registración Wi-Fi del router (`/interface/wifi`, `wifiwave2`, `wireless` o `caps-man`), la cruza con los leases DHCP y ARP, y la manda al portal (Telemetría → Wi-Fi, con exportación a PDF).

```bash
curl -fsSL https://raw.githubusercontent.com/mathcenas/service-catalog/main/scripts/linux/mk-wifi-report.sh \
  -o /srv/network-monitor/mk-wifi-report.sh && chmod +x /srv/network-monitor/mk-wifi-report.sh
# crontab -e  (cada hora)
7 * * * * /srv/network-monitor/mk-wifi-report.sh >> /srv/network-monitor/logs/mk-wifi-report.log 2>&1
```

- Para que un dispositivo aparezca con nombre, poné un comentario en su lease DHCP en el router.
- `SITE_N_WIFI="false"` en la config saltea un router sin Wi-Fi.
- El usuario `monitor` de solo lectura (`setup.rsc`) alcanza.

