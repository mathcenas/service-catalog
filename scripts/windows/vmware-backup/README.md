# VMware Workstation Backup

Backup nocturno de VMs hacia destino UNC. Una copia por día, retención configurable, email automático al terminar.

## Instalación

1. Copiar la carpeta `vmware-backup\` dentro de `C:\Scripts\` (al lado del `config.ps1` existente).
2. Editar `C:\Scripts\config.ps1` y completar las variables `VM_*`:
   ```powershell
   $VM_DEST_ROOT   = "\\NAS\backups-vms"   # destino UNC o local — obligatorio
   $VM_ROOT_DIR    = "D:\VMs"              # carpeta raíz de las VMs (recomendado)
   $VM_RETENTION   = 3
   $VM_MIN_FREE_GB = 20
   ```
   Las variables de telemetría (`$INGEST_URL`, `$INGEST_SECRET`, `$SERVICE_ID`, `$ANON_KEY`)
   ya están en `config.ps1` — el script las usa automáticamente.
3. Registrar la tarea del Programador (como Administrador):
   ```powershell
   .\Register-BackupTask.ps1
   ```

## Usuario de la tarea — importante

**No usar SYSTEM.** `vmrun` necesita correr bajo la cuenta que registró/abrió las VMs (la que tiene AutoStart configurado). Usar esa cuenta local o de dominio.

Si esa cuenta no tiene acceso al UNC destino, agregar credenciales persistentes:
```powershell
cmdkey /add:NAS /user:DOMINIO\usuario /pass:contrasena
```

El inventario de VMs (`inventory.vmls`) también es por usuario, por eso el mismo usuario que corre la tarea tiene que ser quien usa VMware Workstation.

## Configuración (`config.ps1`)

Variables VMware en el `config.ps1` compartido con los demás scripts del cliente:

| Variable | Descripción | Default |
|----------|-------------|---------|
| `$VM_DEST_ROOT` | Destino UNC o local para los backups | — (obligatorio) |
| `$VM_ROOT_DIR` | Carpeta raíz de las VMs para auto-descubrir | inventario VMware |
| `$VM_RETENTION` | Copias diarias a conservar por VM | 3 |
| `$VM_MIN_FREE_GB` | Espacio mínimo libre en destino (GB) | 20 |
| `$VM_SUSPEND_TIMEOUT` | Timeout esperando suspend (segundos) | 600 |
| `$VM_VMRUN_PATH` | Path a vmrun.exe si no está en el default | auto |
| `$VM_LOG_DIR` | Carpeta de logs | `vmware-backup\logs` |

### Descubrimiento de VMs

El script encuentra las VMs automáticamente, sin lista manual:

1. **Si `$VM_ROOT_DIR` está configurado**: escanea `*.vmx` hasta 2 niveles adentro.
2. **Si no**: lee `%APPDATA%\VMware\inventory.vmls` (todas las VMs registradas en Workstation).

Esto incluye VMs apagadas al momento del backup.

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
  SERVER-CARRAL\            ← nombre del host ($env:COMPUTERNAME)
    SRV-CONTA\
      2026-10-23_0330\      ← copia más nueva
      2026-10-22_0330\
      2026-10-21_0330\
    SRV-VENTAS\
      2026-10-23_0330\
```
