import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { B, EMAIL_FONT, LOGO_URL } from "../_shared/emailBrand.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: corsHeaders });

  const { email } = await req.json();
  if (!email) return new Response(JSON.stringify({ error: "email requerido" }), { status: 400, headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Buscar contacto — respuesta siempre igual para no exponer qué emails existen
  const { data: contact } = await supabase
    .from("client_contacts")
    .select("id, name, email, client_id, clients(company_name)")
    .eq("email", email.toLowerCase().trim())
    .neq("digest_frequency", "none")
    .maybeSingle();

  const OK = new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  if (!contact) return OK; // no revelar si existe

  const portalUrl = Deno.env.get("PORTAL_URL");
  if (!portalUrl) return OK;

  const { data: shareToken } = await supabase
    .from("client_share_tokens")
    .select("token")
    .eq("client_id", contact.client_id)
    .or("expires_at.is.null,expires_at.gt." + new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!shareToken) return OK;

  const shareUrl   = `${portalUrl}/share/${shareToken.token}`;
  const clientName = (contact as any).clients?.company_name ?? "";
  const firstName  = contact.name?.split(" ")[0] ?? "Hola";
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) return OK;

  const html = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFC;font-family:${EMAIL_FONT};">
  <tr><td align="center" style="padding:32px 24px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid ${B.border};">
    <tr><td style="padding:24px 24px 0;">
      <img src="${LOGO_URL}" alt="Cenas IT" height="26" style="display:block;height:26px;width:auto;border:0;margin-bottom:20px;">
      <div style="font-size:11px;font-weight:600;color:${B.textMid};text-transform:uppercase;letter-spacing:.6px;margin-bottom:4px;">${clientName}</div>
      <div style="font-size:18px;font-weight:800;color:${B.primary};margin-bottom:8px;">Tu link al portal, ${firstName}.</div>
      <div style="font-size:13px;color:${B.textMid};line-height:1.6;margin-bottom:20px;">
        Solicitaste acceso a tu portal de servicios IT. Hacé clic en el botón para acceder.
      </div>
    </td></tr>
    <tr><td style="padding:0 24px 24px;">
      <table role="presentation" cellpadding="0" cellspacing="0"
        style="background:linear-gradient(135deg,#1E3A5F 0%,#2563EB 100%);border-radius:10px;overflow:hidden;width:100%;">
        <tr><td style="padding:20px 24px;">
          <div style="font-size:13px;color:rgba(255,255,255,.7);margin-bottom:14px;">
            Este link es personal y da acceso al estado de servicios de <strong style="color:#fff;">${clientName}</strong>.
          </div>
          <table role="presentation" cellpadding="0" cellspacing="0">
            <tr><td style="background:#ffffff;border-radius:6px;">
              <a href="${shareUrl}" style="display:inline-block;padding:10px 24px;font-size:13px;font-weight:700;color:#1E3A5F;text-decoration:none;">
                Acceder a mi portal →
              </a>
            </td></tr>
          </table>
          <div style="margin-top:12px;font-size:10px;color:rgba(255,255,255,.45);word-break:break-all;">${shareUrl}</div>
        </td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:14px 24px 20px;border-top:1px solid ${B.border};">
      <p style="color:${B.textSoft};font-size:11px;margin:0;text-align:center;">
        Si no solicitaste este link, podés ignorar este correo.<br>
        Cenas IT Solutions — <a href="https://cenas.uy" style="color:${B.textSoft};">cenas.uy</a>
      </p>
    </td></tr>
  </table>
  </td></tr>
</table>`;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from:     Deno.env.get("RESEND_FROM_EMAIL") || "Cenas IT <info@cenas.uy>",
      reply_to: "info@cenas.uy",
      to:       [contact.email],
      subject:  `Tu link al portal de servicios — ${clientName}`,
      html,
    }),
  });

  console.log(`[send-portal-link] link enviado a ${contact.email}`);
  return OK;
});
