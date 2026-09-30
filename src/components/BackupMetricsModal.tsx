import { useState, useEffect } from 'react';
import { X, HardDrive, AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceArea,
} from 'recharts';
import { supabase } from '../lib/supabase';

type Props = {
  serviceId: string;
  serviceName: string;
  onClose: () => void;
};

type BackupPoint = {
  id: string;
  date: string;
  ts: string;
  status: 'success' | 'failed' | 'warning';
  sizeGb?: number;
  durationMin?: number;
  jobName?: string;
  details?: string;
};

const DAYS_OPTIONS = [14, 30, 60];

function weekendAreas(pts: BackupPoint[]) {
  const areas: { x1: string; x2: string }[] = [];
  let start: string | null = null;
  for (const pt of pts) {
    const day = new Date(pt.date).getDay();
    const isWe = day === 0 || day === 6;
    if (isWe && start === null) { start = pt.ts; }
    else if (!isWe && start !== null) { areas.push({ x1: start, x2: pt.ts }); start = null; }
  }
  if (start !== null && pts.length > 0) areas.push({ x1: start, x2: pts[pts.length - 1].ts });
  return areas;
}

export function BackupMetricsModal({ serviceId, serviceName, onClose }: Props) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<BackupPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      const since = new Date(Date.now() - days * 86400000).toISOString();

      const { data: rows } = await supabase
        .from('service_backups')
        .select('id, status, size_bytes, duration_seconds, backed_up_at, job_name, details')
        .eq('service_id', serviceId)
        .gte('backed_up_at', since)
        .order('backed_up_at', { ascending: true });

      if (!active) return;

      const points: BackupPoint[] = (rows || []).map(r => {
        const d = new Date(r.backed_up_at);
        return {
          id: r.id,
          date: d.toISOString().split('T')[0],
          ts: `${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
          status: (r.status as BackupPoint['status']) || 'failed',
          sizeGb: r.size_bytes ? Number((r.size_bytes / (1024 ** 3)).toFixed(2)) : undefined,
          durationMin: r.duration_seconds ? Number((r.duration_seconds / 60).toFixed(1)) : undefined,
          jobName: r.job_name || undefined,
          details: r.details || undefined,
        };
      });

      setData(points);
      setLoading(false);
    };

    load();
    return () => { active = false; };
  }, [serviceId, days]);

  const totalSuccess = data.filter(d => d.status === 'success').length;
  const totalFailed  = data.filter(d => d.status === 'failed').length;
  const lastWithSize = [...data].reverse().find(d => d.sizeGb != null);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <HardDrive className="w-5 h-5 text-emerald-600" />
            <div>
              <div className="font-semibold text-gray-900">{serviceName}</div>
              <div className="text-xs text-gray-400">Historial de copias de seguridad</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
              {DAYS_OPTIONS.map(d => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={`px-3 py-1.5 transition-colors ${
                    days === d ? 'bg-emerald-600 text-white' : 'text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>
            <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-5 space-y-6">
          {loading ? (
            <div className="text-center py-16 text-gray-400 text-sm">Cargando backups...</div>
          ) : data.length === 0 ? (
            <div className="text-center py-16 text-gray-400 text-sm">
              No hay registros de backup en los últimos {days} días.
            </div>
          ) : (
            <>
              {/* KPIs */}
              <div className="grid grid-cols-3 gap-4">
                <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-100 flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                  <div>
                    <div className="text-xs text-emerald-700 font-medium">Exitosos</div>
                    <div className="text-lg font-bold text-emerald-900">{totalSuccess}</div>
                  </div>
                </div>
                <div className="p-3 bg-rose-50 rounded-lg border border-rose-100 flex items-center gap-3">
                  <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
                  <div>
                    <div className="text-xs text-rose-700 font-medium">Fallidos</div>
                    <div className="text-lg font-bold text-rose-900">{totalFailed}</div>
                  </div>
                </div>
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 flex items-center gap-3">
                  <Clock className="w-5 h-5 text-slate-600 shrink-0" />
                  <div>
                    <div className="text-xs text-slate-600 font-medium">Último tamaño</div>
                    <div className="text-lg font-bold text-slate-800">
                      {lastWithSize ? `${lastWithSize.sizeGb} GB` : '—'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Gráfico tamaño */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Tamaño por ejecución (GB)</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={data} margin={{ top: 4, right: 8, left: -15, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="ts" tick={{ fontSize: 10, fill: '#94a3b8' }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} unit=" GB" />
                    <Tooltip
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                      formatter={(v, _name, item) => [
                        `${v} GB${item.payload.durationMin != null ? ` · ${item.payload.durationMin} min` : ''}`,
                        item.payload.jobName || 'Backup',
                      ]}
                    />
                    {weekendAreas(data).map((a, i) => (
                      <ReferenceArea key={i} x1={a.x1} x2={a.x2} fill="#f0f9ff" fillOpacity={0.7} strokeOpacity={0} />
                    ))}
                    <Bar dataKey="sizeGb" radius={[4, 4, 0, 0]}>
                      {data.map((entry, i) => (
                        <Cell
                          key={`cell-${i}`}
                          fill={entry.status === 'success' ? '#10b981' : entry.status === 'warning' ? '#f59e0b' : '#f43f5e'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
