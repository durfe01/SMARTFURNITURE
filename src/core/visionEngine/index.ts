/**
 * Punto de entrada oficial de la Librería POO Reutilizable de Visión, Aprendizaje y Vectorización
 * (`src/core/visionEngine/` — Agente OFG `AGENTE_VISION_VECTORIZACION`).
 */
export { CellFeatureExtractor } from './CellFeatureExtractor';
export type { CellRegionBounds } from './CellFeatureExtractor';
export { PerspectiveRectifier } from './PerspectiveRectifier';
export {
  HierarchicalPlanarRecognitionStrategy,
  OpenGridRecognitionStrategy,
} from './Strategies';
export { TRAINED_VISION_MODEL_SCHEMA } from './trainedModelData';
export { VectorRenderer2D } from './VectorRenderer2D';
export { CANONICAL_FEATURE_NAMES, VisionModel } from './VisionModel';
export {
  VisionVectorizationAgent,
  defaultVisionAgent,
} from './VisionVectorizationAgent';
export type {
  AutoFrameResult,
  CellFeatureVector,
  CellPredictionResult,
  ClassPrototype,
  ImageFrameRGBA,
  IShapeRecognitionStrategy,
  IVectorRenderer,
  LabeledCellSample,
  Quad2D,
  RegionSemanticClass,
  VisionModelSchema,
  VisionModelThresholds,
  VisionRecognitionReport,
} from './types';
