import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Ingest-Secret",
};

type DiscoveredRow = { id: string; mac_address: string | null; ip_address: string | null; model: string | null; name: string | null; service_id: string | null };

/**
 * Un servicio cargado a mano "absorbe" al equipo descubierto con su misma MAC o IP:
 * se vincula (net_devices.service_id) y el servicio completa lo que le falte
 * (MAC, modelo, nombre anunciado). Nunca pisa datos cargados a mano, ni un
 * vínculo que ya exista.
 */
async function absorbIntoServices(
  // deno-lint-ignore no-explicit-any
  supabase: any, clientId: string, siteId: string, devices: DiscoveredRow[],
): Promise<number> {
  const { data: services } = await supabase
    .from("services")
    .select("id, site_id, mac_address, server_ip, ip_internal, ip_public, specifications, status")
    .eq("client_id", clientId)
    .neq("status", "Cancelled");
  if (!services?.length) return 0;

  const norm = (v?: string | null) => (v ?? "").trim().toUpperCase();
  let absorbed = 0;
  for (const d of devices) {
    if (d.service_id) continue;
    const mac = norm(d.mac_address);
    const ip = (d.ip_address ?? "").trim();
    // Preferir servicios del mismo sitio (o sin sitio)
    const candidates = [...services].sort((a, b) =>
      Number(b.site_id === siteId || !b.site_id) - Number(a.site_id === siteId || !a.site_id));
    const svc = candidates.find(s => mac && norm(s.mac_address) === mac)
      ?? candidates.find(s => ip && [s.server_ip, s.ip_internal, s.ip_public].some(x => (x ?? "").trim() === ip));
    if (!svc) continue;

    await supabase.from("net_devices").update({ service_id: svc.id }).eq("id", d.id);

    const update: Record<string, unknown> = {};
    if (!svc.mac_address && mac) update.mac_address = mac;
    const specs = (svc.specifications && typeof svc.specifications === "object") ? { ...svc.specifications } : {};
    let specsChanged = false;
    if (!specs.model && d.model?.trim()) { specs.model = d.model.trim(); specsChanged = true; }
    if (!specs.lldp_name && d.name && norm(d.name) !== mac) { specs.lldp_name = d.name; specsChanged = true; }
    if (specsChanged) update.specifications = specs;
    if (Object.keys(update).length) await supabase.from("services").update(update).eq("id", svc.id);
    svc.mac_address = svc.mac_address || mac;
    absorbed++;
  }
  return absorbed;
}

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
        .select("id, mac_address, ip_address, model, name, service_id");

      if (devErr) {
        console.error("[ingest-net-topology] devices error:", devErr.message);
      } else {
        for (const row of (upserted ?? [])) {
          if (row.mac_address) macToId.set(row.mac_address.toUpperCase(), row.id);
        }
        results.devices_upserted = upserted?.length ?? 0;
        results.absorbed = await absorbIntoServices(supabase, site.client_id, site_id, upserted ?? []);
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
