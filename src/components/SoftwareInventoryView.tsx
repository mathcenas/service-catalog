import { useState, useRef, useCallback } from 'react';
import { Upload, Download, Monitor, Trash2, ChevronDown, User } from 'lucide-react';
import type { Client } from '../lib/supabase';

// ─── ManageEngine parsing ────────────────────────────────────────────────────

const SKIP_NAMES = new Set([
  'Microsoft.Office.ActionsServer',
  'OfficePushNotificationsUtility',
  'Microsoft Teams Meeting Add-in for Microsoft Office',
  'Microsoft Visual Studio 2010 Tools for Office Runtime (x64)',
  'Paquete de idioma de Microsoft Visual Studio 2010 Tools para Office Runtime (x64) - ESN',
  'Microsoft 365 companion apps',
  'Local AI Manager for Microsoft 365',
]);

const OFFICE_SUITE_PATTERNS = [
  /Microsoft 365 Apps for business/i,
  /Aplicaciones de Microsoft 365 para (negocios|empresas)/i,
  /Microsoft 365 - /i,
  /Microsoft 365 $/i,
  /Microsoft Office Professional Plus/i,
  /Microsoft Office Standard/i,
  /Microsoft Office Profesional Plus/i,
  /LibreOffice/i,
  /WPS Office/i,
];

const COPILOT_PATTERN = /Microsoft 365 Copilot/i;

function classifyRow(name: string): 'suite' | 'copilot' | 'skip' {
  if (SKIP_NAMES.has(name)) return 'skip';
  if (COPILOT_PATTERN.test(name)) return 'copilot';
  for (const p of OFFICE_SUITE_PATTERNS) { if (p.test(name)) return 'suite'; }
  return 'skip';
}

function cleanSuiteName(name: string, version: string): string {
  if (/LibreOffice/i.test(name)) return `LibreOffice ${version}`;
  if (/WPS Office/i.test(name)) return `WPS Office ${version}`;
  if (/Microsoft Office Professional Plus 2010/i.test(name)) return 'Office 2010 Pro Plus';
  if (/Microsoft Office Standard 2013/i.test(name)) return 'Office 2013 Standard';
  if (/Microsoft Office Standard 2016/i.test(name)) return 'Office 2016 Standard';
  if (/Microsoft Office Profesional Plus 2019/i.test(name)) return 'Office 2019 Pro Plus';
  if (/Microsoft Office Professional Plus 2019/i.test(name)) return 'Office 2019 Pro Plus';
  const base = name
    .replace(/Aplicaciones de Microsoft 365 para (negocios|empresas)/i, 'Microsoft 365 Apps')
    .replace(/Microsoft 365 Apps for business/i, 'Microsoft 365 Apps')
    .replace(/Microsoft 365 - [a-z]{2}-[a-z]{2}/i, 'Microsoft 365')
    .replace(/\s+-\s+[a-z]{2}-[a-z]{2}$/i, '')
    .trim();
  const build = version.split('.').slice(0, 2).join('.');
  if (base === 'Microsoft 365 Apps' || base === 'Microsoft 365') return `${base} (${build})`;
  return base;
}

// ─── Entra ID parsing ────────────────────────────────────────────────────────

type EntraDevice = {
  deviceName: string;      // displayName
  owner: string;           // owner
  osVersion: string;       // operatingSystemVersion
  lastSignIn: string;      // approximateLastSignInDateTime
  registered: string;      // registrationDateTime
  isCompliant: boolean | null; // isCompliant
  trustType: string;       // trustType (AzureAd | Workplace | ServerAd)
};

