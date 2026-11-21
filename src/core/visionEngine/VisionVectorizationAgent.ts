/**
 * SMARTFURNITURE / OFG — CLASE FACHADA POO `VisionVectorizationAgent`
 * Agente reutilizable de visión computacional, aprendizaje estadístico local y vectorización 2D.
 * Implementa la arquitectura del 6.º Agente OFG (`AGENTE_VISION_VECTORIZACION`) con cero
 * dependencias externas para uso inmediato en SmartFurniture y futuras aplicaciones OFG.
 */
import type {
  DespieceResult,
  FrontZone,
  FurnitureTopology,
  NormalizedSegment,
  ScaleAndBoardParams,
} from '../../types/contracts';
import type { BandDetectionResult, BandDetectorOptions } from '../vision';
import { inferFrontZonesFromDetection, type BlueprintRenderOptions } from '../vectorBlueprint';
import { CellFeatureExtractor } from './CellFeatureExtractor';
import { PerspectiveRectifier } from './PerspectiveRectifier';
import { HierarchicalPlanarRecognitionStrategy } from './Strategies';
import { TRAINED_VISION_MODEL_SCHEMA } from './trainedModelData';
import type {
  AutoFrameResult,
  ImageFrameRGBA,
  IShapeRecognitionStrategy,
  IVectorRenderer,
  LabeledCellSample,
  Quad2D,
  VisionModelSchema,
  VisionRecognitionReport,
} from './types';
import { VectorRenderer2D } from './VectorRenderer2D';
import { VisionModel } from './VisionModel';

export class VisionVectorizationAgent {
  private readonly rectifier: PerspectiveRectifier;
  private readonly strategy: IShapeRecognitionStrategy;
  private readonly featureExtractor: CellFeatureExtractor;
  private readonly renderer: IVectorRenderer;
  private model: VisionModel;

  public constructor(opts?: {
    model?: VisionModel;
    rectifier?: PerspectiveRectifier;
    strategy?: IShapeRecognitionStrategy;
    renderer?: IVectorRenderer;
  }) {
    this.model = opts?.model ?? VisionModel.fromJSON(TRAINED_VISION_MODEL_SCHEMA);
    this.rectifier = opts?.rectifier ?? new PerspectiveRectifier(26);
    this.strategy = opts?.strategy ?? new HierarchicalPlanarRecognitionStrategy();
    this.featureExtractor = new CellFeatureExtractor();
    this.renderer = opts?.renderer ?? new VectorRenderer2D();
  }

  public getModel(): VisionModel {
    return this.model;
  }

  public exportModelJson(): VisionModelSchema {
    return this.model.toJSON();
  }

  public loadModel(schema: VisionModelSchema): void {
    this.model = VisionModel.fromJSON(schema);
  }

  public trainFromDataset(
    samples: readonly LabeledCellSample[],
    meta: {
      datasetSummary: string;
      version?: string;
      benchmarkGlobalPct?: number;
      benchmarkFrontal12Pct?: number;
    },
  ): VisionModelSchema {
    this.model = VisionModel.trainFromSamples(samples, meta);
    return this.model.toJSON();
  }

  public autoFrame(frame: ImageFrameRGBA): AutoFrameResult {
    return this.rectifier.autoFrameSubjectQuad(frame);
  }

  public estimateAspectRatio(quad: Quad2D, imgW: number, imgH: number, focal35mm: 26 | 52 = 26): number {
    return this.rectifier.estimateAspectRatio(quad, imgW, imgH, focal35mm);
  }

  public extrapolateDimensions(
    aspectRatioXY: number,
    knownAxis: 'x' | 'y',
    knownMm: number,
    depthMm: number,
  ): { x: number; y: number; z: number } {
    return this.rectifier.extrapolateDimensions(aspectRatioXY, knownAxis, knownMm, depthMm);
  }

