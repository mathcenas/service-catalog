import { useState, useCallback } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap,
  applyNodeChanges, applyEdgeChanges,
  Node, Edge, NodeChange, EdgeChange, Connection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Lock, Unlock, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import MikroTikNode from './nodes/MikroTikNode';
import UnmanagedNode from './nodes/UnmanagedNode';
import EndpointNode from './nodes/EndpointNode';

const nodeTypes = {
  mikrotik:  MikroTikNode,
  unmanaged: UnmanagedNode,
  endpoint:  EndpointNode,
};

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

      {/* Site label */}
      <div className="absolute top-4 left-4 z-10">
        <span className="text-[10px] font-bold tracking-widest text-slate-500 bg-[#1E293B]/80 px-2.5 py-1.5 rounded-lg border border-slate-700 font-mono uppercase">
          {siteId}
        </span>
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        nodesDraggable={editMode}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#1e3a5f" gap={24} size={1} variant={'dots' as any} />
        <Controls className="!bg-[#1E293B] !border-slate-700 [&>button]:!bg-[#1E293B] [&>button]:!border-slate-700 [&>button_svg]:!fill-slate-400" />
        <MiniMap
          nodeColor={(n) => n.type === 'mikrotik' ? '#06B6D4' : n.type === 'endpoint' ? '#334155' : '#475569'}
          maskColor="rgba(11,25,44,0.75)"
          className="!bg-[#111c2d] !border-slate-700"
        />
      </ReactFlow>
    </div>
  );
}
