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
    const { service_id, last_restore_test_at, last_restore_test_result, details } = body;

    if (!service_id || !last_restore_test_result) {
      return new Response(JSON.stringify({ error: "service_id y last_restore_test_result son requeridos" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const validResults = ["success", "failed", "partial"];
    if (!validResults.includes(last_restore_test_result)) {
      return new Response(JSON.stringify({ error: `last_restore_test_result debe ser: ${validResults.join(", ")}` }), {
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

    const { data: service, error: svcErr } = await supabase
      .from("services")
      .select("id, ingest_secret")
      .eq("id", service_id)
      .maybeSingle();

    if (svcErr || !service) {
      return new Response(JSON.stringify({ error: "Service not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!service.ingest_secret || service.ingest_secret !== ingestSecret) {
      return new Response(JSON.stringify({ error: "Invalid secret" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const testedAt = last_restore_test_at ?? new Date().toISOString();

    const { error: updateErr } = await supabase
      .from("services")
      .update({
        last_restore_test_at:     testedAt,
        last_restore_test_result: last_restore_test_result,
      })
      .eq("id", service_id);

    if (updateErr) {
      return new Response(JSON.stringify({ error: updateErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[ingest-restore-test] service=${service_id} result=${last_restore_test_result} at=${testedAt}${details ? ` | ${details}` : ""}`);

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
