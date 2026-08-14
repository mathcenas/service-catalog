import { useState, useEffect } from 'react';
import { CheckCircle2, Trash2, Edit2, Users, FolderOpen, Loader2, Send, AlertTriangle } from 'lucide-react';

type Props = { token: string };
type Action = 'mantener' | 'eliminar' | 'cambiar';

interface AclPrivilege { type: string; name: string; access: string; perms: number; }
interface AclShare { smb_name: string; folder_name: string; rel_path: string; comment: string; readonly: boolean; guest_access: boolean; enabled: boolean; users: AclPrivilege[]; groups: AclPrivilege[]; }
interface AclUser { name: string; uid?: string; comment?: string; groups?: string[]; last_login?: string | null; }

interface ReviewData {
  snapshot: { shares: AclShare[]; users: AclUser[]; hostname?: string; generated_at: string };
  generated_at: string;
  service_name: string;
  client_name: string;
  expires_at: string;
  logo_url: string | null;
  company_name: string;
}

interface UserResponse { name: string; action: Action; note?: string; }

export function AclReviewPage({ token }: Props) {
  const [data, setData] = useState<ReviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [responses, setResponses] = useState<Record<string, UserResponse>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.replace(/\/functions\/v1.*/, '');

  useEffect(() => {
    fetch(`${supabaseUrl}/functions/v1/get-acl-review?token=${token}`, {
      headers: {
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
    })
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); return; }
        setData(d);
        const initial: Record<string, UserResponse> = {};
        d.snapshot.users.forEach((u: AclUser) => { initial[u.name] = { name: u.name, action: 'mantener' }; });
        setResponses(initial);
      })
      .catch(() => setError('Error al cargar la revisión.'));
  }, [token, supabaseUrl]);

  function setAll(action: Action) {
    setResponses(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(k => { next[k] = { ...next[k], action }; });
      return next;
    });
  }

  function setResponse(name: string, patch: Partial<UserResponse>) {
    setResponses(prev => ({ ...prev, [name]: { ...prev[name], ...patch } }));
  }

  async function handleSubmit() {
    if (!data) return;
    setSubmitting(true);
    const payload = Object.values(responses).map(r => ({
      name: r.name,
      action: r.action,
      ...(r.note ? { note: r.note } : {}),
    }));
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/submit-acl-review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ token, responses: payload }),
      });
      const d = await res.json();
      if (d.error) { setError(d.error); setSubmitting(false); return; }
      setSubmitted(true);
    } catch {
      setError('Error al enviar la revisión.');
      setSubmitting(false);
    }
  }

  if (error === 'Token expired') return <ErrorPage title="Enlace vencido" message="Este enlace de revisión ha expirado. Solicite uno nuevo a su proveedor de servicios." />;
  if (error === 'Already submitted') return <ErrorPage title="Ya enviado" message="Esta revisión ya fue completada. Gracias por su colaboración." />;
  if (error) return <ErrorPage title="Error" message={error} />;
  if (!data) return <LoadingPage />;
  if (submitted) return <SuccessPage companyName={data.company_name} logoUrl={data.logo_url} />;

  const { snapshot, service_name, client_name, logo_url, company_name, expires_at } = data;
  const { shares, users } = snapshot;
  const expiresDate = new Date(expires_at).toLocaleDateString('es-UY', { dateStyle: 'long' });
  const daysLeft = Math.ceil((new Date(expires_at).getTime() - Date.now()) / 86400000);

  const needsAction = Object.values(responses).filter(r => r.action !== 'mantener').length;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Watermark logo */}
      {logo_url && (
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-30 flex items-end justify-center px-4 pb-5">
          <img
            src={logo_url}
            alt=""
            draggable={false}
            className="h-auto w-full max-w-[8rem] select-none object-contain opacity-[0.18] drop-shadow-[0_1px_6px_rgba(255,255,255,0.6)]"
          />
        </div>
      )}
      {/* Header */}
      <div className="bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 py-5">
          {logo_url && <img src={logo_url} alt="Logo" className="h-8 mb-3 object-contain" />}
          <h1 className="text-xl font-bold text-slate-900">Revisión de Usuarios — {service_name}</h1>
          <p className="text-sm text-slate-500 mt-1">{client_name} · Válido hasta {expiresDate}{daysLeft <= 3 && <span className="ml-2 text-amber-600 font-medium">({daysLeft}d restantes)</span>}</p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Instructions */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
          <p className="font-semibold mb-1">¿Cómo funciona?</p>
          <p>Revisá cada usuario y seleccioná la acción correspondiente. Podés agregar una nota si querés cambiar el acceso o el nombre. Al finalizar, hacé clic en <strong>Enviar revisión</strong>. {company_name} recibirá tu respuesta y gestionará los cambios.</p>
          <p className="mt-2 text-blue-600 text-xs">Esta revisión se realiza cada 6 meses para garantizar que solo los usuarios correctos tengan acceso a los archivos compartidos.</p>
        </div>

        {/* Shares summary (read-only) */}
        {shares.filter(s => s.enabled).length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
              <FolderOpen className="w-4 h-4 text-amber-500" />
              <span className="font-semibold text-slate-700 text-sm">Carpetas compartidas</span>
            </div>
            <div className="divide-y divide-slate-100">
              {shares.filter(s => s.enabled).map(share => (
                <div key={share.smb_name} className="px-4 py-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="font-medium text-slate-900 text-sm">{share.smb_name}</span>
                    {share.comment && <span className="text-xs text-slate-400">{share.comment}</span>}
                    {share.readonly && <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded uppercase font-medium">solo lectura</span>}
                    {share.guest_access && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded uppercase font-medium">guest</span>}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {[...share.users, ...share.groups].map(p => (
                      <span key={p.name} className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                        p.access === 'read/write' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                        p.access === 'read only' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                        'bg-slate-100 text-slate-400 border-slate-200 line-through'}`}>
                        {p.type === 'group' ? <><Users className="inline w-2.5 h-2.5 mr-0.5" />{p.name}</> : p.name}
                        <span className="opacity-60 font-normal ml-1">{p.access === 'read/write' ? 'R/W' : p.access === 'read only' ? 'R' : '✗'}</span>
                      </span>
                    ))}
                    {share.users.length === 0 && share.groups.length === 0 && <span className="text-xs text-slate-400">Sin permisos explícitos</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* User review */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-slate-500" />
              <span className="font-semibold text-slate-700 text-sm">Usuarios ({users.length})</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setAll('mantener')} className="text-xs text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2.5 py-1 rounded-lg font-medium transition-colors">Mantener todo</button>
            </div>
          </div>
          <div className="divide-y divide-slate-100">
            {users.map(u => {
              const resp = responses[u.name] || { name: u.name, action: 'mantener' as Action };
              return (
                <div key={u.name} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-slate-900 text-sm">{u.name}</p>
                      {u.comment && <p className="text-xs text-slate-400">{u.comment}</p>}
                      {u.groups && u.groups.length > 0 && (
                        <p className="text-xs text-slate-400 mt-0.5">Grupos: {u.groups.join(', ')}</p>
                      )}
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <ActionButton current={resp.action} value="mantener" label="Mantener"
                        icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                        color="emerald"
                        onClick={() => setResponse(u.name, { action: 'mantener' })} />
                      <ActionButton current={resp.action} value="eliminar" label="Eliminar"
                        icon={<Trash2 className="w-3.5 h-3.5" />}
                        color="red"
                        onClick={() => setResponse(u.name, { action: 'eliminar' })} />
                      <ActionButton current={resp.action} value="cambiar" label="Cambiar"
                        icon={<Edit2 className="w-3.5 h-3.5" />}
                        color="amber"
                        onClick={() => setResponse(u.name, { action: 'cambiar' })} />
                    </div>
                  </div>
                  {(resp.action === 'eliminar' || resp.action === 'cambiar') && (
                    <div className="mt-2 ml-0">
                      <input
                        type="text"
                        placeholder={resp.action === 'cambiar' ? 'Describir el cambio solicitado...' : 'Motivo de eliminación (opcional)...'}
                        value={resp.note || ''}
                        onChange={e => setResponse(u.name, { note: e.target.value })}
                        className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none bg-slate-50 placeholder-slate-400"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Submit */}
        {needsAction > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
            <AlertTriangle className="inline w-4 h-4 mr-1.5 mb-0.5" />
            <strong>{needsAction} usuario(s)</strong> requieren acción. Revisá las notas antes de enviar.
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition-colors text-sm shadow-sm"
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {submitting ? 'Enviando...' : 'Enviar revisión'}
        </button>

        <p className="text-center text-xs text-slate-400">Al enviar, {company_name} recibirá tu respuesta por correo y gestionará los cambios necesarios.</p>
      </div>
    </div>
  );
}

function ActionButton({ current, value, label, icon, color, onClick }: {
  current: Action; value: Action; label: string; icon: React.ReactNode;
  color: 'emerald' | 'red' | 'amber'; onClick: () => void;
}) {
  const active = current === value;
  const colors = {
    emerald: active ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-emerald-700 border-emerald-200 hover:bg-emerald-50',
    red:     active ? 'bg-red-600 text-white border-red-600'         : 'bg-white text-red-600 border-red-200 hover:bg-red-50',
    amber:   active ? 'bg-amber-500 text-white border-amber-500'     : 'bg-white text-amber-600 border-amber-200 hover:bg-amber-50',
  };
  return (
    <button onClick={onClick} className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border font-medium transition-colors ${colors[color]}`}>
      {icon}{label}
    </button>
  );
}

function LoadingPage() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
    </div>
  );
}

function ErrorPage({ title, message }: { title: string; message: string }) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="max-w-md text-center">
        <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-6 h-6 text-red-500" />
        </div>
        <h1 className="text-lg font-bold text-slate-900 mb-2">{title}</h1>
        <p className="text-sm text-slate-500">{message}</p>
      </div>
    </div>
  );
}

function SuccessPage({ companyName, logoUrl }: { companyName: string; logoUrl: string | null }) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="max-w-md text-center">
        {logoUrl && <img src={logoUrl} alt="Logo" className="h-8 object-contain mx-auto mb-6" />}
        <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 className="w-8 h-8 text-emerald-600" />
        </div>
        <h1 className="text-xl font-bold text-slate-900 mb-2">¡Revisión enviada!</h1>
        <p className="text-sm text-slate-500">{companyName} procesará los cambios solicitados y te contactará si necesita información adicional.</p>
        <p className="text-xs text-slate-400 mt-4">Podés cerrar esta página.</p>
      </div>
    </div>
  );
}
