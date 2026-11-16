import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Crea un link corto (/functions/v1/r/<slug>) para un cliente del usuario logueado.
// Lo llama el Centro de notificaciones desde el navegador: necesita CORS.

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://servicios.cenas-support.com",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function randomSlug(len = 6): string {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789"; // sin 0/O/1/l
  return Array.from(crypto.getRandomValues(new Uint8Array(len)))
    .map(b => chars[b % chars.length])
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
  if (authErr || !user) return json({ error: "Unauthorized" }, 401);

  const body = await req.json() as { client_id: string; target_url: string; label?: string; expires_at?: string };
  if (!body.client_id || !body.target_url) return json({ error: "client_id and target_url required" }, 400);
  if (!/^https?:\/\//i.test(body.target_url)) return json({ error: "target_url must be http(s)" }, 400);

  // Solo para clientes del usuario logueado
  const { data: client } = await supabase
    .from("clients").select("id").eq("id", body.client_id).eq("user_id", user.id).maybeSingle();
  if (!client) return json({ error: "Client not found" }, 404);

  let slug = randomSlug();
  for (let i = 0; i < 5; i++) {
    const { error } = await supabase.from("short_links").insert({
      slug,
      client_id:  body.client_id,
      target_url: body.target_url,
      label:      body.label ?? null,
      expires_at: body.expires_at ?? null,
      created_by: user.id,
    });
    if (!error) break;
    if (error.code === "23505") { slug = randomSlug(); continue; } // slug repetido
    return json({ error: error.message }, 500);
  }

  const shortUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/r/${slug}`;
  return json({ slug, short_url: shortUrl }, 201);
});
