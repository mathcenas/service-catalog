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

    const body = await req.json();

    // Kopia webhook payload
    const kopiaStatus: string = body.status || body.eventType || "";
    const status = kopiaStatus.includes("SUCCESS") || kopiaStatus === "SNAPSHOT_STATUS_SUCCESS"
      ? "success"
      : kopiaStatus.includes("FAIL") ? "failed" : "warning";

    const sourcePath: string = body.source?.path || body.sourcePath || "unknown";
    const jobName = `Kopia - ${sourcePath.split(/[/\\]/).pop() || sourcePath}`;

    const sizeBytes: number = body.stats?.totalSize ?? body.totalSize ?? 0;

    const startTime = body.startTime ? new Date(body.startTime).getTime() : null;
    const endTime = body.endTime ? new Date(body.endTime).getTime() : null;
    const durationSeconds = startTime && endTime ? Math.round((endTime - startTime) / 1000) : null;

    const backedUpAt = body.endTime || body.startTime || new Date().toISOString();

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
