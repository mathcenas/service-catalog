import { useState } from 'react';
import { MessageSquare, ArrowRight, CheckCircle, AlertTriangle, ChevronLeft } from 'lucide-react';

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

const REASONS = [
  { value: 'access',  label: 'Recuperar acceso al portal' },
  { value: 'support', label: 'Soporte técnico' },
  { value: 'billing', label: 'Consulta de facturación' },
  { value: 'other',   label: 'Otro' },
];

export function ContactPage() {
  const [form, setForm] = useState({ name: '', email: '', company: '', reason: 'support', message: '' });
  const [sent, setSent]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/contact-form`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON,
          'Authorization': `Bearer ${SUPABASE_ANON}`,
        },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error();
      setSent(true);
    } catch {
      setError('No se pudo enviar el mensaje. Intentá de nuevo o escribinos a info@cenas.uy');
    } finally {
      setLoading(false);
    }
  };

  const inputClass = "w-full px-4 py-3 bg-white border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#06B6D4] focus:ring-1 focus:ring-[#06B6D4] transition-all disabled:opacity-60";
  const labelClass = "block text-xs font-bold text-[#0B192C] uppercase tracking-wider mb-2";

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-12 bg-[#F8FAFC] font-sans">

      {/* Panel izquierdo */}
      <div className="order-2 lg:order-1 lg:col-span-5 bg-[#0B192C] p-8 lg:p-12 flex flex-col justify-between relative overflow-hidden">
        <div className="absolute top-0 left-0 w-96 h-96 bg-[#06B6D4]/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10">
          <img
            src="https://landing.cenas.uy/assets/brand/logo-dark.png"
            alt="Cenas IT Solutions"
            className="h-9 w-auto"
            onError={e => { e.currentTarget.style.display = 'none'; }}
          />
        </div>

        <div className="relative z-10 my-12">
          <span className="inline-block px-3 py-1 bg-[#06B6D4]/10 border border-[#06B6D4]/30 text-[#06B6D4] text-xs font-mono font-bold rounded-md mb-4">
            MESA DE AYUDA
          </span>
          <h1 className="text-2xl lg:text-3xl font-extrabold text-white tracking-tight leading-tight mb-4">
            ¿En qué te podemos ayudar?
          </h1>
          <p className="text-slate-400 text-sm leading-relaxed mb-8">
            Completá el formulario y un técnico de Cenas IT te va a responder a la brevedad.
          </p>

          <div className="space-y-4">
            {[
              { icon: '⚡', title: 'Respuesta rápida', desc: 'Tiempo de respuesta en horario hábil' },
              { icon: '🔒', title: 'Soporte seguro', desc: 'Tus datos están protegidos' },
              { icon: '📋', title: 'Seguimiento', desc: 'Seguimos tu caso hasta resolverlo' },
            ].map(item => (
              <div key={item.title} className="flex items-start gap-3">
                <span className="text-lg mt-0.5">{item.icon}</span>
                <div>
                  <div className="text-sm font-semibold text-white">{item.title}</div>
                  <div className="text-xs text-slate-400">{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 pt-6 border-t border-slate-800 flex justify-between items-center text-xs text-slate-500">
          <span>Cenas IT Solutions</span>
          <span className="font-mono text-slate-400">ISO/IEC 20000</span>
        </div>
      </div>

      {/* Panel derecho */}
      <div className="order-1 lg:order-2 lg:col-span-7 flex items-center justify-center p-6 sm:p-12 lg:p-16">
        <div className="w-full max-w-md space-y-8">

          <div>
            <a href="/acceso" className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-[#06B6D4] transition-colors mb-5">
              <ChevronLeft className="w-3.5 h-3.5" /> Volver al portal
            </a>
            <div className="w-12 h-12 bg-[#06B6D4]/10 border border-[#06B6D4]/20 rounded-xl flex items-center justify-center text-[#06B6D4] mb-4 shadow-sm">
              <MessageSquare className="w-6 h-6" />
            </div>
            <h2 className="text-2xl font-bold text-[#0B192C]">Contactar a Mesa de Ayuda</h2>
            <p className="text-xs text-slate-500 mt-1">Completá el formulario y te respondemos a la brevedad.</p>
          </div>

          {sent ? (
            <div className="text-center py-8">
              <div className="w-14 h-14 bg-emerald-50 border border-emerald-200 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-7 h-7 text-emerald-500" />
              </div>
              <h3 className="text-lg font-bold text-[#0B192C] mb-1">¡Mensaje enviado!</h3>
              <p className="text-slate-500 text-sm leading-relaxed">
                Recibimos tu consulta y te respondemos a la brevedad en <strong>{form.email}</strong>.
              </p>
              <button
                onClick={() => { setSent(false); setForm({ name: '', email: '', company: '', reason: 'support', message: '' }); }}
                className="mt-6 text-xs text-slate-400 hover:text-[#06B6D4] underline transition-colors"
              >
                Enviar otra consulta
              </button>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Nombre</label>
                  <input type="text" required placeholder="Tu nombre" value={form.name} onChange={set('name')} disabled={loading} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Empresa</label>
                  <input type="text" placeholder="Opcional" value={form.company} onChange={set('company')} disabled={loading} className={inputClass} />
                </div>
              </div>

              <div>
                <label className={labelClass}>Email</label>
                <input type="email" required autoComplete="email" placeholder="tu@email.com" value={form.email} onChange={set('email')} disabled={loading} className={inputClass} />
              </div>

              <div>
                <label className={labelClass}>Motivo</label>
                <select value={form.reason} onChange={set('reason')} disabled={loading}
                  className={inputClass + " cursor-pointer"}>
                  {REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>

              <div>
                <label className={labelClass}>Mensaje</label>
                <textarea
                  required rows={4} placeholder="Describí tu consulta o problema..."
                  value={form.message} onChange={set('message')} disabled={loading}
                  className={inputClass + " resize-none"}
                />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              <button
                type="submit" disabled={loading}
                className="w-full py-3.5 px-4 bg-[#06B6D4] hover:bg-[#0891B2] text-white font-bold text-sm rounded-lg transition-all shadow-sm hover:shadow-[0_8px_20px_-6px_rgba(6,182,212,0.4)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading
                  ? <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  : <>Enviar consulta <ArrowRight className="w-4 h-4" /></>}
              </button>
            </form>
          )}

          <div className="pt-4 text-center border-t border-slate-200/60">
            <p className="text-xs text-slate-500">
              También podés escribirnos a{' '}
              <a href="mailto:info@cenas.uy" className="text-[#06B6D4] font-bold hover:underline">info@cenas.uy</a>
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}
