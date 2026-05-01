import { useState, useRef } from 'react';
import { X, Upload, AlertCircle, CheckCircle, FileText, Download } from 'lucide-react';
import { supabase, Client } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

type Props = {
  onClose: () => void;
  onSuccess: () => void;
  clients: Client[];
};

type ParsedService = {
  client_name: string;
  name: string;
  service_type: string;
  status: string;
  price: string;
  currency: string;
  billing_cycle: string;
  provider: string;
  server_ip: string;
  infrastructure_type: string;
  cloud_provider: string;
  cloud_account_payer: string;
  confirmed_hours_monthly: string;
  location: string;
  next_renewal_date: string;
  description: string;
  error?: string;
};

const CSV_HEADERS = [
  'client_name',
  'name',
  'service_type',
  'status',
  'price',
  'currency',
  'billing_cycle',
  'provider',
  'server_ip',
  'infrastructure_type',
  'cloud_provider',
  'cloud_account_payer',
  'confirmed_hours_monthly',
  'location',
  'next_renewal_date',
  'description',
];

const EXAMPLE_CSV = `client_name,name,service_type,status,price,currency,billing_cycle,provider,server_ip,infrastructure_type,cloud_provider,cloud_account_payer,confirmed_hours_monthly,location,next_renewal_date,description
Acme Corp,Production Web Server,VPS,Active,50,USD,Monthly,AWS,54.12.34.56,Cloud,AWS,Acme Corp,720,us-east-1,2026-06-01,Main web server
Acme Corp,File Server,Other,Active,0,USD,Monthly,,192.168.1.10,Physical,,,160,Server Room A,,Internal file server with backups
Beta Inc,Domain - beta.com,Domain,Active,15,USD,Annually,Namecheap,,Cloud,,,, ,2026-12-01,Primary domain`;

function parseCSV(text: string): ParsedService[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const rows: ParsedService[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCSVLine(line);
    const row: any = {};
    headers.forEach((h, idx) => {
      row[h] = (values[idx] || '').trim();
    });

    if (!row.client_name || !row.name) {
      rows.push({ ...row, error: 'Missing required fields: client_name, name' });
      continue;
    }

    rows.push(row as ParsedService);
  }

  return rows;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      inQuotes = !inQuotes;
    } else if (line[i] === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += line[i];
    }
  }
  result.push(current);
  return result;
}

