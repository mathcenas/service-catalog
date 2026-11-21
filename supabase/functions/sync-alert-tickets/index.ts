import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { addTaskNoteInTracker, pushTaskToTracker, resolveDefaultProject, resolveTaskInTracker } from "../_shared/taskTracker.ts";

// Cada hora (cron sync-alert-tickets-hourly): calcula las alertas del tablero "Para hoy"
// (mismo criterio que src/components/Dashboard.tsx) y las sincroniza con Task Tracker:
//   - alerta nueva            → abre una tarea (si el cliente tiene proyecto por defecto)
//   - alerta que sigue        → actualiza last_seen_at; si cambiaron los problemas (o pasó un día)
//                               agrega una nota a la tarea con la novedad
//   - alerta que desapareció  → después de 2 chequeos seguidos sin ella, cierra la tarea con una nota
//     (hay una sola tarea abierta por alerta: mientras siga el problema, días o semanas, se suman notas)
// Con eso cada tarea cerrada en Task Tracker es una confirmación de que el problema se resolvió.

const DEFAULT_BACKUP_MAX_AGE_HOURS = 26;
const SIGNAL_HOURS = 6;          // sin heartbeat: más tolerante que el tablero (2 h) para no abrir tickets por un corte corto
const CLEAR_CHECKS_TO_RESOLVE = 2;
const HEALTH_HOURS = 3;          // reporte de system-health más viejo que esto no cuenta (lo cubre "dejó de reportar")
const NOTE_EVERY_HOURS = 24;     // aunque nada cambie, una nota por día con el estado actual
// Problemas pasajeros que solos no justifican un ticket (un pico de CPU o RAM)
const TRANSIENT_ISSUE = /^(CPU alta|RAM alta|Load alto)/i;
const FREQUENCY_LABEL: Record<number, string> = { 26: "diario", 74: "días hábiles", 194: "semanal", 770: "mensual" };

type Kind = "backup" | "signal" | "ops" | "health";
type Alert = {
  key: string; kind: Kind; userId: string; clientId: string | null; serviceId: string;
  title: string; detail: string; priority: "low" | "medium" | "high";
  issues?: string[];   // problemas sueltos (salud del equipo): para avisar en la tarea qué apareció o se resolvió
};

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const TT_API_KEY = Deno.env.get("TASK_TRACKER_API_KEY");
const TT_BASE = Deno.env.get("TASK_TRACKER_URL");

