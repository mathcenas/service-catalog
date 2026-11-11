import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Recibe la fila de un equipo desde device-report.ps1 y hace upsert por
// (cliente, hostname). Autentica con service_id + X-Ingest-Secret de un
// servicio del cliente (recomendado: uno dedicado "Inventario de equipos",
// porque el secret queda en el script que se distribuye a todas las PCs).

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://servicios.cenas-support.com",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey, X-Ingest-Secret",
};

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const str = (v: unknown, max = 200): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const serviceId = body?.service_id;
    if (!serviceId || !UUID_RE.test(serviceId)) return json({ error: "service_id must be a valid UUID" }, 400);

    const hostname = str(body?.hostname, 63)?.toUpperCase();
    if (!hostname) return json({ error: "hostname is required" }, 400);

    const ingestSecret = req.headers.get("X-Ingest-Secret");
    if (!ingestSecret) return json({ error: "Missing X-Ingest-Secret header" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: service, error: svcErr } = await admin
      .from("services")
      .select("user_id, client_id, ingest_secret")
      .eq("id", serviceId)
      .maybeSingle();

    if (svcErr || !service) return json({ error: "Service not found" }, 404);
    if (!service.ingest_secret || service.ingest_secret !== ingestSecret) {
      return json({ error: "Invalid secret" }, 401);
    }
    if (!service.client_id) return json({ error: "Service has no client" }, 400);

    const hw = body?.hardware && typeof body.hardware === "object" ? body.hardware : {};
    const hardware = {
      manufacturer: str(hw.manufacturer, 100),
      model: str(hw.model, 100),
      serial: str(hw.serial, 100),
      ram_gb: num(hw.ram_gb),
      disk_total_gb: num(hw.disk_total_gb),
      disk_free_gb: num(hw.disk_free_gb),
      os_build: str(hw.os_build, 50),
      last_boot: str(hw.last_boot, 40),
    };

    const { error: upErr } = await admin
      .from("device_reports")
      .upsert({
        user_id: service.user_id,
        client_id: service.client_id,
        service_id: serviceId,
        hostname,
        ip: str(body?.ip, 45),
        local_user: str(body?.local_user, 100),
        m365_user: str(body?.m365_user, 200),
        nas_user: str(body?.nas_user, 100),
        os: str(body?.os, 100),
        office: str(body?.office, 100),
        has_copilot: body?.has_copilot === true,
        hardware,
        script_version: str(body?.script_version, 20),
        reported_at: new Date().toISOString(),
      }, { onConflict: "client_id,hostname" });

    if (upErr) return json({ error: upErr.message }, 500);
    return json({ success: true, hostname }, 200);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
