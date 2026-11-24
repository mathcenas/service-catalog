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
      .select("user_id, ingest_secret, ip_public, ip_internal, specifications, name, mac_address, infrastructure_type")
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

    // Auto-update service fields from system-health heartbeats.
    if (source === "system-health" && payload) {
      const svcUpdate: Record<string, unknown> = {};

      // IPs
      const reportedPublic   = typeof payload.public_ip === "string" ? payload.public_ip.trim() : null;
      const reportedInternal = typeof payload.local_ip  === "string" ? payload.local_ip.trim()  : null;
      if (reportedPublic   && reportedPublic   !== service.ip_public)   svcUpdate.ip_public   = reportedPublic;
      if (reportedInternal && reportedInternal !== service.ip_internal) svcUpdate.ip_internal = reportedInternal;

      // Hardware specs — merge into existing specs JSONB, only overwrite when value is present
      const specsUpdate: Record<string, unknown> = {};
      const cpuModel   = typeof payload.cpu_model    === "string" ? payload.cpu_model.trim()    : null;
      const cpuName    = typeof payload.cpu_name     === "string" ? payload.cpu_name.trim()     : null;
      const cpuCores   = typeof payload.cpu_cores    === "number" ? payload.cpu_cores            : null;
      const cpuThreads = typeof payload.cpu_threads  === "number" ? payload.cpu_threads          : null;
      const ramGB      = typeof payload.ram_total_gb === "number" ? payload.ram_total_gb         : null;
      const osName     = typeof payload.os_name      === "string" ? payload.os_name.trim()      : null;
      const osCaption  = typeof payload.os_caption   === "string" ? payload.os_caption.trim()   : null;
      const hostname   = typeof payload.hostname     === "string" ? payload.hostname.trim()     : null;
      const diskPct    = typeof payload.disk_pct     === "number" ? payload.disk_pct             : null;
      const diskFreeGB = typeof payload.disk_free_gb === "number" ? payload.disk_free_gb         : null;
      const diskTotalGB= typeof payload.disk_total_gb=== "number" ? payload.disk_total_gb        : null;

      if (cpuModel || cpuName)  specsUpdate.cpu        = cpuModel || cpuName;
      if (cpuCores)             specsUpdate.cpu_cores  = cpuCores;
      if (cpuThreads)           specsUpdate.cpu_threads= cpuThreads;
      if (ramGB)                specsUpdate.ram        = `${ramGB} GB`;
      if (osName || osCaption)  specsUpdate.os         = osName || osCaption;
      if (hostname)             specsUpdate.hostname   = hostname;
      if (diskPct != null)      specsUpdate.disk_used_pct = diskPct;
      if (diskFreeGB != null)   specsUpdate.disk_free_gb  = diskFreeGB;
      if (diskTotalGB != null)  specsUpdate.disk_total_gb = diskTotalGB;

      // IP de Tailscale: Windows la manda suelta (tailscale_ip), Linux dentro de tailscale.self
      const tsIp = typeof payload.tailscale_ip === "string" ? payload.tailscale_ip.trim()
        : typeof payload.tailscale?.self?.ip === "string" ? String(payload.tailscale.self.ip).trim() : null;
      if (tsIp && /^100\.\d+\.\d+\.\d+$/.test(tsIp)) specsUpdate.tailscale_ip = tsIp;

      if (Object.keys(specsUpdate).length > 0) {
        const existingSpecs = (service.specifications && typeof service.specifications === "object") ? service.specifications as Record<string, unknown> : {};
        svcUpdate.specifications = { ...existingSpecs, ...specsUpdate };
      }

      // Uso de disco y RAM: el portal del cliente los muestra como barras en la ficha del servicio
      const ramPct = typeof payload.ram_pct === "number" ? payload.ram_pct : null;
      if (diskPct != null) svcUpdate.storage_used_pct = Math.round(diskPct);
      if (ramPct != null) svcUpdate.ram_used_pct = Math.round(ramPct);
      if (diskPct != null || ramPct != null) svcUpdate.resource_updated_at = new Date().toISOString();

      // Solo si están vacíos (lo cargado a mano no se pisa): MAC de la placa principal (para unir el
      // equipo con lo que descubre el router en el mapa) y tipo de infraestructura (un VPS tiene la
      // IP pública en su propia placa)
      const mac = typeof payload.mac_address === "string" ? payload.mac_address.trim().toUpperCase() : "";
      if (!service.mac_address && /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac)) svcUpdate.mac_address = mac;
      if (!service.infrastructure_type && reportedPublic && reportedInternal && reportedPublic === reportedInternal) {
        svcUpdate.infrastructure_type = "Cloud";
      }

      if (Object.keys(svcUpdate).length > 0) {
        await supabaseAdmin.from("services").update(svcUpdate).eq("id", service_id);
      }
    }

    // source = "mk-network" (scripts/mikrotik/mk-network-report.rsc): IP pública, LAN y datos
    // del router quedan en el servicio. Sin claves: el script solo manda claves públicas.
    if (source === "mk-network" && payload && typeof payload === "object") {
      try {
        const svcUpdate: Record<string, unknown> = {};
        const pub = typeof payload.public_ip === "string" ? payload.public_ip.trim() : "";
        if (pub && pub !== service.ip_public) svcUpdate.ip_public = pub;
        const lans = Array.isArray(payload.lans) ? payload.lans : [];
        const firstLan = lans.find((l: any) => typeof l?.address === "string");
        const lanIp = firstLan ? String(firstLan.address).split("/")[0] : "";
        if (lanIp && lanIp !== service.ip_internal) svcUpdate.ip_internal = lanIp;

        const specsUpdate: Record<string, unknown> = {};
        if (typeof payload.board === "string" && payload.board) specsUpdate.model = payload.board;
        if (typeof payload.routeros_version === "string" && payload.routeros_version) specsUpdate.routeros_version = payload.routeros_version;
        if (typeof payload.identity === "string" && payload.identity) specsUpdate.hostname = payload.identity;
        if (typeof payload.ddns_name === "string" && payload.ddns_name) specsUpdate.ddns_name = payload.ddns_name;
        const nets = lans.map((l: any) => l?.network).filter((n: unknown) => typeof n === "string");
        if (nets.length) specsUpdate.lan_networks = nets;
        const wg = Array.isArray(payload.wireguard) ? payload.wireguard : [];
        if (wg.length) {
          specsUpdate.wireguard = wg.map((w: any) => ({
            name: w?.name, address: w?.address, listen_port: w?.listen_port,
            peers: (Array.isArray(w?.peers) ? w.peers : []).map((p: any) => ({
              name: p?.name || p?.comment || "", endpoint: p?.endpoint || "", allowed_address: p?.allowed_address || "",
            })),
          }));
        }
        if (Object.keys(specsUpdate).length) {
          const existingSpecs = (service.specifications && typeof service.specifications === "object") ? service.specifications as Record<string, unknown> : {};
          svcUpdate.specifications = { ...existingSpecs, ...specsUpdate };
        }
        if (Object.keys(svcUpdate).length) {
          await supabaseAdmin.from("services").update(svcUpdate).eq("id", service_id);
        }
      } catch (e) {
        console.error("mk-network: no se pudo actualizar el servicio", e);
      }
    }

    // source = "rdp" — persistir anydesk_id en specifications
    if (source === "rdp" && payload) {
      // Solo IDs válidos (numérico o alias nombre@ad). Scripts < 1.9.3 mandaban "a" por un bug.
      const raw = payload.anydesk_id != null ? String(payload.anydesk_id).replace(/\s/g, "") : "";
      const anydeskId = /^(\d{6,12}|[\w.-]+@[\w.-]+)$/.test(raw) ? raw : null;
      if (anydeskId) {
        const existingSpecs = (service.specifications && typeof service.specifications === "object") ? service.specifications as Record<string, unknown> : {};
        if (existingSpecs.anydesk_id !== anydeskId) {
          await supabaseAdmin.from("services").update({
            specifications: { ...existingSpecs, anydesk_id: anydeskId },
          }).eq("id", service_id);
        }
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
