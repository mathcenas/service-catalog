import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface NotifyPayload {
  client_email: string;
  alt_email?: string;
  client_name: string;
  subject: string;
  title: string;
  description?: string;
  scheduled_date?: string;
  share_url?: string;
  sender_name?: string;
  logo_url?: string;
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
      client_name,
      subject,
      title,
      description,
      scheduled_date,
      share_url,
      sender_name,
      logo_url,
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

    const formattedDate = scheduled_date
      ? new Date(scheduled_date + "T00:00:00").toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : null;

    const logoHtml = logo_url
      ? `<img src="${logo_url}" alt="Logo" style="max-height: 40px; max-width: 160px; margin-bottom: 16px;" />`
      : "";

    const htmlBody = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 24px;">
        <div style="border-bottom: 2px solid #2563eb; padding-bottom: 16px; margin-bottom: 24px;">
          ${logoHtml}
          <h2 style="color: #1e293b; margin: 0; font-size: 20px;">Planned Service Action</h2>
          ${sender_name ? `<p style="color: #64748b; margin: 4px 0 0; font-size: 13px;">From ${sender_name}</p>` : ""}
        </div>

        <p style="color: #334155; font-size: 15px; line-height: 1.6;">
          Hi ${client_name || "there"},
        </p>

        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 20px 0;">
          <h3 style="color: #1e293b; margin: 0 0 8px; font-size: 17px;">${title}</h3>
          ${description ? `<p style="color: #475569; margin: 0 0 12px; font-size: 14px; line-height: 1.5;">${description.replace(/\n/g, "<br>")}</p>` : ""}
          ${formattedDate ? `<p style="color: #2563eb; margin: 0; font-size: 14px; font-weight: 600;">Scheduled: ${formattedDate}</p>` : ""}
        </div>

        ${share_url ? `
          <p style="margin: 24px 0;">
            <a href="${share_url}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 500;">
              View Your Portal
            </a>
          </p>
        ` : ""}

        <p style="color: #64748b; font-size: 13px; margin-top: 32px; border-top: 1px solid #e2e8f0; padding-top: 16px;">
          If you have questions about this planned action, please reply to this email.
        </p>
      </div>
    `;

    const recipients = [client_email];
    if (alt_email && alt_email !== client_email) {
      recipients.push(alt_email);
    }

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: Deno.env.get("RESEND_FROM_EMAIL") || "notifications@resend.dev",
        to: recipients,
        subject,
        html: htmlBody,
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
