import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GITHUB_RAW = "https://raw.githubusercontent.com/mathcenas/service-catalog/main/";

const SCRIPT_SOURCE_FILES: Record<string, { windows?: string; windowsServer?: string; linux?: string }> = {
  // Heartbeat / telemetría de sistema
  "system-health":      { windows: "scripts/windows/system-health.ps1", windowsServer: "scripts/windows/system-health-server.ps1", linux: "scripts/linux/system-health.sh" },
  "rdp":                { windows: "scripts/windows/system-health.ps1", windowsServer: "scripts/windows/system-health-server.ps1" },
  "network":            { windows: "scripts/windows/system-health.ps1", windowsServer: "scripts/windows/system-health-server.ps1" },
  "speedtest":          { windows: "scripts/windows/system-health.ps1" },
  "server-snapshot":    { windows: "scripts/windows/server-snapshot.ps1" },
  "cpu-watch":          { windows: "scripts/windows/cpu-watch.ps1" },
  // Backups
  "kopia":              { windows: "scripts/windows/kopia-report.ps1" },
  "kopia-maintenance":  { windows: "scripts/windows/kopia-report.ps1" },
  "tailscale":          { windows: "scripts/windows/kopia-report.ps1" },
  "veeam":              { windows: "scripts/windows/veeam-report.ps1" },
  "veeam-agent":        { windows: "scripts/windows/veeam-agent-report.ps1" },
  "cristar":            { windows: "scripts/windows/cristar-backup-report.ps1" },
  "backup":             { linux:  "scripts/linux/backup.sh" },
  "veeam-restore-test": { windows: "scripts/windows/veeam-restore-test-report.ps1" },
  // SMB / ACL
  "smb-check":          { windows: "scripts/windows/smb-check.ps1" },
  // Otros
  "ad-backup":          { windows: "scripts/windows/ad-backup.ps1" },
  "backup-folder-check":{ windows: "scripts/windows/backup-folder-check.ps1" },
};

const VERSION_RE = /^\$?SCRIPT_VERSION\s*=\s*["']?([0-9]+\.[0-9]+\.[0-9]+)["']?/m;

async function fetchText(path: string): Promise<string | null> {
  try {
    const res = await fetch(GITHUB_RAW + path);
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

async function fetchVersion(path: string): Promise<string | null> {
  const text = await fetchText(path);
  return text?.match(VERSION_RE)?.[1] ?? null;
}

// Todos los scripts de una carpeta del repo (API pública de GitHub, sin token)
async function listDir(dir: string): Promise<string[]> {
  try {
    const res = await fetch(`https://api.github.com/repos/mathcenas/service-catalog/contents/${dir}?ref=main`, {
      headers: { "User-Agent": "service-catalog-sync", Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return [];
    const items = await res.json() as { name: string; type: string }[];
    return items.filter(i => i.type === "file" && /\.(ps1|sh|py)$/.test(i.name)).map(i => i.name);
  } catch {
    return [];
  }
}

// Nombres que maneja cada actualizador, leídos de su propia lista
function managedNames(updaterText: string | null, platform: "windows" | "linux"): Set<string> {
  if (!updaterText) return new Set();
  const re = platform === "windows" ? /^\s*"([\w.-]+\.ps1)"\s*=\s*"scripts\/windows\//gm : /^\s*\["([\w.-]+)"\]="scripts\/linux\//gm;
  return new Set([...updaterText.matchAll(re)].map(m => m[1]));
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
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

  // Versión de cada archivo del repo (source "file:<nombre>"). variant = plataforma si el
  // actualizador lo maneja, "<plataforma>-manual" si hay que copiarlo a mano.
  for (const platform of ["windows", "linux"] as const) {
    const updater = await fetchText(`scripts/${platform}/update-scripts.${platform === "windows" ? "ps1" : "sh"}`);
    const managed = managedNames(updater, platform);
    const names = await listDir(`scripts/${platform}`);
    await Promise.all(names.map(async (name) => {
      const version = await fetchVersion(`scripts/${platform}/${name}`);
      if (!version) return;
      rows.push({ source: `file:${name}`, variant: managed.has(name) ? platform : `${platform}-manual`, version, fetched_at });
    }));
  }

  if (rows.length > 0) {
    const { error } = await supabase
      .from("script_versions")
      .upsert(rows, { onConflict: "source,variant" });
    if (error) {
      console.error("[sync-script-versions] upsert error:", error.message);
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
    }
    // Archivos que ya no están (o cambiaron de manual a gestionado): borrar filas viejas
    await supabase.from("script_versions").delete().like("source", "file:%").lt("fetched_at", fetched_at);
  }

  console.log(`[sync-script-versions] updated ${rows.length} rows`);
  return new Response(JSON.stringify({ updated: rows.length, rows }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
