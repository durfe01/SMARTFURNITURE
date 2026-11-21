/**
 * Punto de entrada del módulo de Visión Computacional 100% Offline (`src/core/vision/`).
 */
export {
  analyzeRectifiedFurniture,
  detectLowerGapHint,
} from './bandDetector';
export type {
  BandDetectionResult,
  BandDetectorOptions,
  DetectedHandlePoint,
  LowerGapHintResult,
} from './bandDetector';
export {
  computeRectifiedSize,
  estimateAspectRatioFixedFocal,
  extrapolateDimensionsFromSingleMeasure,
  rectifyImageRGBA,
} from './rectify';
