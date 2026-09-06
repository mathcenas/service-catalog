import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { B, EMAIL_FONT, emailMeta } from "../_shared/emailBrand.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://servicios.cenas-support.com",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      return new Response(
        JSON.stringify({ error: "RESEND_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const now = new Date();
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const todayStr = now.toISOString().split("T")[0];
    const in30Str = in30Days.toISOString().split("T")[0];

    const { data: licenses, error: licError } = await supabase
      .from("client_licenses")
      .select("*, clients!inner(company_name, contact_name, email, alt_email, user_id)")
      .gte("expiration_date", todayStr)
      .lte("expiration_date", in30Str)
      .eq("status", "Active");

    if (licError) {
      return new Response(
        JSON.stringify({ error: "DB query failed", details: licError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!licenses || licenses.length === 0) {
      return new Response(
        JSON.stringify({ message: "No licenses expiring in the next 30 days", sent: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") || "Cenas-Support Notifications <notificaciones@updates.cenas.uy>";
    const replyTo = Deno.env.get("RESEND_REPLY_TO") || "mathias@cenas.uy";
    let sent = 0;
    const errors: string[] = [];

    for (const lic of licenses) {
      const client = (lic as any).clients;
      if (!client?.email) continue;

      const daysLeft = Math.ceil(
        (new Date(lic.expiration_date).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );

      const { data: settings } = await supabase
        .from("user_settings")
        .select("logo_url, company_name")
        .eq("user_id", client.user_id)
        .maybeSingle();

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
                <span style="display:inline-block;background:#d9770618;color:#d97706;border:1px solid #d9770640;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:700;">Renovación</span>
                <div style="font-size:15px;font-weight:700;color:${B.primary};margin-top:3px;">Recordatorio de Licencia</div>
              </div>
            </div>

            <p style="color:${B.textMain};font-size:15px;line-height:1.6;margin:0 0 16px;">
              Hola ${client.contact_name || client.company_name},
            </p>

            <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:20px;margin:0 0 16px;">
              <h3 style="color:#92400e;margin:0 0 8px;font-size:17px;">${lic.software_name}</h3>
              <p style="color:#78350f;margin:0 0 8px;font-size:14px;">
                Tu licencia vence en <strong>${daysLeft} día${daysLeft === 1 ? "" : "s"}</strong>
                (${new Date(lic.expiration_date).toLocaleDateString("es-UY", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}).
              </p>
              ${lic.quantity ? `<p style="color:#78350f;margin:0;font-size:14px;">Cantidad: ${lic.quantity} ${lic.quantity_label || "licencias"}</p>` : ""}
            </div>

            <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 24px;">
              Renovar a tiempo evita interrupciones en el servicio. Ante cualquier consulta, respondé este correo.
            </p>

            <p style="color:${B.textMid};font-size:13px;margin:0;padding-top:16px;border-top:1px solid ${B.border};">
              ${companyName} — Gestión de Licencias
            </p>
            ${emailMeta(companyName)}
          </div>
        </div>
      `;

      const recipients = [client.email];
      if (client.alt_email && client.alt_email !== client.email) {
        recipients.push(client.alt_email);
      }

      const resendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromEmail,
          reply_to: replyTo,
          to: recipients,
          subject: `License Renewal: ${lic.software_name} expires in ${daysLeft} days`,
          html: htmlBody,
        }),
      });

      if (resendRes.ok) {
        sent++;
      } else {
        const errText = await resendRes.text();
        errors.push(`${lic.software_name} (${client.email}): ${errText}`);
      }
    }

    return new Response(
      JSON.stringify({ message: `Sent ${sent} reminder(s)`, sent, total: licenses.length, errors }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Internal error", message: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
