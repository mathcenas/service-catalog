import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function randomSlug(len = 6): string {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789"; // no 0/O/1/l
  return Array.from(crypto.getRandomValues(new Uint8Array(len)))
    .map(b => chars[b % chars.length])
    .join("");
}

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const authHeader = req.headers.get("Authorization") ?? "";
  const { data: { user }, error: authErr } = await supabase.auth.getUser(
    authHeader.replace("Bearer ", "")
  );
  if (authErr || !user) return new Response("Unauthorized", { status: 401 });

  const body = await req.json() as {
    client_id: string;
    target_url: string;
    label?: string;
    expires_at?: string;
  };

  if (!body.client_id || !body.target_url) {
    return new Response(JSON.stringify({ error: "client_id and target_url required" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  // Retry on slug collision (extremely unlikely but safe)
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
    if (error.code === "23505") { slug = randomSlug(); continue; } // unique violation
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  const baseUrl = Deno.env.get("SUPABASE_URL")!;
  const shortUrl = `${baseUrl}/functions/v1/r/${slug}`;

  return new Response(JSON.stringify({ slug, short_url: shortUrl }), {
    status: 201, headers: { "Content-Type": "application/json" },
  });
});
