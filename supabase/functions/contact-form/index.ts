import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { B, EMAIL_FONT, LOGO_URL } from "../_shared/emailBrand.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: corsHeaders });

  const { name, email, company, message, reason } = await req.json();
  if (!name || !email || !message) {
    return new Response(JSON.stringify({ error: "name, email y message son requeridos" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  const TO_EMAIL       = Deno.env.get("CONTACT_FORM_TO") || "info@cenas.uy";
  const FROM_EMAIL     = Deno.env.get("RESEND_FROM_EMAIL") || "Cenas IT <info@cenas.uy>";

  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ ok: true, skipped: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const REASON_LABELS: Record<string, string> = {
    access:   "Recuperar acceso al portal",
    support:  "Soporte técnico",
    billing:  "Consulta de facturación",
    other:    "Otro",
  };

  const reasonLabel = REASON_LABELS[reason] ?? reason ?? "Consulta general";

  const html = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;font-family:${EMAIL_FONT};">
  <tr><td align="center" style="padding:32px 24px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid ${B.border};">
    <tr><td style="padding:24px 24px 0;">
      <img src="${LOGO_URL}" alt="Cenas IT" height="26" style="display:block;height:26px;width:auto;border:0;margin-bottom:16px;">
      <div style="font-size:11px;font-weight:700;color:${B.textMid};text-transform:uppercase;letter-spacing:.6px;margin-bottom:4px;">Nueva consulta desde cenas-support.com</div>
      <div style="font-size:18px;font-weight:800;color:${B.primary};margin-bottom:16px;">${reasonLabel}</div>
    </td></tr>
    <tr><td style="padding:0 24px 20px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
        style="background:#F8FAFC;border:1px solid ${B.border};border-radius:8px;">
        <tr><td style="padding:16px;">
          <table role="presentation" cellpadding="0" cellspacing="0" style="font-size:12px;color:${B.textMid};width:100%;">
            <tr>
              <td style="padding:4px 0;padding-right:16px;white-space:nowrap;font-weight:600;">Nombre</td>
              <td style="padding:4px 0;color:${B.primary};font-weight:700;">${name}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;padding-right:16px;white-space:nowrap;font-weight:600;">Email</td>
              <td style="padding:4px 0;"><a href="mailto:${email}" style="color:${B.primary};font-weight:700;">${email}</a></td>
            </tr>
            ${company ? `<tr>
              <td style="padding:4px 0;padding-right:16px;white-space:nowrap;font-weight:600;">Empresa</td>
              <td style="padding:4px 0;color:${B.primary};font-weight:700;">${company}</td>
            </tr>` : ""}
          </table>
        </td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:0 24px 24px;">
      <div style="font-size:11px;font-weight:700;color:${B.textMid};text-transform:uppercase;letter-spacing:.6px;margin-bottom:8px;">Mensaje</div>
      <div style="font-size:13px;color:${B.primary};line-height:1.7;white-space:pre-wrap;">${message.replace(/</g, '&lt;')}</div>
    </td></tr>
    <tr><td style="padding:14px 24px 20px;border-top:1px solid ${B.border};">
      <p style="color:${B.textSoft};font-size:11px;margin:0;text-align:center;">
        Enviado desde el formulario de contacto · <a href="https://cenas-support.com/contacto" style="color:${B.textSoft};">cenas-support.com/contacto</a>
      </p>
    </td></tr>
  </table>
  </td></tr>
</table>`;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from:     FROM_EMAIL,
      reply_to: email,
      to:       [TO_EMAIL],
      subject:  `[Contacto] ${reasonLabel} — ${name}${company ? ` (${company})` : ""}`,
      html,
    }),
  });

  console.log(`[contact-form] ${name} <${email}> — ${reasonLabel}`);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
