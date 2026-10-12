import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

const SECRET = Deno.env.get("PREFERENCES_SECRET") || "cenas-prefs-secret";

async function signToken(contactId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(contactId));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return `${btoa(contactId)}.${b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')}`;
}

async function verifyToken(token: string): Promise<string | null> {
  const [b64id, sig] = token.split('.');
  if (!b64id || !sig) return null;
  try {
    const contactId = atob(b64id);
    const expected = await signToken(contactId);
    return expected === token ? contactId : null;
  } catch { return null; }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  const url = new URL(req.url);
  const token = url.searchParams.get("token") || (req.method === "POST" ? (await req.json().catch(() => ({}))).token : null);

  if (!token) return new Response(JSON.stringify({ error: "token requerido" }), { status: 400, headers: corsHeaders });

  const contactId = await verifyToken(token);
  if (!contactId) return new Response(JSON.stringify({ error: "token inválido" }), { status: 401, headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // GET — devolver preferencias actuales
  if (req.method === "GET") {
    const { data: contact } = await supabase
      .from("client_contacts")
      .select("id, name, email, digest_frequency, clients(company_name)")
      .eq("id", contactId)
      .maybeSingle();
    if (!contact) return new Response(JSON.stringify({ error: "contacto no encontrado" }), { status: 404, headers: corsHeaders });
    return new Response(JSON.stringify({
      name: contact.name,
      email: contact.email,
      company: (contact as any).clients?.company_name,
      digest_frequency: contact.digest_frequency,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // POST — actualizar preferencia
  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const { frequency } = body;
    const allowed = ["daily", "weekly", "none"];
    if (!allowed.includes(frequency)) {
      return new Response(JSON.stringify({ error: "frequency debe ser daily, weekly o none" }), { status: 400, headers: corsHeaders });
    }

    const { data: contact } = await supabase
      .from("client_contacts")
      .select("id, email, client_id, digest_frequency, clients(company_name, user_id)")
      .eq("id", contactId)
      .maybeSingle();
    if (!contact) return new Response(JSON.stringify({ error: "contacto no encontrado" }), { status: 404, headers: corsHeaders });

    const prev = contact.digest_frequency;
    if (prev === frequency) return new Response(JSON.stringify({ ok: true, changed: false }), { status: 200, headers: corsHeaders });

    await supabase.from("client_contacts").update({ digest_frequency: frequency }).eq("id", contactId);

    // Registrar en email_opens para el notification center
    const emailType = frequency === "none" ? "unsubscribe" : "preference_change";
    const freqLabel: Record<string, string> = { daily: "diario", weekly: "semanal", none: "desactivado" };
    await supabase.from("email_opens").insert({
      user_id:       (contact as any).clients?.user_id ?? null,
      client_id:     contact.client_id,
      contact_id:    contact.id,
      client_email:  contact.email,
      email_type:    emailType,
      sent_at:       new Date().toISOString(),
      opened_at:     new Date().toISOString(),
      metadata:      { prev_frequency: prev, new_frequency: frequency },
    });

    console.log(`[email-preferences] ${contact.email} cambió de ${prev} → ${frequency}`);
    return new Response(JSON.stringify({ ok: true, changed: true, frequency }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: corsHeaders });
});

// Helper exportado para generar tokens desde otras funciones
export { signToken };
