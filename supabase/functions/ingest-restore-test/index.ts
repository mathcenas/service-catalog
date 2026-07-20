import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  try {
    const body = await req.json();
    const { service_id, last_restore_test_at, last_restore_test_result, details } = body;

    if (!service_id || !last_restore_test_result) {
      return new Response(JSON.stringify({ error: "service_id and last_restore_test_result are required" }), { status: 400 });
    }

    const validResults = ["success", "failed", "partial"];
    if (!validResults.includes(last_restore_test_result)) {
      return new Response(JSON.stringify({ error: "result must be success, failed or partial" }), { status: 400 });
    }

    const ingestSecret = req.headers.get("X-Ingest-Secret");
    if (!ingestSecret) {
      return new Response(JSON.stringify({ error: "Missing X-Ingest-Secret" }), { status: 401 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: service, error: svcErr } = await supabase
      .from("services")
      .select("ingest_secret")
      .eq("id", service_id)
      .maybeSingle();

    if (svcErr || !service) {
      return new Response(JSON.stringify({ error: "Service not found" }), { status: 404 });
    }

    if (!service.ingest_secret || service.ingest_secret !== ingestSecret) {
      return new Response(JSON.stringify({ error: "Invalid secret" }), { status: 401 });
    }

    const testedAt = last_restore_test_at || new Date().toISOString();

    const { error: updateErr } = await supabase
      .from("services")
      .update({
        last_restore_test_at: testedAt,
        last_restore_test_result,
      })
      .eq("id", service_id);

    if (updateErr) {
      return new Response(JSON.stringify({ error: updateErr.message }), { status: 500 });
    }

    // Log to support_hours as an incident record
    if (details) {
      const { data: svc } = await supabase.from("services").select("user_id, client_id").eq("id", service_id).maybeSingle();
      if (svc) {
        await supabase.from("support_hours").insert({
          user_id: svc.user_id,
          client_id: svc.client_id,
          service_id,
          work_date: testedAt.slice(0, 10),
          hours: 0,
          type: "incident",
          title: `Restore Test — ${last_restore_test_result}`,
          description: details,
        });
      }
    }

    return new Response(JSON.stringify({ success: true }), { status: 201 });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), { status: 500 });
  }
});
