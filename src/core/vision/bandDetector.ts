/**
 * SMARTFURNITURE — MOTOR DE VISIÓN MULTINIVEL Y MULTISEÑAL 100% OFFLINE (v3.3)
 * Soporta todas las familias reales de muebles sin APIs externas ni heurísticas por nombre de archivo:
 *   A) MUEBLE ABIERTO (`open`): cantos de melamina sobre huecos oscuros — luminancia flat-field
 *      + crominancia normalizada RGBA + sembrado 4 bordes/gotero + anclaje unilateral de paralaje.
 *   B) MUEBLE CERRADO (`closed_front` — puertas y cajones) y MIXTO / MULTINIVEL (`mixed` — dos niveles,
 *      alacenas, escritorios con hueco de piernas, muebles bicolores):
 *      - Descomposición jerárquica XY (niveles horizontales globales -> divisores verticales parciales
 *        por nivel -> subdivisiones por celda -> recursión nivel 2 para módulos asimétricos).
 *      - Señal unificada de frontera: valle oscuro adaptativo (inmune a molduras internas mediante
 *        continuidad en extremos) + escalón de luminancia/croma (bicolor / abierto-cerrado) +
 *        tolerancia a inclinación residual (±1.8°) + auto-recorte de zócalo/cenefa.
 *      - Clasificación automática por celda en `FrontZone[]` (`open`, `door_left`, `door_right`,
 *        `door_glass`, `drawers`, `leg_void`) + detector de tiradores metálicos por BFS.
 *   C) BAJA CONFIANZA (`uncertain`, ej. blanco sobre blanco sin ranuras): retorna confidence < 0.5
 *      para activar trazado manual asistido (Principio 07 OFG: Honestidad de Confianza).
 */
import type { FrontZone, NormalizedSegment, Point2D } from '../../types/contracts';
import { exteriorToInterior } from '../mathEngine';

export interface BandDetectorOptions {
  /** Gotero de 1 clic en coordenadas unitarias exteriores { u: 0..1, v: 0..1 (0=base, 1=cubierta) }. */
  seedPoint?: { u: number; v: number };
  /** Activa anclaje unilateral consciente de paralaje (default true). */
  parallaxAware?: boolean;
  /** Altura normalizada aproximada de la cámara (0..1, default 0.5). */
  horizonV?: number;
}

export interface DetectedHandlePoint {
  u: number;
  v: number;
}

export type DetectedFurnitureMode = 'open' | 'closed_front' | 'mixed' | 'uncertain';

