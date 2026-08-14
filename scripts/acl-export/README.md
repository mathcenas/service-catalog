# acl-export

Exporta revisiones ACL completadas al sistema de onboarding/offboarding mediante
un archivo JSON por revisión en una carpeta compartida entre contenedores.

## Setup

```bash
cp .env.example .env
# completar SUPABASE_URL y SUPABASE_SERVICE_KEY
pip install requests
```

## Docker Compose — volumen compartido

En ambos servicios (este y el de onboarding) montar el mismo volumen:

```yaml
services:
  acl-export:
    volumes:
      - acl_pending:/data

  onboarding:
    volumes:
      - acl_pending:/data/acl-pending   # ajustar al path que usa ese sistema

volumes:
  acl_pending:
```

O con bind mount si preferís carpeta en el host:

```yaml
volumes:
  - /srv/shared/acl-pending:/data
```

## Cron (semanal, lunes 6am)

```
0 6 * * 1 cd /srv/acl-export && /usr/bin/python3 acl-export.py >> /var/log/acl-export.log 2>&1
```

## Formato de salida

Un archivo JSON por revisión con acciones pendientes (`eliminar` o `cambiar`).
Los usuarios con acción `mantener` no se incluyen.

```json
{
  "generated_at": "2026-08-05T09:00:00+00:00",
  "review_id": "uuid-completo",
  "reviewed_at": "2026-08-04T18:30:00+00:00",
  "service": "NAS Sistemaris",
  "client": "Sistemaris SRL",
  "pending_actions": [
    { "user": "jperez", "action": "eliminar", "note": "Ya no trabaja" },
    { "user": "mgarcia", "action": "cambiar", "note": "Solo lectura" }
  ]
}
```

## Estado

El script guarda en `STATE_FILE` los IDs de revisiones ya exportadas,
así no se duplican en ejecuciones siguientes.