export function ImportModal({ onClose, onSuccess, clients }: Props) {
  const { user } = useAuth();
  const [rawText, setRawText] = useState('');
  const [parsed, setParsed] = useState<ParsedService[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ success: number; failed: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setRawText(text);
      setParsed(parseCSV(text));
    };
    reader.readAsText(file);
  };

  const handleTextChange = (text: string) => {
    setRawText(text);
    if (text.trim()) {
      setParsed(parseCSV(text));
    } else {
      setParsed([]);
    }
  };

  const downloadExample = () => {
    const blob = new Blob([EXAMPLE_CSV], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'import_example.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const getOrCreateServiceType = async (typeName: string): Promise<string | null> => {
    const normalized = typeName?.trim() || 'Other';
    const { data: existing } = await supabase
      .from('service_types')
      .select('id')
      .eq('name', normalized)
      .maybeSingle();

    if (existing) return existing.id;

    const { data: created } = await supabase
      .from('service_types')
      .insert({ name: normalized, description: normalized })
      .select('id')
      .maybeSingle();

    return created?.id || null;
  };

  const getOrCreateClient = async (clientName: string): Promise<string | null> => {
    const existing = clients.find(c =>
      c.company_name.toLowerCase() === clientName.toLowerCase()
    );
    if (existing) return existing.id;

    const { data: created } = await supabase
      .from('clients')
      .insert({
        user_id: user!.id,
        company_name: clientName,
        contact_name: clientName,
        email: `import-${Date.now()}@placeholder.local`,
        status: 'Active',
      })
      .select('id')
      .maybeSingle();

    return created?.id || null;
  };

  const handleImport = async () => {
    const valid = parsed.filter(r => !r.error);
    if (valid.length === 0) return;

    setImporting(true);
    let success = 0;
    let failed = 0;

    for (const row of valid) {
      try {
        const clientId = await getOrCreateClient(row.client_name);
        const serviceTypeId = await getOrCreateServiceType(row.service_type);

        if (!clientId || !serviceTypeId) {
          failed++;
          continue;
        }

        const infraType = ['Cloud', 'Physical', 'Managed Service'].includes(row.infrastructure_type)
          ? row.infrastructure_type
          : 'Cloud';

        const { error } = await supabase.from('services').insert({
          user_id: user!.id,
          client_id: clientId,
          service_type_id: serviceTypeId,
          name: row.name,
          description: row.description || null,
          status: ['Active', 'Suspended', 'Cancelled', 'Pending'].includes(row.status) ? row.status : 'Active',
          price: parseFloat(row.price) || 0,
          currency: row.currency || 'USD',
          billing_cycle: ['Monthly', 'Quarterly', 'Semi-Annually', 'Annually', 'Biennially', 'One-Time'].includes(row.billing_cycle)
            ? row.billing_cycle : 'Monthly',
          provider: row.provider || null,
          server_ip: row.server_ip || null,
          infrastructure_type: infraType,
          cloud_provider: row.cloud_provider || null,
          cloud_account_payer: row.cloud_account_payer || null,
          confirmed_hours_monthly: row.confirmed_hours_monthly ? parseFloat(row.confirmed_hours_monthly) : null,
          location: row.location || null,
          next_renewal_date: row.next_renewal_date || null,
        });

        if (error) failed++;
        else success++;
      } catch {
        failed++;
      }
    }

    setImporting(false);
    setImportResult({ success, failed });

    if (success > 0) {
      setTimeout(() => {
        onSuccess();
      }, 1500);
    }
  };

  const validCount = parsed.filter(r => !r.error).length;
  const errorCount = parsed.filter(r => r.error).length;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">Import Services from CSV</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-600">
              Upload a CSV file or paste CSV/tab-separated text below. New clients will be created automatically.
            </p>
            <button
              onClick={downloadExample}
              className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              <Download className="w-4 h-4" />
              Download Example CSV
            </button>
          </div>

          <div className="flex gap-4">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2 border-2 border-dashed border-gray-300 hover:border-blue-400 rounded-lg text-sm text-gray-600 hover:text-blue-600 transition-colors"
            >
              <Upload className="w-4 h-4" />
              Upload CSV File
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt"
              className="hidden"
              onChange={handleFileUpload}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Or paste CSV text
            </label>
            <textarea
              value={rawText}
              onChange={e => handleTextChange(e.target.value)}
              rows={8}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg font-mono text-xs focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none"
              placeholder={`client_name,name,service_type,status,price,...\nAcme Corp,Web Server,VPS,Active,50,...`}
            />
          </div>

          <div className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3">
            <span className="font-medium">Required columns:</span> client_name, name
            <span className="mx-2">|</span>
            <span className="font-medium">Optional:</span> {CSV_HEADERS.filter(h => !['client_name', 'name'].includes(h)).join(', ')}
          </div>

          {parsed.length > 0 && (
            <div>
              <div className="flex items-center gap-4 mb-3">
                {validCount > 0 && (
                  <div className="flex items-center gap-2 text-sm text-green-700">
                    <CheckCircle className="w-4 h-4" />
                    {validCount} row{validCount !== 1 ? 's' : ''} ready to import
                  </div>
                )}
                {errorCount > 0 && (
                  <div className="flex items-center gap-2 text-sm text-red-600">
                    <AlertCircle className="w-4 h-4" />
                    {errorCount} row{errorCount !== 1 ? 's' : ''} with errors (will be skipped)
                  </div>
                )}
              </div>

              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="overflow-x-auto max-h-48">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-3 py-2 text-left text-gray-600">Status</th>
                        <th className="px-3 py-2 text-left text-gray-600">Client</th>
                        <th className="px-3 py-2 text-left text-gray-600">Service Name</th>
                        <th className="px-3 py-2 text-left text-gray-600">Type</th>
                        <th className="px-3 py-2 text-left text-gray-600">Price</th>
                        <th className="px-3 py-2 text-left text-gray-600">Infrastructure</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {parsed.map((row, i) => (
                        <tr key={i} className={row.error ? 'bg-red-50' : 'bg-white'}>
                          <td className="px-3 py-2">
                            {row.error ? (
                              <span className="text-red-600 flex items-center gap-1">
                                <AlertCircle className="w-3 h-3" /> Error
                              </span>
                            ) : (
                              <span className="text-green-600 flex items-center gap-1">
                                <CheckCircle className="w-3 h-3" /> OK
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-gray-900">{row.client_name}</td>
                          <td className="px-3 py-2 text-gray-900">{row.name}</td>
                          <td className="px-3 py-2 text-gray-600">{row.service_type}</td>
                          <td className="px-3 py-2 text-gray-600">{row.price} {row.currency}</td>
                          <td className="px-3 py-2 text-gray-600">{row.infrastructure_type || 'Cloud'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {importResult && (
            <div className={`p-4 rounded-lg flex items-center gap-3 ${
              importResult.failed === 0 ? 'bg-green-50 border border-green-200' : 'bg-amber-50 border border-amber-200'
            }`}>
              {importResult.failed === 0
                ? <CheckCircle className="w-5 h-5 text-green-600" />
                : <AlertCircle className="w-5 h-5 text-amber-600" />
              }
              <span className="text-sm font-medium">
                {importResult.success} imported successfully
                {importResult.failed > 0 && `, ${importResult.failed} failed`}
              </span>
            </div>
          )}
        </div>

        <div className="flex gap-3 p-6 border-t border-gray-200">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={validCount === 0 || importing || !!importResult}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <FileText className="w-4 h-4" />
            {importing ? 'Importing...' : `Import ${validCount} Service${validCount !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
