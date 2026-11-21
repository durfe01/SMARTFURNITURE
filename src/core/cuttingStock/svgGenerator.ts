/**
 * Generador SVG vectorial 100% offline y XML-safe para planos de corte 2D.
 * Cero fuentes externas, cero CDNs.
 */
import type { SheetLayout } from '../../types/contracts';

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function colorForPiece(nombre: string): { fill: string; stroke: string } {
  const n = nombre.toLowerCase();
  if (n.includes('fondo')) return { fill: '#fef3c7', stroke: '#b45309' };
  if (n.includes('lateral')) return { fill: '#dbeafe', stroke: '#1d4ed8' };
  if (n.includes('cubierta') || n.includes('base')) return { fill: '#dcfce7', stroke: '#15803d' };
  if (n.includes('divisor')) return { fill: '#ede9fe', stroke: '#6d28d9' };
  return { fill: '#e0f2fe', stroke: '#0369a1' };
}

export function renderCuttingPlanSvg(
  sheets: readonly SheetLayout[],
  kerf: number,
  trimMm = 0,
): string {
  if (sheets.length === 0) {
    return [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 120" width="100%">',
      '  <rect width="800" height="120" fill="#f8fafc" stroke="#cbd5e1" rx="8" />',
      '  <text x="400" y="65" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="16" fill="#475569">Sin planchas generadas para las piezas actuales.</text>',
      '</svg>',
    ].join('\n');
  }

  const paddingX = 28;
  const headerH = 44;
  const gapBetween = 34;
  const drawW = 860;
  const maxSheetW = Math.max(...sheets.map((s) => s.anchoSheet));
  const scale = drawW / maxSheetW;

  const sheetBlocks: string[] = [];
  let cursorY = 20;

  for (const sh of sheets) {
    const sw = sh.anchoSheet * scale;
    const shH = sh.altoSheet * scale;
    const yTop = cursorY + headerH;

    const title = `Plancha #${sh.sheetId} · ${sh.materialLabel} (${sh.anchoSheet}×${sh.altoSheet} mm) · Uso ${sh.usoPorcentaje.toFixed(1)}% / Desp. ${sh.desperdicioPorcentaje.toFixed(1)}% · Kerf ${kerf} mm`;
    const parts: string[] = [];

    parts.push(`<g data-sheet-id="${sh.sheetId}">`);
    parts.push(
      `  <text x="${paddingX}" y="${cursorY + 20}" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="700" fill="#0f172a">${escapeXml(title)}</text>`,
    );
    parts.push(
      `  <text x="${paddingX + sw}" y="${cursorY + 20}" text-anchor="end" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="600" fill="#0369a1">${escapeXml('→ Sentido de veta (' + sh.anchoSheet + ' mm)')}</text>`,
    );

    // Fondo de plancha (área desperdicio con patrón de grilla)
    parts.push(
      `  <rect x="${paddingX}" y="${yTop}" width="${sw.toFixed(2)}" height="${shH.toFixed(2)}" fill="url(#wasteGrid)" stroke="#334155" stroke-width="2" />`,
    );

    // Margen de escuadrado punteado si trimMm > 0
    if (trimMm > 0) {
      const tm = trimMm * scale;
      parts.push(
        `  <rect x="${(paddingX + tm).toFixed(2)}" y="${(yTop + tm).toFixed(2)}" width="${(sw - 2 * tm).toFixed(2)}" height="${(shH - 2 * tm).toFixed(2)}" fill="none" stroke="#f59e0b" stroke-width="1.2" stroke-dasharray="5,4" />`,
      );
    }

    for (const r of sh.piezasColocadas) {
      const rx = paddingX + r.x * scale;
      const ry = yTop + r.y * scale;
      const rw = r.ancho * scale;
      const rh = r.alto * scale;
      const col = colorForPiece(r.nombre);
      const rotTag = r.rotado ? ' (R)' : '';
      const labelMain = `${r.nombre}${rotTag}`;
      const labelDim = `${Math.round(r.ancho)}×${Math.round(r.alto)} mm`;

      parts.push(
        `  <rect x="${rx.toFixed(2)}" y="${ry.toFixed(2)}" width="${rw.toFixed(2)}" height="${rh.toFixed(2)}" fill="${col.fill}" stroke="${col.stroke}" stroke-width="1.2" />`,
      );

      if (rw >= 46 && rh >= 24) {
        const cx = rx + rw / 2;
        const cy = ry + rh / 2;
        const fontMain = Math.min(11, Math.max(8, rw / 14));
        const fontDim = Math.min(10, Math.max(7.5, rw / 16));
        parts.push(
          `  <text x="${cx.toFixed(2)}" y="${(cy - 3).toFixed(2)}" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="${fontMain.toFixed(1)}" font-weight="600" fill="#0f172a">${escapeXml(labelMain)}</text>`,
        );
        parts.push(
          `  <text x="${cx.toFixed(2)}" y="${(cy + 10).toFixed(2)}" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="${fontDim.toFixed(1)}" fill="#334155">${escapeXml(labelDim)}</text>`,
        );
      }
    }

    parts.push('</g>');
    sheetBlocks.push(parts.join('\n'));
    cursorY = yTop + shH + gapBetween;
  }

  const totalW = Math.ceil(drawW + paddingX * 2);
  const totalH = Math.ceil(cursorY + 10);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" width="100%">`,
    '  <defs>',
    '    <pattern id="wasteGrid" width="14" height="14" patternUnits="userSpaceOnUse">',
    '      <rect width="14" height="14" fill="#f1f5f9" />',
    '      <path d="M 14 0 L 0 0 0 14" fill="none" stroke="#e2e8f0" stroke-width="0.8" />',
    '    </pattern>',
    '  </defs>',
    `  <rect width="${totalW}" height="${totalH}" fill="#ffffff" />`,
    ...sheetBlocks,
    '</svg>',
  ].join('\n');
}
