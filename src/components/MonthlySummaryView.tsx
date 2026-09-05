import { useState, useEffect } from 'react';
import { supabase, Client, Service } from '../lib/supabase';
import { Calendar, ChevronLeft, ChevronRight, Clock, Shield, CheckCircle2, Server, AlertCircle } from 'lucide-react';

type Props = { clients: Client[]; services: Service[] };

type SummaryData = {
  incidentCount: number;
  backupTotal: number;
  backupSuccess: number;
  hoursUsed: number;
  hoursAvailable: number;
  roadmapCompleted: number;
  servicesMonitored: number;
  heartbeatServices: number;
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
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(false);

  const activeClients = clients.filter(c => c.status === 'Active');

  useEffect(() => {
    if (activeClients.length > 0 && !clientId) {
      setClientId(activeClients[0].id);
    }
  }, [clients]);

  useEffect(() => {
    if (!clientId) return;
    load();
  }, [clientId, year, month]);

  async function load() {
    setLoading(true);
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
    ] = await Promise.all([
      supabase.from('roadmap_items')
        .select('id')
        .eq('client_id', clientId)
        .eq('category', 'problem')
        .gte('created_at', from)
        .lte('created_at', to + 'T23:59:59'),

      serviceIds.length > 0
        ? supabase.from('service_heartbeats')
            .select('metadata')
            .in('service_id', serviceIds)
            .eq('source', 'backup-folder')
            .gte('created_at', from)
            .lte('created_at', to + 'T23:59:59')
        : Promise.resolve({ data: [] }),

      supabase.from('support_hours')
        .select('hours, client_id')
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
    ]);

    const backupList = (backupRows ?? []) as { metadata: Record<string, unknown> | null }[];
    const backupTotal = backupList.length;
    const backupSuccess = backupList.filter(r => {
      const m = r.metadata;
      return m && (m.status === 'ok' || m.status === 'success' || m.ok === true || m.ok === 'true');
    }).length;

    const hoursUsed = (hoursRows ?? []).reduce((sum, r) => sum + (r.hours ?? 0), 0);

    // get contracted hours for this client from services specifications
    const contractedHours = clientServices.reduce((sum, s) => {
      const h = (s as unknown as Record<string, unknown>).confirmed_hours_monthly;
      return sum + (typeof h === 'number' ? h : 0);
    }, 0);

    const uniqueHeartbeatServices = new Set((heartbeatRows ?? []).map((r: { service_id: string }) => r.service_id));

    setData({
      incidentCount: (incidents ?? []).length,
      backupTotal,
      backupSuccess,
      hoursUsed,
      hoursAvailable: contractedHours,
      roadmapCompleted: (roadmapRows ?? []).length,
      servicesMonitored: clientServices.length,
      heartbeatServices: uniqueHeartbeatServices.size,
    });
    setLoading(false);
  }

  const canGoNext = year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1);

  function goBack() { const [y, m] = prevMonth(year, month); setYear(y); setMonth(m); }
  function goNext() { if (!canGoNext) return; const [y, m] = nextMonth(year, month); setYear(y); setMonth(m); }

  const selectedClient = clients.find(c => c.id === clientId);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Resumen mensual</h2>
        <p className="text-sm text-gray-500 mt-0.5">Vista de actividad por cliente y mes</p>
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

      {/* Summary cards */}
      {loading && (
        <div className="text-sm text-gray-400 text-center py-12">Cargando datos…</div>
      )}

      {!loading && data && selectedClient && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600 font-medium">
            {selectedClient.company_name} · <span className="capitalize">{monthLabel(year, month)}</span>
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              icon={AlertCircle}
              color="red"
              label="Incidencias"
              value={data.incidentCount}
              sub={data.incidentCount === 0 ? 'Sin incidencias' : 'tickets de problema'}
            />
            <StatCard
              icon={Shield}
              color="emerald"
              label="Backups"
              value={data.backupTotal > 0 ? `${data.backupSuccess}/${data.backupTotal}` : '—'}
              sub={data.backupTotal > 0
                ? `${Math.round((data.backupSuccess / data.backupTotal) * 100)}% exitosos`
                : 'Sin registros'}
            />
            <StatCard
              icon={Clock}
              color="blue"
              label="Horas soporte"
              value={data.hoursUsed > 0 ? data.hoursUsed.toFixed(1) + 'h' : '0h'}
              sub={data.hoursAvailable > 0 ? `de ${data.hoursAvailable}h contratadas` : 'sin contrato de horas'}
            />
            <StatCard
              icon={CheckCircle2}
              color="violet"
              label="Roadmap completado"
              value={data.roadmapCompleted}
              sub="ítems entregados"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <StatCard
              icon={Server}
              color="slate"
              label="Servicios activos"
              value={data.servicesMonitored}
              sub={`${data.heartbeatServices} con telemetría en el mes`}
            />
            {data.backupTotal > 0 && data.backupSuccess < data.backupTotal && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-amber-800">Backups con fallas</p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    {data.backupTotal - data.backupSuccess} backup(s) fallaron este mes. Revisar logs.
                  </p>
                </div>
              </div>
            )}
            {data.hoursAvailable > 0 && data.hoursUsed > data.hoursAvailable && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-800">Horas excedidas</p>
                  <p className="text-xs text-red-700 mt-0.5">
                    Se usaron {(data.hoursUsed - data.hoursAvailable).toFixed(1)}h más de lo contratado.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {!loading && !clientId && (
        <div className="text-sm text-gray-400 text-center py-12">Seleccioná un cliente para ver el resumen.</div>
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
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex items-start gap-4">
      <div className={`p-2.5 rounded-lg shrink-0 ${colors[color]}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500 font-medium">{label}</p>
        <p className="text-2xl font-bold text-gray-900 mt-0.5 leading-none">{value}</p>
        <p className="text-xs text-gray-400 mt-1">{sub}</p>
      </div>
    </div>
  );
}
