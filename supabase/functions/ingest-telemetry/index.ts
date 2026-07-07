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

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const ingestSecret = req.headers.get("X-Ingest-Secret");
    if (!ingestSecret) {
      return new Response(
        JSON.stringify({ error: "Missing X-Ingest-Secret header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const { service_id, telemetry, vpn_peers } = body;

    if (!service_id) {
      return new Response(
        JSON.stringify({ error: "service_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: service, error: svcErr } = await supabaseAdmin
      .from("services")
      .select("user_id, ingest_secret")
      .eq("id", service_id)
      .maybeSingle();

    if (svcErr || !service) {
      return new Response(
        JSON.stringify({ error: "Service not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!service.ingest_secret || service.ingest_secret !== ingestSecret) {
      return new Response(
        JSON.stringify({ error: "Invalid secret" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = service.user_id;
    const results: Record<string, unknown> = {};

    if (telemetry) {
      const { error: telErr } = await supabaseAdmin
        .from("device_telemetry")
        .insert({
          user_id: userId,
          service_id,
          hostname: telemetry.hostname || "unknown",
          cpu_pct: telemetry.cpu_pct ?? null,
          ram_used_mb: telemetry.ram_used_mb ?? null,
          ram_total_mb: telemetry.ram_total_mb ?? null,
          bandwidth_in_bps: telemetry.bandwidth_in_bps ?? null,
          bandwidth_out_bps: telemetry.bandwidth_out_bps ?? null,
          uptime_seconds: telemetry.uptime_seconds ?? null,
          firmware_version: telemetry.firmware_version ?? null,
          recorded_at: telemetry.recorded_at || new Date().toISOString(),
        });

      if (telErr) {
        results.telemetry_error = telErr.message;
      } else {
        results.telemetry = "inserted";
      }
    }

    if (vpn_peers && Array.isArray(vpn_peers) && vpn_peers.length > 0) {
      const rows = vpn_peers.map((p: Record<string, unknown>) => ({
        user_id: userId,
        service_id,
        peer_name: p.peer_name || "unknown",
        tunnel_type: p.tunnel_type || "ipsec",
        remote_address: p.remote_address ?? null,
        local_address: p.local_address ?? null,
        status: p.status || "unknown",
        last_handshake_at: p.last_handshake_at ?? null,
        rx_bytes: p.rx_bytes ?? 0,
        tx_bytes: p.tx_bytes ?? 0,
        uptime_seconds: p.uptime_seconds ?? null,
        comment: p.comment ?? null,
        recorded_at: p.recorded_at || new Date().toISOString(),
      }));

      const { error: vpnErr } = await supabaseAdmin
        .from("vpn_peers")
        .insert(rows);

      if (vpnErr) {
        results.vpn_peers_error = vpnErr.message;
      } else {
        results.vpn_peers = `${rows.length} inserted`;
      }
    }

    return new Response(
      JSON.stringify({ success: true, results, received_at: new Date().toISOString() }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
