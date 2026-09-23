import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { B, EMAIL_FONT, emailMeta } from "../_shared/emailBrand.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Ingest-Secret, X-Service-Id",
};

function formatBytes(b: number): string {
  if (b >= 1073741824) return `${(b / 1073741824).toFixed(2)} GB`;
  if (b >= 1048576)    return `${(b / 1048576).toFixed(1)} MB`;
  if (b >= 1024)       return `${(b / 1024).toFixed(0)} KB`;
  return `${b} B`;
}

function formatDuration(secs: number): string {
  if (secs >= 3600) return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
  if (secs >= 60)   return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${secs}s`;
}

function buildEmailHtml(opts: {
  companyName: string;
  logoUrl?: string | null;
  status: string;
  hostname: string;
  source: string;
  started: string;
  duration: string;
  totalSize: string;
  totalFiles: string;
  totalDirs: string;
  failedEntriesHtml: string;
  generatedAt: string;
  kopiaVersion: string;
  serviceName: string;
}): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const statusMap: Record<string, { label: string; bg: string; border: string; text: string }> = {
    success: { label: "EXITOSO",          bg: "#ECFDF5", border: "#A7F3D0", text: "#059669" },
    warning: { label: "CON ADVERTENCIAS", bg: "#FFFBEB", border: "#FDE68A", text: "#B45309" },
    failed:  { label: "FALLIDO",          bg: "#FEF2F2", border: "#FECACA", text: "#DC2626" },
  };
  const st = statusMap[opts.status] || statusMap.warning;

  const logoHtml = opts.logoUrl
    ? `<img src="${opts.logoUrl}" alt="${esc(opts.companyName)}" style="max-height:32px;max-width:140px;display:block;border:0;" />`
    : `<div style="background:${B.primary};padding:5px 11px;border-radius:6px;display:inline-block;"><span style="color:${B.accent};font-size:10px;font-weight:700;letter-spacing:.5px;">${esc(opts.companyName.toUpperCase())}</span></div>`;

  const row = (label: string, value: string) => `
    <tr>
      <td style="padding:7px 12px;background:${B.bg};border:1px solid ${B.border};font-size:11px;color:${B.textMid};width:140px;white-space:nowrap;">${label}</td>
      <td style="padding:7px 12px;border:1px solid ${B.border};font-size:13px;color:${B.textMain};">${value}</td>
    </tr>`;

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;font-family:${EMAIL_FONT};">
    <tr><td align="center" style="padding:32px 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#ffffff;border-radius:12px;border:1px solid ${B.border};">
    <tr><td style="padding:24px 28px;">

      <!-- Header -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:18px;padding-bottom:14px;border-bottom:1px solid ${B.border};">
        <tr>
          <td valign="middle">
            ${logoHtml}
            <div style="font-size:15px;font-weight:700;color:${B.primary};margin-top:6px;">Backup Kopia — ${esc(opts.serviceName)}</div>
          </td>
          <td valign="middle" align="right">
            <table role="presentation" cellpadding="0" cellspacing="0" style="background:${st.bg};border:1px solid ${st.border};border-radius:8px;">
              <tr><td style="padding:5px 14px;">
                <span style="color:${st.text};font-size:11px;font-weight:700;letter-spacing:.5px;">${st.label}</span>
              </td></tr>
            </table>
          </td>
        </tr>
      </table>

      <!-- Details table -->
      <table style="width:100%;border-collapse:collapse;margin-bottom:18px;">
        ${row("Servidor", esc(opts.hostname))}
        ${row("Fuente", esc(opts.source))}
        ${row("Inicio", esc(opts.started))}
        ${row("Duración", esc(opts.duration))}
        ${row("Tamaño total", esc(opts.totalSize))}
        ${row("Archivos", esc(opts.totalFiles))}
        ${row("Directorios", esc(opts.totalDirs))}
        ${opts.kopiaVersion ? row("Kopia", esc(opts.kopiaVersion)) : ""}
      </table>

      ${opts.failedEntriesHtml ? `
      <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:14px;margin-bottom:18px;">
        <p style="color:#DC2626;font-size:12px;font-weight:700;margin:0 0 8px;">Entradas con error</p>
        <ul style="margin:0;padding-left:18px;color:#7F1D1D;font-size:12px;line-height:1.6;">${opts.failedEntriesHtml}</ul>
      </div>` : ""}

      <p style="color:${B.textSoft};font-size:11px;margin:0;text-align:center;">
        Generado: ${esc(opts.generatedAt)}
      </p>
      ${emailMeta(opts.companyName)}

    </td></tr>
    </table>
    </td></tr>
  </table>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const ingestSecret = req.headers.get("X-Ingest-Secret");
    const serviceId = req.headers.get("X-Service-Id");

    if (!ingestSecret || !serviceId) {
      return new Response(JSON.stringify({ error: "Missing X-Ingest-Secret or X-Service-Id header" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: service } = await supabase
      .from("services")
      .select("user_id, ingest_secret, name, business_name")
      .eq("id", serviceId)
      .maybeSingle();

    if (!service || service.ingest_secret !== ingestSecret) {
      return new Response(JSON.stringify({ error: "Invalid credentials" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const contentType = req.headers.get("content-type") || "";
    const rawBody = await req.text();

    let status = "success";
    let jobName = "Kopia Backup";
    let sizeBytes: number | null = null;
    let durationSeconds: number | null = null;
    const backedUpAt = new Date().toISOString();

    // Fields for email
    let hostname = "";
    let sourcePath = "";
    let startedStr = "";
    let totalFiles = "";
    let totalDirs = "";
    let failedEntriesHtml = "";
    let kopiaVersion = "";

    if (contentType.includes("application/json")) {
      try {
        const body = JSON.parse(rawBody);
        const kopiaStatus: string = body.status || body.eventType || "";
        status = kopiaStatus.toUpperCase().includes("SUCCESS") ? "success"
          : kopiaStatus.toUpperCase().includes("FAIL") ? "failed" : "warning";

        hostname = body.source?.host || body.hostname || "";
        sourcePath = body.source?.path || body.sourcePath || "";
        if (sourcePath) jobName = `Kopia - ${sourcePath.split(/[/\\]/).pop() || sourcePath}`;
        else if (hostname) jobName = `Kopia - ${hostname}`;

        sizeBytes = body.stats?.totalSize ?? body.totalSize ?? null;
        totalFiles = body.stats?.numFiles != null ? String(body.stats.numFiles) : "";
        totalDirs  = body.stats?.numDirectories != null ? String(body.stats.numDirectories) : "";

        const startTime = body.startTime ? new Date(body.startTime).getTime() : null;
        const endTime   = body.endTime   ? new Date(body.endTime).getTime()   : null;
        if (startTime && endTime) durationSeconds = Math.round((endTime - startTime) / 1000);
        if (body.startTime) startedStr = new Date(body.startTime).toLocaleString("es-UY", { dateStyle: "medium", timeStyle: "short" });

        kopiaVersion = body.kopiaVersion || body.buildInfo?.version || "";

        if (Array.isArray(body.failedEntries) && body.failedEntries.length > 0) {
          if (status === "success") status = "warning";
          failedEntriesHtml = body.failedEntries
            .slice(0, 20)
            .map((e: { path?: string; error?: string }) =>
              `<li>${(e.path || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")}: ${(e.error || "error").replace(/&/g, "&amp;").replace(/</g, "&lt;")}</li>`
            ).join("");
        }
      } catch { /* fallthrough to HTML */ }
    }

    if (!contentType.includes("application/json") || !sourcePath) {
      // Plain text or HTML fallback — parse what we can
      const lower = rawBody.toLowerCase();
      if (!contentType.includes("application/json")) {
        if (lower.includes("fail") || lower.includes("error") || lower.includes("fallido")) status = "failed";
        else if (lower.includes("warn") || lower.includes("advertenc")) status = "warning";
      }

      if (!sourcePath) {
        const pathMatch = rawBody.match(/(?:path|source|fuente)[:\s]+([^\n\r<,]+)/i);
        if (pathMatch) {
          sourcePath = pathMatch[1].trim().replace(/<[^>]*>/g, "");
          jobName = `Kopia - ${sourcePath.split(/[/\\]/).pop() || sourcePath}`;
        }
      }

      if (!hostname) {
        const hostMatch = rawBody.match(/(?:hostname|servidor|host)[:\s]+([^\n\r<,]+)/i);
        if (hostMatch) hostname = hostMatch[1].trim().replace(/<[^>]*>/g, "");
      }

      if (!sizeBytes) {
        const sizeMatch = rawBody.match(/(\d+(?:\.\d+)?)\s*(GB|MB|KB|B)\b/i);
        if (sizeMatch) {
          const num = parseFloat(sizeMatch[1]);
          const unit = sizeMatch[2].toUpperCase();
          sizeBytes = unit === "GB" ? Math.round(num * 1073741824)
            : unit === "MB" ? Math.round(num * 1048576)
            : unit === "KB" ? Math.round(num * 1024) : Math.round(num);
        }
      }

      if (!durationSeconds) {
        const durMatch = rawBody.match(/(\d+(?:\.\d+)?)\s*(second|minute|hour|min|seg|seg\.|s\b|m\b|h\b)/i);
        if (durMatch) {
          const num = parseFloat(durMatch[1]);
          const unit = durMatch[2].toLowerCase();
          durationSeconds = unit.startsWith("h") ? Math.round(num * 3600)
            : (unit.startsWith("m") && !unit.startsWith("ms")) ? Math.round(num * 60) : Math.round(num);
        }
      }
    }

    const { error: insertErr } = await supabase.from("service_backups").insert({
      user_id: service.user_id,
      service_id: serviceId,
      job_name: jobName,
      status,
      size_bytes: sizeBytes || null,
      duration_seconds: durationSeconds,
      details: rawBody.slice(0, 500),
      backed_up_at: backedUpAt,
    });

    if (insertErr) {
      return new Response(JSON.stringify({ error: insertErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (status !== "failed") {
      const update: Record<string, unknown> = { last_backup_at: backedUpAt };
      if (sizeBytes) update.last_backup_size_bytes = sizeBytes;
      await supabase.from("services").update(update).eq("id", serviceId);
    }

    // Send email notification via Resend
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const toEmail = Deno.env.get("RESEND_KOPIA_TO") || Deno.env.get("RESEND_REPLY_TO");

    if (RESEND_API_KEY && toEmail) {
      try {
        const { data: settings } = await supabase
          .from("user_settings")
          .select("company_name, logo_url")
          .eq("user_id", service.user_id)
          .maybeSingle();

        const companyName = settings?.company_name || "Cenas IT";
        const serviceName = service.business_name || service.name || "Backup";
        const generatedAt = new Date().toLocaleString("es-UY", { dateStyle: "medium", timeStyle: "short" });

        const htmlBody = buildEmailHtml({
          companyName,
          logoUrl: settings?.logo_url,
          status,
          hostname: hostname || jobName,
          source: sourcePath || jobName,
          started: startedStr || generatedAt,
          duration: durationSeconds != null ? formatDuration(durationSeconds) : "—",
          totalSize: sizeBytes != null ? formatBytes(sizeBytes) : "—",
          totalFiles: totalFiles || "—",
          totalDirs: totalDirs || "—",
          failedEntriesHtml,
          generatedAt,
          kopiaVersion,
          serviceName,
        });

        const statusLabels: Record<string, string> = { success: "✅ OK", warning: "⚠️ Advertencia", failed: "❌ FALLIDO" };
        const subject = `[Backup Kopia] ${statusLabels[status] || "⚠️"} — ${serviceName}${hostname ? ` (${hostname})` : ""}`;

        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: Deno.env.get("RESEND_KOPIA_FROM") || Deno.env.get("RESEND_FROM_EMAIL") || "Cenas-Support Alerts <alerts@updates.cenas.uy>",
            ...(Deno.env.get("RESEND_KOPIA_REPLY_TO") ? { reply_to: Deno.env.get("RESEND_KOPIA_REPLY_TO") } : {}),
            to: [toEmail],
            subject,
            html: htmlBody,
          }),
        });
      } catch { /* non-fatal: DB insert already succeeded */ }
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
