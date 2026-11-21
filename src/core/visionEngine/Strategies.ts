/**
 * SMARTFURNITURE / OFG — ESTRATEGIAS POO DE RECONOCIMIENTO DE FORMAS (`IShapeRecognitionStrategy`)
 * Patrón Strategy extensible para desacoplar detección de rejillas abiertas y partición planar jerárquica.
 */
import { analyzeRectifiedFurniture, type BandDetectionResult, type BandDetectorOptions } from '../vision';
import type { ImageFrameRGBA, IShapeRecognitionStrategy } from './types';

/**
 * Estrategia unificada POO para estructuras abiertas (bandas con paralaje) y partición planar
 * jerárquica multinivel (valles oscuros + escalón luminancia/croma + uniones en T).
 */
export class HierarchicalPlanarRecognitionStrategy implements IShapeRecognitionStrategy {
  public readonly name = 'HierarchicalPlanarStrategy_v3.3';
  public readonly supportedModes = ['open', 'closed_front', 'mixed', 'uncertain'] as const;

  public recognize(
    frame: ImageFrameRGBA,
    dimsMm: { x: number; y: number },
    boardThicknessMm: number,
    opts?: BandDetectorOptions,
  ): BandDetectionResult {
    return analyzeRectifiedFurniture(
      frame.rgba,
      frame.width,
      frame.height,
      dimsMm,
      boardThicknessMm,
      opts,
    );
  }
}

/**
 * Estrategia especializada estrictamente en estanterías abiertas con anclaje de paralaje 3D.
 */
export class OpenGridRecognitionStrategy implements IShapeRecognitionStrategy {
  public readonly name = 'OpenGridParallaxStrategy_v3.3';
  public readonly supportedModes = ['open', 'uncertain'] as const;

  public recognize(
    frame: ImageFrameRGBA,
    dimsMm: { x: number; y: number },
    boardThicknessMm: number,
    opts?: BandDetectorOptions,
  ): BandDetectionResult {
    return analyzeRectifiedFurniture(
      frame.rgba,
      frame.width,
      frame.height,
      dimsMm,
      boardThicknessMm,
      { ...opts, parallaxAware: opts?.parallaxAware ?? true },
    );
  }
}
