# Roadmap — Service Catalog

Proyectos y tareas pendientes organizados por área. Actualizado en conversación con el equipo.

---

## 🟡 Deploy pendiente

> Estos cambios ya están en el branch `claude/security-rls-review-4ptzlh` pero aún no se desplegaron en Supabase.

- [ ] `supabase functions deploy ingest-backup`
  - Fix `clientName` ReferenceError → 500 en daily summary POST
  - Filtro `digest_frequency = 'daily'` (antes llegaba a contactos semanales)
  - Cooldown backup_success subido a 23h (antes llegaba cada hora)
  - Display name del remitente: "Cenas IT Backups" (antes "Cenas-Support Backups")

---

## 📬 Centro de Notificaciones

**Objetivo:** vista tipo software de suscripciones para gestionar qué contactos reciben qué alertas, con tracking de apertura y clics.

### Backend
- [ ] Tabla `email_events` en Supabase
  - Campos: `id`, `contact_id`, `email_id` (Resend), `event_type` (sent/opened/clicked/bounced), `metadata` (service_id, backup_id, etc.), `occurred_at`
- [ ] Edge function `ingest-resend-webhook`
  - Recibe eventos de Resend (`email.opened`, `email.clicked`, `email.delivered`, `email.bounced`)
  - Guarda en `email_events` correlacionando con `service_backups` via `email_id`
- [ ] Edge function `send-welcome`
  - Se dispara al crear un contacto nuevo en `client_contacts`
  - Email: "Tu casilla fue dada de alta para alertas de IT — [Cliente]"
  - Guarda el `email_id` devuelto por Resend para tracking

### Frontend
- [ ] Ruta `/notifications` en el app React
  - Tabla de contactos con frecuencia, estado de confirmación y columna de tracking (enviados/abiertos/clics)
  - Panel lateral de detalle: timeline de eventos, selector de frecuencia inline, acción "reenviar bienvenida"
  - KPIs: suscriptores activos, tasa de apertura 30d, pendientes confirmación, dados de baja

### Decisión técnica
Implementar sobre **Resend + Supabase** (webhooks nativos). No usar Mautic ni MailPoet — modelo B2B con contactos gestionados manualmente, no suscripción masiva.

---

## 🌐 Topología de Red

### Frontend ✅ base lista
- [x] `src/components/TopologyCanvas.tsx` — ReactFlow, modo lock/edit, persistencia de posición por nodo
- [x] `src/components/nodes/MikroTikNode.tsx` — uptime, throughput in/out, estado online/offline
- [x] `src/components/nodes/UnmanagedNode.tsx` — switches genéricos
- [x] `src/components/nodes/EndpointNode.tsx` — servers y workstations
- [x] `src/pages/NetworkTopologyPage.tsx` — selector cliente + site, mock data RBUY (central + sucursal)
- [ ] Agregar ruta `/network` en `App.tsx`
- [ ] Reemplazar mock data por fetch a `net_devices` + `net_edges` cuando el colector esté activo

### Base de datos (pendiente migración)
- [ ] Tabla `net_devices` — `client_id`, `site_id`, `device_id`, `type`, `hostname`, `ip`, `model`, `status`, `uptime_seconds`, `throughput_in/out_bps`, `raw_data`, `source`, `last_seen_at`
- [ ] Tabla `net_edges` — `client_id`, `site_id`, `source_device_id`, `target_device_id`, `link_type`
- [ ] Tabla `net_layout_overrides` — `client_id`, `site_id`, `device_id`, `x`, `y` · UNIQUE `(client_id, site_id, device_id)`

### Colector `rbuy-netinv` (Python/Docker) — bloqueante para datos reales
- [ ] Activar SNMP en los 5 switches Omada de RBUY
- [ ] Edge function `ingest-net-topology` — recibe payload de UniFi y MikroTik, upsert en `net_devices` + `net_edges`
- [ ] Confirmar push via webhook con `source` = `rbuy-netinv` o `mikrotik-collector`
- [ ] Configurar detección de loops (RSTP events) como alertas

### Scope definido (RBUY)
| Incluido | Excluido |
|---|---|
| Router WAN/LAN | Cámaras (no son del proveedor) |
| Switches Omada (con SNMP) | Access Points (no administrados) |
| Detección de loops | Inventario de dispositivos |
| Alertas de conectividad | |

---

## 📶 Reportes de red al cliente

**Objetivo:** que el cliente reciba qué equipos usan su red (Wi-Fi e inventario) sin armarlo a mano.

### Dispositivos Wi-Fi por marca de equipo
- [x] **MikroTik** — `mk-wifi-report.sh` (VPS, REST API) + importador de `print terse` en Telemetría → Wi-Fi
- [x] **TP-Link Deco** — `scripts/linux/deco-wifi-report.py` (API local vía `tplinkrouterc6u`; corre en Linux o Windows de la red del cliente)
- [ ] **UniFi (UDM / UDM Pro / Cloud Gateway)** — script que lea los clientes de la API local de UniFi Network (API key de la Integration API en Network 9+, o usuario local de solo lectura) y los mande a `ingest-wifi-clients`. Trae SSID, AP, señal y si es cableado: es la fuente con mejores datos.
- [ ] **Google Wifi / Nest Wifi** — no tiene API local ni exportación (solo app Google Home). Opción: ponerlo en modo bridge detrás del router del cliente (MikroTik/UDM) para que ese router vea los equipos por DHCP. En modo NAT los dispositivos quedan ocultos detrás del Google Wifi.

### Inventario de equipos desde Zoho/ManageEngine Endpoint Central
- [ ] Que el agente de Endpoint Central genere el device report. Dos caminos a evaluar:
  - **Script por agente:** distribuir `device-report.ps1` (v2, reporta directo al portal) como Custom Script de tipo **User**, en cada inicio de sesión. Corre como el usuario, así salen M365, usuario NAS y Office.
  - **API de Endpoint Central:** leer desde el servidor el inventario que ya junta el agente (hardware, software, último usuario logueado) y cargarlo en `device_reports`, sin tocar las PCs. No trae usuario M365 ni NAS.
- [ ] Definir un servicio "Inventario de equipos" por cliente (su ingest secret queda en el script distribuido).

### Entrega al cliente
- [ ] Sumar Wi-Fi, mapa de red e inventario al portal del cliente, o un **informe mensual automático** en PDF que junte servicios, backups, accesos SMB, Wi-Fi e inventario.

---

## 🔐 Portal de Login

- [ ] Integrar el componente `PlatformLoginLanding` en el app (ya diseñado)
  - Cambiar `supportEmail` default a `info@cenas.uy`
  - Conectar `onLogin` con Supabase Auth

---

## 🛠️ Infraestructura interna

- [ ] **Stirling PDF** — configurar usuarios via `DOCKER_ENABLE_SECURITY=true` + `SECURITY_ENABLELOGIN=true`
  - Contenedor reseteado, credenciales: admin/stirling
  - Integrado con NPM sobre red `npm_default`

---

## ✅ Completado recientemente

- [x] Banners de señal silenciada en `TelemetryDashboard` (24h warn / 72h dead)
- [x] Fix digest_frequency filter en `ingest-backup` (solo `daily`)
- [x] Cooldown backup_success a 23h
- [x] Fix clientName ReferenceError → 500
- [x] Display name email: "Cenas IT Backups"
- [x] Script `veeam-report.ps1` — resumen diario con `suppress_email` por job
