import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { B, EMAIL_FONT, emailMeta } from "../_shared/emailBrand.ts";
import { pushTaskToTracker, resolveDefaultProject } from "../_shared/taskTracker.ts";

// Runs via pg_cron (no JWT). Sends ONE email to the operator when a service
// that has backup history hasn't reported a backup in the last 26 hours.
// Never sends to clients — this is an internal ops alert.

Deno.serve(async (_req: Request) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  const FROM_EMAIL     = Deno.env.get("RESEND_FROM_EMAIL") || "Cenas-Support Alerts <alerts@updates.cenas.uy>";
  const ALERT_EMAIL    = Deno.env.get("OPS_ALERT_EMAIL");   // operator email

  if (!RESEND_API_KEY || !ALERT_EMAIL) {
    return new Response(JSON.stringify({ error: "Missing RESEND_API_KEY or OPS_ALERT_EMAIL" }), { status: 500 });
  }

  const since26h = new Date(Date.now() - 26 * 3600 * 1000).toISOString();

  // Services that have ever had a backup but haven't reported one in 26h
  const { data: services } = await supabase
    .from("services")
    .select("id, name, business_name, client_id, last_backup_at, user_id")
    .eq("status", "Active")
    .not("last_backup_at", "is", null)
    .lt("last_backup_at", since26h);

  if (!services || services.length === 0) {
    return new Response(JSON.stringify({ sent: 0, reason: "All backups current" }), { status: 200 });
  }

  // Enrich with client names
  const clientIds = [...new Set(services.map((s: any) => s.client_id))];
  const { data: clients } = await supabase
    .from("clients")
    .select("id, company_name")
    .in("id", clientIds);
  const clientMap: Record<string, string> = Object.fromEntries(
    (clients || []).map((c: any) => [c.id, c.company_name])
  );

  const rows = services.map((s: any) => {
    const daysAgo = Math.floor((Date.now() - new Date(s.last_backup_at).getTime()) / 86400000);
    const hrsAgo  = Math.floor((Date.now() - new Date(s.last_backup_at).getTime()) / 3600000);
    const color   = hrsAgo <= 48 ? "#f59e0b" : "#ef4444";
    const age     = daysAgo >= 2 ? `${daysAgo}d` : `${hrsAgo}h`;
    return `<tr>
      <td style="padding:6px 8px;font-size:12px;color:#1e293b;">${s.business_name || s.name}</td>
      <td style="padding:6px 8px;font-size:12px;color:#64748b;">${clientMap[s.client_id] || ""}</td>
      <td style="padding:6px 8px;font-size:12px;color:${color};font-weight:600;">${age} atrás</td>
      <td style="padding:6px 8px;font-size:12px;color:#94a3b8;">${new Date(s.last_backup_at).toLocaleDateString("es-UY", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
    </tr>`;
  }).join("");

  const dateLabel = new Date().toLocaleDateString("es-UY", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "America/Montevideo",
  });

  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${B.bg};font-family:${EMAIL_FONT};">
    <tr><td align="center" style="padding:32px 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;border:1px solid ${B.border};">
    <tr><td style="padding:28px;">

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid ${B.border};">
        <tr>
          <td valign="middle">
            <div style="background:#FEF2F2;border:1px solid #FECACA;padding:5px 12px;border-radius:7px;display:inline-block;">
              <span style="color:#DC2626;font-size:11px;font-weight:700;letter-spacing:.5px;">⚠ ALERTA DE BACKUP</span>
            </div>
          </td>
          <td valign="middle" align="right">
            <span style="font-size:11px;color:#94a3b8;">${dateLabel}</span>
          </td>
        </tr>
      </table>

      <h2 style="font-size:17px;font-weight:700;color:${B.primary};margin:0 0 6px;">
        ${services.length} servicio${services.length > 1 ? "s" : ""} sin backup en las últimas 26 horas
      </h2>
      <p style="font-size:12px;color:#64748b;margin:0 0 20px;">
        Estos servicios tienen historial de backup pero no reportaron uno reciente.
      </p>

      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <th style="text-align:left;padding:4px 8px;font-size:10px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:.5px;">Servicio</th>
          <th style="text-align:left;padding:4px 8px;font-size:10px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:.5px;">Cliente</th>
          <th style="text-align:left;padding:4px 8px;font-size:10px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:.5px;">Sin backup</th>
          <th style="text-align:left;padding:4px 8px;font-size:10px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:.5px;">Último</th>
        </tr>
        ${rows}
      </table>

      <div style="margin-top:24px;padding-top:16px;border-top:1px solid ${B.border};">
        ${emailMeta("Cenas-Support Ops")}
      </div>

    </td></tr>
    </table>
    </td></tr>
  </table>`;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [ALERT_EMAIL],
      subject: `⚠ Backup Alert — ${services.length} servicio${services.length > 1 ? "s" : ""} sin backup (${dateLabel})`,
      html,
    }),
  });

  // Push a task to TaskTracker for each stale service whose client is mapped
  const TT_API_KEY = Deno.env.get("TASK_TRACKER_API_KEY");
  const TT_BASE    = Deno.env.get("TASK_TRACKER_URL");
  let ttPushed = 0;
  if (TT_API_KEY && TT_BASE) {
    for (const s of services as any[]) {
      if (!s.client_id) continue;
      const proj = await resolveDefaultProject(supabase, s.client_id);
      if (!proj) continue;
      const hrsAgo = Math.floor((Date.now() - new Date(s.last_backup_at).getTime()) / 3600000);
      const svcName = s.business_name || s.name;
      const taskId = await pushTaskToTracker({
        project_id:  proj.ttProjectId,
        client_id:   proj.ttClientId,
        title:       `Backup vencido — ${svcName}`,
        description: `El servicio "${svcName}" no reportó backup en las últimas ${hrsAgo}h. Último backup: ${new Date(s.last_backup_at).toLocaleString("es-UY", { timeZone: "America/Montevideo" })}.`,
        type:        "request",
        status:      "not_started",
        priority:    hrsAgo > 48 ? "high" : "medium",
      }, TT_API_KEY, TT_BASE, supabase, { source: "alert-backup-stale", clientId: s.client_id });
      if (taskId) ttPushed++;
    }
  }

  return new Response(JSON.stringify({ sent: 1, stale_count: services.length, tt_tasks_created: ttPushed }), { status: 200 });
});
