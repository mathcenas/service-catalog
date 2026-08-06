import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://servicios.cenas-support.com",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, apikey, authorization",
};

interface UserResponse {
  name: string;
  action: "mantener" | "eliminar" | "cambiar";
  note?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { token, responses }: { token: string; responses: UserResponse[] } = await req.json();

    if (!token || !responses || !Array.isArray(responses)) {
      return new Response(JSON.stringify({ error: "Missing token or responses" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: reviewToken, error } = await supabase
      .from("acl_review_tokens")
      .select("*, service_acl_snapshots(snapshot, generated_at), services(name, business_name), clients(company_name, contact_name, email, alt_email, cc_emails)")
      .eq("token", token)
      .single();

    if (error || !reviewToken) {
      return new Response(JSON.stringify({ error: "Token not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (new Date(reviewToken.expires_at) < new Date()) {
      return new Response(JSON.stringify({ error: "Token expired" }), {
        status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Atomic update: only succeeds if not yet submitted — prevents race condition
    const { data: updated, error: updateErr } = await supabase
      .from("acl_review_tokens")
      .update({ submitted_at: new Date().toISOString(), responses })
      .eq("token", token)
      .is("submitted_at", null)
      .select("id")
      .single();

    if (updateErr || !updated) {
      // submitted_at was already set by a concurrent request
      return new Response(JSON.stringify({ error: "Already submitted" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const client = (reviewToken.clients as any);
    const svc = (reviewToken.services as any);
    const snap = (reviewToken.service_acl_snapshots as any);

    // Create roadmap item category=audit
    const needsAction = responses.filter(r => r.action !== "mantener");
    const title = `Auditoría de usuarios SMB — ${svc?.business_name || svc?.name || "NAS"}`;
    const description = [
      `Revisión enviada por ${client?.company_name || "cliente"}.`,
      "",
      ...responses.map(r => {
        const actionLabel = r.action === "mantener" ? "✅ Mantener" : r.action === "eliminar" ? "🗑 Eliminar" : "✏️ Cambiar";
        return `${actionLabel}: ${r.name}${r.note ? ` — ${r.note}` : ""}`;
      }),
      "",
      needsAction.length === 0
        ? "Sin cambios requeridos."
        : `${needsAction.length} usuario(s) requieren acción.`,
    ].join("\n");

    await supabase.from("roadmap_items").insert({
      user_id: reviewToken.user_id,
      client_id: reviewToken.client_id,
      service_id: reviewToken.service_id,
      title,
      description,
      status: "Planned",
      category: "audit",
      requested_by: client?.contact_name || client?.company_name || "Cliente",
      publish_to_changelog: false,
      sort_order: 0,
      is_public: false,
    });

    // Fetch admin settings and client portal token in parallel
    const [{ data: settings }, { data: shareToken }] = await Promise.all([
      supabase
        .from("user_settings")
        .select("logo_url, company_name, weekly_digest_email")
        .eq("user_id", reviewToken.user_id)
        .maybeSingle(),
      reviewToken.client_id
        ? supabase
            .from("share_tokens")
            .select("token")
            .eq("client_id", reviewToken.client_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const adminEmail = settings?.weekly_digest_email || Deno.env.get("RESEND_REPLY_TO") || "mathias@cenas.uy";
    const portalUrl = shareToken?.token
      ? `https://servicios.cenas-support.com/portal/${shareToken.token}`
      : null;
    const logoUrl = settings?.logo_url || "";
    const companyName = settings?.company_name || "Cenas Support";

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (RESEND_API_KEY) {
      const logoHtml = logoUrl
        ? `<img src="${logoUrl}" alt="Logo" style="max-height:40px;max-width:160px;margin-bottom:16px;" />`
        : "";

      const rowsHtml = responses.map(r => {
        const color = r.action === "mantener" ? "#16a34a" : r.action === "eliminar" ? "#dc2626" : "#d97706";
        const label = r.action === "mantener" ? "Mantener" : r.action === "eliminar" ? "Eliminar" : "Cambiar";
        return `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#1e293b;">${r.name}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;">
            <span style="background:${color}22;color:${color};padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;">${label}</span>
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#64748b;">${r.note || ""}</td>
        </tr>`;
      }).join("");

      const generatedDate = snap?.generated_at
        ? new Date(snap.generated_at).toLocaleDateString("es-UY", { dateStyle: "long" })
        : "";

      const htmlBody = `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;">
          <div style="border-bottom:2px solid #7c3aed;padding-bottom:16px;margin-bottom:24px;">
            ${logoHtml}
            <h2 style="color:#1e293b;margin:0;font-size:20px;">Revisión de usuarios completada — acción requerida</h2>
            <p style="color:#64748b;margin:4px 0 0;font-size:13px;">${client?.company_name || ""} — ${svc?.business_name || svc?.name || "NAS"}</p>
          </div>
          <p style="color:#334155;font-size:15px;">El cliente completó la revisión de usuarios del servidor NAS${generatedDate ? ` (reporte del ${generatedDate})` : ""}.</p>
          <table style="width:100%;border-collapse:collapse;margin:20px 0;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
            <thead>
              <tr style="background:#f8fafc;">
                <th style="padding:10px 12px;text-align:left;font-size:12px;color:#64748b;font-weight:600;">USUARIO</th>
                <th style="padding:10px 12px;text-align:left;font-size:12px;color:#64748b;font-weight:600;">ACCIÓN</th>
                <th style="padding:10px 12px;text-align:left;font-size:12px;color:#64748b;font-weight:600;">NOTA</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
          ${needsAction.length > 0
            ? `<p style="background:#fef9c3;border:1px solid #fde047;border-radius:8px;padding:12px 16px;color:#854d0e;font-size:14px;margin:0;">⚠️ ${needsAction.length} usuario(s) requieren acción.</p>`
            : `<p style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:12px 16px;color:#166534;font-size:14px;margin:0;">✅ Sin cambios requeridos.</p>`
          }
          <div style="margin-top:32px;padding:16px 20px;background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%);border-radius:8px;text-align:center;">
            <p style="color:#94a3b8;font-size:11px;margin:0 0 6px;text-transform:uppercase;letter-spacing:1px;">Portal de Servicios</p>
            <p style="color:#ffffff;font-size:13px;margin:0 0 8px;font-weight:600;">Consulte el estado de sus servicios en línea</p>
            <p style="color:#cbd5e1;font-size:11px;margin:0;line-height:1.5;">Servicios gestionados &bull; Soporte &bull; Backups &bull; Información IT</p>
            ${portalUrl ? `<a href="${portalUrl}" style="display:inline-block;margin-top:12px;background:rgba(255,255,255,0.1);color:#e2e8f0;font-size:12px;font-weight:500;text-decoration:none;padding:8px 20px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);">Ver mis servicios →</a>` : ""}
          </div>
          <p style="color:#94a3b8;font-size:10px;text-align:center;margin-top:16px;">Correo generado por Task Tracker Pro, by ${companyName}</p>
        </div>`;

      // Este mail es interno (acción pendiente para el admin), no se copia al cliente
      const ccEmails: string[] = [];

      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: Deno.env.get("RESEND_FROM_EMAIL") || "Cenas-Support Notifications <notificaciones@updates.cenas.uy>",
          reply_to: adminEmail,
          to: [adminEmail],
          cc: ccEmails.length > 0 ? ccEmails : undefined,
          subject: `Revisión de usuarios pendiente de acción — ${client?.company_name || "cliente"}`,
          html: htmlBody,
        }),
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Internal error", message: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
