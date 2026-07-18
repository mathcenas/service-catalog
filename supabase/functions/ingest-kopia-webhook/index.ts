import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Ingest-Secret",
};

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
      .select("user_id, ingest_secret")
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

    if (contentType.includes("application/json")) {
      try {
        const body = JSON.parse(rawBody);
        const kopiaStatus: string = body.status || body.eventType || "";
        status = kopiaStatus.includes("SUCCESS") ? "success"
          : kopiaStatus.includes("FAIL") ? "failed" : "warning";
        const sourcePath: string = body.source?.path || body.sourcePath || "";
        if (sourcePath) jobName = `Kopia - ${sourcePath.split(/[/\\]/).pop() || sourcePath}`;
        sizeBytes = body.stats?.totalSize ?? body.totalSize ?? null;
        const startTime = body.startTime ? new Date(body.startTime).getTime() : null;
        const endTime = body.endTime ? new Date(body.endTime).getTime() : null;
        if (startTime && endTime) durationSeconds = Math.round((endTime - startTime) / 1000);
      } catch { /* fallthrough */ }
    } else {
      // Plain text or HTML — parse what we can
      const lower = rawBody.toLowerCase();
      if (lower.includes("fail") || lower.includes("error")) status = "failed";
      else if (lower.includes("warn")) status = "warning";

      // Try to extract path
      const pathMatch = rawBody.match(/path[:\s]+([^\n\r,]+)/i) || rawBody.match(/source[:\s]+([^\n\r,]+)/i);
      if (pathMatch) jobName = `Kopia - ${pathMatch[1].trim().split(/[/\\]/).pop() || pathMatch[1].trim()}`;

      // Try to extract size
      const sizeMatch = rawBody.match(/(\d+(?:\.\d+)?)\s*(GB|MB|KB|B)\b/i);
      if (sizeMatch) {
        const num = parseFloat(sizeMatch[1]);
        const unit = sizeMatch[2].toUpperCase();
        sizeBytes = unit === "GB" ? Math.round(num * 1073741824)
          : unit === "MB" ? Math.round(num * 1048576)
          : unit === "KB" ? Math.round(num * 1024) : Math.round(num);
      }

      // Try to extract duration
      const durMatch = rawBody.match(/(\d+(?:\.\d+)?)\s*(second|minute|hour|min|sec|s\b)/i);
      if (durMatch) {
        const num = parseFloat(durMatch[1]);
        const unit = durMatch[2].toLowerCase();
        durationSeconds = unit.startsWith("h") ? Math.round(num * 3600)
          : unit.startsWith("m") ? Math.round(num * 60) : Math.round(num);
      }
    }

    const { error: insertErr } = await supabase.from("service_backups").insert({
      user_id: service.user_id,
      service_id: serviceId,
      job_name: jobName,
      status,
      size_bytes: sizeBytes || null,
      duration_seconds: durationSeconds,
      details: `snapshot_id=${body.snapshotID || "unknown"} path=${sourcePath}`,
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

    return new Response(JSON.stringify({ success: true }), {
      status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
