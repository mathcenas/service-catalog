import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { B, EMAIL_FONT, emailMeta, emailLogo } from "../_shared/emailBrand.ts";

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
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
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

    const replyTo = client.email || undefined;
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const toEmail = Deno.env.get("RESEND_REPLY_TO") || "mathias@cenas.uy";

    const priorityPairs: Record<string, { text: string; bg: string; border: string }> = {
      Low:      { text: "#059669", bg: "#ECFDF5", border: "#A7F3D0" },
      Medium:   { text: "#B45309", bg: "#FFFBEB", border: "#FDE68A" },
      High:     { text: "#C2410C", bg: "#FFF7ED", border: "#FDBA74" },
      Critical: { text: "#DC2626", bg: "#FEF2F2", border: "#FECACA" },
    };

    const companyName = settings?.company_name || "Cenas IT";
    const logoHtmlInner = settings?.logo_url
      ? `<img src="${settings.logo_url}" alt="Logo" style="max-height:32px;max-width:140px;display:block;border:0;" />`
      : emailLogo(companyName);

    const pPair = priorityPairs[priority] || priorityPairs.Medium;

    const htmlBody = `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;font-family:${EMAIL_FONT};">
        <tr><td align="center" style="padding:32px 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;border:1px solid ${B.border};">
        <tr><td style="padding:28px;">

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid ${B.border};">
            <tr>
              <td valign="middle">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td valign="middle" style="padding-right:10px;">
                      <div style="background:${B.primary};padding:7px 13px;border-radius:7px;display:inline-block;">
                        <span style="color:${B.accent};font-size:11px;font-weight:700;letter-spacing:.5px;">${companyName.toUpperCase()}</span>
                      </div>
                    </td>
                    ${logoHtmlInner ? `<td valign="middle">${logoHtmlInner}</td>` : ""}
                  </tr>
                </table>
                <div style="font-size:16px;font-weight:700;color:${B.primary};margin-top:8px;">Solicitud de Soporte</div>
              </td>
              <td valign="middle" align="right">
                <table role="presentation" cellpadding="0" cellspacing="0" style="background:${pPair.bg};border:1px solid ${pPair.border};border-radius:8px;">
                  <tr><td style="padding:4px 12px;"><span style="color:${pPair.text};font-size:11px;font-weight:700;letter-spacing:.5px;">${priority}</span></td></tr>
                </table>
              </td>
            </tr>
          </table>

          <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
            <tr>
              <td style="padding:8px 12px;background:${B.bg};border:1px solid ${B.border};font-size:12px;color:${B.textMid};width:120px;">Cliente</td>
              <td style="padding:8px 12px;border:1px solid ${B.border};font-size:14px;color:${B.primary};font-weight:500;">${esc(client.company_name)}</td>
            </tr>
            <tr>
              <td style="padding:8px 12px;background:${B.bg};border:1px solid ${B.border};font-size:12px;color:${B.textMid};">Contacto</td>
              <td style="padding:8px 12px;border:1px solid ${B.border};font-size:14px;color:${B.textMain};">${esc(client.contact_name || client.email || "")}</td>
            </tr>
            <tr>
              <td style="padding:8px 12px;background:${B.bg};border:1px solid ${B.border};font-size:12px;color:${B.textMid};">Servicio</td>
              <td style="padding:8px 12px;border:1px solid ${B.border};font-size:14px;color:${B.textMain};">${esc(serviceName)}</td>
            </tr>
          </table>

          <div style="background:${B.bg};border:1px solid ${B.border};border-radius:8px;padding:16px;margin-bottom:20px;">
            <p style="color:${B.primary};margin:0 0 8px;font-size:15px;font-weight:600;">${esc(subject)}</p>
            <p style="color:#475569;margin:0;font-size:14px;line-height:1.6;white-space:pre-wrap;">${esc(message)}</p>
          </div>

          <p style="color:${B.textSoft};font-size:11px;margin:0;text-align:center;">
            Enviado desde el Portal de Clientes &bull; ${new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
          </p>
          ${emailMeta(companyName)}

        </td></tr>
        </table>
        </td></tr>
      </table>
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
        subject: `[Support - ${priority}] ${esc(subject)} (${esc(client.company_name)})`,
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