  public recognizeRectified(
    rectifiedFrame: ImageFrameRGBA,
    dimsMm: { x: number; y: number },
    boardThicknessMm: number,
    opts?: BandDetectorOptions,
  ): BandDetectionResult {
    const det = this.strategy.recognize(rectifiedFrame, dimsMm, boardThicknessMm, opts);
    if (!det.detectedZones || det.detectedZones.length === 0 || this.model.metadata.sampleCount === 0) {
      return det;
    }

    // Refinar clasificación semántica de cada celda con el VisionModel entrenado
    // respetando los conteos de cajones y sentidos de apertura detectados por tiradores
    const refinedZones: FrontZone[] = det.detectedZones.map((zone, idx) => {
      // Conservar zonas de cajón ya particionadas explícitamente y nichos abiertos claros de modo 'open'
      if (det.furnitureMode === 'open') return { ...zone };
      if (zone.kind === 'drawers' && (zone.drawerCount ?? 0) >= 1) return { ...zone };

      const isMiddle =
        zone.uStart <= 0.04 && zone.uEnd >= 0.96 && zone.vStart >= 0.15 && zone.vEnd <= 0.85;
      const feat = this.featureExtractor.extract(
        rectifiedFrame,
        zone,
        det.refLum,
        det.hShelves,
        isMiddle,
      );
      const pred = this.model.predictCell(feat);

      // Aplicar la predicción del modelo entrenado cuando tiene confianza sólida (>= 0.58)
      if (pred.confidence >= 0.58) {
        if (pred.kind === 'leg_void') {
          return { ...zone, kind: 'leg_void', label: 'Hueco Piernas' };
        }
        if (pred.kind === 'door_glass') {
          return { ...zone, kind: 'door_glass', label: `Vitrina ${idx + 1}` };
        }
        if (pred.kind === 'open') {
          return { ...zone, kind: 'open', label: isMiddle ? 'Nicho / Mesón' : `Nicho ${idx + 1}` };
        }
        if (pred.kind === 'door' && (zone.kind === 'open' || zone.kind === 'leg_void')) {
          return {
            ...zone,
            kind: idx % 2 === 0 ? 'door_left' : 'door_right',
            label: `Puerta ${idx + 1}`,
          };
        }
      }
      return { ...zone };
    });

    const hasMixedZone = refinedZones.some(
      (z) => z.kind === 'open' || z.kind === 'leg_void' || z.kind === 'door_glass',
    );
    const refinedMode =
      det.furnitureMode === 'uncertain'
        ? 'uncertain'
        : det.furnitureMode === 'open'
          ? 'open'
          : hasMixedZone
            ? 'mixed'
            : 'closed_front';

    return {
      ...det,
      furnitureMode: refinedMode,
      detectedZones: refinedZones,
    };
  }

  /**
   * Pipeline completo POO de fotografía cruda -> Homografía -> Rectificación -> Reconocimiento
   * + Clasificación aprendida (VisionModel) + Detección de patas externas.
   */
  public recognizeFromPhoto(
    sourceFrame: ImageFrameRGBA,
    quad: Quad2D,
    dimsMm: { x: number; y: number },
    boardThicknessMm: number,
    opts?: BandDetectorOptions & { focal35mm?: 26 | 52 },
  ): VisionRecognitionReport | null {
    const rectRes = this.rectifier.computeRectifiedFrame(
      sourceFrame,
      quad,
      dimsMm,
      boardThicknessMm,
    );
    if (!rectRes) return null;

    const estimatedAspectXY = this.rectifier.estimateAspectRatio(
      quad,
      sourceFrame.width,
      sourceFrame.height,
      opts?.focal35mm ?? 26,
    );
    const detection = this.recognizeRectified(
      rectRes.rectified,
      dimsMm,
      boardThicknessMm,
      opts,
    );
    const legsHint = this.rectifier.detectExternalLegs(sourceFrame, quad);

    const autoZones = inferFrontZonesFromDetection(
      detection.vDividers,
      detection.hShelves,
      detection.furnitureMode,
      detection.detectedHandles,
      detection.detectedZones,
    );

    const structuralShelves: NormalizedSegment[] =
      detection.furnitureMode === 'closed_front'
        ? []
        : detection.hShelves.filter(
            (s) =>
              !autoZones.some(
                (z) =>
                  z.kind === 'drawers' &&
                  s.position > z.vStart + 0.02 &&
                  s.position < z.vEnd - 0.02 &&
                  s.start >= z.uStart - 0.03 &&
                  s.end <= z.uEnd + 0.03,
              ),
          );

    return {
      detection,
      legsHint,
      estimatedAspectXY,
      rectifiedSize: {
        width: rectRes.rectified.width,
        height: rectRes.rectified.height,
      },
      homographyToUnit: rectRes.homographyToUnit,
      autoZones,
      structuralShelves,
      strategyUsed: this.strategy.name,
      modelId: this.model.id,
      modelVersion: this.model.version,
    };
  }

  public vectorize(
    topology: FurnitureTopology,
    params: ScaleAndBoardParams,
    despiece: DespieceResult,
    opts?: BlueprintRenderOptions,
  ): string {
    return this.renderer.render(topology, params, despiece, opts);
  }
}

/** Instancia lista para usar del Agente POO con el modelo entrenado de la OFG. */
export const defaultVisionAgent = new VisionVectorizationAgent();
