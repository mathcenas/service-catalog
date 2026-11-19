// A dónde van las respuestas de los mails que mandamos con Resend. Se envía desde
// info@updates.cenas.uy (subdominio de envío, sin casilla): sin reply_to, si el cliente responde
// el mail se pierde. RESEND_REPLY_TO_ADDRESS (o RESEND_REPLY_TO) en los secretos de Supabase.
export const REPLY_TO =
  Deno.env.get("RESEND_REPLY_TO_ADDRESS") || Deno.env.get("RESEND_REPLY_TO") || "info@cenas.uy";
