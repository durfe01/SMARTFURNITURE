/**
 * SMARTFURNITURE — DETECTOR DE ESTRUCTURA DE MELAMINA (v3.0)
 * - Luminancia normalizada flat-field + crominancia normalizada RGBA (distingue madera de sombras).
 * - Sembrado robusto en los 4 bordes exteriores (mediana + MAD resistente a jitter de clic)
 *   o gotero manual de 1 clic (`seedPoint`).
 * - Anclaje unilateral sin brecha consciente de paralaje (0 px de sesgo en caras visibles ~100 mm).
 * - Índice honesto de confianza (`confidence < 0.5` cuando `interiorMatch > 0.5`).
 * - Heurística de sugerencia de patas externas bajo el borde inferior `BL-BR`.
 */
import type { NormalizedSegment, Point2D } from '../../types/contracts';
import { exteriorToInterior } from '../mathEngine';

export interface BandDetectorOptions {
  /** Gotero de 1 clic en coordenadas unitarias exteriores { u: 0..1, v: 0..1 (0=base, 1=cubierta) }. */
  seedPoint?: { u: number; v: number };
  /** Activa anclaje unilateral consciente de paralaje (default true). */
  parallaxAware?: boolean;
  /** Altura normalizada aproximada de la cámara (0..1, default 0.5). */
  horizonV?: number;
}

export interface BandDetectionResult {
  vDividers: NormalizedSegment[];
  hShelves: NormalizedSegment[];
  confidence: number;
  interiorMatch: number;
  refLum: number;
}

export interface LowerGapHintResult {
  possibleExternalLegs: boolean;
  estimatedLegRatio?: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

function mad(values: number[], med: number): number {
  if (values.length === 0) return 0;
  const devs = values.map((v) => Math.abs(v - med));
  return median(devs) * 1.4826;
}

/**
 * Box blur separable O(W·H) mediante sumas de prefijos para normalización flat-field.
 */
function boxBlur2D(src: Float32Array, W: number, H: number, radius: number): Float32Array {
  const r = Math.max(1, Math.floor(radius));
  const tmp = new Float32Array(W * H);
  const dst = new Float32Array(W * H);
  const pref = new Float32Array(Math.max(W, H) + 1);

  // Pasada horizontal
  for (let y = 0; y < H; y++) {
    const rowOff = y * W;
    pref[0] = 0;
    for (let x = 0; x < W; x++) {
      pref[x + 1] = pref[x] + src[rowOff + x];
    }
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(W - 1, x + r);
      tmp[rowOff + x] = (pref[x1 + 1] - pref[x0]) / (x1 - x0 + 1);
    }
  }

  // Pasada vertical
  for (let x = 0; x < W; x++) {
    pref[0] = 0;
    for (let y = 0; y < H; y++) {
      pref[y + 1] = pref[y] + tmp[y * W + x];
    }
    for (let y = 0; y < H; y++) {
      const y0 = Math.max(0, y - r);
      const y1 = Math.min(H - 1, y + r);
      dst[y * W + x] = (pref[y1 + 1] - pref[y0]) / (y1 - y0 + 1);
    }
  }

  return dst;
}

function rangeMean(arr: Float32Array, start: number, end: number): number {
  const s = Math.max(0, Math.floor(start));
  const e = Math.min(arr.length, Math.ceil(end));
  if (e <= s) return 0;
  let sum = 0;
  for (let i = s; i < e; i++) {
    sum += arr[i];
  }
  return sum / (e - s);
}

/**
 * Detecta divisores verticales continuos y repisas horizontales (incluyendo vanos mixtos)
 * sobre una imagen RGBA rectificada del mueble.
 */
