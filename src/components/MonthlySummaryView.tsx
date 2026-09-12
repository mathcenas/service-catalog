import { useState, useEffect, useRef } from 'react';
import { supabase, Client, Service } from '../lib/supabase';
import {
  Calendar, ChevronLeft, ChevronRight, Clock, Shield,
  CheckCircle2, Server, AlertCircle, GitCommit, Send, Eye, Loader2,
} from 'lucide-react';

type Props = { clients: Client[]; services: Service[] };

type InternalData = {
  incidentCount: number;
  backupTotal: number;
  backupSuccess: number;
  backupFailed: number;
  hoursUsed: number;
  hoursAvailable: number;
  roadmapCompleted: number;
  servicesMonitored: number;
  heartbeatServices: number;
  serviceChanges: number;
};

function prevMonth(y: number, m: number) { return m === 1 ? [y - 1, 12] : [y, m - 1]; }
function nextMonth(y: number, m: number) { return m === 12 ? [y + 1, 1] : [y, m + 1]; }

function monthLabel(y: number, m: number) {
  return new Date(y, m - 1, 1).toLocaleDateString('es-UY', { month: 'long', year: 'numeric' });
}

function isoRange(y: number, m: number): [string, string] {
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const to = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return [from, to];
}

export function MonthlySummaryView({ clients, services }: Props) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [clientId, setClientId] = useState<string>('');
  const [data, setData] = useState<InternalData | null>(null);
  const [loadingData, setLoadingData] = useState(false);

  // Digest preview state
  const [digestHtml, setDigestHtml] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentMsg, setSentMsg] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const activeClients = clients.filter(c => c.status === 'Active');

  useEffect(() => {
    if (activeClients.length > 0 && !clientId) {
      setClientId(activeClients[0].id);
    }
  }, [clients]);

  useEffect(() => {
    if (!clientId) return;
    loadInternal();
    loadDigestPreview();
    setSentMsg(null);
  }, [clientId, year, month]);

  async function loadInternal() {
    setLoadingData(true);
    setData(null);
    const [from, to] = isoRange(year, month);
    const clientServices = services.filter(s => s.client_id === clientId && s.status === 'Active');
    const serviceIds = clientServices.map(s => s.id);

    const [
      { data: incidents },
      { data: backupRows },
      { data: hoursRows },
      { data: roadmapRows },
      { data: heartbeatRows },
      { data: changesRows },
    ] = await Promise.all([
      supabase.from('roadmap_items')
        .select('id')
        .eq('client_id', clientId)
        .eq('category', 'problem')
        .gte('created_at', from)
        .lte('created_at', to + 'T23:59:59'),

      serviceIds.length > 0
        ? supabase.from('service_backups')
            .select('status')
            .in('service_id', serviceIds)
            .gte('backed_up_at', from)
            .lte('backed_up_at', to + 'T23:59:59')
        : Promise.resolve({ data: [] }),

      supabase.from('support_hours')
        .select('hours')
        .eq('client_id', clientId)
        .gte('date', from)
        .lte('date', to),

      supabase.from('roadmap_items')
        .select('id')
        .eq('client_id', clientId)
        .eq('status', 'Released')
        .gte('updated_at', from)
        .lte('updated_at', to + 'T23:59:59'),

      serviceIds.length > 0
        ? supabase.from('service_heartbeats')
            .select('service_id')
            .in('service_id', serviceIds)
            .eq('source', 'system-health')
            .gte('created_at', from)
            .lte('created_at', to + 'T23:59:59')
        : Promise.resolve({ data: [] }),

      serviceIds.length > 0
        ? supabase.from('service_changes')
            .select('id')
            .in('service_id', serviceIds)
            .gte('changed_at', from)
            .lte('changed_at', to + 'T23:59:59')
        : Promise.resolve({ data: [] }),
    ]);

    const backupList = (backupRows ?? []) as { status: string }[];
    const backupTotal = backupList.length;
    const backupSuccess = backupList.filter(r => r.status === 'success').length;
    const backupFailed  = backupList.filter(r => r.status === 'failed').length;

    const hoursUsed = (hoursRows ?? []).reduce((sum, r) => sum + (r.hours ?? 0), 0);
    const contractedHours = clientServices.reduce((sum, s) => {
      const h = (s as unknown as Record<string, unknown>).confirmed_hours_monthly;
      return sum + (typeof h === 'number' ? h : 0);
    }, 0);

    const uniqueHB = new Set((heartbeatRows ?? []).map((r: { service_id: string }) => r.service_id));

    setData({
      incidentCount: (incidents ?? []).length,
      backupTotal,
      backupSuccess,
      backupFailed,
      hoursUsed,
      hoursAvailable: contractedHours,
      roadmapCompleted: (roadmapRows ?? []).length,
      servicesMonitored: clientServices.length,
      heartbeatServices: uniqueHB.size,
      serviceChanges: (changesRows ?? []).length,
    });
    setLoadingData(false);
  }

  async function loadDigestPreview() {
    setLoadingPreview(true);
    setDigestHtml(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const supabaseUrl = (supabase as any).supabaseUrl as string;
      const res = await fetch(`${supabaseUrl}/functions/v1/client-weekly-digest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ preview: true, client_id: clientId }),
      });
      if (res.ok) {
        const json = await res.json();
        setDigestHtml(json.html ?? null);
      }
    } catch {}
    setLoadingPreview(false);
  }

  async function sendDigest() {
    setSending(true);
    setSentMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const supabaseUrl = (supabase as any).supabaseUrl as string;
      const res = await fetch(`${supabaseUrl}/functions/v1/client-weekly-digest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ client_id: clientId }),
      });
      const json = await res.json();
      setSentMsg(res.ok ? `✓ Enviado (${json.sent ?? 1} destinatario${(json.sent ?? 1) !== 1 ? 's' : ''})` : `Error: ${json.error ?? 'desconocido'}`);
    } catch (e: any) {
      setSentMsg(`Error: ${e.message}`);
    }
    setSending(false);
  }

  // Inject digest html into sandboxed iframe
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !digestHtml) return;
    const doc = iframe.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(digestHtml);
    doc.close();
  }, [digestHtml]);

  const canGoNext = year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1);
  function goBack() { const [y, m] = prevMonth(year, month); setYear(y); setMonth(m); }
  function goNext() { if (!canGoNext) return; const [y, m] = nextMonth(year, month); setYear(y); setMonth(m); }

  const selectedClient = clients.find(c => c.id === clientId);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Resumen mensual</h2>
        <p className="text-sm text-gray-500 mt-0.5">Métricas internas del mes + vista previa del resumen al cliente</p>
      </div>

      {/* Controls */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-wrap gap-4 items-center">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-gray-400" />
          <button onClick={goBack} className="p-1 hover:bg-gray-100 rounded transition-colors">
            <ChevronLeft className="w-4 h-4 text-gray-600" />
          </button>
          <span className="text-sm font-semibold text-gray-900 min-w-[140px] text-center capitalize">
            {monthLabel(year, month)}
          </span>
          <button onClick={goNext} disabled={!canGoNext} className="p-1 hover:bg-gray-100 rounded transition-colors disabled:opacity-30">
            <ChevronRight className="w-4 h-4 text-gray-600" />
          </button>
        </div>

        <select
          value={clientId}
          onChange={e => setClientId(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none bg-white"
        >
          {activeClients.map(c => (
            <option key={c.id} value={c.id}>{c.company_name}</option>
          ))}
          {activeClients.length === 0 && <option value="">Sin clientes activos</option>}
        </select>
      </div>

      {/* Internal metrics — admin only */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Métricas internas</p>
        {loadingData ? (
          <div className="text-sm text-gray-400 text-center py-8">Cargando datos…</div>
        ) : data && selectedClient ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard icon={AlertCircle} color="red"
                label="Incidencias"
                value={data.incidentCount}
                sub={data.incidentCount === 0 ? 'Sin incidencias' : 'tickets problema'} />
              <StatCard icon={Shield} color="emerald"
                label="Backups"
                value={data.backupTotal > 0 ? `${data.backupSuccess}/${data.backupTotal}` : '—'}
                sub={data.backupTotal > 0
                  ? `${Math.round((data.backupSuccess / data.backupTotal) * 100)}% ok${data.backupFailed > 0 ? ` · ${data.backupFailed} fallidos` : ''}`
                  : 'Sin registros'} />
              <StatCard icon={Clock} color="blue"
                label="Horas soporte"
                value={data.hoursUsed > 0 ? data.hoursUsed.toFixed(1) + 'h' : '0h'}
                sub={data.hoursAvailable > 0 ? `de ${data.hoursAvailable}h contratadas` : 'sin contrato'} />
              <StatCard icon={CheckCircle2} color="violet"
                label="Roadmap"
                value={data.roadmapCompleted}
                sub="ítems entregados" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard icon={Server} color="slate"
                label="Servicios activos"
                value={data.servicesMonitored}
                sub={`${data.heartbeatServices} con telemetría`} />
              <StatCard icon={GitCommit} color="slate"
                label="Cambios"
                value={data.serviceChanges}
                sub="en servicios" />
              {data.hoursAvailable > 0 && data.hoursUsed > data.hoursAvailable && (
                <div className="col-span-2 bg-red-50 border border-red-200 rounded-xl p-3 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                  <p className="text-xs text-red-700">
                    <strong>Horas excedidas:</strong> {(data.hoursUsed - data.hoursAvailable).toFixed(1)}h más de lo contratado
                  </p>
                </div>
              )}
              {data.backupFailed > 0 && (
                <div className="col-span-2 bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
                  <p className="text-xs text-amber-700">
                    <strong>{data.backupFailed} backup{data.backupFailed > 1 ? 's' : ''} fallido{data.backupFailed > 1 ? 's' : ''}</strong> este mes
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="text-sm text-gray-400 text-center py-8">Seleccioná un cliente.</div>
        )}
      </div>

      {/* Digest preview — what the client receives */}
      {clientId && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Resumen al cliente</p>
              <p className="text-xs text-gray-400 mt-0.5">Vista previa exacta del email que recibe {selectedClient?.company_name}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={loadDigestPreview}
                disabled={loadingPreview}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-40"
              >
                <Eye className="w-3.5 h-3.5" />
                Actualizar preview
              </button>
              <button
                onClick={sendDigest}
                disabled={sending || loadingPreview}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {sending
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Send className="w-3.5 h-3.5" />}
                {sending ? 'Enviando…' : 'Enviar ahora'}
              </button>
            </div>
          </div>

          {sentMsg && (
            <div className={`mb-3 px-3 py-2 rounded-lg text-xs font-medium ${sentMsg.startsWith('✓') ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
              {sentMsg}
            </div>
          )}

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            {loadingPreview ? (
              <div className="flex items-center justify-center py-24 text-gray-400 text-sm gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Generando preview…
              </div>
            ) : digestHtml ? (
              <iframe
                ref={iframeRef}
                sandbox="allow-same-origin"
                className="w-full border-0"
                style={{ height: 700 }}
                title="Digest preview"
              />
            ) : (
              <div className="flex items-center justify-center py-24 text-gray-400 text-sm">
                No se pudo generar la vista previa.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon, color, label, value, sub,
}: {
  icon: React.ElementType;
  color: 'red' | 'emerald' | 'blue' | 'violet' | 'slate';
  label: string;
  value: string | number;
  sub: string;
}) {
  const colors = {
    red:     'bg-red-50 text-red-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    blue:    'bg-blue-50 text-blue-600',
    violet:  'bg-violet-50 text-violet-600',
    slate:   'bg-slate-100 text-slate-600',
  };
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex items-start gap-3">
      <div className={`p-2 rounded-lg shrink-0 ${colors[color]}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500 font-medium">{label}</p>
        <p className="text-xl font-bold text-gray-900 mt-0.5 leading-none">{value}</p>
        <p className="text-xs text-gray-400 mt-1">{sub}</p>
      </div>
    </div>
  );
}
