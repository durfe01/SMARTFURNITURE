/**
 * SMARTFURNITURE — DETECTOR DUAL DE ESTRUCTURA DE MELAMINA (v3.1)
 * Soporta DOS familias reales de muebles 100% offline:
 *   A) MUEBLE ABIERTO (`open`): cantos de melamina sobre huecos oscuros — usa luminancia flat-field
 *      + crominancia normalizada RGBA + sembrado en 4 bordes/gotero + anclaje unilateral de paralaje.
 *   B) MUEBLE CERRADO (`closed_front` — puertas y cajones): superficie frontal uniforme de madera/melamina
 *      con ranuras/juntas lineales oscuras — usa detector de valles de luminancia con CONTINUIDAD EN EXTREMOS
 *      (inmune a molduras decorativas internas de puertas) + detector de tiradores metálicos por BFS.
 *   C) BAJA CONFIANZA (`uncertain`, ej. blanco sobre blanco sin ranuras): retorna confidence < 0.5
 *      para activar trazado manual asistido (Principio 07 OFG: Honestidad de Confianza).
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

export interface DetectedHandlePoint {
  u: number;
  v: number;
}

export interface BandDetectionResult {
  furnitureMode: 'open' | 'closed_front' | 'uncertain';
  vDividers: NormalizedSegment[];
  hShelves: NormalizedSegment[];
  detectedHandles: DetectedHandlePoint[];
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

/**
 * Detector para muebles CERRADOS (puertas y cajones del mismo material que la carcasa).
 * Exige continuidad de ranura oscura en AMBOS extremos del vano para eliminar al 100%
 * falsos positivos producidos por molduras decorativas internas de las puertas.
 */