export interface BandDetectionResult {
  furnitureMode: DetectedFurnitureMode;
  vDividers: NormalizedSegment[];
  hShelves: NormalizedSegment[];
  detectedHandles: DetectedHandlePoint[];
  /** Zonas frontales clasificadas directamente desde los píxeles de cada celda (v3.3). */
  detectedZones?: FrontZone[];
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

function nms1D(
  arr: Float32Array,
  minI: number,
  maxI: number,
  rad: number,
  thresh: number,
): Array<{ idx: number; val: number }> {
  const peaks: Array<{ idx: number; val: number }> = [];
  for (let i = minI; i <= maxI; i++) {
    const s = arr[i];
    if (s < thresh) continue;
    let isPeak = true;
    for (let d = -rad; d <= rad; d++) {
      if (d === 0) continue;
      const j = i + d;
      if (j >= minI && j <= maxI && arr[j] > s) {
        isPeak = false;
        break;
      }
    }
    if (isPeak) {
      peaks.push({ idx: i, val: s });
    }
  }
  return peaks;
}

// ============================================================================
// MAPAS 2D DE FRONTERA (VALLE OSCURO ADAPTATIVO + ESCALÓN DE LUMINANCIA/CROMA)
// ============================================================================
interface BoundaryMaps {
  vVal: Float32Array;
  vStep: Float32Array;
  vMinD: Float32Array;
  hVal: Float32Array;
  hStep: Float32Array;
  hRegStep: Float32Array;
  hMinD: Float32Array;
  padV: number;
  padH: number;
  regH: number;
}

function computeBoundaryMaps(
  lum: Float32Array,
  c1: Float32Array,
  c2: Float32Array,
  W: number,
  H: number,
): BoundaryMaps {
  const n = W * H;
  const vVal = new Float32Array(n);
  const vStep = new Float32Array(n);
  const vMinD = new Float32Array(n);
  const hVal = new Float32Array(n);
  const hStep = new Float32Array(n);
  const hRegStep = new Float32Array(n);
  const hMinD = new Float32Array(n);

  const padV = Math.max(6, Math.min(12, Math.round(W * 0.016)));
  const padH = Math.max(6, Math.min(14, Math.round(H * 0.02)));
  const regH = Math.max(12, Math.min(28, Math.round(H * 0.04)));
  const nV = padV - 2;
  const nH = padH - 2;
  const nR = regH - 3;

  for (let y = 0; y < H; y++) {
    const ro = y * W;
    for (let x = padV; x < W - padV; x++) {
      const cMin = Math.min(lum[ro + x - 1], lum[ro + x], lum[ro + x + 1]);
      let lL = 0, rL = 0, l1 = 0, r1 = 0, l2 = 0, r2 = 0;
      for (let k = 3; k <= padV; k++) {
        const il = ro + x - k;
        const ir = ro + x + k;
        lL += lum[il]; rL += lum[ir];
        l1 += c1[il]; r1 += c1[ir];
        l2 += c2[il]; r2 += c2[ir];
      }
      const lm = lL / nV;
      const rm = rL / nV;
      const flank = 0.5 * (lm + rm);
      const idx = ro + x;
      // Exigir que AMBOS flancos superen al mínimo central (inmune a biseles de molduras)
      vVal[idx] = Math.max(0, Math.min(lm, rm) - cMin);
      vMinD[idx] = Math.max(6, Math.min(15, flank * 0.05));
      vStep[idx] = Math.abs(lm - rm) + Math.hypot((l1 - r1) / nV, (l2 - r2) / nV) * 260;
    }
  }

  for (let y = padH; y < H - padH; y++) {
    const ro = y * W;
    for (let x = 0; x < W; x++) {
      const cMin = Math.min(lum[(y - 1) * W + x], lum[ro + x], lum[(y + 1) * W + x]);
      let uL = 0, dL = 0, u1 = 0, d1 = 0, u2 = 0, d2 = 0;
      for (let k = 3; k <= padH; k++) {
        const iu = (y - k) * W + x;
        const id = (y + k) * W + x;
        uL += lum[iu]; dL += lum[id];
        u1 += c1[iu]; d1 += c1[id];
        u2 += c2[iu]; d2 += c2[id];
      }
      const um = uL / nH;
      const dm = dL / nH;
      const flank = 0.5 * (um + dm);
      const idx = ro + x;
      hVal[idx] = Math.max(0, Math.min(um, dm) - cMin);
      hMinD[idx] = Math.max(6, Math.min(15, flank * 0.052));
      hStep[idx] = Math.abs(um - dm) + Math.hypot((u1 - d1) / nH, (u2 - d2) / nH) * 260;

      // Escalón regional amplio (insensible a repisas delgadas sobre huecos idénticos)
      if (y >= regH && y < H - regH) {
        let ruL = 0, rdL = 0, ru1 = 0, rd1 = 0, ru2 = 0, rd2 = 0;
        for (let k = 4; k <= regH; k++) {
          const iu = (y - k) * W + x;
          const id = (y + k) * W + x;
          ruL += lum[iu]; rdL += lum[id];
          ru1 += c1[iu]; rd1 += c1[id];
          ru2 += c2[iu]; rd2 += c2[id];
        }
        hRegStep[idx] = Math.abs(ruL - rdL) / nR + Math.hypot((ru1 - rd1) / nR, (ru2 - rd2) / nR) * 260;
      }
    }
  }

  return { vVal, vStep, vMinD, hVal, hStep, hRegStep, hMinD, padV, padH, regH };
}

interface BoxStats {
  meanLum: number;
  lumStd: number;
  meanChroma: number;
  brightWhiteRatio: number;
  darkRatio: number;
  centerLum: number;
  borderLum: number;
}

function computeBoxStats(
  lum: Float32Array,
  c1: Float32Array,
  c2: Float32Array,
  W: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): BoxStats {
  const bw = Math.max(1, x1 - x0);
  const bh = Math.max(1, y1 - y0);
  const ix0 = x0 + Math.round(bw * 0.1);
  const ix1 = x1 - Math.round(bw * 0.1);
  const iy0 = y0 + Math.round(bh * 0.1);
  const iy1 = y1 - Math.round(bh * 0.1);

  const cx0 = x0 + Math.round(bw * 0.28);
  const cx1 = x1 - Math.round(bw * 0.28);
  const cy0 = y0 + Math.round(bh * 0.22);
  const cy1 = y1 - Math.round(bh * 0.22);

  let sumL = 0, sumL2 = 0, sumC = 0;
  let brightW = 0, dark = 0, total = 0;
  let cSum = 0, cCnt = 0, bSum = 0, bCnt = 0;

  for (let y = iy0; y < iy1; y += 2) {
    const ro = y * W;
    const inCY = y >= cy0 && y < cy1;
    for (let x = ix0; x < ix1; x += 2) {
      const idx = ro + x;
      const l = lum[idx];
      const ch = Math.hypot(c1[idx], c2[idx]);
      sumL += l;
      sumL2 += l * l;
      sumC += ch;
      if (l > 235 && ch < 0.035) brightW++;
      if (l < 95) dark++;
      total++;

      if (inCY && x >= cx0 && x < cx1) {
        cSum += l;
        cCnt++;
      } else {
        bSum += l;
        bCnt++;
      }
    }
  }

  if (total === 0) {
    return { meanLum: 128, lumStd: 0, meanChroma: 0, brightWhiteRatio: 0, darkRatio: 0, centerLum: 128, borderLum: 128 };
  }
  const meanLum = sumL / total;
  const variance = Math.max(0, sumL2 / total - meanLum * meanLum);
  return {
    meanLum,
    lumStd: Math.sqrt(variance),
    meanChroma: sumC / total,
    brightWhiteRatio: brightW / total,
    darkRatio: dark / total,
    centerLum: cCnt > 0 ? cSum / cCnt : meanLum,
    borderLum: bCnt > 0 ? bSum / bCnt : meanLum,
  };
}

/**
 * Detecta si una banda tiene una cenefa/ranura uñero superior o un zócalo inferior continuo
 * para recortar la altura activa de las puertas sin afectar molduras internas.
 */
function findBandActiveY(
  maps: BoundaryMaps,
  W: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): { yTop: number; yBot: number } {
  const { hVal, hStep, hMinD } = maps;
  const bh = y1 - y0;
  const bw = x1 - x0;
  const xA0 = x0 + Math.round(bw * 0.08);
  const xA1 = x1 - Math.round(bw * 0.08);
  const span = Math.max(1, xA1 - xA0);

  let yTop = y0 + Math.max(3, Math.round(bh * 0.05));
  let yBot = y1 - Math.max(3, Math.round(bh * 0.05));

  if (bh >= 75) {
    let bestTopY = -1;
    let bestTopSc = 0;
    for (let y = y0 + Math.round(bh * 0.05); y <= y0 + Math.round(bh * 0.18); y++) {
      let hits = 0;
      let mag = 0;
      for (let x = xA0; x < xA1; x++) {
        const i = y * W + x;
        if (hVal[i] > hMinD[i] || hStep[i] > 28) {
          hits++;
          mag += Math.max(hVal[i], hStep[i] * 0.6);
        }
      }
      const r = hits / span;
      if (r >= 0.72 && (mag / span) * r > bestTopSc) {
        bestTopSc = (mag / span) * r;
        bestTopY = y;
      }
    }
    if (bestTopY > 0 && bestTopSc >= 16) {
      yTop = bestTopY + 3;
    }

    let bestBotY = -1;
    let bestBotSc = 0;
    for (let y = y0 + Math.round(bh * 0.78); y <= y0 + Math.round(bh * 0.95); y++) {
      let hits = 0;
      let mag = 0;
      for (let x = xA0; x < xA1; x++) {
        const i = y * W + x;
        if (hVal[i] > hMinD[i] || hStep[i] > 26) {
          hits++;
          mag += Math.max(hVal[i], hStep[i] * 0.6);
        }
      }
      const r = hits / span;
      if (r >= 0.72 && (mag / span) * r > bestBotSc) {
        bestBotSc = (mag / span) * r;
        bestBotY = y;
      }
    }
    if (bestBotY > 0 && bestBotSc >= 14) {
      yBot = bestBotY - 3;
    }
  }

  return { yTop, yBot };
}

function findGlobalHorizontalLevels(
  maps: BoundaryMaps,
  W: number,
  H: number,
): { cuts: Array<{ y: number; v: number; score: number }>; maxRegStepScore: number } {
  const { hVal, hRegStep, hMinD, regH } = maps;
  const x0 = Math.round(W * 0.08);
  const x1 = Math.round(W * 0.92);
  const span = x1 - x0;
  const yMin = Math.max(regH + 2, Math.round(H * 0.15));
  const yMax = Math.min(H - regH - 3, Math.round(H * 0.85));
  if (yMax <= yMin) return { cuts: [], maxRegStepScore: 0 };

  const scoreArr = new Float32Array(H);
  const tilts = [-3, 0, 3];
  let maxRegStepScore = 0;

  const evalRow = (yc: number, dy: number, xa: number, xb: number) => {
    const cnt = Math.max(1, xb - xa);
    const xMid = 0.5 * (xa + xb);
    let valHits = 0;
    let regHits = 0;
    let uniHits = 0;
    let sumMag = 0;
    let sumReg = 0;
    for (let x = xa; x < xb; x++) {
      const y = Math.max(regH, Math.min(H - regH - 1, Math.round(yc + dy * ((x - xMid) / cnt))));
      const i = y * W + x;
      const isV = hVal[i] > Math.max(10, hMinD[i] * 1.15);
      const isR = hRegStep[i] > 32;
      if (isV) valHits++;
      if (isR) regHits++;
      sumReg += hRegStep[i];
      if (isV || isR) {
        uniHits++;
        sumMag += Math.max(hVal[i] * 1.1, hRegStep[i] * 0.55);
      }
    }
    return {
      valRatio: valHits / cnt,
      regRatio: regHits / cnt,
      uniRatio: uniHits / cnt,
      meanMag: sumMag / cnt,
      meanReg: sumReg / cnt,
    };
  };

  for (let y = yMin; y <= yMax; y++) {
    let best = 0;
    for (const dy of tilts) {
      const all = evalRow(y, dy, x0, x1);
      if (all.regRatio >= 0.60) {
        const regSc = all.regRatio * all.meanReg;
        if (regSc > maxRegStepScore) maxRegStepScore = regSc;
      }
      if (all.uniRatio < 0.65) continue;
      const left = evalRow(y, dy, x0, x0 + Math.round(span * 0.2));
      const right = evalRow(y, dy, x1 - Math.round(span * 0.2), x1);
      if (left.uniRatio < 0.48 || right.uniRatio < 0.48) continue;
      if (all.regRatio < 0.55 && all.valRatio < 0.58) continue;
      const sc = all.uniRatio * all.meanMag;
      if (sc > best) best = sc;
    }
    scoreArr[y] = best;
  }

  // Separación mínima entre niveles globales (16% de H) para unificar cubiertas/mesones gruesos
  const rad = Math.max(24, Math.round(H * 0.16));
  const cuts = nms1D(scoreArr, yMin, yMax, rad, 18).map((p) => ({
    y: p.idx,
    v: 1 - p.idx / H,
    score: p.val,
  }));

  return { cuts, maxRegStepScore };
}

function findVerticalCutsInBox(
  lum: Float32Array,
  c1: Float32Array,
  c2: Float32Array,
  maps: BoundaryMaps,
  W: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  allowRailTrim: boolean,
  refLum: number,
): Array<{ x: number; u: number; score: number; hasStrongValley: boolean }> {
  const { vVal, vStep, vMinD, padV } = maps;
  const bw = x1 - x0;
  const bh = y1 - y0;
  if (bw < 65 || bh < 36) return [];

  // Evitar falsos divisores dentro de un hueco libre de piernas blanco sobre mueble de madera/oscuro
  // (jamás descartar un mueble de melamina blanca cuya propia carcasa tiene refLum >= 200)
  const stats = computeBoxStats(lum, c1, c2, W, x0, x1, y0, y1);
  if (refLum < 200 && stats.brightWhiteRatio > 0.76) return [];

  const trimmed = allowRailTrim
    ? findBandActiveY(maps, W, x0, x1, y0, y1)
    : {
        yTop: y0 + Math.max(3, Math.round(bh * 0.05)),
        yBot: y1 - Math.max(3, Math.round(bh * 0.05)),
      };
  const yA0 = trimmed.yTop;
  const yA1 = trimmed.yBot;
  const spanY = yA1 - yA0;
  if (spanY < 28) return [];

  const xMin = Math.max(padV + 2, x0 + Math.max(20, Math.round(bw * 0.12)));
  const xMax = Math.min(W - padV - 3, x1 - Math.max(20, Math.round(bw * 0.12)));
  if (xMax <= xMin) return [];

  const maxTilt = Math.max(2, Math.min(8, Math.round(spanY * 0.038)));
  const tilts = [-maxTilt, -Math.round(maxTilt / 2), 0, Math.round(maxTilt / 2), maxTilt];
  const scoreArr = new Float32Array(W);

  const evalLine = (xc: number, dx: number, ya: number, yb: number) => {
    const cnt = Math.max(1, yb - ya);
    const yMid = 0.5 * (yA0 + yA1);
    let valHits = 0;
    let uniHits = 0;
    let sumMag = 0;
    for (let y = ya; y < yb; y++) {
      const x = Math.max(padV, Math.min(W - padV - 1, Math.round(xc + dx * ((y - yMid) / spanY))));
      const idx = y * W + x;
      const isV = vVal[idx] > vMinD[idx];
      const isS = vStep[idx] > 28;
      if (isV) valHits++;
      if (isV || isS) {
        uniHits++;
        sumMag += Math.max(vVal[idx], vStep[idx] * 0.55);
      }
    }
    return { valRatio: valHits / cnt, uniRatio: uniHits / cnt, meanMag: sumMag / cnt };
  };

  const yAltBot = y1 - Math.round(bh * 0.18);
  const yEnds = allowRailTrim && yA1 > yAltBot + 8 && yAltBot - yA0 >= 32 ? [yA1, yAltBot] : [yA1];

  for (let x = xMin; x <= xMax; x++) {
    let best = 0;
    for (const dx of tilts) {
      for (const yEnd of yEnds) {
        const sp = yEnd - yA0;
        const all = evalLine(x, dx, yA0, yEnd);
        if (all.uniRatio < 0.62) continue;
        const top = evalLine(x, dx, yA0, yA0 + Math.max(5, Math.round(sp * 0.18)));
        if (top.uniRatio < 0.48) continue;
        const bot = evalLine(x, dx, yEnd - Math.max(5, Math.round(sp * 0.18)), yEnd);
        if (bot.uniRatio < 0.48) continue;
        if (all.valRatio < 0.35 && all.meanMag < 20) continue;
        const sc = all.uniRatio * all.meanMag * (yEnd === yA1 ? 1.0 : 0.94);
        if (sc > best) best = sc;
      }
    }
    scoreArr[x] = best;
  }

  const rad = Math.max(20, Math.round(W * 0.105));
  const peaks = nms1D(scoreArr, xMin, xMax, rad, 8.5);
  // Filtrar sombras proyectadas dentro de huecos blancos puros (sin valle oscuro real)
  const filtered: Array<{ x: number; u: number; score: number; hasStrongValley: boolean }> = [];
  for (const p of peaks) {
    let bestValRatio = 0;
    for (const dx of tilts) {
      const ev = evalLine(p.idx, dx, yA0, yA1);
      if (ev.valRatio > bestValRatio) bestValRatio = ev.valRatio;
    }
    if (bestValRatio < 0.22) {
      // Si no hay valle oscuro, verificar que no sea solo una sombra lateral sobre fondo blanco puro (>240)
      let whiteLeft = 0;
      let whiteRight = 0;
      let cnt = 0;
      for (let y = yA0; y < yA1; y += 2) {
        const ro = y * W;
        const lx = Math.max(0, p.idx - 12);
        const rx = Math.min(W - 1, p.idx + 12);
        if (lum[ro + lx] > 240) whiteLeft++;
        if (lum[ro + rx] > 240) whiteRight++;
        cnt++;
      }
      if (cnt > 0 && (whiteLeft / cnt > 0.48 || whiteRight / cnt > 0.48)) {
        // Solo aceptar si el otro lado tiene croma fuerte (ej. puerta madera vs estante blanco), NO sombra gris
        let chromaDiff = 0;
        for (let y = yA0; y < yA1; y += 3) {
          const ro = y * W;
          const lx = Math.max(0, p.idx - 12);
          const rx = Math.min(W - 1, p.idx + 12);
          chromaDiff += Math.hypot(c1[ro + lx] - c1[ro + rx], c2[ro + lx] - c2[ro + rx]);
        }
        const meanChromaDiff = chromaDiff / Math.max(1, Math.ceil((yA1 - yA0) / 3));
        if (meanChromaDiff < 0.045) continue;
      }
    }
    filtered.push({
      x: p.idx,
      u: p.idx / W,
      score: p.val,
      hasStrongValley: bestValRatio >= 0.42,
    });
  }
  return filtered;
}

/**
 * Detector general de unión en T (T-junction) para bandas asimétricas donde un módulo de distinto
 * material/color ocupa la mitad superior o inferior (ej. alacena roble junto a estante blanco abierto).
 */
function findPartialTJunctionVertical(
  maps: BoundaryMaps,
  W: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): Array<{ x: number; u: number; score: number; half: 'top' | 'bot' | 'full'; hasStrongValley: boolean }> {
  const { vStep, vVal, vMinD, padV } = maps;
  const bw = x1 - x0;
  const bh = y1 - y0;
  if (bw < 120 || bh < 80) return [];

  const xMin = Math.max(padV + 2, x0 + Math.round(bw * 0.14));
  const xMax = Math.min(W - padV - 3, x1 - Math.round(bw * 0.16));
  if (xMax <= xMin) return [];

  const yTop0 = y0 + Math.max(3, Math.round(bh * 0.04));
  const yTop1 = y0 + Math.round(bh * 0.46);
  const yBot0 = y0 + Math.round(bh * 0.54);
  const yBot1 = y1 - Math.max(3, Math.round(bh * 0.04));

  const evalHalf = (x: number, ya: number, yb: number) => {
    const cnt = Math.max(1, yb - ya);
    let hits = 0;
    let valHits = 0;
    let mag = 0;
    for (let y = ya; y < yb; y++) {
      const i = y * W + x;
      const isV = vVal[i] > vMinD[i] * 1.2;
      const isS = vStep[i] > 35;
      if (isV) valHits++;
      if (isV || isS) {
        hits++;
        mag += Math.max(vStep[i] * 0.6, vVal[i]);
      }
    }
    return { ratio: hits / cnt, valRatio: valHits / cnt, mean: mag / cnt };
  };

  const scoreArr = new Float32Array(W);
  const metaHalf: Array<'top' | 'bot' | 'full'> = new Array(W).fill('top');
  const metaVal: boolean[] = new Array(W).fill(false);

  for (let x = xMin; x <= xMax; x++) {
    const topH = evalHalf(x, yTop0, yTop1);
    const botH = evalHalf(x, yBot0, yBot1);
    const topSc = topH.ratio >= 0.66 && topH.mean >= 18 ? topH.ratio * topH.mean : 0;
    const botSc = botH.ratio >= 0.66 && botH.mean >= 18 ? botH.ratio * botH.mean : 0;
    if (topSc > 0 && botSc > 0) {
      scoreArr[x] = 0.5 * (topSc + botSc);
      metaHalf[x] = 'full';
      metaVal[x] = topH.valRatio >= 0.4 || botH.valRatio >= 0.4;
    } else if (topSc >= botSc && topSc > 0) {
      scoreArr[x] = topSc;
      metaHalf[x] = 'top';
      metaVal[x] = topH.valRatio >= 0.4;
    } else if (botSc > 0) {
      scoreArr[x] = botSc;
      metaHalf[x] = 'bot';
      metaVal[x] = botH.valRatio >= 0.4;
    }
  }

  const peaks = nms1D(scoreArr, xMin, xMax, Math.max(24, Math.round(W * 0.14)), 14);
  return peaks.map((p) => ({
    x: p.idx,
    u: p.idx / W,
    score: p.val,
    half: metaHalf[p.idx],
    hasStrongValley: metaVal[p.idx],
  }));
}

function findCellHorizontalCuts(
  lum: Float32Array,
  maps: BoundaryMaps,
  W: number,
  H: number,
  tPy: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  allowBrightShelfInDark: boolean,
): Array<{ y: number; v: number; score: number; kind: 'seam_step' | 'bright_shelf' }> {
  const { hVal, hStep, hMinD, padH } = maps;
  const bw = x1 - x0;
  const bh = y1 - y0;
  if (bw < 38 || bh < 56) return [];

  const xA0 = x0 + Math.max(4, Math.round(bw * 0.06));
  const xA1 = x1 - Math.max(4, Math.round(bw * 0.06));
  const yMin = Math.max(padH + 2, y0 + Math.max(16, Math.round(bh * 0.16)));
  const yMax = Math.min(H - padH - 3, y1 - Math.max(16, Math.round(bh * 0.16)));
  if (yMax <= yMin) return [];

  const maxTilt = Math.max(1, Math.min(4, Math.round(bw * 0.015)));
  const tilts = [-maxTilt, 0, maxTilt];
  const scoreArr = new Float32Array(H);

  const evalLine = (yc: number, dy: number, xa: number, xb: number) => {
    const cnt = Math.max(1, xb - xa);
    const xMid = 0.5 * (xa + xb);
    let valHits = 0;
    let uniHits = 0;
    let sumMag = 0;
    for (let x = xa; x < xb; x++) {
      const y = Math.max(padH, Math.min(H - padH - 1, Math.round(yc + dy * ((x - xMid) / cnt))));
      const i = y * W + x;
      const isV = hVal[i] > hMinD[i];
      const isS = hStep[i] > 30;
      if (isV) valHits++;
      if (isV || isS) {
        uniHits++;
        sumMag += Math.max(hVal[i], hStep[i] * 0.55);
      }
    }
    return { valRatio: valHits / cnt, uniRatio: uniHits / cnt, meanMag: sumMag / cnt };
  };

  for (let y = yMin; y <= yMax; y++) {
    let best = 0;
    for (const dy of tilts) {
      const all = evalLine(y, dy, xA0, xA1);
      if (all.uniRatio < 0.66) continue;
      const sp = xA1 - xA0;
      const left = evalLine(y, dy, xA0, xA0 + Math.max(6, Math.round(sp * 0.13)));
      if (left.uniRatio < 0.62) continue;
      const right = evalLine(y, dy, xA1 - Math.max(6, Math.round(sp * 0.13)), xA1);
      if (right.uniRatio < 0.62) continue;
      if (all.valRatio < 0.35 && all.meanMag < 28) continue;
      const sc = all.uniRatio * all.meanMag;
      if (sc > best) best = sc;
    }
    scoreArr[y] = best;
  }

  const rad = Math.max(18, Math.round(bh * 0.16));
  const cuts: Array<{ y: number; v: number; score: number; kind: 'seam_step' | 'bright_shelf' }> = nms1D(
    scoreArr,
    yMin,
    yMax,
    rad,
    11,
  ).map((p) => ({
    y: p.idx,
    v: 1 - p.idx / H,
    score: p.val,
    kind: 'seam_step',
  }));

  // Detector complementario de repisas visibles dentro de celdas oscuras/vitrina (ej. vidrio con repisas)
  if (allowBrightShelfInDark && cuts.length === 0 && bh >= 140 && bw >= W * 0.28) {
    const ix0 = x0 + Math.round(bw * 0.22);
    const ix1 = x1 - Math.round(bw * 0.22);
    const iw = Math.max(1, ix1 - ix0);
    const rowMean = new Float32Array(H);
    for (let y = y0; y < y1; y++) {
      let s = 0;
      const ro = y * W;
      for (let x = ix0; x < ix1; x++) s += lum[ro + x];
      rowMean[y] = s / iw;
    }
    const bandH = Math.max(3, Math.min(10, tPy));
    const flankH = Math.max(8, Math.round(bandH * 2));
    const shelfScore = new Float32Array(H);
    const syMin = Math.max(yMin, y0 + flankH + 2);
    const syMax = Math.min(yMax, y1 - flankH - bandH - 2);
    for (let y = syMin; y <= syMax; y++) {
      const cMean = rangeMean(rowMean, y, y + bandH);
      const uMean = rangeMean(rowMean, y - flankH, y - 1);
      const dMean = rangeMean(rowMean, y + bandH + 1, y + bandH + flankH);
      const diff = cMean - Math.max(uMean, dMean);
      if (diff >= 12 && uMean < 115 && dMean < 115) {
        shelfScore[y] = diff;
      }
    }
    const bPeaks = nms1D(shelfScore, syMin, syMax, Math.max(20, Math.round(bh * 0.16)), 12);
    for (const bp of bPeaks) {
      const cy = Math.round(bp.idx + bandH / 2);
      cuts.push({
        y: cy,
        v: 1 - cy / H,
        score: bp.val * 1.4,
        kind: 'bright_shelf',
      });
    }
  }

  return cuts;
}

/**
 * Detector de tiradores metálicos / manillas oscuras por componentes conexas (BFS).
 */
function detectHandlesOnFront(
  lum: Float32Array,
  W: number,
  H: number,
  refLum: number,
  vLinesPx: ReadonlyArray<{ x: number; y0: number; y1: number }>,
  hLinesPx: ReadonlyArray<{ y: number; x0: number; x1: number }>,
): DetectedHandlePoint[] {
  const detectedHandles: DetectedHandlePoint[] = [];
  if (vLinesPx.length === 0 && hLinesPx.length === 0) return detectedHandles;

  const mask = new Uint8Array(W * H);
  const darkThresh = Math.min(refLum * 0.42, refLum - 62);
  const coreMetalThresh = Math.min(refLum * 0.32, refLum - 78);
  const borderX = Math.max(10, Math.round(W * 0.025));
  const borderY = Math.max(10, Math.round(H * 0.055));

  for (let y = borderY; y < H - borderY; y++) {
    const rowOff = y * W;
    for (let x = borderX; x < W - borderX; x++) {
      if (lum[rowOff + x] < darkThresh) {
        mask[rowOff + x] = 1;
      }
    }
  }

  const seamClear = 7;
  for (const vp of vLinesPx) {
    const x0 = Math.max(0, vp.x - seamClear);
    const x1 = Math.min(W - 1, vp.x + seamClear);
    const y0 = Math.max(0, vp.y0);
    const y1 = Math.min(H - 1, vp.y1);
    for (let y = y0; y <= y1; y++) {
      const rowOff = y * W;
      for (let x = x0; x <= x1; x++) mask[rowOff + x] = 0;
    }
  }
  for (const hr of hLinesPx) {
    const y0 = Math.max(0, hr.y - seamClear);
    const y1 = Math.min(H - 1, hr.y + seamClear);
    const x0 = Math.max(0, hr.x0);
    const x1 = Math.min(W - 1, hr.x1);
    for (let y = y0; y <= y1; y++) {
      const rowOff = y * W;
      for (let x = x0; x <= x1; x++) mask[rowOff + x] = 0;
    }
  }

  const visited = new Uint8Array(W * H);
  const rawBlobs: Array<{ cx: number; cy: number; area: number }> = [];
  const queueX: number[] = [];
  const queueY: number[] = [];

  for (let y = borderY; y < H - borderY; y++) {
    for (let x = borderX; x < W - borderX; x++) {
      const idx0 = y * W + x;
      if (mask[idx0] === 0 || visited[idx0] === 1) continue;

      visited[idx0] = 1;
      queueX.length = 0;
      queueY.length = 0;
      queueX.push(x);
      queueY.push(y);

      let head = 0;
      let minX = x, maxX = x, minY = y, maxY = y;
      let sumX = 0, sumY = 0;
      let deepCoreCount = 0;

      while (head < queueX.length) {
        const cx = queueX[head];
        const cy = queueY[head];
        head++;
        sumX += cx;
        sumY += cy;
        if (lum[cy * W + cx] < coreMetalThresh) deepCoreCount++;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        for (let dy = -4; dy <= 4; dy++) {
          const ny = cy + dy;
          if (ny < borderY || ny >= H - borderY) continue;
          const nRow = ny * W;
          for (let dx = -4; dx <= 4; dx++) {
            const nx = cx + dx;
            if (nx < borderX || nx >= W - borderX) continue;
            const nIdx = nRow + nx;
            if (mask[nIdx] === 1 && visited[nIdx] === 0) {
              visited[nIdx] = 1;
              queueX.push(nx);
              queueY.push(ny);
            }
          }
        }
      }

      const area = head;
      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      if (area >= 28 && deepCoreCount >= 12 && area <= W * H * 0.018 && bw <= W * 0.16 && bh <= H * 0.35) {
        rawBlobs.push({ cx: sumX / area, cy: sumY / area, area });
      }
    }
  }

  const mergeDistX = Math.max(12, W * 0.022);
  const mergeDistY = Math.max(24, H * 0.15);
  const used = new Array<boolean>(rawBlobs.length).fill(false);

  for (let i = 0; i < rawBlobs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    let sx = rawBlobs[i].cx * rawBlobs[i].area;
    let sy = rawBlobs[i].cy * rawBlobs[i].area;
    let totalA = rawBlobs[i].area;

    for (let j = i + 1; j < rawBlobs.length; j++) {
      if (used[j]) continue;
      const dx = Math.abs(rawBlobs[j].cx - sx / totalA);
      const dy = Math.abs(rawBlobs[j].cy - sy / totalA);
      if (dx <= mergeDistX && dy <= mergeDistY) {
        used[j] = true;
        sx += rawBlobs[j].cx * rawBlobs[j].area;
        sy += rawBlobs[j].cy * rawBlobs[j].area;
        totalA += rawBlobs[j].area;
      }
    }

    if (totalA >= 42) {
      detectedHandles.push({
        u: Number((sx / totalA / W).toFixed(4)),
        v: Number((1 - sy / totalA / H).toFixed(4)),
      });
    }
  }

  return detectedHandles;
}

interface RawSpanSeg {
  pos: number;
  start: number;
  end: number;
  score: number;
}

function mergeSpanSegments(
  segs: readonly RawSpanSeg[],
  posTol: number,
  touchTol: number,
): RawSpanSeg[] {
  const sorted = [...segs].sort((a, b) => a.pos - b.pos || a.start - b.start);
  const out: Array<RawSpanSeg & { count: number }> = [];
  for (const s of sorted) {
    const ex = out.find(
      (m) =>
        Math.abs(m.pos - s.pos) <= posTol &&
        s.start <= m.end + touchTol &&
        s.end >= m.start - touchTol,
    );
    if (ex) {
      ex.pos = (ex.pos * ex.count + s.pos) / (ex.count + 1);
      ex.start = Math.min(ex.start, s.start);
      ex.end = Math.max(ex.end, s.end);
      ex.score = Math.max(ex.score, s.score);
      ex.count++;
    } else {
      out.push({ ...s, count: 1 });
    }
  }
  return out.map(({ pos, start, end, score }) => ({ pos, start, end, score }));
}

interface LeafCellPx {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  localHCuts: Array<{ y: number; v: number; kind: 'seam_step' | 'bright_shelf' }>;
  isFullWidthMiddleBand: boolean;
}

/**
 * Motor jerárquico multinivel (v3.3) para muebles cerrados, mixtos, escritorios y cocinas 2 niveles.
 */
function detectHierarchicalStructure(
  lum: Float32Array,
  c1: Float32Array,
  c2: Float32Array,
  W: number,
  H: number,
  dimsMm: { x: number; y: number },
  boardThicknessMm: number,
  tPy: number,
  refLum: number,
): {
  vDividers: NormalizedSegment[];
  hShelves: NormalizedSegment[];
  detectedHandles: DetectedHandlePoint[];
  detectedZones: FrontZone[];
  seamStrength: number;
  maxRegStepScore: number;
  verticalValleyCount: number;
} {
  const maps = computeBoundaryMaps(lum, c1, c2, W, H);
  const { cuts: globalH, maxRegStepScore } = findGlobalHorizontalLevels(maps, W, H);
  const isMultiLevel = globalH.length > 0;
  let verticalValleyCount = 0;

  const yStops = [0, ...globalH.map((h) => h.y).sort((a, b) => a - b), H];
  const rawV: RawSpanSeg[] = [];
  const rawH: RawSpanSeg[] = globalH.map((h) => ({
    pos: h.v,
    start: 0,
    end: 1,
    score: h.score,
  }));

  const vLinesPx: Array<{ x: number; y0: number; y1: number }> = [];
  const hLinesPx: Array<{ y: number; x0: number; x1: number }> = globalH.map((h) => ({
    y: h.y,
    x0: 0,
    x1: W,
  }));

  const leafCells: LeafCellPx[] = [];
  const bandVCutsList: Array<Array<{ x: number; u: number; score: number; half: 'top' | 'bot' | 'full'; hasStrongValley: boolean }>> = [];
  const bandIsOpenMid: boolean[] = [];

  for (let b = 0; b < yStops.length - 1; b++) {
    const by0 = yStops[b];
    const by1 = yStops[b + 1];
    const isIntermediateBand = isMultiLevel && b > 0 && b < yStops.length - 2;
    const fullVCuts = findVerticalCutsInBox(lum, c1, c2, maps, W, 0, W, by0, by1, isMultiLevel, refLum);
    let vCuts: Array<{ x: number; u: number; score: number; half: 'top' | 'bot' | 'full'; hasStrongValley: boolean }> =
      fullVCuts.map((v) => ({ ...v, half: 'full' as const }));
    if (vCuts.length === 0 && isMultiLevel && by1 - by0 >= H * 0.25) {
      vCuts = findPartialTJunctionVertical(maps, W, 0, W, by0, by1);
    }

    // Si es una banda intermedia (entre módulo aéreo superior y mesón inferior) y tiene un único
    // corte vertical lateral (u > 0.68 o u < 0.26) donde el vano central es fondo blanco puro pasante (>55%),
    // ese corte es la pared lateral vista en perspectiva 3/4 a través del nicho abierto -> eliminarlo.
    let isPassThroughOpen = false;
    if (isIntermediateBand && vCuts.length === 1 && (vCuts[0].u > 0.68 || vCuts[0].u < 0.26)) {
      const cx0 = vCuts[0].u > 0.5 ? Math.round(W * 0.12) : vCuts[0].x + 8;
      const cx1 = vCuts[0].u > 0.5 ? vCuts[0].x - 8 : Math.round(W * 0.88);
      if (cx1 > cx0 + 20) {
        const cavStats = computeBoxStats(lum, c1, c2, W, cx0, cx1, by0, by1);
        if (cavStats.brightWhiteRatio > 0.52) {
          vCuts = [];
          isPassThroughOpen = true;
        }
      }
    }
    bandVCutsList.push(vCuts);
    bandIsOpenMid.push(isPassThroughOpen);
  }

  // Propagación de columna en mueble blanco multinivel: si la alacena superior (b=0) tiene 2 divisores (3 puertas)
  // y el mueble bajo (b=yStops.length-2) solo detectó 1 divisor (ej. el derecho en u~0.67) perdiendo el izquierdo
  // por bajo contraste entre puertas blancas, recuperar el divisor alineado con la columna superior.
  if (yStops.length >= 3 && refLum >= 195) {
    const topCuts = bandVCutsList[0];
    const botIdx = yStops.length - 2;
    const botCuts = bandVCutsList[botIdx];
    if (topCuts.length === 2 && botCuts.length === 1) {
      const missingTop =
        Math.abs(botCuts[0].u - topCuts[1].u) < Math.abs(botCuts[0].u - topCuts[0].u)
          ? topCuts[0]
          : topCuts[1];
      if (Math.abs(botCuts[0].u - missingTop.u) >= 0.18) {
        botCuts.push({
          x: missingTop.x,
          u: missingTop.u,
          score: 12,
          half: 'full',
          hasStrongValley: true,
        });
        botCuts.sort((a, b) => a.x - b.x);
      }
    }
  }

  for (let b = 0; b < yStops.length - 1; b++) {
    const by0 = yStops[b];
    const by1 = yStops[b + 1];
    const v0Band = 1 - by1 / H;
    const v1Band = 1 - by0 / H;
    const vCuts = bandVCutsList[b];
    const xStops = [0, ...vCuts.map((v) => v.x).sort((a, b) => a - b), W];

    for (const vc of vCuts) {
      if (vc.hasStrongValley) verticalValleyCount++;
      const vMidBand = 0.5 * (v0Band + v1Band);
      const segV0 = vc.half === 'top' ? vMidBand : v0Band;
      const segV1 = vc.half === 'bot' ? vMidBand : v1Band;
      rawV.push({ pos: vc.u, start: segV0, end: segV1, score: vc.score });
      vLinesPx.push({ x: vc.x, y0: by0, y1: by1 });
    }

    const isMiddleOpenBand =
      bandIsOpenMid[b] || (isMultiLevel && b > 0 && b < yStops.length - 2 && vCuts.length === 0);

    for (let c = 0; c < xStops.length - 1; c++) {
      const cx0 = xStops[c];
      const cx1 = xStops[c + 1];
      const u0Cell = cx0 / W;
      const u1Cell = cx1 / W;
      const cellStats = computeBoxStats(lum, c1, c2, W, cx0, cx1, by0, by1);
      const isDarkGlassOrOpen = cellStats.darkRatio > 0.35 || cellStats.centerLum < cellStats.borderLum - 22;

      const cellH = findCellHorizontalCuts(
        lum,
        maps,
        W,
        H,
        tPy,
        cx0,
        cx1,
        by0,
        by1,
        isDarkGlassOrOpen,
      );

      for (const ch of cellH) {
        rawH.push({ pos: ch.v, start: u0Cell, end: u1Cell, score: ch.score });
        hLinesPx.push({ y: ch.y, x0: cx0, x1: cx1 });
      }

      // Recursión nivel 2: si una celda ancha (>= 42% W) se dividió horizontalmente,
      // inspeccionar sus sub-bandas en busca de puertas/divisiones verticales (ej. alacena superior asimétrica #14)
      let subdivided = false;
      if (cellH.length > 0 && cx1 - cx0 >= W * 0.42 && !cellH.every((h) => h.kind === 'bright_shelf')) {
        const subY = [by0, ...cellH.map((h) => h.y).sort((a, b) => a - b), by1];
        const subFoundAny: Array<{ sb: number; sv: Array<{ x: number; u: number; score: number }> }> = [];
        for (let sb = 0; sb < subY.length - 1; sb++) {
          const sv = findVerticalCutsInBox(lum, c1, c2, maps, W, cx0, cx1, subY[sb], subY[sb + 1], true, refLum);
          if (sv.length > 0) subFoundAny.push({ sb, sv });
        }
        if (subFoundAny.length > 0) {
          subdivided = true;
          for (let sb = 0; sb < subY.length - 1; sb++) {
            const sby0 = subY[sb];
            const sby1 = subY[sb + 1];
            const sv = subFoundAny.find((f) => f.sb === sb)?.sv ?? [];
            const subX = [cx0, ...sv.map((v) => v.x).sort((a, b) => a - b), cx1];
            for (const vc of sv) {
              rawV.push({
                pos: vc.u,
                start: 1 - sby1 / H,
                end: 1 - sby0 / H,
                score: vc.score,
              });
              vLinesPx.push({ x: vc.x, y0: sby0, y1: sby1 });
            }
            for (let sc = 0; sc < subX.length - 1; sc++) {
              leafCells.push({
                x0: subX[sc],
                x1: subX[sc + 1],
                y0: sby0,
                y1: sby1,
                localHCuts: [],
                isFullWidthMiddleBand: false,
              });
            }
          }
        }
      }

      if (!subdivided) {
        leafCells.push({
          x0: cx0,
          x1: cx1,
          y0: by0,
          y1: by1,
          localHCuts: cellH.map((ch) => ({ y: ch.y, v: ch.v, kind: ch.kind })),
          isFullWidthMiddleBand: isMiddleOpenBand,
        });
      }
    }
  }

  const mergedV = mergeSpanSegments(rawV, 0.04, 0.04);
  const mergedH = mergeSpanSegments(rawH, 0.04, 0.04);

  const mapU = (u: number) =>
    u <= 0.01 ? 0 : u >= 0.99 ? 1 : Number(exteriorToInterior(u, boardThicknessMm, dimsMm.x).toFixed(4));
  const mapV = (v: number) =>
    v <= 0.01 ? 0 : v >= 0.99 ? 1 : Number(exteriorToInterior(v, boardThicknessMm, dimsMm.y).toFixed(4));

  const vDividers: NormalizedSegment[] = mergedV.map((m, idx) => ({
    id: `auto_div_${idx + 1}`,
    position: mapU(m.pos),
    start: mapV(m.start),
    end: mapV(m.end),
  }));

  const hShelves: NormalizedSegment[] = mergedH.map((m, idx) => ({
    id: `auto_rep_${idx + 1}`,
    position: mapV(m.pos),
    start: mapU(m.start),
    end: mapU(m.end),
  }));

  const detectedHandles = detectHandlesOnFront(lum, W, H, refLum, vLinesPx, hLinesPx);

  // Clasificación física celda por celda en FrontZone[]
  const detectedZones: FrontZone[] = [];
  let zoneIdx = 1;
  for (const cell of leafCells) {
    const uStart = mapU(cell.x0 / W);
    const uEnd = mapU(cell.x1 / W);
    const vStart = mapV(1 - cell.y1 / H);
    const vEnd = mapV(1 - cell.y0 / H);
    if (uEnd - uStart < 0.04 || vEnd - vStart < 0.04) continue;

    const stats = computeBoxStats(lum, c1, c2, W, cell.x0, cell.x1, cell.y0, cell.y1);
    const uMid = 0.5 * (uStart + uEnd);
    const seamCuts = cell.localHCuts.filter((h) => h.kind === 'seam_step');
    const brightShelves = cell.localHCuts.filter((h) => h.kind === 'bright_shelf');

    // 1. Hueco de piernas (fondo blanco/claro mucho más luminoso que la carcasa de madera, tocando base)
    if (
      vStart <= 0.05 &&
      refLum < 205 &&
      (stats.brightWhiteRatio > 0.40 || (stats.meanLum > refLum + 65 && stats.meanChroma < 0.04)) &&
      (uEnd - uStart < 0.95 || vEnd < 0.85)
    ) {
      detectedZones.push({
        id: `auto_zone_${zoneIdx++}`,
        uStart,
        uEnd,
        vStart,
        vEnd,
        kind: 'leg_void',
        label: 'Hueco Piernas',
      });
      continue;
    }

    // 2. Nicho central abierto entre cuerpo inferior y superior (cocina / mesón)
    if (cell.isFullWidthMiddleBand) {
      detectedZones.push({
        id: `auto_zone_${zoneIdx++}`,
        uStart,
        uEnd,
        vStart,
        vEnd,
        kind: 'open',
        label: 'Nicho / Mesón',
      });
      continue;
    }

    // 3. Puerta con vidrio (marco más claro rodeando interior oscuro + eventuales repisas visibles)
    if (
      ((stats.borderLum - stats.centerLum >= 20 && stats.darkRatio >= 0.30) ||
        (stats.borderLum - stats.centerLum >= 10 && stats.darkRatio >= 0.55 && brightShelves.length >= 1)) &&
      seamCuts.length === 0
    ) {
      detectedZones.push({
        id: `auto_zone_${zoneIdx++}`,
        uStart,
        uEnd,
        vStart,
        vEnd,
        kind: 'door_glass',
        internalShelves: brightShelves.length > 0 ? brightShelves.length : undefined,
        label: `Vitrina ${zoneIdx - 1}`,
      });
      continue;
    }

    // 4. Vano abierto oscuro o con sombras de cavidad (ej. nichos superiores, centro de rack TV, canastos)
    if (
      (stats.meanLum < refLum * 0.78 && stats.darkRatio > 0.24 && seamCuts.length <= 1) ||
      (stats.brightWhiteRatio > 0.65 && vStart > 0.15)
    ) {
      detectedZones.push({
        id: `auto_zone_${zoneIdx++}`,
        uStart,
        uEnd,
        vStart,
        vEnd,
        kind: 'open',
        internalShelves: cell.localHCuts.length > 0 ? cell.localHCuts.length : undefined,
        label: `Nicho ${zoneIdx - 1}`,
      });
      continue;
    }

    // 5. Cajonera (o 1 cajón superior + 1 puerta inferior si la parte baja es mucho más alta)
    if (seamCuts.length >= 1) {
      if (seamCuts.length === 1) {
        const cutV = mapV(seamCuts[0].v);
        const topH = vEnd - cutV;
        const botH = cutV - vStart;
        if (botH > topH * 1.45 && topH >= 0.08) {
          detectedZones.push({
            id: `auto_zone_${zoneIdx++}`,
            uStart,
            uEnd,
            vStart: cutV,
            vEnd,
            kind: 'drawers',
            drawerCount: 1,
            label: 'Cajón Superior',
          });
          detectedZones.push({
            id: `auto_zone_${zoneIdx++}`,
            uStart,
            uEnd,
            vStart,
            vEnd: cutV,
            kind: 'door_right',
            label: 'Puerta Inferior',
          });
          continue;
        }
      }
      detectedZones.push({
        id: `auto_zone_${zoneIdx++}`,
        uStart,
        uEnd,
        vStart,
        vEnd,
        kind: 'drawers',
        drawerCount: seamCuts.length + 1,
        label: `Cajonera (${seamCuts.length + 1})`,
      });
      continue;
    }

    // 6. Puerta sólida (sentido según tirador detectado o alternancia)
    const cellHandle = detectedHandles.find(
      (h) => h.u >= uStart - 0.02 && h.u <= uEnd + 0.02 && h.v >= vStart - 0.02 && h.v <= vEnd + 0.02,
    );
    const opensLeft = cellHandle ? cellHandle.u >= uMid : zoneIdx % 2 === 1;
    detectedZones.push({
      id: `auto_zone_${zoneIdx++}`,
      uStart,
      uEnd,
      vStart,
      vEnd,
      kind: opensLeft ? 'door_left' : 'door_right',
      label: `Puerta ${zoneIdx - 1}`,
    });
  }

  const allScores = [...mergedV.map((m) => m.score), ...mergedH.map((m) => m.score)];
  const seamStrength =
    allScores.length > 0 ? allScores.reduce((acc, s) => acc + s, 0) / allScores.length : 0;

  return {
    vDividers,
    hShelves,
    detectedHandles,
    detectedZones,
    seamStrength,
    maxRegStepScore,
    verticalValleyCount,
  };
}

/**
 * Motor de bandas abiertas con anclaje unilateral consciente de paralaje (preserva <= 5 mm en estanterías abiertas).
 */
function detectOpenBoardBands(
  matchMap: Float32Array,
  W: number,
  H: number,
  dimsMm: { x: number; y: number },
  boardThicknessMm: number,
  tPx: number,
  tPy: number,
  parallaxAware: boolean,
  horizonV: number,
): { vDividers: NormalizedSegment[]; hShelves: NormalizedSegment[] } {
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
      score = bandCov - leftFlank;
    } else {
      score = bandCov - rightFlank;
    }

