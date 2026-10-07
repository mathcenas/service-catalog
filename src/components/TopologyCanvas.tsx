import { useState, useCallback } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap,
  addEdge, applyNodeChanges, applyEdgeChanges,
  Node, Edge, NodeChange, EdgeChange, Connection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Lock, Unlock, RefreshCw, Trash2, ShieldAlert } from 'lucide-react';
import { supabase } from '../lib/supabase';
import MikroTikNode from './nodes/MikroTikNode';
import UnmanagedNode from './nodes/UnmanagedNode';
import EndpointNode from './nodes/EndpointNode';

const nodeTypes = {
  mikrotik:       MikroTikNode,
  unmanaged:      UnmanagedNode,
  endpoint:       EndpointNode,
  critical_asset: UnmanagedNode,
};

const EDGE_TYPES = [
  { id: 'fibra',  label: 'Fibra 10G',     style: { stroke: '#06B6D4', strokeWidth: 2 },                              labelStyle: { fill: '#06B6D4', fontSize: 10 } },
  { id: 'utp',    label: 'Cobre / UTP 1G', style: { stroke: '#475569', strokeWidth: 1.5, strokeDasharray: '5 3' },   labelStyle: { fill: '#64748B', fontSize: 10 } },
  { id: 'vpn',    label: 'VPN / Túnel',    style: { stroke: '#7C3AED', strokeWidth: 1.5, strokeDasharray: '8 4' },   labelStyle: { fill: '#7C3AED', fontSize: 10 } },
  { id: 'wifi',   label: 'Wi-Fi',          style: { stroke: '#10B981', strokeWidth: 1.5, strokeDasharray: '3 3' },   labelStyle: { fill: '#10B981', fontSize: 10 } },
];

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
        {EDGE_TYPES.map(et => (
          <div key={et.id} className="flex items-center gap-2">
            <svg width="24" height="6">
              <line x1="0" y1="3" x2="24" y2="3"
                stroke={et.style.stroke as string}
                strokeWidth={et.style.strokeWidth as number}
                strokeDasharray={(et.style as any).strokeDasharray ?? ''}
              />
            </svg>
            <span className="text-slate-300">{et.label}</span>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <span className="w-5 h-3.5 rounded border flex-shrink-0" style={{ borderColor: '#06B6D4', background: 'rgba(6,182,212,0.08)' }} />
          <span className="text-slate-300">Activo crítico</span>
        </div>
      </div>
    </div>
  );
}

// Modal to pick edge type when connecting two nodes
function EdgeTypeModal({ onSelect, onCancel }: { onSelect: (type: typeof EDGE_TYPES[0], label: string) => void; onCancel: () => void }) {
  const [label, setLabel] = useState('');
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-[#1E293B] border border-slate-700 rounded-xl p-5 w-72 shadow-2xl">
        <h3 className="text-sm font-bold text-white mb-1">Tipo de enlace</h3>
        <p className="text-[11px] text-slate-400 mb-4">Seleccioná el tipo de conexión entre estos dispositivos.</p>
        <div className="space-y-2 mb-4">
          {EDGE_TYPES.map(et => (
            <button
              key={et.id}
              onClick={() => onSelect(et, label)}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-700 transition-colors text-left"
            >
              <svg width="28" height="8">
                <line x1="0" y1="4" x2="28" y2="4"
                  stroke={et.style.stroke as string}
                  strokeWidth={et.style.strokeWidth as number}
                  strokeDasharray={(et.style as any).strokeDasharray ?? ''}
                />
              </svg>
              <span className="text-sm text-slate-200">{et.label}</span>
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Etiqueta opcional (ej: Te1, Gi0/1)"
          value={label}
          onChange={e => setLabel(e.target.value)}
          className="w-full bg-[#0B192C] border border-slate-600 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-cyan-500 mb-3"
        />
        <button onClick={onCancel} className="w-full text-xs text-slate-400 hover:text-slate-200 py-1">Cancelar</button>
      </div>
    </div>
  );
}

// Context menu for right-click on node
function NodeContextMenu({
  x, y, nodeId, isCritical,
  onDelete, onToggleCritical, onClose,
}: {
  x: number; y: number; nodeId: string; isCritical: boolean;
  onDelete: () => void; onToggleCritical: () => void; onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 bg-[#1E293B] border border-slate-700 rounded-lg py-1 shadow-xl w-44"
        style={{ left: x, top: y }}
      >
        <button
          onClick={() => { onToggleCritical(); onClose(); }}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-200 hover:bg-slate-700"
        >
          <ShieldAlert className="w-3.5 h-3.5 text-cyan-400" />
          {isCritical ? 'Quitar crítico' : 'Marcar crítico'}
        </button>
        <div className="border-t border-slate-700 my-1" />
        <button
          onClick={() => { onDelete(); onClose(); }}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Eliminar nodo
        </button>
      </div>
    </>
  );
}

interface Props {
  initialNodes: Node[];
  initialEdges: Edge[];
  clientId: string;
  siteId: string;
  siteName?: string;
  onRefresh?: () => void;
}

export function TopologyCanvas({ initialNodes, initialEdges, clientId, siteId, siteName, onRefresh }: Props) {
  const [nodes, setNodes] = useState<Node[]>(initialNodes);
  const [edges, setEdges] = useState<Edge[]>(initialEdges);
  const [editMode, setEditMode]   = useState(false);
  const [saving, setSaving]       = useState(false);
  const [pendingConn, setPendingConn] = useState<Connection | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes(nds => applyNodeChanges(changes, nds)),
    []
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges(eds => applyEdgeChanges(changes, eds)),
    []
  );

  const onNodeDragStop = useCallback(async (_: React.MouseEvent, node: Node) => {
    setSaving(true);
    if (siteId) {
      await supabase.from('net_layout_overrides').upsert(
        { site_id: siteId, service_id: node.id, x: node.position.x, y: node.position.y },
        { onConflict: 'service_id,site_id' }
      );
    } else {
      // Partial-index conflict — delete then insert for client-scoped rows
      await supabase.from('net_layout_overrides')
        .delete().eq('service_id', node.id).eq('client_id', clientId).is('site_id', null);
      await supabase.from('net_layout_overrides')
        .insert({ client_id: clientId, site_id: null, service_id: node.id, x: node.position.x, y: node.position.y });
    }
    setSaving(false);
  }, [siteId, clientId]);

  // Show edge-type picker when user connects two handles
  const onConnect = useCallback((conn: Connection) => {
    if (!editMode) return;
    setPendingConn(conn);
  }, [editMode]);

  const onEdgeTypeSelect = useCallback(async (et: typeof EDGE_TYPES[0], label: string) => {
    if (!pendingConn) { setPendingConn(null); return; }
    const newEdge: Edge = {
      ...addEdge({ ...pendingConn, type: 'smoothstep', label: label || undefined, style: et.style, labelStyle: et.labelStyle, labelBgStyle: { fill: '#0B192C' } }, edges)[edges.length],
      id: crypto.randomUUID(),
      source: pendingConn.source!,
      target: pendingConn.target!,
      type: 'smoothstep',
      label: label || undefined,
      style: et.style,
      labelStyle: et.labelStyle,
      labelBgStyle: { fill: '#0B192C' },
    };
    setSaving(true);
    const record = siteId
      ? { id: newEdge.id, site_id: siteId, client_id: null,     source_id: newEdge.source, target_id: newEdge.target, label: label || null, edge_style: { type: et.id, style: et.style, labelStyle: et.labelStyle } }
      : { id: newEdge.id, site_id: null,   client_id: clientId, source_id: newEdge.source, target_id: newEdge.target, label: label || null, edge_style: { type: et.id, style: et.style, labelStyle: et.labelStyle } };
    const { error } = await supabase.from('net_edges').insert(record);
    if (!error) setEdges(eds => [...eds, newEdge]);
    setSaving(false);
    setPendingConn(null);
  }, [pendingConn, siteId, clientId, edges]);

  // Delete selected edges with Backspace/Delete
  const onEdgesDelete = useCallback(async (deleted: Edge[]) => {
    const ids = deleted.map(e => e.id);
    await supabase.from('net_edges').delete().in('id', ids);
  }, []);

  const onNodeContextMenu = useCallback((e: React.MouseEvent, node: Node) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, nodeId: node.id });
  }, []);

  const toggleCritical = useCallback(async (nodeId: string) => {
    setNodes(nds => nds.map(n => {
      if (n.id !== nodeId) return n;
      const isCritical = !n.data.critical;
      return { ...n, type: isCritical ? 'critical_asset' : (n.data._origType as string ?? 'endpoint'), data: { ...n.data, critical: isCritical, _origType: n.type } };
    }));
    // Persist critical flag in layout overrides extra field
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    if (siteId) {
      await supabase.from('net_layout_overrides').upsert(
        { site_id: siteId, service_id: nodeId, x: node.position.x, y: node.position.y, critical: !node.data.critical },
        { onConflict: 'service_id,site_id' }
      );
    } else {
      await supabase.from('net_layout_overrides')
        .delete().eq('service_id', nodeId).eq('client_id', clientId).is('site_id', null);
      await supabase.from('net_layout_overrides')
        .insert({ client_id: clientId, site_id: null, service_id: nodeId, x: node.position.x, y: node.position.y, critical: !node.data.critical });
    }
  }, [nodes, siteId, clientId]);

  const deleteNode = useCallback(async (nodeId: string) => {
    setNodes(nds => nds.filter(n => n.id !== nodeId));
    setEdges(eds => eds.filter(e => e.source !== nodeId && e.target !== nodeId));
    if (siteId) {
      await supabase.from('net_layout_overrides').delete().eq('service_id', nodeId).eq('site_id', siteId);
      await supabase.from('net_edges').delete().or(`source_id.eq.${nodeId},target_id.eq.${nodeId}`).eq('site_id', siteId);
    } else {
      await supabase.from('net_layout_overrides').delete().eq('service_id', nodeId).eq('client_id', clientId).is('site_id', null);
      await supabase.from('net_edges').delete().or(`source_id.eq.${nodeId},target_id.eq.${nodeId}`).eq('client_id', clientId).is('site_id', null);
    }
  }, [siteId, clientId]);

  const contextNode = contextMenu ? nodes.find(n => n.id === contextMenu.nodeId) : null;

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
          <button onClick={onRefresh} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1E293B] border border-slate-700 text-slate-300 text-xs font-semibold hover:bg-slate-700 transition-colors">
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
          {editMode ? 'Editando' : 'Bloqueado'}
        </button>
      </div>

      {editMode && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 text-[10px] text-slate-500 bg-[#1E293B]/80 px-3 py-1.5 rounded-lg border border-slate-700 pointer-events-none">
          Arrastrá para mover · Conectá handles para enlazar · Clic derecho en nodo para opciones · Seleccioná enlace + Supr para borrar
        </div>
      )}

      {/* Site label */}
      <div className="absolute top-14 right-4 z-10">
        <span className="text-[10px] font-bold tracking-widest text-slate-500 bg-[#1E293B]/80 px-2.5 py-1.5 rounded-lg border border-slate-700 font-mono uppercase">
          {siteName ?? siteId}
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
        onConnect={onConnect}
        onEdgesDelete={onEdgesDelete}
        onNodeContextMenu={onNodeContextMenu}
        nodesDraggable={editMode}
        connectOnClick={false}
        deleteKeyCode={editMode ? 'Delete' : null}
        defaultEdgeOptions={{ type: 'smoothstep', style: { stroke: '#334155', strokeWidth: 2 } }}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#1e3a5f" gap={24} size={1} variant={'dots' as any} />
        <Controls className="!bg-[#1E293B] !border-slate-700 [&>button]:!bg-[#1E293B] [&>button]:!border-slate-700 [&>button_svg]:!fill-slate-400" />
        <MiniMap
          nodeColor={n => n.type === 'mikrotik' ? '#06B6D4' : n.type === 'critical_asset' ? '#06B6D4' : n.type === 'endpoint' ? '#334155' : '#475569'}
          maskColor="rgba(11,25,44,0.75)"
          className="!bg-[#111c2d] !border-slate-700"
        />
      </ReactFlow>

      {/* Edge type picker modal */}
      {pendingConn && (
        <EdgeTypeModal
          onSelect={onEdgeTypeSelect}
          onCancel={() => setPendingConn(null)}
        />
      )}

      {/* Node context menu */}
      {contextMenu && contextNode && (
        <NodeContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          nodeId={contextMenu.nodeId}
          isCritical={!!contextNode.data.critical}
          onToggleCritical={() => toggleCritical(contextMenu.nodeId)}
          onDelete={() => deleteNode(contextMenu.nodeId)}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