function detectClosedFrontSeams(
  lum: Float32Array,
  W: number,
  H: number,
  dimsMm: { x: number; y: number },
  boardThicknessMm: number,
  refLum: number,
): {
  vDividers: NormalizedSegment[];
  hShelves: NormalizedSegment[];
  detectedHandles: DetectedHandlePoint[];
  seamStrength: number;
} {
  const pad = Math.max(8, Math.min(14, Math.round(W * 0.017)));
  const minDiff = 18;

  // 1. RANURAS VERTICALES CONTINUAS (juntas entre puertas / columna de cajones)
  const vScore = new Float32Array(W);
  const yAll0 = Math.round(H * 0.05);
  const yAll1 = Math.round(H * 0.95);
  const yTop1 = Math.round(H * 0.14);
  const yBot0 = Math.round(H * 0.86);

  const evalVertRange = (x: number, y0: number, y1: number): { ratio: number; meanPos: number } => {
    const count = Math.max(1, y1 - y0);
    let darkHits = 0;
    let sumPos = 0;
    for (let y = y0; y < y1; y++) {
      const rowOff = y * W;
      const cMin = Math.min(lum[rowOff + x - 1], lum[rowOff + x], lum[rowOff + x + 1]);
      let lSum = 0;
      let rSum = 0;
      const flankN = pad - 2;
      for (let k = 3; k <= pad; k++) {
        lSum += lum[rowOff + x - k];
        rSum += lum[rowOff + x + k];
      }
      const flankMean = 0.5 * (lSum + rSum) / flankN;
      const diff = flankMean - cMin;
      if (diff > minDiff) darkHits++;
      if (diff > 0) sumPos += diff;
    }
    return { ratio: darkHits / count, meanPos: sumPos / count };
  };

  const minVx = Math.max(pad + 2, Math.round(W * 0.08));
  const maxVx = Math.min(W - pad - 3, Math.round(W * 0.92));

  for (let x = minVx; x <= maxVx; x++) {
    const all = evalVertRange(x, yAll0, yAll1);
    if (all.ratio <= 0.65) continue;
    const top = evalVertRange(x, yAll0, yTop1);
    if (top.ratio <= 0.55) continue;
    const bot = evalVertRange(x, yBot0, yAll1);
    if (bot.ratio <= 0.55) continue;
    vScore[x] = all.ratio * all.meanPos;
  }

  const nmsVx = Math.max(24, Math.round(W * 0.06));
  const vPeaks: Array<{ x: number; score: number }> = [];
  for (let x = minVx; x <= maxVx; x++) {
    const s = vScore[x];
    if (s <= 18) continue;
    let isPeak = true;
    for (let dx = -nmsVx; dx <= nmsVx; dx++) {
      if (dx === 0) continue;
      const nx = x + dx;
      if (nx >= minVx && nx <= maxVx && vScore[nx] > s) {
        isPeak = false;
        break;
      }
    }
    if (isPeak) {
      vPeaks.push({ x, score: s });
    }
  }
  vPeaks.sort((a, b) => a.x - b.x);

  const vDividers: NormalizedSegment[] = vPeaks.map((p, idx) => ({
    id: `auto_div_${idx + 1}`,
    position: Number(exteriorToInterior(p.x / W, boardThicknessMm, dimsMm.x).toFixed(4)),
    start: 0,
    end: 1,
  }));

  // 2. RANURAS HORIZONTALES VANO POR VANO (juntas entre cajones, inmunes a molduras de puertas)
  const pxStops = [0, ...vPeaks.map((p) => p.x), W];
  const uStops = [0, ...vDividers.map((d) => d.position), 1];
  const hRaw: Array<{ y: number; vInt: number; uStart: number; uEnd: number; score: number }> = [];
  const yMinH = Math.max(pad + 2, Math.round(H * 0.10));
  const yMaxH = Math.min(H - pad - 3, Math.round(H * 0.90));
  const nmsHy = Math.max(18, Math.round(H * 0.09));

  for (let b = 0; b < pxStops.length - 1; b++) {
    const bx0 = pxStops[b];
    const bx1 = pxStops[b + 1];
    const bw = bx1 - bx0;
    if (bw < 36) continue;

    const xAll0 = bx0 + Math.max(4, Math.round(bw * 0.04));
    const xAll1 = bx1 - Math.max(4, Math.round(bw * 0.04));
    const xLeft1 = bx0 + Math.max(8, Math.round(bw * 0.16));
    const xRight0 = bx1 - Math.max(8, Math.round(bw * 0.16));

    const evalHorizRange = (y: number, x0: number, x1: number): { ratio: number; meanPos: number } => {
      const count = Math.max(1, x1 - x0);
      let darkHits = 0;
      let sumPos = 0;
      const flankN = pad - 2;
      for (let x = x0; x < x1; x++) {
        const cMin = Math.min(lum[(y - 1) * W + x], lum[y * W + x], lum[(y + 1) * W + x]);
        let uSum = 0;
        let dSum = 0;
        for (let k = 3; k <= pad; k++) {
          uSum += lum[(y - k) * W + x];
          dSum += lum[(y + k) * W + x];
        }
        const flankMean = 0.5 * (uSum + dSum) / flankN;
        const diff = flankMean - cMin;
        if (diff > minDiff) darkHits++;
        if (diff > 0) sumPos += diff;
      }
      return { ratio: darkHits / count, meanPos: sumPos / count };
    };

    const hScore = new Float32Array(H);
    for (let y = yMinH; y <= yMaxH; y++) {
      const all = evalHorizRange(y, xAll0, xAll1);
      if (all.ratio <= 0.65) continue;
      const left = evalHorizRange(y, xAll0, xLeft1);
      if (left.ratio <= 0.55) continue;
      const right = evalHorizRange(y, xRight0, xAll1);
      if (right.ratio <= 0.55) continue;
      hScore[y] = all.ratio * all.meanPos;
    }

    for (let y = yMinH; y <= yMaxH; y++) {
      const s = hScore[y];
      if (s <= 18) continue;
      let isPeak = true;
      for (let dy = -nmsHy; dy <= nmsHy; dy++) {
        if (dy === 0) continue;
        const ny = y + dy;
        if (ny >= yMinH && ny <= yMaxH && hScore[ny] > s) {
          isPeak = false;
          break;
        }
      }
      if (isPeak) {
        const vExt = 1 - y / H;
        hRaw.push({
          y,
          vInt: exteriorToInterior(vExt, boardThicknessMm, dimsMm.y),
          uStart: uStops[b],
          uEnd: uStops[b + 1],
          score: s,
        });
      }
    }
  }

  // Fusión de ranuras horizontales colineales en vanos adyacentes
  hRaw.sort((a, b) => a.vInt - b.vInt || a.uStart - b.uStart);
  const hMerged: Array<{ vInt: number; uStart: number; uEnd: number; count: number; score: number }> = [];
  for (const rs of hRaw) {
    const existing = hMerged.find(
      (m) => Math.abs(m.vInt - rs.vInt) <= 0.025 && Math.abs(m.uEnd - rs.uStart) <= 0.025,
    );
    if (existing) {
      existing.vInt = (existing.vInt * existing.count + rs.vInt) / (existing.count + 1);
      existing.uEnd = rs.uEnd;
      existing.score = Math.max(existing.score, rs.score);
      existing.count++;
    } else {
      hMerged.push({ vInt: rs.vInt, uStart: rs.uStart, uEnd: rs.uEnd, count: 1, score: rs.score });
    }
  }

  const hShelves: NormalizedSegment[] = hMerged.map((m, idx) => ({
    id: `auto_rep_${idx + 1}`,
    position: Number(m.vInt.toFixed(4)),
    start: Number(m.uStart.toFixed(4)),
    end: Number(m.uEnd.toFixed(4)),
  }));

  // 3. DETECCIÓN DE TIRADORES METÁLICOS / MANILLAS OSCURAS SOBRE EL FRENTE CERRADO
  const detectedHandles: DetectedHandlePoint[] = [];
  if (vPeaks.length > 0 || hRaw.length > 0) {
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

    // Enmascarar una banda de ±7 px alrededor de las juntas detectadas
    const seamClear = 7;
    for (const vp of vPeaks) {
      const x0 = Math.max(0, vp.x - seamClear);
      const x1 = Math.min(W - 1, vp.x + seamClear);
      for (let y = 0; y < H; y++) {
        const rowOff = y * W;
        for (let x = x0; x <= x1; x++) mask[rowOff + x] = 0;
      }
    }
    for (const hr of hRaw) {
      const y0 = Math.max(0, hr.y - seamClear);
      const y1 = Math.min(H - 1, hr.y + seamClear);
      const x0 = Math.max(0, Math.floor(hr.uStart * W));
      const x1 = Math.min(W - 1, Math.ceil(hr.uEnd * W));
      for (let y = y0; y <= y1; y++) {
        const rowOff = y * W;
        for (let x = x0; x <= x1; x++) mask[rowOff + x] = 0;
      }
    }

    // BFS componentes conexas (con salto de 4 px para unir manillas curvas con reflejo central)
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
        // Exigir núcleo muy oscuro (descarta nudos de madera cálida y mantiene herrajes metálicos)
        if (area >= 28 && deepCoreCount >= 12 && area <= W * H * 0.018 && bw <= W * 0.16 && bh <= H * 0.35) {
          rawBlobs.push({ cx: sumX / area, cy: sumY / area, area });
        }
      }
    }

    // Fusionar fragmentos del mismo tirador (ej. parte superior e inferior de un asa vertical)
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
  }

  const allScores = [...vPeaks.map((p) => p.score), ...hMerged.map((m) => m.score)];
  const seamStrength =
    allScores.length > 0
      ? allScores.reduce((acc, s) => acc + s, 0) / allScores.length
      : 0;

  return { vDividers, hShelves, detectedHandles, seamStrength };
}

