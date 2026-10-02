import { useState, useEffect, useCallback } from 'react';
import { Bell, Mail, CheckCircle2, Clock, AlertCircle, Send, RefreshCw, ChevronDown, ChevronUp, Users } from 'lucide-react';
import { supabase, Client } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

type Contact = {
  id: string;
  name: string;
  email: string;
  role?: string;
  digest_frequency: 'none' | 'daily' | 'weekly';
  client_id: string;
  subscription_confirmed?: boolean;
  welcome_sent_at?: string;
  last_email_at?: string;
};

type EmailOpen = {
  id: string;
  contact_id?: string;
  email_type?: string;
  sent_at?: string;
  delivered_at?: string;
  opened_at?: string;
  resend_email_id?: string;
};

type Props = { clients: Client[] };

const FREQ_LABEL: Record<string, string> = {
  daily:  'Diarias',
  weekly: 'Semanales',
  none:   'Desactivadas',
};

export function NotificationCenterView({ clients }: Props) {
  const { user } = useAuth();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [emailOpens, setEmailOpens] = useState<EmailOpen[]>([]);
  const [loading, setLoading] = useState(true);
  const [sendingWelcome, setSendingWelcome] = useState<string | null>(null);
  const [expandedClient, setExpandedClient] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  };

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const [{ data: ctcs }, { data: opens }] = await Promise.all([
      supabase
        .from('client_contacts')
        .select('id, name, email, role, digest_frequency, client_id, subscription_confirmed, welcome_sent_at, last_email_at')
        .order('name'),
      supabase
        .from('email_opens')
        .select('id, contact_id, email_type, sent_at, delivered_at, opened_at, resend_email_id')
        .not('contact_id', 'is', null)
        .order('sent_at', { ascending: false })
        .limit(200),
    ]);

    setContacts((ctcs ?? []) as Contact[]);
    setEmailOpens((opens ?? []) as EmailOpen[]);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const sendWelcome = async (contactId: string, contactEmail: string) => {
    setSendingWelcome(contactId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const supabaseUrl = (supabase as any).supabaseUrl ?? import.meta.env.VITE_SUPABASE_URL;

      const res = await fetch(`${supabaseUrl}/functions/v1/send-welcome`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ contact_id: contactId }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        showToast(`Welcome enviado a ${contactEmail}`, true);
        await load();
      } else {
        showToast(json.error ?? 'Error al enviar', false);
      }
    } catch (e) {
      showToast('Error de red', false);
    } finally {
      setSendingWelcome(null);
    }
  };

  // Group contacts by client
  const byClient = clients.map(cl => ({
    client: cl,
    contacts: contacts.filter(c => c.client_id === cl.id),
  })).filter(g => g.contacts.length > 0);

  const opensForContact = (cid: string) =>
    emailOpens.filter(o => o.contact_id === cid);

  const stats = {
    total: contacts.length,
    confirmed: contacts.filter(c => c.subscription_confirmed).length,
    withEmail: contacts.filter(c => c.digest_frequency !== 'none').length,
    welcomed: contacts.filter(c => c.welcome_sent_at).length,
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Bell className="w-5 h-5 text-blue-600" />
            Centro de Notificaciones
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Gestión de suscripciones y tracking de envíos por contacto
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Actualizar
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Contactos', value: stats.total, icon: Users, color: 'blue' },
          { label: 'Con alertas', value: stats.withEmail, icon: Bell, color: 'indigo' },
          { label: 'Welcome enviado', value: stats.welcomed, icon: Send, color: 'emerald' },
          { label: 'Confirmados', value: stats.confirmed, icon: CheckCircle2, color: 'green' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className={`inline-flex p-2 rounded-lg bg-${color}-50 mb-2`}>
              <Icon className={`w-4 h-4 text-${color}-600`} />
            </div>
            <div className="text-2xl font-bold text-gray-900">{value}</div>
            <div className="text-xs text-gray-500">{label}</div>
          </div>
        ))}
      </div>

      {/* Contact list grouped by client */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">Cargando...</div>
      ) : byClient.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          No hay contactos registrados aún.<br />
          <span className="text-sm">Agregá contactos desde la vista de Clientes.</span>
        </div>
      ) : (
        <div className="space-y-3">
          {byClient.map(({ client, contacts: ctcs }) => {
            const open = expandedClient === client.id;
            return (
              <div key={client.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <button
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
                  onClick={() => setExpandedClient(open ? null : client.id)}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900 text-sm">{client.company_name}</span>
                    <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                      {ctcs.length} contacto{ctcs.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                </button>

                {open && (
                  <div className="border-t border-gray-100 divide-y divide-gray-50">
                    {ctcs.map(contact => {
                      const opens = opensForContact(contact.id);
                      const lastOpen = opens[0];
                      const isOpened = opens.some(o => o.opened_at);
                      const isDelivered = opens.some(o => o.delivered_at);
                      return (
                        <div key={contact.id} className="px-4 py-3 flex items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm text-gray-900">{contact.name}</span>
                              {contact.role && (
                                <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                                  {contact.role}
                                </span>
                              )}
                              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                                contact.digest_frequency === 'none'
                                  ? 'bg-gray-100 text-gray-500'
                                  : 'bg-blue-50 text-blue-700'
                              }`}>
                                {FREQ_LABEL[contact.digest_frequency]}
                              </span>
                              {contact.subscription_confirmed && (
                                <span className="text-xs text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                                  <CheckCircle2 className="w-3 h-3" /> Confirmado
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-400 mt-0.5">{contact.email}</div>

                            {/* Email tracking mini row */}
                            {opens.length > 0 && (
                              <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400">
                                <span className="flex items-center gap-1">
                                  <Mail className="w-3 h-3" />
                                  {opens.length} envío{opens.length !== 1 ? 's' : ''}
                                </span>
                                {isDelivered && (
                                  <span className="flex items-center gap-1 text-emerald-600">
                                    <CheckCircle2 className="w-3 h-3" /> Entregado
                                  </span>
                                )}
                                {isOpened && (
                                  <span className="flex items-center gap-1 text-blue-600">
                                    <CheckCircle2 className="w-3 h-3" /> Abierto
                                  </span>
                                )}
                                {lastOpen?.sent_at && (
                                  <span className="flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    {new Date(lastOpen.sent_at).toLocaleDateString('es-UY', { day: '2-digit', month: 'short' })}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Actions */}
                          <button
                            onClick={() => sendWelcome(contact.id, contact.email)}
                            disabled={sendingWelcome === contact.id}
                            title={contact.welcome_sent_at ? `Reenviar welcome (último: ${new Date(contact.welcome_sent_at).toLocaleDateString('es-UY')})` : 'Enviar email de bienvenida'}
                            className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                              contact.welcome_sent_at
                                ? 'border border-gray-200 text-gray-500 hover:bg-gray-50'
                                : 'bg-blue-600 text-white hover:bg-blue-700'
                            } disabled:opacity-50`}
                          >
                            {sendingWelcome === contact.id ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Send className="w-3.5 h-3.5" />
                            )}
                            {contact.welcome_sent_at ? 'Reenviar' : 'Welcome'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white ${toast.ok ? 'bg-emerald-600' : 'bg-red-500'}`}>
          {toast.ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}
