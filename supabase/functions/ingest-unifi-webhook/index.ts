import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// UniFi alarm key → { status, label }
const EVENT_MAP: Record<string, { status: "ok" | "warning" | "failed"; label: string }> = {
  // Internet
  "EVT_GW_WANTransition":        { status: "failed",  label: "WAN desconectado" },
  "EVT_GW_WANTransitionUp":      { status: "ok",      label: "WAN reconectado" },
  "EVT_GW_DataLimitExceeded":    { status: "warning", label: "Límite de datos alcanzado" },
  // DHCP
  "EVT_SW_DHCPLeaseExhausted":   { status: "warning", label: "DHCP leases agotados" },
  // Devices
  "EVT_AP_Lost_Contact":         { status: "warning", label: "AP sin contacto" },
  "EVT_GW_Unadopted":            { status: "warning", label: "Gateway no adoptado" },
  "EVT_LU_Disconnected":         { status: "warning", label: "Dispositivo desconectado" },
  "EVT_SW_PoeDisconnect":        { status: "warning", label: "PoE desconectado" },
  "EVT_SW_PortTxError":          { status: "warning", label: "Error de transmisión en puerto" },
  "EVT_SW_PortDropPackets":      { status: "warning", label: "Puerto descartando paquetes" },
  "EVT_SW_StpBlockedPort":       { status: "warning", label: "STP bloqueó un puerto (loop)" },
  "EVT_SW_NetworkLoopDetected":  { status: "warning", label: "Loop de red detectado" },
  "EVT_GW_MultipleRestarts":     { status: "warning", label: "Múltiples reinicios detectados" },
  "EVT_GW_ModemRestarted":       { status: "warning", label: "Módem reiniciado" },
  // Power
  "EVT_GW_BackupPower":          { status: "warning", label: "Operando con energía de respaldo" },
  "EVT_GW_InsufficientPoe":      { status: "warning", label: "Energía PoE insuficiente" },
  "EVT_GW_FanIssue":             { status: "warning", label: "Problema de ventilador" },
  // Security
  "EVT_IPS_IpsAlert":            { status: "warning", label: "Alerta IDS/IPS" },
  // Auth
  "EVT_GW_RadiusSlow":           { status: "warning", label: "RADIUS lento" },
  // Adoption (informational → ok)
  "EVT_LU_Connected":            { status: "ok",      label: "Dispositivo adoptado/conectado" },
};

// Derive status from the alarm name when key is unknown
function statusFromName(name: string): "ok" | "warning" | "failed" {
  const low = name.toLowerCase();
  if (low.includes("disconnected") || low.includes("exhausted") || low.includes("loop") ||
      low.includes("error") || low.includes("issue") || low.includes("alert") ||
      low.includes("exceeded") || low.includes("restart") || low.includes("slow") ||
      low.includes("backup power") || low.includes("insufficient")) return "warning";
  if (low.includes("internet disconnected") || low.includes("wan down")) return "failed";
  return "ok";
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const url       = new URL(req.url);
  const serviceId = url.searchParams.get("service_id");
  const secret    = req.headers.get("X-Ingest-Secret");

  if (!serviceId || !secret) {
    return new Response(JSON.stringify({ error: "Missing service_id or X-Ingest-Secret" }), { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: service, error: svcErr } = await supabase
    .from("services")
    .select("user_id, ingest_secret, name, business_name")
    .eq("id", serviceId)
    .maybeSingle();

  if (svcErr || !service) {
    return new Response(JSON.stringify({ error: "Service not found" }), { status: 404 });
  }

  if (!service.ingest_secret || service.ingest_secret !== secret) {
    return new Response(JSON.stringify({ error: "Invalid secret" }), { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* keep empty */ }

  console.log("[ingest-unifi-webhook] raw body:", JSON.stringify(body));

  // UniFi can nest the event under different keys depending on firmware version
  const alarm = (body.alarm ?? body.event ?? body) as Record<string, unknown>;

  const key      = String(alarm.key      ?? alarm.event_type ?? "");
  const msg      = String(alarm.msg      ?? alarm.message    ?? alarm.name ?? "UniFi alarm");
  const category = String(alarm.subsystem ?? alarm.category ?? "network");
  const ts       = alarm.time ? new Date(Number(alarm.time) * 1000).toISOString() : new Date().toISOString();

  const mapped = EVENT_MAP[key];
  const status  = mapped?.status  ?? statusFromName(msg);
  const label   = mapped?.label   ?? msg;

  await supabase.from("service_heartbeats").insert({
    user_id:     service.user_id,
    service_id:  serviceId,
    source:      "network",
    status,
    message:     label,
    payload: {
      unifi_key:      key   || null,
      unifi_msg:      msg,
      unifi_category: category,
      raw:            body,
    },
    received_at: ts,
  });

  console.log(`[ingest-unifi-webhook] ${serviceId} key=${key} status=${status}`);

  return new Response(JSON.stringify({ ok: true, status, label }), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
});
