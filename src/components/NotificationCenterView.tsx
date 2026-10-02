import { useState, useEffect, useCallback } from 'react';
import { Bell, Mail, CheckCircle2, Clock, AlertCircle, Send, RefreshCw,
         ChevronDown, ChevronUp, Users, Lock, Unlock, History, ShieldAlert } from 'lucide-react';
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

type NotificationLock = {
  lock_id: string;
  service_id: string;
  service_name: string;
  client_id: string;
  client_name: string;
  event_type: string;
  last_sent_at: string;
  send_count: number;
  suppressed_count: number;
  cooldown_expires: string;
  cooldown_active: boolean;
};

type Props = { clients: Client[] };

const FREQ_LABEL: Record<string, string> = {
  daily:  'Diarias',
  weekly: 'Semanales',
  none:   'Desactivadas',
};

const EVENT_LABEL: Record<string, string> = {
  backup_success: 'Backup exitoso',
  backup_failed:  'Backup fallido',
  backup_warning: 'Backup con advertencia',
  kopia_failed:   'Kopia fallido',
};

function fmtRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 60)  return `hace ${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24)    return `hace ${h}h`;
  return `hace ${Math.floor(h / 24)}d`;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString('es-UY', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

type Tab = 'contacts' | 'history' | 'locks';

export function NotificationCenterView({ clients }: Props) {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('contacts');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [emailOpens, setEmailOpens] = useState<EmailOpen[]>([]);
  const [locks, setLocks] = useState<NotificationLock[]>([]);
  const [loading, setLoading] = useState(true);
  const [sendingWelcome, setSendingWelcome] = useState<string | null>(null);
  const [deletingLock, setDeletingLock] = useState<string | null>(null);
  const [expandedClient, setExpandedClient] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  };

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [{ data: ctcs }, { data: opens }, { data: lockRows }] = await Promise.all([
      supabase
        .from('client_contacts')
        .select('id, name, email, role, digest_frequency, client_id, subscription_confirmed, welcome_sent_at, last_email_at')
        .order('name'),
      supabase
        .from('email_opens')
        .select('id, contact_id, email_type, sent_at, delivered_at, opened_at, resend_email_id')
        .order('sent_at', { ascending: false })
        .limit(300),
      supabase.rpc('get_my_notification_locks'),
    ]);
    setContacts((ctcs ?? []) as Contact[]);
    setEmailOpens((opens ?? []) as EmailOpen[]);
    setLocks((lockRows ?? []) as NotificationLock[]);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const sendWelcome = async (contactId: string, contactEmail: string) => {
    setSendingWelcome(contactId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const supabaseUrl = (supabase as any).supabaseUrl ?? import.meta.env.VITE_SUPABASE_URL;
      const res = await fetch(`${supabaseUrl}/functions/v1/send-welcome`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
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
    } catch {
      showToast('Error de red', false);
    } finally {
      setSendingWelcome(null);
    }
  };

  const deleteLock = async (lock: NotificationLock) => {
    setDeletingLock(lock.lock_id);
    const { data: deleted, error } = await supabase
      .rpc('delete_my_notification_lock', { p_lock_id: lock.lock_id });
    if (error || !deleted) {
      showToast('No se pudo liberar el cooldown', false);
    } else {
      showToast(`Lock liberado: ${lock.service_name} · ${EVENT_LABEL[lock.event_type] ?? lock.event_type}`, true);
      await load();
    }
    setDeletingLock(null);
  };

  const byClient = clients.map(cl => ({
    client: cl,
    contacts: contacts.filter(c => c.client_id === cl.id),
  })).filter(g => g.contacts.length > 0);

  const opensForContact = (cid: string) => emailOpens.filter(o => o.contact_id === cid);

  const activeLocks  = locks.filter(l => l.cooldown_active);
  const expiredLocks = locks.filter(l => !l.cooldown_active);

  const allEmails = emailOpens.filter(o => o.sent_at).slice(0, 100);

  const stats = {
    total:     contacts.length,
    withEmail: contacts.filter(c => c.digest_frequency !== 'none').length,
    welcomed:  contacts.filter(c => c.welcome_sent_at).length,
    locked:    activeLocks.length,
  };

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: 'contacts', label: 'Contactos' },
    { id: 'history',  label: 'Historial de envíos', badge: allEmails.length },
    { id: 'locks',    label: 'Cooldowns activos',   badge: activeLocks.length },
  ];

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Bell className="w-5 h-5 text-blue-600" />
            Centro de Notificaciones
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">Suscripciones, historial de envíos y control de cooldowns</p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Actualizar
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Contactos',     value: stats.total,     icon: Users,       color: 'blue' },
          { label: 'Con alertas',   value: stats.withEmail, icon: Bell,        color: 'indigo' },
          { label: 'Welcome enviado', value: stats.welcomed, icon: Send,       color: 'emerald' },
          { label: 'Cooldowns activos', value: stats.locked, icon: ShieldAlert, color: stats.locked > 0 ? 'amber' : 'gray' },
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

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {t.label}
            {t.badge != null && t.badge > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                t.id === 'locks' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'
              }`}>{t.badge}</span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Cargando...</div>
      ) : (
        <>
          {/* ── CONTACTOS ── */}
          {tab === 'contacts' && (
            <div className="space-y-3">
              {byClient.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  No hay contactos. Agregálos desde la vista de Clientes.
                </div>
              ) : byClient.map(({ client, contacts: ctcs }) => {
                const open = expandedClient === client.id;
                return (
                  <div key={client.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                    <button className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50"
                      onClick={() => setExpandedClient(open ? null : client.id)}>
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
                          const isOpened    = opens.some(o => o.opened_at);
                          const isDelivered = opens.some(o => o.delivered_at);
                          const lastOpen    = opens[0];
                          return (
                            <div key={contact.id} className="px-4 py-3 flex items-start justify-between gap-4">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-medium text-sm text-gray-900">{contact.name}</span>
                                  {contact.role && (
                                    <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{contact.role}</span>
                                  )}
                                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                                    contact.digest_frequency === 'none'
                                      ? 'bg-gray-100 text-gray-500'
                                      : 'bg-blue-50 text-blue-700'
                                  }`}>{FREQ_LABEL[contact.digest_frequency]}</span>
                                  {contact.subscription_confirmed && (
                                    <span className="text-xs text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                                      <CheckCircle2 className="w-3 h-3" /> Confirmado
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-gray-400 mt-0.5">{contact.email}</div>
                                {opens.length > 0 && (
                                  <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400">
                                    <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{opens.length} envío{opens.length !== 1 ? 's' : ''}</span>
                                    {isDelivered && <span className="flex items-center gap-1 text-emerald-600"><CheckCircle2 className="w-3 h-3" /> Entregado</span>}
                                    {isOpened    && <span className="flex items-center gap-1 text-blue-600"><CheckCircle2 className="w-3 h-3" /> Abierto</span>}
                                    {lastOpen?.sent_at && (
                                      <span className="flex items-center gap-1">
                                        <Clock className="w-3 h-3" />
                                        {fmtRelative(lastOpen.sent_at)}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                              <button onClick={() => sendWelcome(contact.id, contact.email)}
                                disabled={sendingWelcome === contact.id}
                                title={contact.welcome_sent_at ? `Reenviar (último: ${fmtRelative(contact.welcome_sent_at)})` : 'Enviar email de bienvenida'}
                                className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                                  contact.welcome_sent_at
                                    ? 'border border-gray-200 text-gray-500 hover:bg-gray-50'
                                    : 'bg-blue-600 text-white hover:bg-blue-700'
                                } disabled:opacity-50`}>
                                {sendingWelcome === contact.id
                                  ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                  : <Send className="w-3.5 h-3.5" />}
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

          {/* ── HISTORIAL ── */}
          {tab === 'history' && (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              {allEmails.length === 0 ? (
                <div className="text-center py-12 text-gray-400">No hay emails registrados aún.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase tracking-wide">
                      <th className="text-left px-4 py-2">Tipo</th>
                      <th className="text-left px-4 py-2">Email</th>
                      <th className="text-left px-4 py-2">Enviado</th>
                      <th className="text-left px-4 py-2">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {allEmails.map(o => {
                      const contact = contacts.find(c => c.id === o.contact_id);
                      const status = o.opened_at ? 'Abierto' : o.delivered_at ? 'Entregado' : 'Enviado';
                      const statusColor = o.opened_at ? 'text-blue-600' : o.delivered_at ? 'text-emerald-600' : 'text-gray-400';
                      return (
                        <tr key={o.id} className="hover:bg-gray-50">
                          <td className="px-4 py-2.5">
                            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-medium">
                              {o.email_type ?? '—'}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-gray-700">
                            {contact?.email ?? '—'}
                            {contact?.name && <span className="text-gray-400 ml-1">· {contact.name}</span>}
                          </td>
                          <td className="px-4 py-2.5 text-gray-400 text-xs">
                            {o.sent_at ? fmtTime(o.sent_at) : '—'}
                          </td>
                          <td className={`px-4 py-2.5 text-xs font-medium ${statusColor}`}>
                            {status}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ── LOCKS / COOLDOWNS ── */}
          {tab === 'locks' && (
            <div className="space-y-4">
              {activeLocks.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5" /> Cooldown activo — el próximo email está bloqueado
                  </h3>
                  <div className="bg-white border border-amber-200 rounded-xl divide-y divide-amber-50 overflow-hidden">
                    {activeLocks.map(l => (
                      <div key={l.lock_id} className="px-4 py-3 flex items-center justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm text-gray-900">{l.service_name}</span>
                            <span className="text-xs text-gray-400">· {l.client_name}</span>
                            <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">
                              {EVENT_LABEL[l.event_type] ?? l.event_type}
                            </span>
                          </div>
                          <div className="flex items-center gap-4 mt-1 text-xs text-gray-400">
                            <span>Último envío: {fmtRelative(l.last_sent_at)} ({fmtTime(l.last_sent_at)})</span>
                            <span className="text-amber-600">Vence: {fmtTime(l.cooldown_expires)}</span>
                            {l.suppressed_count > 0 && (
                              <span>{l.suppressed_count} suprimido{l.suppressed_count !== 1 ? 's' : ''}</span>
                            )}
                          </div>
                        </div>
                        <button onClick={() => deleteLock(l)} disabled={deletingLock === l.lock_id}
                          className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-50">
                          {deletingLock === l.lock_id
                            ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            : <Unlock className="w-3.5 h-3.5" />}
                          Liberar
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {expiredLocks.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5" /> Historial de locks (cooldown vencido)
                  </h3>
                  <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-50 overflow-hidden">
                    {expiredLocks.map(l => (
                      <div key={l.lock_id} className="px-4 py-3 flex items-center justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm text-gray-900">{l.service_name}</span>
                            <span className="text-xs text-gray-400">· {l.client_name}</span>
                            <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                              {EVENT_LABEL[l.event_type] ?? l.event_type}
                            </span>
                          </div>
                          <div className="flex items-center gap-4 mt-1 text-xs text-gray-400">
                            <span>Último: {fmtRelative(l.last_sent_at)}</span>
                            <span>{l.send_count} envío{l.send_count !== 1 ? 's' : ''}</span>
                            {l.suppressed_count > 0 && <span>{l.suppressed_count} suprimido{l.suppressed_count !== 1 ? 's' : ''}</span>}
                          </div>
                        </div>
                        <span className="shrink-0 text-xs text-emerald-600 flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Libre
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {locks.length === 0 && (
                <div className="text-center py-12 text-gray-400">No hay registros de cooldowns.</div>
              )}
            </div>
          )}
        </>
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
