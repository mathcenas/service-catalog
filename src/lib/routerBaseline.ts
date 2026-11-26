// Estándar Cenas para los MikroTik (scripts/mikrotik/mk-baseline.rsc), evaluado con la sección
// "security" que manda mk-network-report.rsc 1.3.0+. Lo usan Telemetría → Routers y el portal del cliente.

export type RouterSecurity = {
  services?: { name: string; port: number; disabled: boolean; address?: string }[];
  vpn_servers?: { pptp?: boolean; sstp?: boolean; l2tp?: boolean; ovpn?: boolean };
  ppp_active?: number;
  ppp_secrets?: number;
  drop_wan?: boolean;
  wan_list?: boolean;
  pptp_bruteforce?: boolean;
  blocked_ips?: number;
  uy_ranges?: number;
  fw_ports?: { port: string; protocol?: string; only_from?: string; in_interface?: string; comment?: string }[];
  dns_remote?: boolean;
  lan_on_slave?: string[];
  loop_protect_ports?: number;
  netwatch?: { host: string; comment?: string; status?: string; since?: string; disabled?: boolean }[];
  disk_logging?: string;
  admin_user?: boolean;
};

export type BaselineCheck = {
  id: string;
  label: string;
  /** true = cumple · false = no cumple · null = no aplica */
  ok: boolean | null;
  detail?: string;
  /** No cumplir esto deja el router expuesto (abre ticket) */
  critical?: boolean;
  /** Pendiente de una decisión: se muestra pero no resta */
  pending?: boolean;
};

const INSECURE = ['telnet', 'ftp', 'www', 'api', 'api-ssl'];

/** Puertos que el firewall acepta desde cualquier IP (sin lista ni IP de origen) */
export function openPorts(sec: RouterSecurity): string[] {
  return (sec.fw_ports ?? []).filter(p => !p.only_from).map(p => `${p.port}${p.protocol ? `/${p.protocol}` : ''}`);
}

export function evaluateBaseline(sec: RouterSecurity | null | undefined, reportIntervalS?: number): BaselineCheck[] {
  if (!sec) return [];
  const svc = (n: string) => (sec.services ?? []).find(s => s.name === n);
  const vpn = sec.vpn_servers ?? {};
  const ports = sec.fw_ports ?? [];
  const pptpAccept = ports.filter(p => p.port.split(',').includes('1723'));
  const insecureOn = INSECURE.filter(n => { const s = svc(n); return s && !s.disabled && !s.address; });
  const winbox = svc('winbox');
  const winboxRuleOpen = ports.some(p => p.port.split(',').includes('8291') && !p.only_from);
  const winboxOpen = !!winbox && !winbox.disabled && !winbox.address && (winboxRuleOpen || !sec.drop_wan);
  const disk = sec.disk_logging ?? '';
  const nwActive = (sec.netwatch ?? []).filter(n => !n.disabled);
  const unusedVpn = [vpn.sstp && 'SSTP', vpn.l2tp && 'L2TP', vpn.ovpn && 'OpenVPN'].filter(Boolean) as string[];

  return [
    {
      id: 'report', label: 'Reporte al portal agendado',
      ok: (reportIntervalS ?? 0) > 0,
      detail: reportIntervalS ? `cada ${Math.round(reportIntervalS / 3600) || 1} h` : 'corrido a mano: falta el scheduler',
    },
    {
      id: 'drop_wan', label: 'Firewall descarta lo que entra de Internet', critical: true,
      ok: !!sec.drop_wan,
      detail: sec.drop_wan ? (sec.wan_list ? undefined : 'la lista WAN está vacía') : "falta 'drop all not coming from LAN'",
    },
    {
      id: 'services', label: 'Servicios inseguros apagados (telnet, ftp, www, api)',
      ok: insecureOn.length === 0,
      detail: insecureOn.length ? `prendidos: ${insecureOn.join(', ')}` : undefined,
    },
    {
      id: 'winbox', label: 'Winbox limitado (IP fija o VPN)', pending: true,
      ok: winbox ? !winboxOpen : null,
      detail: winboxOpen ? 'abierto a todo Internet' : winbox?.address ? `solo ${winbox.address}` : undefined,
    },
    {
      id: 'pptp_geo', label: 'VPN PPTP solo desde Uruguay',
      ok: vpn.pptp ? pptpAccept.length > 0 && pptpAccept.every(p => !!p.only_from) : null,
      detail: !vpn.pptp ? 'PPTP apagado'
        : pptpAccept.some(p => !p.only_from) ? 'acepta desde cualquier país'
        : `${sec.uy_ranges ?? 0} rangos de Uruguay`,
    },
    {
      id: 'pptp_brute', label: 'Bloqueo de fuerza bruta en la VPN',
      ok: vpn.pptp ? !!sec.pptp_bruteforce : null,
      detail: !vpn.pptp ? 'PPTP apagado' : sec.pptp_bruteforce ? `${sec.blocked_ips ?? 0} IP bloqueadas ahora` : undefined,
    },
    {
      id: 'unused_vpn', label: 'VPN que no se usan, apagadas',
      ok: unusedVpn.length === 0,
      detail: unusedVpn.length ? `prendidas: ${unusedVpn.join(', ')}` : undefined,
    },
    {
      id: 'netwatch', label: 'Netwatch (gateway, Internet y servidores)',
      ok: nwActive.length > 0,
      detail: nwActive.length ? `${nwActive.length} equipos vigilados` : undefined,
    },
    {
      id: 'disk_log', label: 'Log guardado en disco',
      ok: /critical/.test(disk) && /netwatch/.test(disk),
      detail: disk ? undefined : 'se pierde al reiniciar',
    },
    {
      id: 'lan_bridge', label: 'IP de la LAN en el bridge',
      ok: (sec.lan_on_slave ?? []).length === 0,
      detail: (sec.lan_on_slave ?? []).length ? `está en ${sec.lan_on_slave!.join(', ')}` : undefined,
    },
    {
      id: 'admin', label: "Usuario 'admin' deshabilitado",
      ok: !sec.admin_user,
    },
  ];
}

export function baselineScore(checks: BaselineCheck[]) {
  const counted = checks.filter(c => c.ok !== null && !c.pending);
  return { ok: counted.filter(c => c.ok).length, total: counted.length };
}

/** Equipos vigilados por netwatch que están caídos ahora */
export function netwatchDown(sec: RouterSecurity | null | undefined) {
  return (sec?.netwatch ?? []).filter(n => !n.disabled && n.status === 'down');
}
