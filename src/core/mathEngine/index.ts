/**
 * SMARTFURNITURE — MOTOR MATEMÁTICO PURO v3.0
 * Funciones 100% puras, deterministas, sin dependencias externas ni efectos secundarios.
 * Cubre Unidad 3 (Vectores, Escalamiento Matricial, Progresión Aritmética, Sumatorias)
 * y carpintería real en melamina con aislamiento de herrajes/patas externas.
 */
import type {
  BaseMatrixScaleResult,
  BoardPiece,
  DespieceResult,
  EdgeBandingFlags,
  FurnitureTopology,
  HardwareItem,
  MatrixNx5Row,
  PieceMaterial,
  PieceType,
  ScaleAndBoardParams,
  ShelfProgressionData,
  StructuralAlert,
} from '../../types/contracts';

export {
  applyHomography,
  computeHomography,
  computeQuadToUnitHomography,
  invertMatrix3x3,
} from './homography';
export type { Matrix3x3 } from './homography';
export {
  CHILE_DUROLAC_SHEET,
  CHILE_MELAMINE_SHEET,
  PRESETS,
  clonePreset,
} from './presets';
export type { FurniturePreset, PresetKey } from './presets';

/** Matriz oficial M0 de validación algebraica Etapa 2 (0.8800 m², 6.80 m tapacanto). */
export const ETAPA2_BASE_MATRIX_M0: readonly [number, number, number][] = [
  [800, 400, 18],
  [800, 400, 18],
  [600, 400, 18],
];

const SPAN_WARNING_MM = 850;
const SPAN_CRITICAL_MM = 1050;
const SEGMENT_TOUCH_TOL = 1e-3;
const GEOM_EPS = 1e-4;

function clamp(val: number, min: number, max: number): number {
  if (val < min) return min;
  if (val > max) return max;
  return val;
}

function clamp01(val: number): number {
  return clamp(val, 0, 1);
}

/**
 * Convierte coordenada normalizada EXTERIOR [0,1] -> INTERIOR [0,1] SIN clamp
 * (útil para verificación exacta y detección de puntos fuera del vano interior).
 */
export function exteriorToInteriorRaw(p: number, e: number, dim: number): number {
  const denom = 1 - (2 * e) / dim;
  if (dim <= 0 || Math.abs(denom) < 1e-9) {
    return 0;
  }
  return (p - e / dim) / denom;
}

/**
 * Convierte coordenada normalizada EXTERIOR [0,1] -> INTERIOR [0,1] con clamping seguro.
 */
export function exteriorToInterior(p: number, e: number, dim: number): number {
  return clamp01(exteriorToInteriorRaw(p, e, dim));
}

/**
 * Convierte coordenada normalizada INTERIOR [0,1] -> EXTERIOR [0,1].
 */
export function interiorToExterior(p: number, e: number, dim: number): number {
  if (dim <= 0) {
    return 0;
  }
  return p * (1 - (2 * e) / dim) + e / dim;
}

/**
 * Operador algebraico puro de Etapa 2:
 * Aplica M = M0 · diag(kx, ky, 1) preservando invariante la 3ª columna (espesor e).
 */
export function scaleBaseMatrix(
  M0: readonly [number, number, number][],
  kx: number,
  ky: number,
): BaseMatrixScaleResult {
  const scaledMatrix: [number, number, number][] = M0.map(([w, h, e]) => [
    w * kx,
    h * ky,
    e,
  ]);

  let originalAreaMm2 = 0;
  let scaledAreaMm2 = 0;
  let originalPerimMm = 0;
  let scaledPerimMm = 0;

  for (let i = 0; i < M0.length; i++) {
    const [w0, h0] = M0[i];
    const [w1, h1] = scaledMatrix[i];
    originalAreaMm2 += w0 * h0;
    scaledAreaMm2 += w1 * h1;
    originalPerimMm += 2 * (w0 + h0);
    scaledPerimMm += 2 * (w1 + h1);
  }

  return {
    scaledMatrix,
    originalAreaM2: originalAreaMm2 / 1_000_000,
    scaledAreaM2: scaledAreaMm2 / 1_000_000,
    originalEdgeBandingMeters: originalPerimMm / 1000,
    scaledEdgeBandingMeters: scaledPerimMm / 1000,
  };
}

/**
 * Calcula la progresión aritmética exacta de N repisas equidistantes dentro de H_int = y_f - 2e.
 * `terms[k]` almacena la altura desde el piso de la CARA INFERIOR a_n (centro cy = a_n + e/2).
 */
export function calculateShelfProgression(
  yExteriorMm: number,
  boardThickness: number,
  shelfCount: number,
): ShelfProgressionData {
  const hInteriorMm = yExteriorMm - 2 * boardThickness;
  const count = Math.max(0, Math.floor(shelfCount));

  if (count === 0) {
    return {
      count: 0,
      hInteriorMm,
      clearSpanMm: hInteriorMm,
      a1: 0,
      d: 0,
      terms: [],
    };
  }

  const netSpace = hInteriorMm - count * boardThickness;
  if (hInteriorMm <= 0 || netSpace <= 0) {
    return {
      count,
      hInteriorMm,
      clearSpanMm: netSpace / (count + 1),
      a1: 0,
      d: 0,
      terms: [],
    };
  }

  const clearSpanMm = netSpace / (count + 1);
  const a1 = boardThickness + clearSpanMm;
  const d = clearSpanMm + boardThickness;
  const terms: number[] = [];
  for (let n = 1; n <= count; n++) {
    terms.push(a1 + (n - 1) * d);
  }

  return { count, hInteriorMm, clearSpanMm, a1, d, terms };
}

