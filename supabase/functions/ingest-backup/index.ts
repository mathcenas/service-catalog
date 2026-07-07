import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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
        const durationStr = duration_seconds != null ? `${Math.round(duration_seconds / 60)} min` : null;
        const sizeStr = size_bytes != null
          ? size_bytes >= 1073741824 ? `${(size_bytes / 1073741824).toFixed(2)} GB`
          : size_bytes >= 1048576 ? `${(size_bytes / 1048576).toFixed(1)} MB`
          : `${(size_bytes / 1024).toFixed(1)} KB`
          : null;

        const html = `
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;">
            <div style="display:flex;align-items:center;gap:12px;padding-bottom:16px;border-bottom:2px solid ${color};margin-bottom:24px;">
              <div style="background:${color}20;border:1px solid ${color}40;border-radius:8px;padding:8px 14px;">
                <span style="color:${color};font-size:13px;font-weight:700;letter-spacing:1px;">${statusLabel}</span>
              </div>
              <div>
                <h2 style="margin:0;font-size:17px;color:#1e293b;">Backup ${statusLabel}</h2>
                <p style="margin:2px 0 0;font-size:12px;color:#64748b;">${serviceName}</p>
              </div>
            </div>
            <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px;">
              ${job_name ? `<tr><td style="padding:6px 0;color:#64748b;width:120px;">Job</td><td style="color:#1e293b;font-weight:500;">${job_name}</td></tr>` : ""}
              <tr><td style="padding:6px 0;color:#64748b;">Status</td><td style="color:${color};font-weight:600;">${statusLabel}</td></tr>
              ${sizeStr ? `<tr><td style="padding:6px 0;color:#64748b;">Size</td><td style="color:#1e293b;">${sizeStr}</td></tr>` : ""}
              ${durationStr ? `<tr><td style="padding:6px 0;color:#64748b;">Duration</td><td style="color:#1e293b;">${durationStr}</td></tr>` : ""}
              <tr><td style="padding:6px 0;color:#64748b;">Time</td><td style="color:#1e293b;">${new Date(backedUpAt).toLocaleString("en-US",{dateStyle:"medium",timeStyle:"short"})}</td></tr>
              ${details ? `<tr><td style="padding:6px 0;color:#64748b;vertical-align:top;">Details</td><td style="color:#475569;white-space:pre-wrap;">${details}</td></tr>` : ""}
            </table>
            <p style="color:#94a3b8;font-size:11px;text-align:center;margin:0;">Cenas-Support — Automated Backup Alert</p>
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
