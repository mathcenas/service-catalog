# Proyecto ECHO — reemplazo de MailPoet para el newsletter

Estado: **propuesta para analizar** (noviembre 2026). Precios aproximados: confirmar los vigentes antes de decidir.

## Situación actual

| | |
|---|---|
| Sitio | `mailpoet.echo.fmed.edu.uy` (WordPress) |
| Herramienta | MailPoet, **con el servicio de envío de MailPoet** |
| Costo | **140 USD/mes** |
| Suscriptores | ~11.000 |
| Uso real | Newsletter armado con **plantillas HTML**, mandado a la lista |
| No usan | Automatizaciones, página de confirmación (doble opt-in), autogestión de la suscripción |
| DNS del dominio | Lo maneja Cenas IT en **Netuy** |

Lo que se paga es sobre todo el envío de MailPoet, que cobra según la cantidad de suscriptores. Para un uso tan simple (un HTML a una lista) es caro.

## Las dos piezas de un newsletter

Conviene separarlas, porque se pueden elegir por separado:

1. **Gestor**: dónde se arma y se manda el newsletter (listas, campañas, plantillas, bajas, estadísticas). Ej.: MailPoet, FluentCRM, Listmonk.
2. **Envío**: el servicio que efectivamente entrega los mails. Ej.: servicio de MailPoet, Amazon SES, Resend.

### Gestor

| | **FluentCRM** (en su WordPress) | **Listmonk** (en un VPS, con Docker) |
|---|---|---|
| Dónde editan | En el **mismo WordPress**, como hoy | En otra web aparte |
| Plantillas HTML | Sí (editor "HTML puro": se pega el mismo HTML) | Sí, muy bueno para HTML puro |
| Costo del gestor | Gratis, sin límite de contactos | Gratis (código abierto) |
| Mantenimiento | Actualizar plugins de WordPress | Lo administra Cenas IT: Docker, base de datos, backups |
| Conviene si… | El cliente sigue trabajando como ahora | Se quiere **un sistema de newsletters para varios clientes** y ofrecerlo como servicio gestionado |

### Envío

| | **Amazon SES** | **Resend** |
|---|---|---|
| Costo aprox. (~44.000 mails/mes: 11.000 × 4 envíos) | **~4–5 USD/mes** (≈ 0,10 USD cada 1.000 mails) | **~20 USD/mes o más** (plan pago por volumen; para newsletters tiene además un plan de marketing que se cobra por contactos) |
| Puesta en marcha | Más trabajo: pedir salida del modo prueba (sandbox), conectar rebotes/quejas (SNS) | Más simple: panel, logs y webhooks ya conocidos |
| Rebotes y bajas | Hay que conectar el aviso de SES al gestor (FluentCRM trae el conector) | Resueltos con webhooks y bajas automáticas |

**Importante si se usa Resend:** hacerlo con **una cuenta o dominio separado** del de Cenas IT. Hoy los avisos de Cenas a sus clientes salen por Resend desde `updates.cenas.uy`; un newsletter masivo con quejas de spam podría afectar esa reputación. Usar una cuenta propia del cliente con el dominio `echo.fmed.edu.uy`.

### Opciones descartadas

- **Cloudflare Email Sending**: el plan gratis solo manda a direcciones verificadas de la propia cuenta; para mandar a terceros hace falta el plan pago de Workers. Además está pensado para mails transaccionales (alertas, avisos), no para newsletters (no maneja listas, bajas ni estadísticas de campaña), y probablemente pide tener el dominio en Cloudflare (hoy está en Netuy).
- **MailPoet con envío propio**: el plan gratis de MailPoet está limitado en cantidad de suscriptores; con 11.000 se sigue pagando licencia.

## Propuesta

**Recomendada: FluentCRM + Amazon SES** en el mismo WordPress.

- El cliente sigue editando en WordPress y pega las mismas plantillas HTML.
- Costo: **~5 USD/mes** contra 140 USD/mes actuales.
- Alternativa más simple de configurar: **FluentCRM + Resend** (~20 USD/mes), con cuenta separada.
- Listmonk solo si se piensa ofrecer newsletters a varios clientes desde un mismo lugar.

Aunque hoy no usen autogestión, **el link de baja tiene que ir en cada envío** (ley de protección de datos y para no caer en spam). FluentCRM lo agrega solo y registra las bajas.

## Plan de migración (FluentCRM + SES)

1. **Cuenta de AWS** (a nombre del cliente, o de Cenas IT y se le factura). En SES, dar de alta el dominio `echo.fmed.edu.uy`.
2. **DNS en Netuy:**
   - 3 registros **DKIM** (CNAME) que da SES;
   - **SPF** con `include:amazonses.com`;
   - **DMARC**, para empezar `p=none`;
   - opcional: subdominio "MAIL FROM" propio (ej. `bounce.echo.fmed.edu.uy`) para que SPF quede alineado.
3. **Salir del modo prueba de SES** desde la consola, explicando el uso: lista propia de ~11.000 suscriptores, con baja y manejo de rebotes. Suele aprobarse en 1–2 días.
4. **WordPress:** instalar **FluentSMTP** (conectado a SES) y **FluentCRM**. Conectar los rebotes y quejas de SES a FluentCRM para que limpie la lista solo.
5. **Migrar la lista:** MailPoet → Suscriptores → Exportar, **con el estado de cada uno** (activos, dados de baja, rebotados). Importar en FluentCRM respetando bajas y rebotes: a quien se dio de baja no se le vuelve a escribir.
6. **Plantillas:** pegar el HTML en una campaña de FluentCRM y agregar el link de baja.
7. **Prueba y arranque:** primero a Cenas/ECHO, después a una parte de la lista (2.000–3.000) y al día siguiente al resto (calentar la reputación del nuevo envío).
8. **Cancelar MailPoet** antes de la próxima renovación, cuando todo ande.

**Riesgo principal:** la entrega (que no caiga en spam) con un sistema de envío nuevo. Se mitiga con DKIM, SPF y DMARC bien configurados y mandando por partes los primeros envíos.

## Pendiente / preguntas para decidir

- [ ] ¿Gestor: FluentCRM (en WordPress) o Listmonk (VPS, multi-cliente)?
- [ ] ¿Envío: Amazon SES (más barato) o Resend (más simple)?
- [ ] ¿Cuenta de AWS/Resend a nombre del cliente o de Cenas IT?
- [ ] ¿Cada cuánto mandan? (para el cálculo de costo)
- [ ] Revisar en la cuenta de MailPoet el plan exacto y la fecha de renovación.
- [ ] Si se elige Listmonk en el VPS de ECHO (*Server Echo Uruguay*): liberar disco antes (hoy al 88 %).
- [ ] Una vez decidido: cargar el newsletter como servicio de ECHO en el catálogo.
