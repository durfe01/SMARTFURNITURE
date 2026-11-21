/**
 * SMARTFURNITURE / OFG — CLASE POO `PerspectiveRectifier`
 * Encapsula la proyección homográfica 3×3, estimación de relación de aspecto de Zhang con focal fija,
 * rectificación bilineal, detección de patas externas y auto-encuadre para fotos de fondo uniforme.
 */
import { computeQuadToUnitHomography } from '../mathEngine';
import {
  computeRectifiedSize,
  detectLowerGapHint,
  estimateAspectRatioFixedFocal,
  extrapolateDimensionsFromSingleMeasure,
  rectifyImageRGBA,
  type LowerGapHintResult,
} from '../vision';
import type { AutoFrameResult, ImageFrameRGBA, Quad2D } from './types';

function medianVal(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? 0.5 * (s[mid - 1] + s[mid]) : s[mid];
}

export class PerspectiveRectifier {
  private readonly defaultFocal35mm: 26 | 52;

  public constructor(defaultFocal35mm: 26 | 52 = 26) {
    this.defaultFocal35mm = defaultFocal35mm;
  }

  public estimateAspectRatio(
    quad: Quad2D,
    imgW: number,
    imgH: number,
    focal35mm: 26 | 52 = this.defaultFocal35mm,
  ): number {
    return estimateAspectRatioFixedFocal(quad, imgW, imgH, focal35mm);
  }

  public extrapolateDimensions(
    aspectRatioXY: number,
    knownAxis: 'x' | 'y',
    knownMm: number,
    depthMm: number,
  ): { x: number; y: number; z: number } {
    return extrapolateDimensionsFromSingleMeasure(aspectRatioXY, knownAxis, knownMm, depthMm);
  }

  public computeRectifiedFrame(
    frame: ImageFrameRGBA,
    quad: Quad2D,
    dimsMm: { x: number; y: number },
    boardThicknessMm: number,
  ): { rectified: ImageFrameRGBA; homographyToUnit: number[][] } | null {
    const hom = computeQuadToUnitHomography(quad);
    if (!hom) return null;
    const size = computeRectifiedSize(dimsMm.x, dimsMm.y, boardThicknessMm);
    const rgba = rectifyImageRGBA(
      frame.rgba,
      frame.width,
      frame.height,
      hom.toCanvas,
      size.width,
      size.height,
    );
    return {
      rectified: { rgba, width: size.width, height: size.height },
      homographyToUnit: hom.toUnit.map((r) => [...r]),
    };
  }

  public detectExternalLegs(frame: ImageFrameRGBA, quad: Quad2D): LowerGapHintResult {
    return detectLowerGapHint(frame.rgba, frame.width, frame.height, quad);
  }

