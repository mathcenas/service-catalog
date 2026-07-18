import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const statusUrl = url.searchParams.get("url");

  if (!statusUrl) {
    return new Response(JSON.stringify({ error: "Missing url param" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const parsed = new URL(statusUrl);
    const slug = parsed.pathname.replace(/^\/status\//, "").replace(/\/$/, "");
    if (!slug) throw new Error("Invalid slug");

    const apiUrl = `${parsed.origin}/api/status-page/heartbeat/${slug}`;
    const res = await fetch(apiUrl, { headers: { "Accept": "application/json" } });

    if (!res.ok) {
      return new Response(JSON.stringify({ error: "Kuma returned " + res.status }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await res.json();
    return new Response(JSON.stringify(data), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
