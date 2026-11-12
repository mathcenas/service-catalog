// Ilustraciones planas de equipos para el diagrama de red (estilo plano tipo Visio).
// Colores fijos: el diagrama es siempre blanco para poder exportarlo y pegarlo en un mail.

export type DeviceKind =
  | 'switch' | 'router' | 'sdwan' | 'firewall' | 'ap' | 'server' | 'nas' | 'pc' | 'printer' | 'phone' | 'internet';

export const DEVICE_KINDS: { id: DeviceKind; label: string }[] = [
  { id: 'switch',   label: 'Switch' },
  { id: 'router',   label: 'Router' },
  { id: 'sdwan',    label: 'SD-WAN / Edge' },
  { id: 'firewall', label: 'Firewall' },
  { id: 'ap',       label: 'Access Point' },
  { id: 'server',   label: 'Servidor' },
  { id: 'nas',      label: 'NAS / Storage' },
  { id: 'pc',       label: 'PC / Notebook' },
  { id: 'printer',  label: 'Impresora' },
  { id: 'phone',    label: 'Teléfono / Central' },
  { id: 'internet', label: 'Internet / ISP (nube)' },
];

/** Adivina el tipo de equipo por el tipo de servicio y el nombre */
export function guessDeviceKind(typeName?: string, name?: string): DeviceKind {
  const t = `${typeName ?? ''} ${name ?? ''}`.toLowerCase();
  if (/sd-?wan|velocloud|meraki mx|edge/.test(t)) return 'sdwan';
  if (/firewall|fortigate|palo|pfsense|sophos|\bfw\b|-pa-/.test(t)) return 'firewall';
  if (/switch|\bsw\b|-stk-|3810|catalyst|aruba 2/.test(t)) return 'switch';
  if (/\bap\b|access point|wifi|wi-fi|wlan|iap|unifi ap/.test(t)) return 'ap';
  if (/router|mikrotik|routeros|isr|2851|gateway/.test(t)) return 'router';
  if (/nas|synology|qnap|storage|smb|carpeta compartida/.test(t)) return 'nas';
  if (/printer|impresora|xerox/.test(t)) return 'printer';
  if (/phone|tel[eé]fono|central|pbx|voip/.test(t)) return 'phone';
  if (/internet|isp|antel|movistar|telef[oó]nica|claro/.test(t)) return 'internet';
  if (/pc|notebook|laptop|desktop|workstation/.test(t)) return 'pc';
  return 'server';
}

/** Tamaño natural de cada ilustración (px) */
export const DEVICE_SIZE: Record<DeviceKind, { w: number; h: number }> = {
  switch:   { w: 168, h: 34 },
  router:   { w: 120, h: 34 },
  sdwan:    { w: 104, h: 40 },
  firewall: { w: 150, h: 36 },
  ap:       { w: 76,  h: 76 },
  server:   { w: 56,  h: 76 },
  nas:      { w: 78,  h: 62 },
  pc:       { w: 74,  h: 62 },
  printer:  { w: 78,  h: 60 },
  phone:    { w: 60,  h: 60 },
  internet: { w: 170, h: 96 },
};

function Ports({ x, y, cols, rows, w = 7, h = 5, gap = 2, color = '#cbd5e1' }: { x: number; y: number; cols: number; rows: number; w?: number; h?: number; gap?: number; color?: string }) {
  const out = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      out.push(<rect key={`${r}-${c}`} x={x + c * (w + gap)} y={y + r * (h + gap)} width={w} height={h} rx={0.8} fill={color} />);
  return <>{out}</>;
}