/**
 * Tabla normativa congelada de tapacanto por tipo de pieza, encuentro y modalidad.
 * `top`/`bottom` miden `ancho`; `left`/`right` miden `alto`.
 */
function resolveEdgeBanding(
  tipo: PieceType,
  joint: ScaleAndBoardParams['cornerJointType'],
  mode: ScaleAndBoardParams['edgeBandingMode'],
): EdgeBandingFlags {
  if (tipo === 'fondo' || tipo === 'fondo_cajon') {
    return { top: false, bottom: false, left: false, right: false };
  }
  if (tipo === 'puerta' || tipo === 'frente_cajon') {
    // Puertas y frentes de cajón siempre llevan tapacanto en sus 4 cantos visibles
    return { top: true, bottom: true, left: true, right: true };
  }
  if (mode === 'fullPerimeter') {
    return { top: true, bottom: true, left: true, right: true };
  }
  // visibleEdgesOnly
  if (tipo === 'costado_cajon' || tipo === 'trasera_cajon') {
    return { top: true, bottom: false, left: false, right: false };
  }
  if (tipo === 'zocalo' || tipo === 'faldon') {
    return { top: true, bottom: true, left: false, right: false };
  }
  if (tipo === 'cubierta' || tipo === 'base') {
    if (joint === 'topOverSides') {
      return { top: true, bottom: false, left: true, right: true };
    }
    return { top: true, bottom: false, left: false, right: false };
  }
  if (tipo === 'lateral') {
    if (joint === 'topOverSides') {
      return { top: true, bottom: false, left: false, right: false };
    }
    return { top: true, bottom: false, left: true, right: true };
  }
  // division_vertical y repisa: solo canto frontal visible
  return { top: true, bottom: false, left: false, right: false };
}

function computePieceEdgeBandingMm(piece: BoardPiece): number {
  let total = 0;
  if (piece.edges.top) total += piece.ancho;
  if (piece.edges.bottom) total += piece.ancho;
  if (piece.edges.left) total += piece.alto;
  if (piece.edges.right) total += piece.alto;
  return total;
}

interface ActiveDividerSpan {
  id: string;
  u: number;
  cx: number;
  y0: number;
  y1: number;
}

interface VirtualShelf {
  id: string;
  labelPrefix: string;
  cy: number;
  uStart: number;
  uEnd: number;
}

function buildHardwareSummary(topology: FurnitureTopology): HardwareItem[] {
  const items: HardwareItem[] = (topology.hardwareItems ?? []).map((item) => ({
    ...item,
  }));

  if (topology.hasExternalLegs) {
    const alreadyHasLegs = items.some((i) => i.categoria === 'patas');
    if (!alreadyHasLegs) {
      const count = Math.max(1, Math.round(topology.externalLegCount ?? 4));
      const heightMm = topology.externalLegHeightMm ?? 150;
      items.unshift({
        id: 'hw_patas_externas',
        categoria: 'patas',
        descripcion: `Patas independientes externas (${heightMm} mm)`,
        cantidad: count,
        medidaReferenciaMm: heightMm,
        notaCompra: `Excluidas del cuerpo de melamina. Adquirir ${count} patas del mismo tipo (${heightMm} mm aprox.) aparte.`,
        origen: topology.detectionSource === 'auto' ? 'detectado' : 'manual',
      });
    }
  }

  return items;
}

/**
 * Calcula el despiece físico 1:1 completo, coordenadas 3D sin solapamiento,
 * matrices n×3 y n×5, alertas estructurales y resumen de herrajes no-melamina.
 */
