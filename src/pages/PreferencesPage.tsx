import { useEffect, useState } from 'react';
import { CheckCircle, Bell, BellOff, AlertTriangle } from 'lucide-react';

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

const FREQ_OPTIONS = [
  { value: 'daily',  label: 'Diario',      desc: 'Recibís alertas y resúmenes cada día' },
  { value: 'weekly', label: 'Semanal',      desc: 'Un resumen por semana con lo más importante' },
  { value: 'none',   label: 'Desactivar',   desc: 'No recibís emails de este portal' },
];

type Contact = { name: string; email: string; company: string; digest_frequency: string };

export function PreferencesPage() {
  const token = new URLSearchParams(window.location.search).get('token') ?? '';

  const [contact, setContact]       = useState<Contact | null>(null);
  const [selected, setSelected]     = useState('');
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [saved, setSaved]           = useState(false);
  const [error, setError]           = useState('');

  const headers = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_ANON,
    'Authorization': `Bearer ${SUPABASE_ANON}`,
  };

  useEffect(() => {
    if (!token) { setError('Link inválido.'); setLoading(false); return; }
    fetch(`${SUPABASE_URL}/functions/v1/email-preferences?token=${encodeURIComponent(token)}`, { headers })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((data: Contact) => { setContact(data); setSelected(data.digest_frequency); })
      .catch(() => setError('Link inválido o expirado.'))
      .finally(() => setLoading(false));
  }, [token]);

  const handleSave = async () => {
    if (!token || selected === contact?.digest_frequency) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/email-preferences`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ token, frequency: selected }),
      });
      if (!res.ok) throw new Error();
      setSaved(true);
      setContact(c => c ? { ...c, digest_frequency: selected } : c);
    } catch {
      setError('No se pudo guardar. Intentá de nuevo.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B192C] flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <img
            src="https://landing.cenas.uy/assets/brand/logo-dark.png"
            alt="Cenas IT" className="h-8 w-auto mx-auto mb-3"
            onError={e => { e.currentTarget.style.display = 'none'; }}
          />
          <p className="text-slate-400 text-sm">Preferencias de notificaciones</p>
        </div>

        <div className="bg-[#111827] border border-slate-700/60 rounded-2xl overflow-hidden shadow-2xl">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <span className="w-6 h-6 border-2 border-slate-600 border-t-[#06B6D4] rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div className="p-8 text-center">
              <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-3" />
              <p className="text-slate-300 text-sm">{error}</p>
              <a href="/acceso" className="mt-4 inline-block text-xs text-[#06B6D4] hover:underline">Volver al portal</a>
            </div>
          ) : saved ? (
            <div className="p-8 text-center">
              <div className="w-14 h-14 bg-emerald-900/40 border border-emerald-700/50 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-7 h-7 text-emerald-400" />
              </div>
              <h3 className="text-white font-bold text-lg mb-1">
                {selected === 'none' ? '¡Desuscripto!' : '¡Preferencia guardada!'}
              </h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                {selected === 'none'
                  ? 'Ya no vas a recibir emails de este portal. Podés volver a activarlos cuando quieras.'
                  : `Vas a recibir notificaciones en modo ${FREQ_OPTIONS.find(f => f.value === selected)?.label.toLowerCase()}.`}
              </p>
              <button
                onClick={() => setSaved(false)}
                className="mt-5 text-xs text-slate-500 hover:text-slate-400 underline"
              >
                Cambiar de nuevo
              </button>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="p-6 border-b border-slate-700/60">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-[#06B6D4]/10 border border-[#06B6D4]/20 rounded-xl flex items-center justify-center">
                    <Bell className="w-5 h-5 text-[#06B6D4]" />
                  </div>
                  <div>
                    <p className="text-white font-semibold text-sm">{contact?.name}</p>
                    <p className="text-slate-400 text-xs">{contact?.email} · {contact?.company}</p>
                  </div>
                </div>
              </div>

              {/* Opciones */}
              <div className="p-6 space-y-3">
                <p className="text-slate-300 text-sm mb-4">¿Con qué frecuencia querés recibir notificaciones?</p>
                {FREQ_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setSelected(opt.value)}
                    className={`w-full flex items-center gap-4 p-4 rounded-xl border text-left transition-all ${
                      selected === opt.value
                        ? opt.value === 'none'
                          ? 'bg-red-950/40 border-red-700/60'
                          : 'bg-[#06B6D4]/10 border-[#06B6D4]/50'
                        : 'bg-[#0B192C]/60 border-slate-700/40 hover:border-slate-600'
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                      selected === opt.value
                        ? opt.value === 'none' ? 'bg-red-900/50' : 'bg-[#06B6D4]/20'
                        : 'bg-slate-800'
                    }`}>
                      {opt.value === 'none'
                        ? <BellOff className={`w-4 h-4 ${selected === opt.value ? 'text-red-400' : 'text-slate-500'}`} />
                        : <Bell className={`w-4 h-4 ${selected === opt.value ? 'text-[#06B6D4]' : 'text-slate-500'}`} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-semibold ${selected === opt.value ? opt.value === 'none' ? 'text-red-300' : 'text-white' : 'text-slate-300'}`}>
                        {opt.label}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">{opt.desc}</div>
                    </div>
                    <div className={`w-4 h-4 rounded-full border-2 shrink-0 ${
                      selected === opt.value
                        ? opt.value === 'none' ? 'border-red-500 bg-red-500' : 'border-[#06B6D4] bg-[#06B6D4]'
                        : 'border-slate-600'
                    }`} />
                  </button>
                ))}
              </div>

              {/* Acción */}
              <div className="px-6 pb-6 space-y-3">
                {error && (
                  <div className="bg-red-950/40 border border-red-700/50 rounded-lg p-3 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
                    <p className="text-sm text-red-300">{error}</p>
                  </div>
                )}
                <button
                  onClick={handleSave}
                  disabled={saving || selected === contact?.digest_frequency}
                  className="w-full py-3 bg-[#06B6D4] hover:bg-[#0891B2] disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  {saving
                    ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    : selected === 'none' ? 'Desuscribirse' : 'Guardar preferencia'}
                </button>
                <p className="text-center text-xs text-slate-600">
                  Podés cambiar tus preferencias en cualquier momento.
                </p>
              </div>
            </>
          )}
        </div>

        <p className="text-center text-xs text-slate-700 mt-6">
          Cenas IT Solutions · <a href="/acceso" className="hover:text-slate-500">Portal de servicios</a>
        </p>
      </div>
    </div>
  );
}
