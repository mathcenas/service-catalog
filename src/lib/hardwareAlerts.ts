// Traduce lo que reporta system-health a avisos para el cliente, en lenguaje simple y con lo
// necesario para cotizar el reemplazo (modelo, capacidad, número de serie). Se muestra arriba en
// el portal del cliente ("Requiere tu atención") y se puede enlazar con /share/<token>#atencion.

export type HardwareAlert = {
  key: string;
  severity: 'critical' | 'warning';
  title: string;          // "Servidor de Backup: un disco está fallando"
  what: string;           // qué pasa, en una o dos frases
  risk: string;           // qué puede pasar si no se hace nada
  action: string;         // qué recomendamos
  part?: string;          // "Seagate ST2000DM008 · 2 TB · serie ZK20JR94"
  since?: string | null;  // ISO: primer error visto
};

type DiskEvent = { source: string; id: number; severity: string; count: number; first?: string; last?: string; volume?: string | null; serial?: string | null; disk?: string | null; model?: string | null };
type DiskSmart = { dev?: string; model?: string; serial?: string; capacity?: string; status?: string; smart_health?: string; temp_c?: number | null; pct_used?: number | null; uncorrectable_errors?: number };
type DiskRaid = { name?: string; status?: string; health?: string; resiliency?: string };

const clean = (s: unknown) => String(s ?? '').trim();
// "Servidor de Backup: un disco está fallando" (sin nombre: "Un disco está fallando")
const titled = (device: string, text: string) => device ? `${device}: ${text}` : text.charAt(0).toUpperCase() + text.slice(1);
// Windows informa la capacidad en GiB: "1863 GB" es un disco de 2 TB en la caja
const marketSize = (cap?: string) => {
  const gb = Number(String(cap ?? '').replace(/[^\d.]/g, ''));
  if (!gb) return clean(cap);
  const real = gb * 1.0737;
  return real >= 900 ? `${Math.round(real / 1000 * 2) / 2} TB`.replace('.0 ', ' ') : `${Math.round(real / 10) * 10} GB`;
};

export function hardwareAlerts(payload: Record<string, unknown> | null | undefined, deviceName: string): HardwareAlert[] {
  const p = payload ?? {};
  const out: HardwareAlert[] = [];
  const smart = (Array.isArray(p.disk_smart) ? p.disk_smart : []) as DiskSmart[];
  const events = (Array.isArray(p.disk_events) ? p.disk_events : []) as DiskEvent[];
  const raid = (Array.isArray(p.disk_raid) ? p.disk_raid : []) as DiskRaid[];
  const issues = typeof p.issues === 'string' ? p.issues : '';

  const partOf = (serial?: string | null, model?: string | null) => {
    const sm = smart.find(d => serial && clean(d.serial) === clean(serial)) ?? (model ? smart.find(d => clean(d.model) === clean(model)) : undefined);
    return [clean(model ?? sm?.model), marketSize(sm?.capacity), serial ? `serie ${clean(serial)}` : ''].filter(Boolean).join(' · ') || undefined;
  };

  // 1) Errores de hardware de un disco (Visor de eventos): se agrupan por disco
  const bad = events.filter(e => e.severity === 'error');
  if (bad.length) {
    const serial = bad.find(e => e.serial)?.serial ?? null;
    const model = bad.find(e => e.model)?.model ?? null;
    const volume = bad.find(e => e.volume)?.volume ?? null;
    // Los errores del propio disco; si no hay (solo NTFS o la controladora), todos
    const diskOnly = bad.filter(e => e.source === 'disk');
    const total = (diskOnly.length ? diskOnly : bad).reduce((n, e) => n + (e.count || 0), 0);
    const since = bad.map(e => e.first).filter(Boolean).sort()[0] ?? null;
    const lost = /controladora lo ve pero Windows no/.test(issues);
    out.push({
      key: `disk-${serial ?? 'events'}`,
      severity: 'critical',
      title: titled(deviceName, 'un disco está fallando'),
      what: `El equipo registró ${total.toLocaleString('es-UY')} errores de lectura y escritura en un disco${volume ? ` (la unidad ${volume})` : ''}${lost ? ', y Windows ya dejó de verlo correctamente' : ''}. Es una falla física del disco: no se arregla con software.`,
      risk: 'Un disco en este estado puede dejar de funcionar del todo en cualquier momento, y lo que guarda se pierde. Mientras tanto, los respaldos que dependen de él fallan.',
      action: 'Recomendamos reemplazar el disco cuanto antes. Si lo que guarda es importante, lo ideal son dos discos en espejo, para que una falla así no detenga nada.',
      part: partOf(serial, model),
      since,
    });
  }

  // 2) SMART: el propio disco avisa que está por fallar (si no lo cubrió el punto 1)
  for (const d of smart) {
    if (d.status !== 'error' || out.some(a => a.key === `disk-${clean(d.serial)}`)) continue;
    out.push({
      key: `smart-${clean(d.serial) || d.dev}`,
      severity: 'critical',
      title: titled(deviceName, 'un disco avisa que está por fallar'),
      what: `El disco reporta su propio estado como malo${d.temp_c ? ` (temperatura ${d.temp_c} °C)` : ''}${d.pct_used && d.pct_used > 90 ? ` y un desgaste del ${d.pct_used}%` : ''}.`,
      risk: 'Cuando un disco empieza a avisar, suele fallar del todo en semanas o días.',
      action: 'Recomendamos reemplazarlo antes de que deje de funcionar.',
      part: partOf(d.serial, d.model),
    });
  }

  // 3) Volumen en espejo degradado: el equipo sigue andando con un solo disco
  for (const r of raid) {
    if (!r.status || r.status === 'ok') continue;
    out.push({
      key: `raid-${clean(r.name)}`,
      severity: r.status === 'error' ? 'critical' : 'warning',
      title: titled(deviceName, 'los discos en espejo perdieron la protección'),
      what: `Uno de los discos del volumen "${clean(r.name)}" falló o se desconectó. El equipo sigue funcionando con el otro.`,
      risk: 'Si falla el disco que queda, se pierde la información del volumen.',
      action: 'Recomendamos reemplazar el disco que falló para recuperar la protección.',
    });
  }

  // 4) Disco casi lleno
  const pct = Number(p.disk_pct);
  if (Number.isFinite(pct) && pct >= 90) {
    const free = Number(p.disk_free_gb);
    out.push({
      key: 'disk-full',
      severity: pct >= 95 ? 'critical' : 'warning',
      title: titled(deviceName, 'el disco está casi lleno'),
      what: `Está usado al ${pct}%${Number.isFinite(free) ? ` (quedan ${free} GB libres)` : ''}.`,
      risk: 'Cuando se llena, los programas y los respaldos dejan de funcionar y el equipo se puede trabar.',
      action: 'Podemos liberar espacio o, si ya no alcanza, ampliar el disco.',
    });
  }

  return out;
}
