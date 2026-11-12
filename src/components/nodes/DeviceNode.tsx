import { Handle, Position } from '@xyflow/react';
import { DeviceIcon, DeviceKind } from './deviceIcons';

export type DeviceStatus = 'up' | 'warn' | 'down' | 'unknown';

export interface DeviceNodeData {
  label: string;
  ip?: string;
  kind: DeviceKind;
  status: DeviceStatus;
  /** Texto chico al lado del punto de estado: "OK · hace 4 min", "Sin señal 3 h"… */
  statusText?: string;
  /** Líneas extra (ISP, rol, ubicación). Se muestran debajo. */
  note?: string;
  critical?: boolean;
  /** Nodo dibujado a mano (no viene de un servicio) */
  custom?: boolean;
  editing?: boolean;
  [key: string]: unknown;
}

const DOT: Record<DeviceStatus, string> = {
  up: '#22c55e', warn: '#f59e0b', down: '#ef4444', unknown: '#cbd5e1',
};

const FONT = "'Plus Jakarta Sans',-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export default function DeviceNode({ data }: { data: DeviceNodeData }) {
  const handleStyle = {
    width: 8, height: 8, background: '#0ea5e9', border: '2px solid #fff',
    opacity: data.editing ? 1 : 0,
  };
  const isCloud = data.kind === 'internet';
  // Estado arriba, junto al nombre: abajo del equipo lo cruzarían los enlaces
  const status = data.status !== 'unknown' || data.statusText ? (
    <div className="mt-0.5 flex items-center justify-center gap-1">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: DOT[data.status] }} />
      {data.statusText && <span className="text-[9px] text-slate-500 whitespace-nowrap">{data.statusText}</span>}
    </div>
  ) : null;

  return (
    <div style={{ fontFamily: FONT }} className="flex flex-col items-center text-center select-none">

      {!isCloud && (
        <div className="mb-1 leading-tight bg-white/90 rounded px-1">
          <div className="text-[12px] font-semibold text-slate-900 whitespace-nowrap">{data.label}</div>
          {data.ip && <div className="text-[11px] text-slate-700 font-medium whitespace-nowrap">({data.ip})</div>}
          {status}
        </div>
      )}

      {/* Los puntos de conexión van sobre el equipo, no sobre el texto: los enlaces llegan al dibujo */}
      <div
        className="relative rounded-md"
        style={data.critical ? { outline: '2px solid #0ea5e9', outlineOffset: 4 } : undefined}
      >
        {(['top', 'right', 'bottom', 'left'] as const).map(side => (
          <Handle
            key={side}
            id={side}
            type="source"
            position={{ top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left }[side]}
            style={handleStyle}
            isConnectable={!!data.editing}
          />
        ))}
        <DeviceIcon kind={data.kind} label={isCloud ? data.label : undefined} />
      </div>

      {isCloud && data.ip && (
        <div className="-mt-1 text-[12px] font-bold text-slate-900 bg-white/90 rounded px-1">{data.ip}</div>
      )}

      {data.note && (
        <div className="mt-1 text-[11px] text-slate-700 whitespace-pre leading-snug bg-white/90 rounded px-1">{data.note}</div>
      )}

    </div>
  );
}
