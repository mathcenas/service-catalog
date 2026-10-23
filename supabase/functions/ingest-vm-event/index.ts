import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { B, EMAIL_FONT, LOGO_URL } from "../_shared/emailBrand.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://servicios.cenas-support.com",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey, X-Ingest-Secret",
};

// event_type values the script sends
// vm_maintenance_scheduled  — pre-programador calculó la ventana
// vm_maintenance_start      — backup arrancó, VMs suspendidas
const VALID_TYPES = ["vm_maintenance_scheduled", "vm_maintenance_start"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const ingestSecret = req.headers.get("X-Ingest-Secret");
    if (!ingestSecret) {
      return new Response(JSON.stringify({ error: "Missing X-Ingest-Secret" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const {
      service_id,
      event_type,
      // vm_maintenance_scheduled
      start_time,       // "03:15"
      finish_by,        // "06:30"
      estimated_min,    // 42
      vm_count,         // 2
      total_gb,         // 85.3
      // vm_maintenance_start
      vms,              // ["SRV-CONTA", "SRV-VENTAS"]
      // shared
      host,             // hostname
      suppress_email,
    } = body;

    if (!service_id || !event_type) {
      return new Response(JSON.stringify({ error: "service_id and event_type are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!VALID_TYPES.includes(event_type)) {
      return new Response(JSON.stringify({ error: `event_type must be one of: ${VALID_TYPES.join(", ")}` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
      return new Response(JSON.stringify({ error: "Service not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!service.ingest_secret || service.ingest_secret !== ingestSecret) {
      return new Response(JSON.stringify({ error: "Invalid secret" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const svcName = service.business_name || service.name || "Servidor";
    const hostLabel = host || "servidor";

    // Log in device_events
    const message = event_type === "vm_maintenance_scheduled"
      ? `Backup programado ${start_time} — ${vm_count} VM(s) — ~${estimated_min} min — ${total_gb} GB`
      : `Backup iniciado — ${(vms || []).join(", ")} suspendidas`;

    await supabaseAdmin.from("device_events").insert({
      user_id:    service.user_id,
      service_id,
      event_type,
      status:     "info",
      message,
      timestamp:  new Date().toISOString(),
    });

    // Email
    const toEmail = service.notification_email || service.provider_email;
    if (!toEmail || suppress_email) {
      return new Response(
        JSON.stringify({ success: true, email: "skipped" }),
        { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ success: true, email: "no_resend_key" }), {
        status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const TZ = "America/Montevideo";
    const nowStr = new Date().toLocaleString("es-UY", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
      hour: "2-digit", minute: "2-digit", timeZoneName: "short", timeZone: TZ,
    });

    let subject: string;
    let labelText: string;
    let labelColor: string;
    let labelBg: string;
    let labelBorder: string;
    let bodyContent: string;

    if (event_type === "vm_maintenance_scheduled") {
      subject = `[${svcName}] Backup nocturno programado — ${start_time}`;
      labelText = "Mantenimiento Programado";
      labelColor = "#0284c7"; labelBg = "#eff6ff"; labelBorder = "#bae6fd";
      bodyContent = `
        <p style="color:${B.textMain};font-size:15px;line-height:1.6;margin:0 0 16px;">
          Esta noche se realizará el backup nocturno automático de las máquinas virtuales de <strong>${svcName}</strong>.
        </p>
        <div style="background:${B.bg};border:1px solid ${B.border};border-radius:8px;padding:20px;margin:0 0 16px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td style="padding:6px 0;color:${B.textMid};font-size:13px;width:40%;">Servidor</td>
              <td style="padding:6px 0;color:${B.textMain};font-size:13px;font-weight:600;">${hostLabel}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:${B.textMid};font-size:13px;">VMs</td>
              <td style="padding:6px 0;color:${B.textMain};font-size:13px;font-weight:600;">${vm_count ?? "—"}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:${B.textMid};font-size:13px;">Volumen total</td>
              <td style="padding:6px 0;color:${B.textMain};font-size:13px;font-weight:600;">${total_gb != null ? total_gb + " GB" : "—"}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:${B.textMid};font-size:13px;">Inicio estimado</td>
              <td style="padding:6px 0;color:${B.textMain};font-size:13px;font-weight:600;">${start_time ?? "—"}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:${B.textMid};font-size:13px;">Duración estimada</td>
              <td style="padding:6px 0;color:${B.textMain};font-size:13px;font-weight:600;">~${estimated_min != null ? estimated_min + " min" : "—"}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:${B.textMid};font-size:13px;">VMs disponibles antes de</td>
              <td style="padding:6px 0;color:#16a34a;font-size:13px;font-weight:600;">${finish_by ?? "—"}</td>
            </tr>
          </table>
        </div>
        <p style="color:${B.textMid};font-size:13px;line-height:1.5;margin:0 0 12px;">
          Durante el backup cada VM será suspendida brevemente para garantizar una copia consistente. Al finalizar, todas las VMs reanudan automáticamente.
        </p>
      `;
    } else {
      // vm_maintenance_start
      const vmList = (vms || []) as string[];
      subject = `[${svcName}] Backup iniciado — VMs en mantenimiento`;
      labelText = "En Mantenimiento";
      labelColor = "#b45309"; labelBg = "#fffbeb"; labelBorder = "#fcd34d";
      bodyContent = `
        <p style="color:${B.textMain};font-size:15px;line-height:1.6;margin:0 0 16px;">
          El backup nocturno de <strong>${svcName}</strong> acaba de iniciarse.
          Las siguientes máquinas virtuales están siendo suspendidas temporalmente:
        </p>
        <div style="background:${B.bg};border:1px solid ${B.border};border-radius:8px;padding:16px 20px;margin:0 0 16px;">
          ${vmList.map(v => `
            <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid ${B.border};">
              <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#f59e0b;"></span>
              <span style="color:${B.textMain};font-size:14px;font-weight:600;">${v}</span>
            </div>`).join("")}
          <p style="margin:10px 0 0;color:${B.textMid};font-size:12px;">
            Servidor: ${hostLabel} — Las VMs reanudan automáticamente al finalizar la copia.
          </p>
        </div>
      `;
    }

    const logoHtml = `<img src="${LOGO_URL}" alt="Cenas IT" height="28" style="display:block;height:28px;width:auto;border:0;" />`;
    const FONT = `'Plus Jakarta Sans',${EMAIL_FONT}`;

    const html = `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${B.bg};font-family:${FONT};">
        <tr><td align="center" style="padding:32px 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;border:1px solid ${B.border};">
        <tr><td style="padding:28px;">

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid ${B.border};">
            <tr>
              <td valign="middle">${logoHtml}</td>
              <td valign="middle" align="right">
                <table role="presentation" cellpadding="0" cellspacing="0" style="background:${labelBg};border:1px solid ${labelBorder};border-radius:8px;">
                  <tr><td style="padding:4px 12px;"><span style="color:${labelColor};font-size:11px;font-weight:700;letter-spacing:.5px;">${labelText}</span></td></tr>
                </table>
              </td>
            </tr>
          </table>

          ${bodyContent}

          <p style="color:${B.textMid};font-size:12px;margin:16px 0 0;padding-top:16px;border-top:1px solid ${B.border};">
            Enviado: ${nowStr}
          </p>

        </td></tr>
        </table>
        </td></tr>
      </table>
    `;

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: Deno.env.get("RESEND_FROM_EMAIL") || "Cenas-Support Alerts <alerts@updates.cenas.uy>",
        reply_to: Deno.env.get("RESEND_REPLY_TO") || "mathias@cenas.uy",
        to: [toEmail],
        subject,
        html,
      }),
    });

    const emailOk = resendRes.ok;
    if (!emailOk) {
      const errBody = await resendRes.text();
      console.error("Resend error:", errBody);
    }

    return new Response(
      JSON.stringify({ success: true, email: emailOk ? "sent" : "failed" }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
