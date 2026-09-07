import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { B, EMAIL_FONT, emailLogo } from "../_shared/emailBrand.ts";

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
    const { service_id, job_name, status, size_bytes, duration_seconds, details, backed_up_at } = body;

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
      .select("user_id, ingest_secret")
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

    // Send alert email on warning or failed
    if (normalizedStatus !== "success") {
      const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
      const alertTo = Deno.env.get("RESEND_REPLY_TO") || "mathias@cenas.uy";

      if (RESEND_API_KEY) {
        const { data: svcRow } = await supabaseAdmin
          .from("services")
          .select("name, business_name")
          .eq("id", service_id)
          .maybeSingle();

        const serviceName = svcRow?.business_name || svcRow?.name || service_id;
        const isFailure = normalizedStatus === "failed";
        const statusLabel = isFailure ? "FAILED" : "WARNING";
        const color = isFailure ? "#ef4444" : "#f97316";
        const colorBg = isFailure ? "#fef2f2" : "#fff7ed";
        const colorBorder = isFailure ? "#fecaca" : "#fed7aa";
        const durationStr = duration_seconds != null ? `${Math.round(duration_seconds / 60)} min` : null;
        const sizeStr = size_bytes != null
          ? size_bytes >= 1073741824 ? `${(size_bytes / 1073741824).toFixed(2)} GB`
          : size_bytes >= 1048576 ? `${(size_bytes / 1048576).toFixed(1)} MB`
          : `${(size_bytes / 1024).toFixed(1)} KB`
          : null;

        const html = `
          <div style="font-family:${EMAIL_FONT};max-width:560px;margin:0 auto;padding:32px 24px;background:#f8fafc;">
            <div style="background:#ffffff;border-radius:12px;padding:24px;border:1px solid ${B.border};">

              <table style="width:100%;border-collapse:collapse;padding-bottom:16px;border-bottom:2px solid ${color};margin-bottom:20px;">
                <tr>
                  <td style="vertical-align:middle;padding-right:12px;width:1%;">
                    ${emailLogo(serviceName)}
                  </td>
                  <td style="vertical-align:middle;padding-right:12px;width:1%;">
                    <div style="background:${colorBg};border:1px solid ${colorBorder};border-radius:6px;padding:4px 10px;white-space:nowrap;">
                      <span style="color:${color};font-size:11px;font-weight:700;letter-spacing:.8px;">${statusLabel}</span>
                    </div>
                  </td>
                  <td style="vertical-align:middle;">
                    <div style="font-size:15px;font-weight:700;color:${B.primary};line-height:1.2;">Backup ${statusLabel}</div>
                    <div style="font-size:12px;color:${B.textMid};margin-top:2px;">${serviceName}</div>
                  </td>
                </tr>
              </table>

              <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px;">
                ${job_name ? `<tr><td style="padding:6px 0;color:${B.textMid};width:100px;">Job</td><td style="color:${B.primary};font-weight:600;">${job_name}</td></tr>` : ""}
                <tr><td style="padding:6px 0;color:${B.textMid};">Status</td><td style="color:${color};font-weight:700;">${statusLabel}</td></tr>
                ${sizeStr ? `<tr><td style="padding:6px 0;color:${B.textMid};">Tamaño</td><td style="color:${B.primary};">${sizeStr}</td></tr>` : ""}
                ${durationStr ? `<tr><td style="padding:6px 0;color:${B.textMid};">Duración</td><td style="color:${B.primary};">${durationStr}</td></tr>` : ""}
                <tr><td style="padding:6px 0;color:${B.textMid};">Hora</td><td style="color:${B.primary};">${new Date(backedUpAt).toLocaleString("es-UY",{dateStyle:"medium",timeStyle:"short"})}</td></tr>
                ${details ? `<tr><td style="padding:10px 0 6px 0;color:${B.textMid};vertical-align:top;" colspan="2"><div style="font-size:11px;font-weight:600;color:${B.textMid};margin-bottom:4px;">Detalles del error:</div><div style="color:#b91c1c;background:#fff1f1;padding:10px;border-radius:6px;font-family:monospace;font-size:12px;white-space:pre-wrap;border:1px solid #fca5a5;">${details}</div></td></tr>` : ""}
              </table>

              <div style="border-top:1px solid ${B.border};padding-top:12px;text-align:center;">
                <p style="color:${B.textSoft};font-size:11px;margin:0;">
                  <strong>Cenas IT Solutions</strong> — Alerta automática de monitoreo &amp; backup
                </p>
                <p style="color:${B.textSoft};font-size:10px;margin:4px 0 0 0;">
                  Procesos bajo norma ISO/IEC 20000 | <a href="https://cenas.uy" style="color:${B.textSoft};text-decoration:none;">cenas.uy</a>
                </p>
              </div>

            </div>
          </div>`;

        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: Deno.env.get("RESEND_FROM_EMAIL") || "Cenas-Support Alerts <alerts@cenas-support.com>",
            to: [alertTo],
            subject: `[Backup ${statusLabel}] ${serviceName}${job_name ? ` — ${job_name}` : ""}`,
            html,
          }),
        });
      }
    }

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