    if (score > 0.24) {
      divScores[x] = score;
    }
  }

  const nmsRadX = Math.max(tPx * 3, Math.round(W * 0.10));
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
      const sL = divScores[x - 1] ?? 0;
      const sR = divScores[x + 1] ?? 0;
      const denom = sL - 2 * s + sR;
      const subShift = Math.abs(denom) > 1e-6 ? Math.max(-0.5, Math.min(0.5, (0.5 * (sL - sR)) / denom)) : 0;
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
        score = bandCov - belowFlank;
      } else {
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
        const subShift = Math.abs(denom) > 1e-6 ? Math.max(-0.5, Math.min(0.5, (0.5 * (sU - sD)) / denom)) : 0;
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

  return { vDividers, hShelves };
}

/**
 * Detecta automáticamente la estructura interna de un mueble rectificado (modo unificado v3.3:
 * abierto con bandas de melamina + cerrado con ranuras + mixto/multinivel jerárquico).
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

  const tPx = Math.max(3, Math.round((boardThicknessMm / Math.max(100, dimsMm.x)) * W));
  const tPy = Math.max(3, Math.round((boardThicknessMm / Math.max(100, dimsMm.y)) * H));

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
    const bx = Math.max(2, Math.floor(tPx * 0.8));
    const by = Math.max(2, Math.floor(tPy * 0.8));
    const stepY = Math.max(1, Math.floor(H / 90));
    const stepX = Math.max(1, Math.floor(W / 90));

    for (let y = by; y < H - by; y += stepY) {
      for (let dx = 1; dx < bx; dx++) {
        pushPixel(dx, y);
        pushPixel(W - 1 - dx, y);
      }
    }
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

  // =========================================================================
  // EVALUACIÓN DUAL: ESTANTERÍA ABIERTA vs MOTOR JERÁRQUICO MULTINIVEL (v3.3)
  // =========================================================================
  const openRes =
    interiorMatch <= 0.50
      ? detectOpenBoardBands(matchMap, W, H, dimsMm, boardThicknessMm, tPx, tPy, parallaxAware, horizonV)
      : { vDividers: [], hShelves: [] };
  const openCount = openRes.vDividers.length + openRes.hShelves.length;

  const hierRes = detectHierarchicalStructure(
    lum,
    c1,
    c2,
    W,
    H,
    dimsMm,
    boardThicknessMm,
    tPy,
    refLum,
  );
  const hierCount = hierRes.vDividers.length + hierRes.hShelves.length;

  // RAMA A: MUEBLE ABIERTO PURO (estanterías / libreros / mesa abierta)
  // Se prioriza si interiorMatch <= 0.50 Y:
  //   - El motor abierto con anclaje de paralaje encontró una grilla real (>= 3 piezas, ej. libreros y escenarios 1-7), O
  //   - No hay ninguna ranura vertical cerrada real (verticalValleyCount === 0, ej. mesa abierta con marcos de fierro #08)
  const openRichGrid = openCount >= 3;
  const openNoClosedDoorSeams = openCount >= 1 && hierRes.verticalValleyCount === 0;
  const strongMultiLevelSplit = hierRes.maxRegStepScore >= 44 && hierCount >= 2 && hierRes.verticalValleyCount >= 1;

  if (interiorMatch <= 0.50 && (openRichGrid || openNoClosedDoorSeams || (!strongMultiLevelSplit && (openCount >= 1 || hierCount === 0)))) {
    const confidence = Math.max(0.52, Math.min(1, 1 - interiorMatch * 1.05));
    const uStops = [0, ...openRes.vDividers.map((d) => d.position), 1];
    const openZones: FrontZone[] = [];
    for (let i = 0; i < uStops.length - 1; i++) {
      openZones.push({
        id: `auto_open_${i + 1}`,
        uStart: uStops[i],
        uEnd: uStops[i + 1],
        vStart: 0,
        vEnd: 1,
        kind: 'open',
        label: `Vano ${i + 1}`,
      });
    }
    return {
      furnitureMode: 'open',
      vDividers: openRes.vDividers,
      hShelves: openRes.hShelves,
      detectedHandles: [],
      detectedZones: openZones,
      confidence: Number(confidence.toFixed(3)),
      interiorMatch: Number(interiorMatch.toFixed(3)),
      refLum: Number(refLum.toFixed(1)),
    };
  }

  // RAMA B: MUEBLE CERRADO O MIXTO / MULTINIVEL (puertas, cajones, escritorios, cocinas 2 niveles)
  if (hierCount > 0 && hierRes.seamStrength >= 11) {
    const hasOpenOrVoidOrGlass = hierRes.detectedZones.some(
      (z) => z.kind === 'open' || z.kind === 'leg_void' || z.kind === 'door_glass',
    );
    const mode: DetectedFurnitureMode =
      interiorMatch > 0.50 && !hasOpenOrVoidOrGlass ? 'closed_front' : 'mixed';
    const closedConf = Math.max(0.60, Math.min(0.95, 0.52 + hierRes.seamStrength / 140));
    return {
      furnitureMode: mode,
      vDividers: hierRes.vDividers,
      hShelves: hierRes.hShelves,
      detectedHandles: hierRes.detectedHandles,
      detectedZones: hierRes.detectedZones,
      confidence: Number(closedConf.toFixed(3)),
      interiorMatch: Number(interiorMatch.toFixed(3)),
      refLum: Number(refLum.toFixed(1)),
    };
  }

  // Fallback honesto: si interiorMatch <= 0.50 pero no hubo ranuras (ej. mesa abierta simple)
  if (interiorMatch <= 0.50) {
    const confidence = Math.max(0.52, Math.min(0.85, 1 - interiorMatch * 1.05));
    return {
      furnitureMode: 'open',
      vDividers: openRes.vDividers,
      hShelves: openRes.hShelves,
      detectedHandles: [],
      detectedZones: [{ id: 'auto_open_1', uStart: 0, uEnd: 1, vStart: 0, vEnd: 1, kind: 'open', label: 'Vano Principal' }],
      confidence: Number(confidence.toFixed(3)),
      interiorMatch: Number(interiorMatch.toFixed(3)),
      refLum: Number(refLum.toFixed(1)),
    };
  }

  // RAMA C: BAJA CONFIANZA (ej. blanco sobre blanco sin ranuras ni escalones — Principio 07 OFG)
  const rawConf = Math.max(0, Math.min(0.45, 1 - interiorMatch * 1.05));
  return {
    furnitureMode: 'uncertain',
    vDividers: [],
    hShelves: [],
    detectedHandles: [],
    confidence: Number(rawConf.toFixed(3)),
    interiorMatch: Number(interiorMatch.toFixed(3)),
    refLum: Number(refLum.toFixed(1)),
  };
}

/**
 * Analiza la franja inclinada paralela a la base [BL -> BR] debajo del cuerpo de melamina
 * para detectar patas independientes en los extremos + espacio sombreado bajo el mueble.
 */
