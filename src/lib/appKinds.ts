import type { AppKind } from './supabase';

/** Qué puede correr en un equipo. El emoji se usa también en el portal del cliente y en el mapa. */
export const APP_KINDS: { value: AppKind; label: string; icon: string }[] = [
  { value: 'app',      label: 'App de proveedor',     icon: '🧩' },
  { value: 'printer',  label: 'Impresora compartida', icon: '🖨️' },
  { value: 'share',    label: 'Carpeta compartida',   icon: '📁' },
  { value: 'database', label: 'Base de datos',        icon: '🗄️' },
  { value: 'service',  label: 'Servicio / rol',       icon: '⚙️' },
  { value: 'other',    label: 'Otro',                 icon: '•' },
];

export const appKind = (k?: string | null) => APP_KINDS.find(x => x.value === k) ?? APP_KINDS[0];

/** Lo que el script de salud de Windows detecta solo (payload.server_roles). */
export type DetectedRoles = {
  shares?: { name: string; path?: string; description?: string }[];
  printers?: { name: string; share_name?: string; driver?: string }[];
  services?: { name: string; svc: string; status?: string }[];
};
