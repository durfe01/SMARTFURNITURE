/**
 * SMARTFURNITURE — CONTRATOS INMUTABLES v3.0 (ÚNICA FUENTE DE VERDAD)
 *
 * CONVENCIONES GEOMÉTRICAS CONGELADAS:
 * 1. Sistema 3D mano derecha en milímetros (mm):
 *    - Origen [0, 0, 0] en la esquina INFERIOR-IZQUIERDA-TRASERA del cuerpo de melamina.
 *    - +X: hacia la derecha (ancho total x_f).
 *    - +Y: hacia arriba (alto del cuerpo de melamina y_f, EXCLUYENDO patas externas).
 *    - +Z: hacia el frente visible (profundidad z_f).
 *    - Fondo Durolac/MDF 3 mm clavado atrás en z ∈ [-backPanelThickness, 0] (cz = -backPanelThickness / 2).
 *
 * 2. Correspondencia física 1:1 en `matrizDespiece`:
 *    - Cada `BoardPiece` representa exactamente UNA placa física (`cantidad: 1`), con su centro
 *      `posicion3D: [cx, cy, cz]` y tamaño axis-aligned `dimensiones3D: [dx, dy, dz]`.
 *
 * 3. Espacio de coordenadas normalizado para `NormalizedSegment`:
 *    - Vive SIEMPRE en espacio INTERIOR [0, 1]^2:
 *      * u = 0 -> cara interna lateral izquierdo (x = e)
 *      * u = 1 -> cara interna lateral derecho (x = x_f - e)
 *      * v = 0 -> cara superior de la base (y = e)
 *      * v = 1 -> cara inferior de la cubierta (y = y_f - e)
 *    - En modo 'custom', `hShelves[i].position` (v) es el CENTRO vertical de la repisa (`cy = e + v * y_int`),
 *      restringido a `[e + e/2, y_f - e - e/2]` para impedir solapamientos con base o cubierta.
 *    - En modo 'equidistant', `ShelfProgressionData.terms[k]` es la CARA INFERIOR `a_n`, por lo que `cy = a_n + e/2`.
 *    - Las coordenadas provenientes de fotografía/homografía están en espacio EXTERIOR y DEBEN convertirse
 *      siempre mediante `exteriorToInterior(p, e, dim)`.
 *
 * 4. Orientación obligatoria de veta (`ancho` paralelo a veta / `alto` perpendicular a veta):
 *    - `cubierta`, `base`, `repisa`: `ancho = dx` (eje X), `alto = dz` (profundidad Z), `espesor = e`.
 *    - `lateral`, `division_vertical`: `ancho = dy` (altura vertical Y — veta vertical), `alto = dz` (profundidad Z), `espesor = e`.
 *    - `fondo`: `espesor = backPanelThickness`, `material = 'durolac_3mm'`, `respectGrain = false`, `edges` todos `false`.
 *
 * 5. Convención de tapacanto (`EdgeBandingFlags`):
 *    - `top` y `bottom` miden `ancho` (`top` = canto frontal visible +Z).
 *    - `left` y `right` miden `alto`.
 *    - En `visibleEdgesOnly`:
 *      * `topOverSides`: `cubierta`/`base` llevan `top + left + right`; `lateral` solo `top`.
 *      * `topBetweenSides`: `cubierta`/`base` solo `top`; `lateral` lleva `top + left + right`.
 *      * `repisa` y `division_vertical`: solo `top` (canto frontal).
 *
 * 6. Aislamiento de accesorios no-melamina:
 *    - Patas separadas, tiradores, bisagras y correderas viven en `hardwareItems` / `hardwareSummary`
 *      y NUNCA alteran el despiece ni las cotas de melamina.
 */

export type MelamineMaterial = 'blanco' | 'roble' | 'grafito';
export type PieceMaterial = MelamineMaterial | 'durolac_3mm';

export type PieceType =
  | 'cubierta'
  | 'base'
  | 'lateral'
  | 'division_vertical'
  | 'repisa'
  | 'fondo'
  | 'puerta'
  | 'frente_cajon'
  | 'costado_cajon'
  | 'trasera_cajon'
  | 'fondo_cajon'
  | 'zocalo'
  | 'faldon';

export type FrontModuleKind =
  | 'open'
  | 'door_left'
  | 'door_right'
  | 'door_double'
  | 'door_glass'
  | 'drawers'
  | 'leg_void';

/**
 * Zona funcional frontal en espacio INTERIOR normalizado [0, 1]^2.
 * Permite modelar muebles abiertos, cerrados, mixtos (puertas + cajones + nichos)
 * y escritorios con hueco de piernas, generando despiece completo real.
 */
export interface FrontZone {
  id: string;
  uStart: number;
  uEnd: number;
  vStart: number;
  vEnd: number;
  kind: FrontModuleKind;
  /** Cantidad de cajones cuando kind === 'drawers'. */
  drawerCount?: number;
  /** Repisas interiores opcionales dentro de la zona abierta/puerta. */
  internalShelves?: number;
  label?: string;
  materialOverride?: MelamineMaterial;
}

export type HardwareCategory =
  | 'patas'
  | 'tiradores'
  | 'bisagras'
  | 'correderas'
  | 'otro';

export interface HardwareItem {
  id: string;
  categoria: HardwareCategory;
  descripcion: string;
  cantidad: number;
  medidaReferenciaMm?: number;
  notaCompra: string;
  origen: 'detectado' | 'manual';
}

export interface Point2D {
  x: number;
  y: number;
}

/**
 * Segmento estructural normalizado en espacio INTERIOR [0, 1]^2.
 * - Para `vDividers`: `position` = u ∈ (0, 1), `start`/`end` = v ∈ [0, 1].
 * - Para `hShelves`: `position` = v ∈ (0, 1) (centro vertical), `start`/`end` = u ∈ [0, 1].
 */
