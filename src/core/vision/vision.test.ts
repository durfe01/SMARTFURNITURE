import { describe, expect, it } from 'vitest';
import type { Point2D } from '../../types/contracts';
import { computeQuadToUnitHomography, interiorToExterior } from '../mathEngine';
import {
  analyzeRectifiedFurniture,
  computeRectifiedSize,
  estimateAspectRatioFixedFocal,
  extrapolateDimensionsFromSingleMeasure,
  rectifyImageRGBA,
} from './index';

/** PRNG determinista (LCG) para renders sintéticos reproducibles al 100%. */
function createRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

interface SynthFurnitureSpec {
  xMm: number;
  yMm: number;
  depthMm: number;
  eMm: number;
  boardRgb: [number, number, number];
  cavityRgb: [number, number, number];
  dividersUInt: number[];
  shelves: Array<{ vInt: number; uStart: number; uEnd: number }>;
  parallaxCamDistMm?: number;
  jitterLeftPx?: number;
  addObjects?: boolean;
  seed?: number;
}

/**
 * Renderiza un mueble sintético realista en espacio rectificado con gradiente de luz,
 * sombras bajo repisas, libros/objetos aleatorios, ruido de sensor, paralaje 3D y jitter de clic.
 */
function renderSyntheticRectified(spec: SynthFurnitureSpec): {
  rgba: Uint8ClampedArray;
  W: number;
  H: number;
} {
  const { width: W, height: H } = computeRectifiedSize(spec.xMm, spec.yMm, spec.eMm);
  const rgba = new Uint8ClampedArray(W * H * 4);
  const rng = createRng(spec.seed ?? 42);
  const tPx = Math.max(3, Math.round((spec.eMm / spec.xMm) * W));
  const tPy = Math.max(3, Math.round((spec.eMm / spec.yMm) * H));

  // 1. Fondo hueco interior con gradiente de iluminación lateral + ruido
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const grad = 0.88 + 0.24 * (x / W); // gradiente lateral fuerte
      const noise = (rng() - 0.5) * 8;
      const idx = (y * W + x) * 4;
      rgba[idx] = Math.max(0, Math.min(255, Math.round(spec.cavityRgb[0] * grad + noise)));
      rgba[idx + 1] = Math.max(0, Math.min(255, Math.round(spec.cavityRgb[1] * grad + noise)));
      rgba[idx + 2] = Math.max(0, Math.min(255, Math.round(spec.cavityRgb[2] * grad + noise)));
      rgba[idx + 3] = 255;
    }
  }

  const paintRect = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    rgb: [number, number, number],
    shadeFactor = 1.0,
  ): void => {
    const ix0 = Math.max(0, Math.floor(x0));
    const iy0 = Math.max(0, Math.floor(y0));
    const ix1 = Math.min(W, Math.ceil(x1));
    const iy1 = Math.min(H, Math.ceil(y1));
    for (let y = iy0; y < iy1; y++) {
      for (let x = ix0; x < ix1; x++) {
        const grad = (0.88 + 0.24 * (x / W)) * shadeFactor;
        const noise = (rng() - 0.5) * 6;
        const idx = (y * W + x) * 4;
        rgba[idx] = Math.max(0, Math.min(255, Math.round(rgb[0] * grad + noise)));
        rgba[idx + 1] = Math.max(0, Math.min(255, Math.round(rgb[1] * grad + noise)));
        rgba[idx + 2] = Math.max(0, Math.min(255, Math.round(rgb[2] * grad + noise)));
        rgba[idx + 3] = 255;
      }
    }
  };

  // 2. Objetos aleatorios (libros / ropa) dentro de los huecos (colores variados)
  if (spec.addObjects) {
    for (let k = 0; k < 14; k++) {
      const ox = tPx + 8 + rng() * (W - 2 * tPx - 60);
      const oy = tPy + 8 + rng() * (H - 2 * tPy - 60);
      const ow = 14 + rng() * 34;
      const oh = 18 + rng() * 45;
      const objRgb: [number, number, number] = [
        Math.round(40 + rng() * 140),
        Math.round(40 + rng() * 140),
        Math.round(40 + rng() * 140),
      ];
      paintRect(ox, oy, ox + ow, oy + oh, objRgb, 0.9);
    }
  }

  // 3. Carcasa exterior (4 bordes)
  paintRect(0, 0, W, tPy, spec.boardRgb); // Cubierta
  paintRect(0, H - tPy, W, H, spec.boardRgb); // Base
  paintRect(0, 0, tPx, H, spec.boardRgb); // Lat izq
  paintRect(W - tPx, 0, W, H, spec.boardRgb); // Lat der

  // Jitter de clic en borde izquierdo (contamina franja externa con pared oscura)
  if (spec.jitterLeftPx && spec.jitterLeftPx > 0) {
    paintRect(0, 0, spec.jitterLeftPx, H, [60, 65, 72], 1.0);
  }

  // 4. Repisas horizontales (+ cara superior/inferior visible por paralaje real)
  const camDist = spec.parallaxCamDistMm ?? 0;
  for (const sh of spec.shelves) {
    const vExt = interiorToExterior(sh.vInt, spec.eMm, spec.yMm);
    const yCenter = (1 - vExt) * H;
    const yTop = yCenter - tPy / 2;
    const yBot = yCenter + tPy / 2;

    const uSExt = interiorToExterior(sh.uStart, spec.eMm, spec.xMm);
    const uEExt = interiorToExterior(sh.uEnd, spec.eMm, spec.xMm);
    const x0 = uSExt * W;
    const x1 = uEExt * W;

    // Cara expuesta por paralaje (cámara centrada a v=0.5, distancia camDist)
    if (camDist > 0) {
      const dyFromCenterMm = (0.5 - vExt) * spec.yMm;
      const parallaxMm = (Math.abs(dyFromCenterMm) * spec.depthMm) / (camDist + spec.depthMm);
      const parPx = (parallaxMm / spec.yMm) * H;
      if (vExt < 0.5) {
        // Bajo horizonte: se ve cara superior ARRIBA del canto frontal
        paintRect(x0, yTop - parPx, x1, yTop, spec.boardRgb, 0.92);
      } else if (vExt > 0.5) {
        // Sobre horizonte: se ve cara inferior ABAJO del canto frontal
        paintRect(x0, yBot, x1, yBot + parPx, spec.boardRgb, 0.88);
      }
    }

    // Canto frontal exacto de 18 mm
    paintRect(x0, yTop, x1, yBot, spec.boardRgb, 1.0);
  }

  // 5. Divisores verticales continuos (+ cara lateral expuesta por paralaje)
  for (const uInt of spec.dividersUInt) {
    const uExt = interiorToExterior(uInt, spec.eMm, spec.xMm);
    const xCenter = uExt * W;
    const xL = xCenter - tPx / 2;
    const xR = xCenter + tPx / 2;

    if (camDist > 0) {
      const dxFromCenterMm = (uExt - 0.5) * spec.xMm;
      const parallaxMm = (Math.abs(dxFromCenterMm) * spec.depthMm) / (camDist + spec.depthMm);
      const parPx = (parallaxMm / spec.xMm) * W;
      if (uExt < 0.5) {
        paintRect(xR, tPy, xR + parPx, H - tPy, spec.boardRgb, 0.9);
      } else if (uExt > 0.5) {
        paintRect(xL - parPx, tPy, xL, H - tPy, spec.boardRgb, 0.9);
      }
    }

    paintRect(xL, tPy, xR, H - tPy, spec.boardRgb, 1.0);
  }

  return { rgba, W, H };
}