export function DeviceIcon({ kind, label }: { kind: DeviceKind; label?: string }) {
  const { w, h } = DEVICE_SIZE[kind];
  const svg = (children: React.ReactNode) => (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}>{children}</svg>
  );

  switch (kind) {
    case 'switch':
      return svg(<>
        <rect x={1} y={3} width={w - 2} height={h - 6} rx={3} fill="#1f2937" stroke="#0f172a" />
        <rect x={6} y={8} width={10} height={h - 16} rx={1} fill="#334155" />
        <Ports x={22} y={9} cols={12} rows={2} color="#e2e8f0" />
        <Ports x={w - 30} y={10} cols={2} rows={2} w={9} h={6} color="#94a3b8" />
        <circle cx={11} cy={12} r={1.6} fill="#22c55e" />
      </>);
    case 'router':
      return svg(<>
        <rect x={1} y={4} width={w - 2} height={h - 8} rx={3} fill="#111827" stroke="#0f172a" />
        <Ports x={10} y={11} cols={4} rows={1} w={9} h={8} gap={3} color="#e5e7eb" />
        <rect x={w - 46} y={11} width={22} height={9} rx={1.5} fill="#374151" />
        <circle cx={w - 14} cy={13} r={1.8} fill="#22c55e" />
        <circle cx={w - 14} cy={19} r={1.8} fill="#f59e0b" />
      </>);
    case 'sdwan':
      return svg(<>
        <rect x={1} y={6} width={w - 2} height={h - 10} rx={4} fill="#0f172a" />
        <rect x={1} y={6} width={w - 2} height={6} rx={3} fill="#1e293b" />
        <Ports x={12} y={18} cols={5} rows={1} w={8} h={8} gap={3} color="#e2e8f0" />
        <rect x={w - 30} y={18} width={9} height={8} rx={1} fill="#38bdf8" />
        <circle cx={w - 12} cy={22} r={2} fill="#22c55e" />
      </>);
    case 'firewall':
      return svg(<>
        <rect x={1} y={3} width={w - 2} height={h - 6} rx={3} fill="#1d4ed8" stroke="#1e3a8a" />
        <rect x={6} y={9} width={30} height={h - 18} rx={1.5} fill="#e0e7ff" />
        <path d="M10 13h22M10 18h22M10 23h22M16 13v5M26 18v5M20 23v0" stroke="#1d4ed8" strokeWidth={1.4} />
        <Ports x={44} y={10} cols={4} rows={2} w={8} h={6} gap={3} color="#f8fafc" />
        <Ports x={w - 36} y={10} cols={2} rows={2} w={10} h={6} gap={3} color="#93c5fd" />
      </>);
    case 'ap':
      return svg(<>
        <circle cx={w / 2} cy={h / 2} r={w / 2 - 2} fill="#f8fafc" stroke="#cbd5e1" strokeWidth={1.5} />
        <circle cx={w / 2} cy={h / 2} r={w / 2 - 12} fill="#ffffff" stroke="#e2e8f0" />
        <circle cx={w / 2} cy={h / 2 + 14} r={2.2} fill="#f97316" />
        <path d={`M${w / 2 - 12} ${h / 2 - 2} q12 -12 24 0 M${w / 2 - 7} ${h / 2 + 3} q7 -7 14 0`} fill="none" stroke="#94a3b8" strokeWidth={1.6} strokeLinecap="round" />
      </>);
    case 'server':
      return svg(<>
        <rect x={4} y={1} width={w - 8} height={h - 2} rx={4} fill="#1f2937" stroke="#0f172a" />
        {[10, 22, 34].map(y => <rect key={y} x={10} y={y} width={w - 20} height={8} rx={1.5} fill="#374151" />)}
        {[14, 26, 38].map(y => <circle key={y} cx={w - 14} cy={y} r={1.5} fill="#22c55e" />)}
        <rect x={10} y={h - 18} width={w - 20} height={10} rx={1.5} fill="#111827" />
      </>);
    case 'nas':
      return svg(<>
        <rect x={2} y={2} width={w - 4} height={h - 4} rx={5} fill="#111827" stroke="#0f172a" />
        {[0, 1, 2, 3].map(i => <rect key={i} x={10 + i * 15} y={10} width={11} height={h - 26} rx={1.5} fill="#374151" />)}
        {[0, 1, 2, 3].map(i => <circle key={i} cx={15.5 + i * 15} cy={h - 10} r={1.6} fill="#38bdf8" />)}
      </>);
    case 'pc':
      return svg(<>
        <rect x={4} y={2} width={w - 8} height={h - 18} rx={3} fill="#1f2937" />
        <rect x={8} y={6} width={w - 16} height={h - 26} rx={1.5} fill="#bfdbfe" />
        <rect x={w / 2 - 6} y={h - 16} width={12} height={8} fill="#64748b" />
        <rect x={w / 2 - 18} y={h - 8} width={36} height={4} rx={2} fill="#475569" />
      </>);
    case 'printer':
      return svg(<>
        <rect x={14} y={2} width={w - 28} height={16} rx={1} fill="#f8fafc" stroke="#94a3b8" />
        <rect x={2} y={16} width={w - 4} height={28} rx={4} fill="#334155" />
        <rect x={14} y={38} width={w - 28} height={20} rx={1} fill="#f8fafc" stroke="#94a3b8" />
        <circle cx={w - 12} cy={24} r={2} fill="#22c55e" />
      </>);
    case 'phone':
      return svg(<>
        <rect x={6} y={10} width={w - 12} height={h - 14} rx={6} fill="#1f2937" />
        <rect x={12} y={16} width={w - 24} height={12} rx={2} fill="#bfdbfe" />
        <Ports x={14} y={33} cols={3} rows={3} w={7} h={5} gap={3} color="#e2e8f0" />
        <path d={`M10 10 q${(w - 20) / 2} -10 ${w - 20} 0`} fill="none" stroke="#334155" strokeWidth={5} strokeLinecap="round" />
      </>);
    case 'internet':
      return svg(<>
        <g transform={`scale(${w / 100} ${h / 60})`}>
          <path d="M24 56 H79 A16 16 0 0 0 81 24 A23 23 0 0 0 40 15 A15 15 0 0 0 17 30 A13 13 0 0 0 24 56 Z"
            fill="#ffffff" stroke="#64748b" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
        </g>
        {label && (
          <text x={w / 2} y={h * 0.6} textAnchor="middle" fontSize={15} fontWeight={700} fill="#0f172a"
            fontFamily="'Plus Jakarta Sans',-apple-system,'Segoe UI',Roboto,sans-serif">{label}</text>
        )}
      </>);
  }
}
