import { useState } from 'react';
import { Mail, ArrowRight, CheckCircle, Lock, AlertTriangle, Shield } from 'lucide-react';

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export function AccessPage() {
  const [email, setEmail]     = useState('');
  const [sent, setSent]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [tab, setTab]         = useState<'link' | 'password'>('link');

  const handleSendLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/send-portal-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      if (!res.ok) throw new Error('Error al enviar');
      setSent(true);
    } catch {
      setError('No se pudo enviar el link. Intentá de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-12 bg-[#F8FAFC] font-sans">

      {/* Panel izquierdo — corporativo */}
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
            PORTAL DE SERVICIOS
          </span>
          <h1 className="text-2xl lg:text-3xl font-extrabold text-white tracking-tight leading-tight mb-4">
            Tu infraestructura IT, en tiempo real.
          </h1>
          <p className="text-slate-400 text-sm leading-relaxed mb-6">
            Accedé al estado de tus servicios, historial de backups, proyectos activos y reportes de auditoría.
          </p>

          <div className="space-y-2.5">
            {['Monitoreo 24/7 de servicios', 'Historial de backups y alertas', 'Proyectos y roadmap'].map(item => (
              <div key={item} className="flex items-center gap-2.5 text-sm text-slate-300">
                <span className="w-1.5 h-1.5 rounded-full bg-[#06B6D4] shrink-0" />
                {item}
              </div>
            ))}
          </div>

          <div className="mt-8 inline-flex items-center gap-2 bg-[#1E293B] border border-slate-700/60 px-3.5 py-2 rounded-lg text-xs font-medium text-slate-200">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#10B981] opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#10B981]" />
            </span>
            Infraestructura monitoreada 24/7
          </div>
        </div>

        <div className="relative z-10 pt-6 border-t border-slate-800 flex justify-between items-center text-xs text-slate-500">
          <span>Cenas IT Solutions</span>
          <span className="font-mono text-slate-400">ISO/IEC 20000</span>
        </div>
      </div>

      {/* Panel derecho — formulario */}
      <div className="order-1 lg:order-2 lg:col-span-7 flex items-center justify-center p-6 sm:p-12 lg:p-16">
        <div className="w-full max-w-md space-y-8">

          <div>
            <div className="w-12 h-12 bg-[#06B6D4]/10 border border-[#06B6D4]/20 rounded-xl flex items-center justify-center text-[#06B6D4] mb-4 shadow-sm">
              <Shield className="w-6 h-6" />
            </div>
            <h2 className="text-2xl font-bold text-[#0B192C]">Acceder al portal</h2>
            <p className="text-xs text-slate-500 mt-1">
              Ingresá tu email para recibir el link de acceso, o usá usuario y contraseña.
            </p>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-slate-200">
            <button
              onClick={() => setTab('link')}
              className={`flex-1 pb-3 text-sm font-semibold transition-colors border-b-2 -mb-px ${
                tab === 'link'
                  ? 'text-[#06B6D4] border-[#06B6D4]'
                  : 'text-slate-400 border-transparent hover:text-slate-600'
              }`}
            >
              <Mail className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
              Acceder por email
            </button>
            <button
              onClick={() => setTab('password')}
              className={`flex-1 pb-3 text-sm font-semibold transition-colors border-b-2 -mb-px ${
                tab === 'password'
                  ? 'text-[#06B6D4] border-[#06B6D4]'
                  : 'text-slate-400 border-transparent hover:text-slate-600'
              }`}
            >
              <Lock className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
              Usuario y contraseña
            </button>
          </div>

          {tab === 'link' ? (
            sent ? (
              <div className="text-center py-6">
                <div className="w-14 h-14 bg-emerald-50 border border-emerald-200 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="w-7 h-7 text-emerald-500" />
                </div>
                <h3 className="text-lg font-bold text-[#0B192C] mb-1">¡Revisá tu correo!</h3>
                <p className="text-slate-500 text-sm leading-relaxed">
                  Si tu email está registrado, te enviamos el link de acceso a tu portal de servicios.
                </p>
                <button
                  onClick={() => { setSent(false); setEmail(''); setError(''); }}
                  className="mt-6 text-xs text-slate-400 hover:text-[#06B6D4] underline transition-colors"
                >
                  Intentar con otro email
                </button>
              </div>
            ) : (
              <form className="space-y-5" onSubmit={handleSendLink}>
                <div>
                  <label htmlFor="email" className="block text-xs font-bold text-[#0B192C] uppercase tracking-wider mb-2">
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    disabled={loading}
                    placeholder="tu@email.com"
                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-lg text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#06B6D4] focus:ring-1 focus:ring-[#06B6D4] transition-all disabled:opacity-60"
                  />
                </div>

                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
                    <p className="text-sm text-red-700">{error}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3.5 px-4 bg-[#06B6D4] hover:bg-[#0891B2] text-white font-bold text-sm rounded-lg transition-all duration-200 shadow-sm hover:shadow-[0_8px_20px_-6px_rgba(6,182,212,0.4)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  ) : (
                    <>Enviar link de acceso <ArrowRight className="w-4 h-4" /></>
                  )}
                </button>
              </form>
            )
          ) : (
            <div className="space-y-5">
              <div>
                <label className="block text-xs font-bold text-[#0B192C] uppercase tracking-wider mb-2">Usuario</label>
                <input
                  type="text"
                  disabled
                  placeholder="usuario"
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-400 placeholder-slate-300 cursor-not-allowed"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#0B192C] uppercase tracking-wider mb-2">Contraseña</label>
                <input
                  type="password"
                  disabled
                  placeholder="••••••••••••"
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-400 placeholder-slate-300 cursor-not-allowed"
                />
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 flex items-center gap-3">
                <Lock className="w-4 h-4 text-slate-400 shrink-0" />
                <p className="text-sm text-slate-500">Acceso con usuario y contraseña — <span className="font-semibold">próximamente disponible.</span></p>
              </div>
              <button
                disabled
                className="w-full py-3.5 px-4 bg-slate-200 text-slate-400 font-bold text-sm rounded-lg cursor-not-allowed"
              >
                Ingresar al Portal
              </button>
            </div>
          )}

          <div className="pt-4 text-center border-t border-slate-200/60">
            <p className="text-xs text-slate-500">
              ¿Problemas para acceder?{' '}
              <a href="mailto:info@cenas.uy" className="text-[#06B6D4] font-bold hover:underline">
                Contactar a Mesa de Ayuda
              </a>
            </p>
          </div>

        </div>
      </div>

    </div>
  );
}
