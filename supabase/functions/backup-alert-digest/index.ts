import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { B, EMAIL_FONT, emailHeader, emailPortalPanel, emailMeta } from "../_shared/emailBrand.ts";

// Runs daily via pg_cron (or POST with { client_id, preview }).
// Sends ONE email per client summarising all backup events in the last 24h.
// Only sends if there are any warning or failed backups, OR if any service
// missed its expected backup window.

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  const FROM_EMAIL     = Deno.env.get("RESEND_FROM_EMAIL") || "Cenas-Support Alertas <alerts@updates.cenas.uy>";

  let body: Record<string, any> = {};
  try { body = await req.json(); } catch {}

  const previewMode:    boolean     = body?.preview === true;
  const targetClientId: string|null = body?.client_id || null;

  if (!RESEND_API_KEY && !previewMode) {
    return new Response(JSON.stringify({ error: "RESEND_API_KEY not configured" }), { status: 500 });
  }

  const since24h = new Date(Date.now() - 86400000).toISOString();

  // Load backups from the last 24h
  let backupsQuery = supabase
    .from("service_backups")
    .select("service_id, status, backed_up_at, job_name, size_bytes, duration_seconds")
    .gte("backed_up_at", since24h)
    .order("backed_up_at", { ascending: false });

  const { data: allBackups } = await backupsQuery;
  if (!allBackups || allBackups.length === 0) {
    return new Response(JSON.stringify({ sent: 0, reason: "No backups in last 24h" }), { status: 200 });
  }

  // Group backups by service_id
  const backupsByService = new Map<string, any[]>();
  for (const b of allBackups as any[]) {
    const arr = backupsByService.get(b.service_id) || [];
    arr.push(b);
    backupsByService.set(b.service_id, arr);
  }

  const serviceIds = [...backupsByService.keys()];

  // Load services + their clients
  let svcQuery = supabase
    .from("services")
    .select("id, name, business_name, client_id, clients(id, company_name, user_id, uptime_status_url)")
    .in("id", serviceIds);
  if (targetClientId) svcQuery = svcQuery.eq("client_id", targetClientId);

  const { data: services } = await svcQuery;
  if (!services || services.length === 0) {
    return new Response(JSON.stringify({ sent: 0, reason: "No services found" }), { status: 200 });
  }

  // Group services by client_id
  const servicesByClient = new Map<string, any[]>();
  for (const s of services as any[]) {
    const arr = servicesByClient.get(s.client_id) || [];
    arr.push(s);
    servicesByClient.set(s.client_id, arr);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  const statusPill = (s: string) => {
    const c = s === "success" ? { text: "#059669", bg: "#ECFDF5", border: "#A7F3D0", label: "EXITOSO" }
            : s === "warning" ? { text: "#B45309", bg: "#FFFBEB", border: "#FDE68A", label: "⚠ WARNING" }
            :                   { text: "#DC2626", bg: "#FEF2F2", border: "#FECACA", label: "✕ FALLÓ" };
    return `<span style="display:inline-block;background:${c.bg};color:${c.text};border:1px solid ${c.border};padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;">${c.label}</span>`;
  };

  const fmtSize = (bytes: number|null) => {
    if (!bytes) return "—";
    if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)} GB`;
    if (bytes >= 1048576)    return `${(bytes / 1048576).toFixed(1)} MB`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  const fmtDur = (secs: number|null) => {
    if (!secs) return "—";
    if (secs < 60) return `${secs}s`;
    return `${Math.round(secs / 60)} min`;
  };

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleString("es-UY", {
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
      timeZone: "America/Montevideo",
    });

  let sent = 0;
  const previews: any[] = [];

  for (const [clientId, clientServices] of servicesByClient) {
    const client = (clientServices[0] as any).clients;
    if (!client) continue;

    // Collect all backups for this client
    const rows: { svc: any; backups: any[] }[] = clientServices.map((s: any) => ({
      svc: s,
      backups: backupsByService.get(s.id) || [],
    }));

    // Only send if there's at least one warning or failed
    const hasAlert = rows.some(r => r.backups.some((b: any) => b.status !== "success"));
    if (!hasAlert && !previewMode) continue;

    // Load contacts for this client
    const { data: contacts } = await supabase
      .from("client_contacts")
      .select("id, email")
      .eq("client_id", clientId)
      .neq("digest_frequency", "none");

    const recipients = (contacts || []).map((c: any) => c.email).filter(Boolean);
    if (recipients.length === 0 && !previewMode) continue;

    // User settings
    const { data: settings } = await supabase
      .from("user_settings")
      .select("company_name, share_page_slug")
      .eq("user_id", client.user_id)
      .maybeSingle();

    const senderName = settings?.company_name || "Cenas IT";
    const portalSlug = settings?.share_page_slug;
    const portalUrl  = portalSlug
      ? `${Deno.env.get("APP_URL") || "https://servicios.cenas-support.com"}/share/${portalSlug}/${clientId}`
      : null;

    // Count totals
    const totalOk      = rows.reduce((n, r) => n + r.backups.filter((b: any) => b.status === "success").length, 0);
    const totalWarning = rows.reduce((n, r) => n + r.backups.filter((b: any) => b.status === "warning").length, 0);
    const totalFailed  = rows.reduce((n, r) => n + r.backups.filter((b: any) => b.status === "failed").length, 0);

    const badgeText = totalFailed > 0 ? "⚠ ALERTA DE BACKUP"
                    : totalWarning > 0 ? "⚠ BACKUP CON ADVERTENCIAS"
                    : "BACKUPS OK";
    const badgeColor = totalFailed > 0 ? "#ef4444" : totalWarning > 0 ? "#f59e0b" : "#22c55e";

    const dateLabel = new Date().toLocaleDateString("es-UY", {
      weekday: "long", day: "numeric", month: "long",
      timeZone: "America/Montevideo",
    });

    // Build rows table
    const tableRows = rows.flatMap(({ svc, backups }) => {
      if (backups.length === 0) return [];
      // Show only the latest per job_name (or one row if no job_name)
      const byJob = new Map<string, any>();
      for (const b of backups) {
        const key = b.job_name || "_";
        if (!byJob.has(key)) byJob.set(key, b);
      }
      return [...byJob.values()].map((b: any) => `<tr>
        <td style="padding:6px 8px;font-size:12px;color:${B.primary};font-weight:600;">${svc.business_name || svc.name}</td>
        <td style="padding:6px 8px;font-size:11px;color:${B.textMid};">${b.job_name || "—"}</td>
        <td style="padding:6px 8px;">${statusPill(b.status)}</td>
        <td style="padding:6px 8px;font-size:11px;color:${B.textMid};white-space:nowrap;">${fmtSize(b.size_bytes)}</td>
        <td style="padding:6px 8px;font-size:11px;color:${B.textMid};white-space:nowrap;">${fmtDur(b.duration_seconds)}</td>
        <td style="padding:6px 8px;font-size:11px;color:${B.textMid};white-space:nowrap;">${fmtTime(b.backed_up_at)}</td>
      </tr>`);
    }).join("");

    const summaryChips = [
      totalOk      > 0 ? `<span style="display:inline-block;background:#ECFDF5;color:#059669;border:1px solid #A7F3D0;padding:2px 10px;border-radius:10px;font-size:11px;font-weight:700;margin-right:6px;">${totalOk} OK</span>` : "",
      totalWarning > 0 ? `<span style="display:inline-block;background:#FFFBEB;color:#B45309;border:1px solid #FDE68A;padding:2px 10px;border-radius:10px;font-size:11px;font-weight:700;margin-right:6px;">${totalWarning} Warning</span>` : "",
      totalFailed  > 0 ? `<span style="display:inline-block;background:#FEF2F2;color:#DC2626;border:1px solid #FECACA;padding:2px 10px;border-radius:10px;font-size:11px;font-weight:700;margin-right:6px;">${totalFailed} Fallido</span>` : "",
    ].join("");

    const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${B.bg};font-family:${EMAIL_FONT};">
  <tr><td align="center" style="padding:32px 24px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;border:1px solid ${B.border};">
  <tr><td style="padding:28px;">

    ${emailHeader({ senderName, label: badgeText, accentColor: badgeColor, title: client.company_name, subtitle: dateLabel })}

    <div style="margin-bottom:16px;">${summaryChips}</div>

    <table style="width:100%;border-collapse:collapse;">
      <tr>
        <th style="text-align:left;padding:4px 8px;font-size:10px;color:${B.textSoft};font-weight:600;text-transform:uppercase;letter-spacing:.5px;">Servicio</th>
        <th style="text-align:left;padding:4px 8px;font-size:10px;color:${B.textSoft};font-weight:600;text-transform:uppercase;letter-spacing:.5px;">Job</th>
        <th style="text-align:left;padding:4px 8px;font-size:10px;color:${B.textSoft};font-weight:600;text-transform:uppercase;letter-spacing:.5px;">Estado</th>
        <th style="text-align:left;padding:4px 8px;font-size:10px;color:${B.textSoft};font-weight:600;text-transform:uppercase;letter-spacing:.5px;">Tamaño</th>
        <th style="text-align:left;padding:4px 8px;font-size:10px;color:${B.textSoft};font-weight:600;text-transform:uppercase;letter-spacing:.5px;">Dur.</th>
        <th style="text-align:left;padding:4px 8px;font-size:10px;color:${B.textSoft};font-weight:600;text-transform:uppercase;letter-spacing:.5px;">Hora</th>
      </tr>
      ${tableRows}
    </table>

    ${emailPortalPanel({ companyName: client.company_name, portalUrl })}
    ${emailMeta(senderName)}

  </td></tr>
  </table>
  </td></tr>
</table>`;

    if (previewMode) {
      previews.push({ client_name: client.company_name, html });
      continue;
    }

    const subject = totalFailed > 0
      ? `⚠ Alerta de backup — ${client.company_name} — ${dateLabel}`
      : `Resumen de backups — ${client.company_name} — ${dateLabel}`;

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM_EMAIL, to: recipients, subject, html }),
    });

    const resendData = resendRes.ok ? await resendRes.json() as { id?: string } : null;

    // Log
    for (const email of recipients) {
      await supabase.from("email_opens").insert({
        user_id:         client.user_id,
        client_id:       clientId,
        client_email:    email,
        resend_email_id: resendData?.id ?? null,
        email_type:      "backup_digest",
        subject,
        sent_at:         new Date().toISOString(),
      });
    }

    sent++;
  }

  if (previewMode) {
    return new Response(JSON.stringify({ previews }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  return new Response(JSON.stringify({ sent }), { status: 200 });
});
