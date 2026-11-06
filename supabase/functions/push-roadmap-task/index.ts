import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { pushTaskToTracker } from "../_shared/taskTracker.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });

  // Auth via user JWT
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  // Verify JWT and get user
  const { data: { user }, error: authErr } = await createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } }
  ).auth.getUser();

  if (authErr || !user) {
    return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
  }

  const TT_API_KEY = Deno.env.get("TASK_TRACKER_API_KEY");
  const TT_BASE    = Deno.env.get("TASK_TRACKER_URL");
  if (!TT_API_KEY || !TT_BASE) {
    return new Response(JSON.stringify({ error: "TaskTracker not configured" }), { status: 503, headers: { ...cors, "Content-Type": "application/json" } });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
  }

  const projectId     = String(body.project_id || "").trim();
  const title         = String(body.title || "").trim();
  const portalClientId = typeof body.client_id === "string" && body.client_id ? body.client_id : undefined;
  if (!projectId || !title) {
    return new Response(JSON.stringify({ error: "project_id and title are required" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
  }

  // Resolve tt_client_id from task_tracker_projects using the tt_project_id
  const { data: projRow } = await supabaseAdmin
    .from("task_tracker_projects")
    .select("tt_client_id")
    .eq("tt_project_id", projectId)
    .maybeSingle();

  const ttClientId = projRow?.tt_client_id ?? null;
  if (!ttClientId) {
    return new Response(JSON.stringify({ error: "project not found in task_tracker_projects" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
  }

  const hours   = typeof body.hours === "number" ? body.hours : undefined;
  const date    = typeof body.due_date === "string" && body.due_date
    ? body.due_date.split("T")[0]
    : undefined;

  const ttTaskId = await pushTaskToTracker({
    project_id:  projectId,
    client_id:   ttClientId,
    title,
    description: typeof body.description === "string" ? body.description : undefined,
    type:        typeof body.type     === "string" ? body.type     : "change",
    status:      typeof body.status   === "string" ? body.status   : "not_started",
    priority:    typeof body.priority === "string" ? body.priority : "medium",
    hours,
    date,
  }, TT_API_KEY, TT_BASE, supabaseAdmin, { source: "roadmap", clientId: portalClientId });

  return new Response(
    JSON.stringify({ ok: !!ttTaskId, tt_task_id: ttTaskId }),
    { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
  );
});
