// Shared brand constants for PDF exports (print-to-PDF via window.open)
export const BRAND = {
  primary:  '#0B192C',
  accent:   '#06B6D4',
  surface:  '#1E293B',
  textMain: '#334155',
  textMid:  '#64748B',
  textSoft: '#94A3B8',
  bg:       '#F8FAFC',
  border:   '#E2E8F0',
} as const;

export const BRAND_FONT = `'Plus Jakarta Sans', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;

/** Common <style> block injected into every PDF window */
export const PDF_BASE_STYLES = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: ${BRAND_FONT};
    background: #fff;
    color: ${BRAND.textMain};
    padding: 40px 32px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  @media print {
    #print-btn { display: none !important; }
    body { padding: 20px; }
    @page { size: A4; margin: 15mm; }
  }
  #print-btn {
    position: fixed; top: 16px; right: 16px; z-index: 999;
    background: ${BRAND.accent}; color: #fff; border: none;
    border-radius: 8px; padding: 9px 18px;
    font-family: ${BRAND_FONT};
    font-size: 13px; font-weight: 600; cursor: pointer;
    box-shadow: 0 2px 8px rgba(6,182,212,.35);
  }
  #print-btn:hover { opacity: .88; }
  table { width: 100%; border-collapse: collapse; }
  thead tr { background: ${BRAND.bg}; }
  th {
    padding: 8px 12px; text-align: left;
    font-size: 11px; color: ${BRAND.textMid}; font-weight: 600;
    text-transform: uppercase; letter-spacing: .4px;
    border-bottom: 1px solid ${BRAND.border};
  }
  td { padding: 7px 12px; font-size: 12px; border-top: 1px solid ${BRAND.bg}; }
  tr:nth-child(even) td { background: #fafbfc; }
  .footer { margin-top: 28px; font-size: 11px; color: ${BRAND.textSoft}; }
`;

/** Brand header HTML — logo or company name pill + document title + date */
export function pdfHeader(opts: {
  logoUrl?: string | null;
  companyName: string;
  title: string;
  subtitle?: string;
  date: string;
}): string {
  const logoBlock = opts.logoUrl
    ? `<img src="${opts.logoUrl}" alt="${opts.companyName}" style="height:32px;object-fit:contain;" />`
    : `<div style="display:inline-flex;align-items:center;background:${BRAND.primary};padding:6px 14px;border-radius:6px;">
         <span style="color:${BRAND.accent};font-weight:700;font-size:13px;letter-spacing:.5px;">${opts.companyName.toUpperCase()}</span>
       </div>`;

  return `
  <div style="display:flex;align-items:flex-start;justify-content:space-between;
              padding-bottom:18px;margin-bottom:28px;
              border-bottom:3px solid ${BRAND.accent};">
    <div>
      ${logoBlock}
      <h1 style="margin:10px 0 3px;font-size:20px;font-weight:700;color:${BRAND.primary};">${opts.title}</h1>
      ${opts.subtitle ? `<p style="font-size:13px;color:${BRAND.textMid};">${opts.subtitle}</p>` : ''}
    </div>
    <div style="text-align:right;font-size:12px;color:${BRAND.textMid};white-space:nowrap;padding-top:4px;">
      <div style="font-weight:600;color:${BRAND.textMain};">Generado</div>
      <div>${opts.date}</div>
    </div>
  </div>`;
}

/** Section heading inside a PDF */
export function pdfSection(title: string): string {
  return `<h2 style="font-size:13px;font-weight:700;color:${BRAND.primary};
                     margin:24px 0 10px;text-transform:uppercase;letter-spacing:.5px;
                     padding-bottom:5px;border-bottom:2px solid ${BRAND.accent};">${title}</h2>`;
}

/** Open a new print window with the given HTML body content */
export function openPrintWindow(title: string, bodyContent: string): void {
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>${PDF_BASE_STYLES}</style>
</head>
<body>
  <button id="print-btn" onclick="window.print()">⬇ Guardar PDF</button>
  <div style="max-width:1100px;margin:0 auto;">
    ${bodyContent}
  </div>
</body>
</html>`);
  win.document.close();
}
