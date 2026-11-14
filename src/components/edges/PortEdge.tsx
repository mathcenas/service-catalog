import { BaseEdge, EdgeLabelRenderer, getStraightPath, type EdgeProps } from '@xyflow/react';

export interface PortEdgeData {
  /** Puerto en la punta de origen (ej: 1/36) */
  sourcePort?: string;
  /** Puerto en la punta de destino (ej: Eth 1/1) */
  targetPort?: string;
  /** Texto en el medio del enlace (IP del enlace, VLAN…) */
  midLabel?: string;
  /** Detectado por el router (net_links): no está guardado en net_edges */
  auto?: boolean;
  [key: string]: unknown;
}

const LABEL =
  'absolute text-[10px] font-semibold text-slate-800 bg-white/90 px-1 rounded whitespace-nowrap pointer-events-none';

/** Enlace recto con el puerto escrito cerca de cada equipo, como en un diagrama de Visio */
export default function PortEdge({ id, sourceX, sourceY, targetX, targetY, style, data, selected, sourceHandleId, targetHandleId }: EdgeProps) {
  const d = (data ?? {}) as PortEdgeData;
  const [path, midX, midY] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  const len = Math.hypot(targetX - sourceX, targetY - sourceY) || 1;
  // ~28px desde cada punta. Si el enlace entra por arriba del equipo, más lejos,
  // para que el puerto quede por encima del nombre y la IP y no los tape.
  const offset = (handle?: string | null) => (handle === 'top' ? 78 : 28);
  const ts = Math.min(offset(sourceHandleId) / len, 0.45);
  const te = Math.min(offset(targetHandleId) / len, 0.45);
  const at = (f: number) => ({ x: sourceX + (targetX - sourceX) * f, y: sourceY + (targetY - sourceY) * f });
  const s = at(ts);
  const e = at(1 - te);

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{ ...style, ...(selected ? { stroke: '#0ea5e9', strokeWidth: 2.5 } : {}) }}
      />
      <EdgeLabelRenderer>
        {d.sourcePort && (
          <div className={LABEL} style={{ zIndex: 1000, transform: `translate(-50%, -50%) translate(${s.x}px, ${s.y}px)` }}>{d.sourcePort}</div>
        )}
        {d.targetPort && (
          <div className={LABEL} style={{ zIndex: 1000, transform: `translate(-50%, -50%) translate(${e.x}px, ${e.y}px)` }}>{d.targetPort}</div>
        )}
        {d.midLabel && (
          <div className={LABEL} style={{ zIndex: 1000, transform: `translate(-50%, -50%) translate(${midX}px, ${midY}px)` }}>{d.midLabel}</div>
        )}
      </EdgeLabelRenderer>
    </>
  );
}
