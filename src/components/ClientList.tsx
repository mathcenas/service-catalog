import { useState } from 'react';
import { Mail, Phone, MapPin, CreditCard as Edit2, Trash2, Building2, Share2 } from 'lucide-react';
import { Client, supabase } from '../lib/supabase';
import { EditClientModal } from './EditClientModal';
import { ShareTokenModal } from './ShareTokenModal';

type Props = {
  clients: Client[];
  onUpdate: () => void;
};

export function ClientList({ clients, onUpdate }: Props) {
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [sharingClient, setSharingClient] = useState<Client | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this client? This will also delete all associated services.')) {
      return;
    }

    setDeletingId(id);
    await supabase.from('clients').delete().eq('id', id);
    setDeletingId(null);
    onUpdate();
  };

  if (clients.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
        <Building2 className="w-12 h-12 text-gray-400 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-900 mb-2">No clients yet</h3>
        <p className="text-gray-600">Get started by adding your first client.</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {clients.map(client => (
          <div key={client.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow">
            <div className="flex justify-between items-start mb-4">
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900 mb-1">{client.company_name}</h3>
                <p className="text-sm text-gray-600">{client.contact_name}</p>
              </div>
              <span className={`px-3 py-1 text-xs font-medium rounded-full ${
                client.status === 'Active' ? 'bg-green-100 text-green-800' :
                client.status === 'Inactive' ? 'bg-gray-100 text-gray-800' :
                'bg-yellow-100 text-yellow-800'
              }`}>
                {client.status}
              </span>
            </div>

            <div className="space-y-2 mb-4">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Mail className="w-4 h-4" />
                <span className="truncate">{client.email}</span>
              </div>
              {client.phone && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Phone className="w-4 h-4" />
                  <span>{client.phone}</span>
                </div>
              )}
              {client.address && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <MapPin className="w-4 h-4" />
                  <span className="truncate">{client.address}</span>
                </div>
              )}
            </div>

            {client.notes && (
              <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-700 line-clamp-2">{client.notes}</p>
              </div>
            )}

            <div className="flex gap-2 pt-4 border-t border-gray-100">
              <button
                onClick={() => setEditingClient(client)}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
              >
                <Edit2 className="w-4 h-4" />
                Edit
              </button>
              <button
                onClick={() => setSharingClient(client)}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-teal-600 hover:bg-teal-50 rounded-lg transition-colors"
              >
                <Share2 className="w-4 h-4" />
                Share
              </button>
              <button
                onClick={() => handleDelete(client.id)}
                disabled={deletingId === client.id}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" />
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {editingClient && (
        <EditClientModal
          client={editingClient}
          onClose={() => setEditingClient(null)}
          onSuccess={() => {
            setEditingClient(null);
            onUpdate();
          }}
        />
      )}

      {sharingClient && (
        <ShareTokenModal
          client={sharingClient}
          onClose={() => setSharingClient(null)}
        />
      )}
    </>
  );
}
