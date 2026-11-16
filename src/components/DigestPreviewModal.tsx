import { useEffect, useState } from 'react';
import { X, RefreshCw, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';

export type DigestVersion = 'daily' | 'weekly' | 'monthly' | 'alert';

export const DIGEST_LABEL: Record<DigestVersion, string> = {
  daily: 'Resumen diario',
  weekly: 'Resumen semanal',
  monthly: 'Resumen mensual',
  alert: 'Alerta de backups',
};

type PreviewResult = {
  html: string | null;
  subject?: string;
  recipients: { name: string; email: string }[];
  note?: string;
};

async function fetchPreview(clientId: string, version: DigestVersion): Promise<PreviewResult> {
  const { data: { session } } = await supabase.auth.getSession();
  const base = (supabase as unknown as { supabaseUrl?: string }).supabaseUrl ?? import.meta.env.VITE_SUPABASE_URL;
  const fn = version === 'alert' ? 'backup-alert-digest' : 'client-weekly-digest';
  const body = version === 'alert'
    ? { client_id: clientId, preview: true }
    : { client_id: clientId, preview: true, frequency: version };
  const res = await fetch(`${base}/functions/v1/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);

  if (version === 'alert') {
    const p = (json.previews ?? [])[0];
    if (!p) {
      return { html: null, recipients: [], note: 'No hubo backups de este cliente en las últimas 24 h: la alerta no saldría.' };
    }
    return {
      html: p.html,
      subject: p.subject,
      recipients: p.recipients ?? [],
      note: p.has_alert
        ? (p.recipients?.length ? undefined : 'Hay backups con problemas, pero ningún contacto la recibe: los que tienen resumen diario ya los ven ahí.')
        : 'Todos los backups de las últimas 24 h salieron bien: la alerta no saldría. Así se vería si saliera.',
    };
  }
  if (!json.html) {
    return { html: null, recipients: [], note: json.reason === 'No contacts with active digest' ? 'El cliente no tiene contactos con resumen activo.' : (json.reason ?? 'Sin vista previa.') };
  }
  return {
    html: json.html,
    subject: json.subject,
    recipients: json.recipients ?? [],
    note: (json.recipients ?? []).length ? undefined : `Ningún contacto tiene ${DIGEST_LABEL[version].toLowerCase()}: así se vería si alguno lo tuviera.`,
  };
}

/** Vista previa de los resúmenes de un cliente, eligiendo la versión */
export function DigestPreviewModal({ clientId, clientName, initial = 'daily', available, onClose }: {
  clientId: string;
  clientName: string;
  initial?: DigestVersion;
  /** Versiones a ofrecer (por defecto todas) */
  available?: DigestVersion[];
  onClose: () => void;
}) {
  const versions = available?.length ? available : (['daily', 'weekly', 'monthly', 'alert'] as DigestVersion[]);
  const [version, setVersion] = useState<DigestVersion>(versions.includes(initial) ? initial : versions[0]);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setResult(null);
    fetchPreview(clientId, version)
      .then(r => { if (!cancelled) setResult(r); })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clientId, version]);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl h-[90vh] flex flex-col" onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 gap-3 flex-wrap">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-900">Vista previa — {clientName}</h3>
            {result?.subject && <p className="text-xs text-gray-500 truncate">Asunto: {result.subject}</p>}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-gray-200 overflow-hidden">
              {versions.map(v => (
                <button key={v} onClick={() => setVersion(v)}
                  className={`px-2.5 py-1.5 text-xs font-medium ${version === v ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                  {DIGEST_LABEL[v].replace('Resumen ', '').replace('Alerta de backups', 'Alerta')}
                </button>
              ))}
            </div>
            <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
          </div>
        </div>

        <div className="px-5 py-2 border-b border-gray-100 text-xs text-gray-600 flex items-start gap-2 min-h-[2.25rem]">
          <Users className="w-3.5 h-3.5 mt-0.5 text-gray-400 shrink-0" />
          {result
            ? (result.recipients.length
                ? <span>Le llega a: {result.recipients.map(r => `${r.name || r.email} <${r.email}>`).join(', ')}</span>
                : <span className="text-gray-400">Sin destinatarios para esta versión</span>)
            : <span className="text-gray-400">…</span>}
        </div>
        {result?.note && (
          <div className="px-5 py-2 text-xs text-amber-800 bg-amber-50 border-b border-amber-100">{result.note}</div>
        )}

        <div className="flex-1 min-h-0 bg-gray-50">
          {loading ? (
            <div className="h-full flex items-center justify-center text-sm text-gray-400 gap-2"><RefreshCw className="w-4 h-4 animate-spin" /> Generando…</div>
          ) : error ? (
            <div className="h-full flex items-center justify-center text-sm text-red-600 px-6 text-center">No se pudo generar la vista previa: {error}</div>
          ) : result?.html ? (
            <iframe srcDoc={result.html} title={`Vista previa ${DIGEST_LABEL[version]}`} className="w-full h-full border-0 bg-white" sandbox="" />
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-gray-400 px-6 text-center">{result?.note ?? 'Sin contenido.'}</div>
          )}
        </div>
      </div>
    </div>
  );
}
