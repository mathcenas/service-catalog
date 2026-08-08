# MikroTik — Integración con Service Catalog

Dos scripts que trabajan juntos:

| Script | Función | Frecuencia |
|---|---|---|
| `mikrotik-heartbeat.sh` | Envía el último valor de CPU/RAM/WAN/IPsec como heartbeat | Cada minuto |
| `ingest-telemetry.py` | Inserta todas las líneas nuevas del log en `device_telemetry` (serie histórica) | Cada 5 min |

---

## Requisitos

- Bash 4+ y `curl` (heartbeat)
- Python 3.8+ sin dependencias externas (telemetría)
- Acceso de lectura al directorio de logs del network-monitor

---

## Paso 1 — Credenciales

Crear `/etc/mikrotik-ingest.env` (o `scripts/mikrotik/.env`):

```bash
SUPABASE_URL="https://TU-PROYECTO.supabase.co"
SUPABASE_ANON_KEY="eyJ..."        # clave anon (para heartbeat)
SUPABASE_SERVICE_KEY="eyJ..."     # clave service_role (para telemetría histórica)
INGEST_SECRET="el-mismo-secreto-del-servicio-en-la-plataforma"

MIKROTIK_LOG_DIR="/srv/network-monitor/network-monitor/historial"
MIKROTIK_STATE_DIR="/srv/scripts/mikrotik/state"
```

La `INGEST_SECRET` es el valor que figura en cada servicio dentro de la plataforma (pestaña de configuración del servicio).

---

## Paso 2 — Mapeo de routers

Copiar y completar:

```bash
cp scripts/mikrotik/map.env.example scripts/mikrotik/map.env
```

```ini
# map.env — nombre del archivo de log (sin .log) = service_id en Supabase
RegionalSur=3f8a1c2d-xxxx-xxxx-xxxx-xxxxxxxxxxxx
RegionalNorte=7b4e9f0a-xxxx-xxxx-xxxx-xxxxxxxxxxxx

# Uptime Kuma (opcional — sin esto no pinga Kuma, sin errores)
# RegionalSur_kuma=https://kuma.tudominio.com/api/push/AbCdEfGhIj
```

**¿Dónde encuentro el service_id?**
En la plataforma, al abrir un servicio el UUID aparece en la URL. O en Supabase:
```sql
select id, name from services;
```

El archivo se puede colocar en:
- `scripts/mikrotik/map.env` ← detectado automáticamente
- `/etc/mikrotik-map.env` ← alternativa del sistema
- Ruta custom via variable `MIKROTIK_MAP_FILE`

---

## Paso 3 — Crontab

```cron
# Heartbeat cada minuto
* * * * * /srv/scripts/mikrotik/mikrotik-heartbeat.sh >> /var/log/mikrotik-heartbeat.log 2>&1

# Telemetría histórica cada 5 minutos
*/5 * * * * SUPABASE_SERVICE_KEY="eyJ..." /usr/bin/python3 /srv/scripts/mikrotik/ingest-telemetry.py >> /var/log/mikrotik-ingest.log 2>&1
```

> Si `SUPABASE_SERVICE_KEY` ya está en el `.env`, el heartbeat script lo carga automáticamente.  
> Para el Python, pasarlo como variable de entorno en el cron o exportarlo en `/etc/environment`.

---

## Docker (opcional)

Si los scripts corren dentro de un contenedor, montar los volúmenes necesarios:

```yaml
volumes:
  - /srv/network-monitor/network-monitor/historial:/data/mikrotik:ro
  - /srv/scripts/mikrotik/state:/data/mikrotik-state
  - /srv/scripts/mikrotik/map.env:/etc/mikrotik-map.env:ro
```

Y en el `.env` del contenedor:
```bash
MIKROTIK_LOG_DIR=/data/mikrotik
MIKROTIK_STATE_DIR=/data/mikrotik-state
MIKROTIK_MAP_FILE=/etc/mikrotik-map.env
```

---

## Formato del log esperado

```
[2026-08-07T11:11:46.493Z] METRICAS | CPU: 15% | RAM: 40.6% | WAN In: 16.15 Mbps | IPsec: OFFLINE
```

Un archivo `.log` por router, nombrado igual que el servicio en `map.env`.

---

## Logs y troubleshooting

```bash
# Heartbeat
tail -f /var/log/mikrotik-heartbeat.log

# Telemetría
tail -f /var/log/mikrotik-ingest.log
```

Salidas esperadas:
```
✓ RegionalSur → success | CPU: 15% | RAM: 40.6% | WAN: 5.12 Mbps | IPsec: OFFLINE
OK RegionalSur — 47 filas insertadas (último: 2026-08-07T11:30:47.525Z)
```
