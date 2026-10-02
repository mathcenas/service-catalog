import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Ingest-Secret",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const { client_id, site_id, source, devices, edges } = body;

    if (!client_id || !site_id || !source) {
      return new Response(JSON.stringify({ error: "client_id, site_id y source son requeridos" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validar secret
    const ingestSecret = req.headers.get("X-Ingest-Secret");
    if (!ingestSecret) {
      return new Response(JSON.stringify({ error: "Missing X-Ingest-Secret header" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Validar que el servicio pertenece al cliente y el secret es correcto
    const { data: svc, error: svcErr } = await supabase
      .from("services")
      .select("ingest_secret")
      .eq("client_id", client_id)
      .eq("ingest_secret", ingestSecret)
      .maybeSingle();

    if (svcErr || !svc) {
      return new Response(JSON.stringify({ error: "Invalid secret or client not found" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date().toISOString();
    const results: Record<string, unknown> = {};

    // Upsert devices
    if (Array.isArray(devices) && devices.length > 0) {
      const rows = devices.map((d: Record<string, unknown>) => ({
        client_id,
        site_id,
        device_id:            d.device_id,
        type:                 d.type ?? "unmanaged",
        hostname:             d.hostname ?? null,
        ip:                   d.ip ?? null,
        model:                d.model ?? null,
        status:               d.status ?? "unknown",
        uptime_seconds:       d.uptime_seconds ?? null,
        throughput_in_bps:    d.throughput_in_bps ?? null,
        throughput_out_bps:   d.throughput_out_bps ?? null,
        raw_data:             d.raw_data ?? null,
        source,
        last_seen_at:         now,
        updated_at:           now,
      }));

      const { error: devErr, count } = await supabase
        .from("net_devices")
        .upsert(rows, { onConflict: "client_id,site_id,device_id" })
        .select("id", { count: "exact", head: true });

      if (devErr) console.error("[ingest-net-topology] devices error:", devErr.message);
      results.devices_upserted = count ?? rows.length;
    }

    // Upsert edges — primero borra los del site y re-inserta para reflejar topología actual
    if (Array.isArray(edges) && edges.length > 0) {
      await supabase
        .from("net_edges")
        .delete()
        .eq("client_id", client_id)
        .eq("site_id", site_id);

      const edgeRows = edges.map((e: Record<string, unknown>) => ({
        client_id,
        site_id,
        source_device_id: e.source_device_id,
        target_device_id: e.target_device_id,
        link_type:        e.link_type ?? "ethernet",
        label:            e.label ?? null,
        raw_data:         e.raw_data ?? null,
        updated_at:       now,
      }));

      const { error: edgeErr } = await supabase.from("net_edges").insert(edgeRows);
      if (edgeErr) console.error("[ingest-net-topology] edges error:", edgeErr.message);
      results.edges_replaced = edgeRows.length;
    }

    console.log(`[ingest-net-topology] client=${client_id} site=${site_id} source=${source}`, results);

    return new Response(
      JSON.stringify({ success: true, received_at: now, ...results }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
