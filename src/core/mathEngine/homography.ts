/**
 * Álgebra lineal pura para Homografía Proyectiva 3×3 y su inversa.
 * Cero dependencias externas. 100% determinista y offline.
 */
import type { Point2D } from '../../types/contracts';

export type Matrix3x3 = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
];

const EPSILON = 1e-10;

/**
 * Resuelve un sistema lineal A·x = b (n×n) mediante eliminación gaussiana con pivoteo parcial.
 * Retorna null si la matriz es singular o mal condicionada.
 */
function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const aug: number[][] = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let maxAbs = Math.abs(aug[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(aug[r][col]);
      if (v > maxAbs) {
        maxAbs = v;
        pivotRow = r;
      }
    }

    if (maxAbs < EPSILON) {
      return null;
    }

    if (pivotRow !== col) {
      const tmp = aug[col];
      aug[col] = aug[pivotRow];
      aug[pivotRow] = tmp;
    }

    const pivotVal = aug[col][col];
    for (let r = col + 1; r < n; r++) {
      const factor = aug[r][col] / pivotVal;
      for (let c = col; c <= n; c++) {
        aug[r][c] -= factor * aug[col][c];
      }
    }
  }

  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let sum = aug[r][n];
    for (let c = r + 1; c < n; c++) {
      sum -= aug[r][c] * x[c];
    }
    const diag = aug[r][r];
    if (Math.abs(diag) < EPSILON) {
      return null;
    }
    x[r] = sum / diag;
  }

  return x;
}

/**
 * Verifica que ningún subconjunto de 3 puntos de un cuadrilátero sea colineal.
 */
function hasCollinearTriple(pts: readonly [Point2D, Point2D, Point2D, Point2D]): boolean {
  const triples: readonly [number, number, number][] = [
    [0, 1, 2],
    [0, 1, 3],
    [0, 2, 3],
    [1, 2, 3],
  ];
  for (const [i, j, k] of triples) {
    const a = pts[i];
    const b = pts[j];
    const c = pts[k];
    const cross = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
    if (cross < 1e-6) {
      return true;
    }
  }
  return false;
}

/**
 * Calcula la matriz de homografía 3×3 que mapea 4 puntos `src` a 4 puntos `dst`
 * resolviendo el sistema lineal 8×8 con h33 = 1.
 */
export function computeHomography(
  src: readonly [Point2D, Point2D, Point2D, Point2D],
  dst: readonly [Point2D, Point2D, Point2D, Point2D],
): Matrix3x3 | null {
  if (hasCollinearTriple(src) || hasCollinearTriple(dst)) {
    return null;
  }

  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }

  const h = solveLinearSystem(A, b);
  if (!h) {
    return null;
  }

  const H: Matrix3x3 = [
    [h[0], h[1], h[2]],
    [h[3], h[4], h[5]],
    [h[6], h[7], 1],
  ];

  if (!invertMatrix3x3(H)) {
    return null;
  }

  return H;
}

/**
 * Calcula la inversa de una matriz 3×3 por matriz adjunta / cofactores.
 * Retorna null si |det(H)| < 1e-10.
 */
export function invertMatrix3x3(H: readonly (readonly number[])[]): Matrix3x3 | null {
  const a = H[0][0], b = H[0][1], c = H[0][2];
  const d = H[1][0], e = H[1][1], f = H[1][2];
  const g = H[2][0], h = H[2][1], i = H[2][2];

  const c00 = e * i - f * h;
  const c01 = -(d * i - f * g);
  const c02 = d * h - e * g;

  const det = a * c00 + b * c01 + c * c02;
  if (!Number.isFinite(det) || Math.abs(det) < EPSILON) {
    return null;
  }

  const invDet = 1 / det;
  const c10 = -(b * i - c * h);
  const c11 = a * i - c * g;
  const c12 = -(a * h - b * g);
  const c20 = b * f - c * e;
  const c21 = -(a * f - c * d);
  const c22 = a * e - b * d;

  return [
    [c00 * invDet, c10 * invDet, c20 * invDet],
    [c01 * invDet, c11 * invDet, c21 * invDet],
    [c02 * invDet, c12 * invDet, c22 * invDet],
  ];
}

/**
 * Calcula las homografías duales entre un cuadrilátero de foto en orden horario estricto
 * `[TL, TR, BR, BL]` y el espacio normalizado exterior `[(0,1), (1,1), (1,0), (0,0)]`
 * (eje Y invertido: v = 0 en base, v = 1 en cubierta).
 */
export function computeQuadToUnitHomography(
  quadCorners: readonly [Point2D, Point2D, Point2D, Point2D],
): { toUnit: Matrix3x3; toCanvas: Matrix3x3 } | null {
  const unitCorners: readonly [Point2D, Point2D, Point2D, Point2D] = [
    { x: 0, y: 1 }, // TL -> (0, 1)
    { x: 1, y: 1 }, // TR -> (1, 1)
    { x: 1, y: 0 }, // BR -> (1, 0)
    { x: 0, y: 0 }, // BL -> (0, 0)
  ];

  const toUnit = computeHomography(quadCorners, unitCorners);
  if (!toUnit) {
    return null;
  }
  const toCanvas = invertMatrix3x3(toUnit);
  if (!toCanvas) {
    return null;
  }
  return { toUnit, toCanvas };
}

/**
 * Aplica una homografía 3×3 a un punto 2D mediante división homogénea segura.
 */
export function applyHomography(
  H: readonly (readonly number[])[],
  pt: Point2D,
): Point2D | null {
  const x = H[0][0] * pt.x + H[0][1] * pt.y + H[0][2];
  const y = H[1][0] * pt.x + H[1][1] * pt.y + H[1][2];
  const w = H[2][0] * pt.x + H[2][1] * pt.y + H[2][2];

  if (!Number.isFinite(w) || Math.abs(w) < EPSILON) {
    return null;
  }
  return { x: x / w, y: y / w };
}
