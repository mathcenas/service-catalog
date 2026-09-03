import { useEffect, useState } from 'react';
import { X, Copy, Check, Download, FileText } from 'lucide-react';
import { supabase, Client, Service, Project, RoadmapItem, ClientLicense } from '../lib/supabase';

type Props = {
  client: Client;
  onClose: () => void;
};

function fmt(date?: string) {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('es-UY');
}

function generateText(
  client: Client,
  services: Service[],
  projects: Project[],
  roadmap: RoadmapItem[],
  licenses: ClientLicense[],
): string {
  const lines: string[] = [];
  const now = new Date().toLocaleDateString('es-UY', { day: '2-digit', month: '2-digit', year: 'numeric' });

  lines.push(`FICHA DE CLIENTE — ${client.company_name.toUpperCase()}`);
  lines.push(`Generado: ${now}`);
  lines.push('='.repeat(60));
  lines.push('');

  // ── Datos generales
  lines.push('DATOS GENERALES');
  lines.push('-'.repeat(40));
  lines.push(`Empresa:   ${client.company_name}`);
  lines.push(`Contacto:  ${client.contact_name || '—'}`);
  lines.push(`Email:     ${client.email || '—'}`);
  if (client.alt_email) lines.push(`Alt email: ${client.alt_email}`);
  if (client.phone)     lines.push(`Teléfono:  ${client.phone}`);
  if (client.address)   lines.push(`Dirección: ${client.address}`);
  lines.push(`Estado:    ${client.status}`);
  if (client.notes) {
    lines.push('');
    lines.push(`Notas: ${client.notes}`);
  }
  lines.push('');

  // ── Servicios activos
  const activeServices = services.filter(s => s.status === 'Active');
  lines.push(`SERVICIOS ACTIVOS (${activeServices.length})`);
  lines.push('-'.repeat(40));
  if (activeServices.length === 0) {
    lines.push('Sin servicios activos.');
  } else {
    for (const s of activeServices) {
      lines.push(`• ${s.name}`);
      if (s.provider)            lines.push(`  Proveedor:   ${s.provider}`);
      if (s.infrastructure_type) lines.push(`  Tipo:        ${s.infrastructure_type}`);
      if (s.server_ip)           lines.push(`  IP:          ${s.server_ip}`);
      if (s.reverse_proxy_domain) lines.push(`  Dominio:     ${s.reverse_proxy_domain}`);
      if (s.next_renewal_date)   lines.push(`  Renovación:  ${fmt(s.next_renewal_date)}`);
      if (s.managed_roles?.length) lines.push(`  Roles:       ${s.managed_roles.join(', ')}`);
      if (s.price > 0)           lines.push(`  Precio:      ${s.currency} ${s.price} / ${s.billing_cycle}`);
      if (s.description)         lines.push(`  Descripción: ${s.description}`);
    }
  }
  lines.push('');

  // ── Licencias
  if (licenses.length > 0) {
    lines.push(`LICENCIAS (${licenses.length})`);
    lines.push('-'.repeat(40));
    for (const l of licenses) {
      lines.push(`• ${l.software_name} — ${l.quantity} ${l.quantity_label}`);
      if (l.expiration_date) lines.push(`  Vence: ${fmt(l.expiration_date)}`);
      if (l.notes)           lines.push(`  Notas: ${l.notes}`);
    }
    lines.push('');
  }

  // ── Proyectos
  const activeProjects = projects.filter(p => p.status === 'Active' || p.status === 'On Hold');
  if (activeProjects.length > 0) {
    lines.push(`PROYECTOS (${activeProjects.length})`);
    lines.push('-'.repeat(40));
    for (const p of activeProjects) {
      lines.push(`• [${p.status}] ${p.name}`);
      if (p.description) lines.push(`  ${p.description}`);
    }
    lines.push('');
  }

  // ── Roadmap pendiente
  const pending = roadmap.filter(r => r.status !== 'Released');
  if (pending.length > 0) {
    lines.push(`ROADMAP PENDIENTE (${pending.length})`);
    lines.push('-'.repeat(40));
    for (const r of pending) {
      lines.push(`• [${r.status}] ${r.title}`);
      if (r.eta)         lines.push(`  ETA: ${fmt(r.eta)}`);
      if (r.description) lines.push(`  ${r.description}`);
    }
    lines.push('');
  }

  lines.push('='.repeat(60));
  return lines.join('\n');
}

export function ClientBriefModal({ client, onClose }: Props) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      const [
        { data: services },
        { data: projects },
        { data: roadmap },
        { data: licenses },
      ] = await Promise.all([
        supabase.from('services').select('*').eq('client_id', client.id).order('name'),
        supabase.from('projects').select('*').eq('client_id', client.id).order('name'),
        supabase.from('roadmap_items').select('*').eq('client_id', client.id).order('sort_order'),
        supabase.from('client_licenses').select('*').eq('client_id', client.id).order('software_name'),
      ]);
      setText(generateText(
        client,
        services ?? [],
        projects ?? [],
        roadmap ?? [],
        licenses ?? [],
      ));
      setLoading(false);
    })();
  }, [client]);

  function handleCopy() {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function handleDownload() {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${client.company_name.replace(/\s+/g, '_')}_resumen.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-600" />
            <h2 className="font-semibold text-gray-900">Resumen — {client.company_name}</h2>
          </div>
          <div className="flex items-center gap-2">
            {!loading && (
              <>
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 transition-colors"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copiado' : 'Copiar'}
                </button>
                <button
                  onClick={handleDownload}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Descargar
                </button>
              </>
            )}
            <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-400">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-5">
          {loading ? (
            <p className="text-sm text-gray-400 text-center py-10">Cargando datos…</p>
          ) : (
            <pre className="text-xs font-mono text-gray-700 whitespace-pre-wrap leading-5 bg-gray-50 rounded-lg p-4 border border-gray-100">
              {text}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
