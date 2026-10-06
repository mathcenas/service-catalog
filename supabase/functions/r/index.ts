import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

serve(async (req) => {
  const url = new URL(req.url);
  // slug viene como último segmento: /functions/v1/r/abc123
  const slug = url.pathname.split("/").filter(Boolean).pop() ?? "";

  if (!slug) {
    return new Response("Not found", { status: 404 });
  }

  const { data: link } = await supabase
    .from("short_links")
    .select("target_url, expires_at")
    .eq("slug", slug)
    .maybeSingle();

  if (!link) {
    return new Response("Link not found", { status: 404 });
  }

  if (link.expires_at && new Date(link.expires_at) < new Date()) {
    return new Response("Link expired", { status: 410 });
  }

  // Registrar click — fire and forget, no bloquea el redirect
  const emailOpenId = url.searchParams.get("eo") ?? null;
  EdgeRuntime.waitUntil(
    supabase.from("link_clicks").insert({
      slug,
      referrer: req.headers.get("referer") ?? null,
      email_open_id: emailOpenId,
    })
  );

  return new Response(null, {
    status: 302,
    headers: { Location: link.target_url },
  });
});
