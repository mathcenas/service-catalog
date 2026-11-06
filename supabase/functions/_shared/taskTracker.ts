// Push a task to TaskTracker via POST /api/tasks.
// Returns the created task id or null if skipped/failed.

export interface PushTaskPayload {
  project_id: string;
  title: string;
  description?: string;
  status?: string;      // defaults to "todo"
  priority?: string;    // defaults to "medium"
  hours?: number;       // actual hours worked (REAL column in tasks)
  due_date?: string;    // ISO date string
}

export async function pushTaskToTracker(
  payload: PushTaskPayload,
  apiKey: string,
  baseUrl: string
): Promise<string | null> {
  try {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        project_id:  payload.project_id,
        title:       payload.title,
        description: payload.description || "",
        status:      payload.status   || "todo",
        priority:    payload.priority || "medium",
        ...(payload.hours    != null ? { hours:    payload.hours    } : {}),
        ...(payload.due_date != null ? { due_date: payload.due_date } : {}),
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`TaskTracker POST /api/tasks failed: ${res.status} ${text}`);
      return null;
    }

    const data = await res.json();
    return data?.id ?? null;
  } catch (err) {
    console.error("TaskTracker push error:", err);
    return null;
  }
}

// Look up the default tt_project_id for a portal client_id.
// Requires the supabase admin client and that the client has task_tracker_id set.
export async function resolveDefaultProject(
  supabase: ReturnType<typeof import("npm:@supabase/supabase-js@2").createClient>,
  portalClientId: string
): Promise<{ ttClientId: string; ttProjectId: string } | null> {
  // Get the client's TaskTracker client id
  const { data: client } = await supabase
    .from("clients")
    .select("task_tracker_id")
    .eq("id", portalClientId)
    .maybeSingle();

  if (!client?.task_tracker_id) return null;

  // Get the default project for that tt_client_id
  const { data: proj } = await supabase
    .from("task_tracker_projects")
    .select("tt_project_id")
    .eq("tt_client_id", client.task_tracker_id)
    .eq("is_default", true)
    .maybeSingle();

  if (!proj?.tt_project_id) return null;

  return { ttClientId: client.task_tracker_id, ttProjectId: proj.tt_project_id };
}
