import { useEffect, useMemo, useState } from 'react';
import { X, ExternalLink, Send, Copy, Loader2, FolderOpen, Users } from 'lucide-react';
import { supabase, type Service, type Client } from '../lib/supabase';

type AclSnapshotLite = {
  id: string;
  service_id: string;
  generated_at: string;
  snapshot: {
    hostname?: string;
    shares: { smb_name: string; enabled?: boolean; users?: { name: string; access: string }[]; groups?: { name: string; access: string }[] }[];
    users: { name: string; last_login?: string | null }[];
  };
};

type Recipient = { email: string; label: string; source: string };

const DEFAULT_BODY =
  'Le enviamos el siguiente enlace para que revise los usuarios con acceso a los archivos compartidos del servidor.\n\n' +
  'Por favor indique para cada usuario si desea mantenerlo, eliminarlo o realizar algún cambio. El enlace tiene una validez de 15 días.\n\n' +
  'Esta revisión se realiza cada 6 meses para garantizar que solo los usuarios correctos tengan acceso a sus archivos.';

/**
 * Vista previa antes de mandar la revisión de accesos al cliente:
 * crea el enlace (sin enviar nada), deja verlo como el cliente, elegir
 * destinatarios y ajustar el texto del mail. Recién "Enviar" manda el mail.
 */