  /**
   * Auto-encuadre honesto del cuerpo principal del mueble sobre fondos uniformes de catálogo/estudio
   * (blanco, negro o liso). Recorta automáticamente patas delgadas inferiores y declara honestamente
   * baja confianza (`< 0.5`) en fotografías con pared/ambiente real para activar ajuste manual con Lupa 4×.
   */
  public autoFrameSubjectQuad(frame: ImageFrameRGBA): AutoFrameResult {
    const { rgba, width: W, height: H } = frame;
    const fallbackQuad: Quad2D = [
      { x: Math.round(W * 0.16), y: Math.round(H * 0.14) },
      { x: Math.round(W * 0.84), y: Math.round(H * 0.14) },
      { x: Math.round(W * 0.84), y: Math.round(H * 0.84) },
      { x: Math.round(W * 0.16), y: Math.round(H * 0.84) },
    ];

    if (W < 40 || H < 40 || rgba.length < W * H * 4) {
      return {
        quad: fallbackQuad,
        confidence: 0,
        backgroundType: 'cluttered',
        detectedSubjectCoverage: 0,
        message: 'Imagen demasiado pequeña para auto-encuadre; ajusta las 4 esquinas manualmente.',
      };
    }

    // 1. Muestrear el anillo perimetral exterior (3% del borde) para estimar fondo uniforme
    const bR: number[] = [];
    const bG: number[] = [];
    const bB: number[] = [];
    const stepX = Math.max(1, Math.floor(W / 120));
    const stepY = Math.max(1, Math.floor(H / 120));
    const margin = Math.max(2, Math.min(8, Math.round(Math.min(W, H) * 0.015)));

    const pushPx = (x: number, y: number) => {
      const i = (y * W + x) * 4;
      bR.push(rgba[i]);
      bG.push(rgba[i + 1]);
      bB.push(rgba[i + 2]);
    };

    for (let x = 0; x < W; x += stepX) {
      pushPx(x, margin);
      pushPx(x, H - 1 - margin);
    }
    for (let y = 0; y < H; y += stepY) {
      pushPx(margin, y);
      pushPx(W - 1 - margin, y);
    }

    const bgR = medianVal(bR);
    const bgG = medianVal(bG);
    const bgB = medianVal(bB);
    const bgLum = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB;

    const borderDists: number[] = [];
    for (let i = 0; i < bR.length; i++) {
      borderDists.push(Math.hypot(bR[i] - bgR, bG[i] - bgG, bB[i] - bgB));
    }
    const bgMad = medianVal(borderDists) * 1.4826;
    const uniformTol = Math.max(22, Math.min(48, bgMad * 2.8 + 14));
    const uniformHits = borderDists.filter((d) => d <= uniformTol).length;
    const borderUniformity = uniformHits / Math.max(1, borderDists.length);

    // Si el perímetro tiene ladrillos, piso, cortinas o fondo heterogéneo -> NO adivinar
    if (borderUniformity < 0.72) {
      return {
        quad: fallbackQuad,
        confidence: Number(Math.min(0.42, borderUniformity * 0.5).toFixed(3)),
        backgroundType: 'cluttered',
        detectedSubjectCoverage: 0,
        message:
          'Foto con fondo de ambiente real (pared/piso). Arrastra manualmente TL, TR, BR, BL con la Lupa 4× sobre las 4 esquinas del cuerpo de melamina.',
      };
    }

    // 2. Máscara de primer plano en submuestreo rápido (paso 2 px)
    const fgThresh = Math.max(24, Math.min(54, bgMad * 3.0 + 18));
    const rowFill = new Float32Array(H);
    const colFill = new Float32Array(W);
    const fgMask = new Uint8Array(W * H);

    for (let y = 0; y < H; y++) {
      const ro = y * W;
      let rHits = 0;
      for (let x = 0; x < W; x++) {
        const i = (ro + x) * 4;
        const dist = Math.hypot(rgba[i] - bgR, rgba[i + 1] - bgG, rgba[i + 2] - bgB);
        if (dist > fgThresh) {
          fgMask[ro + x] = 1;
          rHits++;
          colFill[x]++;
        }
      }
      rowFill[y] = rHits / W;
    }
    for (let x = 0; x < W; x++) colFill[x] /= H;

    // 3. Caja base del mueble ignorando ruido/sombras muy finas (< 5% de ancho/alto)
    let minX = 0;
    let maxX = W - 1;
    let minY = 0;
    let maxY = H - 1;

    while (minX < W - 1 && colFill[minX] < 0.05) minX++;
    while (maxX > minX && colFill[maxX] < 0.05) maxX--;
    while (minY < H - 1 && rowFill[minY] < 0.05) minY++;
    while (maxY > minY && rowFill[maxY] < 0.05) maxY--;

    const boxW = maxX - minX + 1;
    const boxH = maxY - minY + 1;
    const coverage = (boxW * boxH) / (W * H);
    if (boxW < W * 0.18 || boxH < H * 0.18 || coverage > 0.985) {
      return {
        quad: fallbackQuad,
        confidence: 0.35,
        backgroundType: bgLum > 128 ? 'uniform_light' : 'uniform_dark',
        detectedSubjectCoverage: Number(coverage.toFixed(3)),
        message:
          'No se pudo aislar un contorno interior limpio; ubica las 4 esquinas TL, TR, BR, BL manualmente con la Lupa 4×.',
      };
    }

    // 4. Recortar patas delgadas inferiores (donde la densidad horizontal cae bajo 40% del ancho del mueble)
    let bodyMaxY = maxY;
    const minBodyRowDensity = 0.38;
    const maxLegTrimY = minY + Math.round(boxH * 0.72);
    while (bodyMaxY > maxLegTrimY) {
      let fgInSpan = 0;
      const ro = bodyMaxY * W;
      for (let x = minX; x <= maxX; x++) {
        if (fgMask[ro + x] === 1) fgInSpan++;
      }
      if (fgInSpan / boxW >= minBodyRowDensity) break;
      bodyMaxY--;
    }

    // 5. Refinar altura de cada esquina (TL, TR, BR, BL) para adaptarse a leve perspectiva del mueble
    const probeColY = (cx: number, fromTop: boolean): number => {
      const rx0 = Math.max(minX, cx - 4);
      const rx1 = Math.min(maxX, cx + 4);
      if (fromTop) {
        for (let y = minY; y <= bodyMaxY; y++) {
          let hits = 0;
          const ro = y * W;
          for (let x = rx0; x <= rx1; x++) if (fgMask[ro + x] === 1) hits++;
          if (hits >= Math.ceil((rx1 - rx0 + 1) * 0.5)) return y;
        }
        return minY;
      }
      for (let y = bodyMaxY; y >= minY; y--) {
        let hits = 0;
        const ro = y * W;
        for (let x = rx0; x <= rx1; x++) if (fgMask[ro + x] === 1) hits++;
        if (hits >= Math.ceil((rx1 - rx0 + 1) * 0.5)) return y;
      }
      return bodyMaxY;
    };

    const insetX = Math.max(4, Math.round(boxW * 0.05));
    const tlY = probeColY(minX + insetX, true);
    const trY = probeColY(maxX - insetX, true);
    const blY = probeColY(minX + insetX, false);
    const brY = probeColY(maxX - insetX, false);

    // Asegurar convexidad y altura mínima sana en ambos costados
    const safeMinSideH = Math.max(30, Math.round((bodyMaxY - minY) * 0.45));
    const quad: Quad2D = [
      { x: minX, y: blY - tlY >= safeMinSideH ? tlY : minY },
      { x: maxX, y: brY - trY >= safeMinSideH ? trY : minY },
      { x: maxX, y: brY - trY >= safeMinSideH ? brY : bodyMaxY },
      { x: minX, y: blY - tlY >= safeMinSideH ? blY : bodyMaxY },
    ];

    const conf = Number(Math.max(0.72, Math.min(0.94, borderUniformity * 0.96)).toFixed(3));
    const bgLabel = bgLum > 128 ? 'uniform_light' : 'uniform_dark';
    const legTrimMsg =
      bodyMaxY < maxY - Math.round(boxH * 0.05)
        ? ' (patas inferiores excluidas automáticamente).'
        : '.';

    return {
      quad,
      confidence: conf,
      backgroundType: bgLabel,
      detectedSubjectCoverage: Number(coverage.toFixed(3)),
      message: `Auto-encuadre completado (${Math.round(conf * 100)}% confianza, fondo ${bgLabel === 'uniform_light' ? 'claro' : 'oscuro'})${legTrimMsg} Verifica las 4 esquinas y pulsa "Detectar estructura".`,
    };
  }
}
