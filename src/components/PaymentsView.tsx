import { useMemo, useState, useEffect } from 'react';
import { CreditCard, Calendar, AlertCircle, Filter, Shield } from 'lucide-react';
import { supabase, Service, Client, ClientLicense, PaidBy } from '../lib/supabase';

type Props = {
  services: Service[];
  clients: Client[];
};

const TABS: { key: PaidBy; label: string; description: string }[] = [
  { key: 'Me', label: 'Paid by Me', description: 'Services you pay for out of pocket — review card charges and renewals.' },
  { key: 'Client', label: 'Paid by Client', description: 'Services billed directly to the client — confirm their card is current.' },
];

type PaymentItem = {
  id: string;
  kind: 'service' | 'license';
  name: string;
  subtitle?: string;
  client_id: string;
  paid_by?: PaidBy;
  payment_card_last4?: string;
  price: number;
  currency: string;
  billing_cycle: string;
  next_renewal_date?: string;
  status: string;
};

function billingCycleMonths(cycle: string): number {
  return cycle === 'Monthly' ? 1
    : cycle === 'Quarterly' ? 3
    : cycle === 'Semi-Annually' ? 6
    : cycle === 'Annually' ? 12
    : cycle === 'Biennially' ? 24
    : 0;
}

function itemMonthlyEquivalent(item: PaymentItem): number {
  const months = billingCycleMonths(item.billing_cycle);
  if (months === 0) return 0;
  return item.price / months;
}

export function PaymentsView({ services, clients }: Props) {
  const [tab, setTab] = useState<PaidBy>('Me');
  const [cardFilter, setCardFilter] = useState<string>('');
  const [licenses, setLicenses] = useState<ClientLicense[]>([]);

  useEffect(() => {
    supabase.from('client_licenses').select('*').then(({ data }) => {
      setLicenses(data || []);
    });
  }, []);

  const allItems: PaymentItem[] = useMemo(() => {
    const fromServices: PaymentItem[] = services.map(s => ({
      id: s.id,
      kind: 'service',
      name: s.name,
      subtitle: s.provider || undefined,
      client_id: s.client_id,
      paid_by: s.paid_by,
      payment_card_last4: s.payment_card_last4,
      price: s.price * (s.confirmed_hours_monthly && s.confirmed_hours_monthly > 0 ? s.confirmed_hours_monthly : 1),
      currency: s.currency,
      billing_cycle: s.billing_cycle,
      next_renewal_date: s.next_renewal_date,
      status: s.status,
    }));
    const fromLicenses: PaymentItem[] = licenses.filter(l => l.cost != null && l.cost > 0).map(l => ({
      id: l.id,
      kind: 'license',
      name: l.software_name,
      subtitle: `${l.quantity} ${l.quantity_label}`,
      client_id: l.client_id,
      paid_by: l.paid_by,
      payment_card_last4: l.payment_card_last4,
      price: l.cost!,
      currency: l.currency || 'USD',
      billing_cycle: l.billing_cycle,
      next_renewal_date: l.expiration_date,
      status: l.expiration_date && new Date(l.expiration_date) < new Date() ? 'Expired' : 'Active',
    }));
    return [...fromServices, ...fromLicenses];
  }, [services, licenses]);

  const { list, totalMonthly, unassignedCount, cards } = useMemo(() => {
    const filtered = allItems.filter(i => i.paid_by === tab);
    const cards = Array.from(new Set(filtered.map(i => i.payment_card_last4).filter((c): c is string => !!c))).sort();
    const list = cardFilter ? filtered.filter(i => i.payment_card_last4 === cardFilter) : filtered;
    const sorted = [...list].sort((a, b) => {
      const ad = a.next_renewal_date ? new Date(a.next_renewal_date).getTime() : Infinity;
      const bd = b.next_renewal_date ? new Date(b.next_renewal_date).getTime() : Infinity;
      return ad - bd;
    });
    const totalMonthly = list.reduce((sum, i) => sum + (i.status === 'Active' ? itemMonthlyEquivalent(i) : 0), 0);
    const unassignedCount = allItems.filter(i => !i.paid_by).length;
    return { list: sorted, totalMonthly, unassignedCount, cards };
  }, [allItems, tab, cardFilter]);

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
              <p className="text-sm text-gray-500">No items match this view yet.</p>
              <p className="text-xs text-gray-400 mt-1">Set "Paid By" on a service or license to populate this page.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-y border-gray-200">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-700 uppercase">Item</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-700 uppercase">Client</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-700 uppercase">Card</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-700 uppercase">Billing</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-700 uppercase">Next Renewal</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-700 uppercase">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {list.map(item => (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {item.kind === 'license' && <Shield className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />}
                          <div>
                            <div className="font-medium text-gray-900 text-sm">{item.name}</div>
                            {item.subtitle && <div className="text-xs text-gray-500">{item.subtitle}</div>}
                          </div>
                          {item.kind === 'license' && (
                            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 font-semibold">License</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">{clientName(item.client_id)}</td>
                      <td className="px-4 py-3">
                        {item.payment_card_last4 ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-gray-100 font-mono text-xs text-gray-800">
                            <CreditCard className="w-3 h-3" />
                            &bull;&bull;&bull;&bull; {item.payment_card_last4}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400 italic">not set</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        <div className="font-medium">{item.currency} {item.price}</div>
                        <div className="text-xs text-gray-500">{item.billing_cycle}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        {item.next_renewal_date ? new Date(item.next_renewal_date).toLocaleDateString() : <span className="text-gray-400">-</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                          item.status === 'Active' ? 'bg-green-100 text-green-800' :
                          item.status === 'Expired' ? 'bg-red-100 text-red-800' :
                          item.status === 'Suspended' ? 'bg-red-100 text-red-800' :
                          item.status === 'Cancelled' ? 'bg-gray-100 text-gray-800' :
                          'bg-yellow-100 text-yellow-800'
                        }`}>
                          {item.status}
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
