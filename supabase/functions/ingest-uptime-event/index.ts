import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Uptime Kuma webhook payload (notification body)
// Kuma sends a JSON POST when a monitor changes state.
// Expected fields from Kuma's "Custom Body" (configure in Notification settings):
// {
//   "service_id": "your-supabase-service-uuid",
//   "monitor_name": "{{monitorName}}",
//   "monitor_url": "{{monitorURL}}",
//   "event_type": "{{heartbeatJSON.status == 0 ? 'down' : 'up'}}",
//   "message": "{{msg}}",
//   "duration": {{heartbeatJSON.duration}}
// }

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://servicios.cenas-support.com",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
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
    const body = await req.json();
    const { service_id, monitor_name, monitor_url, event_type, message, duration, occurred_at } = body;

    if (!service_id || !event_type) {
      return new Response(
        JSON.stringify({ error: "service_id and event_type are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const validTypes = ["down", "up", "degraded"];
    const normalizedType = event_type.toLowerCase();
    if (!validTypes.includes(normalizedType)) {
      return new Response(
        JSON.stringify({ error: `event_type must be one of: ${validTypes.join(", ")}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: service, error: svcErr } = await supabaseAdmin
      .from("services")
      .select("user_id")
      .eq("id", service_id)
      .maybeSingle();

    if (svcErr || !service) {
      return new Response(
        JSON.stringify({ error: "Service not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { error: insertErr } = await supabaseAdmin
      .from("uptime_events")
      .insert({
        user_id: service.user_id,
        service_id,
        monitor_name: monitor_name || null,
        monitor_url: monitor_url || null,
        event_type: normalizedType,
        message: message || null,
        duration_seconds: duration ?? null,
        occurred_at: occurred_at || new Date().toISOString(),
      });

    if (insertErr) {
      return new Response(
        JSON.stringify({ error: insertErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Mirror operational_status on the service for real-time portal display
    const operationalMap: Record<string, string> = {
      down: "Down",
      degraded: "Degraded",
      up: "Operational",
    };
    await supabaseAdmin
      .from("services")
      .update({ operational_status: operationalMap[normalizedType] })
      .eq("id", service_id);

    return new Response(
      JSON.stringify({ success: true, received_at: new Date().toISOString() }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
