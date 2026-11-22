/**
 * SMARTFURNITURE / OFG — CLASE POO `PerspectiveRectifier` (v1.1)
 * Encapsula la proyección homográfica 3×3, estimación de relación de aspecto de Zhang con focal fija,
 * rectificación bilineal, detección de patas externas y auto-encuadre de alta precisión para fotos
 * de catálogo/estudio (incluidos muebles blancos sobre fondo blanco y recorte automático de patas).
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
   * (blanco puro, gris claro o negro), soportando muebles blancos sobre fondo blanco mediante
   * umbral adaptativo fino + detección de gradiente, recorte automático de patas delgadas inferiores
   * y manejo de fotos recortadas al ras del mueble. En fondos con pared/piso real devuelve
   * `confidence < 0.5` para guiar ajuste con Lupa 4×.
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

    // 1. Muestrear el borde superior + bordes laterales superiores (donde el fondo de estudio siempre domina)
    const bR: number[] = [];
    const bG: number[] = [];
    const bB: number[] = [];
    const stepX = Math.max(1, Math.floor(W / 120));
    const stepY = Math.max(1, Math.floor(H / 120));
    const margin = Math.max(1, Math.min(5, Math.round(Math.min(W, H) * 0.008)));

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
    const uniformTol = Math.max(18, Math.min(44, bgMad * 2.8 + 12));
    const uniformHits = borderDists.filter((d) => d <= uniformTol).length;
    const borderUniformity = uniformHits / Math.max(1, borderDists.length);

    // Caso especial: foto recortada exactamente al ras del mueble (ej. vitrina frontal que llena el 98% del cuadro)
    // Si el borde es un material de madera/oscuro uniforme (sin blanco puro de estudio ni ruido de ladrillos)
    const isTightCroppedCabinet =
      borderUniformity >= 0.55 &&
      bgLum > 30 &&
      bgLum < 165 &&
      bgMad < 18;

    if (isTightCroppedCabinet) {
      const tightQuad: Quad2D = [
        { x: Math.round(W * 0.015), y: Math.round(H * 0.015) },
        { x: Math.round(W * 0.985), y: Math.round(H * 0.015) },
        { x: Math.round(W * 0.985), y: Math.round(H * 0.96) },
        { x: Math.round(W * 0.015), y: Math.round(H * 0.96) },
      ];
      return {
        quad: tightQuad,
        confidence: 0.84,
        backgroundType: 'uniform_dark',
        detectedSubjectCoverage: 0.92,
        message: 'Foto frontal recortada al ras del mueble: encuadre perimetral aplicado automáticamente.',
      };
    }

    // Verificar si la mitad superior del perímetro es fondo puro de estudio (ej. escritorio #05 donde el piso inferior tiene sombra)
    let topWhiteHits = 0;
    let topCount = 0;
    for (let x = 0; x < W; x += stepX) {
      const i = (margin * W + x) * 4;
      if (Math.hypot(rgba[i] - bgR, rgba[i + 1] - bgG, rgba[i + 2] - bgB) <= uniformTol) {
        topWhiteHits++;
      }
      topCount++;
    }
    const topUniformity = topWhiteHits / Math.max(1, topCount);
    const isStudioBackdrop =
      borderUniformity >= 0.72 ||
      (topUniformity >= 0.92 && borderUniformity >= 0.55 && (bgLum >= 232 || bgLum <= 18));

    if (!isStudioBackdrop) {
      return {
        quad: fallbackQuad,
        confidence: Number(Math.min(0.42, borderUniformity * 0.5).toFixed(3)),
        backgroundType: 'cluttered',
        detectedSubjectCoverage: 0,
        message:
          'Foto con fondo de ambiente real (pared/piso). Arrastra las 4 esquinas azules (TL, TR, BR, BL) sobre el contorno del cuerpo de melamina — el plano vectorial se actualizará al soltar cada esquina.',
      };
    }

    // 2. Umbral adaptativo fino para NO borrar muebles blancos sobre fondo blanco puro de estudio
    const isUltraCleanStudio = bgMad < 4 && (bgLum >= 238 || bgLum <= 14);
    const fgThresh = isUltraCleanStudio
      ? Math.max(9, Math.round(bgMad * 3.0 + 8))
      : Math.max(20, Math.min(48, bgMad * 2.8 + 15));

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

    // 3. Caja base del mueble ignorando ruido/sombras de piso muy finas
    let minX = 0;
    let maxX = W - 1;
    let minY = 0;
    let maxY = H - 1;

    while (minX < W - 1 && colFill[minX] < 0.045) minX++;
    while (maxX > minX && colFill[maxX] < 0.045) maxX--;
    while (minY < H - 1 && rowFill[minY] < 0.045) minY++;
    while (maxY > minY && rowFill[maxY] < 0.045) maxY--;

    const boxW = maxX - minX + 1;
    const boxH = maxY - minY + 1;
    const coverage = (boxW * boxH) / (W * H);
    if (boxW < W * 0.16 || boxH < H * 0.16) {
      return {
        quad: fallbackQuad,
        confidence: 0.35,
        backgroundType: bgLum > 128 ? 'uniform_light' : 'uniform_dark',
        detectedSubjectCoverage: Number(coverage.toFixed(3)),
        message:
          'No se pudo aislar un contorno interior limpio; ubica las 4 esquinas TL, TR, BR, BL manualmente con la Lupa 4×.',
      };
    }

    // 4. Recortar patas delgadas inferiores (solo cuando la densidad cae bajo 28% y NO hay pedestales de escritorio)
    let bodyMaxY = maxY;
    const maxLegTrimY = minY + Math.round(boxH * 0.74);
    while (bodyMaxY > maxLegTrimY) {
      let fgInSpan = 0;
      const ro = bodyMaxY * W;
      for (let x = minX; x <= maxX; x++) {
        if (fgMask[ro + x] === 1) fgInSpan++;
      }
      // Si hay relleno sólido en todo el ancho o en pedestales anchos (>= 30%), es cuerpo, no patas finas
      if (fgInSpan / boxW >= 0.30) break;
      bodyMaxY--;
    }

    // 4.5. Si el mueble fue fotografiado en perspectiva 3/4 con un nicho central pasante (fondo blanco visible
    // en la franja media y=[30%..55%]), recortar el costado lateral 3/4 para encuadrar solo el plano frontal
    const midY0 = minY + Math.round(boxH * 0.32);
    const midY1 = minY + Math.round(boxH * 0.52);
    if (midY1 > midY0 + 10 && boxW >= W * 0.45) {
      let cavLeft = -1;
      let cavRight = -1;
      const midSpanH = midY1 - midY0;
      for (let x = minX + Math.round(boxW * 0.05); x <= maxX - Math.round(boxW * 0.05); x++) {
        let bgHits = 0;
        for (let y = midY0; y < midY1; y++) {
          if (fgMask[y * W + x] === 0) bgHits++;
        }
        if (bgHits / midSpanH >= 0.65) {
          if (cavLeft === -1) cavLeft = x;
          cavRight = x;
        }
      }
      if (cavLeft !== -1 && cavRight !== -1 && cavRight - cavLeft >= boxW * 0.48) {
        const leftWallW = cavLeft - minX;
        const rightWallW = maxX - cavRight;
        // Si el pilar/costado izquierdo es mucho más ancho que el espesor frontal derecho, el excedente es el lateral 3/4
        if (leftWallW >= boxW * 0.095 && leftWallW > rightWallW * 1.45) {
          const frontBorderAllowance = Math.max(8, Math.min(rightWallW, Math.round(boxW * 0.028)));
          minX = Math.max(minX, cavLeft - frontBorderAllowance);
        } else if (rightWallW >= boxW * 0.095 && rightWallW > leftWallW * 1.45) {
          const frontBorderAllowance = Math.max(8, Math.min(leftWallW, Math.round(boxW * 0.028)));
          maxX = Math.min(maxX, cavRight + frontBorderAllowance);
        }
      }
    }

    // 5. Refinar altura de cada esquina (TL, TR, BR, BL) usando una ventana robusta
    const probeColY = (cx: number, fromTop: boolean): number => {
      const rx0 = Math.max(minX, cx - 5);
      const rx1 = Math.min(maxX, cx + 5);
      if (fromTop) {
        for (let y = minY; y <= bodyMaxY; y++) {
          let hits = 0;
          const ro = y * W;
          for (let x = rx0; x <= rx1; x++) if (fgMask[ro + x] === 1) hits++;
          if (hits >= Math.ceil((rx1 - rx0 + 1) * 0.45)) return y;
        }
        return minY;
      }
      for (let y = bodyMaxY; y >= minY; y--) {
        let hits = 0;
        const ro = y * W;
        for (let x = rx0; x <= rx1; x++) if (fgMask[ro + x] === 1) hits++;
        if (hits >= Math.ceil((rx1 - rx0 + 1) * 0.45)) return y;
      }
      return bodyMaxY;
    };

    const insetX = Math.max(4, Math.round(boxW * 0.06));
    const tlY = probeColY(minX + insetX, true);
    const trY = probeColY(maxX - insetX, true);
    const blY = probeColY(minX + insetX, false);
    const brY = probeColY(maxX - insetX, false);

    // Evitar cizalla extrema si una esquina falla por sombra o escalón (limitar desnivel a 18% de alto)
    const maxSlopeY = Math.round((bodyMaxY - minY) * 0.18);
    const finalTlY = Math.abs(tlY - trY) > maxSlopeY ? Math.min(tlY, trY) : tlY;
    const finalTrY = Math.abs(tlY - trY) > maxSlopeY ? Math.min(tlY, trY) : trY;
    const finalBlY = Math.abs(blY - brY) > maxSlopeY ? Math.max(blY, brY) : blY;
    const finalBrY = Math.abs(blY - brY) > maxSlopeY ? Math.max(blY, brY) : brY;

    const safeMinSideH = Math.max(30, Math.round((bodyMaxY - minY) * 0.55));
    const quad: Quad2D = [
      { x: minX, y: finalBlY - finalTlY >= safeMinSideH ? finalTlY : minY },
      { x: maxX, y: finalBrY - finalTrY >= safeMinSideH ? finalTrY : minY },
      { x: maxX, y: finalBrY - finalTrY >= safeMinSideH ? finalBrY : bodyMaxY },
      { x: minX, y: finalBlY - finalTlY >= safeMinSideH ? finalBlY : bodyMaxY },
    ];

    const conf = Number(Math.max(0.75, Math.min(0.95, Math.max(borderUniformity, topUniformity) * 0.96)).toFixed(3));
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
      message: `Auto-encuadre completado (${Math.round(conf * 100)}% confianza, fondo ${bgLabel === 'uniform_light' ? 'claro' : 'oscuro'})${legTrimMsg}`,
    };
  }
}