const fmtUY = (iso: string) => new Date(iso).toLocaleString("es-UY", { timeZone: "America/Montevideo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const hoursSince = (iso: string) => (Date.now() - new Date(iso).getTime()) / 3_600_000;
// "RAM alta (92.4%) · Visor de eventos: 2487× error…" → lista de problemas
const splitIssues = (s: string | null | undefined) =>
  String(s ?? "").split(/\s+[·\uFFFD]\s+/).map(t => t.trim()).filter(t => t && t !== "Normal");
// Firma sin números: que un contador suba (2483 → 2487 errores) no es una novedad
const issueSig = (list: string[]) => list.map(t => t.replace(/[\d.,]+/g, "#")).sort().join(" | ");

// Equipos sin un system-health reciente: no se sabe si el problema sigue, así que su ticket de salud
// no cuenta ese chequeo para cerrarse (que deje de reportar no es lo mismo que se haya arreglado)
const healthUnknown = new Set<string>();

async function currentAlerts(): Promise<Alert[]> {
  healthUnknown.clear();
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
  // Último reporte de cada servicio con una consulta por servicio (limit 1). Antes se pedían todos
  // los heartbeats de las últimas horas de una vez: la API devuelve como máximo 1000 filas y, con
  // más reportes que eso, los servicios que quedaban afuera parecían "sin reportar" (tickets falsos).
  const monitored = active.filter(s => s.telemetry_enabled);
  const lastBeat: Record<string, string | null> = {};
  const lastHealth: Record<string, any> = {};
  for (let i = 0; i < monitored.length; i += 10) {
    await Promise.all(monitored.slice(i, i + 10).map(async (s) => {
      const [{ data: any1 }, { data: sh }] = await Promise.all([
        supabase.from("service_heartbeats").select("received_at")
          .eq("service_id", s.id).order("received_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("service_heartbeats").select("service_id, source, status, payload, received_at")
          .eq("service_id", s.id).in("source", ["system-health", "mk-network"]).order("received_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      lastBeat[s.id] = any1?.received_at ?? null;
      if (sh) lastHealth[s.id] = sh;
    }));
  }
  if (monitored.length) {
    for (const s of monitored) {
      const lastAt = lastBeat[s.id];
      if (!lastAt) continue; // nunca reportó: es configuración pendiente, no un incidente
      if (hoursSince(lastAt) < SIGNAL_HOURS) continue;
      const last = { received_at: lastAt };
      const h = Math.round(hoursSince(last.received_at));
      alerts.push({ ...base(s), key: `signal:${s.id}`, kind: "signal", priority: h > 24 ? "high" : "medium",
        title: `Dejó de reportar — ${name(s)}`,
        detail: `Sin heartbeats desde el ${fmtUY(last.received_at)} (${h} h).` });
    }
  }

  // Salud del equipo: el último system-health está en "failed" por algo más que un pico de CPU/RAM
  // (disco con errores de hardware, disco lleno, RAID, discos que Windows dejó de ver…).
  // En los routers, el reporte de red (mk-network) cumple el mismo papel: túnel VPN caído.
  if (monitored.length) {
    for (const s of monitored) {
      const h = lastHealth[s.id] && hoursSince(lastHealth[s.id].received_at) < HEALTH_HOURS ? lastHealth[s.id] : null;
      if (!h) { healthUnknown.add(s.id); continue; }
      if (!["failed", "error"].includes(h.status)) continue;
      const issues = splitIssues(h.payload?.issues);
      const serious = issues.filter(t => !TRANSIENT_ISSUE.test(t));
      if (!serious.length) continue;
      alerts.push({ ...base(s), key: `health:${s.id}`, kind: "health", priority: "high", issues,
        title: `Problema en el equipo — ${name(s)}`,
        detail: issues.map(t => `• ${t}`).join("\n") + `\n(reporte de ${h.source === "mk-network" ? "red del router" : "system-health"} del ${fmtUY(h.received_at)})` });
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
  const result = { alerts: alerts.length, opened: 0, still_open: 0, notes: 0, resolved: 0, waiting_to_resolve: 0, errors: [] as string[] };

  // Alertas activas: abrir o refrescar
  for (const a of alerts) {
    const row = open.get(a.key);
    if (!row) {
      const { taskId, error } = await openTask(a);
      const { error: insErr } = await supabase.from("alert_tickets").insert({
        alert_key: a.key, kind: a.kind, user_id: a.userId, client_id: a.clientId, service_id: a.serviceId,
        title: a.title, detail: a.detail, tt_task_id: taskId, tt_error: error, opened_at: now, last_seen_at: now,
        last_note_at: now, last_note_sig: issueSig(a.issues ?? [a.detail]),
      });
      if (insErr) result.errors.push(`${a.key}: ${insErr.message}`); else result.opened++;
      continue;
    }
    const patch: Record<string, unknown> = { last_seen_at: now, clear_count: 0, detail: a.detail, title: a.title };
    // Novedades para la tarea: problemas nuevos o resueltos, o un resumen diario si sigue igual
    const list = a.issues ?? [a.detail];
    const sig = issueSig(list);
    const prevSig: string = row.last_note_sig ?? sig;   // fila anterior a esta versión: arranca sin novedad
    const changed = sig !== prevSig;
    const daily = hoursSince(row.last_note_at ?? row.opened_at) >= NOTE_EVERY_HOURS;
    if (!row.last_note_sig) patch.last_note_sig = sig;
    if (row.tt_task_id && TT_API_KEY && TT_BASE && (changed || daily)) {
      const before = new Set(prevSig.split(" | ").filter(Boolean));
      const nowSigs = new Set(list.map(t => issueSig([t])));
      const added = list.filter(t => !before.has(issueSig([t])));
      const gone = [...before].filter(x => !nowSigs.has(x));
      const age = `${Math.round(hoursSince(row.opened_at))} h desde que se abrió`;
      const note = changed && a.issues
        ? `Novedad (${age}):\n` + [...added.map(t => `+ ${t}`), ...gone.map(t => `✓ ya no aparece: ${t.replace(/#/g, "…")}`)].join("\n") + `\n\nEstado actual:\n${a.detail}`
        : `${changed ? "Novedad" : "Sigue abierta"} (${age}):\n${a.detail}`;
      const r = await addTaskNoteInTracker(row.tt_task_id, note, TT_API_KEY, TT_BASE);
      if (r.ok) { patch.last_note_sig = sig; patch.last_note_at = now; patch.notes_sent = (row.notes_sent ?? 0) + 1; result.notes++; }
      else result.errors.push(`${a.key} nota: ${r.error}`);
    }
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
    if (row.kind === "health" && healthUnknown.has(row.service_id)) continue;   // sin reporte: sigue abierta tal cual
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
