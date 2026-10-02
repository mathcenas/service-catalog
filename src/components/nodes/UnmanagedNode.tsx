import { Handle, Position } from '@xyflow/react';
import { Network } from 'lucide-react';

export interface UnmanagedNodeData {
  hostname: string;
  ip?: string;
  model?: string;
  status: 'online' | 'offline' | 'unknown';
}

const STATUS = {
  online:  { dot: 'bg-emerald-400', border: 'border-slate-600/60' },
  offline: { dot: 'bg-red-400',     border: 'border-red-500/30'   },
  unknown: { dot: 'bg-slate-500',   border: 'border-slate-700'    },
};

export default function UnmanagedNode({ data }: { data: UnmanagedNodeData }) {
  const s = STATUS[data.status] ?? STATUS.unknown;

  return (
    <div className={`w-44 rounded-xl border ${s.border} bg-[#111c2d] shadow-lg`}>
      <Handle type="target" position={Position.Top}    style={{ background: '#334155' }} />
      <Handle type="source" position={Position.Bottom} style={{ background: '#334155' }} />
      <Handle type="source" position={Position.Left}   id="left"  style={{ background: '#334155' }} />
      <Handle type="source" position={Position.Right}  id="right" style={{ background: '#334155' }} />

      <div className="flex items-center gap-2 px-3 py-2.5">
        <div className="w-7 h-7 rounded-lg bg-slate-800 flex items-center justify-center flex-shrink-0">
          <Network className="w-3.5 h-3.5 text-slate-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-bold text-white truncate">{data.hostname}</div>
          {data.ip && <div className="text-[10px] text-slate-500 font-mono">{data.ip}</div>}
          {data.model && <div className="text-[10px] text-slate-500">{data.model}</div>}
        </div>
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${s.dot}`} />
      </div>

      <div className="px-3 pb-2">
        <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold tracking-widest text-slate-500 bg-slate-700/40 border border-slate-700">
          SWITCH
        </span>
      </div>
    </div>
  );
}