function parseEntraCSV(text: string): EntraDevice[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim());
  const idx = (name: string) => headers.indexOf(name);
  const iDisplayName  = idx('displayName');
  const iOwner        = idx('owner');
  const iOsVer        = idx('operatingSystemVersion');
  const iLastSign     = idx('approximateLastSignInDateTime');
  const iReg          = idx('registrationDateTime');
  const iCompliant    = idx('isCompliant');
  const iTrustType    = idx('trustType');
  if (iDisplayName === -1 || iOwner === -1) return [];

  const devices: EntraDevice[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    const get = (j: number) => (j >= 0 ? (parts[j] ?? '').trim() : '');
    const deviceName = get(iDisplayName);
    const owner      = get(iOwner);
    if (!deviceName) continue;
    const rawCompliant = get(iCompliant).toLowerCase();
    const isCompliant = rawCompliant === 'true' ? true : rawCompliant === 'false' ? false : null;
    devices.push({
      deviceName,
      owner,
      osVersion: get(iOsVer),
      lastSignIn: get(iLastSign),
      registered: get(iReg),
      isCompliant,
      trustType: get(iTrustType),
    });
  }
  return devices;
}

// Decode Entra operatingSystemVersion (e.g. "10.0.26100.3476") to friendly name
function decodeWindowsVersion(ver: string): string {
  if (!ver) return '';
  const m = ver.match(/^10\.0\.(\d+)/);
  if (!m) return ver;
  const build = parseInt(m[1]);
  const patch = ver.split('.')[3] ?? '';
  const suffix = patch ? ` (${build}.${patch})` : ` (${build})`;
  if (build >= 26100) return `Windows 11 24H2${suffix}`;
  if (build >= 22631) return `Windows 11 23H2${suffix}`;
  if (build >= 22621) return `Windows 11 22H2${suffix}`;
  if (build >= 22000) return `Windows 11 21H2${suffix}`;
  if (build >= 19045) return `Windows 10 22H2${suffix}`;
  if (build >= 19044) return `Windows 10 21H2${suffix}`;
  if (build >= 19043) return `Windows 10 21H1${suffix}`;
  if (build >= 19042) return `Windows 10 20H2${suffix}`;
  if (build >= 19041) return `Windows 10 2004${suffix}`;
  if (build >= 18363) return `Windows 10 1909${suffix}`;
  return `Windows 10${suffix}`;
}

// ─── ManageEngine CSV parsing ────────────────────────────────────────────────

type ComputerRow = {
  computer: string;
  os: string;
  suites: string[];
  hasCopilot: boolean;
  loggedOnUser?: string; // from "Currently Logged on Users" column (new ME format)
};

function parseMECSV(text: string): ComputerRow[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim());

  // Detect format by first header value
  const isNewFormat = headers[0] === 'Software Name';
  let iName: number, iVersion: number, iComputer: number, iOs: number, iLoggedOn: number;
  if (isNewFormat) {
    // New: Software Name, Software Version, Computer Name, Normalized Name, Currently Logged on Users
    iName     = 0;
    iVersion  = 1;
    iComputer = 2;
    iOs       = -1; // not present in this format
    iLoggedOn = headers.findIndex(h => h.includes('Currently Logged on Users'));
  } else {
    // Old: Software Version, Software Name, Computer Name, OS, ...
    iVersion  = 0;
    iName     = 1;
    iComputer = 2;
    iOs       = 3;
    iLoggedOn = -1;
  }

  type Entry = { os: string; suiteSet: Map<string, boolean>; hasCopilot: boolean; loggedOnUser: string };
  const computers = new Map<string, Entry>();

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length < 3) continue;
    const get = (j: number) => (j >= 0 && j < parts.length ? parts[j].trim() : '');
    const name     = get(iName);
    const version  = get(iVersion);
    const computer = get(iComputer);
    const os       = get(iOs);
    if (!computer || !name) continue;

    if (!computers.has(computer)) computers.set(computer, { os, suiteSet: new Map(), hasCopilot: false, loggedOnUser: '' });
    const entry = computers.get(computer)!;
    if (!entry.os && os) entry.os = os;

    // Logged on user: take first non-empty, non-"--" value seen
    if (iLoggedOn >= 0 && !entry.loggedOnUser) {
      const raw = get(iLoggedOn);
      if (raw && raw !== '--') entry.loggedOnUser = raw.split(',')[0].trim();
    }

    const kind = classifyRow(name);
    if (kind === 'copilot') entry.hasCopilot = true;
    else if (kind === 'suite') { const label = cleanSuiteName(name, version); entry.suiteSet.set(label, true); }
  }

  return Array.from(computers.entries()).map(([computer, { os, suiteSet, hasCopilot, loggedOnUser }]) => ({
    computer,
    os: os.replace(/\s*\(x64\)/i, '').replace(/Edition/i, '').trim(),
    suites: Array.from(suiteSet.keys()),
    hasCopilot,
    loggedOnUser: loggedOnUser || undefined,
  })).sort((a, b) => a.computer.localeCompare(b.computer));
}

