# ACL Review Flow

Sistema de revisión periódica de usuarios SMB para servidores NAS (OpenMediavault).
Permite enviar un link tokenizado al cliente para que revise y apruebe/rechace los usuarios
que tienen acceso a las carpetas compartidas.

---

## Componentes

### 1. Ingest del snapshot NAS
El script `scripts/nas/report-smb-acl.sh` corre en el NAS y envía la lista de usuarios y
permisos SMB al panel via `ingest-nas-acl`.

### 2. Generación del link de revisión
Desde la pantalla de **Telemetría** del panel, en el panel ACL del servicio:
- Botón **Revisión** → genera un token de 15 días de validez y lo copia al portapapeles
- Se envía automáticamente un mail al cliente con el link y un botón para iniciar la revisión

### 3. Página de revisión del cliente
URL: `https://servicios.cenas-support.com/acl-review/<token>`

El cliente ve:
- Las carpetas compartidas y sus permisos (solo lectura)
- Lista de usuarios con tres acciones por usuario: **Mantener / Eliminar / Cambiar**
- Campo de nota opcional para Eliminar y Cambiar
- Botón **Enviar revisión**

### 4. Procesamiento del envío
Al enviar, `submit-acl-review`:
1. Marca el token como usado (operación atómica, previene doble envío)
2. Crea un ítem en el Roadmap con `category: audit`
3. Envía mail al admin con tabla de resultados, con CC al cliente
4. El mail incluye botón al portal del cliente

### 5. Exportación al sistema de onboarding
El script `scripts/acl-export/acl-export.py` corre semanalmente y exporta las revisiones
completadas a una carpeta compartida con el contenedor de onboarding/offboarding.

---

## Edge Functions (Supabase)

| Función | Auth | Descripción |
|---|---|---|
| `ingest-nas-acl` | X-Ingest-Secret | Recibe snapshot SMB desde el NAS |
| `get-acl-review` | `--no-verify-jwt` | Devuelve datos de revisión por token |
| `submit-acl-review` | `--no-verify-jwt` | Procesa respuesta del cliente |

> Las funciones públicas deben deployarse con `--no-verify-jwt`:
> ```bash
> supabase functions deploy get-acl-review --no-verify-jwt
> supabase functions deploy submit-acl-review --no-verify-jwt
> ```

---

## Migración de base de datos

`supabase/migrations/20260805100000_add_acl_review_tokens.sql`

- Agrega `audit` al check de categorías de `roadmap_items`
- Crea tabla `acl_review_tokens` con RLS

---

## Variables de entorno requeridas (Supabase secrets)

```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
RESEND_API_KEY
RESEND_FROM_EMAIL
RESEND_REPLY_TO
```

---

## Flujo resumido

```
NAS (cron semanal)
  └─ report-smb-acl.sh → ingest-nas-acl → service_acl_snapshots

Panel (admin)
  └─ Botón Revisión → acl_review_tokens (token 15 días) → mail al cliente

Cliente
  └─ /acl-review/:token → get-acl-review → formulario → submit-acl-review
       └─ roadmap_items (audit) + mail admin + mail cliente

Host (cron semanal, lunes)
  └─ acl-export.py → /data/acl-pending/acl_*.json → sistema onboarding
```
