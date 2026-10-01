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

## 🌐 Infraestructura de red — Vista por cliente

**Bloqueante:** `rbuy-netinv` debe estar corriendo y empujando datos antes de construir la UI.

### Colector `rbuy-netinv` (Python/Docker)
- [ ] Activar SNMP en los 5 switches Omada de RBUY
- [ ] Confirmar que el script corre en Docker y hace push a `ingest-unifi-webhook`
  - Source: `network`, `service_id` del cliente en la tabla `services` con `telemetry_enabled = true`
- [ ] Configurar detección de loops (RSTP events) como alertas

### Scope definido (RBUY)
| Incluido | Excluido |
|---|---|
| Router WAN/LAN | Cámaras (no son del proveedor) |
| Switches Omada (con SNMP) | Access Points (no administrados) |
| Detección de loops | Inventario de dispositivos |
| Alertas de conectividad | |

### Frontend
- [ ] Subpage "Infraestructura" en el detalle de cliente
  - Cards por dispositivo (router, switches) con estado, uptime, throughput
  - Badge de alerta si hay loop detectado
  - Indicador de última señal (usa `cardStaleLevel` ya implementado)

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
