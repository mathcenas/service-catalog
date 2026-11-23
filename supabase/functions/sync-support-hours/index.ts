import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Cada hora (cron sync-support-hours-hourly): trae del Task Tracker las tareas terminadas con
// horas (GET /api/integrations/hours) y las deja en support_hours, que es lo que el portal del
// cliente muestra como horas trabajadas contra las horas confirmadas de sus servicios.
//   - tarea nueva o modificada            → upsert por tt_task_id
//   - tarea que ya no viene (se reabrió, se borró, el cliente la destildó del reporte)
//                                         → se borra del rango sincronizado
// Las horas cargadas a mano (source = 'manual') no se tocan.
// Por defecto sincroniza desde el 1° del mes anterior; con {"from":"2026-01-01"} en el body se
// puede recargar un rango más largo (máximo 400 días, lo limita el Task Tracker).

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const TT_API_KEY = Deno.env.get("TASK_TRACKER_API_KEY");
const TT_BASE = Deno.env.get("TASK_TRACKER_URL");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

type TtTask = {
  id: string; clientId: string; projectId: string | null; projectName: string | null;
  date: string; hours: number; description: string | null; type: string | null; clientExcluded: boolean;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (!TT_API_KEY || !TT_BASE) return json({ error: "Task Tracker no configurado" }, 500);

  const body = await req.json().catch(() => ({}));
  const now = new Date();
  const from = isDate(body?.from) ? body.from : ymd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
  const to = isDate(body?.to) ? body.to : ymd(now);

  const res = await fetch(`${TT_BASE}/api/integrations/hours?from=${from}&to=${to}`, {
    headers: { Authorization: `Bearer ${TT_API_KEY}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("[sync-support-hours] Task Tracker", res.status, text.slice(0, 200));
    return json({ error: `Task Tracker ${res.status}: ${text.slice(0, 200)}` }, 502);
  }
  // Un Task Tracker sin el endpoint devuelve la página web (HTML) en lugar de JSON
  const raw = await res.text();
  let tasks: TtTask[];
  try {
    tasks = (JSON.parse(raw) as { tasks: TtTask[] }).tasks ?? [];
  } catch {
    console.error("[sync-support-hours] respuesta no JSON del Task Tracker", raw.slice(0, 120));
    return json({ error: "El Task Tracker no respondió JSON: ¿está actualizado con GET /api/integrations/hours?" }, 502);
  }

  // Cliente del Task Tracker → cliente del portal
  const { data: clients, error: cErr } = await supabase
    .from("clients").select("id, user_id, task_tracker_id").not("task_tracker_id", "is", null);
  if (cErr) return json({ error: cErr.message }, 500);
  const byTt = new Map((clients ?? []).map((c: any) => [String(c.task_tracker_id), c]));

  const rows = (tasks ?? [])
    .filter(t => !t.clientExcluded && Number(t.hours) > 0 && byTt.has(String(t.clientId)))
    .map(t => {
      const c = byTt.get(String(t.clientId));
      const desc = String(t.description ?? "").trim();
      return {
        user_id: c.user_id,
        client_id: c.id,
        work_date: t.date,
        hours: Number(t.hours),
        title: desc.split("\n")[0].slice(0, 200) || null,
        description: desc,
        type: t.type === "incident" ? "incident" : "work",
        source: "task-tracker",
        tt_task_id: String(t.id),
        project_name: t.projectName ?? null,
      };
    });

  let upserted = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase.from("support_hours").upsert(rows.slice(i, i + 200), { onConflict: "tt_task_id" });
    if (error) return json({ error: error.message, upserted }, 500);
    upserted += Math.min(200, rows.length - i);
  }

  // Lo que ya no viene del Task Tracker en este rango se borra
  const keep = new Set(rows.map(r => r.tt_task_id));
  const { data: existing } = await supabase
    .from("support_hours").select("id, tt_task_id")
    .eq("source", "task-tracker").gte("work_date", from).lte("work_date", to);
  const stale = (existing ?? []).filter((r: any) => !keep.has(r.tt_task_id)).map((r: any) => r.id);
  for (let i = 0; i < stale.length; i += 200) {
    await supabase.from("support_hours").delete().in("id", stale.slice(i, i + 200));
  }

  const unmapped = new Set((tasks ?? []).filter(t => !byTt.has(String(t.clientId))).map(t => t.clientId));
  const result = { from, to, received: tasks?.length ?? 0, upserted, removed: stale.length, clients_without_link: unmapped.size };
  console.log("[sync-support-hours]", JSON.stringify(result));
  return json(result);
});
