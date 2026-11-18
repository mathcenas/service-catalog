// Página "Referencias" del portal del cliente: qué significa cada estado y qué hacer.
// Los umbrales tienen que coincidir con scripts/windows/system-health.ps1,
// scripts/linux/system-health.sh y los medidores de SharePage.

type Tone = 'ok' | 'warning' | 'error' | 'muted';

const TONE: Record<Tone, { dot: string; pill: string }> = {
  ok:      { dot: 'bg-emerald-500', pill: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-400/20' },
  warning: { dot: 'bg-amber-500',   pill: 'bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-400/20' },
  error:   { dot: 'bg-red-500',     pill: 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-400/20' },
  muted:   { dot: 'bg-gray-400',    pill: 'bg-gray-100 text-gray-600 ring-gray-500/20 dark:bg-gray-500/10 dark:text-gray-400 dark:ring-gray-400/20' },
};

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE[tone].pill}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${TONE[tone].dot}`} />
      {children}
    </span>
  );
}

function Card({ title, intro, children }: { title: string; intro?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h2>
      {intro && <p className="text-sm text-gray-500 dark:text-gray-400 max-w-3xl">{intro}</p>}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
        {children}
      </div>
    </section>
  );
}

function Row({ pill, what, todo }: { pill: React.ReactNode; what: React.ReactNode; todo?: React.ReactNode }) {
  return (
    <div className="px-5 py-3.5 grid gap-x-6 gap-y-1.5 sm:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)] items-start">
      <div>{pill}</div>
      <div className="text-sm text-gray-700 dark:text-gray-300 min-w-0">{what}</div>
      {todo && <div className="text-sm text-gray-500 dark:text-gray-400 min-w-0"><span className="sm:hidden font-medium text-gray-600 dark:text-gray-300">Qué hacer: </span>{todo}</div>}
    </div>
  );
}

function TableHead() {
  return (
    <div className="hidden sm:grid px-5 py-2 grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)] gap-x-6 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
      <span>Estado</span><span>Qué significa</span><span>Qué hacer</span>
    </div>
  );
}

const THRESHOLDS: { label: string; warn: string; crit: string; note?: string }[] = [
  { label: 'Disco',  warn: 'más de 75 % ocupado', crit: 'más de 90 % ocupado', note: 'Un disco lleno puede frenar el sistema o impedir que se guarden archivos y backups.' },
  { label: 'RAM',    warn: 'más de 80 % en uso',  crit: 'más de 92 % en uso',  note: 'Picos ocasionales son normales; si se mantiene alto, el equipo se pone lento.' },
  { label: 'CPU',    warn: 'más de 80 % en uso',  crit: 'más de 95 % en uso',  note: 'Es una foto del momento del reporte: un pico aislado no es un problema.' },
  { label: 'Temperatura de disco (rígido o SSD)', warn: 'más de 55 °C', crit: 'más de 65 °C' },
  { label: 'Temperatura de disco NVMe',           warn: 'más de 70 °C', crit: 'más de 80 °C', note: 'Los NVMe trabajan más calientes: 60–70 °C es normal.' },
  { label: 'Desgaste de SSD / NVMe', warn: 'más de 75 % de la vida útil', crit: 'más de 90 %', note: 'Lo informa el propio disco. Al acercarse al final planificamos el reemplazo.' },
];

export function ReferencesSection({ companyName }: { companyName?: string }) {
  const us = companyName || 'Cenas IT';
  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Referencias</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-3xl">
          Qué significa cada color y estado de este portal y de los resúmenes por email. Nosotros recibimos las mismas
          alertas: la columna “Qué hacer” indica si necesitamos algo de tu parte.
        </p>
      </div>

      <Card title="Estado de los equipos" intro="Servidores y PCs reportan solos cada hora: uso de CPU, RAM, disco, salud de los discos, actualizaciones y servicios.">
        <TableHead />
        <Row pill={<Pill tone="ok">Operativo</Pill>} what="Todo dentro de los valores normales." todo="Nada." />
        <Row pill={<Pill tone="warning">Atención</Pill>}
          what={<>Algún valor pasó el umbral de aviso (ver tabla de abajo), hay actualizaciones o un reinicio pendiente, o un servicio interno está detenido. El motivo aparece debajo del nombre del equipo. <strong className="font-medium">El equipo sigue funcionando.</strong></>}
          todo={`Nada urgente. ${us} lo revisa y, si hace falta coordinar algo (liberar espacio, reiniciar), te escribimos.`} />
        <Row pill={<Pill tone="error">Crítico</Pill>}
          what="Un valor pasó el umbral crítico o un disco reporta una falla. Puede afectar el trabajo si no se atiende."
          todo={`${us} ya está al tanto y actúa. Si notás lentitud o errores, avisanos desde Support.`} />
        <Row pill={<Pill tone="muted">Desactualizado</Pill>}
          what="El equipo no reporta hace más de 25 horas. Suele ser una PC apagada o un corte de internet."
          todo="Si el equipo debería estar prendido, avisanos." />
        <Row pill={<Pill tone="error">Sin contacto</Pill>}
          what="No reporta hace más de 3 días."
          todo="Confirmanos si el equipo se apagó, se mudó o se dio de baja." />
      </Card>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Umbrales de aviso</h2>
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                <th className="px-5 py-2 font-semibold">Medida</th>
                <th className="px-5 py-2 font-semibold"><Pill tone="warning">Atención</Pill></th>
                <th className="px-5 py-2 font-semibold"><Pill tone="error">Crítico</Pill></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {THRESHOLDS.map(t => (
                <tr key={t.label} className="align-top">
                  <td className="px-5 py-3 text-gray-900 dark:text-white">
                    <div className="font-medium">{t.label}</div>
                    {t.note && <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 max-w-sm">{t.note}</div>}
                  </td>
                  <td className="px-5 py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">{t.warn}</td>
                  <td className="px-5 py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">{t.crit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 max-w-3xl">
          También pasan a “Atención”: parches de seguridad sin instalar por más de 14 días, un reinicio pendiente por más de
          7 días, una VPN (Tailscale) a la que le vence la clave en 7 días o menos, un volumen RAID degradado o un servicio interno (por ejemplo, una base de datos) detenido.
        </p>
      </section>

      <Card title="Backups" intro="Cada backup informa cómo terminó. Además controlamos que no pase demasiado tiempo sin uno nuevo.">
        <TableHead />
        <Row pill={<Pill tone="ok">OK</Pill>} what="El backup terminó completo." todo="Nada." />
        <Row pill={<Pill tone="warning">Advertencia</Pill>}
          what={<>El backup se hizo, pero el programa avisó algo: poco espacio en el destino, archivos que cambiaron mientras se copiaban, o algún archivo en uso que no se pudo copiar. <strong className="font-medium">Hay copia</strong>; puede faltar algún archivo puntual.</>}
          todo={`${us} lo revisa. Si se repite varios días, lo corregimos (más espacio, otro horario, etc.).`} />
        <Row pill={<Pill tone="error">Fallido</Pill>}
          what="El backup no se completó. La copia anterior sigue disponible."
          todo={`${us} lo atiende ese mismo día. Te avisamos por email cuando hay fallas.`} />
        <Row pill={<Pill tone="warning">Pendiente</Pill>}
          what="Pasó más tiempo del esperado sin un backup nuevo (más de 26 h en los diarios, 74 h en los de lunes a viernes, 8 días en los semanales, 32 días en los mensuales; si un job es semanal o mensual dentro de un servicio diario, se respeta la frecuencia de ese job)."
          todo="Si el equipo estuvo apagado, avisanos; si no, lo revisamos nosotros." />
        <Row pill={<Pill tone="error">Atrasado</Pill>}
          what="Pasó el doble del tiempo esperado sin backup."
          todo={`${us} lo prioriza.`} />
      </Card>

      <Card title="Disponibilidad (Uptime)" intro="Controlamos desde afuera, cada pocos minutos, que tus servicios respondan (página web, conexión a internet, accesos remotos).">
        <Row pill={<Pill tone="ok">Disponible</Pill>} what="Respondió en el control." />
        <Row pill={<Pill tone="error">Caído</Pill>} what="No respondió. Si se recupera solo en minutos, suele ser un corte breve del proveedor de internet." todo="Si dura más, ya lo estamos viendo." />
        <Row pill={<span className="text-sm font-medium text-gray-900 dark:text-white tabular-nums">99,9 %</span>}
          what="Porcentaje de tiempo disponible en los últimos 30 días. 99,9 % equivale a unos 43 minutos sin servicio en el mes." />
      </Card>

      <Card title="Resúmenes por email">
        <Row pill={<span className="text-sm font-medium text-gray-900 dark:text-white">Diario / Semanal / Mensual</span>}
          what="Lo mismo que ves en este portal, resumido. El semanal sale los lunes y el mensual el primer lunes de cada mes." />
        <Row pill={<span className="text-sm font-medium text-gray-900 dark:text-white">Alerta de backups</span>}
          what="Sale solo el día que algún backup terminó con advertencia o falló." />
        <Row pill={<span className="text-sm font-medium text-gray-900 dark:text-white">Cambiar frecuencia</span>}
          what="Desde el link “Cambiar frecuencia de notificaciones” al pie de cualquier resumen." />
      </Card>
    </div>
  );
}