// Auto-detect CSV type by headers
function detectCSVType(text: string): 'managengine' | 'entra' | 'unknown' {
  const firstLine = text.split(/\r?\n/)[0] ?? '';
  if (firstLine.includes('deviceId') && firstLine.includes('displayName')) return 'entra';
  if (firstLine.startsWith('Software Version') || firstLine.startsWith('Software Name,Software Version')) return 'managengine';
  return 'unknown';
}

// ─── Storage ──────────────────────────────────────────────────────────────────

type ImportedFile = {
  id: string;
  clientId: string;
  filename: string;
  importedAt: string;
  type: 'managengine' | 'entra';
  rows: ComputerRow[];         // ManageEngine
  entraDevices?: EntraDevice[]; // Entra
};

const STORAGE_KEY = 'software_inventory_imports';

function loadFromStorage(): ImportedFile[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}
function saveToStorage(data: ImportedFile[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
}

// Build owner lookup: computer name (lowercase) → owner display name
function buildOwnerMap(imports: ImportedFile[], clientId: string): Map<string, string> {
  const map = new Map<string, string>();
  imports
    .filter(f => f.type === 'entra' && f.clientId === clientId)
    .flatMap(f => f.entraDevices ?? [])
    .forEach(d => { if (d.deviceName && d.owner) map.set(d.deviceName.toLowerCase(), d.owner); });
  return map;
}

// ─── PDF export ───────────────────────────────────────────────────────────────

function exportPdf(file: ImportedFile, clientName: string, ownerMap: Map<string, string>) {
  const now = new Date().toLocaleDateString('es-UY', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const hasOwners = ownerMap.size > 0;

  if (file.type === 'entra') {
    // Entra-only export: devices + owners + last sign-in
    const rows = (file.entraDevices ?? [])
      .sort((a, b) => a.deviceName.localeCompare(b.deviceName))
      .map(d => {
        const lastSign = d.lastSignIn ? new Date(d.lastSignIn).toLocaleDateString('es-UY') : '—';
        return `<tr style="border-top:1px solid #f1f5f9;">
          <td style="padding:8px 12px;font-size:12px;font-weight:600;font-family:monospace;color:#1e293b;">${d.deviceName}</td>
          <td style="padding:8px 12px;font-size:12px;color:#374151;">${d.owner || '—'}</td>
          <td style="padding:8px 12px;font-size:12px;color:#374151;">${decodeWindowsVersion(d.osVersion) || d.osVersion || '—'}</td>
          <td style="padding:8px 12px;font-size:12px;color:#64748b;">${lastSign}</td>
        </tr>`;
      }).join('');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Dispositivos Entra — ${clientName}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fff;color:#1e293b;padding:40px}.header{margin-bottom:32px;border-bottom:2px solid #e2e8f0;padding-bottom:20px}.title{font-size:22px;font-weight:700}.subtitle{font-size:13px;color:#64748b;margin-top:4px}table{width:100%;border-collapse:collapse}thead tr{background:#f8fafc}th{padding:8px 12px;text-align:left;font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.4px;border-bottom:1px solid #e2e8f0}.footer{margin-top:28px;font-size:11px;color:#94a3b8}</style></head><body>
<div class="header"><div class="title">Dispositivos Microsoft 365 — ${clientName}</div><div class="subtitle">Generado el ${now} · ${(file.entraDevices ?? []).length} dispositivos · Fuente: Entra ID</div></div>
<table><thead><tr><th>Equipo</th><th>Usuario M365</th><th>Sistema Operativo</th><th>Último acceso</th></tr></thead><tbody>${rows}</tbody></table>
<div class="footer">Reporte generado por Service Catalog</div></body></html>`;
    const win = window.open('', '_blank'); if (!win) return;
    win.document.write(html); win.document.close(); win.print();
    return;
  }

  // ManageEngine export (+ owners if available)
  const rows = file.rows.map(r => {
    const owner = ownerMap.get(r.computer.toLowerCase()) || '';
    return `<tr style="border-top:1px solid #f1f5f9;">
      <td style="padding:8px 12px;font-size:12px;font-weight:600;font-family:monospace;color:#1e293b;">${r.computer}</td>
      ${hasOwners ? `<td style="padding:8px 12px;font-size:12px;color:#374151;">${owner || '<span style="color:#9ca3af;font-style:italic;">—</span>'}</td>` : ''}
      <td style="padding:8px 12px;font-size:12px;color:#374151;">${r.os || '—'}</td>
      <td style="padding:8px 12px;font-size:12px;color:#374151;">${r.suites.length ? r.suites.join('<br>') : '<span style="color:#9ca3af;font-style:italic;">—</span>'}</td>
      <td style="padding:8px 12px;text-align:center;font-size:12px;">${r.hasCopilot ? '<span style="background:#ede9fe;color:#6d28d9;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;">Copilot</span>' : '<span style="color:#d1d5db;">—</span>'}</td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Inventario de Software — ${clientName}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fff;color:#1e293b;padding:40px}.header{margin-bottom:32px;border-bottom:2px solid #e2e8f0;padding-bottom:20px}.title{font-size:22px;font-weight:700}.subtitle{font-size:13px;color:#64748b;margin-top:4px}table{width:100%;border-collapse:collapse}thead tr{background:#f8fafc}th{padding:8px 12px;text-align:left;font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.4px;border-bottom:1px solid #e2e8f0}.footer{margin-top:28px;font-size:11px;color:#94a3b8}</style></head><body>
<div class="header"><div class="title">Inventario de Software — ${clientName}</div><div class="subtitle">Generado el ${now} · ${file.rows.length} equipos · Fuente: ManageEngine${hasOwners ? ' + Entra ID' : ''}</div></div>
<table><thead><tr>
  <th>Equipo</th>${hasOwners ? '<th>Usuario M365</th>' : ''}<th>Sistema Operativo</th><th>Suite Office</th><th style="text-align:center;">Copilot</th>
</tr></thead><tbody>${rows}</tbody></table>
<div class="footer">Reporte generado por Service Catalog</div></body></html>`;

  const win = window.open('', '_blank'); if (!win) return;
  win.document.write(html); win.document.close(); win.print();
}

// ─── Component ────────────────────────────────────────────────────────────────

type Props = { clients: Client[] };

export function SoftwareInventoryView({ clients }: Props) {
  const [imports, setImports] = useState<ImportedFile[]>(loadFromStorage);
  const [filterClient, setFilterClient] = useState<string>('all');
  const [assignClientId, setAssignClientId] = useState<string>('');
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const persist = (data: ImportedFile[]) => { setImports(data); saveToStorage(data); };

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files || !assignClientId) return;
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = e => {
        const text = e.target?.result as string;
        const csvType = detectCSVType(text);
        let entry: ImportedFile;
        if (csvType === 'entra') {
          entry = { id: crypto.randomUUID(), clientId: assignClientId, filename: file.name, importedAt: new Date().toISOString(), type: 'entra', rows: [], entraDevices: parseEntraCSV(text) };
        } else {
          entry = { id: crypto.randomUUID(), clientId: assignClientId, filename: file.name, importedAt: new Date().toISOString(), type: 'managengine', rows: parseMECSV(text) };
        }
        setImports(prev => { const updated = [entry, ...prev]; saveToStorage(updated); return updated; });
      };
      reader.readAsText(file);
    });
  }, [assignClientId]);

  const removeImport = (id: string) => persist(imports.filter(i => i.id !== id));

  const filtered = filterClient === 'all' ? imports : imports.filter(i => i.clientId === filterClient);
  const clientName = (id: string) => clients.find(c => c.id === id)?.company_name ?? id;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-slate-800">Software Inventory</h2>
        <p className="text-sm text-slate-500 mt-0.5">Importá CSVs de ManageEngine y/o Entra ID — se cruzan automáticamente por nombre de equipo</p>
      </div>

      {/* Import area */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
        <h3 className="text-sm font-semibold text-slate-700 mb-1">Importar CSV</h3>
        <p className="text-xs text-slate-400 mb-3">Soporta ManageEngine (software) y Entra ID (dispositivos + usuarios) — se detectan automáticamente</p>
        <div className="flex gap-3 items-end mb-4">
          <div className="flex-1">
            <label className="block text-xs text-slate-500 mb-1">Cliente</label>
            <div className="relative">
              <select
                value={assignClientId}
                onChange={e => setAssignClientId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg appearance-none bg-white pr-8 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Seleccioná un cliente...</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-slate-400 pointer-events-none" />
            </div>
          </div>
          <button
            disabled={!assignClientId}
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Upload className="w-4 h-4" />
            Seleccionar CSV
          </button>
          <input ref={fileRef} type="file" accept=".csv" multiple className="hidden" onChange={e => handleFiles(e.target.files)} />
        </div>
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
          className={`border-2 border-dashed rounded-lg p-6 text-center text-sm transition-colors ${dragOver ? 'border-blue-400 bg-blue-50' : 'border-slate-200 text-slate-400'} ${!assignClientId ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        >
          {assignClientId ? 'O arrastrá los CSV acá (ManageEngine y/o Entra ID)' : 'Seleccioná un cliente primero'}
        </div>
      </div>

      {/* Filter */}
      {imports.length > 0 && (
        <div className="flex items-center gap-3 mb-4">
          <span className="text-sm text-slate-500">Cliente:</span>
          <div className="relative">
            <select value={filterClient} onChange={e => setFilterClient(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 appearance-none bg-white pr-7 focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="all">Todos</option>
              {Array.from(new Set(imports.map(i => i.clientId))).map(id => (
                <option key={id} value={id}>{clientName(id)}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
          </div>
        </div>
      )}

      {filtered.length === 0 && (
        <div className="text-center py-16 text-slate-400">
          <Monitor className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No hay reportes importados todavía</p>
        </div>
      )}

      <div className="space-y-6">
        {filtered.map(file => {
          const ownerMap = buildOwnerMap(imports, file.clientId);
          const hasOwners = ownerMap.size > 0;

          if (file.type === 'entra') {
            const devices = (file.entraDevices ?? []).sort((a, b) => a.deviceName.localeCompare(b.deviceName));
            return (
              <div key={file.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-violet-50">
                  <div className="flex items-center gap-2">
                    <User className="w-3.5 h-3.5 text-violet-500" />
                    <span className="font-semibold text-sm text-slate-800">{clientName(file.clientId)}</span>
                    <span className="text-slate-300 mx-1">·</span>
                    <span className="text-xs bg-violet-100 text-violet-700 font-semibold px-2 py-0.5 rounded-full">Entra ID</span>
                    <span className="text-slate-300 mx-1">·</span>
                    <span className="text-xs text-slate-500 font-mono">{file.filename}</span>
                    <span className="text-slate-300 mx-1">·</span>
                    <span className="text-xs text-slate-400">{devices.length} dispositivos · {new Date(file.importedAt).toLocaleDateString('es-UY')}</span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => exportPdf(file, clientName(file.clientId), ownerMap)}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-slate-200 rounded-lg hover:bg-white text-slate-600 transition-colors">
                      <Download className="w-3.5 h-3.5" /> PDF
                    </button>
                    <button onClick={() => removeImport(file.id)}
                      className="p-1.5 text-slate-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="text-left">
                        <th className="px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wide">Equipo</th>
                        <th className="px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wide">Usuario M365</th>
                        <th className="px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wide">Sistema Operativo</th>
                        <th className="px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wide">Último acceso</th>
                      </tr>
                    </thead>
                    <tbody>
                      {devices.map(d => (
                        <tr key={d.deviceName} className="border-t border-slate-50 hover:bg-slate-50/50">
                          <td className="px-4 py-2.5 font-mono text-sm font-medium text-slate-700">{d.deviceName}</td>
                          <td className="px-4 py-2.5 text-sm text-slate-600">{d.owner || <span className="text-slate-300 italic">—</span>}</td>
                          <td className="px-4 py-2.5 text-sm text-slate-500">{decodeWindowsVersion(d.osVersion) || d.osVersion || '—'}</td>
                          <td className="px-4 py-2.5 text-sm text-slate-400">
                            {d.lastSignIn ? new Date(d.lastSignIn).toLocaleDateString('es-UY') : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          }

          // ManageEngine
          return (
            <div key={file.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-sm text-slate-800">{clientName(file.clientId)}</span>
                  <span className="text-slate-300 mx-1">·</span>
                  <span className="text-xs bg-blue-100 text-blue-700 font-semibold px-2 py-0.5 rounded-full">ManageEngine</span>
                  <span className="text-slate-300 mx-1">·</span>
                  <span className="text-xs text-slate-500 font-mono">{file.filename}</span>
                  <span className="text-slate-300 mx-1">·</span>
                  <span className="text-xs text-slate-400">{file.rows.length} equipos · {new Date(file.importedAt).toLocaleDateString('es-UY')}</span>
                  {hasOwners && <span className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">+ usuarios Entra</span>}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => exportPdf(file, clientName(file.clientId), ownerMap)}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-slate-200 rounded-lg hover:bg-white text-slate-600 transition-colors">
                    <Download className="w-3.5 h-3.5" /> PDF
                  </button>
                  <button onClick={() => removeImport(file.id)}
                    className="p-1.5 text-slate-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              {(() => {
                const hasLoggedOn = file.rows.some(r => r.loggedOnUser);
                return (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="text-left">
                          <th className="px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wide">Equipo</th>
                          {hasLoggedOn && <th className="px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wide">Usuario Windows</th>}
                          {hasOwners && <th className="px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wide">Usuario M365</th>}
                          <th className="px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wide">Sistema Operativo</th>
                          <th className="px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wide">Suite Office</th>
                          <th className="px-4 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wide text-center">Copilot</th>
                        </tr>
                      </thead>
                      <tbody>
                        {file.rows.map(row => {
                          const owner = ownerMap.get(row.computer.toLowerCase());
                          return (
                            <tr key={row.computer} className="border-t border-slate-50 hover:bg-slate-50/50">
                              <td className="px-4 py-2.5 font-mono text-sm font-medium text-slate-700">{row.computer}</td>
                              {hasLoggedOn && (
                                <td className="px-4 py-2.5 text-sm text-slate-600">
                                  {row.loggedOnUser || <span className="text-slate-300 italic text-xs">—</span>}
                                </td>
                              )}
                              {hasOwners && (
                                <td className="px-4 py-2.5 text-sm text-slate-600">
                                  {owner || <span className="text-slate-300 italic text-xs">sin registro</span>}
                                </td>
                              )}
                              <td className="px-4 py-2.5 text-sm text-slate-600">{row.os || <span className="text-slate-300 italic">—</span>}</td>
                              <td className="px-4 py-2.5 text-sm text-slate-600">
                                {row.suites.length > 0 ? row.suites.map((s, i) => <div key={i}>{s}</div>) : <span className="text-slate-300 italic">—</span>}
                              </td>
                              <td className="px-4 py-2.5 text-center">
                                {row.hasCopilot
                                  ? <span className="inline-block bg-violet-100 text-violet-700 text-xs font-semibold px-2 py-0.5 rounded-full">Copilot</span>
                                  : <span className="text-slate-200">—</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>
    </div>
  );
}
