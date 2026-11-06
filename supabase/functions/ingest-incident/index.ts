import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { pushTaskToTracker, resolveDefaultProject } from "../_shared/taskTracker.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Source",
};

// Maps task-tracker event → incident status
const EVENT_STATUS: Record<string, string> = {
  opened:   "investigating",
  updated:  "investigating",  // keep current status on update (handled below)
  closed:   "resolved",
  resolved: "resolved",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Auth: Bearer webhook_token (same as ingest-ticket)
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return new Response(JSON.stringify({ error: "Missing Authorization token" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: settingsRow, error: settingsErr } = await supabaseAdmin
    .from("user_settings")
    .select("user_id")
    .eq("webhook_token", token)
    .maybeSingle();

  if (settingsErr || !settingsRow) {
    return new Response(JSON.stringify({ error: "Invalid token" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userId = settingsRow.user_id;
  const source = (req.headers.get("X-Source") || "task_tracker").toLowerCase();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Task Tracker format ───────────────────────────────────────────────────
  if (source === "task_tracker") {
    const event       = String(body.event || "").toLowerCase();
    const externalId  = String(body.id || "").trim();
    const type        = String(body.type || "incident").toLowerCase();
    const description = String(body.description || "").trim();
    const reportedBy  = String(body.reportedBy || "").trim() || null;
    const timestamp   = String(body.timestamp || new Date().toISOString());

    if (!externalId || !description) {
      return new Response(JSON.stringify({ error: "Missing required fields: id, description" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve client via task_tracker_id
    const clientPayload = body.client as { id?: string; name?: string; slug?: string } | undefined;
    let clientId: string | null = null;
    if (clientPayload?.id) {
      const { data: clientRow } = await supabaseAdmin
        .from("clients")
        .select("id")
        .eq("user_id", userId)
        .eq("task_tracker_id", clientPayload.id)
        .maybeSingle();
      if (clientRow) clientId = clientRow.id;
    }

    // Build new note from incoming notes array (if any)
    const incomingNotes = (body.notes as { note: string; createdAt?: string }[] | undefined) || [];
    const newNotes = incomingNotes.map(n => ({
      note:      n.note,
      timestamp: n.createdAt || timestamp,
      author:    reportedBy || "task_tracker",
    }));

    // Check if incident already exists (for update/close)
    const { data: existing } = await supabaseAdmin
      .from("service_incidents")
      .select("id, status, notes")
      .eq("user_id", userId)
      .eq("source", "task_tracker")
      .eq("external_id", externalId)
      .maybeSingle();

    const isClose   = event === "closed" || event === "resolved";
    const newStatus = isClose ? "resolved" : (existing ? existing.status : (EVENT_STATUS[event] || "investigating"));

    if (existing) {
      // Merge notes — avoid duplicates by note text
      const existingNotes = (existing.notes as { note: string }[]) || [];
      const existingTexts = new Set(existingNotes.map(n => n.note));
      const mergedNotes = [
        ...existingNotes,
        ...newNotes.filter(n => !existingTexts.has(n.note)),
      ];

      const updatePayload: Record<string, unknown> = {
        title:       description,
        description: description,
        notes:       mergedNotes,
        status:      newStatus,
        updated_at:  new Date().toISOString(),
      };
      if (isClose) updatePayload.resolved_at = timestamp;
      if (clientId) updatePayload.client_id = clientId;

      await supabaseAdmin
        .from("service_incidents")
        .update(updatePayload)
        .eq("id", existing.id);

      return new Response(
        JSON.stringify({ success: true, action: "updated", incident_id: existing.id }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Insert new incident
    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from("service_incidents")
      .insert({
        user_id:     userId,
        client_id:   clientId,
        external_id: externalId,
        source:      "task_tracker",
        type:        ["incident", "maintenance", "change"].includes(type) ? type : "incident",
        status:      newStatus,
        title:       description,
        description: description,
        reported_by: reportedBy,
        notes:       newNotes,
        started_at:  timestamp,
        resolved_at: isClose ? timestamp : null,
      })
      .select("id")
      .single();

    if (insertErr) {
      return new Response(JSON.stringify({ error: "Failed to create incident", details: insertErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Push task to TaskTracker if client is mapped
    let ttTaskId: string | null = null;
    const TT_API_KEY = Deno.env.get("TASK_TRACKER_API_KEY");
    const TT_BASE    = Deno.env.get("TASK_TRACKER_URL");
    if (clientId && TT_API_KEY && TT_BASE && !isClose) {
      const proj = await resolveDefaultProject(supabaseAdmin, clientId);
      if (proj) {
        ttTaskId = await pushTaskToTracker({
          project_id:  proj.ttProjectId,
          title:       description,
          description: newNotes.map(n => n.note).join("\n"),
          status:      "todo",
          priority:    "high",
        }, TT_API_KEY, TT_BASE, supabaseAdmin, { source: "ingest-incident", clientId: clientId! });
        // Store the tt task id on the incident for future reference
        if (ttTaskId) {
          await supabaseAdmin
            .from("service_incidents")
            .update({ external_task_id: ttTaskId })
            .eq("id", inserted.id);
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, action: "created", incident_id: inserted.id, client_matched: !!clientId, tt_task_id: ttTaskId }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // ── Kuma format (placeholder — extend when needed) ────────────────────────
  if (source === "kuma") {
    return new Response(
      JSON.stringify({ error: "Kuma source not yet implemented" }),
      { status: 501, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ error: `Unknown source: ${source}` }),
    { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
