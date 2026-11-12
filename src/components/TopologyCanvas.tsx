import { useState, useCallback, useRef } from 'react';
import {
  ReactFlow, Background, Controls, ReactFlowProvider, useReactFlow,
  applyNodeChanges, applyEdgeChanges, getNodesBounds, getViewportForBounds,
  ConnectionMode, BackgroundVariant,
  Node, Edge, NodeChange, EdgeChange, Connection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { toPng } from 'html-to-image';
import { Lock, Unlock, RefreshCw, ShieldAlert, Cloud, Plus, Download, Pencil } from 'lucide-react';
import { supabase } from '../lib/supabase';
import DeviceNode, { type DeviceNodeData } from './nodes/DeviceNode';
import PortEdge, { type PortEdgeData } from './edges/PortEdge';
import { DEVICE_KINDS, type DeviceKind } from './nodes/deviceIcons';

const nodeTypes = { device: DeviceNode };
const edgeTypes = { port: PortEdge };

export const EDGE_TYPES = [
  { id: 'utp',   label: 'Cobre / UTP',  style: { stroke: '#1f2937', strokeWidth: 1.5 } },
  { id: 'fibra', label: 'Fibra',        style: { stroke: '#0891b2', strokeWidth: 2 } },
  { id: 'vpn',   label: 'VPN / Túnel',  style: { stroke: '#7c3aed', strokeWidth: 1.5, strokeDasharray: '8 4' } },
  { id: 'wifi',  label: 'Wi-Fi',        style: { stroke: '#16a34a', strokeWidth: 1.5, strokeDasharray: '3 3' } },
] as const;
export type EdgeTypeId = typeof EDGE_TYPES[number]['id'];

export const edgeStyleFor = (type?: string) =>
  ({ ...(EDGE_TYPES.find(t => t.id === type) ?? EDGE_TYPES[0]).style }) as React.CSSProperties;

/** Lo que se guarda en net_edges.edge_style */
export type StoredEdgeStyle = PortEdgeData & { type?: EdgeTypeId; sourceHandle?: string | null; targetHandle?: string | null };

const STATUS_LEGEND = [
  { color: '#22c55e', label: 'Reportando OK' },
  { color: '#f59e0b', label: 'Advertencia / degradado' },
  { color: '#ef4444', label: 'Caído / sin señal' },
  { color: '#cbd5e1', label: 'Sin monitoreo' },
];

function TopologyLegend() {
  return (
    <div className="absolute bottom-4 right-4 z-10 bg-white/95 border border-slate-200 rounded-lg p-3 text-[10px] space-y-2 w-48 shadow-sm">
      <div className="text-slate-500 font-bold uppercase tracking-wider text-[9px]">Estado</div>
      {STATUS_LEGEND.map(({ color, label }) => (
        <div key={label} className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
          <span className="text-slate-700">{label}</span>
        </div>
      ))}
      <div className="border-t border-slate-100 pt-2 text-slate-500 font-bold uppercase tracking-wider text-[9px]">Enlaces</div>
      {EDGE_TYPES.map(et => (
        <div key={et.id} className="flex items-center gap-2">
          <svg width="24" height="6">
            <line x1="0" y1="3" x2="24" y2="3" stroke={et.style.stroke}
              strokeWidth={et.style.strokeWidth} strokeDasharray={'strokeDasharray' in et.style ? et.style.strokeDasharray : undefined} />
          </svg>
          <span className="text-slate-700">{et.label}</span>
        </div>
      ))}
    </div>
  );
}

const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-sky-500';

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onMouseDown={onClose}>
      <div className="bg-white rounded-xl p-5 w-full max-w-sm shadow-2xl" onMouseDown={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-slate-900 mb-4">{title}</h3>
        {children}
      </div>
    </div>
  );
}

