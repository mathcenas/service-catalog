import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
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

    const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") || "notifications@resend.dev";
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

      const logoHtml = settings?.logo_url
        ? `<img src="${settings.logo_url}" alt="Logo" style="max-height: 40px; max-width: 160px; margin-bottom: 16px;" />`
        : "";

      const htmlBody = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 24px;">
          <div style="border-bottom: 2px solid #d97706; padding-bottom: 16px; margin-bottom: 24px;">
            ${logoHtml}
            <h2 style="color: #1e293b; margin: 0; font-size: 20px;">License Renewal Reminder</h2>
          </div>

          <p style="color: #334155; font-size: 15px; line-height: 1.6;">
            Hi ${client.contact_name || client.company_name},
          </p>

          <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 20px; margin: 20px 0;">
            <h3 style="color: #92400e; margin: 0 0 8px; font-size: 17px;">${lic.software_name}</h3>
            <p style="color: #78350f; margin: 0 0 8px; font-size: 14px;">
              Your license expires in <strong>${daysLeft} day${daysLeft === 1 ? "" : "s"}</strong>
              (${new Date(lic.expiration_date).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}).
            </p>
            ${lic.quantity ? `<p style="color: #78350f; margin: 0; font-size: 14px;">Quantity: ${lic.quantity} ${lic.quantity_label || "licenses"}</p>` : ""}
          </div>

          <p style="color: #475569; font-size: 14px; line-height: 1.6;">
            Please ensure timely renewal to avoid any service interruptions. If you have any questions or need assistance, simply reply to this email.
          </p>

          <p style="color: #64748b; font-size: 13px; margin-top: 32px; border-top: 1px solid #e2e8f0; padding-top: 16px;">
            ${settings?.company_name || "IT Services"} — License Management
          </p>
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
