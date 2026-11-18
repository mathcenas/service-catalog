# Roadmap — Service Catalog

Lo que falta hacer, por área. Lo terminado está abajo, en "Hecho".

---

## 🟡 Para publicar

Cambios que están en `claude/security-rls-review-4ptzlh` y necesitan merge a `main` y deploy.

- [ ] Web: `docker compose up -d --build client-manager` (pestaña Referencias, Actualizaciones en Telemetría, chips "Ticket TT", frecuencia por job)
- [ ] Funciones: `supabase functions deploy client-weekly-digest backup-alert-digest weekly-digest send-notification-change submit-acl-review license-reminder email-preferences send-welcome ingest-backup ingest-heartbeat sync-script-versions`
- [ ] Scripts: los equipos los bajan solos de `main` cada 48 h. Para verlos en Telemetría → Actualizaciones, correr una vez `update-scripts` a mano en cada equipo (dos veces: la primera se actualiza, la segunda reporta).

---

## 🌐 Topología de red

- [ ] Activar SNMP en los 5 switches Omada de RBUY y sumarlos al mapa
- [ ] Detección de loops (eventos RSTP) como alerta

## 📶 Reportes de red al cliente

- [ ] **Google Wifi / Nest Wifi** — no tiene API local. Opción: modo bridge detrás del router del cliente (MikroTik/UDM) para que ese router vea los equipos por DHCP.
- [ ] **Inventario desde Zoho/ManageEngine Endpoint Central** — dos caminos:
  - Distribuir `device-report.ps1` (v2) como Custom Script de tipo **User** al iniciar sesión (trae M365, usuario NAS y Office).
  - Leer por API el inventario que ya junta el agente y cargarlo en `device_reports` (sin tocar las PCs; no trae M365 ni NAS).
- [ ] Definir un servicio "Inventario de equipos" por cliente (su ingest secret va en el script distribuido).
- [ ] **Informe mensual automático** en PDF para el cliente: servicios, backups, accesos SMB, Wi-Fi, mapa de red e inventario.

## 💾 Backups

- [ ] Scripts pre/post-snapshot para Veeam Agent (apagar servicios, respaldar, volver a levantar) en los hosts de VMs.
- [ ] Revisar la revisión de carpeta de RMI: apunta a `C:\Respaldos` (debería ser `K:\Respaldo-RMI`).

## 🔐 Portal de login

- [ ] Integrar `PlatformLoginLanding` (diseñado, todavía no está en `src/`): `supportEmail` = `info@cenas.uy` y `onLogin` con Supabase Auth.

## 🛠️ Infraestructura interna

- [ ] **Stirling PDF** — activar login (`DOCKER_ENABLE_SECURITY=true`, `SECURITY_ENABLELOGIN=true`), cambiar la contraseña por defecto y dejarlo detrás de NPM (red `npm_default`).

## 🧰 Skills de Claude

- [ ] "Deploy pendiente": junta lo que falta publicar de la rama (funciones, migraciones, web, scripts).
- [ ] "Diagnóstico": revisa backups, heartbeats y alertas de un cliente y arma el resumen.

---

## ✅ Hecho

**Notificaciones y resúmenes**
- Centro de Notificaciones con contactos, frecuencias, tracking de aperturas y clics (`resend-webhook`, `email_opens`), mail de bienvenida (`send-welcome`), vista previa por versión y pestaña "Próximos envíos".
- Auditoría de todos los mails: SMART en el resumen, chips de salud, recordatorio de licencias (filtraba por una columna inexistente), preferencias del portal (`daily` → `all`, opción mensual), link al portal con `/share/<token>`.
- Página **Referencias** en el portal del cliente y link "¿Qué significa cada estado?" en los resúmenes.

**Alertas y Task Tracker**
- `sync-alert-tickets`: una tarea en Task Tracker por alerta de "Para hoy" (backup fallido/vencido, dejó de reportar, servicio caído) que se cierra sola con una nota cuando la alerta desaparece. Endpoint `POST /api/tasks/:id/resolve` en Task Tracker.
- Frecuencia esperada por servicio (diario, días hábiles, semanal, mensual) y por job dentro del servicio.

**Topología de red**
- Mapa con React Flow, tablas `net_devices`, `net_links`, `net_edges`, `net_layout_overrides`, `net_custom_nodes`; `ingest-net-topology` con `net-topology-report.rsc`; los servicios absorben los equipos descubiertos por MAC/IP.

**Scripts**
- Auto-actualizador que reporta al portal y vista Telemetría → Actualizaciones (al día / se actualiza solo / push manual).
- Veeam Agent: un solo registro por reintento, sin reenvíos al cortarse. Cobian: lectura del log UTF-16 y corridas pasada la medianoche. AnyDesk ID en todos los equipos. Umbral de temperatura propio para NVMe.
- Wi-Fi: MikroTik (`mk-wifi-report.sh` + importador), TP-Link Deco, UniFi.
