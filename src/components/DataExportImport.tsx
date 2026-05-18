import { useState, useRef } from 'react';
import { Download, Upload, CheckCircle2, AlertTriangle, FileJson } from 'lucide-react';
import { supabase, Client, Service, ServiceHeartbeat } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

type Props = {
  clients: Client[];
  services: Service[];
  onRefresh: () => void;
};

type ExportPayload = {
  exported_at: string;
  version: '1.0';
  clients: Client[];
  services: Service[];
  heartbeats: ServiceHeartbeat[];
};

export function DataExportImport({ clients, services, onRefresh }: Props) {
  const { user } = useAuth();
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const exportAll = async () => {
    const { data: heartbeats } = await supabase
      .from('service_heartbeats')
      .select('*')
      .order('received_at', { ascending: false })
      .limit(500);

    const payload: ExportPayload = {
      exported_at: new Date().toISOString(),
      version: '1.0',
      clients,
      services,
      heartbeats: heartbeats || [],
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `client-manager-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setResult({ type: 'success', message: `Exported ${clients.length} clients, ${services.length} services, ${(heartbeats || []).length} heartbeats.` });
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setResult(null);

    try {
      const text = await file.text();
      const data: ExportPayload = JSON.parse(text);

      if (!data.version || !data.clients || !data.services) {
        throw new Error('Invalid export file format. Missing required fields.');
      }

      let clientsImported = 0;
      let servicesImported = 0;

      for (const client of data.clients) {
        const { id, created_at, updated_at, ...rest } = client;
        const { error } = await supabase.from('clients').upsert({
          ...rest,
          id,
          user_id: user!.id,
          created_at,
          updated_at,
        }, { onConflict: 'id' });
        if (!error) clientsImported++;
      }

      for (const service of data.services) {
        const { id, created_at, updated_at, ...rest } = service;
        const { error } = await supabase.from('services').upsert({
          ...rest,
          id,
          user_id: user!.id,
          created_at,
          updated_at,
        }, { onConflict: 'id' });
        if (!error) servicesImported++;
      }

      setResult({
        type: 'success',
        message: `Imported ${clientsImported} clients, ${servicesImported} services.`,
      });
      onRefresh();
    } catch (err: any) {
      setResult({ type: 'error', message: err.message || 'Failed to parse import file.' });
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Data Export / Import</h2>
        <p className="text-sm text-gray-600 mt-1">Export your full dataset as JSON for backup or migration. Import from a previous export to restore data.</p>
      </div>

      {result && (
        <div className={`flex items-start gap-3 p-4 rounded-lg border ${
          result.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'
        }`}>
          {result.type === 'success' ? <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" /> : <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />}
          <p className="text-sm font-medium">{result.message}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="bg-blue-100 p-2.5 rounded-lg">
              <Download className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Export</h3>
              <p className="text-xs text-gray-500">Download all data as JSON</p>
            </div>
          </div>
          <div className="space-y-3 text-sm text-gray-600 mb-6">
            <div className="flex justify-between py-2 border-b border-gray-100">
              <span>Clients</span>
              <span className="font-medium text-gray-900">{clients.length}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-100">
              <span>Services</span>
              <span className="font-medium text-gray-900">{services.length}</span>
            </div>
            <div className="flex justify-between py-2">
              <span>Heartbeats (latest 500)</span>
              <span className="font-medium text-gray-400">included</span>
            </div>
          </div>
          <button onClick={exportAll}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">
            <Download className="w-4 h-4" /> Export JSON
          </button>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="bg-amber-100 p-2.5 rounded-lg">
              <Upload className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Import</h3>
              <p className="text-xs text-gray-500">Restore from a JSON export</p>
            </div>
          </div>
          <div className="space-y-3 text-sm text-gray-600 mb-6">
            <p>Upload a previously exported <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">.json</code> file. Existing records with the same ID will be updated (upsert).</p>
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <span className="text-xs text-amber-800">This will overwrite existing data for matching IDs. Make an export first as backup.</span>
            </div>
          </div>
          <label className={`w-full flex items-center justify-center gap-2 border-2 border-dashed rounded-lg px-4 py-2.5 text-sm font-medium transition-colors cursor-pointer ${
            importing ? 'border-gray-200 text-gray-400 pointer-events-none' : 'border-gray-300 hover:border-blue-400 text-gray-700 hover:text-blue-600'
          }`}>
            <FileJson className="w-4 h-4" />
            {importing ? 'Importing...' : 'Select JSON File'}
            <input ref={fileRef} type="file" accept=".json" onChange={handleImport} className="hidden" disabled={importing} />
          </label>
        </div>
      </div>
    </div>
  );
}
