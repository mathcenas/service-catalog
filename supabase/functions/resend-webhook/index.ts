import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Resend signs webhooks using Svix. Verification requires the webhook secret
// from Resend → Webhooks → [webhook] → Signing Secret (whsec_...)
// Set as RESEND_WEBHOOK_SECRET in Supabase Edge Function secrets.

const TOLERANCE_SECONDS = 300; // 5 min replay protection

async function verifySignature(req: Request, body: string): Promise<boolean> {
  const secret = Deno.env.get("RESEND_WEBHOOK_SECRET");
  if (!secret) return false; // fail closed

  const msgId        = req.headers.get("svix-id");
  const msgTimestamp = req.headers.get("svix-timestamp");
  const msgSignature = req.headers.get("svix-signature");
  if (!msgId || !msgTimestamp || !msgSignature) return false;

  // Replay protection
  const ts = parseInt(msgTimestamp, 10);
  if (isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > TOLERANCE_SECONDS) return false;

  // svix signing: HMAC-SHA256 over "<msgId>.<msgTimestamp>.<body>"
  const toSign = `${msgId}.${msgTimestamp}.${body}`;
  const rawSecret = secret.startsWith("whsec_")
    ? secret.slice("whsec_".length)
    : secret;
  const keyBytes = Uint8Array.from(atob(rawSecret), c => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(toSign));
  const computed = `v1,${btoa(String.fromCharCode(...new Uint8Array(sig)))}`;

  // svix-signature may contain multiple space-separated sigs; any match is valid
  return msgSignature.split(" ").some(s => s === computed);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const body = await req.text();

  const verified = await verifySignature(req, body);
  if (!verified) {
    return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 401 });
  }

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }

  const type = event.type as string;
  const data = (event.data ?? {}) as Record<string, unknown>;
  const resendEmailId = data.email_id as string | undefined;
  const toAddress = (Array.isArray(data.to) ? data.to[0] : data.to) as string | undefined;

  if (!resendEmailId) {
    return new Response(JSON.stringify({ ok: true, skipped: "no email_id" }), { status: 200 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Lookup email_opens record for this Resend email
  const { data: openRow } = await supabase
    .from("email_opens")
    .select("id, user_id, client_id, roadmap_item_id, client_email")
    .eq("resend_email_id", resendEmailId)
    .maybeSingle();

  // ----------------------------------------------------------------
  // email.delivered
  // ----------------------------------------------------------------
  if (type === "email.delivered" && openRow) {
    await supabase
      .from("email_opens")
      .update({ delivered_at: new Date().toISOString() })
      .eq("resend_email_id", resendEmailId);
  }

  // ----------------------------------------------------------------
  // email.bounced / email.complained
  // ----------------------------------------------------------------
  if (type === "email.bounced" || type === "email.complained") {
    const flagField = type === "email.bounced" ? "email_bounced" : "email_complained";
    const email = openRow?.client_email ?? toAddress;

    if (email) {
      // Try to find client by primary or alt email
      const { data: client } = await supabase
        .from("clients")
        .select("id")
        .or(`email.eq.${email},alt_email.eq.${email}`)
        .maybeSingle();

      if (client) {
        await supabase
          .from("clients")
          .update({ [flagField]: true, email_status_at: new Date().toISOString() })
          .eq("id", client.id);
      }
    }
  }

  // ----------------------------------------------------------------
  // email.clicked
  // ----------------------------------------------------------------
  if (type === "email.clicked") {
    const clickedUrl = data.click?.link as string | undefined ?? data.link as string | undefined;

    await supabase.from("email_clicks").insert({
      user_id:         openRow?.user_id         ?? null,
      resend_email_id: resendEmailId,
      client_email:    openRow?.client_email     ?? toAddress ?? null,
      client_id:       openRow?.client_id        ?? null,
      roadmap_item_id: openRow?.roadmap_item_id  ?? null,
      clicked_url:     clickedUrl               ?? null,
      clicked_at:      new Date().toISOString(),
    });
  }

  return new Response(JSON.stringify({ ok: true, type }), { status: 200 });
});
