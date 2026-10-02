import { useState, useCallback } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap,
  applyNodeChanges, applyEdgeChanges,
  Node, Edge, NodeChange, EdgeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Lock, Unlock, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import MikroTikNode from './nodes/MikroTikNode';
import UnmanagedNode from './nodes/UnmanagedNode';
import EndpointNode from './nodes/EndpointNode';

const nodeTypes = {
  mikrotik:       MikroTikNode,
  unmanaged:      UnmanagedNode,
  endpoint:       EndpointNode,
  critical_asset: UnmanagedNode, // reutiliza UnmanagedNode, el borde cian viene del data.critical flag
};

// Leyenda técnica fija en esquina superior izquierda (debajo del site label)
function TopologyLegend() {
  return (
    <div className="absolute top-14 left-4 z-10 bg-[#1E293B] border border-[#334155] rounded-lg p-3 text-[10px] space-y-2 w-44">
      <div className="text-slate-400 font-bold uppercase tracking-wider text-[9px]">Estado</div>
      <div className="flex flex-col gap-1">
        {[
          { color: '#10B981', label: 'Operativo' },
          { color: '#F59E0B', label: 'Advertencia' },
          { color: '#EF4444', label: 'Caído / Crítico' },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
            <span className="text-slate-300">{label}</span>
          </div>
        ))}
      </div>
      <div className="border-t border-slate-700 pt-2 text-slate-400 font-bold uppercase tracking-wider text-[9px]">Enlaces</div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <svg width="24" height="6"><line x1="0" y1="3" x2="24" y2="3" stroke="#06B6D4" strokeWidth="2"/></svg>
          <span className="text-slate-300">Fibra 10G</span>
        </div>
        <div className="flex items-center gap-2">
          <svg width="24" height="6"><line x1="0" y1="3" x2="24" y2="3" stroke="#475569" strokeWidth="1.5" strokeDasharray="4 2"/></svg>
          <span className="text-slate-300">Cobre / UTP 1G</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-5 h-3.5 rounded border flex-shrink-0" style={{ borderColor: '#06B6D4', background: 'rgba(6,182,212,0.08)' }} />
          <span className="text-slate-300">Activo crítico</span>
        </div>
      </div>
    </div>
  );
}

interface Props {
  initialNodes: Node[];
  initialEdges: Edge[];
  clientId: string;
  siteId: string;
  onRefresh?: () => void;
}

export function TopologyCanvas({ initialNodes, initialEdges, clientId, siteId, onRefresh }: Props) {
  const [nodes, setNodes] = useState<Node[]>(initialNodes);
  const [edges, setEdges] = useState<Edge[]>(initialEdges);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    []
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );

  const onNodeDragStop = useCallback(async (_: React.MouseEvent, node: Node) => {
    setSaving(true);
    await supabase.from('net_layout_overrides').upsert(
      { client_id: clientId, site_id: siteId, device_id: node.id, x: node.position.x, y: node.position.y },
      { onConflict: 'client_id,site_id,device_id' }
    );
    setSaving(false);
  }, [clientId, siteId]);

  return (
    <div className="w-full h-[calc(100vh-120px)] bg-[#0B192C] relative rounded-xl overflow-hidden border border-slate-700/50">

      {/* Toolbar */}
      <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
        {saving && (
          <span className="text-[11px] text-slate-400 bg-[#1E293B] px-2.5 py-1.5 rounded-lg border border-slate-700">
            Guardando…
          </span>
        )}
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1E293B] border border-slate-700 text-slate-300 text-xs font-semibold hover:bg-slate-700 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Actualizar
          </button>
        )}
        <button
          onClick={() => setEditMode(!editMode)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
            editMode
              ? 'bg-cyan-600 border-cyan-500 text-white'
              : 'bg-[#1E293B] border-slate-700 text-slate-300 hover:bg-slate-700'
          }`}
        >
          {editMode ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
          {editMode ? 'Mover nodos' : 'Bloqueado'}
        </button>
      </div>

      {/* Site label + footer institucional */}
      <div className="absolute top-4 left-4 z-10">
        <span className="text-[10px] font-bold tracking-widest text-slate-500 bg-[#1E293B]/80 px-2.5 py-1.5 rounded-lg border border-slate-700 font-mono uppercase">
          {siteId}
        </span>
      </div>
      <div className="absolute bottom-3 left-4 z-10 text-[11px] text-slate-600 pointer-events-none select-none">
        Cenas.uy IT Solutions · cenas.uy
      </div>

      <TopologyLegend />

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        nodesDraggable={editMode}
        defaultEdgeOptions={{
          type: 'smoothstep',
          style: { stroke: '#334155', strokeWidth: 2 },
        }}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#1e3a5f" gap={24} size={1} variant={'dots' as any} />
        <Controls className="!bg-[#1E293B] !border-slate-700 [&>button]:!bg-[#1E293B] [&>button]:!border-slate-700 [&>button_svg]:!fill-slate-400" />
        <MiniMap
          nodeColor={(n) => n.type === 'mikrotik' ? '#06B6D4' : n.type === 'critical_asset' ? '#06B6D4' : n.type === 'endpoint' ? '#334155' : '#475569'}
          maskColor="rgba(11,25,44,0.75)"
          className="!bg-[#111c2d] !border-slate-700"
        />
      </ReactFlow>
    </div>
  );
}
