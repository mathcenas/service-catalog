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
    const { site_id, source, devices, edges } = body;

    if (!site_id || !source) {
      return new Response(JSON.stringify({ error: "site_id y source son requeridos" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    // Validar que el site existe y el secret corresponde a un servicio del cliente
    const { data: site, error: siteErr } = await supabase
      .from("sites")
      .select("id, client_id")
      .eq("id", site_id)
      .maybeSingle();

    if (siteErr || !site) {
      return new Response(JSON.stringify({ error: "site_id no encontrado" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: svc, error: svcErr } = await supabase
      .from("services")
      .select("ingest_secret")
      .eq("client_id", site.client_id)
      .eq("ingest_secret", ingestSecret)
      .maybeSingle();

    if (svcErr || !svc) {
      return new Response(JSON.stringify({ error: "Invalid secret" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date().toISOString();
    const results: Record<string, unknown> = {};

    // Upsert devices
    if (Array.isArray(devices) && devices.length > 0) {
      const rows = devices.map((d: Record<string, unknown>) => ({
        site_id,
        name:        d.name ?? d.hostname ?? d.device_id,
        device_type: d.device_type ?? d.type ?? "switch_unmanaged",
        ip_address:  d.ip_address ?? d.ip ?? null,
        mac_address: d.mac_address ?? null,
        model:       d.model ?? null,
        status:      d.status ?? "unknown",
        raw_data:    d.raw_data ?? null,
        source,
        last_seen:   now,
        updated_at:  now,
      }));

      const { error: devErr, count } = await supabase
        .from("net_devices")
        .upsert(rows, { onConflict: "site_id,mac_address", ignoreDuplicates: false })
        .select("id", { count: "exact", head: true });

      if (devErr) console.error("[ingest-net-topology] devices error:", devErr.message);
      results.devices_upserted = count ?? rows.length;
    }

    // Reemplazar links del site con los recibidos
    if (Array.isArray(edges) && edges.length > 0) {
      await supabase.from("net_links").delete().eq("site_id", site_id);

      const linkRows = edges.map((e: Record<string, unknown>) => ({
        site_id,
        source_device_id: e.source_device_id,
        target_device_id: e.target_device_id,
        source_port:      e.source_port ?? null,
        target_port:      e.target_port ?? null,
        link_type:        e.link_type ?? "utp",
        label:            e.label ?? null,
        updated_at:       now,
      }));

      const { error: linkErr } = await supabase.from("net_links").insert(linkRows);
      if (linkErr) console.error("[ingest-net-topology] links error:", linkErr.message);
      results.links_replaced = linkRows.length;
    }

    console.log(`[ingest-net-topology] client=${site.client_id} site=${site_id} source=${source}`, results);

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
