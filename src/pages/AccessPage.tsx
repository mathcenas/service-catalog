import { useState } from 'react';
import { Shield, Mail, ArrowRight, CheckCircle, Lock } from 'lucide-react';

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export function AccessPage() {
  const [email, setEmail]     = useState('');
  const [sent, setSent]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [tab, setTab]         = useState<'link' | 'password'>('link');

  const handleSendLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/send-portal-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      setSent(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B192C] flex flex-col items-center justify-center px-4">
      {/* Logo */}
      <div className="mb-8 text-center">
        <div className="inline-flex items-center gap-2 bg-[#1E293B] border border-slate-700/60 px-5 py-2.5 rounded-xl mb-4">
          <Shield className="w-4 h-4 text-[#06B6D4]" />
          <span className="text-white font-bold text-sm tracking-widest">CENAS IT</span>
        </div>
        <p className="text-slate-400 text-sm">Portal de servicios para clientes</p>
      </div>

      {/* Card */}
      <div className="w-full max-w-sm bg-[#111827] border border-slate-700/60 rounded-2xl overflow-hidden shadow-2xl">
        {/* Tabs */}
        <div className="flex border-b border-slate-700/60">
          <button
            onClick={() => setTab('link')}
            className={`flex-1 py-3.5 text-sm font-medium transition-colors ${
              tab === 'link'
                ? 'text-white border-b-2 border-[#06B6D4] bg-[#0B192C]/40'
                : 'text-slate-400 hover:text-slate-300'
            }`}
          >
            Acceder por email
          </button>
          <button
            onClick={() => setTab('password')}
            className={`flex-1 py-3.5 text-sm font-medium transition-colors ${
              tab === 'password'
                ? 'text-white border-b-2 border-[#06B6D4] bg-[#0B192C]/40'
                : 'text-slate-400 hover:text-slate-300'
            }`}
          >
            Usuario y contraseña
          </button>
        </div>

        <div className="p-6">
          {tab === 'link' ? (
            sent ? (
              <div className="text-center py-4">
                <CheckCircle className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
                <p className="text-white font-semibold mb-1">¡Revisá tu correo!</p>
                <p className="text-slate-400 text-sm leading-relaxed">
                  Si tu email está registrado, te enviamos el link de acceso a tu portal.
                </p>
                <button
                  onClick={() => { setSent(false); setEmail(''); }}
                  className="mt-5 text-xs text-slate-500 hover:text-slate-400 underline"
                >
                  Intentar con otro email
                </button>
              </div>
            ) : (
              <form onSubmit={handleSendLink} className="space-y-4">
                <div>
                  <p className="text-slate-300 text-sm leading-relaxed mb-4">
                    Ingresá tu email y te enviamos el link de acceso a tu portal de servicios.
                  </p>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">
                    Email
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="tu@email.com"
                      required
                      className="w-full bg-[#0B192C] border border-slate-600 rounded-lg pl-9 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#06B6D4] transition-colors"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 bg-[#06B6D4] hover:bg-[#0891B2] disabled:opacity-60 text-white font-semibold text-sm py-2.5 rounded-lg transition-colors"
                >
                  {loading ? (
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>Enviar link <ArrowRight className="w-4 h-4" /></>
                  )}
                </button>
              </form>
            )
          ) : (
            <div className="text-center py-6">
              <Lock className="w-8 h-8 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400 text-sm">Acceso con usuario y contraseña</p>
              <p className="text-slate-600 text-xs mt-1">Próximamente disponible</p>
            </div>
          )}
        </div>
      </div>

      <p className="text-slate-600 text-xs mt-8">
        Cenas IT Solutions — Procesos bajo norma ISO/IEC 20000
      </p>
    </div>
  );
}
