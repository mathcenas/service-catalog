// Push a task to TaskTracker via POST /api/tasks and log the result.

import { createClient } from "npm:@supabase/supabase-js@2";

type SupabaseClient = ReturnType<typeof createClient>;

export interface PushTaskPayload {
  project_id:  string;   // tt_project_id (UUID in TaskTracker)
  client_id:   string;   // tt_client_id (UUID in TaskTracker)
  title:       string;
  description?: string;
  type?:       string;   // "request"|"change"|"incident"|"problem"|"insumos" — defaults to "request"
  status?:     string;   // "not_started"|"in_progress"|"review"|"completed" — defaults to "not_started"
  priority?:   string;   // "low"|"medium"|"high" — defaults to "medium"
  hours?:      number;
  date?:       string;   // YYYY-MM-DD — defaults to today
}

interface PushResult {
  taskId:  string | null;
  ok:      boolean;
  httpStatus?: number;
  error?:  string;
}

async function _post(
  payload: PushTaskPayload,
  apiKey: string,
  baseUrl: string
): Promise<PushResult> {
  try {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        id:          crypto.randomUUID(),
        projectId:   payload.project_id,
        clientId:    payload.client_id,
        title:       payload.title,
        description: payload.description || "",
        type:        payload.type     || "request",
        status:      payload.status   || "not_started",
        priority:    payload.priority || "medium",
        date:        payload.date ?? new Date().toISOString().split("T")[0],
        ...(payload.hours != null ? { hours: payload.hours } : {}),
      }),
    });

    const httpStatus = res.status;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { taskId: null, ok: false, httpStatus, error: `${httpStatus}: ${text}` };
    }
    const data = await res.json();
    return { taskId: data?.id ?? null, ok: true, httpStatus };
  } catch (err) {
    return { taskId: null, ok: false, error: String(err) };
  }
}

export async function pushTaskToTracker(
  payload: PushTaskPayload,
  apiKey: string,
  baseUrl: string,
  supabase: SupabaseClient,
  meta: { source: string; clientId?: string }
): Promise<string | null> {
  const result = await _post(payload, apiKey, baseUrl);

  // Always log — success or failure
  await supabase.from("task_tracker_log").insert({
    source:        meta.source,
    client_id:     meta.clientId ?? null,
    tt_project_id: payload.project_id,
    tt_task_id:    result.taskId,
    title:         payload.title,
    hours:         payload.hours ?? null,
    status:        result.ok ? "ok" : "error",
    error_message: result.error ?? null,
    http_status:   result.httpStatus ?? null,
  });

  if (!result.ok) {
    console.error(`[taskTracker] push failed — ${meta.source} — ${result.error}`);
  }

  return result.taskId;
}

// Look up the default tt_project_id for a portal client_id.
export async function resolveDefaultProject(
  supabase: SupabaseClient,
  portalClientId: string
): Promise<{ ttClientId: string; ttProjectId: string } | null> {
  const { data: client } = await supabase
    .from("clients")
    .select("task_tracker_id")
    .eq("id", portalClientId)
    .maybeSingle();

  if (!client?.task_tracker_id) return null;

  const { data: proj } = await supabase
    .from("task_tracker_projects")
    .select("tt_project_id")
    .eq("tt_client_id", client.task_tracker_id)
    .eq("is_default", true)
    .maybeSingle();

  if (!proj?.tt_project_id) return null;

  return { ttClientId: client.task_tracker_id, ttProjectId: proj.tt_project_id };
}
