import { useState, useEffect } from 'react';
import { X, TrendingUp } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceArea,
} from 'recharts';
import { supabase } from '../lib/supabase';

type Props = {
  serviceId: string;
  serviceName: string;
  onClose: () => void;
};

type DataPoint = {
  ts: string;         // formatted label
  iso: string;        // original ISO string for sorting
  cpu?: number;
  ram?: number;
  disk?: number;
  download?: number;
  upload?: number;
  ping?: number;
};

const DAYS_OPTIONS = [7, 14, 30];

// Returns [{x1, x2}] for each consecutive weekend (Sat/Sun) run in the series
function weekendAreas(pts: DataPoint[]) {
  const areas: { x1: string; x2: string }[] = [];
  let start: string | null = null;
  for (const pt of pts) {
    const day = new Date(pt.iso).getDay(); // 0=Sun, 6=Sat
    const isWe = day === 0 || day === 6;
    if (isWe && start === null) { start = pt.ts; }
    else if (!isWe && start !== null) { areas.push({ x1: start, x2: pt.ts }); start = null; }
  }
  if (start !== null && pts.length > 0) areas.push({ x1: start, x2: pts[pts.length - 1].ts });
  return areas;
}

export function ServiceMetricsModal({ serviceId, serviceName, onClose }: Props) {
  const [days, setDays] = useState(7);
  const [systemData, setSystemData] = useState<DataPoint[]>([]);
  const [netData, setNetData]       = useState<DataPoint[]>([]);
  const [loading, setLoading]       = useState(true);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      const since = new Date(Date.now() - days * 86400000).toISOString();

      const { data } = await supabase
        .from('service_heartbeats')
        .select('source, status, payload, received_at')
        .eq('service_id', serviceId)
        .in('source', ['system-health', 'speedtest'])
        .gte('received_at', since)
        .order('received_at', { ascending: true });

      if (!active) return;

      const sys: DataPoint[] = [];
      const net: DataPoint[] = [];

      for (const row of data || []) {
        const p = row.payload || {};
        const dateObj = new Date(row.received_at);
        const label = days <= 7
          ? `${dateObj.getDate()}/${dateObj.getMonth() + 1} ${String(dateObj.getHours()).padStart(2, '0')}:${String(dateObj.getMinutes()).padStart(2, '0')}`
          : `${dateObj.getDate()}/${dateObj.getMonth() + 1}`;

        if (row.source === 'system-health') {
          if (p.cpu_pct != null || p.ram_pct != null || p.disk_pct != null) {
            sys.push({
              ts: label,
              iso: row.received_at,
              cpu:  p.cpu_pct  != null ? Number(p.cpu_pct)  : undefined,
              ram:  p.ram_pct  != null ? Number(p.ram_pct)  : undefined,
              disk: p.disk_pct != null ? Number(p.disk_pct) : undefined,
            });
          }
        } else if (row.source === 'speedtest') {
          if (p.download_mbps != null || p.ping_ms != null) {
            net.push({
              ts: label,
              iso: row.received_at,
              download: p.download_mbps != null ? Number(p.download_mbps) : undefined,
              upload:   p.upload_mbps   != null ? Number(p.upload_mbps)   : undefined,
              ping:     p.ping_ms       != null ? Number(p.ping_ms)       : undefined,
            });
          }
        }
      }

      // For >7 days, bucket by day keeping the MAX value to preserve spikes
      const bucketByDayMax = (pts: DataPoint[]) => {
        const map = new Map<string, DataPoint>();
        for (const pt of pts) {
          const existing = map.get(pt.ts);
          if (!existing) {
            map.set(pt.ts, pt);
          } else {
            map.set(pt.ts, {
              ...pt,
              cpu:  Math.max(existing.cpu ?? 0, pt.cpu ?? 0) || undefined,
              ram:  Math.max(existing.ram ?? 0, pt.ram ?? 0) || undefined,
              disk: Math.max(existing.disk ?? 0, pt.disk ?? 0) || undefined,
            });
          }
        }
        return Array.from(map.values());
      };

      if (days > 7) {
        setSystemData(bucketByDayMax(sys));
        setNetData(bucketByDayMax(net));
      } else {
        setSystemData(sys);
        setNetData(net);
      }

      setLoading(false);
    };

    load();

    return () => { active = false; };
  }, [serviceId, days]);

  const hasSystem = systemData.length > 0;
  const hasNet    = netData.length > 0;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-blue-600" />
            <div>
              <div className="font-semibold text-gray-900">{serviceName}</div>
              <div className="text-xs text-gray-400">Historial de métricas</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
              {DAYS_OPTIONS.map(d => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={`px-3 py-1.5 transition-colors ${
                    days === d ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-50'
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
        <div className="px-6 py-5 space-y-8">
          {loading ? (
            <div className="text-center py-16 text-gray-400 text-sm">Cargando métricas...</div>
          ) : !hasSystem && !hasNet ? (
            <div className="text-center py-16 text-gray-400 text-sm">
              Sin datos de métricas para los últimos {days} días.
            </div>
          ) : (
            <>
              {hasSystem && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">CPU / RAM / Disco (%)</h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={systemData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="gCpu"  x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.15} />
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="gRam"  x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor="#8b5cf6" stopOpacity={0.15} />
                          <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="gDisk" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor="#f59e0b" stopOpacity={0.15} />
                          <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="ts" tick={{ fontSize: 10, fill: '#94a3b8' }} interval="preserveStartEnd" />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#94a3b8' }} unit="%" />
                      <Tooltip
                        contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                        formatter={(v) => [`${v}%`, '']}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      {weekendAreas(systemData).map((a, i) => (
                        <ReferenceArea key={i} x1={a.x1} x2={a.x2} fill="#f0f9ff" fillOpacity={0.7} strokeOpacity={0} />
                      ))}
                      <Area type="monotone" dataKey="cpu"  name="CPU"   stroke="#3b82f6" fill="url(#gCpu)"  strokeWidth={1.5} dot={false} connectNulls />
                      <Area type="monotone" dataKey="ram"  name="RAM"   stroke="#8b5cf6" fill="url(#gRam)"  strokeWidth={1.5} dot={false} connectNulls />
                      <Area type="monotone" dataKey="disk" name="Disco" stroke="#f59e0b" fill="url(#gDisk)" strokeWidth={1.5} dot={false} connectNulls />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}

              {hasNet && (
                <>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Velocidad de red (Mbps)</h3>
                    <ResponsiveContainer width="100%" height={180}>
                      <AreaChart data={netData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                        <defs>
                          <linearGradient id="gDown" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor="#10b981" stopOpacity={0.15} />
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="gUp" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor="#06b6d4" stopOpacity={0.15} />
                            <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="ts" tick={{ fontSize: 10, fill: '#94a3b8' }} interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} unit=" Mb" />
                        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                          formatter={(v) => [`${v} Mbps`, '']} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        {weekendAreas(netData).map((a, i) => (
                          <ReferenceArea key={i} x1={a.x1} x2={a.x2} fill="#f0f9ff" fillOpacity={0.7} strokeOpacity={0} />
                        ))}
                        <Area type="monotone" dataKey="download" name="Descarga" stroke="#10b981" fill="url(#gDown)" strokeWidth={1.5} dot={false} connectNulls />
                        <Area type="monotone" dataKey="upload"   name="Subida"   stroke="#06b6d4" fill="url(#gUp)"   strokeWidth={1.5} dot={false} connectNulls />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Latencia (ms)</h3>
                    <ResponsiveContainer width="100%" height={140}>
                      <AreaChart data={netData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                        <defs>
                          <linearGradient id="gPing" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor="#f43f5e" stopOpacity={0.12} />
                            <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="ts" tick={{ fontSize: 10, fill: '#94a3b8' }} interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} unit=" ms" />
                        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                          formatter={(v) => [`${v} ms`, 'Ping']} />
                        {weekendAreas(netData).map((a, i) => (
                          <ReferenceArea key={i} x1={a.x1} x2={a.x2} fill="#f0f9ff" fillOpacity={0.7} strokeOpacity={0} />
                        ))}
                        <Area type="monotone" dataKey="ping" name="Ping" stroke="#f43f5e" fill="url(#gPing)" strokeWidth={1.5} dot={false} connectNulls />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
