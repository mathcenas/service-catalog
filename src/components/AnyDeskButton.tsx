import { useState } from 'react';
import { Check, Copy, MonitorSmartphone } from 'lucide-react';
import type { Service } from '../lib/supabase';

/** AnyDesk del equipo: lo guarda ingest-heartbeat desde el script rdp-report (specifications.anydesk_id) */
export function anydeskIdOf(service: Pick<Service, 'specifications'>): string | null {
  const raw = (service.specifications as Record<string, unknown> | null)?.anydesk_id;
  const id = raw != null ? String(raw).replace(/\s/g, '') : '';
  return /^(\d{6,12}|[\w.-]+@[\w.-]+)$/.test(id) ? id : null;
}

/** "1 528 270 336": más fácil de dictar o leer */
const pretty = (id: string) => /^\d+$/.test(id) ? id.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : id;

/** ID de AnyDesk con "Conectar" (abre AnyDesk instalado en la PC) y "Copiar" */
export function AnyDeskButton({ id, compact = false }: { id: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(id).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <a
        href={`anydesk:${id}`}
        onClick={e => e.stopPropagation()}
        title={`Conectar con AnyDesk a ${id}`}
        className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 hover:bg-red-100"
      >
        <MonitorSmartphone className="w-3.5 h-3.5" />
        {compact ? 'AnyDesk' : 'Conectar'}
      </a>
      <span className="font-mono text-xs text-gray-700">{pretty(id)}</span>
      <button onClick={copy} className="text-gray-300 hover:text-gray-500" title="Copiar ID de AnyDesk">
        {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </span>
  );
}
