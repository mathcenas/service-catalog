import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { B, EMAIL_FONT, emailHeader, emailPortalPanel, emailMeta } from "../_shared/emailBrand.ts";

// POST body options:
//   { preview: true, client_id: "uuid" }  → returns { html } without sending
//   { client_id: "uuid" }                 → sends to that client only
//   {}                                     → pg_cron: daily contacts always, weekly contacts only on Monday

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  const FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "Cenas-Support Alerts <alerts@updates.cenas.uy>";

  let body: Record<string, any> = {};
  try { body = await req.json(); } catch {}

  const previewMode: boolean = body?.preview === true;
  const targetClientId: string | null = body?.client_id || null;

  if (!RESEND_API_KEY && !previewMode) {
    return new Response(JSON.stringify({ error: "RESEND_API_KEY not configured" }), { status: 500 });
  }

  // Determine user from auth header (for preview) or service role (pg_cron)
  let userId: string | null = null;
  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const { data: { user } } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (user) userId = user.id;
  }

  // Monday check for weekly digests (0=Sun, 1=Mon in UTC)
  const isMonday = new Date().getUTCDay() === 1;

  // Fetch contacts with active digest frequency
  // For pg_cron run: daily contacts always, weekly contacts only on Monday
  // For preview/targeted run: fetch all contacts of that client
  type ContactRow = { id: string; client_id: string; name: string; email: string; digest_frequency: string };
  let contactsQuery = supabase
    .from("client_contacts")
    .select("id, client_id, name, email, digest_frequency");

  if (targetClientId) {
    contactsQuery = contactsQuery.eq("client_id", targetClientId).neq("digest_frequency", "none");
  } else {
    const freqFilter = isMonday ? ["daily", "weekly"] : ["daily"];
    contactsQuery = contactsQuery.in("digest_frequency", freqFilter);
  }

  const { data: allContacts } = await contactsQuery;
  if (!allContacts || allContacts.length === 0) {
    return new Response(JSON.stringify({ sent: 0, reason: "No contacts with active digest" }), { status: 200 });
  }

  // Group contacts by client_id
  const contactsByClient = new Map<string, ContactRow[]>();
  for (const c of allContacts as ContactRow[]) {
    const arr = contactsByClient.get(c.client_id) || [];
    arr.push(c);
    contactsByClient.set(c.client_id, arr);
  }

  // Fetch clients for those IDs
  const clientIds = [...contactsByClient.keys()];
  let clientsQuery = supabase
    .from("clients")
    .select("id, company_name, uptime_status_url, user_id")
    .in("id", clientIds)
    .eq("status", "Active");
  if (userId) clientsQuery = clientsQuery.eq("user_id", userId);

  const { data: targetClients } = await clientsQuery;
  if (!targetClients || targetClients.length === 0) {
    return new Response(JSON.stringify({ sent: 0, reason: "No clients found" }), { status: 200 });
  }

  const since7d  = new Date(Date.now() - 7 * 86400000).toISOString();
  const since24h = new Date(Date.now() - 86400000).toISOString();
  const in60d    = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
  let sent = 0;

  for (const client of targetClients) {
    // User settings (for company name / logo)
    const { data: settings } = await supabase
      .from("user_settings")
      .select("company_name, logo_url, share_page_slug")
      .eq("user_id", client.user_id)
      .maybeSingle();

    const senderName = settings?.company_name || "Cenas IT";
    const portalSlug = settings?.share_page_slug;
    const portalUrl  = portalSlug
      ? `${Deno.env.get("APP_URL") || "https://servicios.cenas-support.com"}/share/${portalSlug}/${client.id}`
      : null;

    // Services for this client
    const { data: services } = await supabase
      .from("services")
      .select("id, name, business_name, client_id, last_backup_at, last_restore_test_at, next_renewal_date, billing_cycle, status, uptime_badge_url")
      .eq("client_id", client.id)
      .eq("status", "Active");

    const serviceList = services || [];
    const serviceIds  = serviceList.map((s: any) => s.id);

    // Determine which contact types are receiving this run for this client
    const clientContacts = contactsByClient.get(client.id) || [];
    const hasDailyContact  = clientContacts.some(c => c.digest_frequency === "daily");
    const hasWeeklyContact = clientContacts.some(c => c.digest_frequency === "weekly");
    // Daily email covers 24h; weekly email covers 7d — fetch the broader window needed
    const backupSince = since7d;

    const [
      { data: backups },
      { data: heartbeats },
      { data: changes },
    ] = await Promise.all([
      serviceIds.length
        ? supabase.from("service_backups").select("service_id, status, backed_up_at, job_name").gte("backed_up_at", backupSince).in("service_id", serviceIds).order("backed_up_at", { ascending: false })
        : { data: [] },
      serviceIds.length
        ? supabase.from("service_heartbeats").select("service_id, source, status, message, payload, received_at").in("service_id", serviceIds).gte("received_at", since7d)
        : { data: [] },
      serviceIds.length
        ? supabase.from("service_changes").select("service_id, summary, change_date").gte("change_date", since7d).in("service_id", serviceIds).order("change_date", { ascending: false })
        : { data: [] },
    ]);

    // ── Helpers ──────────────────────────────────────────────
    const svcName = (id: string) => {
      const s = serviceList.find((x: any) => x.id === id);
      return s?.business_name || s?.name || id;
    };

    const PILL_PAIRS: Record<string, { text: string; bg: string; border: string }> = {
      '#22c55e': { text: '#059669', bg: '#ECFDF5', border: '#A7F3D0' },
      '#f59e0b': { text: '#B45309', bg: '#FFFBEB', border: '#FDE68A' },
      '#ef4444': { text: '#DC2626', bg: '#FEF2F2', border: '#FECACA' },
    };
    const pill = (text: string, color: string) => {
      const p = PILL_PAIRS[color.toLowerCase()] || { text: '#334155', bg: '#F1F5F9', border: '#CBD5E1' };
      return `<span style="display:inline-block;background:${p.bg};color:${p.text};border:1px solid ${p.border};padding:1px 8px;border-radius:10px;font-size:11px;font-weight:700;">${text}</span>`;
    };

    const statusPill = (s: string) =>
      s === 'ok' || s === 'success'  ? pill('OK', '#22c55e') :
      s === 'warning'                ? pill('⚠ Warning', '#f59e0b') :
                                       pill('✕ Error', '#ef4444');

    const tableWrap = (rows: string, headers: string[]) =>
      `<table style="width:100%;border-collapse:collapse;margin-top:4px;">
        <tr>${headers.map(h => `<th style="text-align:left;padding:4px 8px;font-size:10px;color:${B.textSoft};font-weight:600;text-transform:uppercase;letter-spacing:.5px;">${h}</th>`).join('')}</tr>
        ${rows}
      </table>`;

    const section = (title: string, icon: string, content: string) =>
      `<div style="margin-bottom:24px;">
        <h3 style="font-size:12px;font-weight:700;color:${B.primary};margin:0 0 8px;padding-bottom:5px;border-bottom:2px solid ${B.accent};">
          ${icon} ${title}
        </h3>
        ${content}
      </div>`;

    const emptyNote = (msg: string) =>
      `<p style="font-size:12px;color:${B.textSoft};margin:4px 0;">${msg}</p>`;

    // ── Backups ────────────────────────────────────────────────
    // Latest backup per service
    const latestBackupPerSvc: Record<string, any> = {};
    for (const b of (backups || []) as any[]) {
      if (!latestBackupPerSvc[b.service_id]) latestBackupPerSvc[b.service_id] = b;
    }
    const backupRows = serviceList
      .filter((s: any) => s.last_backup_at || latestBackupPerSvc[s.id])
      .map((s: any) => {
        const latest = latestBackupPerSvc[s.id];
        const dateStr = latest?.backed_up_at || s.last_backup_at;
        const daysAgo = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
        const color   = daysAgo <= 1 ? '#22c55e' : daysAgo <= 3 ? '#f59e0b' : '#ef4444';
        const age     = daysAgo === 0 ? 'Hoy' : daysAgo === 1 ? 'Ayer' : `${daysAgo}d atrás`;
        return `<tr>
          <td style="padding:5px 8px;font-size:12px;color:${B.primary};">${s.business_name || s.name}</td>
          <td style="padding:5px 8px;">${latest ? statusPill(latest.status) : ''}</td>
          <td style="padding:5px 8px;font-size:12px;color:${color};font-weight:600;">${age}</td>
        </tr>`;
      }).join('');

    // ── System Health ──────────────────────────────────────────
    const healthMap: Record<string, any> = {};
    for (const h of (heartbeats || []) as any[]) {
      if (h.source !== 'system-health') continue;
      if (!healthMap[h.service_id] || h.received_at > healthMap[h.service_id].received_at) {
        healthMap[h.service_id] = h;
      }
    }
    const healthRows = Object.values(healthMap).map((h: any) => {
      const p = h.payload || {};
      const chips = [
        p.cpu_pct   != null ? `CPU ${p.cpu_pct}%`    : null,
        p.ram_pct   != null ? `RAM ${p.ram_pct}%`    : null,
        p.disk_pct  != null ? `Disk ${p.disk_pct}%`  : null,
        p.free_gb   != null ? `Free ${p.free_gb} GB` : null,
        p.uptime    != null ? `Up ${p.uptime}`        : null,
      ].filter(Boolean).join(' &bull; ');
      return `<tr>
        <td style="padding:5px 8px;font-size:12px;color:${B.primary};">${svcName(h.service_id)}</td>
        <td style="padding:5px 8px;">${statusPill(h.status)}</td>
        <td style="padding:5px 8px;font-size:11px;color:${B.textMid};">${chips || h.message || ''}</td>
      </tr>`;
    }).join('');

    // ── Disk SMART ─────────────────────────────────────────────
    const diskRows = Object.values(healthMap).flatMap((h: any) => {
      const disks: any[] = Array.isArray(h.payload?.disk_smart) ? h.payload.disk_smart : [];
      return disks.map((d: any) => {
        const details = [
          d.temp_c        != null ? `${d.temp_c}°C` : null,
          d.pct_used      != null ? `${d.pct_used}% usado` : null,
          d.reallocated_sectors > 0 ? `⚠ ${d.reallocated_sectors} sect.` : null,
        ].filter(Boolean).join(' · ');
        return `<tr>
          <td style="padding:5px 8px;font-size:12px;color:${B.primary};">${svcName(h.service_id)}</td>
          <td style="padding:5px 8px;font-size:11px;font-family:monospace;color:${B.textMid};">${d.dev || ''} ${d.type || ''}</td>
          <td style="padding:5px 8px;">${statusPill(d.smart_health || d.status || 'ok')}</td>
          <td style="padding:5px 8px;font-size:11px;color:${B.textMid};">${details}</td>
        </tr>`;
      });
    }).join('');

    // ── Renewals ───────────────────────────────────────────────
    const renewalCycles = new Set(['Annually', 'Biennially', 'Semi-Annually', 'One-Time']);
    const renewalRows = serviceList
      .filter((s: any) => s.next_renewal_date && renewalCycles.has(s.billing_cycle) && s.next_renewal_date <= in60d)
      .sort((a: any, b: any) => a.next_renewal_date.localeCompare(b.next_renewal_date))
      .map((s: any) => {
        const d    = new Date(s.next_renewal_date);
        const days = Math.ceil((d.getTime() - Date.now()) / 86400000);
        const color = days <= 14 ? '#f59e0b' : B.textMid;
        return `<tr>
          <td style="padding:5px 8px;font-size:12px;color:${B.primary};">${s.business_name || s.name}</td>
          <td style="padding:5px 8px;font-size:12px;color:${color};font-weight:600;">${d.toLocaleDateString('es-UY', { day: 'numeric', month: 'short' })} (${days}d)</td>
        </tr>`;
      }).join('');

    // ── Changes ────────────────────────────────────────────────
    const changeItems = (changes || []).slice(0, 5).map((c: any) =>
      `<li style="font-size:12px;color:${B.textMain};margin-bottom:5px;">
        <span style="color:${B.textSoft};font-size:11px;">${new Date(c.change_date).toLocaleDateString('es-UY', { day: 'numeric', month: 'short' })}</span>
        &nbsp;${c.summary}
      </li>`
    ).join('');

    // ── Compose HTML per frequency ──────────────────────────────
    const dateLabel = new Date().toLocaleDateString('es-UY', { day: 'numeric', month: 'long', year: 'numeric' });

    const backups24h = (backups || []).filter((b: any) => b.backed_up_at >= since24h);
    const backupRows24h = serviceList
      .filter((s: any) => backups24h.some((b: any) => b.service_id === s.id) || s.last_backup_at >= since24h)
      .map((s: any) => {
        const latest = backups24h.find((b: any) => b.service_id === s.id);
        const age = latest ? 'Hoy' : 'Ayer';
        return `<tr>
          <td style="padding:5px 8px;font-size:12px;color:${B.primary};">${s.business_name || s.name}</td>
          <td style="padding:5px 8px;">${latest ? statusPill(latest.status) : ''}</td>
          <td style="padding:5px 8px;font-size:12px;color:${B.textMid};">${age}</td>
        </tr>`;
      }).join('');

    const buildHtml = (frequency: "daily" | "weekly") => {
      const isDaily = frequency === "daily";
      const label   = isDaily ? 'Resumen Diario' : 'Resumen Semanal';
      const bRows   = isDaily ? backupRows24h : backupRows;
      const bLabel  = isDaily ? 'Backups — últimas 24h' : 'Backups — últimos 7 días';
      const bEmpty  = isDaily ? 'Sin backups en las últimas 24h.' : 'Sin servicios con backup monitoreado esta semana.';

      const bodyContent = `
        ${emailHeader({ senderName, label, accentColor: B.accent, title: client.company_name, subtitle: dateLabel })}
        ${section(bLabel, '📦',
          bRows ? tableWrap(bRows, ['Servicio', 'Resultado', 'Último backup']) : emptyNote(bEmpty)
        )}
        ${!isDaily && diskRows   ? section('Estado de Discos (SMART)', '💾', tableWrap(diskRows,   ['Servidor', 'Disco', 'Estado', 'Detalles'])) : ''}
        ${!isDaily && healthRows ? section('Salud del Sistema',        '🖥️', tableWrap(healthRows, ['Servicio', 'Estado', 'Detalles'])) : ''}
        ${!isDaily && renewalRows ? section('Próximas Renovaciones', '📅', tableWrap(renewalRows, ['Servicio', 'Fecha'])) : ''}
        ${!isDaily && changeItems ? section('Cambios realizados esta semana', '🔧', `<ul style="margin:4px 0;padding-left:16px;">${changeItems}</ul>`) : ''}
        ${emailPortalPanel({ companyName: client.company_name, portalUrl })}
        ${emailMeta(senderName)}
      `;
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${B.bg};font-family:${EMAIL_FONT};">
        <tr><td align="center" style="padding:32px 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;border:1px solid ${B.border};">
        <tr><td style="padding:28px;">${bodyContent}</td></tr>
        </table>
        </td></tr>
      </table>`;
    };

    if (previewMode) {
      const html = buildHtml(hasWeeklyContact ? "weekly" : "daily");
      return new Response(JSON.stringify({ html, client_name: client.company_name }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Send one email per frequency group, to the matching contacts
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    for (const frequency of (["daily", "weekly"] as const)) {
      const group = clientContacts.filter(c => c.digest_frequency === frequency);
      if (group.length === 0) continue;
      // In pg_cron mode, skip weekly if not Monday
      if (frequency === "weekly" && !isMonday && !targetClientId) continue;

      const html        = buildHtml(frequency);
      const label       = frequency === "daily" ? "Resumen diario" : "Resumen semanal";
      const subject     = `${label} — ${client.company_name} — ${dateLabel}`;
      const toEmails    = group.map(c => c.email);
      const trackingId  = crypto.randomUUID();
      const pixelUrl    = `${supabaseUrl}/functions/v1/track-open?t=${trackingId}`;

      await supabase.from("email_opens").insert({
        user_id:      userId || client.user_id,
        client_id:    client.id,
        client_email: toEmails[0],
        tracking_id:  trackingId,
        email_type:   `digest_${frequency}`,
        subject,
      });

      const htmlWithPixel = html + `<img src="${pixelUrl}" width="1" height="1" style="display:none;" alt="" />`;

      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: FROM_EMAIL, to: toEmails, subject, html: htmlWithPixel }),
      });

      sent++;
    }
  }

  return new Response(JSON.stringify({ sent }), { status: 200 });
});
