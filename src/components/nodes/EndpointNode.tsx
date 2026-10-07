import { Handle, Position } from '@xyflow/react';
import { getServiceTypeIcon } from '../../lib/serviceTypeIcon';

export interface EndpointNodeData {
  hostname: string;
  ip?: string;
  type?: string;
  typeName?: string; // service_types.name — drives the icon
  status: 'online' | 'offline' | 'unknown';
}

const STATUS = {
  online:  { dot: 'bg-emerald-400', border: 'border-slate-700/50', icon: 'text-emerald-500' },
  offline: { dot: 'bg-red-400',     border: 'border-red-500/20',   icon: 'text-red-400'     },
  unknown: { dot: 'bg-slate-500',   border: 'border-slate-700',    icon: 'text-slate-500'   },
};

export default function EndpointNode({ data }: { data: EndpointNodeData }) {
  const s = STATUS[data.status] ?? STATUS.unknown;
  const Icon = getServiceTypeIcon(data.typeName);

  return (
    <div className={`w-40 rounded-lg border ${s.border} bg-[#0d1a29] shadow`}>
      <Handle type="target" position={Position.Top}    style={{ background: '#334155' }} />
      <Handle type="source" position={Position.Bottom} style={{ background: '#334155' }} />
      <Handle type="source" position={Position.Left}   id="left"  style={{ background: '#334155' }} />
      <Handle type="source" position={Position.Right}  id="right" style={{ background: '#334155' }} />

      <div className="flex items-center gap-2 px-2.5 py-2">
        <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${s.icon}`} />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-semibold text-slate-300 truncate">{data.hostname}</div>
          {data.ip && <div className="text-[10px] text-slate-600 font-mono">{data.ip}</div>}
        </div>
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} />
      </div>
    </div>
  );
}