describe('SmartFurniture Módulo Visión Offline (`src/core/vision/`) — v3.0', () => {
  it('Escenario 1: Estantería 800×1800, 4 repisas, libros -> 4/4 repisas, error <= 5 mm', () => {
    const vTargets = [0.2, 0.4, 0.6, 0.8];
    const { rgba, W, H } = renderSyntheticRectified({
      xMm: 800,
      yMm: 1800,
      depthMm: 320,
      eMm: 18,
      boardRgb: [225, 220, 212],
      cavityRgb: [58, 62, 70],
      dividersUInt: [],
      shelves: vTargets.map((v) => ({ vInt: v, uStart: 0, uEnd: 1 })),
      addObjects: true,
      seed: 101,
    });

    const res = analyzeRectifiedFurniture(rgba, W, H, { x: 800, y: 1800 }, 18);
    expect(res.confidence).toBeGreaterThanOrEqual(0.5);
    expect(res.vDividers).toHaveLength(0);
    expect(res.hShelves).toHaveLength(4);
    for (let i = 0; i < vTargets.length; i++) {
      const errMm = Math.abs(res.hShelves[i].position - vTargets[i]) * (1800 - 36);
      expect(errMm).toBeLessThanOrEqual(5);
    }
  });

  it('Escenario 2: Rack TV 1600×550, vano mixto (2 div + 1 repisa central)', () => {
    const { rgba, W, H } = renderSyntheticRectified({
      xMm: 1600,
      yMm: 550,
      depthMm: 400,
      eMm: 18,
      boardRgb: [200, 170, 130],
      cavityRgb: [48, 52, 58],
      dividersUInt: [1 / 3, 2 / 3],
      shelves: [{ vInt: 0.5, uStart: 1 / 3, uEnd: 2 / 3 }],
      addObjects: true,
      seed: 202,
    });

    const res = analyzeRectifiedFurniture(rgba, W, H, { x: 1600, y: 550 }, 18);
    expect(res.confidence).toBeGreaterThanOrEqual(0.5);
    expect(res.vDividers).toHaveLength(2);
    expect(res.hShelves).toHaveLength(1);
    expect(Math.abs(res.vDividers[0].position - 1 / 3) * 1564).toBeLessThanOrEqual(5);
    expect(Math.abs(res.vDividers[1].position - 2 / 3) * 1564).toBeLessThanOrEqual(5);
    expect(Math.abs(res.hShelves[0].position - 0.5) * 514).toBeLessThanOrEqual(5);
  });

  it('Escenario 3: Clóset 1500×2100 (1 div + 3 izq + 1 der) con ropa', () => {
    const { rgba, W, H } = renderSyntheticRectified({
      xMm: 1500,
      yMm: 2100,
      depthMm: 550,
      eMm: 18,
      boardRgb: [232, 232, 232],
      cavityRgb: [62, 66, 74],
      dividersUInt: [0.5],
      shelves: [
        { vInt: 0.25, uStart: 0, uEnd: 0.5 },
        { vInt: 0.5, uStart: 0, uEnd: 0.5 },
        { vInt: 0.75, uStart: 0, uEnd: 0.5 },
        { vInt: 0.82, uStart: 0.5, uEnd: 1 },
      ],
      addObjects: true,
      seed: 303,
    });

    const res = analyzeRectifiedFurniture(rgba, W, H, { x: 1500, y: 2100 }, 18);
    expect(res.confidence).toBeGreaterThanOrEqual(0.5);
    expect(res.vDividers).toHaveLength(1);
    expect(res.hShelves).toHaveLength(4);
  });

  it('Escenario 4: Melamina grafito oscuro 800×1800, 3 repisas', () => {
    const vTargets = [0.25, 0.5, 0.75];
    const { rgba, W, H } = renderSyntheticRectified({
      xMm: 800,
      yMm: 1800,
      depthMm: 320,
      eMm: 18,
      boardRgb: [46, 50, 56],
      cavityRgb: [165, 168, 172],
      dividersUInt: [],
      shelves: vTargets.map((v) => ({ vInt: v, uStart: 0, uEnd: 1 })),
      seed: 404,
    });

    const res = analyzeRectifiedFurniture(rgba, W, H, { x: 800, y: 1800 }, 18);
    expect(res.confidence).toBeGreaterThanOrEqual(0.5);
    expect(res.hShelves).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(res.hShelves[i].position - vTargets[i]) * 1764).toBeLessThanOrEqual(5);
    }
  });

  it('Escenario 5: Paralaje 3D real — Clóset 1500×2100×550 a 3 m (caras visibles ~100 mm) sin sesgo', () => {
    const { rgba, W, H } = renderSyntheticRectified({
      xMm: 1500,
      yMm: 2100,
      depthMm: 550,
      eMm: 18,
      boardRgb: [228, 224, 218],
      cavityRgb: [55, 58, 66],
      dividersUInt: [0.5],
      shelves: [
        { vInt: 0.25, uStart: 0, uEnd: 0.5 },
        { vInt: 0.5, uStart: 0, uEnd: 0.5 },
        { vInt: 0.75, uStart: 0, uEnd: 0.5 },
        { vInt: 0.82, uStart: 0.5, uEnd: 1 },
      ],
      parallaxCamDistMm: 3000,
      seed: 505,
    });

    const res = analyzeRectifiedFurniture(rgba, W, H, { x: 1500, y: 2100 }, 18, {
      parallaxAware: true,
      horizonV: 0.5,
    });
    expect(res.confidence).toBeGreaterThanOrEqual(0.5);
    expect(res.vDividers).toHaveLength(1);
    expect(res.hShelves).toHaveLength(4);
    const lowestLeft = res.hShelves.find((s) => s.start < 0.1 && s.position < 0.35)!;
    expect(Math.abs(lowestLeft.position - 0.25) * 2064).toBeLessThanOrEqual(8);
  });

  it('Escenario 6: Jitter de clic (3 px borde izq) + paralaje Estantería 320 mm -> 4/4 repisas', () => {
    const vTargets = [0.2, 0.4, 0.6, 0.8];
    const { rgba, W, H } = renderSyntheticRectified({
      xMm: 800,
      yMm: 1800,
      depthMm: 320,
      eMm: 18,
      boardRgb: [222, 216, 206],
      cavityRgb: [54, 58, 65],
      dividersUInt: [],
      shelves: vTargets.map((v) => ({ vInt: v, uStart: 0, uEnd: 1 })),
      parallaxCamDistMm: 3000,
      jitterLeftPx: 3,
      seed: 606,
    });

    const res = analyzeRectifiedFurniture(rgba, W, H, { x: 800, y: 1800 }, 18);
    expect(res.confidence).toBeGreaterThanOrEqual(0.5);
    expect(res.hShelves).toHaveLength(4);
  });

  it('Escenario 7: Melamina roble con MISMA luminancia que el hueco -> resuelta por canal croma RGBA', () => {
    // Roble (175, 130, 80) -> L = 137.8 ; Hueco gris (138, 138, 138) -> L = 138.0 (misma luminancia!)
    const vTargets = [0.2, 0.4, 0.6, 0.8];
    const { rgba, W, H } = renderSyntheticRectified({
      xMm: 800,
      yMm: 1800,
      depthMm: 320,
      eMm: 18,
      boardRgb: [175, 130, 80],
      cavityRgb: [138, 138, 138],
      dividersUInt: [],
      shelves: vTargets.map((v) => ({ vInt: v, uStart: 0, uEnd: 1 })),
      seed: 707,
    });

    const res = analyzeRectifiedFurniture(rgba, W, H, { x: 800, y: 1800 }, 18);
    expect(res.confidence).toBeGreaterThanOrEqual(0.7);
    expect(res.interiorMatch).toBeLessThan(0.25);
    expect(res.hShelves).toHaveLength(4);
  });

  it('Escenario 8 (Estrés honesto): Blanco sobre blanco (224 vs 204) -> marcado NO CONFIABLE (< 0.5)', () => {
    const { rgba, W, H } = renderSyntheticRectified({
      xMm: 800,
      yMm: 1800,
      depthMm: 320,
      eMm: 18,
      boardRgb: [224, 224, 224],
      cavityRgb: [204, 204, 204],
      dividersUInt: [],
      shelves: [{ vInt: 0.5, uStart: 0, uEnd: 1 }],
      seed: 808,
    });

    const res = analyzeRectifiedFurniture(rgba, W, H, { x: 800, y: 1800 }, 18);
    expect(res.confidence).toBeLessThan(0.5);
    expect(res.interiorMatch).toBeGreaterThan(0.5);
  });

  it('Zhang con focal fija 26 mm en clóset 1500×2100 inclinado 15° (error < 3%) y extrapolación por 1 medida', () => {
    // Proyección pinhole exacta de un rectángulo 1500×2100 inclinado 15° en pitch a 3500 mm
    const imgW = 1000;
    const imgH = 750;
    const f = (26 / 43.27) * Math.hypot(imgW, imgH);
    const pitch = (15 * Math.PI) / 180;
    const Wmm = 1500;
    const Hmm = 2100;
    const D = 3500;

    const project = (X: number, Y: number): Point2D => {
      // Rotación alrededor del eje X (pitch)
      const Yc = Y * Math.cos(pitch);
      const Zc = D + Y * Math.sin(pitch);
      return {
        x: imgW / 2 + (f * X) / Zc,
        y: imgH / 2 - (f * Yc) / Zc,
      };
    };

    const quad: [Point2D, Point2D, Point2D, Point2D] = [
      project(-Wmm / 2, Hmm / 2),  // TL
      project(Wmm / 2, Hmm / 2),   // TR
      project(Wmm / 2, -Hmm / 2),  // BR
      project(-Wmm / 2, -Hmm / 2), // BL
    ];

    const estRatio = estimateAspectRatioFixedFocal(quad, imgW, imgH, 26);
    const trueRatio = Wmm / Hmm;
    const relErr = Math.abs(estRatio - trueRatio) / trueRatio;
    expect(relErr).toBeLessThan(0.03);

    // Extrapolación desde 1 sola medida confirmada (ancho = 1500 mm -> alto ≈ 2100 mm)
    const ext = extrapolateDimensionsFromSingleMeasure(estRatio, 'x', 1500, 550);
    expect(ext.x).toBe(1500);
    expect(Math.abs(ext.y - 2100)).toBeLessThan(65);
    expect(ext.z).toBe(550);
  });

  it('rectifyImageRGBA corrige una imagen inclinada preservando el contraste superior/inferior', () => {
    const srcW = 200;
    const srcH = 200;
    const src = new Uint8ClampedArray(srcW * srcH * 4);
    // Pintar mitad superior roja y mitad inferior azul
    for (let y = 0; y < srcH; y++) {
      for (let x = 0; x < srcW; x++) {
        const i = (y * srcW + x) * 4;
        src[i] = y < 100 ? 220 : 20;
        src[i + 1] = 30;
        src[i + 2] = y < 100 ? 20 : 220;
        src[i + 3] = 255;
      }
    }
    const quad: [Point2D, Point2D, Point2D, Point2D] = [
      { x: 30, y: 20 },
      { x: 170, y: 25 },
      { x: 185, y: 180 },
      { x: 15, y: 175 },
    ];
    const hom = computeQuadToUnitHomography(quad)!;
    const rect = rectifyImageRGBA(src, srcW, srcH, hom.toCanvas, 60, 60);
    // Fila superior (cubierta) debe ser roja; fila inferior (base) azul
    const topIdx = (5 * 60 + 30) * 4;
    const botIdx = (54 * 60 + 30) * 4;
    expect(rect[topIdx]).toBeGreaterThan(180);
    expect(rect[botIdx + 2]).toBeGreaterThan(180);
  });

  it('Escenario 9 (Mueble Cerrado Real — Buffet 3 puertas con molduras + 3 cajones + 6 tiradores): ignora molduras y detecta juntas y tiradores', () => {
    const W = 600;
    const H = 270;
    const rgba = new Uint8ClampedArray(W * H * 4);
    const rng = createRng(909);

    // Base madera natural uniforme (roble/pino)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const grad = 0.92 + 0.14 * (x / W);
        const noise = (rng() - 0.5) * 6;
        const i = (y * W + x) * 4;
        rgba[i] = Math.min(255, Math.round(188 * grad + noise));
        rgba[i + 1] = Math.min(255, Math.round(138 * grad + noise));
        rgba[i + 2] = Math.min(255, Math.round(82 * grad + noise));
        rgba[i + 3] = 255;
      }
    }

    const drawRect = (x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]) => {
      for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) {
        for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) {
          const i = (y * W + x) * 4;
          rgba[i] = rgb[0];
          rgba[i + 1] = rgb[1];
          rgba[i + 2] = rgb[2];
          rgba[i + 3] = 255;
        }
      }
    };

    // 3 juntas verticales continuas de punta a punta (x = 150, 300, 450)
    for (const vx of [150, 300, 450]) {
      drawRect(vx - 1, 0, vx + 2, H, [42, 28, 16]);
    }
    // Molduras decorativas DENTRO de las 3 puertas (NO llegan a los bordes superior/inferior!)
    for (const [dx0, dx1] of [[0, 150], [150, 300], [300, 450]]) {
      drawRect(dx0 + 24, 38, dx0 + 27, H - 38, [95, 65, 36]);
      drawRect(dx1 - 27, 38, dx1 - 24, H - 38, [95, 65, 36]);
      drawRect(dx0 + 24, 38, dx1 - 24, 41, [95, 65, 36]);
      drawRect(dx0 + 24, H - 41, dx1 - 24, H - 38, [95, 65, 36]);
    }
    // 2 juntas horizontales de cajones SOLO en la columna derecha [450..600]
    drawRect(450, 89, W, 92, [38, 25, 14]);
    drawRect(450, 179, W, 182, [38, 25, 14]);

    // 6 tiradores metálicos oscuros (3 puertas + 3 cajones)
    drawRect(130, 118, 138, 154, [24, 22, 20]); // Puerta 1
    drawRect(162, 118, 170, 154, [24, 22, 20]); // Puerta 2
    drawRect(316, 118, 324, 154, [24, 22, 20]); // Puerta 3
    drawRect(512, 42, 544, 49, [24, 22, 20]);   // Cajón 1
    drawRect(512, 132, 544, 139, [24, 22, 20]); // Cajón 2
    drawRect(512, 222, 544, 229, [24, 22, 20]); // Cajón 3

    const res = analyzeRectifiedFurniture(rgba, W, H, { x: 1800, y: 800 }, 18);
    expect(res.furnitureMode).toBe('closed_front');
    expect(res.confidence).toBeGreaterThanOrEqual(0.7);
    expect(res.vDividers).toHaveLength(3);
    expect(res.hShelves).toHaveLength(2);
    // Ambas repisas/divisiones horizontales están en el vano derecho [~0.75..1]
    for (const sh of res.hShelves) {
      expect(sh.start).toBeGreaterThan(0.7);
      expect(sh.end).toBeCloseTo(1, 2);
    }
    expect(res.detectedHandles).toHaveLength(6);
  });

  it('Escenario 10 (Multinivel Mixto v3.3 — 3 cubículos abiertos sup + 2 puertas nogal inf con zócalo): detecta nivel horizontal + 3 divisores parciales', () => {
    const W = 360;
    const H = 540;
    const rgba = new Uint8ClampedArray(W * H * 4);
    const rng = createRng(1010);

    const paint = (x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]) => {
      for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) {
        for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) {
          const n = (rng() - 0.5) * 5;
          const i = (y * W + x) * 4;
          rgba[i] = Math.max(0, Math.min(255, Math.round(rgb[0] + n)));
          rgba[i + 1] = Math.max(0, Math.min(255, Math.round(rgb[1] + n)));
          rgba[i + 2] = Math.max(0, Math.min(255, Math.round(rgb[2] + n)));
          rgba[i + 3] = 255;
        }
      }
    };

    // Carcasa grafito exterior + nivel superior abierto (v ∈ [0.66..1.0] => y ∈ [0..183])
    paint(0, 0, W, H, [96, 98, 102]);
    // Cavidades oscuras superiores (3 cubículos separados por 2 cantos grafito)
    paint(12, 12, 118, 178, [34, 36, 40]);
    paint(128, 12, 232, 178, [34, 36, 40]);
    paint(242, 12, W - 12, 178, [34, 36, 40]);
    // Nivel inferior: 2 puertas nogal con ranura central + zócalo grafito continuo abajo
    paint(10, 186, W - 10, H - 36, [118, 76, 48]);
    paint(179, 186, 182, H - 36, [24, 16, 10]); // ranura vertical entre puertas
    paint(0, H - 36, W, H, [96, 98, 102]); // zócalo inferior

    const res = analyzeRectifiedFurniture(rgba, W, H, { x: 800, y: 1200 }, 18);
    expect(res.furnitureMode).toBe('mixed');
    expect(res.confidence).toBeGreaterThanOrEqual(0.65);
    expect(res.hShelves.length).toBeGreaterThanOrEqual(1);
    expect(res.vDividers.length).toBe(3);
    // Verificar presencia de zonas abiertas arriba y puertas abajo
    expect(res.detectedZones?.some((z) => z.kind === 'open')).toBe(true);
    expect(res.detectedZones?.some((z) => z.kind === 'door_left' || z.kind === 'door_right')).toBe(true);
  });

  it('Escenario 11 (Bicolor Blanco + Roble v3.3 — 2 puertas blancas + 3 cajones mixtos): detecta escalón de color y ranuras sutiles', () => {
    const W = 540;
    const H = 220;
    const rgba = new Uint8ClampedArray(W * H * 4);
    const rng = createRng(1111);

    const paint = (x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]) => {
      for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) {
        for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) {
          const n = (rng() - 0.5) * 4;
          const i = (y * W + x) * 4;
          rgba[i] = Math.max(0, Math.min(255, Math.round(rgb[0] + n)));
          rgba[i + 1] = Math.max(0, Math.min(255, Math.round(rgb[1] + n)));
          rgba[i + 2] = Math.max(0, Math.min(255, Math.round(rgb[2] + n)));
          rgba[i + 3] = 255;
        }
      }
    };

    // Frente blanco uniforme
    paint(0, 0, W, H, [238, 238, 238]);
    // Cajón superior derecho en roble cálido (bicolor!)
    paint(360, 4, W - 4, 74, [202, 168, 122]);
    // Ranura sutil blanco-sobre-blanco entre puerta 1 y puerta 2 (x = 180)
    paint(179, 0, 181, H, [170, 170, 170]);
    // Ranura sutil bajo el cajón roble entre puerta 2 y cajones blancos (x = 360, y = 74..H)
    paint(359, 74, 361, H, [170, 170, 170]);
    // Ranura horizontal sutil entre cajón 2 y cajón 3 (y = 148, x = 360..W)
    paint(360, 147, W, 149, [168, 168, 168]);

    const res = analyzeRectifiedFurniture(rgba, W, H, { x: 1600, y: 640 }, 18);
    expect(res.furnitureMode).toBe('closed_front');
    expect(res.confidence).toBeGreaterThanOrEqual(0.65);
    expect(res.vDividers).toHaveLength(2);
    expect(res.hShelves).toHaveLength(2);
    expect(res.detectedZones?.some((z) => z.kind === 'drawers' && z.drawerCount === 3)).toBe(true);
  });
});
