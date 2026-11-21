/**
 * SMARTFURNITURE — GENERADOR DE PLANOS VECTORIALES 2D TÉCNICOS (v3.2)
 * 100% offline, SVG XML-safe, con alzado frontal acotado, perfil lateral ZY,
 * simbología real de puertas, vidrios, cajones (5 piezas), patas externas, zócalos y cartela técnica.
 */
import type {
  CuttingPlanResult,
  DespieceResult,
  FrontZone,
  FurnitureTopology,
  ScaleAndBoardParams,
  NormalizedSegment,
} from '../../types/contracts';
import type { DetectedHandlePoint } from '../vision';

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Traduce la detección automática de visión (`vDividers`, `hShelves`, `furnitureMode`, `detectedHandles`)
 * en zonas funcionales `FrontZone[]` para que el Plano Vectorial 2D y el motor de despiece
 * construyan puertas y cajones completos (5 piezas/cajón) de forma automática.
 */
export function inferFrontZonesFromDetection(
  vDividers: readonly NormalizedSegment[],
  hShelves: readonly NormalizedSegment[],
  furnitureMode: 'open' | 'closed_front' | 'uncertain',
  detectedHandles: readonly DetectedHandlePoint[] = [],
): FrontZone[] {
  const uStops = [0, ...[...vDividers].sort((a, b) => a.position - b.position).map((d) => d.position), 1];
  const zones: FrontZone[] = [];

  for (let i = 0; i < uStops.length - 1; i++) {
    const u0 = uStops[i];
    const u1 = uStops[i + 1];
    const uMid = (u0 + u1) / 2;

    if (furnitureMode !== 'closed_front') {
      zones.push({
        id: `zone_open_${i + 1}`,
        uStart: Number(u0.toFixed(4)),
        uEnd: Number(u1.toFixed(4)),
        vStart: 0,
        vEnd: 1,
        kind: 'open',
        label: `Vano ${i + 1}`,
      });
      continue;
    }

    // Buscar ranuras horizontales dentro de esta columna (cajones)
    const colShelves = hShelves.filter(
      (s) => s.start <= u0 + 0.04 && s.end >= u1 - 0.04,
    );

    if (colShelves.length >= 1) {
      zones.push({
        id: `zone_drawers_${i + 1}`,
        uStart: Number(u0.toFixed(4)),
        uEnd: Number(u1.toFixed(4)),
        vStart: 0,
        vEnd: 1,
        kind: 'drawers',
        drawerCount: colShelves.length + 1,
        label: `Cajonera (${colShelves.length + 1})`,
      });
    } else {
      // Determinar sentido de apertura según ubicación del tirador en esta columna
      const colHandle = detectedHandles.find((h) => h.u >= u0 - 0.02 && h.u <= u1 + 0.02);
      const opensLeft = colHandle ? colHandle.u >= uMid : i % 2 === 0;
      zones.push({
        id: `zone_door_${i + 1}`,
        uStart: Number(u0.toFixed(4)),
        uEnd: Number(u1.toFixed(4)),
        vStart: 0,
        vEnd: 1,
        kind: opensLeft ? 'door_left' : 'door_right',
        label: `Puerta ${i + 1}`,
      });
    }
  }

  return zones;
}

export interface BlueprintRenderOptions {
  title?: string;
  stageLabel?: string;
  cuttingPlan?: CuttingPlanResult;
}

/**
 * Genera el Plano Vectorial 2D técnico completo en SVG (Alzado Frontal + Perfil Lateral ZY + Cotas + Cartela).
 */
