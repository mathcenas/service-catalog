import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { SHARE_COLUMNS } from "../_shared/shareColumns.ts";

// Prueba diaria del portal del cliente: con el link vigente de cada cliente consulta, como lo
// hace el portal (clave anon + x-share-token), cada tabla con las columnas que usa el portal.
// Si una consulta falla (permiso, columna que no existe…) queda en portal_errors (source 'selftest')
// y se ve en el Dashboard del admin. La corrida queda en portal_checks.

const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const admin = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve(async () => {
  const { data: toks } = await admin.from("client_share_tokens")
    .select("client_id, token, expires_at, created_at, clients!inner(status)")
    .eq("clients.status", "Active").order("created_at", { ascending: false });
  // El token vigente más nuevo de cada cliente
  const byClient = new Map<string, string>();
  for (const t of (toks ?? []) as { client_id: string; token: string; expires_at: string | null }[]) {
    if (byClient.has(t.client_id)) continue;
    if (t.expires_at && new Date(t.expires_at).getTime() < Date.now()) continue;
    byClient.set(t.client_id, t.token);
  }

  let checks = 0;
  let failures = 0;
  const failed: { client_id: string; table: string; status: number; message: string }[] = [];
  // Filtros como los usa el portal (sin filtro, una tabla grande con RLS puede pasarse de tiempo
  // aunque el portal ande): por cliente, por sus servicios y por fecha reciente
  const since = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const TIME_COL: Record<string, string> = { service_heartbeats: "received_at", service_backups: "backed_up_at", uptime_events: "occurred_at" };
  for (const [clientId, token] of byClient) {
    const { data: svcs } = await admin.from("services").select("id").eq("client_id", clientId);
    const svcIds = (svcs ?? []).map((s: { id: string }) => s.id);
    for (const [table, cols] of Object.entries(SHARE_COLUMNS)) {
      const c = cols as readonly string[];
      const filters: string[] = [];
      if (table === "clients") filters.push(`id=eq.${clientId}`);
      else if (c.includes("client_id")) filters.push(`client_id=eq.${clientId}`);
      else if (c.includes("service_id") && svcIds.length) filters.push(`service_id=in.(${svcIds.join(",")})`);
      if (TIME_COL[table]) filters.push(`${TIME_COL[table]}=gte.${encodeURIComponent(since)}`);
      checks++;
      const res = await fetch(`${URL_}/rest/v1/${table}?select=${c.join(",")}&${filters.join("&")}${filters.length ? "&" : ""}limit=1`, {
        headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "x-share-token": token },
      });
      if (!res.ok) {
        failures++;
        const text = await res.text().catch(() => "");
        let message = text.slice(0, 300);
        try { const j = JSON.parse(text); message = j.message || j.hint || message; } catch { /* texto */ }
        failed.push({ client_id: clientId, table, status: res.status, message });
        await admin.rpc("log_portal_error", { p_client: clientId, p_source: "selftest", p_path: table, p_status: res.status, p_message: message });
      } else {
        await res.body?.cancel();
      }
    }
  }
  await admin.from("portal_checks").insert({ clients: byClient.size, checks, failures });
  return new Response(JSON.stringify({ clients: byClient.size, checks, failures, failed }), {
    headers: { "Content-Type": "application/json" },
  });
});
