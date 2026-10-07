import {
  Server, Cloud, Mail, Globe, Shield, Database, Activity,
  Lock, Users, HardDrive, Zap, Settings, Router, Cpu, Monitor, Archive,
  type LucideIcon,
} from 'lucide-react';

const iconMap: Record<string, LucideIcon> = {
  'VPS':              Cloud,
  'Dedicated Server': Server,
  'Email Hosting':    Mail,
  'Domain':           Globe,
  'Web Hosting':      Globe,
  'Backup':           HardDrive,
  'CDN':              Zap,
  'Firewall':         Shield,
  'Monitoring':       Activity,
  'VPN':              Lock,
  'Database':         Database,
  'Router / Switch':  Router,
  'Router / Firewall':Shield,
  'Managed Service':  Settings,
  'Active Directory': Users,
  'SSL Certificate':  Lock,
  'Cloud Service':    Cloud,
  'Storage':          Archive,
  'Server':           Server,
  'Workstation':      Monitor,
  'NAS':              HardDrive,
  'VM':               Cpu,
};

export function getServiceTypeIcon(typeName: string | undefined): LucideIcon {
  if (!typeName) return Server;
  return iconMap[typeName] ?? Server;
}

export const SERVICE_TYPE_ICON_COLOR: Record<string, string> = {
  'VPS':              'text-sky-600 bg-sky-100',
  'Dedicated Server': 'text-slate-600 bg-slate-100',
  'Email Hosting':    'text-violet-600 bg-violet-100',
  'Domain':           'text-teal-600 bg-teal-100',
  'Web Hosting':      'text-teal-600 bg-teal-100',
  'Backup':           'text-amber-600 bg-amber-100',
  'CDN':              'text-yellow-600 bg-yellow-100',
  'Firewall':         'text-red-600 bg-red-100',
  'Monitoring':       'text-emerald-600 bg-emerald-100',
  'VPN':              'text-purple-600 bg-purple-100',
  'Database':         'text-blue-600 bg-blue-100',
  'Router / Switch':  'text-cyan-600 bg-cyan-100',
  'Router / Firewall':'text-red-600 bg-red-100',
  'Managed Service':  'text-gray-600 bg-gray-100',
  'Active Directory': 'text-indigo-600 bg-indigo-100',
  'SSL Certificate':  'text-green-600 bg-green-100',
  'Cloud Service':    'text-sky-600 bg-sky-100',
  'NAS':              'text-orange-600 bg-orange-100',
};

export function getServiceTypeColors(typeName: string | undefined): string {
  if (!typeName) return 'text-blue-600 bg-blue-100';
  return SERVICE_TYPE_ICON_COLOR[typeName] ?? 'text-blue-600 bg-blue-100';
}
