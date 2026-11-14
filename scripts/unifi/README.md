# UniFi — controladora en el VPS y reporte Wi-Fi

Una controladora UniFi Network en el VPS para los clientes con APs UniFi sueltos (sin UDM), y un script que manda los clientes Wi-Fi al portal (Telemetría → Wi-Fi).

## 1. Levantar la controladora

```bash
mkdir -p /srv/unifi && cd /srv/unifi
curl -fsSLO https://raw.githubusercontent.com/mathcenas/service-catalog/main/scripts/unifi/docker-compose.yml
docker compose up -d
```

- La UI queda en `127.0.0.1:8443`: entrá con un túnel (`ssh -L 8443:localhost:8443 usuario@vps`) y abrí `https://localhost:8443`, o publicala por NPM con acceso restringido.
- En el firewall del VPS abrí **8080/tcp** y **3478/udp** solo para las IP públicas de los clientes.
- Creá un **site por cliente** (Settings → Site → New Site).

## 2. Adoptar los APs a distancia

Los APs tienen que saber la dirección de la controladora. Cualquiera de estas opciones:

- **DNS en el MikroTik del cliente** (la más simple, sirve para todos los APs nuevos):
  ```
  /ip dns static add name=unifi address=IP_DEL_VPS
  ```
  Los APs de fábrica buscan `unifi` y se presentan solos.
- **Por SSH a cada AP** (de fábrica: usuario/clave `ubnt`/`ubnt`):
  ```
  set-inform http://IP_DEL_VPS:8080/inform
  ```

El AP aparece en la controladora como "Pending adoption" → **Adopt** (en el site del cliente). Si queda en "Adopting", repetí el `set-inform` una vez más.

## 3. Reporte Wi-Fi al portal

1. En la controladora: **Settings → Admins → Add**, usuario local de solo lectura (ej. `reporte`).
2. Copiá `unifi-report.example.json` como `unifi-report.json` y completá: usuario, clave y por cada site su `site` (id corto que aparece en la URL `/manage/site/<id>/`), `service_id` e `ingest_secret` del servicio del cliente en el portal.
3. Probá: `python3 unifi-wifi-report.py --dry-run`
4. Cron cada hora:
   ```
   20 * * * * /usr/bin/python3 /srv/unifi/unifi-wifi-report.py >> /srv/unifi/logs/report.log 2>&1
   ```

Para un **UDM / Cloud Gateway** del cliente: `"controller": "https://IP_DEL_UDM"` y `"unifi_os": true`, con un usuario local de solo lectura de ese UDM. Ese caso tiene que correr desde un equipo que llegue al UDM.

El nombre que le pongas a un dispositivo en la controladora (alias) llega al portal como nombre del equipo.
