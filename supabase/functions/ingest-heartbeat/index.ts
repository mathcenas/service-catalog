import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://servicios.cenas-support.com",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey, X-Ingest-Secret",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ingestSecret = req.headers.get("X-Ingest-Secret");
    if (!ingestSecret) {
      return new Response(
        JSON.stringify({ error: "Missing X-Ingest-Secret header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const { service_id, source, payload, status, message } = body;

    if (!service_id) {
      return new Response(
        JSON.stringify({ error: "service_id is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: service, error: svcErr } = await supabaseAdmin
      .from("services")
      .select("user_id, ingest_secret, ip_public, ip_internal")
      .eq("id", service_id)
      .maybeSingle();

    if (svcErr || !service) {
      return new Response(
        JSON.stringify({ error: "Service not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!service.ingest_secret || service.ingest_secret !== ingestSecret) {
      return new Response(
        JSON.stringify({ error: "Invalid secret" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { error: insertErr } = await supabaseAdmin
      .from("service_heartbeats")
      .insert({
        user_id: service.user_id,
        service_id,
        source: source || "speedtest",
        payload: payload || {},
        status: status || "ok",
        message: message || null,
      });

    // Auto-update ip_public / ip_internal on the service if the heartbeat
    // reports IPs that differ from what's stored (or fields are empty).
    if (source === "system-health" && payload) {
      const ipUpdate: Record<string, string> = {};
      const reportedPublic   = typeof payload.public_ip === "string" ? payload.public_ip.trim() : null;
      const reportedInternal = typeof payload.local_ip  === "string" ? payload.local_ip.trim()  : null;
      if (reportedPublic   && reportedPublic   !== service.ip_public)   ipUpdate.ip_public   = reportedPublic;
      if (reportedInternal && reportedInternal !== service.ip_internal) ipUpdate.ip_internal = reportedInternal;
      if (Object.keys(ipUpdate).length > 0) {
        await supabaseAdmin.from("services").update(ipUpdate).eq("id", service_id);
      }
    }

    if (insertErr) {
      return new Response(
        JSON.stringify({ error: insertErr.message }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({ success: true, received_at: new Date().toISOString() }),
      {
        status: 201,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