export function analyzeRectifiedFurniture(
  rgba: Uint8ClampedArray,
  W: number,
  H: number,
  dimsMm: { x: number; y: number },
  boardThicknessMm: number,
  opts: BandDetectorOptions = {},
): BandDetectionResult {
  const parallaxAware = opts.parallaxAware ?? true;
  const horizonV = opts.horizonV ?? 0.5;
  const nPx = W * H;

  const lum = new Float32Array(nPx);
  const c1 = new Float32Array(nPx);
  const c2 = new Float32Array(nPx);

  for (let i = 0; i < nPx; i++) {
    const p = i * 4;
    const r = rgba[p];
    const g = rgba[p + 1];
    const b = rgba[p + 2];
    lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    const denom = r + g + b + 15;
    c1[i] = (r - g) / denom;
    c2[i] = (b - 0.5 * (r + g)) / denom;
  }

  const blurRadius = Math.max(12, Math.round(W / 8));
  const lumBlur = boxBlur2D(lum, W, H, blurRadius);
  const lumFlat = new Float32Array(nPx);
  for (let i = 0; i < nPx; i++) {
    lumFlat[i] = (lum[i] + 15) / (lumBlur[i] + 15);
  }

  // Ancho esperado de un canto de melamina en píxeles
  const tPx = Math.max(3, Math.round((boardThicknessMm / Math.max(100, dimsMm.x)) * W));
  const tPy = Math.max(3, Math.round((boardThicknessMm / Math.max(100, dimsMm.y)) * H));

  // Muestreo de color/luminancia de carcasa: 4 bordes exteriores o gotero 1 clic
  const sampleLum: number[] = [];
  const sampleFlat: number[] = [];
  const sampleC1: number[] = [];
  const sampleC2: number[] = [];

  const pushPixel = (x: number, y: number): void => {
    const cx = Math.max(0, Math.min(W - 1, Math.round(x)));
    const cy = Math.max(0, Math.min(H - 1, Math.round(y)));
    const idx = cy * W + cx;
    sampleLum.push(lum[idx]);
    sampleFlat.push(lumFlat[idx]);
    sampleC1.push(c1[idx]);
    sampleC2.push(c2[idx]);
  };

  if (opts.seedPoint) {
    const sx = Math.round(opts.seedPoint.u * (W - 1));
    const sy = Math.round((1 - opts.seedPoint.v) * (H - 1));
    const r = Math.max(2, Math.floor(Math.min(tPx, tPy) / 2));
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        pushPixel(sx + dx, sy + dy);
      }
    }
  } else {
    // Muestrear los 4 bordes exteriores (submuestreo uniforme para velocidad y balance equitativo)
    const bx = Math.max(2, Math.floor(tPx * 0.8));
    const by = Math.max(2, Math.floor(tPy * 0.8));
    const stepY = Math.max(1, Math.floor(H / 90));
    const stepX = Math.max(1, Math.floor(W / 90));

    // Borde izquierdo y derecho
    for (let y = by; y < H - by; y += stepY) {
      for (let dx = 1; dx < bx; dx++) {
        pushPixel(dx, y);
        pushPixel(W - 1 - dx, y);
      }
    }
    // Borde superior e inferior
    for (let x = bx; x < W - bx; x += stepX) {
      for (let dy = 1; dy < by; dy++) {
        pushPixel(x, dy);
        pushPixel(x, H - 1 - dy);
      }
    }
  }

  const refLum = median(sampleLum);
  const refFlat = median(sampleFlat);
  const refC1 = median(sampleC1);
  const refC2 = median(sampleC2);

  const sigmaLum = Math.max(22, mad(sampleLum, refLum) * 2.5);
  const sigmaFlat = Math.max(0.11, mad(sampleFlat, refFlat) * 2.5);
  const sigmaC1 = Math.max(0.032, mad(sampleC1, refC1) * 2.5);
  const sigmaC2 = Math.max(0.032, mad(sampleC2, refC2) * 2.5);

  // Mapa de similitud [0..1] por píxel (combina luminancia flat-field + crominancia RGBA)
  const matchMap = new Float32Array(nPx);
  let interiorHits = 0;
  let interiorCount = 0;
  const marginX = Math.max(tPx + 2, Math.round(W * 0.03));
  const marginY = Math.max(tPy + 2, Math.round(H * 0.03));

  for (let y = 0; y < H; y++) {
    const insideY = y >= marginY && y < H - marginY;
    const rowOff = y * W;
    for (let x = 0; x < W; x++) {
      const idx = rowOff + x;
      const dLum = Math.abs(lum[idx] - refLum) / sigmaLum;
      const dFlat = Math.abs(lumFlat[idx] - refFlat) / sigmaFlat;
      const dLumEff = Math.min(dLum, dFlat * 1.05);
      const dChroma = Math.hypot((c1[idx] - refC1) / sigmaC1, (c2[idx] - refC2) / sigmaC2);
      const dist = Math.hypot(0.62 * dLumEff, 1.15 * dChroma);
      const m = Math.exp(-0.5 * dist * dist);
      matchMap[idx] = m;

      if (insideY && x >= marginX && x < W - marginX) {
        interiorCount++;
        if (m > 0.55) {
          interiorHits++;
        }
      }
    }
  }

  const interiorMatch = interiorCount > 0 ? interiorHits / interiorCount : 1;
  // Confianza honesta: si >50% del interior parece igual a la carcasa (ej. blanco sobre blanco), baja confianza
  const rawConf = Math.max(0, Math.min(1, 1 - interiorMatch * 1.05));
  const confidence = interiorMatch > 0.5 ? Math.min(0.45, rawConf) : Math.max(0.52, rawConf);

  if (confidence < 0.5) {
    return {
      vDividers: [],
      hShelves: [],
      confidence: Number(confidence.toFixed(3)),
      interiorMatch: Number(interiorMatch.toFixed(3)),
      refLum: Number(refLum.toFixed(1)),
    };
  }

  // =========================================================================
  // 1. DETECCIÓN DE DIVISORES VERTICALES CONTINUOS (con anclaje de paralaje)
  // =========================================================================
  const colProfile = new Float32Array(W);
  const yStartInt = tPy + 2;
  const yEndInt = H - tPy - 2;
  const spanY = Math.max(1, yEndInt - yStartInt);

  for (let x = 0; x < W; x++) {
    let sum = 0;
    for (let y = yStartInt; y < yEndInt; y++) {
      sum += matchMap[y * W + x];
    }
    colProfile[x] = sum / spanY;
  }

  const fwX = Math.max(tPx + 2, Math.round(tPx * 1.6));
  const minDivX = Math.max(tPx + fwX, Math.round(W * 0.08));
  const maxDivX = Math.min(W - tPx - fwX - 1, Math.round(W * 0.92) - tPx);
  const divScores = new Float32Array(W);

  for (let x = minDivX; x <= maxDivX; x++) {
    const bandCov = rangeMean(colProfile, x, x + tPx);
    if (bandCov < 0.42) continue;

    const uCenter = (x + tPx / 2) / W;
    const leftFlank = rangeMean(colProfile, x - fwX, x);
    const rightFlank = rangeMean(colProfile, x + tPx, x + tPx + fwX);

    let score: number;
    if (!parallaxAware || Math.abs(uCenter - 0.5) < 0.06) {
      score = bandCov - 0.5 * (leftFlank + rightFlank);
    } else if (uCenter < 0.5) {
      // A la izquierda del centro: cara lateral visible hacia la derecha -> anclar contra flanco izquierdo
      score = bandCov - leftFlank;
    } else {
      // A la derecha del centro: cara lateral visible hacia la izquierda -> anclar contra flanco derecho
      score = bandCov - rightFlank;
    }

    if (score > 0.24) {
      divScores[x] = score;
    }
  }

  // Supresión de no-máximos para divisores
  const nmsRadX = Math.max(tPx * 3, Math.round(W * 0.07));
  const divCandidates: Array<{ x: number; score: number }> = [];
  for (let x = minDivX; x <= maxDivX; x++) {
    const s = divScores[x];
    if (s <= 0) continue;
    let isPeak = true;
    for (let dx = -nmsRadX; dx <= nmsRadX; dx++) {
      if (dx === 0) continue;
      const nx = x + dx;
      if (nx >= minDivX && nx <= maxDivX && divScores[nx] > s) {
        isPeak = false;
        break;
      }
    }
    if (isPeak) {
      // Refinamiento subpíxel ligero sobre la vecindad inmediata (±1 px)
      const sL = divScores[x - 1] ?? 0;
      const sR = divScores[x + 1] ?? 0;
      const denom = sL - 2 * s + sR;
      const subShift = Math.abs(denom) > 1e-6 ? Math.max(-0.5, Math.min(0.5, 0.5 * (sL - sR) / denom)) : 0;
      divCandidates.push({ x: x + subShift, score: s });
    }
  }

  divCandidates.sort((a, b) => a.x - b.x);
  const vDividers: NormalizedSegment[] = divCandidates.map((cand, idx) => {
    const uExt = (cand.x + tPx / 2) / W;
    const uInt = exteriorToInterior(uExt, boardThicknessMm, dimsMm.x);
    return {
      id: `auto_div_${idx + 1}`,
      position: Number(uInt.toFixed(4)),
      start: 0,
      end: 1,
    };
  });

  // =========================================================================
  // 2. DETECCIÓN DE REPISAS HORIZONTALES VANO POR VANO (anclaje paralaje)
  // =========================================================================
  // Construir límites de vanos en píxeles (y en u interior)
  const bayPxBounds: Array<{ x0: number; x1: number; uStart: number; uEnd: number }> = [];
  const divPxPositions = divCandidates.map((c) => c.x + tPx / 2);
  const divIntPositions = vDividers.map((d) => d.position);

  const pxStops = [tPx, ...divPxPositions, W - tPx];
  const uStops = [0, ...divIntPositions, 1];
  const bayPad = Math.max(tPx + 2, Math.round(tPx * 1.4));

  for (let b = 0; b < pxStops.length - 1; b++) {
    const bx0 = Math.round(pxStops[b] + (b === 0 ? 3 : bayPad));
    const bx1 = Math.round(pxStops[b + 1] - (b === pxStops.length - 2 ? 3 : bayPad));
    if (bx1 - bx0 >= Math.max(12, tPx * 2)) {
      bayPxBounds.push({
        x0: bx0,
        x1: bx1,
        uStart: uStops[b],
        uEnd: uStops[b + 1],
      });
    }
  }

  const fhY = Math.max(tPy + 2, Math.round(tPy * 1.6));
  const minShY = Math.max(tPy + fhY, Math.round(H * 0.06));
  const maxShY = Math.min(H - tPy - fhY - 1, Math.round(H * 0.94) - tPy);
  const nmsRadY = Math.max(tPy * 3, Math.round(H * 0.06));

  const rawShelves: Array<{ vInt: number; uStart: number; uEnd: number }> = [];

  for (const bay of bayPxBounds) {
    const rowProfile = new Float32Array(H);
    const bayW = bay.x1 - bay.x0;
    for (let y = 0; y < H; y++) {
      const rowOff = y * W;
      let sum = 0;
      for (let x = bay.x0; x < bay.x1; x++) {
        sum += matchMap[rowOff + x];
      }
      rowProfile[y] = sum / bayW;
    }

    const rowScores = new Float32Array(H);
    for (let y = minShY; y <= maxShY; y++) {
      const bandCov = rangeMean(rowProfile, y, y + tPy);
      if (bandCov < 0.36) continue;

      const vCenter = 1 - (y + tPy / 2) / H;
      const aboveFlank = rangeMean(rowProfile, y - fhY, y);
      const belowFlank = rangeMean(rowProfile, y + tPy, y + tPy + fhY);

      let score: number;
      if (!parallaxAware || Math.abs(vCenter - horizonV) < 0.04) {
        score = bandCov - 0.5 * (aboveFlank + belowFlank);
      } else if (vCenter < horizonV) {
        // Bajo el horizonte: cara superior expuesta arriba -> flanco hueco exacto abajo del canto
        score = bandCov - belowFlank;
      } else {
        // Sobre el horizonte: cara inferior expuesta abajo -> flanco hueco exacto arriba del canto
        score = bandCov - aboveFlank;
      }

      if (score > 0.22) {
        rowScores[y] = score;
      }
    }

    for (let y = minShY; y <= maxShY; y++) {
      const s = rowScores[y];
      if (s <= 0) continue;
      let isPeak = true;
      for (let dy = -nmsRadY; dy <= nmsRadY; dy++) {
        if (dy === 0) continue;
        const ny = y + dy;
        if (ny >= minShY && ny <= maxShY && rowScores[ny] > s) {
          isPeak = false;
          break;
        }
      }
      if (isPeak) {
        const sU = rowScores[y - 1] ?? 0;
        const sD = rowScores[y + 1] ?? 0;
        const denom = sU - 2 * s + sD;
        const subShift = Math.abs(denom) > 1e-6 ? Math.max(-0.5, Math.min(0.5, 0.5 * (sU - sD) / denom)) : 0;
        const vExt = 1 - (y + subShift + tPy / 2) / H;
        const vInt = exteriorToInterior(vExt, boardThicknessMm, dimsMm.y);
        rawShelves.push({
          vInt,
          uStart: bay.uStart,
          uEnd: bay.uEnd,
        });
      }
    }
  }

  // Fusión de repisas colineales en vanos adyacentes
  rawShelves.sort((a, b) => a.vInt - b.vInt || a.uStart - b.uStart);
  const merged: Array<{ vInt: number; uStart: number; uEnd: number; count: number }> = [];
  for (const rs of rawShelves) {
    const matchMerge = merged.find(
      (m) => Math.abs(m.vInt - rs.vInt) <= 0.02 && Math.abs(m.uEnd - rs.uStart) <= 0.02,
    );
    if (matchMerge) {
      matchMerge.vInt = (matchMerge.vInt * matchMerge.count + rs.vInt) / (matchMerge.count + 1);
      matchMerge.uEnd = rs.uEnd;
      matchMerge.count++;
    } else {
      merged.push({ ...rs, count: 1 });
    }
  }

  const hShelves: NormalizedSegment[] = merged.map((m, idx) => ({
    id: `auto_rep_${idx + 1}`,
    position: Number(m.vInt.toFixed(4)),
    start: Number(m.uStart.toFixed(4)),
    end: Number(m.uEnd.toFixed(4)),
  }));

  return {
    vDividers,
    hShelves,
    confidence: Number(confidence.toFixed(3)),
    interiorMatch: Number(interiorMatch.toFixed(3)),
    refLum: Number(refLum.toFixed(1)),
  };
}

