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

    // Validar que el site existe
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

    // Validar que el secret pertenece a un servicio del cliente
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

    // ── Upsert devices ──────────────────────────────────────────────────────
    // Normalizar MACs a mayúsculas para consistencia
    const normalizeMac = (mac: string) => mac?.toUpperCase().replace(/[^0-9A-F:]/g, "") ?? null;

    // Construir mapa mac → uuid para resolver los links después
    const macToId = new Map<string, string>();

    if (Array.isArray(devices) && devices.length > 0) {
      const rows = devices
        .filter((d: Record<string, unknown>) => d.mac_address)  // mac es required para upsert
        .map((d: Record<string, unknown>) => ({
          site_id,
          name:        String(d.name ?? d.hostname ?? d.mac_address),
          device_type: String(d.device_type ?? d.type ?? "switch_unmanaged"),
          ip_address:  d.ip_address != null ? String(d.ip_address) : null,
          mac_address: normalizeMac(String(d.mac_address)),
          model:       d.model != null ? String(d.model) : null,
          status:      String(d.status ?? "online"),
          raw_data:    d.raw_data ?? null,
          source,
          last_seen:   now,
          updated_at:  now,
        }));

      const { data: upserted, error: devErr } = await supabase
        .from("net_devices")
        .upsert(rows, { onConflict: "site_id,mac_address", ignoreDuplicates: false })
        .select("id, mac_address");

      if (devErr) {
        console.error("[ingest-net-topology] devices error:", devErr.message);
      } else {
        for (const row of (upserted ?? [])) {
          if (row.mac_address) macToId.set(row.mac_address.toUpperCase(), row.id);
        }
        results.devices_upserted = upserted?.length ?? 0;
      }
    }

    // ── Reemplazar links del site ───────────────────────────────────────────
    // Soporta tanto {source_device_id, target_device_id} (UUIDs) como
    // {source_mac, target_mac} (MACs — lo que envía el script RouterOS)
    if (Array.isArray(edges) && edges.length > 0) {
      const linkRows = [];

      for (const e of edges as Record<string, unknown>[]) {
        let srcId = e.source_device_id as string | undefined;
        let tgtId = e.target_device_id as string | undefined;

        // Resolver por MAC si no vienen UUIDs
        if (!srcId && e.source_mac) {
          srcId = macToId.get(normalizeMac(String(e.source_mac)) ?? "");
        }
        if (!tgtId && e.target_mac) {
          tgtId = macToId.get(normalizeMac(String(e.target_mac)) ?? "");
        }

        if (!srcId || !tgtId) {
          console.warn("[ingest-net-topology] link ignorado — no se resolvieron los dispositivos:", e);
          continue;
        }

        linkRows.push({
          site_id,
          source_device_id: srcId,
          target_device_id: tgtId,
          source_port:      e.source_port != null ? String(e.source_port) : null,
          target_port:      e.target_port != null ? String(e.target_port) : null,
          link_type:        String(e.link_type ?? "utp"),
          label:            e.label != null ? String(e.label) : null,
          updated_at:       now,
        });
      }

      if (linkRows.length > 0) {
        await supabase.from("net_links").delete().eq("site_id", site_id);
        const { error: linkErr } = await supabase.from("net_links").insert(linkRows);
        if (linkErr) console.error("[ingest-net-topology] links error:", linkErr.message);
        results.links_replaced = linkRows.length;
      }
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
