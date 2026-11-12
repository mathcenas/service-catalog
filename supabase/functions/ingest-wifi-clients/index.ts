import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Recibe la tabla de registración Wi-Fi de un MikroTik (mk-wifi-report.sh) y
// actualiza wifi_clients: upsert de los conectados ahora, y marca como
// desconectados los que ya no aparecen. Auth: service_id + X-Ingest-Secret.

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://servicios.cenas-support.com",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Ingest-Secret",
};

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAC_RE = /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/;

const str = (v: unknown, max = 120): string | null => {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t ? t.slice(0, max) : null;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const serviceId = body?.service_id;
    if (!serviceId || !UUID_RE.test(serviceId)) return json({ error: "service_id must be a valid UUID" }, 400);
    if (!Array.isArray(body?.clients)) return json({ error: "clients must be an array" }, 400);

    const secret = req.headers.get("X-Ingest-Secret");
    if (!secret) return json({ error: "Missing X-Ingest-Secret header" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: service } = await admin
      .from("services").select("user_id, client_id, ingest_secret").eq("id", serviceId).maybeSingle();
    if (!service) return json({ error: "Service not found" }, 404);
    if (!service.ingest_secret || service.ingest_secret !== secret) return json({ error: "Invalid secret" }, 401);

    const now = new Date().toISOString();
    const seen = new Map<string, Record<string, unknown>>();
    for (const c of body.clients.slice(0, 2000)) {
      const mac = str(c?.mac, 17)?.toUpperCase();
      if (!mac || !MAC_RE.test(mac)) continue;
      const signal = Number.parseInt(String(c?.signal ?? ""), 10);
      seen.set(mac, {
        user_id: service.user_id,
        client_id: service.client_id,
        service_id: serviceId,
        mac,
        ip: str(c?.ip, 45),
        hostname: str(c?.hostname),
        comment: str(c?.comment, 200),
        ssid: str(c?.ssid, 64),
        interface: str(c?.interface, 64),
        signal: Number.isFinite(signal) ? signal : null,
        tx_rate: str(c?.tx_rate, 40),
        rx_rate: str(c?.rx_rate, 40),
        uptime: str(c?.uptime, 40),
        connected: true,
        last_seen: now,
      });
    }

    const rows = [...seen.values()];
    if (rows.length) {
      const { error } = await admin.from("wifi_clients").upsert(rows, { onConflict: "service_id,mac" });
      if (error) return json({ error: error.message }, 500);
    }

    // Los que estaban conectados y ya no aparecen
    let q = admin.from("wifi_clients").update({ connected: false })
      .eq("service_id", serviceId).eq("connected", true);
    if (rows.length) q = q.not("mac", "in", `(${rows.map(r => `"${r.mac}"`).join(",")})`);
    const { error: discErr } = await q;
    if (discErr) return json({ error: discErr.message }, 500);

    return json({ success: true, connected: rows.length }, 200);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
