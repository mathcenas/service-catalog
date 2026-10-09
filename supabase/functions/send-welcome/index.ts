import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { B, EMAIL_FONT, LOGO_URL, emailFooter } from "../_shared/emailBrand.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const FREQ_LABEL: Record<string, string> = {
  daily:  "diarias",
  weekly: "semanales",
  none:   "desactivadas",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { contact_id } = await req.json();
    if (!contact_id) {
      return new Response(JSON.stringify({ error: "contact_id es requerido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Obtener contacto + cliente
    const { data: contact, error: cErr } = await supabase
      .from("client_contacts")
      .select("id, name, email, role, digest_frequency, client_id, clients(company_name, user_id)")
      .eq("id", contact_id)
      .maybeSingle();

    if (cErr || !contact) {
      return new Response(JSON.stringify({ error: "Contacto no encontrado" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const clientName = (contact as any).clients?.company_name ?? "tu empresa";
    const userId     = (contact as any).clients?.user_id ?? null;
    const freqLabel  = FREQ_LABEL[contact.digest_frequency] ?? "configuradas";
    const portalUrl  = Deno.env.get("PORTAL_URL") ?? null;

    // Buscar share token activo del cliente para incluir en el email
    const { data: shareToken } = await supabase
      .from("client_share_tokens")
      .select("token")
      .eq("client_id", contact.client_id)
      .or("expires_at.is.null,expires_at.gt." + new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const shareUrl = shareToken && portalUrl
      ? `${portalUrl}/share/${shareToken.token}`
      : null;

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      console.log("[send-welcome] RESEND_API_KEY no configurado");
      return new Response(JSON.stringify({ success: true, email: "skipped_no_key" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const firstName = contact.name?.split(" ")[0] ?? contact.name ?? "Hola";

    const htmlBody = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFC;font-family:${EMAIL_FONT};">
  <tr><td align="center" style="padding:32px 24px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid ${B.border};">

  <!-- Header -->
  <tr>
    <td style="padding:20px 24px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td valign="middle">
            <img src="${LOGO_URL}" alt="Cenas IT" height="28" style="display:block;height:28px;width:auto;border:0;">
          </td>
          <td valign="middle" align="right">
            <table role="presentation" cellpadding="0" cellspacing="0" style="background:#ECFDF5;border:1px solid #A7F3D0;border-radius:8px;">
              <tr><td style="padding:4px 12px;"><span style="color:#059669;font-size:11px;font-weight:700;letter-spacing:.5px;">ACTIVO</span></td></tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Body -->
  <tr>
    <td style="padding:20px 24px 0;">
      <div style="font-size:11px;font-weight:600;color:${B.textMid};text-transform:uppercase;letter-spacing:.6px;margin-bottom:4px;">${clientName}</div>
      <div style="font-size:18px;font-weight:800;color:${B.primary};line-height:1.2;margin-bottom:8px;">
        Bienvenida/o al portal de servicios IT, ${firstName}.
      </div>
      <div style="font-size:13px;color:${B.textMid};line-height:1.6;margin-bottom:16px;">
        Tu dirección <strong style="color:${B.primary};">${contact.email}</strong> fue dada de alta para recibir alertas
        y reportes de servicios IT de <strong style="color:${B.primary};">${clientName}</strong>.
      </div>
    </td>
  </tr>

  <!-- Config box -->
  <tr>
    <td style="padding:0 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
        style="background:#F8FAFC;border:1px solid ${B.border};border-radius:8px;margin-bottom:16px;">
        <tr><td style="padding:14px 16px;">
          <div style="font-size:11px;font-weight:700;color:${B.textMid};text-transform:uppercase;letter-spacing:.6px;margin-bottom:8px;">Tu configuración</div>
          <table role="presentation" cellpadding="0" cellspacing="0" style="font-size:12px;color:${B.textMid};">
            <tr>
              <td style="padding:3px 0;padding-right:16px;">Notificaciones</td>
              <td style="padding:3px 0;font-weight:700;color:${B.primary};">
                ${contact.digest_frequency === 'none'
                  ? 'Desactivadas'
                  : `Alertas ${freqLabel}`}
              </td>
            </tr>
            ${contact.role ? `
            <tr>
              <td style="padding:3px 0;padding-right:16px;">Rol</td>
              <td style="padding:3px 0;font-weight:700;color:${B.primary};">${contact.role}</td>
            </tr>` : ""}
          </table>
        </td></tr>
      </table>
    </td>
  </tr>

  ${shareUrl ? `
  <!-- Share page banner -->
  <tr>
    <td style="padding:0 24px 20px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
        style="background:linear-gradient(135deg,#1E3A5F 0%,#2563EB 100%);border-radius:10px;overflow:hidden;">
        <tr>
          <td style="padding:18px 20px;">
            <div style="font-size:10px;font-weight:700;color:rgba(255,255,255,.6);text-transform:uppercase;letter-spacing:.8px;margin-bottom:4px;">
              Portal de servicios
            </div>
            <div style="font-size:15px;font-weight:800;color:#ffffff;margin-bottom:6px;line-height:1.3;">
              Tu resumen de servicios IT en tiempo real
            </div>
            <div style="font-size:12px;color:rgba(255,255,255,.75);margin-bottom:14px;line-height:1.5;">
              Accedé al estado de tus servicios, historial de backups, proyectos activos y más desde un solo lugar.
            </div>
            <table role="presentation" cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:#ffffff;border-radius:6px;">
                  <a href="${shareUrl}"
                    style="display:inline-block;padding:9px 20px;font-size:12px;font-weight:700;color:#1E3A5F;text-decoration:none;letter-spacing:.2px;">
                    Ver mi portal →
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>` : portalUrl ? `
  <tr>
    <td style="padding:0 24px 20px;">
      <table role="presentation" cellpadding="0" cellspacing="0">
        <tr>
          <td style="background:${B.primary};border-radius:8px;">
            <a href="${portalUrl}" style="display:inline-block;padding:10px 22px;font-size:13px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:.2px;">
              Ver mis servicios →
            </a>
          </td>
        </tr>
      </table>
    </td>
  </tr>` : ""}

  <!-- Footer -->
  <tr>
    <td style="padding:16px 24px 20px;border-top:1px solid ${B.border};">
      <p style="color:${B.textSoft};font-size:11px;margin:0;text-align:center;">
        Cenas IT Solutions &mdash; Procesos bajo norma ISO/IEC 20000<br>
        <span style="font-size:10px;">Para dejar de recibir notificaciones, contactá a tu proveedor IT.</span>
      </p>
    </td>
  </tr>

  </table>
  </td></tr>
</table>`;

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from:     Deno.env.get("RESEND_FROM_EMAIL") || "Cenas IT <info@cenas.uy>",
        reply_to: Deno.env.get("RESEND_REPLY_TO_ADDRESS") || "info@cenas.uy",
        to:       [contact.email],
        subject:  `Bienvenida/o al portal de alertas IT — ${clientName}`,
        html:     htmlBody,
      }),
    });

    const resendData = await resendRes.json() as { id?: string; error?: string };

    if (!resendRes.ok || !resendData.id) {
      console.error("[send-welcome] Resend error:", resendData);
      return new Response(JSON.stringify({ error: "Error al enviar email", detail: resendData }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Guardar en email_opens para correlacionar tracking
    await supabase.from("email_opens").insert({
      user_id:        userId,
      client_id:      contact.client_id,
      contact_id:     contact.id,
      client_email:   contact.email,
      resend_email_id: resendData.id,
      email_type:     "welcome",
      sent_at:        new Date().toISOString(),
    });

    console.log(`[send-welcome] enviado a ${contact.email} (${clientName}) id=${resendData.id}`);

    return new Response(
      JSON.stringify({ success: true, resend_email_id: resendData.id }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
