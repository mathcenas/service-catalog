import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

interface IncomingTicket {
  id?: string;
  type: "problem" | "change";
  description: string;
  reportedBy?: string;
  client?: { id?: string; name?: string; slug?: string };
  project?: { id?: string; name?: string };
  notes?: { note: string; createdAt?: string }[];
  closedAt?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Extract Bearer token
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return new Response(JSON.stringify({ error: "Missing Authorization token" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Find the user whose webhook_token matches
  const { data: settingsRow, error: settingsErr } = await supabaseAdmin
    .from("user_settings")
    .select("user_id")
    .eq("webhook_token", token)
    .maybeSingle();

  if (settingsErr || !settingsRow) {
    return new Response(JSON.stringify({ error: "Invalid token" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userId = settingsRow.user_id;

  let body: IncomingTicket;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!body.type || !body.description) {
    return new Response(JSON.stringify({ error: "Missing required fields: type, description" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Map type → roadmap category
  const category = body.type === "problem" ? "problem" : "change_request";

  // Find matching client by name or slug
  let clientId: string | null = null;
  if (body.client?.name || body.client?.slug) {
    const { data: clientRows } = await supabaseAdmin
      .from("clients")
      .select("id, company_name")
      .eq("user_id", userId);

    if (clientRows) {
      const needle = (body.client.name || body.client.slug || "").toLowerCase();
      const match = clientRows.find(
        (c) =>
          c.company_name.toLowerCase() === needle ||
          c.company_name.toLowerCase().includes(needle) ||
          needle.includes(c.company_name.toLowerCase())
      );
      if (match) clientId = match.id;
    }
  }

  // Build description from notes
  let description = "";
  if (body.notes && body.notes.length > 0) {
    description = body.notes
      .map((n) => (n.createdAt ? `[${n.createdAt.slice(0, 10)}] ${n.note}` : n.note))
      .join("\n");
  }
  if (body.project?.name) {
    description = `Proyecto: ${body.project.name}\n\n${description}`.trim();
  }
  if (body.id) {
    description = `${description}\n\nRef: ${body.id}`.trim();
  }

  // Status: if already closed in external system, create as Released; otherwise Planned
  const status = body.closedAt ? "Released" : "Planned";

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from("roadmap_items")
    .insert({
      user_id: userId,
      title: body.description,
      description: description || null,
      category,
      status,
      requested_by: body.reportedBy || null,
      client_id: clientId,
      publish_to_changelog: false,
      is_public: false,
      sort_order: 0,
    })
    .select("id")
    .single();

  if (insertErr) {
    return new Response(JSON.stringify({ error: "Failed to create roadmap item", details: insertErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({ success: true, roadmap_item_id: inserted.id, client_matched: !!clientId }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
