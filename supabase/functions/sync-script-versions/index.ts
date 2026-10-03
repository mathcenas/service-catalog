import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GITHUB_RAW = "https://raw.githubusercontent.com/mathcenas/service-catalog/main/";

const SCRIPT_SOURCE_FILES: Record<string, { windows: string; windowsServer?: string; linux?: string }> = {
  "system-health":   { windows: "scripts/windows/system-health.ps1", windowsServer: "scripts/windows/system-health-server.ps1", linux: "scripts/linux/system-health.sh" },
  "rdp":             { windows: "scripts/windows/system-health.ps1", windowsServer: "scripts/windows/system-health-server.ps1" },
  "network":         { windows: "scripts/windows/system-health.ps1", windowsServer: "scripts/windows/system-health-server.ps1" },
  "speedtest":       { windows: "scripts/windows/system-health.ps1" },
  "mikrotik":        { linux: "scripts/linux/mikrotik-heartbeat.sh" },
  "smb-check":       { windows: "scripts/windows/smb-check.ps1" },
  "kopia":           { windows: "scripts/windows/kopia-report.ps1" },
  "veeam":           { windows: "scripts/windows/veeam-report.ps1" },
};

async function fetchVersion(path: string): Promise<string | null> {
  try {
    const res = await fetch(GITHUB_RAW + path);
    if (!res.ok) return null;
    const text = await res.text();
    const match = text.match(/^\$?SCRIPT_VERSION\s*=\s*["']?([0-9]+\.[0-9]+\.[0-9]+)["']?/m);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  // Allow cron invocation (no JWT) and manual POST
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const allPaths = new Map<string, string>(); // path → variant key
  for (const [source, entry] of Object.entries(SCRIPT_SOURCE_FILES)) {
    if (entry.windows)       allPaths.set(entry.windows, `${source}:windows`);
    if (entry.windowsServer) allPaths.set(entry.windowsServer, `${source}:windowsServer`);
    if (entry.linux)         allPaths.set(entry.linux, `${source}:linux`);
  }

  // Deduplicated fetch — same file used by multiple sources is fetched once
  const pathVersions = new Map<string, string | null>();
  await Promise.all([...allPaths.keys()].map(async (path) => {
    pathVersions.set(path, await fetchVersion(path));
  }));

  const rows: { source: string; variant: string; version: string; fetched_at: string }[] = [];
  const fetched_at = new Date().toISOString();

  for (const [source, entry] of Object.entries(SCRIPT_SOURCE_FILES)) {
    for (const [variant, path] of [
      ["windows", entry.windows],
      ["windowsServer", entry.windowsServer],
      ["linux", entry.linux],
    ] as [string, string | undefined][]) {
      if (!path) continue;
      const version = pathVersions.get(path);
      if (!version) continue;
      rows.push({ source, variant, version, fetched_at });
    }
  }

  if (rows.length > 0) {
    const { error } = await supabase
      .from("script_versions")
      .upsert(rows, { onConflict: "source,variant" });
    if (error) {
      console.error("[sync-script-versions] upsert error:", error.message);
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
  }

  console.log(`[sync-script-versions] updated ${rows.length} rows`);
  return new Response(JSON.stringify({ updated: rows.length, rows }), {
    headers: { "Content-Type": "application/json" },
  });
});
