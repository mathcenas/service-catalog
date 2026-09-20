// Cenas IT brand tokens — shared across all transactional email templates

export const B = {
  primary:  "#0B192C",
  accent:   "#06B6D4",
  surface:  "#1E293B",
  textMain: "#334155",
  textMid:  "#64748B",
  textSoft: "#94A3B8",
  bg:       "#F8FAFC",
  border:   "#E2E8F0",
} as const;

export const EMAIL_FONT =
  "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** Public logo URL — override via LOGO_URL env var */
export const LOGO_URL =
  (typeof Deno !== "undefined" && Deno.env.get("LOGO_URL")) ||
  "https://cenas.uy/assets/brand/logo-badge-light.png";

/** <img> tag ready to drop into email headers (light background) */
export function emailLogo(companyName = "Cenas IT", height = 28): string {
  return `<img src="${LOGO_URL}" alt="${companyName}" width="auto" height="${height}" style="display:block;height:${height}px;width:auto;border:0;" />`;
}

/** Outer wrapper — max-width 600, white background, brand font.
 *  Uses <table> for Outlook/Gmail compatibility — no display:flex. */
export function emailWrap(content: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${B.bg};font-family:${EMAIL_FONT};">
  <tr>
    <td align="center" style="padding:32px 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;border:1px solid ${B.border};">
        <tr>
          <td style="padding:28px;">
            ${content}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

/**
 * Pre-calculated solid color pairs per semantic category.
 * Avoids 8-digit alpha hex (#color18 / #color40) which many mail clients ignore.
 */
export const LABEL_COLORS: Record<string, { text: string; bg: string; border: string }> = {
  success: { text: "#059669", bg: "#ECFDF5", border: "#A7F3D0" },
  warning: { text: "#B45309", bg: "#FFFBEB", border: "#FDE68A" },
  error:   { text: "#DC2626", bg: "#FEF2F2", border: "#FECACA" },
  info:    { text: "#0E7490", bg: "#ECFEFF", border: "#A5F3FC" },
  cyan:    { text: "#0E7490", bg: "#ECFEFF", border: "#A5F3FC" },
  purple:  { text: "#6D28D9", bg: "#F5F3FF", border: "#DDD6FE" },
  default: { text: "#334155", bg: "#F1F5F9", border: "#CBD5E1" },
};

/** Resolve a hex accent color to a pre-calculated solid pair, or fall back to default. */
function resolveLabel(accentColor: string): { text: string; bg: string; border: string } {
  const map: Record<string, keyof typeof LABEL_COLORS> = {
    "#10b981": "success", "#059669": "success", "#34d399": "success",
    "#f59e0b": "warning", "#fbbf24": "warning", "#b45309": "warning",
    "#ef4444": "error",   "#dc2626": "error",
    "#06b6d4": "cyan",    "#0e7490": "cyan",
    "#8b5cf6": "purple",  "#6d28d9": "purple",
  };
  const key = map[accentColor.toLowerCase()];
  return LABEL_COLORS[key ?? "default"];
}

/**
 * Header strip — logo left, colored label badge right.
 * Laid out with a nested <table> instead of display:flex for Outlook compatibility.
 */
export function emailHeader(opts: {
  logoHtml?: string;
  senderName: string;
  label: string;
  accentColor: string;
  title?: string;
  subtitle?: string;
}): string {
  const { logoHtml, senderName, label, accentColor, title, subtitle } = opts;
  const pair = resolveLabel(accentColor);
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid ${B.border};">
      <tr>
        <td valign="middle">
          <table role="presentation" cellpadding="0" cellspacing="0">
            <tr>
              <td valign="middle" style="padding-right:10px;">
                <div style="background:${B.primary};padding:7px 13px;border-radius:7px;display:inline-block;">
                  <span style="color:${B.accent};font-size:11px;font-weight:700;letter-spacing:.5px;">${senderName.toUpperCase()}</span>
                </div>
              </td>
              ${logoHtml ? `<td valign="middle">${logoHtml}</td>` : ""}
            </tr>
          </table>
          ${title ? `<div style="font-size:16px;font-weight:700;color:${B.primary};margin-top:8px;">${title}</div>` : ""}
          ${subtitle ? `<div style="font-size:12px;color:${B.textMid};margin-top:2px;">${subtitle}</div>` : ""}
        </td>
        <td valign="middle" align="right">
          <table role="presentation" cellpadding="0" cellspacing="0" style="background:${pair.bg};border:1px solid ${pair.border};border-radius:8px;">
            <tr>
              <td style="padding:4px 12px;">
                <span style="color:${pair.text};font-size:11px;font-weight:700;letter-spacing:.5px;">${label}</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>`;
}

/** Dark branded footer panel — portal CTA */
export function emailPortalPanel(opts: {
  companyName?: string;
  portalUrl?: string | null;
}): string {
  const { companyName = "Portal de Servicios", portalUrl } = opts;
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;">
      <tr>
        <td style="background:${B.primary};border-radius:10px;padding:18px 20px;text-align:center;">
          <p style="color:${B.textSoft};font-size:11px;margin:0 0 4px;text-transform:uppercase;letter-spacing:1px;">Portal de Servicios</p>
          <p style="color:#ffffff;font-size:13px;margin:0 0 6px;font-weight:600;">${companyName}</p>
          <p style="color:${B.textSoft};font-size:11px;margin:0;line-height:1.5;">
            Servicios gestionados &bull; Soporte &bull; Backups &bull; Información IT
          </p>
          ${portalUrl ? `
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:12px auto 0;">
            <tr>
              <td style="background:${B.accent};border-radius:6px;">
                <a href="${portalUrl}" style="display:inline-block;padding:8px 22px;font-size:12px;font-weight:700;color:${B.primary};text-decoration:none;">Ver mis servicios →</a>
              </td>
            </tr>
          </table>` : ""}
        </td>
      </tr>
    </table>`;
}

/** Small footer line below portal panel */
export function emailMeta(companyName: string): string {
  return `<p style="color:${B.textSoft};font-size:10px;text-align:center;margin-top:12px;">
    Cenas IT Solutions &mdash; Procesos bajo norma ISO/IEC 20000
  </p>`;
}

/** Institutional footer line — required on every transactional email */
export function emailFooter(): string {
  return emailMeta("Cenas IT Solutions");
}