export function calculateDespiece(
  topology: FurnitureTopology,
  params: ScaleAndBoardParams,
): DespieceResult {
  const { x: xf, y: yf, z: zf } = params.targetDimensions;
  const { x: x0, y: y0, z: z0 } = params.referenceDimensions;
  const e = params.boardThickness;
  const backE = params.backPanelThickness;

  const scaleFactors = {
    kx: x0 > 0 ? xf / x0 : 1,
    ky: y0 > 0 ? yf / y0 : 1,
    kz: z0 > 0 ? zf / z0 : 1,
  };

  const alerts: StructuralAlert[] = [];
  const hardwareSummary = buildHardwareSummary(topology);
  const shelfProgression =
    topology.shelfMode === 'equidistant'
      ? calculateShelfProgression(yf, e, topology.equalShelfCount)
      : calculateShelfProgression(yf, e, 0);

  const xInt = xf - 2 * e;
  const yInt = yf - 2 * e;

  if (xf <= 0 || yf <= 0 || zf <= 0 || e <= 0 || xInt <= 0 || yInt <= 0) {
    alerts.push({
      id: 'alert_dim_invalida_carcasa',
      severidad: 'critical',
      tipo: 'dimension_invalida',
      mensaje: `Dimensiones interiores inválidas (x_int=${xInt.toFixed(1)} mm, y_int=${yInt.toFixed(1)} mm, z_f=${zf.toFixed(1)} mm).`,
      piezaId: 'carcasa',
    });
    return {
      scaleFactors,
      shelfProgression,
      matrizDespiece: [],
      matrixNx3: [],
      matrixNx5: [],
      consolidatedRows: [],
      totalNetAreaM2: 0,
      backPanelAreaM2: 0,
      totalEdgeBandingMeters: 0,
      alerts,
      hardwareSummary,
    };
  }

  if (
    topology.shelfMode === 'equidistant' &&
    topology.equalShelfCount > 0 &&
    shelfProgression.clearSpanMm <= 0
  ) {
    alerts.push({
      id: 'alert_repisas_no_caben',
      severidad: 'critical',
      tipo: 'dimension_invalida',
      mensaje: `No caben ${topology.equalShelfCount} repisas de ${e} mm en una altura interior de ${yInt.toFixed(1)} mm.`,
      piezaId: 'repisas_equidistantes',
    });
  }

  const pieces: BoardPiece[] = [];
  const mat: PieceMaterial = params.material;
  const joint = params.cornerJointType;
  const edgeMode = params.edgeBandingMode;

  // 1. CARCASA EXTERIOR (Base / Bases parciales si hay hueco de piernas, Cubierta, Lateral Izq, Lateral Der)
  const horizWidth = joint === 'topOverSides' ? xf : xInt;
  const sideHeight = joint === 'topOverSides' ? yInt : yf;
  const frontZones = topology.frontZones ?? [];
  const legVoidsAtBottom = frontZones.filter(
    (z) => z.kind === 'leg_void' && z.vStart <= SEGMENT_TOUCH_TOL,
  );

  if (legVoidsAtBottom.length === 0) {
    // Base corrida normal
    pieces.push({
      id: 'base',
      nombre: 'Base',
      tipo: 'base',
      ancho: horizWidth,
      alto: zf,
      espesor: e,
      cantidad: 1,
      respectGrain: true,
      edges: resolveEdgeBanding('base', joint, edgeMode),
      posicion3D: [xf / 2, e / 2, zf / 2],
      dimensiones3D: [horizWidth, e, zf],
      rotacion3D: [0, 0, 0],
      material: mat,
    });
  } else {
    // Escritorios: omitir base en hueco de piernas y colocar faldón estructural trasero
    const sortedVoids = [...legVoidsAtBottom].sort((a, b) => a.uStart - b.uStart);
    let curU = 0;
    let baseIdx = 1;
    for (const v of sortedVoids) {
      if (v.uStart - curU > 0.04) {
        const bx0 = e + curU * xInt;
        const bx1 = e + v.uStart * xInt - e / 2;
        const bw = bx1 - bx0;
        if (bw > e) {
          pieces.push({
            id: `base_pedestal_${baseIdx++}`,
            nombre: `Base Pedestal ${baseIdx - 1}`,
            tipo: 'base',
            ancho: bw,
            alto: zf,
            espesor: e,
            cantidad: 1,
            respectGrain: true,
            edges: resolveEdgeBanding('base', joint, edgeMode),
            posicion3D: [(bx0 + bx1) / 2, e / 2, zf / 2],
            dimensiones3D: [bw, e, zf],
            rotacion3D: [0, 0, 0],
            material: mat,
          });
        }
      }
      // Faldón trasero en el hueco de piernas (parte superior del vano libre)
      const fx0 = e + v.uStart * xInt + (v.uStart > 0.02 ? e / 2 : 0);
      const fx1 = e + v.uEnd * xInt - (v.uEnd < 0.98 ? e / 2 : 0);
      const fw = fx1 - fx0;
      const fTop = e + v.vEnd * yInt - e / 2;
      const fh = Math.max(160, Math.min(360, (v.vEnd - v.vStart) * yInt * 0.45));
      if (fw > 40 && fTop - fh > e) {
        pieces.push({
          id: `faldon_${v.id}`,
          nombre: 'Faldón Trasero Escritorio',
          tipo: 'faldon',
          ancho: fw,
          alto: fh,
          espesor: e,
          cantidad: 1,
          respectGrain: true,
          edges: resolveEdgeBanding('faldon', joint, edgeMode),
          posicion3D: [(fx0 + fx1) / 2, fTop - fh / 2, e / 2],
          dimensiones3D: [fw, fh, e],
          rotacion3D: [0, 0, 0],
          material: mat,
        });
      }
      curU = Math.max(curU, v.uEnd);
    }
    if (1 - curU > 0.04) {
      const bx0 = e + curU * xInt + e / 2;
      const bx1 = xf - e;
      const bw = bx1 - bx0;
      if (bw > e) {
        pieces.push({
          id: `base_pedestal_${baseIdx++}`,
          nombre: `Base Pedestal ${baseIdx - 1}`,
          tipo: 'base',
          ancho: bw,
          alto: zf,
          espesor: e,
          cantidad: 1,
          respectGrain: true,
          edges: resolveEdgeBanding('base', joint, edgeMode),
          posicion3D: [(bx0 + bx1) / 2, e / 2, zf / 2],
          dimensiones3D: [bw, e, zf],
          rotacion3D: [0, 0, 0],
          material: mat,
        });
      }
    }
  }

  // Cubierta
  pieces.push({
    id: 'cubierta',
    nombre: 'Cubierta',
    tipo: 'cubierta',
    ancho: horizWidth,
    alto: zf,
    espesor: e,
    cantidad: 1,
    respectGrain: true,
    edges: resolveEdgeBanding('cubierta', joint, edgeMode),
    posicion3D: [xf / 2, yf - e / 2, zf / 2],
    dimensiones3D: [horizWidth, e, zf],
    rotacion3D: [0, 0, 0],
    material: mat,
  });

  // Laterales (ancho = sideHeight veta VERTICAL en eje Y, alto = zf profundidad)
  pieces.push({
    id: 'lateral_izq',
    nombre: 'Lateral Izquierdo',
    tipo: 'lateral',
    ancho: sideHeight,
    alto: zf,
    espesor: e,
    cantidad: 1,
    respectGrain: true,
    edges: resolveEdgeBanding('lateral', joint, edgeMode),
    posicion3D: [e / 2, yf / 2, zf / 2],
    dimensiones3D: [e, sideHeight, zf],
    rotacion3D: [0, 0, 0],
    material: mat,
  });

  pieces.push({
    id: 'lateral_der',
    nombre: 'Lateral Derecho',
    tipo: 'lateral',
    ancho: sideHeight,
    alto: zf,
    espesor: e,
    cantidad: 1,
    respectGrain: true,
    edges: resolveEdgeBanding('lateral', joint, edgeMode),
    posicion3D: [xf - e / 2, yf / 2, zf / 2],
    dimensiones3D: [e, sideHeight, zf],
    rotacion3D: [0, 0, 0],
    material: mat,
  });

  // 2. DIVISORES VERTICALES (con sanitización anti-colisión lateral)
  const minMarginU = Math.min(0.49, (e / 2) / xInt);
  const sortedDivs = [...topology.vDividers].sort((a, b) => a.position - b.position);
  const activeDividers: ActiveDividerSpan[] = [];

  for (let i = 0; i < sortedDivs.length; i++) {
    const seg = sortedDivs[i];
    const u = clamp(seg.position, minMarginU, 1 - minMarginU);
    const vStart = clamp01(Math.min(seg.start, seg.end));
    const vEnd = clamp01(Math.max(seg.start, seg.end));
    const divY0 = e + vStart * yInt;
    const divY1 = e + vEnd * yInt;
    const dy = divY1 - divY0;
    const cx = e + u * xInt;

    if (dy <= GEOM_EPS) {
      alerts.push({
        id: `alert_div_invalido_${seg.id}`,
        severidad: 'critical',
        tipo: 'dimension_invalida',
        mensaje: `Divisor vertical "${seg.id}" descartado por altura nula o negativa.`,
        piezaId: seg.id,
      });
      continue;
    }

    // Evitar colisión con otro divisor colocado a menos de `e` mm en el mismo rango Y
    const collides = activeDividers.some(
      (prev) =>
        Math.abs(cx - prev.cx) < e - GEOM_EPS &&
        prev.y0 < divY1 - GEOM_EPS &&
        prev.y1 > divY0 + GEOM_EPS,
    );
    if (collides) {
      alerts.push({
        id: `alert_div_colision_${seg.id}`,
        severidad: 'critical',
        tipo: 'dimension_invalida',
        mensaje: `Divisor vertical "${seg.id}" colisiona con otro divisor (< ${e} mm de separación).`,
        piezaId: seg.id,
      });
      continue;
    }

    activeDividers.push({ id: seg.id, u, cx, y0: divY0, y1: divY1 });

    pieces.push({
      id: seg.id || `div_${i + 1}`,
      nombre: `Divisor Vertical ${activeDividers.length}`,
      tipo: 'division_vertical',
      ancho: dy, // veta vertical (eje Y)
      alto: zf,
      espesor: e,
      cantidad: 1,
      respectGrain: true,
      edges: resolveEdgeBanding('division_vertical', joint, edgeMode),
      posicion3D: [cx, (divY0 + divY1) / 2, zf / 2],
      dimensiones3D: [e, dy, zf],
      rotacion3D: [0, 0, 0],
      material: mat,
    });
  }

  // 3. PIPELINE UNIFICADO DE REPISAS (`equidistant` y `custom` pasan por el MISMO recortador)
  const virtualShelves: VirtualShelf[] = [];
  const minCy = e + e / 2;
  const maxCy = yf - e - e / 2;

  if (topology.shelfMode === 'equidistant') {
    shelfProgression.terms.forEach((an, idx) => {
      const cy = an + e / 2;
      if (cy >= minCy - GEOM_EPS && cy <= maxCy + GEOM_EPS) {
        virtualShelves.push({
          id: `repisa_eq_${idx + 1}`,
          labelPrefix: `Repisa ${idx + 1}`,
          cy,
          uStart: 0,
          uEnd: 1,
        });
      }
    });
  } else {
    topology.hShelves.forEach((seg, idx) => {
      const rawCy = e + clamp01(seg.position) * yInt;
      const cy = clamp(rawCy, minCy, maxCy);
      const uStart = clamp01(Math.min(seg.start, seg.end));
      const uEnd = clamp01(Math.max(seg.start, seg.end));
      if (uEnd - uStart <= GEOM_EPS) {
        alerts.push({
          id: `alert_rep_invalida_${seg.id}`,
          severidad: 'critical',
          tipo: 'dimension_invalida',
          mensaje: `Repisa "${seg.id}" tiene extensión horizontal nula.`,
          piezaId: seg.id,
        });
        return;
      }
      virtualShelves.push({
        id: seg.id || `repisa_${idx + 1}`,
        labelPrefix: `Repisa ${idx + 1}`,
        cy,
        uStart,
        uEnd,
      });
    });
  }

  // Registro de repisas colocadas para validar colisiones verticales en el mismo vano
  const placedShelves: Array<{ x0: number; x1: number; cy: number }> = [];

  for (const shelf of virtualShelves) {
    // Divisores verticales que se cruzan con la banda Y de esta repisa
    const crossingDivs = activeDividers.filter(
      (div) => div.y0 < shelf.cy + e / 2 - GEOM_EPS && div.y1 > shelf.cy - e / 2 + GEOM_EPS,
    );

    const interiorCuts = crossingDivs
      .filter(
        (div) =>
          div.u > shelf.uStart + SEGMENT_TOUCH_TOL &&
          div.u < shelf.uEnd - SEGMENT_TOUCH_TOL,
      )
      .map((div) => div.u);

    const splitPoints = [shelf.uStart, ...interiorCuts, shelf.uEnd];

    for (let sIdx = 0; sIdx < splitPoints.length - 1; sIdx++) {
      const a = splitPoints[sIdx];
      const b = splitPoints[sIdx + 1];

      const touchesLeftDiv = crossingDivs.some((div) => Math.abs(div.u - a) <= SEGMENT_TOUCH_TOL);
      const touchesRightDiv = crossingDivs.some((div) => Math.abs(div.u - b) <= SEGMENT_TOUCH_TOL);

      const xLeft = e + a * xInt + (touchesLeftDiv ? e / 2 : 0);
      const xRight = e + b * xInt - (touchesRightDiv ? e / 2 : 0);
      const dx = xRight - xLeft;

      const pieceId =
        splitPoints.length > 2 ? `${shelf.id}_tramo_${sIdx + 1}` : shelf.id;
      const pieceName =
        splitPoints.length > 2
          ? `${shelf.labelPrefix} (Vano ${sIdx + 1})`
          : shelf.labelPrefix;

      if (dx <= GEOM_EPS) {
        alerts.push({
          id: `alert_rep_cero_${pieceId}`,
          severidad: 'critical',
          tipo: 'dimension_invalida',
          mensaje: `${pieceName} resultó con ancho útil <= 0 mm tras descontar divisores.`,
          piezaId: pieceId,
        });
        continue;
      }

      const overlapsVertical = placedShelves.some(
        (prev) =>
          Math.abs(prev.cy - shelf.cy) < e - GEOM_EPS &&
          prev.x0 < xRight - GEOM_EPS &&
          prev.x1 > xLeft + GEOM_EPS,
      );
      if (overlapsVertical) {
        alerts.push({
          id: `alert_rep_colision_${pieceId}`,
          severidad: 'critical',
          tipo: 'dimension_invalida',
          mensaje: `${pieceName} colisiona verticalmente con otra repisa (< ${e} mm).`,
          piezaId: pieceId,
        });
        continue;
      }

      placedShelves.push({ x0: xLeft, x1: xRight, cy: shelf.cy });

      pieces.push({
        id: pieceId,
        nombre: pieceName,
        tipo: 'repisa',
        ancho: dx,
        alto: zf,
        espesor: e,
        cantidad: 1,
        respectGrain: true,
        edges: resolveEdgeBanding('repisa', joint, edgeMode),
        posicion3D: [(xLeft + xRight) / 2, shelf.cy, zf / 2],
        dimensiones3D: [dx, e, zf],
        rotacion3D: [0, 0, 0],
        material: mat,
      });

      if (dx > SPAN_WARNING_MM + GEOM_EPS) {
        alerts.push({
          id: `alert_pandeo_${pieceId}`,
          severidad: dx > SPAN_CRITICAL_MM ? 'critical' : 'warning',
          tipo: 'pandeo',
          mensaje: `${pieceName} supera los ${SPAN_WARNING_MM} mm de luz libre (${dx.toFixed(1)} mm). Riesgo de pandeo: agregue un divisor vertical.`,
          piezaId: pieceId,
          luzLibreMm: dx,
        });
      }
    }
  }

  // 4. FONDO DUROLAC / MDF 3 mm (clavado atrás en z ∈ [-backE, 0])
  if (topology.hasBackPanel && backE > 0) {
    const backSheet = params.backPanelSheetDimensions ?? params.sheetDimensions;
    const minS = Math.min(backSheet.width, backSheet.height);
    const maxS = Math.max(backSheet.width, backSheet.height);
    const needsSplit = (xf > minS && yf > minS) || xf > maxS || yf > maxS;

    // Coordenadas X de división de paños de fondo
    let xCuts: number[] = [0, xf];

    if (needsSplit) {
      const fullHeightDivs = activeDividers.filter(
        (d) => d.y0 <= e + 1 && d.y1 >= yf - e - 1,
      );

      if (fullHeightDivs.length > 0) {
        const candidateCuts = [0, ...fullHeightDivs.map((d) => d.cx), xf];
        const allPanelsFit = candidateCuts.every((cut, idx) => {
          if (idx === candidateCuts.length - 1) return true;
          const pw = candidateCuts[idx + 1] - cut;
          return (pw <= maxS && yf <= minS) || (pw <= minS && yf <= maxS);
        });
        if (allPanelsFit) {
          xCuts = candidateCuts;
        } else {
          const maxAllowedW = yf <= maxS ? minS : maxS;
          const panels = Math.max(2, Math.ceil(xf / Math.max(1, maxAllowedW)));
          xCuts = Array.from({ length: panels + 1 }, (_, k) => (xf * k) / panels);
        }
      } else {
        const maxAllowedW = yf <= maxS ? minS : maxS;
        const panels = Math.max(2, Math.ceil(xf / Math.max(1, maxAllowedW)));
        xCuts = Array.from({ length: panels + 1 }, (_, k) => (xf * k) / panels);
      }
    }

    const panelCount = xCuts.length - 1;
    for (let pIdx = 0; pIdx < panelCount; pIdx++) {
      const px0 = xCuts[pIdx];
      const px1 = xCuts[pIdx + 1];
      const pw = px1 - px0;
      const pId = panelCount > 1 ? `fondo_${pIdx + 1}` : 'fondo';
      const pName =
        panelCount > 1 ? `Fondo 3mm (Paño ${pIdx + 1}/${panelCount})` : 'Fondo 3mm';

      pieces.push({
        id: pId,
        nombre: pName,
        tipo: 'fondo',
        ancho: pw,
        alto: yf,
        espesor: backE,
        cantidad: 1,
        respectGrain: false,
        edges: resolveEdgeBanding('fondo', joint, edgeMode),
        posicion3D: [(px0 + px1) / 2, yf / 2, -backE / 2],
        dimensiones3D: [pw, yf, backE],
        rotacion3D: [0, 0, 0],
        material: 'durolac_3mm',
      });
    }
  }

  // 4B. ZONAS FRONTALES FUNCIONALES: PUERTAS Y CAJONES COMPLETOS (5 PIEZAS POR CAJÓN)
  let autoHinges = 0;
  let autoSlidesPairs = 0;
  let autoGlassPanels = 0;
  let autoFrontHandles = 0;
  let slideNominalLenMm = 350;

  for (const zone of frontZones) {
    if (zone.kind === 'open' || zone.kind === 'leg_void') continue;

    const zU0 = clamp01(Math.min(zone.uStart, zone.uEnd));
    const zU1 = clamp01(Math.max(zone.uStart, zone.uEnd));
    const zV0 = clamp01(Math.min(zone.vStart, zone.vEnd));
    const zV1 = clamp01(Math.max(zone.vStart, zone.vEnd));

    const zoneX0 = e + zU0 * xInt;
    const zoneX1 = e + zU1 * xInt;
    const zoneY0 = e + zV0 * yInt;
    const zoneY1 = e + zV1 * yInt;

    // Luz interior real descontando mitad de divisores en extremos
    const touchesL = activeDividers.some((d) => Math.abs(d.u - zU0) <= SEGMENT_TOUCH_TOL);
    const touchesR = activeDividers.some((d) => Math.abs(d.u - zU1) <= SEGMENT_TOUCH_TOL);
    const xInner0 = zoneX0 + (touchesL ? e / 2 : 0);
    const xInner1 = zoneX1 - (touchesR ? e / 2 : 0);
    const innerW = xInner1 - xInner0;

    // Cobertura exterior frontal para puerta / frente de cajón (sobrepuesto en +Z)
    const frontX0 = zU0 <= SEGMENT_TOUCH_TOL ? 2 : zoneX0 + 1.5;
    const frontX1 = zU1 >= 1 - SEGMENT_TOUCH_TOL ? xf - 2 : zoneX1 - 1.5;
    const frontY0 = zV0 <= SEGMENT_TOUCH_TOL ? 2 : zoneY0 + 1.5;
    const frontY1 = zV1 >= 1 - SEGMENT_TOUCH_TOL ? yf - 2 : zoneY1 - 1.5;
    const frontW = frontX1 - frontX0;
    const frontH = frontY1 - frontY0;
    const frontMat: PieceMaterial = zone.materialOverride ?? mat;
    const frontCz = zf + 1 + e / 2;

    if (frontW <= 30 || frontH <= 30) continue;

    if (
      zone.kind === 'door_left' ||
      zone.kind === 'door_right' ||
      zone.kind === 'door_glass'
    ) {
      const label =
        zone.label ??
        (zone.kind === 'door_glass' ? 'Puerta Marco Vidrio' : 'Puerta');
      pieces.push({
        id: `puerta_${zone.id}`,
        nombre: label,
        tipo: 'puerta',
        ancho: frontH, // veta vertical en puertas
        alto: frontW,
        espesor: e,
        cantidad: 1,
        respectGrain: true,
        edges: resolveEdgeBanding('puerta', joint, edgeMode),
        posicion3D: [(frontX0 + frontX1) / 2, (frontY0 + frontY1) / 2, frontCz],
        dimensiones3D: [frontW, frontH, e],
        rotacion3D: [0, 0, 0],
        material: frontMat,
      });
      autoHinges += frontH > 900 ? 3 : 2;
      autoFrontHandles += 1;
      if (zone.kind === 'door_glass') autoGlassPanels += 1;
    } else if (zone.kind === 'door_double') {
      const leafW = (frontW - 3) / 2;
      if (leafW > 25) {
        const cxL = frontX0 + leafW / 2;
        const cxR = frontX1 - leafW / 2;
        for (const [suffix, cxLeaf] of [
          ['izq', cxL],
          ['der', cxR],
        ] as const) {
          pieces.push({
            id: `puerta_${zone.id}_${suffix}`,
            nombre: `${zone.label ?? 'Puerta Doble'} (${suffix.toUpperCase()})`,
            tipo: 'puerta',
            ancho: frontH,
            alto: leafW,
            espesor: e,
            cantidad: 1,
            respectGrain: true,
            edges: resolveEdgeBanding('puerta', joint, edgeMode),
            posicion3D: [cxLeaf, (frontY0 + frontY1) / 2, frontCz],
            dimensiones3D: [leafW, frontH, e],
            rotacion3D: [0, 0, 0],
            material: frontMat,
          });
          autoHinges += frontH > 900 ? 3 : 2;
          autoFrontHandles += 1;
        }
      }
    } else if (zone.kind === 'drawers') {
      const nDrawers = Math.max(1, Math.min(8, Math.round(zone.drawerCount ?? 3)));
      const stepH = frontH / nDrawers;
      const boxDepth = Math.max(150, Math.min(zf - 50, 450));
      slideNominalLenMm = Math.max(250, Math.floor(boxDepth / 50) * 50);
      const slideClearance = 13; // 13 mm por lado para corredera telescópica
      const boxOuterW = innerW - 2 * slideClearance;

      for (let d = 0; d < nDrawers; d++) {
        const dy0 = frontY0 + d * stepH + 1.5;
        const dy1 = frontY0 + (d + 1) * stepH - 1.5;
        const fh = dy1 - dy0;
        const fCy = (dy0 + dy1) / 2;
        const dTag = `${zone.id}_c${d + 1}`;
        const dLabel = `Cajón ${d + 1}/${nDrawers}`;

        // 1) Frente de cajón (sobrepuesto en +Z)
        pieces.push({
          id: `frente_${dTag}`,
          nombre: `Frente ${dLabel}`,
          tipo: 'frente_cajon',
          ancho: frontW, // veta horizontal
          alto: fh,
          espesor: e,
          cantidad: 1,
          respectGrain: true,
          edges: resolveEdgeBanding('frente_cajon', joint, edgeMode),
          posicion3D: [(frontX0 + frontX1) / 2, fCy, frontCz],
          dimensiones3D: [frontW, fh, e],
          rotacion3D: [0, 0, 0],
          material: frontMat,
        });

        // 2-5) Caja interna del cajón (2 costados + trasera + fondo 3 mm) si cabe en el vano
        const innerBandY0 = zoneY0 + (d * (zoneY1 - zoneY0)) / nDrawers;
        const innerBandY1 = zoneY0 + ((d + 1) * (zoneY1 - zoneY0)) / nDrawers;
        const boxH = Math.max(60, Math.min(fh - 34, innerBandY1 - innerBandY0 - 30 - backE));
        const yBoxBase = innerBandY0 + 12 + backE;

        if (boxOuterW > 2 * e + 20 && boxH >= 50 && boxDepth >= 120) {
          const xBoxL = xInner0 + slideClearance;
          const xBoxR = xInner1 - slideClearance;
          const zBoxCenter = zf - 2 - boxDepth / 2;
          const innerBackW = boxOuterW - 2 * e;

          // 2) Costado izquierdo cajón
          pieces.push({
            id: `costado_izq_${dTag}`,
            nombre: `Costado Izq ${dLabel}`,
            tipo: 'costado_cajon',
            ancho: boxDepth,
            alto: boxH,
            espesor: e,
            cantidad: 1,
            respectGrain: true,
            edges: resolveEdgeBanding('costado_cajon', joint, edgeMode),
            posicion3D: [xBoxL + e / 2, yBoxBase + boxH / 2, zBoxCenter],
            dimensiones3D: [e, boxH, boxDepth],
            rotacion3D: [0, 0, 0],
            material: mat,
          });

          // 3) Costado derecho cajón
          pieces.push({
            id: `costado_der_${dTag}`,
            nombre: `Costado Der ${dLabel}`,
            tipo: 'costado_cajon',
            ancho: boxDepth,
            alto: boxH,
            espesor: e,
            cantidad: 1,
            respectGrain: true,
            edges: resolveEdgeBanding('costado_cajon', joint, edgeMode),
            posicion3D: [xBoxR - e / 2, yBoxBase + boxH / 2, zBoxCenter],
            dimensiones3D: [e, boxH, boxDepth],
            rotacion3D: [0, 0, 0],
            material: mat,
          });

          // 4) Trasera cajón (encajada entre ambos costados)
          pieces.push({
            id: `trasera_${dTag}`,
            nombre: `Trasera ${dLabel}`,
            tipo: 'trasera_cajon',
            ancho: innerBackW,
            alto: boxH,
            espesor: e,
            cantidad: 1,
            respectGrain: true,
            edges: resolveEdgeBanding('trasera_cajon', joint, edgeMode),
            posicion3D: [(xBoxL + xBoxR) / 2, yBoxBase + boxH / 2, zf - 2 - boxDepth + e / 2],
            dimensiones3D: [innerBackW, boxH, e],
            rotacion3D: [0, 0, 0],
            material: mat,
          });

          // 5) Fondo cajón 3 mm Durolac (clavado debajo de costados/trasera)
          if (backE > 0) {
            pieces.push({
              id: `fondo_cajon_${dTag}`,
              nombre: `Fondo 3mm ${dLabel}`,
              tipo: 'fondo_cajon',
              ancho: boxOuterW,
              alto: boxDepth,
              espesor: backE,
              cantidad: 1,
              respectGrain: false,
              edges: resolveEdgeBanding('fondo_cajon', joint, edgeMode),
              posicion3D: [(xBoxL + xBoxR) / 2, yBoxBase - backE / 2, zBoxCenter],
              dimensiones3D: [boxOuterW, backE, boxDepth],
              rotacion3D: [0, 0, 0],
              material: 'durolac_3mm',
            });
          }
        }

        autoSlidesPairs += 1;
        autoFrontHandles += 1;
      }
    }
  }

  // Zócalo inferior de melamina (si aplica y no usa patas externas)
  if (!topology.hasExternalLegs && (topology.toeKickHeightMm ?? 0) > 0 && legVoidsAtBottom.length === 0) {
    const tkH = Math.min(200, Math.max(40, topology.toeKickHeightMm!));
    pieces.push({
      id: 'zocalo_frontal',
      nombre: 'Zócalo Frontal',
      tipo: 'zocalo',
      ancho: xInt,
      alto: tkH,
      espesor: e,
      cantidad: 1,
      respectGrain: true,
      edges: resolveEdgeBanding('zocalo', joint, edgeMode),
      posicion3D: [xf / 2, -tkH / 2, Math.max(e / 2, zf - 30)],
      dimensiones3D: [xInt, tkH, e],
      rotacion3D: [0, 0, 0],
      material: mat,
    });
  }

  // Consolidar herrajes calculados (bisagras, correderas, vidrios, tiradores si no existen)
  if (autoHinges > 0 && !hardwareSummary.some((h) => h.categoria === 'bisagras')) {
    hardwareSummary.push({
      id: 'hw_bisagras_calc',
      categoria: 'bisagras',
      descripcion: 'Bisagras cazoleta 35 mm (cierre suave)',
      cantidad: autoHinges,
      medidaReferenciaMm: 35,
      notaCompra: `Calculadas automáticamente según puertas del modelo (${autoHinges} u.).`,
      origen: 'detectado',
    });
  }
  if (autoSlidesPairs > 0 && !hardwareSummary.some((h) => h.categoria === 'correderas')) {
    hardwareSummary.push({
      id: 'hw_correderas_calc',
      categoria: 'correderas',
      descripcion: `Pares de correderas telescópicas ${slideNominalLenMm} mm`,
      cantidad: autoSlidesPairs,
      medidaReferenciaMm: slideNominalLenMm,
      notaCompra: `1 par por cada cajón (${autoSlidesPairs} pares, descuento 13 mm/lado aplicado en despiece).`,
      origen: 'detectado',
    });
  }
  if (autoGlassPanels > 0 && !hardwareSummary.some((h) => h.id === 'hw_vidrios_calc')) {
    hardwareSummary.push({
      id: 'hw_vidrios_calc',
      categoria: 'otro',
      descripcion: 'Paneles de vidrio transparente 4 mm para puertas vitrina',
      cantidad: autoGlassPanels,
      medidaReferenciaMm: 4,
      notaCompra: 'Insumo de vidriería externo a la melamina.',
      origen: 'detectado',
    });
  }
  if (autoFrontHandles > 0 && !hardwareSummary.some((h) => h.categoria === 'tiradores')) {
    hardwareSummary.push({
      id: 'hw_tiradores_calc',
      categoria: 'tiradores',
      descripcion: 'Tiradores / pomos para puertas y cajones',
      cantidad: autoFrontHandles,
      notaCompra: `Sugeridos según puertas/cajones del modelo (${autoFrontHandles} u., o usar tirador calado/uñero).`,
      origen: 'detectado',
    });
  }

  // 5. MATRICES n×3, n×5, CONSOLIDACIÓN Y SUMATORIAS
  const matrixNx3: [number, number, number][] = pieces.map((p) => [
    p.ancho,
    p.alto,
    p.espesor,
  ]);

  const consolidatedMap = new Map<string, MatrixNx5Row>();
  for (const p of pieces) {
    const key = `${p.tipo}|${p.ancho.toFixed(2)}|${p.alto.toFixed(2)}|${p.espesor.toFixed(2)}|${p.material}`;
    const existing = consolidatedMap.get(key);
    if (existing) {
      existing.cantidad += p.cantidad;
    } else {
      consolidatedMap.set(key, {
        nombre: p.nombre,
        ancho: Number(p.ancho.toFixed(2)),
        alto: Number(p.alto.toFixed(2)),
        espesor: p.espesor,
        cantidad: p.cantidad,
        material: p.material,
      });
    }
  }

  const consolidatedRows = Array.from(consolidatedMap.values());
  const matrixNx5: [number, number, number, number, PieceMaterial][] =
    consolidatedRows.map((r) => [r.ancho, r.alto, r.espesor, r.cantidad, r.material]);

  let melamineAreaMm2 = 0;
  let backPanelAreaMm2 = 0;
  let edgeBandingMm = 0;

  for (const p of pieces) {
    const area = p.ancho * p.alto * p.cantidad;
    if (p.tipo === 'fondo' || p.tipo === 'fondo_cajon') {
      backPanelAreaMm2 += area;
    } else {
      melamineAreaMm2 += area;
    }
    edgeBandingMm += computePieceEdgeBandingMm(p) * p.cantidad;
  }

  return {
    scaleFactors,
    shelfProgression,
    matrizDespiece: pieces,
    matrixNx3,
    matrixNx5,
    consolidatedRows,
    totalNetAreaM2: (melamineAreaMm2 + backPanelAreaMm2) / 1_000_000,
    backPanelAreaM2: backPanelAreaMm2 / 1_000_000,
    totalEdgeBandingMeters: edgeBandingMm / 1000,
    alerts,
    hardwareSummary,
  };
}