/** Alta / edición de enlace: tipo + puerto en cada punta + texto al medio */
function EdgeModal({ initial, sourceName, targetName, onSave, onDelete, onCancel }: {
  initial?: StoredEdgeStyle;
  sourceName: string;
  targetName: string;
  onSave: (v: StoredEdgeStyle) => void;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<EdgeTypeId>(initial?.type ?? 'utp');
  const [sourcePort, setSourcePort] = useState(initial?.sourcePort ?? '');
  const [targetPort, setTargetPort] = useState(initial?.targetPort ?? '');
  const [midLabel, setMidLabel] = useState(initial?.midLabel ?? '');
  return (
    <Modal title={initial ? 'Editar enlace' : 'Nuevo enlace'} onClose={onCancel}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {EDGE_TYPES.map(et => (
            <button key={et.id} onClick={() => setType(et.id)}
              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs text-left ${type === et.id ? 'border-sky-500 bg-sky-50 text-sky-800' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
              <svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" stroke={et.style.stroke} strokeWidth={et.style.strokeWidth}
                strokeDasharray={'strokeDasharray' in et.style ? et.style.strokeDasharray : undefined} /></svg>
              {et.label}
            </button>
          ))}
        </div>
        <label className="block">
          <span className="text-[11px] text-slate-500">Puerto en {sourceName}</span>
          <input className={inputCls} value={sourcePort} onChange={e => setSourcePort(e.target.value)} placeholder="ej: 1/36" />
        </label>
        <label className="block">
          <span className="text-[11px] text-slate-500">Puerto en {targetName}</span>
          <input className={inputCls} value={targetPort} onChange={e => setTargetPort(e.target.value)} placeholder="ej: Eth 1/1" />
        </label>
        <label className="block">
          <span className="text-[11px] text-slate-500">Texto en el medio (opcional)</span>
          <input className={inputCls} value={midLabel} onChange={e => setMidLabel(e.target.value)} placeholder="ej: 192.168.244.10 · VLAN 20" />
        </label>
        <div className="flex items-center gap-2 pt-1">
          {onDelete && (
            <button onClick={onDelete} className="px-3 py-1.5 rounded-lg text-xs text-red-600 hover:bg-red-50">Eliminar</button>
          )}
          <span className="flex-1" />
          <button onClick={onCancel} className="px-3 py-1.5 rounded-lg text-xs text-slate-600 hover:bg-slate-100">Cancelar</button>
          <button
            onClick={() => onSave({ type, sourcePort: sourcePort.trim() || undefined, targetPort: targetPort.trim() || undefined, midLabel: midLabel.trim() || undefined })}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700">Guardar</button>
        </div>
      </div>
    </Modal>
  );
}

type NodeForm = { kind: DeviceKind; label: string; ip: string; note: string };

/** Alta / edición de nodo. Para servicios solo se cambia el ícono; para nodos a mano, todo. */
function NodeModal({ initial, custom, onSave, onDelete, onCancel }: {
  initial: NodeForm;
  custom: boolean;
  onSave: (v: NodeForm) => void;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState<NodeForm>(initial);
  const set = (k: keyof NodeForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF(prev => ({ ...prev, [k]: e.target.value }));
  return (
    <Modal title={custom ? (onDelete ? 'Editar elemento' : 'Agregar elemento') : `Ícono de ${initial.label}`} onClose={onCancel}>
      <div className="space-y-3">
        <label className="block">
          <span className="text-[11px] text-slate-500">Tipo</span>
          <select className={inputCls} value={f.kind} onChange={set('kind')}>
            {DEVICE_KINDS.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select>
        </label>
        {custom ? (
          <>
            <label className="block">
              <span className="text-[11px] text-slate-500">Nombre</span>
              <input className={inputCls} value={f.label} onChange={set('label')} placeholder={f.kind === 'internet' ? 'Internet' : 'cur-stk-3810M'} />
            </label>
            <label className="block">
              <span className="text-[11px] text-slate-500">IP</span>
              <input className={inputCls} value={f.ip} onChange={set('ip')} placeholder={f.kind === 'internet' ? '8.8.8.8' : '192.168.1.1'} />
            </label>
            <label className="block">
              <span className="text-[11px] text-slate-500">Notas (una por línea)</span>
              <textarea className={inputCls} rows={3} value={f.note} onChange={set('note')}
                placeholder={f.kind === 'internet' ? 'Antel  190.0.143.97  Main\nTelefonica  200.58.152.185  Backup' : ''} />
            </label>
          </>
        ) : (
          <p className="text-[11px] text-slate-500">Nombre, IP y estado vienen del servicio en el catálogo.</p>
        )}
        <div className="flex items-center gap-2 pt-1">
          {onDelete && <button onClick={onDelete} className="px-3 py-1.5 rounded-lg text-xs text-red-600 hover:bg-red-50">Eliminar</button>}
          <span className="flex-1" />
          <button onClick={onCancel} className="px-3 py-1.5 rounded-lg text-xs text-slate-600 hover:bg-slate-100">Cancelar</button>
          <button
            disabled={custom && !f.label.trim()}
            onClick={() => onSave({ ...f, label: f.label.trim(), ip: f.ip.trim(), note: f.note.trim() })}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-40">Guardar</button>
        </div>
      </div>
    </Modal>
  );
}

function NodeContextMenu({ x, y, isCritical, onEdit, onToggleCritical, onClose }: {
  x: number; y: number; isCritical: boolean;
  onEdit: () => void; onToggleCritical: () => void; onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="fixed z-50 bg-white border border-slate-200 rounded-lg py-1 shadow-xl w-44" style={{ left: x, top: y }}>
        <button onClick={() => { onEdit(); onClose(); }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50">
          <Pencil className="w-3.5 h-3.5 text-slate-500" /> Editar
        </button>
        <button onClick={() => { onToggleCritical(); onClose(); }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50">
          <ShieldAlert className="w-3.5 h-3.5 text-sky-500" /> {isCritical ? 'Quitar crítico' : 'Marcar crítico'}
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

const FONT = "'Plus Jakarta Sans',-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function Canvas({ initialNodes, initialEdges, clientId, siteId, siteName, onRefresh }: Props) {
  const [nodes, setNodes] = useState<Node[]>(initialNodes);
  const [edges, setEdges] = useState<Edge[]>(initialEdges);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [pendingConn, setPendingConn] = useState<Connection | null>(null);
  const [editingEdge, setEditingEdge] = useState<Edge | null>(null);
  const [nodeForm, setNodeForm] = useState<{ nodeId?: string; custom: boolean; initial: NodeForm } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { getNodes, screenToFlowPosition } = useReactFlow();

  const nodeName = (id?: string | null) => (nodes.find(n => n.id === id)?.data as DeviceNodeData | undefined)?.label ?? 'origen';
  const withEditing = (list: Node[], editing: boolean) => list.map(n => ({ ...n, data: { ...n.data, editing } }));

  const onNodesChange = useCallback((changes: NodeChange[]) => setNodes(nds => applyNodeChanges(changes, nds)), []);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => setEdges(eds => applyEdgeChanges(changes, eds)), []);

  // ── Persistencia ───────────────────────────────────────────
  const saveServiceOverride = useCallback(async (nodeId: string, patch: { x: number; y: number; kind?: string | null; critical?: boolean }) => {
    if (siteId) {
      await supabase.from('net_layout_overrides').upsert({ site_id: siteId, device_id: nodeId, ...patch }, { onConflict: 'device_id,site_id' });
    } else {
      await supabase.from('net_layout_overrides').delete().eq('device_id', nodeId).eq('client_id', clientId).is('site_id', null);
      await supabase.from('net_layout_overrides').insert({ client_id: clientId, site_id: null, device_id: nodeId, ...patch });
    }
  }, [siteId, clientId]);

  const overridePatch = (n: Node) => {
    const d = n.data as DeviceNodeData;
    return { x: n.position.x, y: n.position.y, kind: (n.data._kindOverride as string | undefined) ?? null, critical: !!d.critical };
  };

  const onNodeDragStop = useCallback(async (_: unknown, node: Node) => {
    setSaving(true);
    if ((node.data as DeviceNodeData).custom) {
      await supabase.from('net_custom_nodes').update({ x: node.position.x, y: node.position.y }).eq('id', node.id);
    } else {
      await saveServiceOverride(node.id, overridePatch(node));
    }
    setSaving(false);
  }, [saveServiceOverride]);

  const onConnect = useCallback((conn: Connection) => { if (editMode) setPendingConn(conn); }, [editMode]);

  const createEdge = async (v: StoredEdgeStyle) => {
    if (!pendingConn?.source || !pendingConn.target) { setPendingConn(null); return; }
    const id = crypto.randomUUID();
    const stored: StoredEdgeStyle = { ...v, sourceHandle: pendingConn.sourceHandle, targetHandle: pendingConn.targetHandle };
    setSaving(true);
    const { error } = await supabase.from('net_edges').insert({
      id, site_id: siteId || null, client_id: siteId ? null : clientId,
      source_id: pendingConn.source, target_id: pendingConn.target,
      label: v.midLabel ?? null, edge_style: stored,
    });
    if (error) alert(`No se pudo guardar el enlace: ${error.message}`);
    else setEdges(eds => [...eds, {
      id, source: pendingConn.source!, target: pendingConn.target!, type: 'port',
      sourceHandle: pendingConn.sourceHandle, targetHandle: pendingConn.targetHandle,
      style: edgeStyleFor(v.type), data: stored,
    }]);
    setSaving(false);
    setPendingConn(null);
  };

  const updateEdge = async (edge: Edge, v: StoredEdgeStyle) => {
    const stored: StoredEdgeStyle = { ...v, sourceHandle: edge.sourceHandle, targetHandle: edge.targetHandle };
    setSaving(true);
    await supabase.from('net_edges').update({ label: v.midLabel ?? null, edge_style: stored }).eq('id', edge.id);
    setEdges(eds => eds.map(e => e.id === edge.id ? { ...e, style: edgeStyleFor(v.type), data: stored } : e));
    setSaving(false);
    setEditingEdge(null);
  };

  const deleteEdge = async (edge: Edge) => {
    await supabase.from('net_edges').delete().eq('id', edge.id);
    setEdges(eds => eds.filter(e => e.id !== edge.id));
    setEditingEdge(null);
  };

  const onEdgesDelete = useCallback(async (deleted: Edge[]) => {
    await supabase.from('net_edges').delete().in('id', deleted.map(e => e.id));
  }, []);

  // ── Nodos ──────────────────────────────────────────────────
  const openNodeEditor = (nodeId: string) => {
    const n = nodes.find(x => x.id === nodeId);
    if (!n) return;
    const d = n.data as DeviceNodeData;
    setNodeForm({ nodeId, custom: !!d.custom, initial: { kind: d.kind, label: d.label, ip: d.ip ?? '', note: d.note ?? '' } });
  };

  const saveNode = async (f: NodeForm) => {
    if (!nodeForm) return;
    setSaving(true);
    if (!nodeForm.nodeId) {
      // Nuevo nodo dibujado a mano, al centro de la vista
      const rect = wrapperRef.current?.getBoundingClientRect();
      const pos = rect ? screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 3 }) : { x: 0, y: 0 };
      const { data, error } = await supabase.from('net_custom_nodes').insert({
        client_id: clientId, site_id: siteId || null, kind: f.kind, label: f.label, ip: f.ip || null, note: f.note || null, x: pos.x, y: pos.y,
      }).select('id').single();
      if (error || !data) alert(`No se pudo agregar: ${error?.message ?? 'error'}`);
      else setNodes(nds => [...nds, {
        id: data.id, type: 'device', position: pos,
        data: { label: f.label, ip: f.ip, note: f.note, kind: f.kind, status: 'unknown', custom: true, editing: true } satisfies DeviceNodeData,
      }]);
    } else {
      const n = nodes.find(x => x.id === nodeForm.nodeId);
      if (n) {
        if (nodeForm.custom) {
          await supabase.from('net_custom_nodes').update({ kind: f.kind, label: f.label, ip: f.ip || null, note: f.note || null }).eq('id', n.id);
          setNodes(nds => nds.map(x => x.id === n.id ? { ...x, data: { ...x.data, kind: f.kind, label: f.label, ip: f.ip, note: f.note } } : x));
        } else {
          const updated = { ...n, data: { ...n.data, kind: f.kind, _kindOverride: f.kind } };
          await saveServiceOverride(n.id, overridePatch(updated));
          setNodes(nds => nds.map(x => x.id === n.id ? updated : x));
        }
      }
    }
    setSaving(false);
    setNodeForm(null);
  };

  const deleteCustomNode = async () => {
    const id = nodeForm?.nodeId;
    if (!id) return;
    setSaving(true);
    await supabase.from('net_edges').delete().or(`source_id.eq.${id},target_id.eq.${id}`);
    await supabase.from('net_custom_nodes').delete().eq('id', id);
    setNodes(nds => nds.filter(n => n.id !== id));
    setEdges(eds => eds.filter(e => e.source !== id && e.target !== id));
    setSaving(false);
    setNodeForm(null);
  };

  const toggleCritical = async (nodeId: string) => {
    const n = nodes.find(x => x.id === nodeId);
    if (!n) return;
    const updated = { ...n, data: { ...n.data, critical: !(n.data as DeviceNodeData).critical } };
    setNodes(nds => nds.map(x => x.id === nodeId ? updated : x));
    if (!(n.data as DeviceNodeData).custom) await saveServiceOverride(nodeId, overridePatch(updated));
  };

  // ── Exportar PNG ───────────────────────────────────────────
  const exportPng = async () => {
    const viewport = wrapperRef.current?.querySelector('.react-flow__viewport') as HTMLElement | null;
    if (!viewport) return;
    setExporting(true);
    try {
      const bounds = getNodesBounds(getNodes());
      const pad = 60;
      const titleH = 80;
      const width = Math.ceil(bounds.width + pad * 2);
      const height = Math.ceil(bounds.height + pad * 2);
      const vp = getViewportForBounds(bounds, width, height, 0.5, 2, 0.08);
      const dataUrl = await toPng(viewport, {
        backgroundColor: '#ffffff',
        width, height, pixelRatio: 2,
        style: { width: `${width}px`, height: `${height}px`, transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})` },
        filter: el => !(el instanceof HTMLElement && el.classList.contains('react-flow__handle')),
      });
      // Agregar el título del site arriba, como en el diagrama de referencia
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height + titleH * 2;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#0f172a';
      ctx.font = `600 ${56}px ${FONT}`;
      ctx.fillText(siteName ?? '', 60, 100);
      ctx.drawImage(img, 0, titleH * 2);
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = `red-${(siteName ?? 'diagrama').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
      a.click();
    } finally {
      setExporting(false);
    }
  };

  const toggleEdit = () => {
    const next = !editMode;
    setEditMode(next);
    setNodes(nds => withEditing(nds, next));
  };

  const contextNode = contextMenu ? nodes.find(n => n.id === contextMenu.nodeId) : null;
  const btn = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors';

  return (
    <div ref={wrapperRef} className="w-full h-[calc(100vh-150px)] bg-white relative rounded-xl overflow-hidden border border-slate-200">
      {/* Título del site */}
      <div className="absolute top-4 left-5 z-10 pointer-events-none">
        <h2 className="text-2xl font-semibold text-slate-900" style={{ fontFamily: FONT }}>{siteName}</h2>
      </div>

      {/* Toolbar */}
      <div className="absolute top-4 right-4 z-10 flex flex-wrap justify-end items-center gap-2 max-w-[70%]">
        {saving && <span className="text-[11px] text-slate-500 bg-white px-2.5 py-1.5 rounded-lg border border-slate-200">Guardando…</span>}
        {editMode && (
          <>
            <button onClick={() => setNodeForm({ custom: true, initial: { kind: 'internet', label: 'Internet', ip: '', note: '' } })}
              className={`${btn} bg-white border-slate-200 text-slate-700 hover:bg-slate-50`}>
              <Cloud className="w-3.5 h-3.5" /> Nube / ISP
            </button>
            <button onClick={() => setNodeForm({ custom: true, initial: { kind: 'switch', label: '', ip: '', note: '' } })}
              className={`${btn} bg-white border-slate-200 text-slate-700 hover:bg-slate-50`}>
              <Plus className="w-3.5 h-3.5" /> Equipo
            </button>
          </>
        )}
        {onRefresh && (
          <button onClick={onRefresh} className={`${btn} bg-white border-slate-200 text-slate-700 hover:bg-slate-50`}>
            <RefreshCw className="w-3.5 h-3.5" /> Actualizar
          </button>
        )}
        <button onClick={exportPng} disabled={exporting} className={`${btn} bg-white border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50`}>
          <Download className="w-3.5 h-3.5" /> {exporting ? 'Exportando…' : 'PNG'}
        </button>
        <button onClick={toggleEdit}
          className={`${btn} ${editMode ? 'bg-sky-600 border-sky-600 text-white' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
          {editMode ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
          {editMode ? 'Editando' : 'Bloqueado'}
        </button>
      </div>

      {editMode && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 text-[11px] text-slate-600 bg-white/95 px-3 py-1.5 rounded-lg border border-slate-200 pointer-events-none text-center">
          Arrastrá para mover · Uní los puntos azules para enlazar · Doble clic en un equipo o enlace para editarlo
        </div>
      )}

      <TopologyLegend />

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        onEdgesDelete={onEdgesDelete}
        onNodeContextMenu={(e, n) => { if (!editMode) return; e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, nodeId: n.id }); }}
        onNodeDoubleClick={(_, n) => { if (editMode) openNodeEditor(n.id); }}
        onEdgeDoubleClick={(_, e) => { if (editMode) setEditingEdge(e); }}
        nodesDraggable={editMode}
        nodesConnectable={editMode}
        connectionMode={ConnectionMode.Loose}
        connectOnClick={false}
        deleteKeyCode={editMode ? 'Delete' : null}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.2}
        proOptions={{ hideAttribution: true }}
      >
        {editMode && <Background color="#e2e8f0" gap={20} size={1} variant={BackgroundVariant.Dots} />}
        <Controls showInteractive={false} className="!shadow-sm" />
      </ReactFlow>

      {pendingConn && (
        <EdgeModal
          sourceName={nodeName(pendingConn.source)}
          targetName={nodeName(pendingConn.target)}
          onSave={createEdge}
          onCancel={() => setPendingConn(null)}
        />
      )}
      {editingEdge && (
        <EdgeModal
          initial={editingEdge.data as StoredEdgeStyle}
          sourceName={nodeName(editingEdge.source)}
          targetName={nodeName(editingEdge.target)}
          onSave={v => updateEdge(editingEdge, v)}
          onDelete={() => deleteEdge(editingEdge)}
          onCancel={() => setEditingEdge(null)}
        />
      )}
      {nodeForm && (
        <NodeModal
          initial={nodeForm.initial}
          custom={nodeForm.custom}
          onSave={saveNode}
          onDelete={nodeForm.custom && nodeForm.nodeId ? deleteCustomNode : undefined}
          onCancel={() => setNodeForm(null)}
        />
      )}
      {contextMenu && contextNode && (
        <NodeContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          isCritical={!!(contextNode.data as DeviceNodeData).critical}
          onEdit={() => openNodeEditor(contextMenu.nodeId)}
          onToggleCritical={() => toggleCritical(contextMenu.nodeId)}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

export function TopologyCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