/**
 * Analiza opcionalmente la franja de la foto original debajo de la línea base [BL, BR]
 * para detectar si existe espacio abierto con patas delgadas independientes.
 */
export function detectLowerGapHint(
  srcRgba: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  quadCorners: readonly [Point2D, Point2D, Point2D, Point2D],
): LowerGapHintResult {
  const [tl, , br, bl] = quadCorners;
  const bodyH = Math.hypot(bl.x - tl.x, bl.y - tl.y);
  const baseY = Math.round(Math.max(bl.y, br.y));
  const probeH = Math.min(srcH - baseY - 2, Math.round(bodyH * 0.25));

  if (probeH < 12 || bodyH < 40) {
    return { possibleExternalLegs: false };
  }

  const x0 = Math.max(0, Math.round(Math.min(bl.x, br.x)));
  const x1 = Math.min(srcW - 1, Math.round(Math.max(bl.x, br.x)));
  const spanX = x1 - x0;
  if (spanX < 20) {
    return { possibleExternalLegs: false };
  }

  // Comparar varianza de luminancia en la zona de extremos (donde van patas) vs centro abierto
  const yMid = Math.min(srcH - 1, baseY + Math.round(probeH * 0.45));
  const edgeWidth = Math.max(4, Math.round(spanX * 0.14));
  const centerStart = x0 + Math.round(spanX * 0.3);
  const centerEnd = x0 + Math.round(spanX * 0.7);

  const lumAt = (x: number, y: number): number => {
    const i = (y * srcW + x) * 4;
    return 0.299 * srcRgba[i] + 0.587 * srcRgba[i + 1] + 0.114 * srcRgba[i + 2];
  };

  let centerSum = 0;
  let centerN = 0;
  for (let x = centerStart; x < centerEnd; x++) {
    centerSum += lumAt(x, yMid);
    centerN++;
  }
  const centerMean = centerN > 0 ? centerSum / centerN : 0;

  let edgeDiffCount = 0;
  let edgeN = 0;
  for (let x = x0; x < x0 + edgeWidth; x++) {
    if (Math.abs(lumAt(x, yMid) - centerMean) > 28) edgeDiffCount++;
    edgeN++;
  }
  for (let x = x1 - edgeWidth; x < x1; x++) {
    if (Math.abs(lumAt(x, yMid) - centerMean) > 28) edgeDiffCount++;
    edgeN++;
  }

  const edgeContrastRatio = edgeN > 0 ? edgeDiffCount / edgeN : 0;
  const possibleExternalLegs = edgeContrastRatio >= 0.18 && edgeContrastRatio <= 0.85;
  return {
    possibleExternalLegs,
    estimatedLegRatio: possibleExternalLegs ? Number((probeH / bodyH).toFixed(3)) : undefined,
  };
}
