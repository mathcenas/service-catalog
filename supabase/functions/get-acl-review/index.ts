import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return new Response(JSON.stringify({ error: "Missing token" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: reviewToken, error } = await supabase
    .from("acl_review_tokens")
    .select("*, service_acl_snapshots(snapshot, generated_at), services(name, business_name), clients(company_name, contact_name, email)")
    .eq("token", token)
    .single();

  if (error || !reviewToken) {
    return new Response(JSON.stringify({ error: "Token not found" }), {
      status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (new Date(reviewToken.expires_at) < new Date()) {
    return new Response(JSON.stringify({ error: "Token expired" }), {
      status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (reviewToken.submitted_at) {
    return new Response(JSON.stringify({ error: "Already submitted", submitted_at: reviewToken.submitted_at }), {
      status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Fetch admin user_settings for logo/company
  const { data: settings } = await supabase
    .from("user_settings")
    .select("logo_url, company_name")
    .eq("user_id", reviewToken.user_id)
    .maybeSingle();

  const snap = (reviewToken.service_acl_snapshots as any);
  const svc = (reviewToken.services as any);
  const client = (reviewToken.clients as any);

  return new Response(JSON.stringify({
    snapshot: snap?.snapshot,
    generated_at: snap?.generated_at,
    service_name: svc?.business_name || svc?.name || "",
    client_name: client?.company_name || "",
    expires_at: reviewToken.expires_at,
    logo_url: settings?.logo_url || null,
    company_name: settings?.company_name || "",
  }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
