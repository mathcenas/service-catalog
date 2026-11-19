import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { pushTaskToTracker, resolveDefaultProject, resolveTaskInTracker } from "../_shared/taskTracker.ts";

// Cada hora (cron sync-alert-tickets-hourly): calcula las alertas del tablero "Para hoy"
// (mismo criterio que src/components/Dashboard.tsx) y las sincroniza con Task Tracker:
//   - alerta nueva            → abre una tarea (si el cliente tiene proyecto por defecto)
//   - alerta que sigue        → actualiza last_seen_at
//   - alerta que desapareció  → después de 2 chequeos seguidos sin ella, cierra la tarea con una nota
// Con eso cada tarea cerrada en Task Tracker es una confirmación de que el problema se resolvió.

const DEFAULT_BACKUP_MAX_AGE_HOURS = 26;
const SIGNAL_HOURS = 6;          // sin heartbeat: más tolerante que el tablero (2 h) para no abrir tickets por un corte corto
const CLEAR_CHECKS_TO_RESOLVE = 2;
const FREQUENCY_LABEL: Record<number, string> = { 26: "diario", 74: "días hábiles", 194: "semanal", 770: "mensual" };

type Kind = "backup" | "signal" | "ops";
type Alert = {
  key: string; kind: Kind; userId: string; clientId: string | null; serviceId: string;
  title: string; detail: string; priority: "low" | "medium" | "high";
};

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const TT_API_KEY = Deno.env.get("TASK_TRACKER_API_KEY");
const TT_BASE = Deno.env.get("TASK_TRACKER_URL");

