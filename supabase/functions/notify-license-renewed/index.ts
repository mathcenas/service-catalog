import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { B, emailWrap, emailHeader, emailPortalPanel, emailMeta, emailLogo } from "../_shared/emailBrand.ts";
import { clientShareUrl } from "../_shared/shareLink.ts";
import { REPLY_TO } from "../_shared/replyTo.ts";

// "Licencia renovada": lo dispara el botón Renovar de Licencias (LicenseManager) con
// { renewal_id }. Confirma al cliente que la compra se hizo y hasta cuándo queda vigente.
// Va a los mismos destinatarios que los recordatorios de vencimiento (email y email alternativo
// del cliente). Solo el dueño de la renovación puede dispararlo.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const fmtDate = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString("es-UY", { day: "numeric", month: "long", year: "numeric" });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) return json({ error: "RESEND_API_KEY no configurado" }, 500);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Quién llama (sesión del admin)
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: { user } } = await supabase.auth.getUser(jwt);
  if (!user) return json({ error: "Sin sesión" }, 401);

  const { renewal_id } = await req.json().catch(() => ({}));
  if (!renewal_id) return json({ error: "renewal_id es obligatorio" }, 400);

  const { data: ren } = await supabase
    .from("license_renewals")
    .select("*, client_licenses(software_name, quantity, quantity_label, billing_cycle), clients(company_name, contact_name, email, alt_email)")
    .eq("id", renewal_id).maybeSingle();
  if (!ren) return json({ error: "Renovación no encontrada" }, 404);
  if (ren.user_id !== user.id) return json({ error: "No autorizado" }, 403);

  const lic = ren.client_licenses ?? {};
  const client = ren.clients ?? {};
  const recipients = [client.email, client.alt_email].filter((e: string | null, i: number, a: (string | null)[]) => e && a.indexOf(e) === i) as string[];
  if (!recipients.length) return json({ error: "El cliente no tiene email cargado" }, 422);

  const { data: settings } = await supabase.from("user_settings").select("logo_url, company_name").eq("user_id", user.id).maybeSingle();
  const senderName = settings?.company_name || "Cenas IT";
  const logoHtml = settings?.logo_url
    ? `<img src="${settings.logo_url}" alt="Logo" style="max-height:32px;max-width:140px;" />`
    : emailLogo(senderName);
  const portalUrl = await clientShareUrl(supabase, ren.client_id);

  const qty = lic.quantity ? `${lic.quantity} ${esc(lic.quantity_label || "licencias")}` : "";
  const html = emailWrap(`
    ${emailHeader({ logoHtml, senderName, label: "Licencia renovada", accentColor: "#059669", title: esc(client.company_name) })}
    <p style="color:${B.textMain};font-size:15px;line-height:1.6;margin:0 0 16px;">
      Hola ${esc(client.contact_name || client.company_name)},
    </p>
    <p style="color:${B.textMain};font-size:14px;line-height:1.6;margin:0 0 16px;">
      Te confirmamos que <strong>renovamos la licencia</strong>: la compra ya está hecha y no tenés que hacer nada.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ECFDF5;border:1px solid #A7F3D0;border-radius:8px;margin:0 0 16px;">
      <tr><td style="padding:16px 20px;">
        <div style="color:#065F46;font-size:17px;font-weight:700;margin:0 0 6px;">${esc(lic.software_name)}</div>
        ${qty ? `<div style="color:#047857;font-size:13px;margin:0 0 4px;">${qty}</div>` : ""}
        ${ren.new_expiration ? `<div style="color:#047857;font-size:14px;">Vigente hasta el <strong>${fmtDate(ren.new_expiration)}</strong></div>` : ""}
        ${ren.notes ? `<div style="color:#065F46;font-size:13px;margin-top:8px;">${esc(ren.notes)}</div>` : ""}
      </td></tr>
    </table>
    <p style="color:${B.textMid};font-size:13px;line-height:1.6;margin:0;">
      Ante cualquier consulta, respondé este correo.
    </p>
    ${emailPortalPanel({ companyName: client.company_name, portalUrl })}
    ${emailMeta(senderName)}
  `);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: Deno.env.get("RESEND_FROM_EMAIL") || "Cenas IT <alerts@updates.cenas.uy>",
      reply_to: REPLY_TO,
      to: recipients,
      subject: `Licencia renovada: ${lic.software_name}${ren.new_expiration ? ` — vigente hasta el ${fmtDate(ren.new_expiration)}` : ""}`,
      html,
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    return json({ error: `Resend ${res.status}: ${t.slice(0, 200)}` }, 502);
  }
  await supabase.from("license_renewals").update({ notified_at: new Date().toISOString(), notified_to: recipients }).eq("id", renewal_id);
  return json({ ok: true, sent_to: recipients });
});
