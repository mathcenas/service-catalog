import { useState } from 'react';
import { FolderOpen, CreditCard as Edit2, Trash2, Calendar, Plus, ChevronDown, ChevronRight, Server } from 'lucide-react';
import { Project, Client, Service, ServiceType, supabase } from '../lib/supabase';
import { EditProjectModal } from './EditProjectModal';
import { AddProjectModal } from './AddProjectModal';

type Props = {
  projects: Project[];
  clients: Client[];
  services: Service[];
  serviceTypes: ServiceType[];
  onUpdate: () => void;
};

const STATUS_COLORS: Record<string, string> = {
  Active: 'bg-green-100 text-green-800',
  'On Hold': 'bg-amber-100 text-amber-800',
  Completed: 'bg-blue-100 text-blue-800',
  Cancelled: 'bg-gray-100 text-gray-800',
};

const INFRA_COLORS: Record<string, string> = {
  Cloud: 'bg-sky-100 text-sky-700',
  Physical: 'bg-stone-100 text-stone-700',
  'Managed Service': 'bg-teal-100 text-teal-700',
};

export function ProjectList({ projects, clients, services, serviceTypes, onUpdate }: Props) {
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [addingForClient, setAddingForClient] = useState<Client | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this project? Services linked to it will be unassigned but not deleted.')) return;
    await supabase.from('projects').delete().eq('id', id);
    onUpdate();
  };

  const toggle = (id: string) => {
    setExpanded(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const getTypeName = (typeId: string) => serviceTypes.find(t => t.id === typeId)?.name || 'Service';
  const projServices = (pid: string) => services.filter(s => s.project_id === pid);

  const byClient = clients
    .map(c => ({ client: c, projects: projects.filter(p => p.client_id === c.id) }))
    .filter(g => g.projects.length > 0);

  if (projects.length === 0) {
    return (
      <>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <FolderOpen className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No projects yet</h3>
          <p className="text-gray-600 mb-4">Projects help you organize services by client engagements.</p>
          {clients.length > 0 && (
            <button onClick={() => setAddingForClient(clients[0])}
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors text-sm">
              <Plus className="w-4 h-4" />Create First Project
            </button>
          )}
        </div>
        {addingForClient && (
          <AddProjectModal clients={clients} defaultClientId={addingForClient.id}
            onClose={() => setAddingForClient(null)}
            onSuccess={() => { setAddingForClient(null); onUpdate(); }} />
        )}
      </>
    );
  }

  return (
    <>
      <div className="space-y-8">
        {byClient.map(({ client, projects: clientProjects }) => (
          <div key={client.id}>
            <div className="flex items-center gap-3 mb-3">
              <h3 className="text-base font-semibold text-gray-800">{client.company_name}</h3>
              <button onClick={() => setAddingForClient(client)}
                className="ml-auto flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium">
                <Plus className="w-3.5 h-3.5" />New Project
              </button>
            </div>
            <div className="space-y-3">
              {clientProjects.map(project => {
                const svs = projServices(project.id);
                const isOpen = expanded.has(project.id);
                return (
                  <div key={project.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="flex items-start gap-4 p-5">
                      <button onClick={() => toggle(project.id)}
                        className="mt-0.5 text-gray-400 hover:text-gray-600 flex-shrink-0">
                        {isOpen ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="flex items-center gap-2">
                              <FolderOpen className="w-4 h-4 text-blue-500" />
                              <h4 className="font-semibold text-gray-900">{project.name}</h4>
                            </div>
                            {project.description && <p className="text-sm text-gray-600 mt-1">{project.description}</p>}
                            <div className="flex items-center gap-3 mt-2 flex-wrap">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[project.status]}`}>{project.status}</span>
                              {project.start_date && (
                                <span className="flex items-center gap-1 text-xs text-gray-500">
                                  <Calendar className="w-3 h-3" />
                                  {new Date(project.start_date).toLocaleDateString()}
                                  {project.end_date && ` → ${new Date(project.end_date).toLocaleDateString()}`}
                                </span>
                              )}
                              <span className="text-xs text-gray-500">{svs.length} service{svs.length !== 1 ? 's' : ''}</span>
                            </div>
                          </div>
                          <div className="flex gap-1 flex-shrink-0">
                            <button onClick={() => setEditingProject(project)}
                              className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Edit">
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button onClick={() => handleDelete(project.id)}
                              className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Delete">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                    {isOpen && (
                      <div className="border-t border-gray-100 bg-gray-50">
                        {svs.length === 0 ? (
                          <p className="text-sm text-gray-500 text-center py-4">No services attached to this project yet.</p>
                        ) : (
                          <div className="divide-y divide-gray-100">
                            {svs.map(service => (
                              <div key={service.id} className="flex items-center gap-3 px-5 py-3">
                                <div className="bg-blue-100 p-1.5 rounded-md">
                                  <Server className="w-3.5 h-3.5 text-blue-600" />
                                </div>
                                <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-medium text-gray-900">{service.name}</span>
                                  <span className="text-xs text-gray-500">{getTypeName(service.service_type_id)}</span>
                                  {service.infrastructure_type && (
                                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${INFRA_COLORS[service.infrastructure_type] || 'bg-gray-100 text-gray-700'}`}>
                                      {service.infrastructure_type}
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-gray-600">{service.price} {service.currency} / {service.billing_cycle}</div>
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                  service.status === 'Active' ? 'bg-green-100 text-green-800' :
                                  service.status === 'Suspended' ? 'bg-red-100 text-red-800' :
                                  service.status === 'Cancelled' ? 'bg-gray-100 text-gray-800' : 'bg-yellow-100 text-yellow-800'
                                }`}>{service.status}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {editingProject && (
        <EditProjectModal project={editingProject} clients={clients}
          onClose={() => setEditingProject(null)}
          onSuccess={() => { setEditingProject(null); onUpdate(); }} />
      )}
      {addingForClient && (
        <AddProjectModal clients={clients} defaultClientId={addingForClient.id}
          onClose={() => setAddingForClient(null)}
          onSuccess={() => { setAddingForClient(null); onUpdate(); }} />
      )}
    </>
  );
}