export function detectLowerGapHint(
  srcRgba: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  quadCorners: readonly [Point2D, Point2D, Point2D, Point2D],
): LowerGapHintResult {
  const [tl, tr, br, bl] = quadCorners;
  const bodyH = 0.5 * (Math.hypot(bl.x - tl.x, bl.y - tl.y) + Math.hypot(br.x - tr.x, br.y - tr.y));
  const dropOffset = Math.round(bodyH * 0.14);

  if (bodyH < 40 || dropOffset < 10) {
    return { possibleExternalLegs: false };
  }

  const lumAt = (x: number, y: number): number => {
    const ix = Math.max(0, Math.min(srcW - 1, Math.round(x)));
    const iy = Math.max(0, Math.min(srcH - 1, Math.round(y)));
    const i = (iy * srcW + ix) * 4;
    return 0.299 * srcRgba[i] + 0.587 * srcRgba[i + 1] + 0.114 * srcRgba[i + 2];
  };

  const samples = 60;
  const edgeLums: number[] = [];
  const midLums: number[] = [];

  for (let k = 0; k <= samples; k++) {
    const t = k / samples;
    const px = bl.x + (br.x - bl.x) * t;
    const py = bl.y + (br.y - bl.y) * t + dropOffset;
    if (py >= srcH - 2) continue;
    const l = lumAt(px, py);
    if (t <= 0.12 || t >= 0.88) {
      edgeLums.push(l);
    } else if (t >= 0.22 && t <= 0.78) {
      midLums.push(l);
    }
  }

  if (edgeLums.length < 4 || midLums.length < 10) {
    return { possibleExternalLegs: false };
  }

  const midMed = median(midLums);
  const contrastHits = edgeLums.filter((l) => Math.abs(l - midMed) > 20).length;
  const ratio = contrastHits / edgeLums.length;
  const possibleExternalLegs = ratio >= 0.16;

  return {
    possibleExternalLegs,
    estimatedLegRatio: possibleExternalLegs ? Number(((dropOffset * 1.4) / bodyH).toFixed(3)) : undefined,
  };
}
