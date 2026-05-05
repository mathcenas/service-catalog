import { useMemo, useState } from 'react';
import { CreditCard, Calendar, AlertCircle, Filter } from 'lucide-react';
import { Service, Client, PaidBy } from '../lib/supabase';

type Props = {
  services: Service[];
  clients: Client[];
};

const TABS: { key: PaidBy; label: string; description: string }[] = [
  { key: 'Me', label: 'Paid by Me', description: 'Services you pay for out of pocket — review card charges and renewals.' },
  { key: 'Client', label: 'Paid by Client', description: 'Services billed directly to the client — confirm their card is current.' },
];

function monthlyEquivalent(service: Service): number {
  const m = service.billing_cycle === 'Monthly' ? 1
    : service.billing_cycle === 'Quarterly' ? 1 / 3
    : service.billing_cycle === 'Semi-Annually' ? 1 / 6
    : service.billing_cycle === 'Annually' ? 1 / 12
    : service.billing_cycle === 'Biennially' ? 1 / 24
    : 0;
  return service.price * m;
}

export function PaymentsView({ services, clients }: Props) {
  const [tab, setTab] = useState<PaidBy>('Me');
  const [cardFilter, setCardFilter] = useState<string>('');

  const { list, totalMonthly, unassignedCount, cards } = useMemo(() => {
    const filtered = services.filter(s => s.paid_by === tab);
    const cards = Array.from(new Set(filtered.map(s => s.payment_card_last4).filter((c): c is string => !!c))).sort();
    const list = cardFilter ? filtered.filter(s => s.payment_card_last4 === cardFilter) : filtered;
    const sorted = [...list].sort((a, b) => {
      const ad = a.next_renewal_date ? new Date(a.next_renewal_date).getTime() : Infinity;
      const bd = b.next_renewal_date ? new Date(b.next_renewal_date).getTime() : Infinity;
      return ad - bd;
    });
    const totalMonthly = list.reduce((sum, s) => sum + (s.status === 'Active' ? monthlyEquivalent(s) : 0), 0);
    const unassignedCount = services.filter(s => !s.paid_by).length;
    return { list: sorted, totalMonthly, unassignedCount, cards };
  }, [services, tab, cardFilter]);

  const clientName = (id: string) => clients.find(c => c.id === id)?.company_name || 'Unknown';

  const activeTab = TABS.find(t => t.key === tab)!;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Payments</h2>
        <p className="text-sm text-gray-600 mt-1">Quarterly review of who pays what. Split by payer and filtered by card.</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex border-b border-gray-200">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setCardFilter(''); }}
              className={`flex-1 px-6 py-4 text-left transition-colors ${
                tab === t.key
                  ? 'bg-blue-50 border-b-2 border-blue-600'
                  : 'border-b-2 border-transparent hover:bg-gray-50'
              }`}
            >
              <div className={`font-semibold ${tab === t.key ? 'text-blue-700' : 'text-gray-900'}`}>{t.label}</div>
              <div className="text-xs text-gray-600 mt-0.5">{t.description}</div>
            </button>
          ))}
        </div>

        <div className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard
              label={`Active Services (${activeTab.label})`}
              value={list.filter(s => s.status === 'Active').length.toString()}
              icon={<CreditCard className="w-5 h-5" />}
              tone="blue"
            />
            <StatCard
              label="Monthly Equivalent"
              value={`$${totalMonthly.toFixed(2)}`}
              icon={<Calendar className="w-5 h-5" />}
              tone="emerald"
            />
            <StatCard
              label="Services with no payer set"
              value={unassignedCount.toString()}
              icon={<AlertCircle className="w-5 h-5" />}
              tone={unassignedCount > 0 ? 'amber' : 'gray'}
            />
          </div>

          {cards.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <Filter className="w-4 h-4 text-gray-500" />
              <span className="text-sm text-gray-600">Filter by card:</span>
              <button
                onClick={() => setCardFilter('')}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  cardFilter === '' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-700 hover:border-blue-400'
                }`}
              >
                All
              </button>
              {cards.map(c => (
                <button
                  key={c}
                  onClick={() => setCardFilter(c)}
                  className={`px-3 py-1 rounded-full text-xs font-mono font-medium border transition-colors ${
                    cardFilter === c ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-700 hover:border-blue-400'
                  }`}
                >
                  &bull;&bull;&bull;&bull; {c}
                </button>
              ))}
            </div>
          )}

          {list.length === 0 ? (
            <div className="text-center py-10 border-2 border-dashed border-gray-200 rounded-lg">
              <CreditCard className="w-10 h-10 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">No services match this view yet.</p>
              <p className="text-xs text-gray-400 mt-1">Set "Paid By" on a service in the Services tab to populate this page.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-y border-gray-200">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-700 uppercase">Service</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-700 uppercase">Client</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-700 uppercase">Card</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-700 uppercase">Billing</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-700 uppercase">Next Renewal</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-700 uppercase">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {list.map(s => (
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900 text-sm">{s.name}</div>
                        {s.provider && <div className="text-xs text-gray-500">{s.provider}</div>}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">{clientName(s.client_id)}</td>
                      <td className="px-4 py-3">
                        {s.payment_card_last4 ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-gray-100 font-mono text-xs text-gray-800">
                            <CreditCard className="w-3 h-3" />
                            &bull;&bull;&bull;&bull; {s.payment_card_last4}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400 italic">not set</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        <div className="font-medium">${s.price} {s.currency}</div>
                        <div className="text-xs text-gray-500">{s.billing_cycle}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        {s.next_renewal_date ? new Date(s.next_renewal_date).toLocaleDateString() : <span className="text-gray-400">-</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                          s.status === 'Active' ? 'bg-green-100 text-green-800' :
                          s.status === 'Suspended' ? 'bg-red-100 text-red-800' :
                          s.status === 'Cancelled' ? 'bg-gray-100 text-gray-800' :
                          'bg-yellow-100 text-yellow-800'
                        }`}>
                          {s.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon, tone }: { label: string; value: string; icon: React.ReactNode; tone: 'blue' | 'emerald' | 'amber' | 'gray' }) {
  const toneClass =
    tone === 'blue' ? 'bg-blue-50 text-blue-700' :
    tone === 'emerald' ? 'bg-emerald-50 text-emerald-700' :
    tone === 'amber' ? 'bg-amber-50 text-amber-700' :
    'bg-gray-50 text-gray-700';
  return (
    <div className="border border-gray-200 rounded-lg p-4 flex items-center gap-4">
      <div className={`p-2.5 rounded-lg ${toneClass}`}>{icon}</div>
      <div>
        <div className="text-xs text-gray-600">{label}</div>
        <div className="text-xl font-bold text-gray-900">{value}</div>
      </div>
    </div>
  );
}
