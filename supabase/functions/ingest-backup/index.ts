import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { B, EMAIL_FONT, LOGO_URL } from "../_shared/emailBrand.ts";
import { canSendNotification } from "../_shared/notificationLock.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://servicios.cenas-support.com",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey, X-Ingest-Secret",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const { service_id, job_name, status, size_bytes, duration_seconds, details, backed_up_at, suppress_email } = body;

    if (!service_id) {
      return new Response(
        JSON.stringify({ error: "service_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const validStatuses = ["success", "warning", "failed"];
    const normalizedStatus = (status || "success").toLowerCase();
    if (!validStatuses.includes(normalizedStatus)) {
      return new Response(
        JSON.stringify({ error: `status must be one of: ${validStatuses.join(", ")}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ingestSecret = req.headers.get("X-Ingest-Secret");
    if (!ingestSecret) {
      return new Response(
        JSON.stringify({ error: "Missing X-Ingest-Secret header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: service, error: svcErr } = await supabaseAdmin
      .from("services")
      .select("user_id, ingest_secret, name, business_name, notification_email, provider_email")
      .eq("id", service_id)
      .maybeSingle();

    if (svcErr || !service) {
      return new Response(
        JSON.stringify({ error: "Service not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!service.ingest_secret || service.ingest_secret !== ingestSecret) {
      return new Response(
        JSON.stringify({ error: "Invalid secret" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const backedUpAt = backed_up_at || new Date().toISOString();

    // Insert backup history record
    const { error: insertErr } = await supabaseAdmin
      .from("service_backups")
      .insert({
        user_id: service.user_id,
        service_id,
        job_name: job_name || null,
        status: normalizedStatus,
        size_bytes: size_bytes ?? null,
        duration_seconds: duration_seconds ?? null,
        details: details || null,
        backed_up_at: backedUpAt,
      });

    if (insertErr) {
      return new Response(
        JSON.stringify({ error: insertErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update last_backup_at and last_backup_size_bytes on the service if successful or warning
    if (normalizedStatus !== "failed") {
      const updatePayload: Record<string, unknown> = { last_backup_at: backedUpAt };
      if (size_bytes != null) updatePayload.last_backup_size_bytes = size_bytes;
      await supabaseAdmin.from("services").update(updatePayload).eq("id", service_id);
    }

    // Send email notification (unless suppressed by caller or rate-limited)
    if (suppress_email) {
      console.log("[ingest-backup] email suprimido por suppress_email=true");
    }
    if (!suppress_email) {
      // Rate limiting: un email por (service_id, event_type) por día para success,
      // 15 min para warning/failed para no suprimir alertas reales.
      const eventType = `backup_${normalizedStatus}`;
      const cooldown  = normalizedStatus === "success" ? 23 * 60 : 15;
      const allowed   = await canSendNotification(supabaseAdmin, service_id, eventType, cooldown);
      if (!allowed) {
        return new Response(
          JSON.stringify({ success: true, email: "suppressed_rate_limit", received_at: new Date().toISOString() }),
          { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

      if (!RESEND_API_KEY) {
        console.log("[ingest-backup] RESEND_API_KEY no configurado, omitiendo email");
      } else {
        const { data: svcRow, error: svcRowErr } = await supabaseAdmin
          .from("services")
          .select("client_id, name, business_name, clients(company_name, user_id)")
          .eq("id", service_id)
          .maybeSingle();

        if (svcRowErr) console.error("[ingest-backup] error al obtener servicio+cliente:", svcRowErr.message);

        // Build recipient list from client_contacts (primary) + service notification_email + env fallback
        const recipients = new Set<string>();
        const clientId = (svcRow as any)?.client_id;
        const contactMap = new Map<string, string>(); // email → contact_id

        if (clientId) {
          const { data: contacts } = await supabaseAdmin
            .from("client_contacts")
            .select("id, email")
            .eq("client_id", clientId)
            .eq("digest_frequency", "daily");
          for (const c of (contacts || []) as { id: string; email: string }[]) {
            if (c.email) {
              recipients.add(c.email);
              contactMap.set(c.email, c.id);
            }
          }
        }

        if ((service as any).notification_email) recipients.add((service as any).notification_email);

        // provider_email siempre va como CC (IT proveedor), aunque haya otros destinatarios
        const providerEmail = (service as any).provider_email;

        if (recipients.size === 0) {
          const fallback = Deno.env.get("RESEND_KOPIA_TO") || Deno.env.get("RESEND_REPLY_TO");
          if (fallback) recipients.add(fallback);
        }

        const clientName = (svcRow as any)?.clients?.company_name || null;
        console.log(`[ingest-backup] destinatarios: ${[...recipients].join(", ") || "(ninguno)"} | cliente: ${clientName || "null"}`);

        if (recipients.size > 0) {
        const serviceName = service.business_name || service.name || service_id;
        const isFailure = normalizedStatus === "failed";
        const isWarning = normalizedStatus === "warning";
        const statusLabel = isFailure ? "FAILED" : isWarning ? "WARNING" : "OK";
        const durationStr = duration_seconds != null ? `${Math.round(duration_seconds / 60)} min` : "";
        const sizeStr = size_bytes != null
          ? size_bytes >= 1073741824 ? `${(size_bytes / 1073741824).toFixed(2)} GB`
          : size_bytes >= 1048576 ? `${(size_bytes / 1048576).toFixed(1)} MB`
          : `${(size_bytes / 1024).toFixed(1)} KB`
          : "";

        const statusColor  = isFailure ? "#DC2626" : isWarning ? "#B45309" : "#059669";
        const statusBg     = isFailure ? "#FEF2F2" : isWarning ? "#FFFBEB" : "#ECFDF5";
        const statusBorder = isFailure ? "#FECACA" : isWarning ? "#FDE68A" : "#A7F3D0";
        const statusLabel2 = isFailure ? "Backup fallido" : isWarning ? "Backup con advertencia" : "Backup exitoso";
        const hora = new Date(backedUpAt).toLocaleString("es-UY", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Montevideo" });

        const htmlBody = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;font-family:${EMAIL_FONT};">
  <tr><td align="center" style="padding:32px 24px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid ${B.border};">
  <tr>
    <td style="padding:20px 24px;border-bottom:2px solid ${statusColor};">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td valign="middle">
            <img src="${LOGO_URL}" alt="Cenas IT" height="28" style="display:block;height:28px;width:auto;border:0;">
          </td>
          <td valign="middle" align="right">
            <table role="presentation" cellpadding="0" cellspacing="0" style="background:${statusBg};border:1px solid ${statusBorder};border-radius:8px;">
              <tr><td style="padding:5px 12px;"><span style="color:${statusColor};font-size:11px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;">${statusLabel}</span></td></tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>
  <tr>
    <td style="padding:20px 24px 0;">
      ${clientName ? `<div style="font-size:11px;font-weight:600;color:${B.textMid};text-transform:uppercase;letter-spacing:.6px;margin-bottom:4px;">${clientName}</div>` : ""}
      <div style="font-size:16px;font-weight:700;color:${B.primary};">${serviceName}</div>
      ${job_name ? `<div style="font-size:12px;color:${B.textMid};margin-top:2px;">${job_name}</div>` : ""}
    </td>
  </tr>
  <tr>
    <td style="padding:16px 24px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${statusBg};border:1px solid ${statusBorder};border-radius:8px;">
        <tr><td style="padding:14px 16px;">
          <div style="font-size:13px;font-weight:700;color:${statusColor};margin-bottom:8px;">${statusLabel2}</div>
          ${details ? `<div style="font-size:13px;color:${B.textMain};line-height:1.5;margin-bottom:8px;">${details}</div>` : ""}
          <table role="presentation" cellpadding="0" cellspacing="0" style="font-size:12px;color:${B.textMid};">
            ${sizeStr ? `<tr><td style="padding:2px 0;padding-right:16px;">Tamaño</td><td style="padding:2px 0;font-weight:600;color:${B.primary};">${sizeStr}</td></tr>` : ""}
            ${durationStr ? `<tr><td style="padding:2px 0;padding-right:16px;">Duración</td><td style="padding:2px 0;font-weight:600;color:${B.primary};">${durationStr}</td></tr>` : ""}
            <tr><td style="padding:2px 0;padding-right:16px;">Fecha</td><td style="padding:2px 0;font-weight:600;color:${B.primary};">${hora}</td></tr>
          </table>
        </td></tr>
      </table>
    </td>
  </tr>
  <tr>
    <td style="padding:16px 24px 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${B.border};">
        <tr><td style="padding-top:12px;text-align:center;">
          <span style="color:${B.textSoft};font-size:11px;">Cenas IT Solutions &mdash; Procesos bajo norma ISO/IEC 20000</span>
        </td></tr>
      </table>
    </td>
  </tr>
  </table>
  </td></tr>
</table>`;

        const resendRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: Deno.env.get("RESEND_FROM_EMAIL") || "Cenas IT Backups <backups@updates.cenas.uy>",
            reply_to: Deno.env.get("RESEND_REPLY_TO_ADDRESS") || "info@cenas.uy",
            to: Array.from(recipients),
            ...(providerEmail ? { cc: [providerEmail] } : {}),
            subject: `[Backup ${statusLabel}] ${clientName ? `${clientName} — ` : ""}${serviceName}${job_name ? ` — ${job_name}` : ""}`,
            html: htmlBody,
          }),
        });

        const resendData = resendRes.ok ? await resendRes.json() as { id?: string } : null;
        const resendEmailId = resendData?.id ?? null;

        // Registrar en email_opens por cada contacto para tracking
        const now = new Date().toISOString();
        const userId = (svcRow as any)?.clients?.user_id ?? null;
        for (const email of recipients) {
          const contactId = contactMap.get(email) ?? null;
          if (contactId) {
            await supabaseAdmin.from("email_opens").insert({
              user_id:         userId,
              client_id:       clientId ?? null,
              contact_id:      contactId,
              client_email:    email,
              resend_email_id: resendEmailId,
              email_type:      `backup_${normalizedStatus}`,
              sent_at:         now,
            });
          }
        }
        } // end recipients.size > 0
      } // end else RESEND_API_KEY
    } // end if !suppress_email

    return new Response(
      JSON.stringify({ success: true, received_at: new Date().toISOString() }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
