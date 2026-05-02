import { useState, useEffect } from 'react';
import { Server, CreditCard as Edit2, Trash2, Calendar, DollarSign, ExternalLink } from 'lucide-react';
import { Service, Client, ServiceType, Project, supabase } from '../lib/supabase';
import { EditServiceModal } from './EditServiceModal';

type Props = {
  services: Service[];
  clients: Client[];
  projects: Project[];
  onUpdate: () => void;
};

export function ServiceList({ services, clients, projects, onUpdate }: Props) {
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);

  useEffect(() => {
    const fetchServiceTypes = async () => {
      const { data } = await supabase.from('service_types').select('*');
      setServiceTypes(data || []);
    };
    fetchServiceTypes();
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this service?')) {
      return;
    }

    setDeletingId(id);
    await supabase.from('services').delete().eq('id', id);
    setDeletingId(null);
    onUpdate();
  };

  const getClientName = (clientId: string) => {
    const client = clients.find(c => c.id === clientId);
    return client?.company_name || 'Unknown';
  };

  const getServiceTypeName = (typeId: string) => {
    const type = serviceTypes.find(t => t.id === typeId);
    return type?.name || 'Unknown';
  };

  const getProjectName = (projectId?: string) => {
    if (!projectId) return null;
    return projects.find(p => p.id === projectId)?.name || null;
  };

  const isExpiringSoon = (date?: string) => {
    if (!date) return false;
    const renewalDate = new Date(date);
    const today = new Date();
    const thirtyDaysFromNow = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
    return renewalDate >= today && renewalDate <= thirtyDaysFromNow;
  };

  if (services.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
        <Server className="w-12 h-12 text-gray-400 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-900 mb-2">No services yet</h3>
        <p className="text-gray-600">Get started by adding your first service.</p>
      </div>
    );
  }

  return (
    <>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Service</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Client</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Price</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Renewal</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-700 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {services.map(service => (
                <tr key={service.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="bg-blue-100 p-2 rounded-lg">
                        <Server className="w-4 h-4 text-blue-600" />
                      </div>
                      <div>
                        <div className="font-medium text-gray-900">{service.name}</div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {service.provider && (
                            <span className="text-xs text-gray-500">{service.provider}</span>
                          )}
                          {service.infrastructure_type && (
                            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                              service.infrastructure_type === 'Cloud' ? 'bg-sky-100 text-sky-700' :
                              service.infrastructure_type === 'Physical' ? 'bg-stone-100 text-stone-700' :
                              'bg-teal-100 text-teal-700'
                            }`}>
                              {service.infrastructure_type}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    <div>{getClientName(service.client_id)}</div>
                    {getProjectName(service.project_id) && (
                      <div className="text-xs text-blue-600 mt-0.5">{getProjectName(service.project_id)}</div>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    {getServiceTypeName(service.service_type_id)}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1 text-sm">
                      <DollarSign className="w-4 h-4 text-gray-500" />
                      <span className="font-medium text-gray-900">{service.price}</span>
                      <span className="text-gray-600">/ {service.billing_cycle}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    {service.next_renewal_date ? (
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-gray-500" />
                        <span className={`text-sm ${isExpiringSoon(service.next_renewal_date) ? 'text-amber-600 font-medium' : 'text-gray-900'}`}>
                          {new Date(service.next_renewal_date).toLocaleDateString()}
                        </span>
                      </div>
                    ) : (
                      <span className="text-sm text-gray-500">-</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-3 py-1 text-xs font-medium rounded-full ${
                      service.status === 'Active' ? 'bg-green-100 text-green-800' :
                      service.status === 'Suspended' ? 'bg-red-100 text-red-800' :
                      service.status === 'Cancelled' ? 'bg-gray-100 text-gray-800' :
                      'bg-yellow-100 text-yellow-800'
                    }`}>
                      {service.status}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-2">
                      {service.login_url && (
                        <a
                          href={service.login_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="Open login URL"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                      <button
                        onClick={() => setEditingService(service)}
                        className="p-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Edit"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(service.id)}
                        disabled={deletingId === service.id}
                        className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editingService && (
        <EditServiceModal
          service={editingService}
          clients={clients}
          projects={projects}
          onClose={() => setEditingService(null)}
          onSuccess={() => {
            setEditingService(null);
            onUpdate();
          }}
        />
      )}
    </>
  );
}