export function AclReviewSendModal({ snap, service, client, logoUrl, onClose, onLink }: {
  snap: AclSnapshotLite;
  service?: Service;
  client?: Client | null;
  logoUrl?: string | null;
  onClose: () => void;
  onLink: (link: string) => void;
}) {
  const svcName = service?.business_name || service?.name || 'NAS';
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [contacts, setContacts] = useState<{ name: string; email: string; role?: string | null }[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [subject, setSubject] = useState(`Revisión de usuarios — ${svcName}`);
  const [body, setBody] = useState(DEFAULT_BODY);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(false);

  // 1. Crear el enlace (reemplaza uno anterior sin usar). No manda nada.
  useEffect(() => {
    (async () => {
      try {
        await supabase.from('acl_review_tokens').delete().eq('snapshot_id', snap.id).is('submitted_at', null);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Sesión vencida');
        const { data, error: err } = await supabase.from('acl_review_tokens')
          .insert({ snapshot_id: snap.id, service_id: snap.service_id, client_id: client?.id || null, user_id: user.id })
          .select('token').single();
        if (err || !data) throw err ?? new Error('No se generó el enlace');
        const l = `${window.location.origin}/acl-review/${data.token}`;
        setLink(l);
        onLink(l);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error al generar el enlace');
      }
    })();
    if (client?.id) {
      supabase.from('client_contacts').select('name, email, role').eq('client_id', client.id).order('name')
        .then(({ data }) => setContacts(data || []));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.id]);

  const recipients = useMemo<Recipient[]>(() => {
    const out: Recipient[] = [];
    const seen = new Set<string>();
    const add = (email: string | undefined | null, label: string, source: string) => {
      const e = (email || '').trim();
      if (!e || seen.has(e.toLowerCase())) return;
      seen.add(e.toLowerCase());
      out.push({ email: e, label, source });
    };
    add(client?.email, client?.contact_name || client?.company_name || '', 'Principal');
    add(client?.alt_email, client?.alt_email || '', 'Alternativo');
    (client?.cc_emails || '').split(',').forEach(e => add(e, e.trim(), 'CC'));
    contacts.forEach(c => add(c.email, c.name, c.role || 'Contacto'));
    return out;
  }, [client, contacts]);

  // Por defecto: principal + alternativo + CC (como antes)
  useEffect(() => {
    setSelected(new Set(recipients.filter(r => r.source !== 'Contacto' && !contacts.some(c => c.email === r.email)).map(r => r.email)));
  }, [recipients, contacts]);

  const enabledShares = snap.snapshot.shares.filter(s => s.enabled !== false);

  const send = async () => {
    if (!link || selected.size === 0) return;
    setSending(true);
    setError('');
    const list = recipients.filter(r => selected.has(r.email)).map(r => r.email);
    const { data: shareTok } = client?.id
      ? await supabase.from('client_share_tokens').select('token').eq('client_id', client.id).limit(1).maybeSingle()
      : { data: null };
    const single = list.length === 1 ? contacts.find(c => c.email.toLowerCase() === list[0].toLowerCase()) : undefined;
    const { error: err } = await supabase.functions.invoke('notify-client', {
      body: {
        client_email: list[0],
        cc_emails: list.slice(1).join(',') || undefined,
        client_name: single?.name || client?.contact_name || client?.company_name,
        subject,
        title: `Auditoría de accesos SMB — ${svcName}`,
        description: body,
        share_url: link,
        share_url_label: 'Iniciar revisión →',
        portal_url: shareTok?.token ? `${window.location.origin}/share/${shareTok.token}` : undefined,
        logo_url: logoUrl || undefined,
        category: 'audit',
      },
    });
    setSending(false);
    if (err) setError(`No se pudo enviar: ${err.message}`);
    else setSent(true);
  };

  const copy = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* sin portapapeles */ }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto" onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Revisión de accesos — vista previa</h3>
            <p className="text-xs text-gray-500">{client?.company_name} · {svcName}{snap.snapshot.hostname ? ` (${snap.snapshot.hostname})` : ''} · {new Date(snap.generated_at).toLocaleString('es-UY', { dateStyle: 'short', timeStyle: 'short' })}</p>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
        </div>

        {sent ? (
          <div className="p-8 text-center">
            <p className="text-emerald-700 font-semibold">Enviado a {selected.size} destinatario{selected.size === 1 ? '' : 's'}.</p>
            <p className="text-sm text-gray-500 mt-1">Cuando el cliente responda, te llega por correo.</p>
            <button onClick={onClose} className="mt-5 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg">Cerrar</button>
          </div>
        ) : (
          <div className="p-5 space-y-5">
            {/* Qué va a revisar el cliente */}
            <section>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Lo que va a revisar</h4>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="border border-gray-200 rounded-lg p-3">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-gray-800 mb-1.5"><FolderOpen className="w-4 h-4 text-gray-400" /> {enabledShares.length} carpetas compartidas</p>
                  <ul className="text-xs text-gray-600 space-y-0.5 max-h-32 overflow-y-auto">
                    {enabledShares.map(s => (
                      <li key={s.smb_name}><span className="font-medium">{s.smb_name}</span> · {((n: number) => `${n} acceso${n === 1 ? '' : 's'}`)((s.users?.length ?? 0) + (s.groups?.length ?? 0))}</li>
                    ))}
                  </ul>
                </div>
                <div className="border border-gray-200 rounded-lg p-3">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-gray-800 mb-1.5"><Users className="w-4 h-4 text-gray-400" /> {snap.snapshot.users.length} usuarios</p>
                  <p className="text-xs text-gray-600 max-h-32 overflow-y-auto leading-relaxed">{snap.snapshot.users.map(u => u.name).join(', ')}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-3">
                {link ? (
                  <>
                    <a href={`${link}?preview=1`} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-blue-700 border border-blue-200 hover:border-blue-400 px-3 py-1.5 rounded-lg">
                      <ExternalLink className="w-4 h-4" /> Ver como el cliente
                    </a>
                    <button onClick={copy} className="inline-flex items-center gap-1.5 text-sm text-gray-700 border border-gray-200 hover:border-gray-400 px-3 py-1.5 rounded-lg">
                      <Copy className="w-4 h-4" /> {copied ? 'Copiado' : 'Copiar enlace'}
                    </button>
                  </>
                ) : !error && <span className="inline-flex items-center gap-1.5 text-xs text-gray-400"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generando enlace…</span>}
              </div>
            </section>

            {/* Destinatarios */}
            <section>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Destinatarios</h4>
              {recipients.length === 0 ? (
                <p className="text-sm text-amber-700">El cliente no tiene emails cargados. Podés copiar el enlace y mandarlo a mano.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {recipients.map(r => (
                    <label key={r.email} className={`inline-flex items-center gap-2 text-xs border rounded-lg px-2.5 py-1.5 cursor-pointer ${selected.has(r.email) ? 'border-blue-300 bg-blue-50' : 'border-gray-200'}`}>
                      <input type="checkbox" checked={selected.has(r.email)}
                        onChange={() => setSelected(prev => { const n = new Set(prev); if (n.has(r.email)) n.delete(r.email); else n.add(r.email); return n; })} />
                      <span>
                        <span className="text-gray-800">{r.label || r.email}</span>
                        <span className="text-gray-400"> · {r.label !== r.email ? `${r.email} · ` : ''}{r.source}</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </section>

            {/* Mail */}
            <section>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Mail</h4>
              <input value={subject} onChange={e => setSubject(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-2 focus:ring-2 focus:ring-blue-500 outline-none" />
              <textarea value={body} onChange={e => setBody(e.target.value)} rows={6}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm leading-relaxed focus:ring-2 focus:ring-blue-500 outline-none" />
              <p className="text-[11px] text-gray-400 mt-1">Debajo del texto va el botón "Iniciar revisión →" con el enlace.</p>
            </section>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={onClose} className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cerrar sin enviar</button>
              <button onClick={send} disabled={!link || selected.size === 0 || sending}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-40">
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Enviar a {selected.size} destinatario{selected.size === 1 ? '' : 's'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
