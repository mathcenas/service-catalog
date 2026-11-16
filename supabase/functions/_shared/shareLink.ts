// Link a la página compartida del cliente (/share/<token>), la misma que genera el admin.
// Toma el token vigente más nuevo de client_share_tokens; null si el cliente no tiene.
// deno-lint-ignore no-explicit-any
export async function clientShareUrl(supabase: any, clientId: string): Promise<string | null> {
  const { data } = await supabase
    .from("client_share_tokens")
    .select("token, expires_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  const now = Date.now();
  // deno-lint-ignore no-explicit-any
  const tok = (data ?? []).find((t: any) => !t.expires_at || new Date(t.expires_at).getTime() > now);
  if (!tok) return null;
  const base = Deno.env.get("APP_URL") || "https://servicios.cenas-support.com";
  return `${base}/share/${tok.token}`;
}
