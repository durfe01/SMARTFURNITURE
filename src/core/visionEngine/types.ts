/**
 * SMARTFURNITURE / OFG — CONTRATOS POO DE LA LIBRERÍA REUTILIZABLE DE VISIÓN Y VECTORIZACIÓN (v1.0)
 * Diseñada bajo OFG-POL-GEN-2026-11-20 (POO SOLID, 100 % offline, cero dependencias externas).
 * Reutilizable en SmartFurniture y cualquier aplicación futura de la OFG.
 */
import type {
  DespieceResult,
  FrontZone,
  FurnitureTopology,
  NormalizedSegment,
  Point2D,
  ScaleAndBoardParams,
} from '../../types/contracts';
import type {
  BandDetectionResult,
  BandDetectorOptions,
  DetectedFurnitureMode,
  LowerGapHintResult,
} from '../vision';
import type { BlueprintRenderOptions } from '../vectorBlueprint';

export type Quad2D = [Point2D, Point2D, Point2D, Point2D];

export interface ImageFrameRGBA {
  readonly rgba: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

export type RegionSemanticClass = 'open' | 'door' | 'door_glass' | 'drawers' | 'leg_void';

/**
 * Vector normalizado de 11 características fotométricas y geométricas extraídas
 * puramente desde los píxeles RGBA de una celda rectificada (sin metadatos externos).
 */
export interface CellFeatureVector {
  meanLumRatio: number;
  lumStdNorm: number;
  meanChroma: number;
  brightWhiteRatio: number;
  darkRatio: number;
  borderMinusCenterNorm: number;
  seamCountNorm: number;
  brightShelfCountNorm: number;
  touchesBottom: number;
  isMiddleBand: number;
  carcassIsBright: number;
  cellHeightNorm: number;
  cellAspectWH: number;
}

export interface LabeledCellSample {
  readonly sourceId: string;
  readonly label: RegionSemanticClass;
  readonly features: CellFeatureVector;
}

export interface ClassPrototype {
  readonly kind: RegionSemanticClass;
  readonly sampleCount: number;
  readonly centroid: readonly number[];
  readonly invStd: readonly number[];
  /** Sub-prototipos k-means aprendidos para clases multimodales (ej. puerta blanca vs madera). */
  readonly subCentroids?: readonly (readonly number[])[];
}

export interface VisionModelThresholds {
  readonly minConfidence: number;
  readonly whiteCabinetRefLum: number;
  readonly legVoidWhiteRatio: number;
}

/**
 * Esquema JSON serializable del Modelo de Aprendizaje Estadístico Local (`VisionModel`).
 * Permite entrenar offline, auditar en Git, versionar en memoria OFG y cargar en otras apps.
 */
export interface VisionModelSchema {
  readonly modelId: string;
  readonly version: string;
  readonly trainedAt: string;
  readonly datasetSummary: string;
  readonly sampleCount: number;
  readonly cellTrainAccuracyPct: number;
  readonly lofoCrossValAccuracyPct?: number;
  readonly benchmarkGlobalPct: number;
  readonly benchmarkFrontal12Pct: number;
  readonly featureNames: readonly string[];
  readonly featureMeans: readonly number[];
  readonly featureStds: readonly number[];
  /** Pesos discriminantes de Fisher (varianza inter-clase / intra-clase) aprendidos del dataset. */
  readonly fisherWeights?: readonly number[];
  readonly prototypes: readonly ClassPrototype[];
  readonly thresholds: VisionModelThresholds;
}

export interface CellPredictionResult {
  readonly kind: RegionSemanticClass;
  readonly confidence: number;
  readonly scores: Record<RegionSemanticClass, number>;
}

export interface AutoFrameResult {
  readonly quad: Quad2D;
  readonly confidence: number;
  readonly backgroundType: 'uniform_light' | 'uniform_dark' | 'cluttered';
  readonly detectedSubjectCoverage: number;
  readonly message: string;
}

export interface IShapeRecognitionStrategy {
  readonly name: string;
  readonly supportedModes: readonly DetectedFurnitureMode[];
  recognize(
    frame: ImageFrameRGBA,
    dimsMm: { x: number; y: number },
    boardThicknessMm: number,
    opts?: BandDetectorOptions,
  ): BandDetectionResult;
}

export interface IVectorRenderer {
  readonly format: 'svg';
  render(
    topology: FurnitureTopology,
    params: ScaleAndBoardParams,
    despiece: DespieceResult,
    opts?: BlueprintRenderOptions,
  ): string;
}

export interface DivisionMeasureAudit {
  readonly id: string;
  readonly label: string;
  readonly kind: FrontZone['kind'];
  readonly uStart: number;
  readonly uEnd: number;
  readonly vStart: number;
  readonly vEnd: number;
  readonly widthMm: number;
  readonly heightMm: number;
}

export interface PhotoVectorComparisonAudit {
  readonly passCount: number;
  readonly matchScorePct: number;
  readonly snappedDividersCount: number;
  readonly snappedShelvesCount: number;
  readonly recoveredMissingDividersCount: number;
  readonly recoveredMissingShelvesCount: number;
  readonly prunedFalseDividersCount: number;
  readonly widthClosureErrorMm: number;
  readonly heightClosureErrorMm: number;
  readonly bayWidthsMm: readonly number[];
  readonly bandHeightsMm: readonly number[];
  readonly zoneMeasures: readonly DivisionMeasureAudit[];
  readonly summary: string;
}

export interface VisionRecognitionReport {
  readonly detection: BandDetectionResult;
  readonly legsHint: LowerGapHintResult;
  readonly estimatedAspectXY: number;
  readonly rectifiedSize: { width: number; height: number };
  readonly homographyToUnit: number[][];
  readonly autoZones: FrontZone[];
  readonly structuralShelves: NormalizedSegment[];
  readonly comparisonAudit: PhotoVectorComparisonAudit;
  readonly strategyUsed: string;
  readonly modelId: string;
  readonly modelVersion: string;
}
