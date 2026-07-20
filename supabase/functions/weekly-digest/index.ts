import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Can be called manually (POST with Authorization) or by pg_cron (POST with service role key)
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  const FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "Cenas-Support <alerts@cenas-support.com>";

  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: "RESEND_API_KEY not configured" }), { status: 500 });
  }

  // Determine target user — from auth header or run for all users with digest enabled
  let userIds: string[] = [];
  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const { data: { user } } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (user) userIds = [user.id];
  }

  if (userIds.length === 0) {
    const { data: settings } = await supabase
      .from("user_settings")
      .select("user_id, weekly_digest_email")
      .eq("weekly_digest_enabled", true);
    userIds = (settings || []).map((s: any) => s.user_id);
  }

  if (userIds.length === 0) {
    return new Response(JSON.stringify({ sent: 0, reason: "No users with digest enabled" }), { status: 200 });
  }

  const since7d = new Date(Date.now() - 7 * 86400000).toISOString();
  const in60d = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
  let sent = 0;

  for (const userId of userIds) {
    const [
      { data: settingsRow },
      { data: authUser },
      { data: clients },
      { data: services },
      { data: backups },
      { data: changes },
      { data: roadmap },
      { data: heartbeats },
    ] = await Promise.all([
      supabase.from("user_settings").select("*").eq("user_id", userId).maybeSingle(),
      supabase.auth.admin.getUserById(userId),
      supabase.from("clients").select("id, company_name").eq("user_id", userId),
      supabase.from("services").select("id, name, business_name, service_type_id, client_id, last_backup_at, last_restore_test_at, last_restore_test_result, next_renewal_date, billing_cycle, status").eq("user_id", userId).eq("status", "Active"),
      supabase.from("service_backups").select("service_id, status, backed_up_at, size_bytes").gte("backed_up_at", since7d).in("service_id", []),
      supabase.from("service_changes").select("service_id, summary, change_date").gte("change_date", since7d).eq("user_id", userId).order("change_date", { ascending: false }),
      supabase.from("roadmap_items").select("title, status, scheduled_date").eq("user_id", userId).neq("status", "Released").order("sort_order"),
      supabase.from("service_heartbeats").select("service_id, source, status, message, payload, received_at").in("service_id", (services || []).map((s: any) => s.id)).gte("received_at", since7d),
    ]);

    const toEmail = settingsRow?.weekly_digest_email || authUser?.user?.email;
    if (!toEmail) continue;

    const senderName = settingsRow?.company_name || "Cenas-Support";
    const serviceList = services || [];
    const clientMap = Object.fromEntries((clients || []).map((c: any) => [c.id, c.company_name]));

    // Backups summary
    const backupServices = serviceList.filter((s: any) => s.last_backup_at);
    const backupRows = backupServices.map((s: any) => {
      const daysAgo = Math.floor((Date.now() - new Date(s.last_backup_at).getTime()) / 86400000);
      const color = daysAgo <= 1 ? "#22c55e" : daysAgo <= 3 ? "#f59e0b" : "#ef4444";
      return `<tr>
        <td style="padding:5px 8px;font-size:12px;color:#1e293b;">${s.business_name || s.name}</td>
        <td style="padding:5px 8px;font-size:12px;color:#64748b;">${clientMap[s.client_id] || ''}</td>
        <td style="padding:5px 8px;font-size:12px;color:${color};">${daysAgo === 0 ? 'Today' : daysAgo === 1 ? 'Yesterday' : `${daysAgo}d ago`}</td>
      </tr>`;
    }).join('');

    // System health (latest heartbeat per service with source=system-health)
    const healthMap: Record<string, any> = {};
    for (const h of (heartbeats || []) as any[]) {
      if (h.source === 'system-health') {
        if (!healthMap[h.service_id] || h.received_at > healthMap[h.service_id].received_at) {
          healthMap[h.service_id] = h;
        }
      }
    }
    const healthRows = Object.values(healthMap).map((h: any) => {
      const svc = serviceList.find((s: any) => s.id === h.service_id);
      const disk = h.payload?.disk_pct != null ? `Disk ${h.payload.disk_pct}%` : '';
      const ram = h.payload?.ram_pct != null ? `RAM ${h.payload.ram_pct}%` : '';
      const color = h.status === 'ok' ? '#22c55e' : h.status === 'warning' ? '#f59e0b' : '#ef4444';
      return `<tr>
        <td style="padding:5px 8px;font-size:12px;color:#1e293b;">${svc?.business_name || svc?.name || h.service_id}</td>
        <td style="padding:5px 8px;font-size:12px;color:${color};">${h.status.toUpperCase()}</td>
        <td style="padding:5px 8px;font-size:12px;color:#64748b;">${[disk, ram].filter(Boolean).join(' · ') || h.message || ''}</td>
      </tr>`;
    }).join('');

    // Upcoming renewals (60 days)
    const renewalCycles = new Set(['Annually', 'Biennially', 'Semi-Annually', 'One-Time']);
    const renewals = serviceList
      .filter((s: any) => s.next_renewal_date && renewalCycles.has(s.billing_cycle) && s.next_renewal_date <= in60d)
      .sort((a: any, b: any) => a.next_renewal_date.localeCompare(b.next_renewal_date));
    const renewalRows = renewals.map((s: any) => {
      const d = new Date(s.next_renewal_date);
      const days = Math.ceil((d.getTime() - Date.now()) / 86400000);
      const color = days <= 14 ? '#f59e0b' : '#64748b';
      return `<tr>
        <td style="padding:5px 8px;font-size:12px;color:#1e293b;">${s.business_name || s.name}</td>
        <td style="padding:5px 8px;font-size:12px;color:#64748b;">${clientMap[s.client_id] || ''}</td>
        <td style="padding:5px 8px;font-size:12px;color:${color};">${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} (${days}d)</td>
      </tr>`;
    }).join('');

    // Changes this week
    const changeRows = (changes || []).slice(0, 5).map((c: any) =>
      `<li style="font-size:12px;color:#475569;margin-bottom:4px;">${new Date(c.change_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — ${c.summary}</li>`
    ).join('');

    // Roadmap upcoming
    const roadmapRows = (roadmap || []).slice(0, 5).map((r: any) =>
      `<li style="font-size:12px;color:#475569;margin-bottom:4px;"><strong>${r.title}</strong> <span style="color:#94a3b8;">${r.status}</span>${r.scheduled_date ? ` · ${new Date(r.scheduled_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}</li>`
    ).join('');

    const section = (title: string, content: string, empty?: string) =>
      content ? `<div style="margin-bottom:28px;">
        <h3 style="font-size:13px;font-weight:700;color:#0f172a;margin:0 0 10px;padding-bottom:6px;border-bottom:1px solid #e2e8f0;">${title}</h3>
        ${content}
      </div>` : (empty ? `<div style="margin-bottom:28px;">
        <h3 style="font-size:13px;font-weight:700;color:#0f172a;margin:0 0 10px;padding-bottom:6px;border-bottom:1px solid #e2e8f0;">${title}</h3>
        <p style="font-size:12px;color:#94a3b8;">${empty}</p>
      </div>` : '');

    const tableWrap = (rows: string, headers: string[]) =>
      `<table style="width:100%;border-collapse:collapse;">
        <tr>${headers.map(h => `<th style="text-align:left;padding:4px 8px;font-size:11px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:.5px;">${h}</th>`).join('')}</tr>
        ${rows}
      </table>`;

    const weekLabel = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;background:#f8fafc;">
      <div style="background:white;border-radius:12px;padding:28px;border:1px solid #e2e8f0;">
        <p style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin:0 0 4px;">Weekly Summary</p>
        <h1 style="font-size:22px;font-weight:700;color:#0f172a;margin:0 0 24px;">${weekLabel}</h1>

        ${section('Backups (last 7 days)',
          backupRows ? tableWrap(backupRows, ['Service', 'Client', 'Last Backup']) : '',
          backupRows ? undefined : 'No backup-monitored services.'
        )}
        ${healthRows ? section('System Health', tableWrap(healthRows, ['Service', 'Status', 'Details'])) : ''}
        ${renewalRows ? section('Upcoming Renewals (60 days)', tableWrap(renewalRows, ['Service', 'Client', 'Renewal Date'])) : ''}
        ${changeRows ? section('Changes This Week', `<ul style="margin:0;padding-left:16px;">${changeRows}</ul>`) : ''}
        ${roadmapRows ? section('Upcoming Roadmap', `<ul style="margin:0;padding-left:16px;">${roadmapRows}</ul>`) : ''}

        <p style="font-size:11px;color:#cbd5e1;text-align:center;margin-top:24px;padding-top:16px;border-top:1px solid #f1f5f9;">
          ${senderName} · Weekly Digest · <a href="#" style="color:#cbd5e1;">Unsubscribe</a>
        </p>
      </div>
    </div>`;

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [toEmail],
        subject: `Weekly Summary — ${weekLabel}`,
        html,
      }),
    });

    sent++;
  }

  return new Response(JSON.stringify({ sent }), { status: 200 });
});
