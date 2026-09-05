import { useState, useEffect, useRef } from 'react';
import { Upload, Trash2, Image, Send, CheckCircle2, Eye, X } from 'lucide-react';
import { supabase, UserSettings } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export function SettingsPanel() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [saving, setSaving] = useState(false);
  const [digestEnabled, setDigestEnabled] = useState(false);
  const [digestEmail, setDigestEmail] = useState('');
  const [savingDigest, setSavingDigest] = useState(false);
  const [testingDigest, setTestingDigest] = useState(false);
  const [testEmailAddr, setTestEmailAddr] = useState('');
  const [testCategory, setTestCategory] = useState<string>('problem');
  const [testEventType, setTestEventType] = useState<string>('notify');
  const [sendingTest, setSendingTest] = useState(false);
  const [testSent, setTestSent] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookToken, setWebhookToken] = useState('');
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('user_settings')
        .select('*')
        .eq('user_id', user!.id)
        .maybeSingle();
      if (data) {
        setSettings(data);
        setCompanyName(data.company_name || '');
        setDigestEnabled(data.weekly_digest_enabled ?? false);
        setDigestEmail(data.weekly_digest_email || '');
        setWebhookUrl(data.webhook_url || '');
        setWebhookToken(data.webhook_token || '');
      }
      setLoading(false);
    };
    load();
  }, [user]);

  const upsertSettings = async (patch: Partial<UserSettings>) => {
    if (settings) {
      const { data } = await supabase
        .from('user_settings')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', settings.id)
        .select()
        .maybeSingle();
      if (data) setSettings(data);
    } else {
      const { data } = await supabase
        .from('user_settings')
        .insert({ user_id: user!.id, ...patch })
        .select()
        .maybeSingle();
      if (data) setSettings(data);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      alert('File must be smaller than 2MB');
      return;
    }

    setUploading(true);
    const ext = file.name.split('.').pop();
    const path = `${user!.id}/logo.${ext}`;

    const { error } = await supabase.storage
      .from('logos')
      .upload(path, file, { upsert: true });

    if (error) {
      alert(`Upload failed: ${error.message}`);
      setUploading(false);
      return;
    }

    const { data: publicUrl } = supabase.storage
      .from('logos')
      .getPublicUrl(path);

    const url = publicUrl.publicUrl + `?t=${Date.now()}`;
    await upsertSettings({ logo_url: url });
    setUploading(false);
  };

  const handleRemoveLogo = async () => {
    if (!settings?.logo_url) return;
    const path = `${user!.id}/logo.${settings.logo_url.split('.').pop()?.split('?')[0]}`;
    await supabase.storage.from('logos').remove([path]);
    await upsertSettings({ logo_url: undefined });
  };

  const handleSaveCompanyName = async () => {
    setSaving(true);
    await upsertSettings({ company_name: companyName.trim() || undefined });
    setSaving(false);
  };

  const handleSaveDigest = async () => {
    setSavingDigest(true);
    await upsertSettings({
      weekly_digest_enabled: digestEnabled,
      weekly_digest_email: digestEmail.trim() || undefined,
    });
    setSavingDigest(false);
  };

  const handleTestDigest = async () => {
    setTestingDigest(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/weekly-digest`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
    }
    setTestingDigest(false);
  };

  const handlePreviewDigest = async () => {
    setLoadingPreview(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/weekly-digest`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ preview: true }),
      });
      const json = await res.json();
      if (json.html) setPreviewHtml(json.html);
    }
    setLoadingPreview(false);
  };

  const handleSendTestEmail = async () => {
    const to = testEmailAddr.trim() || user?.email || '';
    if (!to) return;
    setSendingTest(true);
    setTestSent(false);
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      const categoryLabels: Record<string, string> = {
        problem: 'Incidente en servidor',
        change_request: 'Cambio de configuración',
        visit: 'Visita técnica coordinada',
        payment: 'Renovación de licencia',
        backup: 'Integración de backup',
        idea: 'Nueva propuesta de servicio',
        audit: 'Revisión de usuarios SMB',
      };
      await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/notify-client`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_email: to,
          client_name: 'Cliente de Prueba',
          subject: `[TEST] ${categoryLabels[testCategory] || testCategory}`,
          title: categoryLabels[testCategory] || testCategory,
          description: 'Este es un correo de prueba generado desde el panel de configuración para validar la plantilla y el envío.',
          category: testCategory,
          event_type: testEventType,
          sender_name: settings?.company_name || user?.email,
          logo_url: settings?.logo_url || undefined,
          share_url: testCategory === 'audit' ? `${window.location.origin}/acl-review/token-de-prueba` : undefined,
          share_url_label: testCategory === 'audit' ? 'Iniciar revisión →' : undefined,
        }),
      });
      setTestSent(true);
      setTimeout(() => setTestSent(false), 4000);
    }
    setSendingTest(false);
  };

  const handleSaveWebhook = async () => {
    setSavingWebhook(true);
    await upsertSettings({
      webhook_url: webhookUrl.trim() || undefined,
      webhook_token: webhookToken.trim() || undefined,
    });
    setSavingWebhook(false);
  };

  if (loading) {
    return <div className="text-center py-12 text-sm text-gray-500">Loading settings...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Settings</h2>
        <p className="text-sm text-gray-600 mt-1">
          Configure your branding. Your logo appears on the client portal and in notification emails.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-3">Company Logo</label>
          <div className="flex items-center gap-6">
            <div className="w-32 h-32 rounded-xl border-2 border-dashed border-gray-300 flex items-center justify-center bg-gray-50 overflow-hidden">
              {settings?.logo_url ? (
                <img src={settings.logo_url} alt="Logo" className="w-full h-full object-contain p-2" />
              ) : (
                <Image className="w-10 h-10 text-gray-300" />
              )}
            </div>
            <div className="space-y-3">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={handleUpload}
                className="hidden"
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                <Upload className="w-4 h-4" />
                {uploading ? 'Uploading...' : settings?.logo_url ? 'Replace Logo' : 'Upload Logo'}
              </button>
              {settings?.logo_url && (
                <button
                  onClick={handleRemoveLogo}
                  className="inline-flex items-center gap-2 text-red-600 hover:text-red-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-50"
                >
                  <Trash2 className="w-4 h-4" />
                  Remove
                </button>
              )}
              <p className="text-xs text-gray-500">PNG, JPG, or SVG. Max 2MB. Recommended: 200x200px or wider.</p>
            </div>
          </div>
        </div>

        <div className="border-t border-gray-200 pt-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">Company Name</label>
          <div className="flex gap-3 max-w-md">
            <input
              type="text"
              value={companyName}
              onChange={e => setCompanyName(e.target.value)}
              placeholder="Your company or brand name"
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm"
            />
            <button
              onClick={handleSaveCompanyName}
              disabled={saving}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-1">Displayed as header text on the client portal when set.</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">Weekly Digest Email</h3>
          <p className="text-xs text-gray-500 mt-0.5">A Monday morning summary with backups, system health, renewals, changes and roadmap.</p>
        </div>
        <label className="flex items-center gap-3 cursor-pointer">
          <div onClick={() => setDigestEnabled(v => !v)}
            className={`relative w-10 h-6 rounded-full transition-colors ${digestEnabled ? 'bg-blue-600' : 'bg-gray-300'}`}>
            <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${digestEnabled ? 'translate-x-4' : ''}`} />
          </div>
          <span className="text-sm text-gray-700">{digestEnabled ? 'Enabled — sends every Monday' : 'Disabled'}</span>
        </label>
        {digestEnabled && (
          <div className="max-w-md">
            <label className="block text-xs font-medium text-gray-600 mb-1">Send to (leave blank to use your account email)</label>
            <input type="email" value={digestEmail} onChange={e => setDigestEmail(e.target.value)}
              placeholder={user?.email || 'you@example.com'}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
          </div>
        )}
        <div className="flex gap-3">
          <button onClick={handleSaveDigest} disabled={savingDigest}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50">
            {savingDigest ? 'Saving...' : 'Save'}
          </button>
          <button onClick={handleTestDigest} disabled={testingDigest || !digestEnabled}
            className="px-4 py-2 border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-lg text-sm font-medium disabled:opacity-40">
            {testingDigest ? 'Sending...' : 'Send test now'}
          </button>
          <button onClick={handlePreviewDigest} disabled={loadingPreview}
            className="flex items-center gap-1.5 px-4 py-2 border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-lg text-sm font-medium disabled:opacity-40">
            <Eye className="w-3.5 h-3.5" />
            {loadingPreview ? 'Loading...' : 'Preview'}
          </button>
        </div>
      </div>

      {/* Weekly digest preview modal */}
      {previewHtml && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 shrink-0">
              <span className="text-sm font-semibold text-gray-900">Vista previa — Weekly Digest</span>
              <button onClick={() => setPreviewHtml(null)} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 bg-slate-50">
              <iframe
                srcDoc={previewHtml}
                className="w-full rounded-lg border border-gray-200 bg-white"
                style={{ minHeight: '600px', height: '100%' }}
                sandbox="allow-same-origin"
                title="Weekly digest preview"
              />
            </div>
          </div>
        </div>
      )}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">Test de email</h3>
          <p className="text-xs text-gray-500 mt-0.5">Enviá un correo de prueba para validar la plantilla y el envío en Resend.</p>
        </div>
        <div className="space-y-3 max-w-lg">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Destinatario (vacío = tu email)</label>
            <input type="email" value={testEmailAddr} onChange={e => setTestEmailAddr(e.target.value)}
              placeholder={user?.email || 'correo@ejemplo.com'}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-600 mb-1">Categoría</label>
              <select value={testCategory} onChange={e => setTestCategory(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                <option value="problem">Incidente</option>
                <option value="change_request">Cambio</option>
                <option value="visit">Visita</option>
                <option value="payment">Pago</option>
                <option value="backup">Backup</option>
                <option value="idea">Nueva propuesta</option>
                <option value="audit">Revisión SMB</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-600 mb-1">Tipo</label>
              <select value={testEventType} onChange={e => setTestEventType(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                <option value="notify">Notificación</option>
                <option value="released">Completado ✅</option>
                <option value="closed">Cerrado</option>
              </select>
            </div>
          </div>
        </div>
        <button onClick={handleSendTestEmail} disabled={sendingTest}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50">
          {sendingTest ? <><Send className="w-4 h-4 animate-pulse" />Enviando...</> :
           testSent   ? <><CheckCircle2 className="w-4 h-4" />Enviado</> :
                        <><Send className="w-4 h-4" />Enviar test</>}
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">External Portal Webhook</h3>
          <p className="text-xs text-gray-500 mt-0.5">When a Problem or Change Request is closed, a JSON summary is POSTed to this URL. Optional — leave blank to skip.</p>
        </div>
        <div className="space-y-3 max-w-lg">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Webhook URL</label>
            <input type="url" value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)}
              placeholder="https://portal.example.com/api/webhook"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Bearer Token (optional)</label>
            <input type="password" value={webhookToken} onChange={e => setWebhookToken(e.target.value)}
              placeholder="sk-..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
          </div>
        </div>
        <button onClick={handleSaveWebhook} disabled={savingWebhook}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50">
          {savingWebhook ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}
