import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { B, EMAIL_FONT, emailMeta } from "../_shared/emailBrand.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface SupportPayload {
  token: string;
  service_id?: string;
  priority: "Low" | "Medium" | "High" | "Critical";
  subject: string;
  message: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const payload: SupportPayload = await req.json();
    const { token, service_id, priority, subject, message } = payload;

    if (!token || !subject || !message) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: token, subject, message" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: tokenRow } = await supabase
      .from("client_share_tokens")
      .select("client_id, user_id")
      .eq("token", token)
      .maybeSingle();

    if (!tokenRow) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: client } = await supabase
      .from("clients")
      .select("company_name, contact_name, email")
      .eq("id", tokenRow.client_id)
      .single();

    if (!client) {
      return new Response(
        JSON.stringify({ error: "Client not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let serviceName = "General";
    if (service_id) {
      const { data: svc } = await supabase
        .from("services")
        .select("business_name, name")
        .eq("id", service_id)
        .single();
      if (svc) serviceName = svc.business_name || svc.name;
    }

    const { data: settings } = await supabase
      .from("user_settings")
      .select("company_name, logo_url")
      .eq("user_id", tokenRow.user_id)
      .maybeSingle();

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      return new Response(
        JSON.stringify({ error: "RESEND_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const replyTo = client.email;
    const toEmail = Deno.env.get("RESEND_REPLY_TO") || "mathias@cenas.uy";

    const priorityColors: Record<string, string> = {
      Low: "#22c55e",
      Medium: "#eab308",
      High: "#f97316",
      Critical: "#ef4444",
    };

    const companyName = settings?.company_name || "Cenas IT";
    const logoHtmlInner = settings?.logo_url
      ? `<img src="${settings.logo_url}" alt="Logo" style="max-height:32px;max-width:140px;" />`
      : "";

    const htmlBody = `
      <div style="font-family:${EMAIL_FONT};max-width:600px;margin:0 auto;padding:32px 24px;background:#f8fafc;">
        <div style="background:#ffffff;border-radius:12px;padding:28px;border:1px solid ${B.border};">

          <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid ${B.border};">
            <div style="background:${B.primary};padding:7px 13px;border-radius:7px;flex-shrink:0;">
              <span style="color:${B.accent};font-size:11px;font-weight:700;letter-spacing:.5px;">${companyName.toUpperCase()}</span>
            </div>
            ${logoHtmlInner ? `<div style="flex-shrink:0;">${logoHtmlInner}</div>` : ""}
            <div>
              <span style="display:inline-block;background:${priorityColors[priority]}18;color:${priorityColors[priority]};border:1px solid ${priorityColors[priority]}40;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:700;">${priority}</span>
              <div style="font-size:16px;font-weight:700;color:${B.primary};margin-top:4px;">Solicitud de Soporte</div>
            </div>
          </div>

          <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
            <tr>
              <td style="padding:8px 12px;background:${B.bg};border:1px solid ${B.border};font-size:12px;color:${B.textMid};width:120px;">Cliente</td>
              <td style="padding:8px 12px;border:1px solid ${B.border};font-size:14px;color:${B.primary};font-weight:500;">${client.company_name}</td>
            </tr>
            <tr>
              <td style="padding:8px 12px;background:${B.bg};border:1px solid ${B.border};font-size:12px;color:${B.textMid};">Contacto</td>
              <td style="padding:8px 12px;border:1px solid ${B.border};font-size:14px;color:${B.textMain};">${client.contact_name || client.email}</td>
            </tr>
            <tr>
              <td style="padding:8px 12px;background:${B.bg};border:1px solid ${B.border};font-size:12px;color:${B.textMid};">Servicio</td>
              <td style="padding:8px 12px;border:1px solid ${B.border};font-size:14px;color:${B.textMain};">${serviceName}</td>
            </tr>
          </table>

          <div style="background:${B.bg};border:1px solid ${B.border};border-radius:8px;padding:16px;margin-bottom:20px;">
            <p style="color:${B.primary};margin:0 0 8px;font-size:15px;font-weight:600;">${subject}</p>
            <p style="color:#475569;margin:0;font-size:14px;line-height:1.6;white-space:pre-wrap;">${message}</p>
          </div>

          <p style="color:${B.textSoft};font-size:11px;margin:0;text-align:center;">
            Enviado desde el Portal de Clientes &bull; ${new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
          </p>
          ${emailMeta(companyName)}
        </div>
      </div>
    `;

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: Deno.env.get("RESEND_FROM_EMAIL") || "Cenas-Support <notificaciones@updates.cenas.uy>",
        reply_to: replyTo,
        to: [toEmail],
        subject: `[Support - ${priority}] ${subject} (${client.company_name})`,
        html: htmlBody,
      }),
    });

    if (!resendRes.ok) {
      const errBody = await resendRes.text();
      return new Response(
        JSON.stringify({ error: "Failed to send", details: errBody }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const resendData = await resendRes.json();

    return new Response(
      JSON.stringify({ success: true, id: resendData.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Internal error", message: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