export interface NormalizedSegment {
  id: string;
  position: number;
  start: number;
  end: number;
}

export interface FurnitureTopology {
  viewsMode: 1 | 2;
  aspectRatioXY: number;
  aspectRatioZY?: number;
  /** Orden horario estricto [TL, TR, BR, BL] mapeado a (0,1), (1,1), (1,0), (0,0). */
  quadCorners?: [Point2D, Point2D, Point2D, Point2D];
  homographyMatrix?: number[][];
  vDividers: NormalizedSegment[];
  hShelves: NormalizedSegment[];
  shelfMode: 'equidistant' | 'custom';
  equalShelfCount: number;
  hasBackPanel: boolean;
  detectionSource?: 'manual' | 'auto' | 'preset';
  /** Confianza 0..1. Si < 0.5, la UI advierte y guía trazado/ajuste manual. */
  detectionConfidence?: number;
  /** Si true, el mueble usa patas independientes EXCLUIDAS de `targetDimensions.y` y del corte de melamina. */
  hasExternalLegs?: boolean;
  externalLegHeightMm?: number;
  externalLegCount?: number;
  /** Accesorios o herrajes externos a la melamina (patas, tiradores, bisagras, etc.). */
  hardwareItems?: HardwareItem[];
  /** Zonas frontales funcionales (puertas, cajones, nichos abiertos, hueco de piernas). */
  frontZones?: FrontZone[];
  /** Altura opcional de zócalo inferior en mm (si apoya en zócalo en vez de patas). */
  toeKickHeightMm?: number;
  /** Etiqueta descriptiva del tipo de mueble interpretado (para plano vectorial). */
  furnitureProfileLabel?: string;
}

export interface ScaleAndBoardParams {
  targetDimensions: { x: number; y: number; z: number };
  referenceDimensions: { x: number; y: number; z: number };
  boardThickness: number;
  backPanelThickness: number;
  sheetDimensions: { width: number; height: number };
  /** Plancha del fondo 3 mm (ej. Durolac Chile 2440×1520). Default = sheetDimensions. */
  backPanelSheetDimensions?: { width: number; height: number };
  /** Margen de escuadrado por borde en mm (Sodimac/Imperial: 10–15 mm). Default 0. */
  trimMm?: number;
  kerf: number;
  respectGrain: boolean;
  /** Default 'guillotine' (cortable en seccionadora de taller). 'maxrects' opcional (CNC). */
  packingStrategy?: 'guillotine' | 'maxrects';
  cornerJointType: 'topOverSides' | 'topBetweenSides';
  edgeBandingMode: 'fullPerimeter' | 'visibleEdgesOnly';
  material: MelamineMaterial;
}

export interface EdgeBandingFlags {
  top: boolean;
  bottom: boolean;
  left: boolean;
  right: boolean;
}

export interface BoardPiece {
  id: string;
  nombre: string;
  tipo: PieceType;
  ancho: number;
  alto: number;
  espesor: number;
  cantidad: number;
  respectGrain: boolean;
  edges: EdgeBandingFlags;
  posicion3D: [number, number, number];
  dimensiones3D: [number, number, number];
  rotacion3D: [number, number, number];
  material: PieceMaterial;
}

export interface StructuralAlert {
  id: string;
  severidad: 'warning' | 'critical';
  tipo: 'pandeo' | 'dimension_invalida' | 'sobredimension_plancha';
  mensaje: string;
  piezaId: string;
  luzLibreMm?: number;
}

export interface ShelfProgressionData {
  count: number;
  hInteriorMm: number;
  clearSpanMm: number;
  a1: number;
  d: number;
  /** Alturas desde el piso de la CARA INFERIOR a_n de cada repisa (cy = a_n + e/2). */
  terms: number[];
}

export interface MatrixNx5Row {
  nombre: string;
  ancho: number;
  alto: number;
  espesor: number;
  cantidad: number;
  material: PieceMaterial;
}

export interface DespieceResult {
  scaleFactors: { kx: number; ky: number; kz: number };
  shelfProgression: ShelfProgressionData;
  matrizDespiece: BoardPiece[];
  matrixNx3: [number, number, number][];
  matrixNx5: [number, number, number, number, PieceMaterial][];
  consolidatedRows: MatrixNx5Row[];
  totalNetAreaM2: number;
  backPanelAreaM2: number;
  totalEdgeBandingMeters: number;
  alerts: StructuralAlert[];
  /** Lista consolidada de accesorios/herrajes externos (patas, tiradores, etc.) fuera de melamina. */
  hardwareSummary: HardwareItem[];
}

export interface BaseMatrixScaleResult {
  scaledMatrix: [number, number, number][];
  originalAreaM2: number;
  scaledAreaM2: number;
  originalEdgeBandingMeters: number;
  scaledEdgeBandingMeters: number;
}

export interface PlacedRectangle {
  idPieza: string;
  nombre: string;
  x: number;
  y: number;
  ancho: number;
  alto: number;
  rotado: boolean;
}

export interface SheetLayout {
  sheetId: number;
  espesorMm: number;
  materialLabel: string;
  anchoSheet: number;
  altoSheet: number;
  piezasColocadas: PlacedRectangle[];
  usoPorcentaje: number;
  desperdicioPorcentaje: number;
}

export interface CuttingPlanResult {
  sheetsUsed: SheetLayout[];
  unplacedPieces: BoardPiece[];
  totalSheetsCount: number;
  melamineSheetsCount: number;
  backPanelSheetsCount: number;
  usagePercentage: number;
  wastePercentage: number;
  svgMarkup: string;
}
