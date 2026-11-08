import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { B, EMAIL_FONT, emailHeader, emailPortalPanel, emailMeta } from "../_shared/emailBrand.ts";

// One-shot announcement: notifica a todos los contactos activos sobre el cambio
// en las notificaciones de backup.
//
// POST {}              → dry-run, devuelve lista de destinatarios sin enviar
// POST { send: true }  → envía a todos
// POST { send: true, client_id: "uuid" } → envía solo a ese cliente (para probar)

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  const FROM_EMAIL     = Deno.env.get("RESEND_FROM_EMAIL") || "Cenas IT <info@updates.cenas.uy>";

  let body: Record<string, any> = {};
  try { body = await req.json(); } catch {}

  const doSend:        boolean     = body?.send === true;
  const targetClientId: string|null = body?.client_id || null;

  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: "RESEND_API_KEY not configured" }), { status: 500 });
  }

  // Load active contacts
  let contactsQuery = supabase
    .from("client_contacts")
    .select("id, client_id, name, email, digest_frequency, clients(id, company_name, user_id)")
    .neq("digest_frequency", "none");

  if (targetClientId) {
    contactsQuery = contactsQuery.eq("client_id", targetClientId);
  }

  const { data: contacts } = await contactsQuery;
  if (!contacts || contacts.length === 0) {
    return new Response(JSON.stringify({ sent: 0, reason: "No active contacts" }), { status: 200 });
  }

  // Group by client
  const byClient = new Map<string, { client: any; contacts: any[] }>();
  for (const c of contacts as any[]) {
    const cl = c.clients;
    if (!cl) continue;
    if (!byClient.has(c.client_id)) byClient.set(c.client_id, { client: cl, contacts: [] });
    byClient.get(c.client_id)!.contacts.push(c);
  }

  const preview: any[] = [];
  let sent = 0;

  for (const [clientId, { client, contacts: group }] of byClient) {
    const recipients = group.map((c: any) => c.email).filter(Boolean);
    if (recipients.length === 0) continue;

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

    const subject = `Mejoras en el monitoreo y notificaciones de tus servicios — ${client.company_name}`;

    const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${B.bg};font-family:${EMAIL_FONT};">
  <tr><td align="center" style="padding:32px 24px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;border:1px solid ${B.border};">
  <tr><td style="padding:28px;">

    ${emailHeader({ senderName, label: "MEJORA DE SERVICIO", accentColor: "#06B6D4", title: client.company_name, subtitle: "Novedades en monitoreo y notificaciones" })}

    <h2 style="font-size:16px;font-weight:700;color:${B.primary};margin:0 0 10px;">
      Mejoras en el monitoreo de tus servicios IT
    </h2>
    <p style="font-size:13px;color:${B.textMain};line-height:1.6;margin:0 0 20px;">
      Estuvimos trabajando para que todos tus servicios — backups, servidores, aplicaciones — reporten a un único sistema centralizado de control. Esto nos permite detectar problemas antes de que te afecten, ver tendencias y actuar de forma proactiva. Como decimos nosotros: si no se mide, no se puede mejorar.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">

      <tr>
        <td style="padding:12px 16px;background:#F8FAFC;border-radius:8px 8px 0 0;border:1px solid ${B.border};">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td valign="top" style="padding-right:12px;width:28px;">
                <div style="background:#ECFDF5;border-radius:50%;width:28px;height:28px;text-align:center;line-height:28px;font-size:14px;">🖥️</div>
              </td>
              <td valign="top">
                <div style="font-size:13px;font-weight:700;color:${B.primary};margin-bottom:3px;">Monitoreo centralizado</div>
                <div style="font-size:12px;color:${B.textMid};line-height:1.5;">
                  Backups, estado de servidores, alertas y cambios en un solo lugar. Tenemos visibilidad completa de tu infraestructura en tiempo real.
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <tr>
        <td style="padding:12px 16px;background:#ffffff;border:1px solid ${B.border};border-top:none;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td valign="top" style="padding-right:12px;width:28px;">
                <div style="background:#FEF3C7;border-radius:50%;width:28px;height:28px;text-align:center;line-height:28px;font-size:14px;">📋</div>
              </td>
              <td valign="top">
                <div style="font-size:13px;font-weight:700;color:${B.primary};margin-bottom:3px;">Resumen diario de alertas</div>
                <div style="font-size:12px;color:${B.textMid};line-height:1.5;">
                  Si algún backup falló o tuvo advertencias, recibís un único correo a las 8am con el detalle de todos tus servicios. Si todo estuvo bien, no recibís nada.
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <tr>
        <td style="padding:12px 16px;background:#F8FAFC;border-radius:0 0 8px 8px;border:1px solid ${B.border};border-top:none;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td valign="top" style="padding-right:12px;width:28px;">
                <div style="background:#EFF6FF;border-radius:50%;width:28px;height:28px;text-align:center;line-height:28px;font-size:14px;">📅</div>
              </td>
              <td valign="top">
                <div style="font-size:13px;font-weight:700;color:${B.primary};margin-bottom:3px;">Resumen semanal</div>
                <div style="font-size:12px;color:${B.textMid};line-height:1.5;">
                  Todos los lunes recibís un resumen completo: estado de backups, servidores, renovaciones próximas y cambios de la semana.
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>

    </table>

    ${portalUrl ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr>
        <td style="background:${B.primary};border-radius:10px;padding:18px 20px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td valign="middle">
                <div style="font-size:13px;font-weight:700;color:#ffffff;margin-bottom:4px;">Portal de servicios</div>
                <div style="font-size:12px;color:${B.textSoft};line-height:1.5;">Seguimiento en tiempo real de tus servicios, backups e incidentes. Siempre disponible.</div>
              </td>
              <td valign="middle" align="right" style="padding-left:16px;white-space:nowrap;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="background:${B.accent};border-radius:6px;">
                      <a href="${portalUrl}" style="display:inline-block;padding:8px 18px;font-size:12px;font-weight:700;color:${B.primary};text-decoration:none;">Ver mis servicios →</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>` : ''}

    <div style="background:#F0FDF4;border:1px solid #A7F3D0;border-radius:8px;padding:14px 16px;margin-bottom:24px;">
      <p style="font-size:12px;color:#065F46;margin:0 0 6px;font-weight:700;">¿Querés ajustar la frecuencia de notificaciones?</p>
      <p style="font-size:12px;color:#047857;margin:0;line-height:1.6;">
        Podemos configurarlo según tu preferencia: recibir un correo por cada evento de backup, solo alertas cuando hay problemas, o el resumen semanal únicamente. Respondé este correo y lo ajustamos.
      </p>
    </div>

    ${emailPortalPanel({ companyName: client.company_name, portalUrl })}
    ${emailMeta(senderName)}

  </td></tr>
  </table>
  </td></tr>
</table>`;

    preview.push({ client_name: client.company_name, recipients, subject });

    if (!doSend) continue;

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM_EMAIL, to: recipients, subject, html }),
    });

    const resendData = resendRes.ok ? await resendRes.json() as { id?: string } : null;

    for (const email of recipients) {
      await supabase.from("email_opens").insert({
        user_id:         client.user_id,
        client_id:       clientId,
        client_email:    email,
        resend_email_id: resendData?.id ?? null,
        email_type:      "notification_change",
        subject,
        sent_at:         new Date().toISOString(),
      });
    }

    sent++;
  }

  return new Response(
    JSON.stringify({ dry_run: !doSend, preview, sent }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
