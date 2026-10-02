import { Handle, Position } from '@xyflow/react';
import { Wifi, WifiOff } from 'lucide-react';

export interface MikroTikNodeData {
  hostname: string;
  ip: string;
  model: string;
  status: 'online' | 'offline' | 'unknown';
  uptime_seconds?: number;
  throughput_in_bps?: number;
  throughput_out_bps?: number;
}

function formatUptime(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
}

function formatBps(bps: number): string {
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`;
  if (bps >= 1_000)     return `${(bps / 1_000).toFixed(0)} Kbps`;
  return `${bps} bps`;
}

const STATUS = {
  online:  { dot: 'bg-emerald-400', ring: 'ring-emerald-400/30', border: 'border-emerald-500/40', label: 'Online' },
  offline: { dot: 'bg-red-400',     ring: 'ring-red-400/30',     border: 'border-red-500/40',     label: 'Offline' },
  unknown: { dot: 'bg-slate-400',   ring: 'ring-slate-400/20',   border: 'border-slate-600',      label: '?' },
};

export default function MikroTikNode({ data }: { data: MikroTikNodeData }) {
  const s = STATUS[data.status] ?? STATUS.unknown;
  const Online = data.status === 'online' ? Wifi : WifiOff;

  return (
    <div className={`w-52 rounded-xl border ${s.border} bg-[#0f2035] shadow-xl ring-2 ${s.ring}`}>
      <Handle type="target" position={Position.Top}    style={{ background: '#334155' }} />
      <Handle type="source" position={Position.Bottom} style={{ background: '#334155' }} />
      <Handle type="source" position={Position.Left}   id="left"  style={{ background: '#334155' }} />
      <Handle type="source" position={Position.Right}  id="right" style={{ background: '#334155' }} />

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5">
        <div className="w-7 h-7 rounded-lg bg-[#1a3a5c] flex items-center justify-center flex-shrink-0">
          <Online className="w-3.5 h-3.5 text-cyan-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-bold text-white truncate">{data.hostname}</div>
          <div className="text-[10px] text-slate-400 font-mono">{data.ip}</div>
        </div>
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${s.dot}`} />
      </div>

      {/* Body */}
      <div className="px-3 py-2 flex flex-col gap-1.5">
        <div className="text-[10px] text-slate-500 font-mono">{data.model}</div>

        {data.uptime_seconds != null && (
          <div className="flex justify-between text-[10px]">
            <span className="text-slate-500">Uptime</span>
            <span className="text-slate-300 font-semibold">{formatUptime(data.uptime_seconds)}</span>
          </div>
        )}
        {data.throughput_in_bps != null && (
          <div className="flex justify-between text-[10px]">
            <span className="text-slate-500">↓ In</span>
            <span className="text-emerald-400 font-semibold font-mono">{formatBps(data.throughput_in_bps)}</span>
          </div>
        )}
        {data.throughput_out_bps != null && (
          <div className="flex justify-between text-[10px]">
            <span className="text-slate-500">↑ Out</span>
            <span className="text-cyan-400 font-semibold font-mono">{formatBps(data.throughput_out_bps)}</span>
          </div>
        )}
      </div>

      {/* Footer badge */}
      <div className="px-3 pb-2">
        <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold tracking-widest text-cyan-500 bg-cyan-500/10 border border-cyan-500/20">
          MIKROTIK
        </span>
      </div>
    </div>
  );
}