/**
 * Detecta automáticamente la estructura interna de un mueble rectificado (modo dual:
 * mueble abierto con huecos vs mueble cerrado con puertas/cajones + tiradores).
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
  // RAMA B: SI interiorMatch > 0.50 -> PROBAR MODO MUEBLE CERRADO (PUERTAS/CAJONES)
  // =========================================================================
  if (interiorMatch > 0.5) {
    const closed = detectClosedFrontSeams(lum, W, H, dimsMm, boardThicknessMm, refLum);
    const totalSeams = closed.vDividers.length + closed.hShelves.length;
    if (totalSeams > 0 && closed.seamStrength >= 30) {
      const closedConf = Math.max(0.62, Math.min(0.95, 0.55 + closed.seamStrength / 240));
      return {
        furnitureMode: 'closed_front',
        vDividers: closed.vDividers,
        hShelves: closed.hShelves,
        detectedHandles: closed.detectedHandles,
        confidence: Number(closedConf.toFixed(3)),
        interiorMatch: Number(interiorMatch.toFixed(3)),
        refLum: Number(refLum.toFixed(1)),
      };
    }

    // Sin ranuras continuas claras (ej. blanco sobre blanco sin contraste) -> NO CONFIABLE
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

  // =========================================================================
  // RAMA A: MUEBLE ABIERTO (CANTOS DE MELAMINA + HUECOS + ANCLAJE DE PARALAJE)
  // =========================================================================
  const confidence = Math.max(0.52, Math.min(1, 1 - interiorMatch * 1.05));

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
    furnitureMode: 'open',
    vDividers,
    hShelves,
    detectedHandles: [],
    confidence: Number(confidence.toFixed(3)),
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

  // Muestrear a lo largo de la línea inclinada BL -> BR desplazada `dropOffset` px hacia abajo
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
    estimatedLegRatio: possibleExternalLegs ? Number((dropOffset * 1.4 / bodyH).toFixed(3)) : undefined,
  };
}
