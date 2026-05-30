import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const TRANSPARENT_PIXEL = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00,
  0x01, 0x00, 0x80, 0x00, 0x00, 0xff, 0xff, 0xff,
  0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x00,
  0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44,
  0x01, 0x00, 0x3b,
]);

Deno.serve(async (req: Request) => {
  try {
    const url = new URL(req.url);
    const trackingId = url.searchParams.get("t");

    if (!trackingId) {
      return new Response(TRANSPARENT_PIXEL, {
        headers: {
          "Content-Type": "image/gif",
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: record } = await supabase
      .from("email_opens")
      .select("id, open_count, opened_at")
      .eq("tracking_id", trackingId)
      .maybeSingle();

    if (record) {
      const updates: Record<string, unknown> = {
        open_count: (record.open_count || 0) + 1,
      };
      if (!record.opened_at) {
        updates.opened_at = new Date().toISOString();
      }
      await supabase.from("email_opens").update(updates).eq("id", record.id);
    }

    return new Response(TRANSPARENT_PIXEL, {
      headers: {
        "Content-Type": "image/gif",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch {
    return new Response(TRANSPARENT_PIXEL, {
      headers: { "Content-Type": "image/gif" },
    });
  }
});