export function renderFurnitureVectorBlueprintSvg(
  topology: FurnitureTopology,
  params: ScaleAndBoardParams,
  despiece: DespieceResult,
  opts: BlueprintRenderOptions = {},
): string {
  const { x: xf, y: yf, z: zf } = params.targetDimensions;
  const e = params.boardThickness;
  const legH = topology.hasExternalLegs ? Math.max(40, topology.externalLegHeightMm ?? 150) : 0;
  const toeH = !topology.hasExternalLegs ? Math.max(0, topology.toeKickHeightMm ?? 0) : 0;
  const baseLiftH = legH + toeH;
  const totalH = yf + baseLiftH;

  const svgW = 920;
  const svgH = 540;
  const drawLeft = 92;
  const drawTop = 78;
  const maxFrontW = 510;
  const maxSideW = 190;
  const maxBodyH = 320;

  // Escala uniforme compartida entre alzado (xf) y perfil lateral (zf)
  const scaleX = maxFrontW / Math.max(300, xf);
  const scaleSide = maxSideW / Math.max(200, zf);
  const scaleY = maxBodyH / Math.max(300, totalH);
  const sc = Math.min(scaleX, scaleSide, scaleY);

  const fw = xf * sc;
  const fh = yf * sc;
  const liftPx = baseLiftH * sc;
  const sw = zf * sc;
  const ep = Math.max(2, e * sc);

  const frontX = drawLeft + (maxFrontW - fw) / 2;
  const frontY = drawTop + (maxBodyH - (fh + liftPx)) / 2;
  const sideX = drawLeft + maxFrontW + 64;
  const sideY = frontY;

  const xInt = Math.max(1, xf - 2 * e);
  const yInt = Math.max(1, yf - 2 * e);

  const mapU = (u: number): number => frontX + (e + u * xInt) * sc;
  const mapV = (v: number): number => frontY + fh - (e + v * yInt) * sc;

  const lines: string[] = [];
  const title = opts.title ?? topology.furnitureProfileLabel ?? 'Modelo Vectorial SmartFurniture';
  const stage = opts.stageLabel ?? 'MODELO VECTORIAL 2D ACOTADO';

  // Encabezado del plano
  lines.push(`<rect width="${svgW}" height="${svgH}" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.5" />`);
  lines.push(`<rect x="0" y="0" width="${svgW}" height="44" fill="#0f2b4c" />`);
  lines.push(
    `<text x="18" y="20" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="700" fill="#ffffff">${escapeXml(title)}</text>`,
  );
  lines.push(
    `<text x="18" y="36" font-family="Consolas, monospace" font-size="10.5" fill="#7dd3fc">${escapeXml(stage)} · Cuerpo Melamina ${Math.round(xf)}×${Math.round(yf)}×${Math.round(zf)} mm (e=${e} mm)</text>`,
  );
  lines.push(
    `<text x="${svgW - 18}" y="27" text-anchor="end" font-family="Consolas, monospace" font-size="11" font-weight="700" fill="#38bdf8">ESCALA 1:${Math.max(1, Math.round(1 / sc))}</text>`,
  );

  // Grilla técnica suave de fondo
  lines.push(`<rect x="18" y="54" width="${svgW - 36}" height="384" fill="url(#bpGrid)" stroke="#e2e8f0" />`);

  // =========================================================================
  // 1. ALZADO FRONTAL (XY)
  // =========================================================================
  lines.push(
    `<text x="${(frontX + fw / 2).toFixed(1)}" y="${(frontY - 26).toFixed(1)}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="11" font-weight="700" fill="#0f2b4c">ALZADO FRONTAL (PLANO XY)</text>`,
  );

  // Fondo interior general
  lines.push(
    `<rect x="${frontX.toFixed(2)}" y="${frontY.toFixed(2)}" width="${fw.toFixed(2)}" height="${fh.toFixed(2)}" fill="#f8fafc" stroke="#0f172a" stroke-width="1.8" />`,
  );

  // Patas externas (si existen) o Zócalo inferior
  if (legH > 0) {
    const legW = Math.max(5, Math.min(12, fw * 0.032));
    const nLegs = Math.max(2, Math.min(6, topology.externalLegCount ?? 4));
    const legXs =
      nLegs >= 5
        ? [frontX + fw * 0.06, frontX + fw * 0.5 - legW / 2, frontX + fw * 0.94 - legW]
        : [frontX + fw * 0.06, frontX + fw * 0.94 - legW];
    for (const lx of legXs) {
      lines.push(
        `<rect x="${lx.toFixed(2)}" y="${(frontY + fh).toFixed(2)}" width="${legW.toFixed(2)}" height="${liftPx.toFixed(2)}" fill="#e2e8f0" stroke="#475569" stroke-width="1.2" stroke-dasharray="3,2" />`,
      );
    }
    lines.push(
      `<text x="${(frontX + fw / 2).toFixed(1)}" y="${(frontY + fh + liftPx * 0.65).toFixed(1)}" text-anchor="middle" font-family="Consolas, monospace" font-size="9" fill="#92400e">PATAS EXTERNAS (${legH} mm · NO MELAMINA)</text>`,
    );
  } else if (toeH > 0) {
    lines.push(
      `<rect x="${(frontX + ep).toFixed(2)}" y="${(frontY + fh).toFixed(2)}" width="${(fw - 2 * ep).toFixed(2)}" height="${liftPx.toFixed(2)}" fill="#e2e8f0" stroke="#334155" stroke-width="1.2" />`,
    );
  }

  // Zonas frontales (puertas, cajones, vidrios, nichos abiertos, hueco de piernas)
  const zones = topology.frontZones ?? [];
  for (const z of zones) {
    const zx0 = mapU(z.uStart);
    const zx1 = mapU(z.uEnd);
    const zy0 = mapV(z.vEnd);
    const zy1 = mapV(z.vStart);
    const zw = Math.max(1, zx1 - zx0);
    const zh = Math.max(1, zy1 - zy0);

    if (z.kind === 'leg_void') {
      lines.push(
        `<rect x="${zx0.toFixed(2)}" y="${zy0.toFixed(2)}" width="${zw.toFixed(2)}" height="${zh.toFixed(2)}" fill="#ffffff" stroke="#94a3b8" stroke-dasharray="4,3" />`,
      );
      // Faldón trasero en mitad superior del hueco
      const fhPx = zh * 0.42;
      lines.push(
        `<rect x="${zx0.toFixed(2)}" y="${zy0.toFixed(2)}" width="${zw.toFixed(2)}" height="${fhPx.toFixed(2)}" fill="#f1f5f9" stroke="#64748b" stroke-width="1" />`,
      );
      lines.push(
        `<text x="${(zx0 + zw / 2).toFixed(1)}" y="${(zy0 + zh * 0.72).toFixed(1)}" text-anchor="middle" font-family="Consolas, monospace" font-size="9" fill="#64748b">HUECO PIERNAS</text>`,
      );
    } else if (z.kind === 'open') {
      lines.push(
        `<rect x="${zx0.toFixed(2)}" y="${zy0.toFixed(2)}" width="${zw.toFixed(2)}" height="${zh.toFixed(2)}" fill="#f1f5f9" stroke="#cbd5e1" stroke-width="0.8" />`,
      );
      if (z.label && zw > 34 && zh > 24) {
        lines.push(
          `<text x="${(zx0 + zw / 2).toFixed(1)}" y="${(zy0 + zh / 2 + 3).toFixed(1)}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="9" fill="#64748b">${escapeXml(z.label)}</text>`,
        );
      }
    } else if (z.kind === 'door_left' || z.kind === 'door_right' || z.kind === 'door_glass') {
      const fillCol = z.kind === 'door_glass' ? '#e0f2fe' : '#fef9c3';
      lines.push(
        `<rect x="${(zx0 + 2).toFixed(2)}" y="${(zy0 + 2).toFixed(2)}" width="${Math.max(1, zw - 4).toFixed(2)}" height="${Math.max(1, zh - 4).toFixed(2)}" fill="${fillCol}" stroke="#0284c7" stroke-width="1.3" />`,
      );
      if (z.kind === 'door_glass' && zw > 18 && zh > 18) {
        // Marco interior de vidrio + rayas diagonales
        const ins = Math.max(5, Math.min(12, zw * 0.16));
        lines.push(
          `<rect x="${(zx0 + ins).toFixed(2)}" y="${(zy0 + ins).toFixed(2)}" width="${Math.max(2, zw - 2 * ins).toFixed(2)}" height="${Math.max(2, zh - 2 * ins).toFixed(2)}" fill="#bae6fd" stroke="#0369a1" stroke-width="0.9" />`,
        );
        lines.push(
          `<line x1="${(zx0 + ins + 4).toFixed(1)}" y1="${(zy0 + ins + 14).toFixed(1)}" x2="${(zx0 + ins + 14).toFixed(1)}" y2="${(zy0 + ins + 4).toFixed(1)}" stroke="#0284c7" stroke-width="1" />`,
        );
      }
      // Triángulo punteado de apertura hacia bisagras
      const hingeX = z.kind === 'door_right' ? zx1 - 2 : zx0 + 2;
      const handleX = z.kind === 'door_right' ? zx0 + 2 : zx1 - 2;
      const midY = zy0 + zh / 2;
      lines.push(
        `<polyline points="${hingeX.toFixed(1)},${(zy0 + 2).toFixed(1)} ${handleX.toFixed(1)},${midY.toFixed(1)} ${hingeX.toFixed(1)},${(zy1 - 2).toFixed(1)}" fill="none" stroke="#0369a1" stroke-width="0.8" stroke-dasharray="4,3" />`,
      );
      // Símbolo de tirador
      const tx = z.kind === 'door_right' ? zx0 + Math.min(10, zw * 0.2) : zx1 - Math.min(10, zw * 0.2);
      lines.push(
        `<line x1="${tx.toFixed(1)}" y1="${(midY - 8).toFixed(1)}" x2="${tx.toFixed(1)}" y2="${(midY + 8).toFixed(1)}" stroke="#0f172a" stroke-width="2.2" stroke-linecap="round" />`,
      );
      if (zw > 34 && zh > 24) {
        lines.push(
          `<text x="${(zx0 + zw / 2).toFixed(1)}" y="${(zy1 - 8).toFixed(1)}" text-anchor="middle" font-family="Consolas, monospace" font-size="8.5" fill="#0f2b4c">${escapeXml(z.label ?? 'Puerta')}</text>`,
        );
      }
    } else if (z.kind === 'door_double') {
      const midX = zx0 + zw / 2;
      for (const [lx0, lx1, isLeft] of [
        [zx0 + 2, midX - 1, true],
        [midX + 1, zx1 - 2, false],
      ] as const) {
        const lw = Math.max(1, lx1 - lx0);
        const midY = zy0 + zh / 2;
        lines.push(
          `<rect x="${lx0.toFixed(2)}" y="${(zy0 + 2).toFixed(2)}" width="${lw.toFixed(2)}" height="${Math.max(1, zh - 4).toFixed(2)}" fill="#fef9c3" stroke="#0284c7" stroke-width="1.2" />`,
        );
        const hx = isLeft ? lx0 : lx1;
        const ox = isLeft ? lx1 : lx0;
        lines.push(
          `<polyline points="${hx.toFixed(1)},${(zy0 + 2).toFixed(1)} ${ox.toFixed(1)},${midY.toFixed(1)} ${hx.toFixed(1)},${(zy1 - 2).toFixed(1)}" fill="none" stroke="#0369a1" stroke-width="0.7" stroke-dasharray="3,3" />`,
        );
        const tx = isLeft ? lx1 - 5 : lx0 + 5;
        lines.push(
          `<line x1="${tx.toFixed(1)}" y1="${(midY - 7).toFixed(1)}" x2="${tx.toFixed(1)}" y2="${(midY + 7).toFixed(1)}" stroke="#0f172a" stroke-width="2" stroke-linecap="round" />`,
        );
      }
    } else if (z.kind === 'drawers') {
      const n = Math.max(1, Math.round(z.drawerCount ?? 3));
      const dh = zh / n;
      for (let k = 0; k < n; k++) {
        const dy = zy0 + k * dh;
        lines.push(
          `<rect x="${(zx0 + 2).toFixed(2)}" y="${(dy + 2).toFixed(2)}" width="${Math.max(1, zw - 4).toFixed(2)}" height="${Math.max(1, dh - 4).toFixed(2)}" fill="#ffedd5" stroke="#c2410c" stroke-width="1.2" />`,
        );
        // Tirador horizontal centrado
        const cx = zx0 + zw / 2;
        const cy = dy + dh / 2;
        const hw = Math.min(18, zw * 0.28);
        lines.push(
          `<line x1="${(cx - hw / 2).toFixed(1)}" y1="${cy.toFixed(1)}" x2="${(cx + hw / 2).toFixed(1)}" y2="${cy.toFixed(1)}" stroke="#0f172a" stroke-width="2.2" stroke-linecap="round" />`,
        );
        if (zw > 42 && dh > 22) {
          lines.push(
            `<text x="${cx.toFixed(1)}" y="${(dy + dh - 5).toFixed(1)}" text-anchor="middle" font-family="Consolas, monospace" font-size="8" fill="#9a3412">Cajón ${k + 1} (5 pzas)</text>`,
          );
        }
      }
    }
  }

  // Tableros estructurales de carcasa (espesor real 18 mm resaltado)
  lines.push(`<rect x="${frontX.toFixed(2)}" y="${frontY.toFixed(2)}" width="${fw.toFixed(2)}" height="${ep.toFixed(2)}" fill="#cbd5e1" stroke="#0f172a" stroke-width="1" />`); // Cubierta
  if (!zones.some((z) => z.kind === 'leg_void' && z.vStart <= 1e-3)) {
    lines.push(`<rect x="${frontX.toFixed(2)}" y="${(frontY + fh - ep).toFixed(2)}" width="${fw.toFixed(2)}" height="${ep.toFixed(2)}" fill="#cbd5e1" stroke="#0f172a" stroke-width="1" />`); // Base
  }
  lines.push(`<rect x="${frontX.toFixed(2)}" y="${frontY.toFixed(2)}" width="${ep.toFixed(2)}" height="${fh.toFixed(2)}" fill="#cbd5e1" stroke="#0f172a" stroke-width="1" />`); // Lateral Izq
  lines.push(`<rect x="${(frontX + fw - ep).toFixed(2)}" y="${frontY.toFixed(2)}" width="${ep.toFixed(2)}" height="${fh.toFixed(2)}" fill="#cbd5e1" stroke="#0f172a" stroke-width="1" />`); // Lateral Der

  // Divisores verticales estructurales
  for (const d of topology.vDividers) {
    const dx = mapU(d.position) - ep / 2;
    const dy0 = mapV(d.end);
    const dy1 = mapV(d.start);
    lines.push(
      `<rect x="${dx.toFixed(2)}" y="${dy0.toFixed(2)}" width="${ep.toFixed(2)}" height="${Math.max(1, dy1 - dy0).toFixed(2)}" fill="#94a3b8" stroke="#0f172a" stroke-width="0.9" />`,
    );
  }

  // Repisas estructurales (equidistantes o personalizadas)
  const shelfLines: Array<{ yPx: number; x0Px: number; x1Px: number }> = [];
  if (topology.shelfMode === 'equidistant') {
    for (const an of despiece.shelfProgression.terms) {
      const cyMm = an + e / 2;
      shelfLines.push({
        yPx: frontY + fh - cyMm * sc - ep / 2,
        x0Px: frontX + ep,
        x1Px: frontX + fw - ep,
      });
    }
  } else {
    for (const s of topology.hShelves) {
      shelfLines.push({
        yPx: mapV(s.position) - ep / 2,
        x0Px: mapU(s.start),
        x1Px: mapU(s.end),
      });
    }
  }
  for (const sl of shelfLines) {
    lines.push(
      `<rect x="${sl.x0Px.toFixed(2)}" y="${sl.yPx.toFixed(2)}" width="${Math.max(1, sl.x1Px - sl.x0Px).toFixed(2)}" height="${ep.toFixed(2)}" fill="#94a3b8" stroke="#0f172a" stroke-width="0.9" />`,
    );
  }

  // Cotas exteriores Alzado Frontal
  const dimTopY = frontY - 12;
  lines.push(`<line x1="${frontX.toFixed(1)}" y1="${dimTopY.toFixed(1)}" x2="${(frontX + fw).toFixed(1)}" y2="${dimTopY.toFixed(1)}" stroke="#0284c7" stroke-width="1.3" />`);
  lines.push(`<text x="${(frontX + fw / 2).toFixed(1)}" y="${(dimTopY - 3).toFixed(1)}" text-anchor="middle" font-family="Consolas, monospace" font-size="10.5" font-weight="700" fill="#0284c7">Ancho X = ${Math.round(xf)} mm</text>`);

  const dimLeftX = frontX - 18;
  lines.push(`<line x1="${dimLeftX.toFixed(1)}" y1="${frontY.toFixed(1)}" x2="${dimLeftX.toFixed(1)}" y2="${(frontY + fh).toFixed(1)}" stroke="#059669" stroke-width="1.3" />`);
  lines.push(
    `<text x="${(dimLeftX - 5).toFixed(1)}" y="${(frontY + fh / 2).toFixed(1)}" text-anchor="middle" transform="rotate(-90 ${(dimLeftX - 5).toFixed(1)} ${(frontY + fh / 2).toFixed(1)})" font-family="Consolas, monospace" font-size="10.5" font-weight="700" fill="#059669">Alto Y = ${Math.round(yf)} mm</text>`,
  );

  // =========================================================================
  // 2. PERFIL LATERAL (PLANO ZY)
  // =========================================================================
  lines.push(
    `<text x="${(sideX + sw / 2).toFixed(1)}" y="${(sideY - 26).toFixed(1)}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="11" font-weight="700" fill="#0f2b4c">PERFIL LATERAL (ZY)</text>`,
  );
  lines.push(
    `<rect x="${sideX.toFixed(2)}" y="${sideY.toFixed(2)}" width="${sw.toFixed(2)}" height="${fh.toFixed(2)}" fill="#f8fafc" stroke="#0f172a" stroke-width="1.8" />`,
  );
  if (topology.hasBackPanel) {
    lines.push(
      `<rect x="${(sideX - 3).toFixed(2)}" y="${sideY.toFixed(2)}" width="3" height="${fh.toFixed(2)}" fill="#b45309" />`,
    );
  }
  if (legH > 0) {
    const legW = Math.max(5, Math.min(10, sw * 0.1));
    lines.push(
      `<rect x="${(sideX + sw * 0.12).toFixed(2)}" y="${(sideY + fh).toFixed(2)}" width="${legW.toFixed(2)}" height="${liftPx.toFixed(2)}" fill="#e2e8f0" stroke="#475569" stroke-dasharray="3,2" />`,
    );
    lines.push(
      `<rect x="${(sideX + sw * 0.88 - legW).toFixed(2)}" y="${(sideY + fh).toFixed(2)}" width="${legW.toFixed(2)}" height="${liftPx.toFixed(2)}" fill="#e2e8f0" stroke="#475569" stroke-dasharray="3,2" />`,
    );
  }
  // Frente sobrepuesto si hay puertas o cajones
  if (zones.some((z) => z.kind !== 'open' && z.kind !== 'leg_void')) {
    lines.push(
      `<rect x="${(sideX + sw + 1).toFixed(2)}" y="${(sideY + 2).toFixed(2)}" width="${ep.toFixed(2)}" height="${(fh - 4).toFixed(2)}" fill="#fef9c3" stroke="#0284c7" stroke-width="1" />`,
    );
  }
  lines.push(`<line x1="${sideX.toFixed(1)}" y1="${dimTopY.toFixed(1)}" x2="${(sideX + sw).toFixed(1)}" y2="${dimTopY.toFixed(1)}" stroke="#7c3aed" stroke-width="1.3" />`);
  lines.push(`<text x="${(sideX + sw / 2).toFixed(1)}" y="${(dimTopY - 3).toFixed(1)}" text-anchor="middle" font-family="Consolas, monospace" font-size="10.5" font-weight="700" fill="#7c3aed">Z = ${Math.round(zf)} mm</text>`);

  // =========================================================================
  // 3. CARTELA TÉCNICA INFERIOR (RESUMEN DESPIECE, PLANCHAS 244×122 Y HERRAJES)
  // =========================================================================
  const doorCount = despiece.matrizDespiece.filter((p) => p.tipo === 'puerta').length;
  const drawerCount = despiece.matrizDespiece.filter((p) => p.tipo === 'frente_cajon').length;
  const melPieces = despiece.matrizDespiece.filter((p) => p.espesor >= 10).length;
  const backPieces = despiece.matrizDespiece.filter((p) => p.espesor < 10).length;
  const hwText =
    despiece.hardwareSummary
      .map((h) => `${h.categoria}: ${h.cantidad}`)
      .join(' · ') || 'Sin herrajes adicionales';
  const planText = opts.cuttingPlan
    ? `Planchas 244×122 cm: ${opts.cuttingPlan.melamineSheetsCount} melamina + ${opts.cuttingPlan.backPanelSheetsCount} fondo 3mm · Uso ${opts.cuttingPlan.usagePercentage.toFixed(1)}%`
    : `Área neta: ${despiece.totalNetAreaM2.toFixed(2)} m² · Tapacanto: ${despiece.totalEdgeBandingMeters.toFixed(1)} m`;

  lines.push(`<rect x="18" y="446" width="${svgW - 36}" height="80" fill="#f8fafc" stroke="#0f2b4c" stroke-width="1.2" rx="4" />`);
  lines.push(
    `<text x="30" y="466" font-family="Consolas, monospace" font-size="11" font-weight="700" fill="#0f2b4c">RESUMEN DE DESPIECE: ${melPieces} piezas melamina (${e} mm) · ${backPieces} piezas fondo 3 mm · ${doorCount} puerta(s) · ${drawerCount} cajón(es) [5 pzas/cajón]</text>`,
  );
  lines.push(
    `<text x="30" y="486" font-family="Consolas, monospace" font-size="10.5" fill="#0369a1">${escapeXml(planText)} · Escala k=(${despiece.scaleFactors.kx.toFixed(2)}, ${despiece.scaleFactors.ky.toFixed(2)}, ${despiece.scaleFactors.kz.toFixed(2)})</text>`,
  );
  lines.push(
    `<text x="30" y="506" font-family="Consolas, monospace" font-size="10" fill="#92400e">HERRAJES (NO MELAMINA): ${escapeXml(hwText)}</text>`,
  );
  lines.push(
    `<text x="${svgW - 30}" y="518" text-anchor="end" font-family="Consolas, monospace" font-size="9" fill="#64748b">Alertas estructurales: ${despiece.alerts.length} · 100% Offline SmartFurniture v3.2</text>`,
  );

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" width="100%">`,
    '  <defs>',
    '    <pattern id="bpGrid" width="20" height="20" patternUnits="userSpaceOnUse">',
    '      <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e2e8f0" stroke-width="0.6" />',
    '    </pattern>',
    '  </defs>',
    ...lines.map((l) => '  ' + l),
    '</svg>',
  ].join('\n');
}