const fmtUY = (iso: string) => new Date(iso).toLocaleString("es-UY", { timeZone: "America/Montevideo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const hoursSince = (iso: string) => (Date.now() - new Date(iso).getTime()) / 3_600_000;

async function currentAlerts(): Promise<Alert[]> {
  const { data: services } = await supabase
    .from("services")
    .select("id, name, business_name, client_id, user_id, status, operational_status, telemetry_enabled, last_backup_at, backup_max_age_hours")
    .eq("status", "Active");
  const active = (services ?? []) as any[];
  if (!active.length) return [];
  const ids = active.map(s => s.id);
  const alerts: Alert[] = [];
  const name = (s: any) => s.business_name || s.name;
  const base = (s: any) => ({ userId: s.user_id, clientId: s.client_id ?? null, serviceId: s.id });

  // Backups: fallido en 48 h sin uno bueno después, o sin backup dentro de su frecuencia
  const since48 = new Date(Date.now() - 48 * 3_600_000).toISOString();
  const { data: fails } = await supabase
    .from("service_backups")
    .select("service_id, job_name, backed_up_at")
    // Por la hora del backup, no la de carga: un registro cargado tarde (backfill) no es un fallo nuevo
    .in("service_id", ids).in("status", ["failed", "error"]).gte("backed_up_at", since48)
    .order("backed_up_at", { ascending: false });
  const lastFail: Record<string, any> = {};
  for (const f of fails ?? []) if (!lastFail[f.service_id]) lastFail[f.service_id] = f;

  for (const s of active) {
    const maxAge = s.backup_max_age_hours === 0 ? null : (s.backup_max_age_hours ?? DEFAULT_BACKUP_MAX_AGE_HOURS);
    if (maxAge === null) continue;
    const fail = lastFail[s.id];
    if (fail && !(s.last_backup_at && new Date(s.last_backup_at) > new Date(fail.backed_up_at))) {
      alerts.push({ ...base(s), key: `backup:${s.id}`, kind: "backup", priority: "high",
        title: `Backup fallido — ${name(s)}`,
        detail: `Último backup fallido el ${fmtUY(fail.backed_up_at)}${fail.job_name ? ` (${fail.job_name})` : ""}.` });
      continue;
    }
    if (s.last_backup_at && hoursSince(s.last_backup_at) >= maxAge) {
      const h = Math.round(hoursSince(s.last_backup_at));
      alerts.push({ ...base(s), key: `backup:${s.id}`, kind: "backup", priority: h > maxAge * 2 ? "high" : "medium",
        title: `Backup vencido — ${name(s)}`,
        detail: `Sin backup hace ${h} h (frecuencia ${FREQUENCY_LABEL[maxAge] ?? `cada ${maxAge} h`}). Último: ${fmtUY(s.last_backup_at)}.` });
    }
  }

  // Dejó de reportar: telemetría activada, reportó alguna vez y no reporta hace SIGNAL_HOURS
  const monitored = active.filter(s => s.telemetry_enabled);
  if (monitored.length) {
    const cutoff = new Date(Date.now() - SIGNAL_HOURS * 3_600_000).toISOString();
    const { data: recent } = await supabase.from("service_heartbeats").select("service_id")
      .in("service_id", monitored.map(s => s.id)).gte("received_at", cutoff);
    const alive = new Set((recent ?? []).map((h: any) => h.service_id));
    for (const s of monitored.filter(s => !alive.has(s.id))) {
      const { data: last } = await supabase.from("service_heartbeats").select("received_at")
        .eq("service_id", s.id).order("received_at", { ascending: false }).limit(1).maybeSingle();
      if (!last) continue; // nunca reportó: es configuración pendiente, no un incidente
      const h = Math.round(hoursSince(last.received_at));
      alerts.push({ ...base(s), key: `signal:${s.id}`, kind: "signal", priority: h > 24 ? "high" : "medium",
        title: `Dejó de reportar — ${name(s)}`,
        detail: `Sin heartbeats desde el ${fmtUY(last.received_at)} (${h} h).` });
    }
  }

  // Servicio caído o degradado
  for (const s of active.filter(s => s.operational_status === "Down" || s.operational_status === "Degraded")) {
    const down = s.operational_status === "Down";
    alerts.push({ ...base(s), key: `ops:${s.id}`, kind: "ops", priority: down ? "high" : "medium",
      title: `${down ? "Servicio caído" : "Servicio degradado"} — ${name(s)}`,
      detail: `Estado operativo: ${s.operational_status}.` });
  }
  return alerts;
}

async function openTask(a: Alert): Promise<{ taskId: string | null; error: string | null }> {
  if (!TT_API_KEY || !TT_BASE) return { taskId: null, error: "Task Tracker no configurado" };
  if (!a.clientId) return { taskId: null, error: "Servicio sin cliente" };
  const proj = await resolveDefaultProject(supabase, a.clientId);
  if (!proj) return { taskId: null, error: "El cliente no tiene proyecto por defecto en Task Tracker" };
  const taskId = await pushTaskToTracker({
    project_id: proj.ttProjectId,
    client_id: proj.ttClientId,
    title: a.title,
    description: `${a.title}\n${a.detail}\n\nAbierta automáticamente por Service Catalog. Se cierra sola cuando la alerta desaparece.`,
    type: "incident",
    status: "not_started",
    priority: a.priority,
    reported_by: "integration:service-catalog",
  }, TT_API_KEY, TT_BASE, supabase as any, { source: "sync-alert-tickets", clientId: a.clientId });
  return { taskId, error: taskId ? null : "No se pudo crear la tarea (ver task_tracker_log)" };
}

// Lo llama el cron (service role) y el botón "Revisar ahora" del Dashboard (navegador: necesita CORS)
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  const now = new Date().toISOString();
  const alerts = await currentAlerts();
  const byKey = new Map(alerts.map(a => [a.key, a]));

  const { data: openRows } = await supabase.from("alert_tickets").select("*").eq("status", "open");
  const open = new Map((openRows ?? []).map((r: any) => [r.alert_key, r]));
  const result = { alerts: alerts.length, opened: 0, still_open: 0, resolved: 0, waiting_to_resolve: 0, errors: [] as string[] };

  // Alertas activas: abrir o refrescar
  for (const a of alerts) {
    const row = open.get(a.key);
    if (!row) {
      const { taskId, error } = await openTask(a);
      const { error: insErr } = await supabase.from("alert_tickets").insert({
        alert_key: a.key, kind: a.kind, user_id: a.userId, client_id: a.clientId, service_id: a.serviceId,
        title: a.title, detail: a.detail, tt_task_id: taskId, tt_error: error, opened_at: now, last_seen_at: now,
      });
      if (insErr) result.errors.push(`${a.key}: ${insErr.message}`); else result.opened++;
      continue;
    }
    const patch: Record<string, unknown> = { last_seen_at: now, clear_count: 0, detail: a.detail, title: a.title };
    if (!row.tt_task_id) {
      // Se vinculó el cliente después: crear la tarea ahora
      const { taskId, error } = await openTask(a);
      patch.tt_task_id = taskId; patch.tt_error = error;
    }
    await supabase.from("alert_tickets").update(patch).eq("id", row.id);
    result.still_open++;
  }

  // Alertas que ya no están: cerrar después de CLEAR_CHECKS_TO_RESOLVE chequeos seguidos
  for (const row of openRows ?? []) {
    if (byKey.has(row.alert_key)) continue;
    const clear = (row.clear_count ?? 0) + 1;
    if (clear < CLEAR_CHECKS_TO_RESOLVE) {
      await supabase.from("alert_tickets").update({ clear_count: clear }).eq("id", row.id);
      result.waiting_to_resolve++;
      continue;
    }
    const hours = Math.max(1, Math.round((Date.now() - new Date(row.opened_at).getTime()) / 3_600_000));
    const note = `Resuelto: la alerta desapareció. Abierta el ${fmtUY(row.opened_at)}, última vez vista el ${fmtUY(row.last_seen_at)} (${hours} h en total). Cierre automático de Service Catalog.`;
    if (row.tt_task_id && TT_API_KEY && TT_BASE) {
      const r = await resolveTaskInTracker(row.tt_task_id, note, TT_API_KEY, TT_BASE);
      if (!r.ok) {
        await supabase.from("alert_tickets").update({ clear_count: clear, tt_error: `Cierre: ${r.error}` }).eq("id", row.id);
        result.errors.push(`${row.alert_key}: ${r.error}`);
        continue; // se reintenta la próxima hora
      }
    }
    await supabase.from("alert_tickets").update({ status: "resolved", resolved_at: now, clear_count: clear, resolve_note: note, tt_error: null }).eq("id", row.id);
    result.resolved++;
  }

  console.log("[sync-alert-tickets]", JSON.stringify(result));
  return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
