/**
 * SMARTFURNITURE — RECTIFICACIÓN DE PERSPECTIVA Y ESTIMACIÓN DE RELACIÓN W/H (v3.0)
 * 100% offline, álgebra pura, cero dependencias externas, sin parser EXIF.
 */
import type { Point2D } from '../../types/contracts';
import {
  applyHomography,
  computeQuadToUnitHomography,
  type Matrix3x3,
} from '../mathEngine/homography';

/**
 * Estima la relación de aspecto real W/H del mueble usando la fórmula vectorial de Zhang
 * con distancia focal fija típica de cámara de celular (26 mm eq. en 1×, 52 mm eq. en 2×).
 * Evita la degeneración de f² < 0 observada en ~43% de fotos de clóset al estimar f.
 */
export function estimateAspectRatioFixedFocal(
  quadCorners: readonly [Point2D, Point2D, Point2D, Point2D],
  imgW: number,
  imgH: number,
  focal35mm = 26,
): number {
  const [tl, tr, br, bl] = quadCorners;
  const topLen = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const botLen = Math.hypot(br.x - bl.x, br.y - bl.y);
  const leftLen = Math.hypot(bl.x - tl.x, bl.y - tl.y);
  const rightLen = Math.hypot(br.x - tr.x, br.y - tr.y);
  const avgW = (topLen + botLen) / 2;
  const avgH = (leftLen + rightLen) / 2;
  const euclidFallback = avgH > 1e-6 ? avgW / avgH : 1;

  const hom = computeQuadToUnitHomography(quadCorners);
  if (!hom || imgW <= 0 || imgH <= 0 || focal35mm <= 0) {
    return euclidFallback;
  }

  // toCanvas mapea el cuadrado unitario (u: ancho, v: alto) -> píxeles de la foto
  const H = hom.toCanvas;
  const cx = imgW / 2;
  const cy = imgH / 2;
  const f = (focal35mm / 43.27) * Math.hypot(imgW, imgH);
  if (!Number.isFinite(f) || f <= 1) {
    return euclidFallback;
  }

  // r1 = K^-1 · h1, r2 = K^-1 · h2
  const h10 = H[0][0], h11 = H[1][0], h12 = H[2][0];
  const h20 = H[0][1], h21 = H[1][1], h22 = H[2][1];

  const r1x = (h10 - cx * h12) / f;
  const r1y = (h11 - cy * h12) / f;
  const r1z = h12;

  const r2x = (h20 - cx * h22) / f;
  const r2y = (h21 - cy * h22) / f;
  const r2z = h22;

  const norm1 = Math.hypot(r1x, r1y, r1z);
  const norm2 = Math.hypot(r2x, r2y, r2z);
  if (!Number.isFinite(norm1) || !Number.isFinite(norm2) || norm2 < 1e-10) {
    return euclidFallback;
  }

  const ratio = norm1 / norm2;
  if (!Number.isFinite(ratio) || ratio <= 0.05 || ratio > 20) {
    return euclidFallback;
  }
  return ratio;
}

/**
 * Extrapola las dimensiones del cuerpo de melamina { x, y, z } en mm a partir de
 * UNA sola medida real confirmada por el usuario (ancho total o alto del cuerpo sin patas).
 */
export function extrapolateDimensionsFromSingleMeasure(
  aspectRatioXY: number,
  knownAxis: 'x' | 'y',
  knownValueMm: number,
  defaultDepthMm = 400,
): { x: number; y: number; z: number } {
  const safeRatio = Number.isFinite(aspectRatioXY) && aspectRatioXY > 0.05 ? aspectRatioXY : 1;
  const safeVal = Math.max(100, knownValueMm);
  const z = Math.round(Math.max(150, defaultDepthMm));

  if (knownAxis === 'x') {
    return {
      x: Math.round(safeVal),
      y: Math.round(safeVal / safeRatio),
      z,
    };
  }
  return {
    x: Math.round(safeVal * safeRatio),
    y: Math.round(safeVal),
    z,
  };
}

/**
 * Calcula las dimensiones óptimas en píxeles para la rectificación del mueble,
 * garantizando >= 6 px por canto de melamina (18 mm) y acotando uso de RAM local.
 */
export function computeRectifiedSize(
  xMm: number,
  yMm: number,
  eMm: number,
): { width: number; height: number } {
  const safeX = Math.max(200, xMm);
  const safeY = Math.max(200, yMm);
  const safeE = Math.max(6, eMm);
  const width = Math.max(360, Math.min(960, Math.ceil((6 * safeX) / safeE)));
  const height = Math.max(200, Math.min(1200, Math.round((width * safeY) / safeX)));
  return { width, height };
}

/**
 * Rectifica una imagen RGBA usando muestreo bilineal puro vía `toCanvas` (unitario -> foto).
 * Convención de salida: fila 0 = cubierta (v = 1), fila dstH - 1 = base (v = 0).
 */
export function rectifyImageRGBA(
  srcRgba: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  toCanvas: Matrix3x3,
  dstW: number,
  dstH: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dstW * dstH * 4);
  const maxX = srcW - 1;
  const maxY = srcH - 1;

  for (let row = 0; row < dstH; row++) {
    const v = 1 - (row + 0.5) / dstH;
    for (let col = 0; col < dstW; col++) {
      const u = (col + 0.5) / dstW;
      const pt = applyHomography(toCanvas, { x: u, y: v });
      const dstIdx = (row * dstW + col) * 4;

      if (!pt) {
        out[dstIdx + 3] = 255;
        continue;
      }

      const sx = Math.max(0, Math.min(maxX, pt.x));
      const sy = Math.max(0, Math.min(maxY, pt.y));
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(maxX, x0 + 1);
      const y1 = Math.min(maxY, y0 + 1);
      const fx = sx - x0;
      const fy = sy - y0;

      const i00 = (y0 * srcW + x0) * 4;
      const i10 = (y0 * srcW + x1) * 4;
      const i01 = (y1 * srcW + x0) * 4;
      const i11 = (y1 * srcW + x1) * 4;

      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;

      out[dstIdx] = Math.round(
        srcRgba[i00] * w00 + srcRgba[i10] * w10 + srcRgba[i01] * w01 + srcRgba[i11] * w11,
      );
      out[dstIdx + 1] = Math.round(
        srcRgba[i00 + 1] * w00 + srcRgba[i10 + 1] * w10 + srcRgba[i01 + 1] * w01 + srcRgba[i11 + 1] * w11,
      );
      out[dstIdx + 2] = Math.round(
        srcRgba[i00 + 2] * w00 + srcRgba[i10 + 2] * w10 + srcRgba[i01 + 2] * w01 + srcRgba[i11 + 2] * w11,
      );
      out[dstIdx + 3] = 255;
    }
  }

  return out;
}
