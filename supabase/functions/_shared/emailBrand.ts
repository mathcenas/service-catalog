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
  "'Plus Jakarta Sans','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";

/** Public logo URL — override via LOGO_URL env var */
export const LOGO_URL =
  (typeof Deno !== "undefined" && Deno.env.get("LOGO_URL")) ||
  "https://landing.cenas.uy/assets/brand/logo-dark.png";

/** <img> tag ready to drop into email headers (light background) */
export function emailLogo(companyName = "Cenas IT", height = 28): string {
  return `<img src="${LOGO_URL}" alt="${companyName}" style="height:${height}px;object-fit:contain;flex-shrink:0;" />`;
}

/** Outer wrapper div — max-width 600, white background, brand font */
export function emailWrap(content: string): string {
  return `<div style="font-family:${EMAIL_FONT};max-width:600px;margin:0 auto;padding:32px 24px;background:#f8fafc;">
    <div style="background:#ffffff;border-radius:12px;padding:28px;border:1px solid ${B.border};">
      ${content}
    </div>
  </div>`;
}

/**
 * Header strip — brand name pill + optional logo + colored label + title.
 * @param accentColor — per-category status color (kept for semantic meaning)
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
  return `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid ${B.border};">
      <div style="background:${B.primary};padding:7px 13px;border-radius:7px;flex-shrink:0;">
        <span style="color:${B.accent};font-size:11px;font-weight:700;letter-spacing:.5px;">${senderName.toUpperCase()}</span>
      </div>
      ${logoHtml ? `<div style="flex-shrink:0;">${logoHtml}</div>` : ""}
      <div>
        <span style="display:inline-block;background:${accentColor}18;color:${accentColor};border:1px solid ${accentColor}40;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:700;">${label}</span>
        ${title ? `<div style="font-size:16px;font-weight:700;color:${B.primary};margin-top:4px;">${title}</div>` : ""}
        ${subtitle ? `<div style="font-size:12px;color:${B.textMid};margin-top:2px;">${subtitle}</div>` : ""}
      </div>
    </div>`;
}

/** Dark branded footer panel — portal CTA */
export function emailPortalPanel(opts: {
  companyName?: string;
  portalUrl?: string | null;
}): string {
  const { companyName = "Portal de Servicios", portalUrl } = opts;
  return `
    <div style="margin-top:32px;padding:18px 20px;background:${B.primary};border-radius:10px;text-align:center;">
      <p style="color:${B.textSoft};font-size:11px;margin:0 0 4px;text-transform:uppercase;letter-spacing:1px;">Portal de Servicios</p>
      <p style="color:#ffffff;font-size:13px;margin:0 0 6px;font-weight:600;">${companyName}</p>
      <p style="color:${B.textSoft};font-size:11px;margin:0;line-height:1.5;">
        Servicios gestionados &bull; Soporte &bull; Backups &bull; Información IT
      </p>
      ${portalUrl ? `
        <a href="${portalUrl}" style="display:inline-block;margin-top:12px;background:${B.accent};color:${B.primary};font-size:12px;font-weight:700;text-decoration:none;padding:8px 22px;border-radius:6px;">
          Ver mis servicios →
        </a>` : ""}
    </div>`;
}

/** Small footer line below portal panel */
export function emailMeta(companyName: string): string {
  return `<p style="color:${B.textSoft};font-size:10px;font-style:italic;margin-top:12px;text-align:center;">
    Correo generado por <span style="color:${B.accent};font-weight:600;">${companyName}</span>
  </p>`;
}
