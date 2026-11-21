import { describe, expect, it } from 'vitest';
import type { FurnitureTopology, ScaleAndBoardParams } from '../../types/contracts';
import { calculateDespiece, clonePreset } from '../mathEngine';
import {
  generateCuttingPlan,
  generateDespieceCsv,
  generateExcelSpreadsheetML,
} from '../cuttingStock';
import {
  CellFeatureExtractor,
  HierarchicalPlanarRecognitionStrategy,
  PerspectiveRectifier,
  TRAINED_VISION_MODEL_SCHEMA,
  VectorRenderer2D,
  VisionModel,
  VisionVectorizationAgent,
  defaultVisionAgent,
  type LabeledCellSample,
} from './index';

describe('OFG Librería POO Reutilizable de Visión, Aprendizaje y Vectorización (`src/core/visionEngine/`)', () => {
  it('VisionModel carga pesos entrenados v1.1.0, serializa/deserializa JSON y clasifica clases semánticas', () => {
    const model = VisionModel.fromJSON(TRAINED_VISION_MODEL_SCHEMA);
    expect(model.id).toBe('ofg-furniture-vision-model');
    expect(model.metadata.sampleCount).toBeGreaterThanOrEqual(50);
    expect(model.metadata.cellTrainAccuracyPct).toBeGreaterThanOrEqual(70);

    const roundTrip = VisionModel.fromJSON(model.toJSON());
    expect(roundTrip.version).toBe(model.version);
    expect(roundTrip.metadata.prototypes).toHaveLength(5);

    // 1. Hueco de piernas blanco bajo escritorio de madera (refLum oscuro => carcassIsBright = 0)
    const legPred = roundTrip.predictCell({
      meanLumRatio: 1.85,
      lumStdNorm: 0.45,
      meanChroma: 0.1,
      brightWhiteRatio: 0.72,
      darkRatio: 0.05,
      borderMinusCenterNorm: -0.2,
      seamCountNorm: 0,
      brightShelfCountNorm: 0,
      touchesBottom: 1,
      isMiddleBand: 0,
      carcassIsBright: 0,
      cellHeightNorm: 0.65,
      cellAspectWH: 0.85,
    });
    expect(legPred.kind).toBe('leg_void');

    // 2. Puerta blanca (carcassIsBright = 1) JAMÁS se clasifica como leg_void
    const whiteDoorPred = roundTrip.predictCell({
      meanLumRatio: 1.0,
      lumStdNorm: 0.12,
      meanChroma: 0.05,
      brightWhiteRatio: 0.85,
      darkRatio: 0.01,
      borderMinusCenterNorm: 0.02,
      seamCountNorm: 0,
      brightShelfCountNorm: 0,
      touchesBottom: 1,
      isMiddleBand: 0,
      carcassIsBright: 1,
      cellHeightNorm: 0.9,
      cellAspectWH: 0.4,
    });
    expect(whiteDoorPred.kind).not.toBe('leg_void');

    // 3. Cajonera apilada (2 ranuras horizontales sobre frente sólido)
    const drawersPred = roundTrip.predictCell({
      meanLumRatio: 0.98,
      lumStdNorm: 0.18,
      meanChroma: 1.6,
      brightWhiteRatio: 0,
      darkRatio: 0.05,
      borderMinusCenterNorm: 0.05,
      seamCountNorm: 0.5,
      brightShelfCountNorm: 0,
      touchesBottom: 1,
      isMiddleBand: 0,
      carcassIsBright: 0,
      cellHeightNorm: 1.0,
      cellAspectWH: 0.35,
    });
    expect(drawersPred.kind).toBe('drawers');
  });

  it('VisionModel.trainFromSamples converge en dataset sintético limpio y calcula pesos de Fisher', () => {
    const samples: LabeledCellSample[] = [
      {
        sourceId: 's1',
        label: 'door',
        features: { meanLumRatio: 1.0, lumStdNorm: 0.1, meanChroma: 1.2, brightWhiteRatio: 0, darkRatio: 0.02, borderMinusCenterNorm: 0, seamCountNorm: 0, brightShelfCountNorm: 0, touchesBottom: 1, isMiddleBand: 0, carcassIsBright: 0, cellHeightNorm: 0.9, cellAspectWH: 0.45 },
      },
      {
        sourceId: 's2',
        label: 'door',
        features: { meanLumRatio: 0.96, lumStdNorm: 0.12, meanChroma: 1.1, brightWhiteRatio: 0, darkRatio: 0.03, borderMinusCenterNorm: 0.02, seamCountNorm: 0, brightShelfCountNorm: 0, touchesBottom: 1, isMiddleBand: 0, carcassIsBright: 0, cellHeightNorm: 0.88, cellAspectWH: 0.5 },
      },
      {
        sourceId: 's3',
        label: 'open',
        features: { meanLumRatio: 0.35, lumStdNorm: 0.4, meanChroma: 0.2, brightWhiteRatio: 0, darkRatio: 0.85, borderMinusCenterNorm: 0.1, seamCountNorm: 0, brightShelfCountNorm: 0.5, touchesBottom: 0, isMiddleBand: 1, carcassIsBright: 0, cellHeightNorm: 0.3, cellAspectWH: 2.5 },
      },
      {
        sourceId: 's4',
        label: 'drawers',
        features: { meanLumRatio: 1.0, lumStdNorm: 0.15, meanChroma: 1.2, brightWhiteRatio: 0, darkRatio: 0.04, borderMinusCenterNorm: 0, seamCountNorm: 0.5, brightShelfCountNorm: 0, touchesBottom: 1, isMiddleBand: 0, carcassIsBright: 0, cellHeightNorm: 0.9, cellAspectWH: 0.4 },
      },
    ];

    const trained = VisionModel.trainFromSamples(samples, { datasetSummary: 'Unit test' });
    const json = trained.toJSON();
    expect(json.sampleCount).toBe(4);
    expect(json.cellTrainAccuracyPct).toBe(100);
    expect(json.fisherWeights?.length).toBe(13);
  });

  it('PerspectiveRectifier.autoFrameSubjectQuad encuadra muebles sobre fondo limpio excluyendo patas y declara baja confianza en fondos ruidosos', () => {
    const rectifier = new PerspectiveRectifier(26);

    // A) Imagen sintética de catálogo: fondo blanco uniforme + mueble madera [80..320] x [60..220] + 2 patas [88..100, 300..312] x [220..265]
    const W = 400;
    const H = 300;
    const studio = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      studio[i * 4] = 250;
      studio[i * 4 + 1] = 250;
      studio[i * 4 + 2] = 250;
      studio[i * 4 + 3] = 255;
    }
    const paint = (buf: Uint8ClampedArray, x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]) => {
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * W + x) * 4;
          buf[i] = rgb[0];
          buf[i + 1] = rgb[1];
          buf[i + 2] = rgb[2];
          buf[i + 3] = 255;
        }
      }
    };
    paint(studio, 80, 60, 320, 220, [160, 115, 72]); // cuerpo melamina
    paint(studio, 88, 220, 102, 268, [90, 65, 42]); // pata izq
    paint(studio, 298, 220, 312, 268, [90, 65, 42]); // pata der

    const studioRes = rectifier.autoFrameSubjectQuad({ rgba: studio, width: W, height: H });
    expect(studioRes.confidence).toBeGreaterThanOrEqual(0.75);
    expect(studioRes.backgroundType).toBe('uniform_light');
    expect(Math.abs(studioRes.quad[0].x - 80)).toBeLessThanOrEqual(8);
    expect(Math.abs(studioRes.quad[1].x - 320)).toBeLessThanOrEqual(8);
    // Debe recortar las patas (BR/BL cerca de y=220, NO en y=268)
    expect(studioRes.quad[3].y).toBeLessThan(235);

    // B) Fondo heterogéneo (pared + piso + ruido fuerte) -> debe declarar honestamente baja confianza (< 0.5)
    const cluttered = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const checker = ((Math.floor(x / 16) + Math.floor(y / 16)) % 2) * 140;
        cluttered[i] = 40 + checker;
        cluttered[i + 1] = y > H / 2 ? 180 : 60 + checker;
        cluttered[i + 2] = 90;
        cluttered[i + 3] = 255;
      }
    }
    const clutterRes = rectifier.autoFrameSubjectQuad({ rgba: cluttered, width: W, height: H });
    expect(clutterRes.confidence).toBeLessThan(0.5);
    expect(clutterRes.backgroundType).toBe('cluttered');
  });

  it('VisionVectorizationAgent orquesta en POO detección + vectorización SVG reutilizable', () => {
    const agent = new VisionVectorizationAgent({
      rectifier: new PerspectiveRectifier(26),
      strategy: new HierarchicalPlanarRecognitionStrategy(),
      renderer: new VectorRenderer2D(),
    });
    expect(agent.getModel().id).toBe(defaultVisionAgent.getModel().id);

    const cloned = clonePreset('estanteria');
    const despiece = calculateDespiece(cloned.topology, cloned.params);
    const svg = agent.vectorize(cloned.topology, cloned.params, despiece, {
      title: 'Test Agente POO',
    });
    expect(svg).toContain('<svg ');
    expect(svg).toContain('Test Agente POO');
    expect(new CellFeatureExtractor()).toBeInstanceOf(CellFeatureExtractor);
  });

  it('Flujo E2E completo POO: Foto -> Auto-encuadre -> Reconocimiento -> Plano V0 -> Redim Vf -> Despiece 0-solapes -> Corte 244×122 -> Excel/CSV', () => {
    // 1. Foto sintética realista de catálogo: fondo blanco + mueble mixto (3 cubículos sup + 2 puertas nogal inf + 2 patas)
    const W = 480;
    const H = 640;
    const rgba = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      rgba[i * 4] = 248;
      rgba[i * 4 + 1] = 248;
      rgba[i * 4 + 2] = 248;
      rgba[i * 4 + 3] = 255;
    }
    const paint = (x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]) => {
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
    // Cuerpo en [60..420] x [40..560] + 2 patas en [72..92, 388..408] x [560..605]
    paint(60, 40, 420, 560, [94, 96, 100]);
    paint(72, 52, 178, 212, [34, 36, 40]); // cubículo 1
    paint(188, 52, 292, 212, [34, 36, 40]); // cubículo 2
    paint(302, 52, 408, 212, [34, 36, 40]); // cubículo 3
    paint(68, 220, 412, 540, [118, 76, 48]); // puertas nogal inf
    paint(239, 220, 242, 540, [24, 16, 10]); // ranura central
    paint(72, 560, 92, 605, [70, 72, 76]); // pata izq
    paint(388, 560, 408, 605, [70, 72, 76]); // pata der

    const frame = { rgba, width: W, height: H };

    // 2. Auto-encuadre (debe recortar patas automáticamente)
    const framed = defaultVisionAgent.autoFrame(frame);
    expect(framed.confidence).toBeGreaterThanOrEqual(0.75);
    expect(framed.quad[3].y).toBeLessThan(575);

    // 3. Reconocimiento POO con VisionModel v1.1.0
    const dimsV0 = defaultVisionAgent.extrapolateDimensions(
      defaultVisionAgent.estimateAspectRatio(framed.quad, W, H, 26),
      'x',
      800,
      400,
    );
    const report = defaultVisionAgent.recognizeFromPhoto(frame, framed.quad, dimsV0, 18)!;
    expect(report).not.toBeNull();
    expect(report.detection.confidence).toBeGreaterThanOrEqual(0.65);
    expect(report.detection.vDividers.length).toBeGreaterThanOrEqual(2);
    expect(report.autoZones.length).toBeGreaterThanOrEqual(3);

    // 4. Construcción de topología + Plano Vectorial Original V0 y Redimensionado Vf
    const topology: FurnitureTopology = {
      viewsMode: 1,
      aspectRatioXY: report.estimatedAspectXY,
      quadCorners: framed.quad,
      homographyMatrix: report.homographyToUnit,
      vDividers: report.detection.vDividers,
      hShelves: report.structuralShelves,
      frontZones: report.autoZones,
      shelfMode: 'custom',
      equalShelfCount: 0,
      hasBackPanel: true,
      hasExternalLegs: report.legsHint.possibleExternalLegs,
      detectionSource: 'auto',
      detectionConfidence: report.detection.confidence,
    };

    const paramsV0: ScaleAndBoardParams = {
      targetDimensions: { ...dimsV0 },
      referenceDimensions: { ...dimsV0 },
      boardThickness: 18,
      backPanelThickness: 3,
      sheetDimensions: { width: 2440, height: 1220 },
      trimMm: 0,
      kerf: 4,
      respectGrain: true,
      packingStrategy: 'guillotine',
      cornerJointType: 'topOverSides',
      edgeBandingMode: 'visibleEdgesOnly',
      material: 'grafito',
    };
    const paramsVf: ScaleAndBoardParams = {
      ...paramsV0,
      targetDimensions: { x: 1050, y: 1350, z: 450 },
    };

    const despV0 = calculateDespiece(topology, paramsV0);
    const despVf = calculateDespiece(topology, paramsVf);
    const planVf = generateCuttingPlan(despVf.matrizDespiece, paramsVf);

    expect(planVf.unplacedPieces).toHaveLength(0);
    expect(planVf.totalSheetsCount).toBeGreaterThanOrEqual(2);

    const svgV0 = defaultVisionAgent.vectorize(topology, paramsV0, despV0);
    const svgVf = defaultVisionAgent.vectorize(topology, paramsVf, despVf, { cuttingPlan: planVf });
    expect(svgV0).toContain(`Ancho X = ${dimsV0.x} mm`);
    expect(svgVf).toContain('Ancho X = 1050 mm');
    expect(svgVf).toContain('Alto Y = 1350 mm');

    // 5. Exportaciones 100% offline (Excel 3 hojas + CSV Chile)
    const xls = generateExcelSpreadsheetML(despVf, planVf, paramsVf);
    const csv = generateDespieceCsv(despVf, ';');
    expect(xls).toContain('Despiece_Melamina');
    expect(xls).toContain('Herrajes_y_Patas');
    expect(xls).toContain('Resumen_U3_y_Planchas');
    expect(csv.split('\n').length).toBeGreaterThan(4);
  });

  it('Etapa 1: compareAndRefineWithPhoto + computeDivisionMeasuresAudit equipara divisiones y cuadra cotas según la medida V0 del usuario (error 0 mm)', () => {
    const cloned = clonePreset('estanteria');
    // El usuario ingresa que el mueble original de la fotografía mide X0 = 1350 mm, Y0 = 780 mm, Z0 = 360 mm
    const userOriginalDims = { x: 1350, y: 780, z: 360 };
    const topology: FurnitureTopology = {
      ...cloned.topology,
      shelfMode: 'custom',
      equalShelfCount: 0,
      vDividers: [
        { id: 'd1', position: 0.3333, start: 0, end: 1 },
        { id: 'd2', position: 0.6667, start: 0, end: 1 },
      ],
      hShelves: [{ id: 's1', position: 0.5, start: 0, end: 1 }],
      frontZones: [
        { id: 'z1', uStart: 0, uEnd: 0.3333, vStart: 0, vEnd: 1, kind: 'door_left', label: 'Puerta 1' },
        { id: 'z2', uStart: 0.3333, uEnd: 0.6667, vStart: 0, vEnd: 1, kind: 'drawers', drawerCount: 3, label: 'Cajonera' },
        { id: 'z3', uStart: 0.6667, uEnd: 1, vStart: 0, vEnd: 1, kind: 'door_right', label: 'Puerta 2' },
      ],
    };

    const audit = defaultVisionAgent.computeDivisionMeasuresAudit(
      topology.vDividers,
      topology.hShelves,
      topology.frontZones ?? [],
      userOriginalDims,
      18,
    );

    expect(audit.bayWidthsMm).toHaveLength(3);
    expect(audit.bandHeightsMm).toHaveLength(2);
    expect(audit.widthClosureErrorMm).toBe(0);
    expect(audit.heightClosureErrorMm).toBe(0);
    // Suma de los 3 vanos + 4 espesores de 18 mm debe ser exactamente 1350 mm
    expect(audit.bayWidthsMm.reduce((a, b) => a + b, 0) + 4 * 18).toBe(1350);
    // Suma de los 2 niveles + 3 espesores de 18 mm debe ser exactamente 780 mm
    expect(audit.bandHeightsMm.reduce((a, b) => a + b, 0) + 3 * 18).toBe(780);

    // El SVG en modo Etapa 1 (isStage1OriginalOnly: true) debe mostrar las medidas V0 del usuario y de cada vano, sin pedir/entregar planchas 244x122
    const paramsV0: ScaleAndBoardParams = {
      ...cloned.params,
      referenceDimensions: { ...userOriginalDims },
      targetDimensions: { ...userOriginalDims },
    };
    const despV0 = calculateDespiece(topology, paramsV0);
    const svgStage1 = defaultVisionAgent.vectorize(topology, paramsV0, despV0, {
      isStage1OriginalOnly: true,
      photoMatchScorePct: 94.5,
    });

    expect(svgStage1).toContain('Ancho X = 1350 mm');
    expect(svgStage1).toContain('Alto Y = 780 mm');
    expect(svgStage1).toContain(`${audit.bayWidthsMm[0]} mm`);
    expect(svgStage1).toContain('ETAPA 1 — MUEBLE ORIGINAL DE LA FOTOGRAFÍA (V₀)');
    expect(svgStage1).not.toContain('Planchas 244×122 cm:');
  });
});
