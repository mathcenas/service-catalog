# VMware Workstation Backup

Backup nocturno de VMs hacia destino UNC. Una copia por día, retención configurable, email automático al terminar.

## Instalación

1. Copiar la carpeta `vmware-backup\` a `C:\Scripts\` en el host cliente.
2. Editar `backup-config.json` con los paths y VMs del cliente.
3. Configurar las variables de entorno de la máquina (no del usuario):
   ```powershell
   [System.Environment]::SetEnvironmentVariable("CENAS_VM_SERVICE_ID",    "<id>",     "Machine")
   [System.Environment]::SetEnvironmentVariable("CENAS_VM_INGEST_SECRET", "<secret>", "Machine")
   [System.Environment]::SetEnvironmentVariable("CENAS_SUPABASE_ANON_KEY","<key>",    "Machine")
   # Si hay VMs encriptadas:
   [System.Environment]::SetEnvironmentVariable("VMPASS_SRV_VENTAS",      "<pass>",   "Machine")
   ```
4. Registrar la tarea del Programador (como Administrador):
   ```powershell
   .\Register-BackupTask.ps1
   ```

## Usuario de la tarea — importante

**No usar SYSTEM.** `vmrun` necesita correr bajo la cuenta que registró/abrió las VMs originalmente (normalmente el usuario que tiene AutoStart configurado). Usar esa cuenta local o de dominio.

Si la cuenta es local y no tiene acceso al UNC destino, agregar credenciales persistentes:
```powershell
cmdkey /add:NAS /user:DOMINIO\usuario /pass:contrasena
```

## Configuración (`backup-config.json`)

| Campo | Descripción |
|-------|-------------|
| `client` | Código del cliente (aparece en el email y en el path de destino) |
| `destinationRoot` | UNC o ruta local donde se guardan las carpetas de backup |
| `retentionCopies` | Cuántas copias diarias mantener por VM (default 3) |
| `minFreeSpaceMarginGB` | Margen mínimo de espacio libre que debe quedar en destino |
| `suspendTimeoutSec` | Segundos máximos esperando que la VM suspenda (default 600) |
| `vms[].encryptionPasswordEnv` | Nombre de variable de entorno con la clave de la VM encriptada. `null` si no tiene cifrado |

## Qué hace el script

Por cada VM (secuencial):
1. Chequea espacio libre en destino.
2. Suspende la VM si estaba corriendo (espera que desaparezcan los `.lck`).
3. Copia la carpeta completa con robocopy a `<destino>\<cliente>\<vm>\<fecha_hora>\`.
4. Verifica que el `.vmx` está en destino y el tamaño no difiere más de 5%.
5. Reanuda la VM (siempre, aunque la copia haya fallado).
6. Elimina copias viejas si superan `retentionCopies`.

Al terminar todas las VMs, envía un email con la tabla de resultados (mismo formato que Cobian/Veeam).

## Cómo restaurar

1. Copiar la carpeta del backup (`<fecha_hora>\`) a cualquier PC con VMware Workstation.
2. Abrir VMware Workstation → **Open a Virtual Machine** → seleccionar el `.vmx` dentro de esa carpeta.
3. Al arrancar, elegir **"I copied it"** (no "I moved it").
4. La VM arranca desde el estado suspendido o apagado en que se copió.

## Cómo probar

```powershell
# 1. Prueba manual (ejecutar como el mismo usuario de la tarea):
powershell.exe -ExecutionPolicy Bypass -File "C:\Scripts\vmware-backup\Backup-WorkstationVMs.ps1"

# 2. Probar vía Task Scheduler:
Start-ScheduledTask -TaskName "VMware Workstation Backup - Nocturno"

# 3. Ver log en tiempo real:
Get-Content "C:\Scripts\vmware-backup\logs\backup-*.log" -Tail 20 -Wait
```

**Checklist de pruebas:**
- [ ] VM encendida → suspende, copia, reanuda, log muestra downtime en segundos.
- [ ] VM apagada → copia directa, sin suspend/start.
- [ ] Destino UNC inaccesible → script sale sin tocar ninguna VM.
- [ ] Matar el proceso robocopy a mitad → VM reanuda igual (bloque `finally`).
- [ ] VM encriptada sin variable de entorno → status `skipped` en el log y en el email.
- [ ] Restaurar: copiar carpeta a otra PC, abrir `.vmx`, elegir "I copied it", verificar que arranca.
- [ ] Email recibido con tabla de VMs al terminar.

## Estructura de carpetas en destino

```
\\NAS\backups-vms\
  RBUY\
    SRV-CONTA\
      2026-10-23_0330\   ← copia más nueva
      2026-10-22_0330\
      2026-10-21_0330\
    SRV-VENTAS\
      2026-10-23_0330\
```
