import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { B, EMAIL_FONT, emailHeader, emailPortalPanel, emailMeta, emailLogo } from "../_shared/emailBrand.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface NotifyPayload {
  client_email: string;
  alt_email?: string;
  cc_emails?: string;
  client_name: string;
  subject: string;
  title: string;
  description?: string;
  service_name?: string;
  scheduled_date?: string;
  share_url?: string;
  share_url_label?: string;
  portal_url?: string;
  sender_name?: string;
  logo_url?: string;
  roadmap_item_id?: string;
  category?: string;
  event_type?: 'notify' | 'released' | 'closed';
  new_status?: string;
  update_note?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const payload: NotifyPayload = await req.json();
    const {
      client_email,
      alt_email,
      cc_emails,
      client_name,
      subject,
      title,
      description,
      service_name,
      scheduled_date,
      share_url,
      share_url_label,
      portal_url,
      sender_name,
      logo_url,
      roadmap_item_id,
      category,
      event_type,
      new_status,
      update_note,
    } = payload;

    if (!client_email || !subject || !title) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: client_email, subject, title" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      return new Response(
        JSON.stringify({ error: "RESEND_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const TZ = "America/Montevideo";

    const formattedDate = scheduled_date
      ? new Date(scheduled_date + "T12:00:00Z").toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
          timeZone: TZ,
        })
      : null;

    const nowTime = new Date().toLocaleString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
      timeZone: TZ,
    });

    // Header label and accent color — event_type overrides category when releasing/closing
    type EmailMeta = { label: string; color: string; footer: string };

    const releasedMeta: Record<string, EmailMeta> = {
      problem:        { label: "✅ Incidente Resuelto",       color: "#16a34a", footer: "Si tiene alguna consulta adicional, responda a este correo." },
      change_request: { label: "✅ Cambio Completado",         color: "#16a34a", footer: "Si tiene alguna consulta sobre el cambio, responda a este correo." },
      visit:          { label: "✅ Visita Completada",         color: "#16a34a", footer: "Si necesita coordinar algo más, responda a este correo." },
      payment:        { label: "✅ Pago Procesado",            color: "#16a34a", footer: "Puede responder este correo ante cualquier consulta." },
      backup:         { label: "✅ Backup Configurado",        color: "#16a34a", footer: "Puede responder este correo ante cualquier consulta." },
      idea:           { label: "✅ Servicio Activado",         color: "#16a34a", footer: "Su nuevo servicio ya está disponible. Responda ante cualquier consulta." },
    };

    const notifyMeta: Record<string, EmailMeta> = {
      problem:        { label: "Notificación de Incidente",   color: "#dc2626", footer: "Si tiene consultas sobre este incidente, responda a este correo." },
      change_request: { label: "Solicitud de Cambio",          color: "#7c3aed", footer: "Si tiene consultas sobre este cambio, responda a este correo." },
      visit:          { label: "Coordinación de Visita",       color: "#0284c7", footer: "Si necesita reprogramar, responda a este correo." },
      payment:        { label: "Aviso de Pago",                color: "#0284c7", footer: "Si tiene consultas sobre este pago, responda a este correo." },
      backup:         { label: "Integración de Backup",        color: "#0d9488", footer: "Si tiene consultas, responda a este correo." },
      idea:           { label: "Nueva Propuesta de Servicio",  color: "#2563eb", footer: "Si tiene consultas sobre esta propuesta, responda a este correo." },
      audit:          { label: "Revisión de Usuarios SMB",     color: "#7c3aed", footer: "Por favor complete la revisión antes del vencimiento del enlace." },
    };

    const defaultMeta: EmailMeta = { label: "Acción Planificada", color: "#2563eb", footer: "Si tiene consultas sobre esta acción, responda a este correo." };

    const meta: EmailMeta =
      (event_type === 'released' || event_type === 'closed')
        ? (releasedMeta[category || ""] ?? { label: "✅ Completado", color: "#16a34a", footer: "Si tiene alguna consulta, responda a este correo." })
        : (notifyMeta[category || ""] ?? defaultMeta);

    const logoHtmlInner = logo_url
      ? `<img src="${logo_url}" alt="Logo" style="max-height:32px;max-width:140px;" />`
      : emailLogo(sender_name || "Cenas IT");

    const htmlBody = `
      <div style="font-family:${EMAIL_FONT};max-width:600px;margin:0 auto;padding:32px 24px;background:#f8fafc;">
        <div style="background:#ffffff;border-radius:12px;padding:28px;border:1px solid ${B.border};">

          ${emailHeader({
            logoHtml: logoHtmlInner,
            senderName: sender_name || "Cenas IT",
            label: meta.label,
            accentColor: meta.color,
          })}

          <p style="color:${B.textMain};font-size:15px;line-height:1.6;margin:0 0 16px;">
            Hola ${client_name || ""},
          </p>

          ${(() => {
            const STATUS_BADGE: Record<string, { label: string; color: string; bg: string; border: string }> = {
              'Planned':      { label: 'Planificado',      color: '#64748b', bg: '#f1f5f9', border: '#cbd5e1' },
              'In Progress':  { label: 'En proceso',       color: '#b45309', bg: '#fef3c7', border: '#fcd34d' },
              'Next Release': { label: 'Pendiente cierre', color: '#1d4ed8', bg: '#eff6ff', border: '#93c5fd' },
              'Released':     { label: 'Completado',       color: '#15803d', bg: '#f0fdf4', border: '#86efac' },
            };
            const badge = new_status ? STATUS_BADGE[new_status] : null;
            return badge ? `
              <div style="margin:0 0 12px;">
                <span style="display:inline-flex;align-items:center;gap:6px;background:${badge.bg};border:1px solid ${badge.border};color:${badge.color};border-radius:6px;padding:5px 12px;font-size:12px;font-weight:700;letter-spacing:.3px;">
                  Estado actualizado: ${badge.label}
                </span>
              </div>` : '';
          })()}
          ${update_note ? `
          <div style="background:#f0f9ff;border-left:3px solid ${B.accent};border-radius:0 8px 8px 0;padding:14px 16px;margin:0 0 16px;">
            <p style="color:#0369a1;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin:0 0 6px;">Actualización</p>
            <p style="color:#0c4a6e;font-size:14px;line-height:1.6;margin:0;">${update_note.replace(/\n/g, "<br>")}</p>
          </div>` : ""}
          <div style="background:${B.bg};border:1px solid ${B.border};border-radius:8px;padding:20px;margin:0 0 16px;">
            ${service_name ? `<p style="color:${B.textMid};margin:0 0 6px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">${service_name}</p>` : ""}
            <h3 style="color:${B.primary};margin:0 0 8px;font-size:17px;">${title}</h3>
            ${description ? `<p style="color:#475569;margin:0 0 12px;font-size:14px;line-height:1.5;">${description.replace(/\n/g, "<br>")}</p>` : ""}
            ${formattedDate ? `<p style="color:${B.accent};margin:0;font-size:14px;font-weight:600;">Programado: ${formattedDate}</p>` : ""}
          </div>

          <p style="color:${B.textMid};font-size:12px;margin:0 0 8px;">Enviado: ${nowTime}</p>

          ${share_url ? `
            <p style="margin:20px 0;">
              <a href="${share_url}" style="display:inline-block;background:${B.accent};color:${B.primary};padding:11px 26px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:700;">
                ${share_url_label || "Ver Portal"}
              </a>
            </p>
          ` : ""}

          <p style="color:${B.textMid};font-size:13px;margin:24px 0 0;padding-top:16px;border-top:1px solid ${B.border};">
            ${meta.footer}
          </p>

          ${emailPortalPanel({ companyName: sender_name || "Cenas IT", portalUrl: portal_url })}

          <div style="margin-top:14px;text-align:center;">
            <a href="https://clientes.cenas-support.com/onboarding" style="display:inline-block;color:${B.accent};font-size:11px;text-decoration:none;border:1px solid ${B.border};border-radius:4px;padding:6px 14px;">
              👤 Onboarding / Offboarding — clientes.cenas-support.com
            </a>
          </div>

          ${emailMeta(sender_name || "Cenas IT")}
        </div>
      </div>
    `;

    // Create tracking record for read receipt
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: trackRecord } = await supabaseAdmin
      .from("email_opens")
      .insert({
        user_id: user.id,
        roadmap_item_id: roadmap_item_id || null,
        client_email,
      })
      .select("tracking_id")
      .single();

    let finalHtml = htmlBody;
    if (trackRecord?.tracking_id) {
      const pixelUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/track-open?t=${trackRecord.tracking_id}`;
      finalHtml += `<img src="${pixelUrl}" width="1" height="1" style="display:none;" alt="" />`;
    }

    const recipients = [client_email];
    if (alt_email && alt_email !== client_email) {
      recipients.push(alt_email);
    }
    if (cc_emails) {
      cc_emails.split(',').map(e => e.trim()).filter(e => e && e !== client_email && e !== alt_email).forEach(e => recipients.push(e));
    }

    const replyTo = Deno.env.get("RESEND_REPLY_TO") || "mathias@cenas.uy";

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: Deno.env.get("RESEND_FROM_EMAIL") || "Cenas-Support Notifications <notificaciones@updates.cenas.uy>",
        reply_to: replyTo,
        to: recipients,
        subject,
        html: finalHtml,
      }),
    });

    if (!resendRes.ok) {
      const errBody = await resendRes.text();
      return new Response(
        JSON.stringify({ error: "Failed to send email", details: errBody }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const resendData = await resendRes.json();

    return new Response(
      JSON.stringify({ success: true, email_id: resendData.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Internal error", message: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
