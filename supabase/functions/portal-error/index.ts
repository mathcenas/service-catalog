import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Recibe los errores que ve el portal del cliente (/share/<token>) al consultar la base:
// el navegador los manda con navigator.sendBeacon (texto plano, sin sesión). Solo se registran
// si el token es de un link vigente; uno por cliente/consulta/mensaje/día (con contador).

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });
  if (req.method !== "POST") return new Response("", { status: 405, headers: cors });
  let body: { token?: string; path?: string; status?: number; message?: string } = {};
  try { body = JSON.parse(await req.text()); } catch { return new Response("", { status: 400, headers: cors }); }
  const token = String(body.token ?? "").slice(0, 200);
  if (!token || !body.path) return new Response("", { status: 400, headers: cors });

  const { data: tok } = await supabase.from("client_share_tokens")
    .select("client_id, expires_at").eq("token", token).maybeSingle();
  if (!tok || (tok.expires_at && new Date(tok.expires_at).getTime() < Date.now())) {
    return new Response("", { status: 204, headers: cors });
  }
  await supabase.rpc("log_portal_error", {
    p_client: tok.client_id, p_source: "portal",
    p_path: String(body.path).slice(0, 300), p_status: Number(body.status) || null,
    p_message: String(body.message ?? "").slice(0, 500),
  });
  return new Response("", { status: 204, headers: cors });
});
