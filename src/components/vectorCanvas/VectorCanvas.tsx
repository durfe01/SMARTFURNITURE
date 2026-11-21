/**
 * SMARTFURNITURE — VECTORCANVAS COMPLETO (FOTO -> HOMOGRAFÍA -> VISIÓN -> 3D) v3.0
 * - 100% offline: URL.createObjectURL + revokeObjectURL, croquis procedural local.
 * - 4 nodos [TL, TR, BR, BL] con Lupa 4x al arrastrar + vista previa rectificada en vivo.
 * - Focal fija 1x (26 mm) / 2x (52 mm) con Zhang + Calibración por 1 Medida (extrapolación) + Calibración A4.
 * - Auto-detección con anclaje de paralaje, gotero 1 clic, heurística de patas externas,
 *   edición manual con snap (vanos mixtos), marcado de tiradores y pestaña opcional Vista Lateral ZY.
 * - Rendimiento protegido: `bandDetector` NUNCA corre en `onPointerMove`.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Crosshair,
  Eraser,
  Maximize2,
  Pipette,
  Ruler,
  ScanSearch,
  Sparkles,
  Wrench,
} from 'lucide-react';
import type {
  DespieceResult,
  FrontModuleKind,
  FrontZone,
  FurnitureTopology,
  HardwareItem,
  NormalizedSegment,
  Point2D,
  ScaleAndBoardParams,
} from '../../types/contracts';
import {
  applyHomography,
  calculateDespiece,
  computeQuadToUnitHomography,
  exteriorToInterior,
  interiorToExterior,
} from '../../core/mathEngine';
import {
  rectifyImageRGBA,
} from '../../core/vision';
import { inferFrontZonesFromDetection } from '../../core/vectorBlueprint';
import { defaultVisionAgent, type PhotoVectorComparisonAudit } from '../../core/visionEngine';

interface VectorCanvasProps {
  topology: FurnitureTopology;
  params: ScaleAndBoardParams;
  despiece: DespieceResult;
  onUpdateTopology: (next: FurnitureTopology) => void;
  onApplyCalibratedDims: (dims: { x: number; y: number; z: number }) => void;
  onToggleBackPanel: (checked: boolean) => void;
  onToggleExternalLegs: (checked: boolean, heightMm?: number, count?: number) => void;
  onAddHardwareItem: (item: HardwareItem) => void;
  onSelectDepthMm: (zMm: number) => void;
  onGoToBlueprint?: () => void;
}

type ToolMode =
  | 'corners'
  | 'vDivider'
  | 'hShelf'
  | 'eyedropper'
  | 'calibA4'
  | 'hardware'
  | 'erase';

const CORNER_LABELS = ['TL', 'TR', 'BR', 'BL'] as const;
const SNAP_TOL = 0.03;

function snapValue(val: number, anchors: readonly number[]): number {
  for (const a of anchors) {
    if (Math.abs(val - a) <= SNAP_TOL) {
      return a;
    }
  }
  return val;
}

/**
 * Genera proceduralmente un croquis de ejemplo offline en canvas (estantería roble
 * en perspectiva leve con 1 divisor central, 3 repisas, 4 patas metálicas abajo y hoja A4 visible).
 */
function generateSampleFurnitureDataUrl(): string {
  const w = 900;
  const h = 680;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return '';

  // Pared y piso
  const wallGrad = ctx.createLinearGradient(0, 0, w, 0);
  wallGrad.addColorStop(0, '#cbd5e1');
  wallGrad.addColorStop(1, '#e2e8f0');
  ctx.fillStyle = wallGrad;
  ctx.fillRect(0, 0, w, 595);
  ctx.fillStyle = '#94a3b8';
  ctx.fillRect(0, 595, w, 85);

  // Coordenadas en perspectiva leve del cuerpo de melamina (excluyendo patas)
  const quad: [Point2D, Point2D, Point2D, Point2D] = [
    { x: 185, y: 85 },
    { x: 675, y: 98 },
    { x: 700, y: 515 },
    { x: 165, y: 525 },
  ];

  // Patas metálicas independientes debajo del cuerpo (para probar aislamiento de patas)
  ctx.fillStyle = '#1e293b';
  const legsX = [195, 255, 625, 675];
  for (const lx of legsX) {
    ctx.fillRect(lx, 515, 14, 82);
  }

  const hom = computeQuadToUnitHomography(quad);
  const fillPoly = (pts: Point2D[], fill: string) => {
    ctx.beginPath();
    pts.forEach((p, idx) => (idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };

  // Fondo hueco interior oscuro del mueble
  fillPoly(quad, '#334155');

  if (hom) {
    const mapRect = (u0: number, v0: number, u1: number, v1: number, color: string) => {
      const p0 = applyHomography(hom.toCanvas, { x: u0, y: v1 });
      const p1 = applyHomography(hom.toCanvas, { x: u1, y: v1 });
      const p2 = applyHomography(hom.toCanvas, { x: u1, y: v0 });
      const p3 = applyHomography(hom.toCanvas, { x: u0, y: v0 });
      if (p0 && p1 && p2 && p3) fillPoly([p0, p1, p2, p3], color);
    };

    const boardCol = '#cfa06e';
    const eU = 0.025;
    const eV = 0.03;

    // Carcasa 4 bordes
    mapRect(0, 1 - eV, 1, 1, boardCol);
    mapRect(0, 0, 1, eV, boardCol);
    mapRect(0, 0, eU, 1, boardCol);
    mapRect(1 - eU, 0, 1, 1, boardCol);

    // Divisor central
    mapRect(0.5 - eU / 2, eV, 0.5 + eU / 2, 1 - eV, boardCol);

    // 2 repisas izquierda + 1 derecha
    mapRect(eU, 0.34 - eV / 2, 0.5 - eU / 2, 0.34 + eV / 2, boardCol);
    mapRect(eU, 0.67 - eV / 2, 0.5 - eU / 2, 0.67 + eV / 2, boardCol);
    mapRect(0.5 + eU / 2, 0.52 - eV / 2, 1 - eU, 0.52 + eV / 2, boardCol);

    // Hoja A4 blanca (297 mm alto) pegada en vano derecho superior para probar calibración A4
    mapRect(0.68, 0.58, 0.85, 0.86, '#ffffff');
    const a4Label = applyHomography(hom.toCanvas, { x: 0.765, y: 0.72 });
    if (a4Label) {
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('A4', a4Label.x, a4Label.y - 4);
      ctx.font = '10px system-ui, sans-serif';
      ctx.fillText('297mm', a4Label.x, a4Label.y + 10);
    }
  }

  return c.toDataURL('image/png');
}

export function VectorCanvas({
  topology,
  params,
  despiece: _despiece,
  onUpdateTopology,
  onApplyCalibratedDims,
  onToggleBackPanel,
  onToggleExternalLegs,
  onAddHardwareItem,
  onSelectDepthMm,
  onGoToBlueprint,
}: VectorCanvasProps) {
  void _despiece;
  const [viewTab, setViewTab] = useState<'frontal' | 'lateral'>('frontal');
  const [showProtocol, setShowProtocol] = useState(true);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [imgSize, setImgSize] = useState<{ w: number; h: number }>({ w: 900, h: 680 });

  // Vista lateral opcional ZY
  const [sideImgUrl, setSideImgUrl] = useState<string | null>(null);
  const [sideImgEl, setSideImgEl] = useState<HTMLImageElement | null>(null);
  const [sideQuad, setSideQuad] = useState<[Point2D, Point2D, Point2D, Point2D]>([
    { x: 180, y: 100 },
    { x: 460, y: 100 },
    { x: 470, y: 520 },
    { x: 170, y: 520 },
  ]);

  const [quad, setQuad] = useState<[Point2D, Point2D, Point2D, Point2D]>(
    topology.quadCorners ?? [
      { x: 185, y: 85 },
      { x: 675, y: 98 },
      { x: 700, y: 515 },
      { x: 165, y: 525 },
    ],
  );
  const [tool, setTool] = useState<ToolMode>('corners');
  const [focal35mm, setFocal35mm] = useState<26 | 52>(26);
  const [dragCornerIdx, setDragCornerIdx] = useState<number | null>(null);
  const [cursorImgPt, setCursorImgPt] = useState<Point2D | null>(null);
  const [draftLineStart, setDraftLineStart] = useState<Point2D | null>(null);

  // Calibración de las dimensiones reales del Mueble Original de la Fotografía (V₀)
  const [knownAxis, setKnownAxis] = useState<'x' | 'y' | 'both'>('x');
  const [showOverlayOnRectified, setShowOverlayOnRectified] = useState<boolean>(true);
  const [lastComparisonAudit, setLastComparisonAudit] = useState<PhotoVectorComparisonAudit | null>(null);

  // Calibración A4 por segmento [p1, p2]
  const [calibPts, setCalibPts] = useState<Point2D[]>([]);
  const [calibRefMm, setCalibRefMm] = useState<number>(297);

  // Feedback del detector
  const [statusMsg, setStatusMsg] = useState<string>(
    'Etapa 1: Carga una foto frontal (o el croquis local), ajusta las 4 esquinas y verifica la equiparación Foto ↔ Vector Original (V₀).',
  );
  const [legHintDetected, setLegHintDetected] = useState<boolean>(false);
  const [needsManualCorners, setNeedsManualCorners] = useState<boolean>(false);
  const [detectedModeLabel, setDetectedModeLabel] = useState<string>('');
  const [hardwareMarkers, setHardwareMarkers] = useState<Point2D[]>([]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rectPreviewRef = useRef<HTMLCanvasElement | null>(null);
  const rectCompareRef = useRef<HTMLCanvasElement | null>(null);
  const srcRgbaCacheRef = useRef<{ rgba: Uint8ClampedArray; w: number; h: number } | null>(null);
  const quadRef = useRef<[Point2D, Point2D, Point2D, Point2D]>(quad);
  quadRef.current = quad;

  // Referencias sincronizadas para que el pipeline de visión NUNCA sobrescriba las medidas V₀ del usuario
  const knownAxisRef = useRef<'x' | 'y' | 'both'>(knownAxis);
  knownAxisRef.current = knownAxis;
  const referenceDimsRef = useRef<{ x: number; y: number; z: number }>(params.referenceDimensions);
  referenceDimsRef.current = params.referenceDimensions;

  // Parámetros y despiece exclusivos del Mueble Original de la Fotografía (V₀) para Etapa 1
  const stage1OriginalParams = useMemo<ScaleAndBoardParams>(
    () => ({
      ...params,
      targetDimensions: { ...params.referenceDimensions },
    }),
    [params],
  );

  const stage1OriginalDespiece = useMemo(
    () => calculateDespiece(topology, stage1OriginalParams),
    [topology, stage1OriginalParams],
  );

  // Auditoría en vivo de las medidas en mm de cada división según las medidas V₀ del usuario
  const liveDivisionAudit = useMemo(
    () =>
      defaultVisionAgent.computeDivisionMeasuresAudit(
        topology.vDividers,
        topology.hShelves,
        topology.frontZones ?? [],
        params.referenceDimensions,
        params.boardThickness,
      ),
    [
      topology.vDividers,
      topology.hShelves,
      topology.frontZones,
      params.referenceDimensions,
      params.boardThickness,
    ],
  );

  const liveBlueprintSvg = useMemo(
    () =>
      defaultVisionAgent.vectorize(topology, stage1OriginalParams, stage1OriginalDespiece, {
        title: topology.furnitureProfileLabel ?? 'Mueble Vectorial Original (V₀)',
        stageLabel: 'ETAPA 1 — MODELO VECTORIAL DEL MUEBLE DE LA FOTOGRAFÍA (V₀)',
        isStage1OriginalOnly: true,
        photoMatchScorePct: lastComparisonAudit?.matchScorePct,
      }),
    [topology, stage1OriginalParams, stage1OriginalDespiece, lastComparisonAudit?.matchScorePct],
  );

  // Limpieza segura de URLs creadas con createObjectURL
  useEffect(() => {
    return () => {
      if (imgUrl && imgUrl.startsWith('blob:')) URL.revokeObjectURL(imgUrl);
    };
  }, [imgUrl]);

  useEffect(() => {
    return () => {
      if (sideImgUrl && sideImgUrl.startsWith('blob:')) URL.revokeObjectURL(sideImgUrl);
    };
  }, [sideImgUrl]);

  const homography = useMemo(() => computeQuadToUnitHomography(quad), [quad]);

  const estimatedAspectXY = useMemo(() => {
    return defaultVisionAgent.estimateAspectRatio(quad, imgSize.w, imgSize.h, focal35mm);
  }, [quad, imgSize.w, imgSize.h, focal35mm]);

  const extractSourceRgba = (image: HTMLImageElement): { rgba: Uint8ClampedArray; w: number; h: number } => {
    const off = document.createElement('canvas');
    off.width = image.naturalWidth;
    off.height = image.naturalHeight;
    const ctx = off.getContext('2d');
    if (!ctx) {
      return { rgba: new Uint8ClampedArray(0), w: 0, h: 0 };
    }
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, off.width, off.height);
    return { rgba: data.data, w: off.width, h: off.height };
  };

  const executeDetectionPipeline = (
    activeQuad: [Point2D, Point2D, Point2D, Point2D],
    srcCache: { rgba: Uint8ClampedArray; w: number; h: number },
    seedPoint?: { u: number; v: number },
    autoNote?: string,
  ) => {
    const activeHom = computeQuadToUnitHomography(activeQuad);
    if (!activeHom || srcCache.w === 0) {
      setStatusMsg('Cuadrilátero inválido para homografía. Separa las 4 esquinas en orden horario.');
      return;
    }

    const aspect = defaultVisionAgent.estimateAspectRatio(
      activeQuad,
      srcCache.w,
      srcCache.h,
      focal35mm,
    );
    // Respetar SIEMPRE la medida del mueble original V₀ ingresada por el usuario (jamás sobrescribir con valores inventados)
    const curRef = referenceDimsRef.current;
    const activeAxis = knownAxisRef.current;
    const syncedDims =
      activeAxis === 'both'
        ? { x: curRef.x, y: curRef.y, z: curRef.z }
        : defaultVisionAgent.extrapolateDimensions(
            aspect,
            activeAxis,
            activeAxis === 'x' ? curRef.x : curRef.y,
            curRef.z,
          );

    const report = defaultVisionAgent.recognizeFromPhoto(
      { rgba: srcCache.rgba, width: srcCache.w, height: srcCache.h },
      activeQuad,
      { x: syncedDims.x, y: syncedDims.y },
      params.boardThickness,
      { seedPoint, parallaxAware: true, horizonV: 0.5, focal35mm },
    );
    if (!report) {
      setStatusMsg('Cuadrilátero inválido para homografía. Separa las 4 esquinas en orden horario.');
      return;
    }

    const det = report.detection;
    const legsHint = report.legsHint;
    setLegHintDetected(legsHint.possibleExternalLegs);
    setLastComparisonAudit(report.comparisonAudit);

    // Proyectar tiradores detectados sobre la foto y registrarlos en Herrajes (sin duplicar)
    const manualHardware = (topology.hardwareItems ?? []).filter((h) => h.origen !== 'detectado');
    const nextHardware = [...manualHardware];
    const projectedHandles: Point2D[] = [];

    if (det.detectedHandles.length > 0) {
      for (const hPt of det.detectedHandles) {
        const mapped = applyHomography(activeHom.toCanvas, { x: hPt.u, y: hPt.v });
        if (mapped) projectedHandles.push(mapped);
      }
      nextHardware.push({
        id: 'hw_tiradores_auto',
        categoria: 'tiradores',
        descripcion: `Tiradores / manillas detectados en frente (${det.detectedHandles.length} u.)`,
        cantidad: det.detectedHandles.length,
        notaCompra: `Detectados automáticamente por ${report.modelId} v${report.modelVersion}. Adquirir ${det.detectedHandles.length} tiradores aparte (no son melamina).`,
        origen: 'detectado',
      });
    }
    setHardwareMarkers(projectedHandles);

    const modeText =
      det.furnitureMode === 'closed_front'
        ? 'Mueble Cerrado (Puertas/Cajones)'
        : det.furnitureMode === 'mixed'
          ? 'Mueble Mixto / Multinivel'
          : det.furnitureMode === 'open'
            ? 'Mueble Abierto (Estantería/Vanos)'
            : 'Ajustar 4 Esquinas';
    setDetectedModeLabel(modeText);

    // Actualizar dimensiones de referencia V0 = Vf con la relación de aspecto real detectada
    onApplyCalibratedDims(syncedDims);

    // SIEMPRE limpiar el preset anterior (`equalShelfCount: 0, shelfMode: 'custom'`)
    // para que jamás quede fantasma de la estantería inicial sobre una foto nueva
    onUpdateTopology({
      ...topology,
      aspectRatioXY: report.estimatedAspectXY,
      quadCorners: activeQuad,
      homographyMatrix: report.homographyToUnit,
      shelfMode: 'custom',
      equalShelfCount: 0,
      hasBackPanel: true,
      hasExternalLegs: legsHint.possibleExternalLegs,
      externalLegHeightMm: legsHint.possibleExternalLegs ? 140 : undefined,
      externalLegCount: legsHint.possibleExternalLegs ? 4 : undefined,
      toeKickHeightMm: legsHint.possibleExternalLegs ? 0 : 70,
      vDividers: det.vDividers,
      hShelves: report.structuralShelves,
      frontZones: report.autoZones,
      furnitureProfileLabel:
        det.confidence >= 0.5
          ? `${modeText} (${report.autoZones.length} módulos)`
          : 'Foto cargada — Ajusta las 4 esquinas TL/TR/BR/BL',
      hardwareItems: nextHardware,
      detectionSource: 'auto',
      detectionConfidence: det.confidence,
    });

    const prefix = autoNote ? `${autoNote} · ` : '';
    if (det.confidence < 0.5) {
      setStatusMsg(
        `${prefix}Confianza baja (${Math.round(det.confidence * 100)}%). Arrastra las 4 esquinas azules (TL, TR, BR, BL) exactamente sobre el cuerpo del mueble (sin pared ni patas) — al soltar cada esquina se recalcula automáticamente.`,
      );
    } else {
      const handleMsg =
        det.detectedHandles.length > 0
          ? ` + ${det.detectedHandles.length} tirador(es)`
          : '';
      const legsMsg = legsHint.possibleExternalLegs
        ? ' + patas externas detectadas'
        : '';
      setStatusMsg(
        `${prefix}[${modeText} · Equiparación Foto↔Vector ${report.comparisonAudit.matchScorePct}%] V₀ = ${syncedDims.x}×${syncedDims.y}×${syncedDims.z} mm: ${det.vDividers.length} div. V, ${det.hShelves.length} div. H, ${report.autoZones.length} módulos${handleMsg}${legsMsg}.`,
      );
    }
  };

  const loadFrontalFromUrl = (url: string, isSample = false) => {
    const img = new Image();
    img.onload = () => {
      setImgUrl(url);
      setImgEl(img);
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      setImgSize({ w, h });
      const srcData = extractSourceRgba(img);
      srcRgbaCacheRef.current = srcData;

      let initialQuad: [Point2D, Point2D, Point2D, Point2D];
      let autoNote = '';

      if (isSample) {
        initialQuad = [
          { x: 185, y: 85 },
          { x: 675, y: 98 },
          { x: 700, y: 515 },
          { x: 165, y: 525 },
        ];
        setNeedsManualCorners(false);
        autoNote = 'Croquis local';
      } else {
        // Auto-encuadrar inmediatamente al subir la foto
        const framed = defaultVisionAgent.autoFrame({
          rgba: srcData.rgba,
          width: srcData.w,
          height: srcData.h,
        });
        initialQuad = framed.quad;
        if (framed.confidence >= 0.5) {
          setNeedsManualCorners(false);
          autoNote = `Auto-encuadre ${Math.round(framed.confidence * 100)}%`;
        } else {
          setNeedsManualCorners(true);
          autoNote = 'Fondo con pared/piso (ajusta TL/TR/BR/BL con Lupa 4×)';
        }
      }

      setQuad(initialQuad);
      quadRef.current = initialQuad;
      setCalibPts([]);
      setHardwareMarkers([]);
      setLegHintDetected(false);

      if (isSample || autoNote.startsWith('Auto-encuadre')) {
        // Fondo uniforme o croquis: ejecutar reconocimiento inmediato al subir la foto
        executeDetectionPipeline(initialQuad, srcData, undefined, autoNote);
      } else {
        // Fondo con ambiente real (pared/piso): limpiar inmediatamente el preset anterior ("estantería")
        // para no mostrar jamás una repisa falsa antes de que el usuario ajuste las 4 esquinas TL/TR/BR/BL
        onUpdateTopology({
          ...topology,
          quadCorners: initialQuad,
          shelfMode: 'custom',
          equalShelfCount: 0,
          vDividers: [],
          hShelves: [],
          frontZones: [],
          hasExternalLegs: false,
          hardwareItems: [],
          furnitureProfileLabel: 'Foto con ambiente real — Arrastra TL, TR, BR, BL al cuerpo del mueble',
          detectionSource: 'manual',
          detectionConfidence: 0.35,
        });
        setDetectedModeLabel('Esperando encuadre 4 esquinas');
        setStatusMsg(
          'Foto con ambiente real cargada (pared/piso). Arrastra los 4 nodos azules TL, TR, BR, BL sobre las esquinas del cuerpo de melamina — al soltar cada esquina se detectará y dibujará el Plano Vectorial 2D automáticamente.',
        );
      }
    };
    img.src = url;
  };

  const handleFileFrontal = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    e.target.value = '';
    loadFrontalFromUrl(url, false);
  };

  const handleFileSide = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setSideImgUrl(url);
      setSideImgEl(img);
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      setSideQuad([
        { x: Math.round(w * 0.25), y: Math.round(h * 0.14) },
        { x: Math.round(w * 0.75), y: Math.round(h * 0.14) },
        { x: Math.round(w * 0.75), y: Math.round(h * 0.86) },
        { x: Math.round(w * 0.25), y: Math.round(h * 0.86) },
      ]);
    };
    img.src = url;
  };

  // Render de miniatura rectificada + canvas comparativo Foto Rectificada vs Vector V₀ con cotas superpuestas
  useEffect(() => {
    const previewCanvas = rectPreviewRef.current;
    const compareCanvas = rectCompareRef.current;
    const srcCache = srcRgbaCacheRef.current;
    if (!previewCanvas || !srcCache || srcCache.w === 0 || !homography) return;

    const previewW = dragCornerIdx !== null ? 200 : 320;
    const previewH = Math.max(110, Math.min(340, Math.round(previewW / Math.max(0.25, estimatedAspectXY))));
    previewCanvas.width = previewW;
    previewCanvas.height = previewH;

    const rectRgba = rectifyImageRGBA(
      srcCache.rgba,
      srcCache.w,
      srcCache.h,
      homography.toCanvas,
      previewW,
      previewH,
    );

    const drawRectifiedWithOverlay = (targetCanvas: HTMLCanvasElement, scaleW: number, scaleH: number) => {
      targetCanvas.width = scaleW;
      targetCanvas.height = scaleH;
      const ctx = targetCanvas.getContext('2d');
      if (!ctx) return;

      if (scaleW === previewW && scaleH === previewH) {
        const imgData = new ImageData(new Uint8ClampedArray(rectRgba), previewW, previewH);
        ctx.putImageData(imgData, 0, 0);
      } else {
        const hiRgba = rectifyImageRGBA(
          srcCache.rgba,
          srcCache.w,
          srcCache.h,
          homography.toCanvas,
          scaleW,
          scaleH,
        );
        const imgData = new ImageData(new Uint8ClampedArray(hiRgba), scaleW, scaleH);
        ctx.putImageData(imgData, 0, 0);
      }

      if (!showOverlayOnRectified) return;

      const e = params.boardThickness;
      const x0 = params.referenceDimensions.x;
      const y0 = params.referenceDimensions.y;

      // Dibujar divisores verticales del modelo vectorial sobre la foto rectificada
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = Math.max(2, scaleW / 150);
      for (const div of topology.vDividers) {
        const uExt = interiorToExterior(div.position, e, x0);
        const vTop = 1 - interiorToExterior(div.end, e, y0);
        const vBot = 1 - interiorToExterior(div.start, e, y0);
        const px = uExt * scaleW;
        ctx.beginPath();
        ctx.moveTo(px, vTop * scaleH);
        ctx.lineTo(px, vBot * scaleH);
        ctx.stroke();
      }

      // Dibujar niveles horizontales del modelo vectorial sobre la foto rectificada
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = Math.max(2, scaleW / 150);
      for (const sh of topology.hShelves) {
        const py = (1 - interiorToExterior(sh.position, e, y0)) * scaleH;
        const xStart = interiorToExterior(sh.start, e, x0) * scaleW;
        const xEnd = interiorToExterior(sh.end, e, x0) * scaleW;
        ctx.beginPath();
        ctx.moveTo(xStart, py);
        ctx.lineTo(xEnd, py);
        ctx.stroke();
      }

      // Etiquetas de cotas en milímetros sobre la foto rectificada para comparar directo con el vector
      ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
      ctx.fillRect(0, 0, scaleW, 20);
      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 11px Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`Foto Rectificada: X₀=${x0} mm × Y₀=${y0} mm`, scaleW / 2, 14);

      // Cotas de cada vano vertical en la base de la foto rectificada
      const uRaw = [0, ...topology.vDividers.map((d) => Math.max(0.02, Math.min(0.98, d.position))), 1].sort(
        (a, b) => a - b,
      );
      const uStops: number[] = [0];
      for (const u of uRaw) {
        if (u - uStops[uStops.length - 1] >= 0.035) uStops.push(u);
      }
      if (1 - uStops[uStops.length - 1] < 0.035 && uStops.length > 1) {
        uStops[uStops.length - 1] = 1;
      } else if (uStops[uStops.length - 1] < 1) {
        uStops.push(1);
      }

      ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
      ctx.fillRect(0, scaleH - 20, scaleW, 20);
      ctx.fillStyle = '#4ade80';
      ctx.font = 'bold 10px Consolas, monospace';
      for (let i = 0; i < uStops.length - 1; i++) {
        const cx = ((uStops[i] + uStops[i + 1]) * 0.5) * scaleW;
        const wMm = liveDivisionAudit.bayWidthsMm[i] ?? Math.round((uStops[i + 1] - uStops[i]) * (x0 - 2 * e));
        if ((uStops[i + 1] - uStops[i]) * scaleW >= 36) {
          ctx.fillText(`${wMm}mm`, cx, scaleH - 6);
        }
      }
    };

    drawRectifiedWithOverlay(previewCanvas, previewW, previewH);
    if (compareCanvas && dragCornerIdx === null) {
      const cmpW = 460;
      const cmpH = Math.max(180, Math.min(440, Math.round(cmpW / Math.max(0.25, estimatedAspectXY))));
      drawRectifiedWithOverlay(compareCanvas, cmpW, cmpH);
    }
  }, [
    imgEl,
    quad,
    homography,
    estimatedAspectXY,
    dragCornerIdx,
    showOverlayOnRectified,
    topology.vDividers,
    topology.hShelves,
    params.boardThickness,
    params.referenceDimensions.x,
    params.referenceDimensions.y,
    liveDivisionAudit.bayWidthsMm,
  ]);

  // Dibujo del lienzo principal con malla proyectiva, líneas detectadas, tiradores y Lupa 4x
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const activeImg = viewTab === 'frontal' ? imgEl : sideImgEl;
    const activeQuad = viewTab === 'frontal' ? quad : sideQuad;
    const cw = activeImg ? activeImg.naturalWidth : 900;
    const ch = activeImg ? activeImg.naturalHeight : 680;
    canvas.width = cw;
    canvas.height = ch;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, cw, ch);

    if (activeImg) {
      ctx.drawImage(activeImg, 0, 0, cw, ch);
    } else {
      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 20px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        viewTab === 'frontal'
          ? 'Carga una foto frontal o pulsa "Cargar croquis de ejemplo local"'
          : 'Vista Lateral ZY opcional: carga una foto de costado para estimar profundidad Z',
        cw / 2,
        ch / 2,
      );
      return;
    }

    // Contorno del cuadrilátero
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = Math.max(2, cw / 360);
    ctx.beginPath();
    activeQuad.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.stroke();

    if (viewTab === 'frontal' && homography) {
      const { toCanvas } = homography;
      // Grilla proyectiva tenue 4×4
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.28)';
      ctx.lineWidth = 1;
      for (const k of [0.25, 0.5, 0.75]) {
        const a = applyHomography(toCanvas, { x: k, y: 0 });
        const b = applyHomography(toCanvas, { x: k, y: 1 });
        if (a && b) {
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
        const c = applyHomography(toCanvas, { x: 0, y: k });
        const d = applyHomography(toCanvas, { x: 1, y: k });
        if (c && d) {
          ctx.beginPath();
          ctx.moveTo(c.x, c.y);
          ctx.lineTo(d.x, d.y);
          ctx.stroke();
        }
      }

      // Divisores verticales (convertidos interior -> exterior para dibujar sobre la foto)
      const e = params.boardThickness;
      const xf = params.targetDimensions.x;
      const yf = params.targetDimensions.y;

      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = Math.max(3, cw / 280);
      for (const div of topology.vDividers) {
        const uExt = interiorToExterior(div.position, e, xf);
        const v0 = interiorToExterior(div.start, e, yf);
        const v1 = interiorToExterior(div.end, e, yf);
        const p0 = applyHomography(toCanvas, { x: uExt, y: v0 });
        const p1 = applyHomography(toCanvas, { x: uExt, y: v1 });
        if (p0 && p1) {
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.stroke();
        }
      }

      // Repisas horizontales
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = Math.max(3, cw / 280);
      for (const sh of topology.hShelves) {
        const vExt = interiorToExterior(sh.position, e, yf);
        const u0 = interiorToExterior(sh.start, e, xf);
        const u1 = interiorToExterior(sh.end, e, xf);
        const p0 = applyHomography(toCanvas, { x: u0, y: vExt });
        const p1 = applyHomography(toCanvas, { x: u1, y: vExt });
        if (p0 && p1) {
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.stroke();
        }
      }

      // Segmento de calibración A4 si existe
      if (calibPts.length >= 1) {
        ctx.fillStyle = '#ec4899';
        for (const cp of calibPts) {
          ctx.beginPath();
          ctx.arc(cp.x, cp.y, 7, 0, Math.PI * 2);
          ctx.fill();
        }
        if (calibPts.length === 2) {
          ctx.strokeStyle = '#ec4899';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(calibPts[0].x, calibPts[0].y);
          ctx.lineTo(calibPts[1].x, calibPts[1].y);
          ctx.stroke();
        }
      }

      // Marcadores de tiradores / herrajes
      for (const hm of hardwareMarkers) {
        ctx.fillStyle = '#a855f7';
        ctx.beginPath();
        ctx.arc(hm.x, hm.y, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    // Nodos arrastrables [TL, TR, BR, BL]
    const nodeR = Math.max(9, cw / 90);
    activeQuad.forEach((p, idx) => {
      ctx.fillStyle = dragCornerIdx === idx ? '#f59e0b' : '#0284c7';
      ctx.beginPath();
      ctx.arc(p.x, p.y, nodeR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.round(nodeR * 1.1)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(CORNER_LABELS[idx], p.x, p.y);
    });

    // Lupa 4× al arrastrar una esquina
    if (dragCornerIdx !== null && cursorImgPt && activeImg) {
      const magSize = Math.min(180, Math.round(cw * 0.22));
      const zoom = 4;
      const srcSpan = magSize / zoom;
      const mx = cursorImgPt.x < cw / 2 ? cw - magSize - 16 : 16;
      const my = 16;

      ctx.save();
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(mx - 3, my - 3, magSize + 6, magSize + 6);
      ctx.drawImage(
        activeImg,
        cursorImgPt.x - srcSpan / 2,
        cursorImgPt.y - srcSpan / 2,
        srcSpan,
        srcSpan,
        mx,
        my,
        magSize,
        magSize,
      );
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 2;
      ctx.strokeRect(mx, my, magSize, magSize);
      // Mira central de la lupa
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(mx + magSize / 2 - 12, my + magSize / 2);
      ctx.lineTo(mx + magSize / 2 + 12, my + magSize / 2);
      ctx.moveTo(mx + magSize / 2, my + magSize / 2 - 12);
      ctx.lineTo(mx + magSize / 2, my + magSize / 2 + 12);
      ctx.stroke();
      ctx.restore();
    }
  }, [
    viewTab,
    imgEl,
    sideImgEl,
    quad,
    sideQuad,
    homography,
    topology.vDividers,
    topology.hShelves,
    params.boardThickness,
    params.targetDimensions.x,
    params.targetDimensions.y,
    dragCornerIdx,
    cursorImgPt,
    calibPts,
    hardwareMarkers,
  ]);

  const toCanvasCoords = (e: React.PointerEvent<HTMLCanvasElement>): Point2D => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const handleAutoFrameQuad = () => {
    const srcCache = srcRgbaCacheRef.current;
    if (!srcCache || srcCache.w === 0) {
      setStatusMsg('Primero carga una foto frontal para auto-encuadrar.');
      return;
    }
    const framed = defaultVisionAgent.autoFrame({
      rgba: srcCache.rgba,
      width: srcCache.w,
      height: srcCache.h,
    });
    if (framed.confidence >= 0.5) {
      setNeedsManualCorners(false);
      setQuad(framed.quad);
      executeDetectionPipeline(framed.quad, srcCache, undefined, `Auto-encuadre ${Math.round(framed.confidence * 100)}%`);
    } else {
      setNeedsManualCorners(true);
      setStatusMsg(framed.message);
    }
  };

  const runAutoDetection = (seedPoint?: { u: number; v: number }) => {
    const srcCache = srcRgbaCacheRef.current;
    if (!srcCache || srcCache.w === 0 || !homography) {
      setStatusMsg('Primero carga una imagen válida y ubica las 4 esquinas sin cruzarlas.');
      return;
    }
    executeDetectionPipeline(quad, srcCache, seedPoint);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const pt = toCanvasCoords(e);
    const activeQuad = viewTab === 'frontal' ? quad : sideQuad;

    // Prioridad: si estamos en modo esquinas (o cerca de un nodo), arrastrar esquina
    if (tool === 'corners' || viewTab === 'lateral') {
      const hitTol = Math.max(22, (canvasRef.current?.width ?? 900) * 0.032);
      const hitIdx = activeQuad.findIndex((p) => Math.hypot(p.x - pt.x, p.y - pt.y) <= hitTol);
      if (hitIdx !== -1) {
        setDragCornerIdx(hitIdx);
        setCursorImgPt(pt);
        (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
      }
      return;
    }

    if (!homography) return;
    const unitPt = applyHomography(homography.toUnit, pt);
    if (!unitPt) return;

    const eMm = params.boardThickness;
    const xf = params.targetDimensions.x;
    const yf = params.targetDimensions.y;

    if (tool === 'eyedropper') {
      runAutoDetection({ u: Math.max(0, Math.min(1, unitPt.x)), v: Math.max(0, Math.min(1, unitPt.y)) });
      setTool('corners');
      return;
    }

    if (tool === 'calibA4') {
      setCalibPts((prev) => (prev.length >= 2 ? [pt] : [...prev, pt]));
      return;
    }

    if (tool === 'hardware') {
      setHardwareMarkers((prev) => [...prev, pt]);
      onAddHardwareItem({
        id: `hw_foto_${Date.now()}`,
        categoria: 'tiradores',
        descripcion: 'Tirador / accesorio marcado en foto',
        cantidad: 1,
        notaCompra: 'Elemento ajeno a la melamina — marcado sobre foto frontal.',
        origen: 'manual',
      });
      setStatusMsg('Tirador / herraje registrado en la tabla de Herrajes (excluido del corte de melamina).');
      return;
    }

    if (tool === 'vDivider') {
      const uInt = exteriorToInterior(unitPt.x, eMm, xf);
      if (uInt > 0.04 && uInt < 0.96) {
        const nextDiv: NormalizedSegment = {
          id: `man_div_${Date.now()}`,
          position: Number(uInt.toFixed(4)),
          start: 0,
          end: 1,
        };
        onUpdateTopology({
          ...topology,
          aspectRatioXY: estimatedAspectXY,
          quadCorners: quad,
          homographyMatrix: homography.toUnit.map((r) => [...r]),
          shelfMode: 'custom',
          vDividers: [...topology.vDividers, nextDiv],
          detectionSource: 'manual',
        });
        setStatusMsg(`Divisor vertical agregado en u = ${(uInt * 100).toFixed(1)}%.`);
      }
      return;
    }

    if (tool === 'hShelf') {
      setDraftLineStart(pt);
      return;
    }

    if (tool === 'erase') {
      const uClick = exteriorToInterior(unitPt.x, eMm, xf);
      const vClick = exteriorToInterior(unitPt.y, eMm, yf);
      // Buscar el divisor o repisa más cercano dentro de tolerancia 0.045
      let bestDist = 0.045;
      let targetKind: 'div' | 'shelf' | null = null;
      let targetId = '';

      for (const d of topology.vDividers) {
        const dist = Math.abs(d.position - uClick);
        if (dist < bestDist) {
          bestDist = dist;
          targetKind = 'div';
          targetId = d.id;
        }
      }
      for (const s of topology.hShelves) {
        if (uClick >= s.start - 0.03 && uClick <= s.end + 0.03) {
          const dist = Math.abs(s.position - vClick);
          if (dist < bestDist) {
            bestDist = dist;
            targetKind = 'shelf';
            targetId = s.id;
          }
        }
      }

      if (targetKind === 'div') {
        onUpdateTopology({
          ...topology,
          vDividers: topology.vDividers.filter((d) => d.id !== targetId),
        });
        setStatusMsg('Divisor vertical eliminado.');
      } else if (targetKind === 'shelf') {
        onUpdateTopology({
          ...topology,
          hShelves: topology.hShelves.filter((s) => s.id !== targetId),
        });
        setStatusMsg('Repisa horizontal eliminada.');
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragCornerIdx === null) return;
    const pt = toCanvasCoords(e);
    setCursorImgPt(pt);

    if (viewTab === 'frontal') {
      setQuad((prev) => {
        const copy: [Point2D, Point2D, Point2D, Point2D] = [
          { ...prev[0] },
          { ...prev[1] },
          { ...prev[2] },
          { ...prev[3] },
        ];
        copy[dragCornerIdx] = pt;
        quadRef.current = copy;
        return copy;
      });
    } else {
      setSideQuad((prev) => {
        const copy: [Point2D, Point2D, Point2D, Point2D] = [
          { ...prev[0] },
          { ...prev[1] },
          { ...prev[2] },
          { ...prev[3] },
        ];
        copy[dragCornerIdx] = pt;
        return copy;
      });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragCornerIdx !== null) {
      setDragCornerIdx(null);
      setCursorImgPt(null);
      if (viewTab === 'frontal' && srcRgbaCacheRef.current) {
        // Re-detectar automáticamente al soltar una esquina (NUNCA durante onPointerMove)
        setNeedsManualCorners(false);
        executeDetectionPipeline(quadRef.current, srcRgbaCacheRef.current);
      } else if (viewTab === 'lateral' && sideImgEl) {
        const ratioZY = defaultVisionAgent.estimateAspectRatio(
          sideQuad,
          sideImgEl.naturalWidth,
          sideImgEl.naturalHeight,
          focal35mm,
        );
        const estDepth = Math.max(200, Math.min(800, Math.round(params.targetDimensions.y * ratioZY)));
        onUpdateTopology({ ...topology, viewsMode: 2, aspectRatioZY: ratioZY });
        onSelectDepthMm(estDepth);
        setStatusMsg(`Profundidad Z actualizada desde Vista Lateral ZY: ${estDepth} mm.`);
      }
      return;
    }

    if (tool === 'hShelf' && draftLineStart && homography) {
      const endPt = toCanvasCoords(e);
      const uA = applyHomography(homography.toUnit, draftLineStart);
      const uB = applyHomography(homography.toUnit, endPt);
      setDraftLineStart(null);
      if (!uA || !uB) return;

      const eMm = params.boardThickness;
      const xf = params.targetDimensions.x;
      const yf = params.targetDimensions.y;
      const anchors = [0, ...topology.vDividers.map((d) => d.position), 1];

      const rawStart = exteriorToInterior(Math.min(uA.x, uB.x), eMm, xf);
      const rawEnd = exteriorToInterior(Math.max(uA.x, uB.x), eMm, xf);
      const vMid = exteriorToInterior((uA.y + uB.y) / 2, eMm, yf);

      // Si fue un clic corto (< 4%), llenar automáticamente el vano donde hizo clic
      let uStart = snapValue(rawStart, anchors);
      let uEnd = snapValue(rawEnd, anchors);
      if (Math.abs(uEnd - uStart) < 0.05) {
        const sortedA = [...anchors].sort((a, b) => a - b);
        const clickU = exteriorToInterior(uA.x, eMm, xf);
        for (let i = 0; i < sortedA.length - 1; i++) {
          if (clickU >= sortedA[i] && clickU <= sortedA[i + 1]) {
            uStart = sortedA[i];
            uEnd = sortedA[i + 1];
            break;
          }
        }
      }

      if (uEnd - uStart >= 0.04 && vMid > 0.03 && vMid < 0.97) {
        const nextShelf: NormalizedSegment = {
          id: `man_rep_${Date.now()}`,
          position: Number(vMid.toFixed(4)),
          start: Number(uStart.toFixed(4)),
          end: Number(uEnd.toFixed(4)),
        };
        onUpdateTopology({
          ...topology,
          aspectRatioXY: estimatedAspectXY,
          quadCorners: quad,
          homographyMatrix: homography.toUnit.map((r) => [...r]),
          shelfMode: 'custom',
          hShelves: [...topology.hShelves, nextShelf],
          detectionSource: 'manual',
        });
        setStatusMsg(`Repisa agregada en v = ${(vMid * 100).toFixed(1)}% sobre vano [${(uStart * 100).toFixed(0)}%, ${(uEnd * 100).toFixed(0)}%].`);
      }
    }
  };

  const handleUpdateOriginalDimension = (axis: 'x' | 'y' | 'z', rawValue: number) => {
    const clamped =
      axis === 'z'
        ? Math.max(200, Math.min(800, Math.round(rawValue)))
        : Math.max(300, Math.min(2600, Math.round(rawValue)));

    if (axis === 'z') {
      const nextDims = {
        ...params.referenceDimensions,
        z: clamped,
      };
      onApplyCalibratedDims(nextDims);
      return;
    }

    if (knownAxis === 'both') {
      const nextDims = {
        ...params.referenceDimensions,
        [axis]: clamped,
      };
      onApplyCalibratedDims(nextDims);
      setStatusMsg(
        `Medidas del mueble de la fotografía (V₀) actualizadas manualmente: Ancho X₀ = ${nextDims.x} mm × Alto Y₀ = ${nextDims.y} mm × Profundidad Z₀ = ${nextDims.z} mm.`,
      );
      return;
    }

    // Extrapolar automáticamente la dimensión complementaria usando la proporción homográfica W/H de la foto
    const activeAxis: 'x' | 'y' = axis;
    if (knownAxis !== activeAxis) {
      setKnownAxis(activeAxis);
      knownAxisRef.current = activeAxis;
    }
    const ext = defaultVisionAgent.extrapolateDimensions(
      estimatedAspectXY,
      activeAxis,
      clamped,
      params.referenceDimensions.z,
    );
    onApplyCalibratedDims(ext);
    setStatusMsg(
      `Medidas del mueble de la fotografía (V₀) corregidas según usuario (${activeAxis === 'x' ? 'Ancho X₀' : 'Alto Y₀'} = ${clamped} mm, proporción foto W/H = ${estimatedAspectXY.toFixed(3)}): V₀ = ${ext.x} × ${ext.y} × ${ext.z} mm.`,
    );
  };

  const handleRunPhotoVectorComparison = () => {
    const srcCache = srcRgbaCacheRef.current;
    if (!srcCache || srcCache.w === 0 || !homography) {
      setStatusMsg('Carga primero una fotografía frontal para comparar Foto Rectificada ↔ Vector V₀.');
      return;
    }
    const rectW = 360;
    const rectH = Math.max(160, Math.min(480, Math.round(rectW / Math.max(0.25, estimatedAspectXY))));
    const rectRgba = rectifyImageRGBA(
      srcCache.rgba,
      srcCache.w,
      srcCache.h,
      homography.toCanvas,
      rectW,
      rectH,
    );

    const currentDet = {
      vDividers: topology.vDividers,
      hShelves: topology.hShelves,
      confidence: topology.detectionConfidence ?? 0.82,
      refLum: 150,
      interiorMatch: 1,
      furnitureMode: 'mixed' as const,
      detectedHandles: [],
      detectedZones: topology.frontZones ?? [],
    };

    const refined = defaultVisionAgent.compareAndRefineWithPhoto(
      { rgba: rectRgba, width: rectW, height: rectH },
      currentDet,
      { x: params.referenceDimensions.x, y: params.referenceDimensions.y },
      params.boardThickness,
    );

    setLastComparisonAudit(refined.comparisonAudit);
    onUpdateTopology({
      ...topology,
      vDividers: refined.refinedDetection.vDividers,
      hShelves: refined.structuralShelves,
      frontZones: refined.autoZones,
    });
    setStatusMsg(refined.comparisonAudit.summary);
  };

  const handleSetColumnDividersCount = (targetDivCount: number) => {
    const nDiv = Math.max(0, Math.min(6, targetDivCount));
    const nextDivs: NormalizedSegment[] = [];
    for (let i = 1; i <= nDiv; i++) {
      nextDivs.push({
        id: `eq_vdiv_${i}`,
        position: Number((i / (nDiv + 1)).toFixed(4)),
        start: 0,
        end: 1,
      });
    }
    const currentZones = topology.frontZones ?? [];
    const hasClosed = currentZones.some((z) => z.kind !== 'open');
    const rebuiltZones = inferFrontZonesFromDetection(
      nextDivs,
      topology.hShelves,
      hasClosed ? 'closed_front' : 'open',
      [],
    );
    onUpdateTopology({
      ...topology,
      shelfMode: 'custom',
      equalShelfCount: 0,
      vDividers: nextDivs,
      frontZones: rebuiltZones,
    });
    setStatusMsg(
      `Divisiones verticales del mueble original (V₀) equiparadas a ${nDiv} divisor(es) (${nDiv + 1} columnas simétricas).`,
    );
  };

  const handleSetHorizontalShelvesCount = (targetShelfCount: number) => {
    const nSh = Math.max(0, Math.min(8, targetShelfCount));
    const nextShelves: NormalizedSegment[] = [];
    for (let j = 1; j <= nSh; j++) {
      nextShelves.push({
        id: `eq_hshelf_${j}`,
        position: Number((j / (nSh + 1)).toFixed(4)),
        start: 0,
        end: 1,
      });
    }
    onUpdateTopology({
      ...topology,
      shelfMode: 'custom',
      equalShelfCount: 0,
      hShelves: nextShelves,
    });
    setStatusMsg(
      `Divisiones horizontales del mueble original (V₀) equiparadas a ${nSh} repisa(s)/nivel(es) (${nSh + 1} niveles).`,
    );
  };

  const handleChangeStage1ZoneKind = (id: string, kind: FrontModuleKind) => {
    const zones = topology.frontZones ?? [];
    const updated: FrontZone[] = zones.map((z) =>
      z.id === id
        ? {
            ...z,
            kind,
            drawerCount: kind === 'drawers' ? (z.drawerCount ?? 3) : undefined,
          }
        : z,
    );
    onUpdateTopology({
      ...topology,
      frontZones: updated,
    });
  };

  const handleChangeStage1DrawerCount = (id: string, count: number) => {
    const zones = topology.frontZones ?? [];
    const updated: FrontZone[] = zones.map((z) =>
      z.id === id ? { ...z, drawerCount: Math.max(1, Math.min(6, count)) } : z,
    );
    onUpdateTopology({
      ...topology,
      frontZones: updated,
    });
  };

  const handleApplyCalibA4 = () => {
    if (calibPts.length !== 2) return;
    const [p1, p2] = calibPts;
    let yCal: number;
    let xCal: number;

    if (homography) {
      const u1 = applyHomography(homography.toUnit, p1);
      const u2 = applyHomography(homography.toUnit, p2);
      if (u1 && u2) {
        const dRect = Math.hypot((u2.x - u1.x) * estimatedAspectXY, u2.y - u1.y);
        if (dRect > 1e-4) {
          yCal = calibRefMm / dRect;
          xCal = yCal * estimatedAspectXY;
          const dims = { x: Math.round(xCal), y: Math.round(yCal), z: params.targetDimensions.z };
          onApplyCalibratedDims(dims);
          setStatusMsg(`Calibración A4 aplicada (perspectiva corregida): ${dims.x} × ${dims.y} × ${dims.z} mm.`);
          return;
        }
      }
    }
    // Fallback euclidiano
    const pxDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const bodyH = Math.hypot(quad[3].x - quad[0].x, quad[3].y - quad[0].y);
    if (pxDist > 1) {
      yCal = (bodyH / pxDist) * calibRefMm;
      xCal = yCal * estimatedAspectXY;
      const dims = { x: Math.round(xCal), y: Math.round(yCal), z: params.targetDimensions.z };
      onApplyCalibratedDims(dims);
      setStatusMsg(`Calibración aplicada: ${dims.x} × ${dims.y} × ${dims.z} mm.`);
    }
  };

  const conf = topology.detectionConfidence;
  const confClass =
    conf === undefined ? '' : conf >= 0.7 ? 'conf-high' : conf >= 0.5 ? 'conf-mid' : 'conf-low';

  return (
    <div className="vector-card">
      <div className="card-header-row">
        <h3>Paso 1 y 2 — Foto → Homografía 3×3 → Visión Offline</h3>
        <div className="chip-row">
          <button
            type="button"
            className={viewTab === 'frontal' ? 'chip-btn active' : 'chip-btn'}
            onClick={() => setViewTab('frontal')}
          >
            Vista Frontal (XY)
          </button>
          <button
            type="button"
            className={viewTab === 'lateral' ? 'chip-btn active' : 'chip-btn'}
            onClick={() => setViewTab('lateral')}
          >
            Vista Lateral ZY (Opcional)
          </button>
          <button
            type="button"
            className="chip-btn"
            onClick={() => setShowProtocol((s) => !s)}
          >
            {showProtocol ? 'Ocultar protocolo' : 'Ver protocolo foto'}
          </button>
        </div>
      </div>

      {showProtocol && (
        <div className="protocol-box">
          <strong>Protocolo de Foto para Alta Precisión (100 % Local):</strong>
          <ul>
            <li>Mueble abierto (sin puertas), cámara al centro y media altura, distancia ≥ 3 m, zoom <strong>1× o 2×</strong> (nunca 0.5×), sin recortar (WhatsApp como <em>Documento</em>).</li>
            <li><strong>Patas externas:</strong> enmarca con los 4 nodos <strong>SOLO el cuerpo de melamina</strong>; excluye patas adicionales para que se listen como herraje aparte.</li>
          </ul>
        </div>
      )}

      {/* Carga de archivo + controles rápidos */}
      <div className="canvas-toolbar">
        {viewTab === 'frontal' ? (
          <>
            <label className="btn-primary">
              <Camera size={15} /> Cargar Foto Frontal
              <input type="file" accept="image/*" onChange={handleFileFrontal} hidden />
            </label>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => loadFrontalFromUrl(generateSampleFurnitureDataUrl(), true)}
            >
              <Sparkles size={15} /> Cargar croquis de ejemplo local
            </button>
          </>
        ) : (
          <label className="btn-primary">
            <Camera size={15} /> Cargar Foto Lateral (ZY)
            <input type="file" accept="image/*" onChange={handleFileSide} hidden />
          </label>
        )}

        <label className="toggle-label">
          <input
            type="checkbox"
            checked={topology.hasBackPanel}
            onChange={(e) => onToggleBackPanel(e.target.checked)}
          />
          Fondo Durolac 3 mm
        </label>

        <label className="toggle-label">
          <input
            type="checkbox"
            checked={Boolean(topology.hasExternalLegs)}
            onChange={(e) => onToggleExternalLegs(e.target.checked)}
          />
          Tiene patas separadas (no melamina)
        </label>

        <div className="chip-row">
          <span className="small-note muted">Profundidad rápida:</span>
          {[320, 400, 500, 550].map((d) => (
            <button
              key={d}
              type="button"
              className={params.targetDimensions.z === d ? 'chip-btn active' : 'chip-btn'}
              onClick={() => onSelectDepthMm(d)}
            >
              {d} mm
            </button>
          ))}
        </div>
      </div>

      {needsManualCorners && imgEl && (
        <div className="alert-box warning">
          <strong>Foto con ambiente real detectado (pared/piso):</strong> arrastra los 4 puntos azules <strong>TL, TR, BR, BL</strong> sobre las 4 esquinas exactas del cuerpo de melamina (excluyendo pared y patas). Al soltar cada esquina, el <strong>Plano Vectorial 2D</strong> se actualizará automáticamente.
        </div>
      )}

      {legHintDetected && !topology.hasExternalLegs && (
        <div className="alert-box warning">
          <strong>Posibles patas independientes detectadas debajo del mueble:</strong> enfoca el cuadro solo en el cuerpo de melamina y{' '}
          <button
            type="button"
            className="btn-small"
            onClick={() => onToggleExternalLegs(true, 150, 4)}
          >
            Activar patas externas (4 × 150 mm)
          </button>
        </div>
      )}

      {topology.hasExternalLegs && (
        <div className="ok-box">
          Cuerpo de melamina aislado de las patas ({topology.externalLegCount ?? 4} patas de {topology.externalLegHeightMm ?? 150} mm registradas en Herrajes para compra aparte).
        </div>
      )}

      {/* Barra de herramientas de vectorización y visión */}
      {viewTab === 'frontal' && (
        <div className="canvas-toolbar">
          <button
            type="button"
            className="btn-secondary"
            onClick={handleAutoFrameQuad}
            disabled={!imgEl}
            title="Detecta automáticamente el contorno del mueble en fotos de catálogo o fondo uniforme"
          >
            <Maximize2 size={15} /> Auto-encuadrar mueble
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => runAutoDetection()}
            disabled={!imgEl || !homography}
          >
            <ScanSearch size={15} /> Detectar estructura automáticamente
          </button>

          <button
            type="button"
            className={tool === 'corners' ? 'chip-btn active' : 'chip-btn'}
            onClick={() => setTool('corners')}
          >
            <Crosshair size={13} /> 4 Esquinas
          </button>
          <button
            type="button"
            className={tool === 'eyedropper' ? 'chip-btn active' : 'chip-btn'}
            onClick={() => setTool('eyedropper')}
          >
            <Pipette size={13} /> Gotero 1 clic
          </button>
          <button
            type="button"
            className={tool === 'vDivider' ? 'chip-btn active' : 'chip-btn'}
            onClick={() => setTool('vDivider')}
          >
            + Divisor Vertical
          </button>
          <button
            type="button"
            className={tool === 'hShelf' ? 'chip-btn active' : 'chip-btn'}
            onClick={() => setTool('hShelf')}
          >
            + Repisa Horizontal
          </button>
          <button
            type="button"
            className={tool === 'hardware' ? 'chip-btn active' : 'chip-btn'}
            onClick={() => setTool('hardware')}
          >
            <Wrench size={13} /> Marcar Tirador
          </button>
          <button
            type="button"
            className={tool === 'calibA4' ? 'chip-btn active' : 'chip-btn'}
            onClick={() => {
              setCalibPts([]);
              setTool('calibA4');
            }}
          >
            <Ruler size={13} /> Calibrar A4
          </button>
          <button
            type="button"
            className={tool === 'erase' ? 'chip-btn active' : 'chip-btn'}
            onClick={() => setTool('erase')}
          >
            <Eraser size={13} /> Borrar
          </button>

          <select
            className="select-input"
            style={{ width: 135 }}
            value={focal35mm}
            onChange={(e) => setFocal35mm(Number(e.target.value) as 26 | 52)}
          >
            <option value={26}>Lente 1× (26 mm)</option>
            <option value={52}>Lente 2× (52 mm)</option>
          </select>
        </div>
      )}

      {/* Calibración de las dimensiones reales del Mueble Original de la Fotografía (V₀) */}
      {viewTab === 'frontal' && (
        <div className="calib-box" style={{ flexWrap: 'wrap', gap: 10 }}>
          <strong>Medidas del Mueble de la Fotografía (V₀):</strong>
          <select
            value={knownAxis}
            onChange={(e) => {
              const mode = e.target.value as 'x' | 'y' | 'both';
              setKnownAxis(mode);
              knownAxisRef.current = mode;
              if (mode === 'x' || mode === 'y') {
                const ext = defaultVisionAgent.extrapolateDimensions(
                  estimatedAspectXY,
                  mode,
                  mode === 'x' ? params.referenceDimensions.x : params.referenceDimensions.y,
                  params.referenceDimensions.z,
                );
                onApplyCalibratedDims(ext);
              }
            }}
          >
            <option value="x">Conozco Ancho X₀ → Calcular Alto Y₀ por foto (W/H)</option>
            <option value="y">Conozco Alto Y₀ → Calcular Ancho X₀ por foto (W/H)</option>
            <option value="both">Ingresar Ancho X₀ y Alto Y₀ manualmente</option>
          </select>

          <label className="small-note">
            <strong>Ancho Original X₀ (mm):</strong>
            <input
              type="number"
              min={300}
              max={2600}
              step={10}
              value={params.referenceDimensions.x}
              onChange={(e) => handleUpdateOriginalDimension('x', Number(e.target.value) || 300)}
              style={{ width: 82, marginLeft: 4 }}
            />
          </label>

          <label className="small-note">
            <strong>Alto Original Y₀ (mm):</strong>
            <input
              type="number"
              min={300}
              max={2600}
              step={10}
              value={params.referenceDimensions.y}
              onChange={(e) => handleUpdateOriginalDimension('y', Number(e.target.value) || 300)}
              style={{ width: 82, marginLeft: 4 }}
            />
          </label>

          <label className="small-note">
            <strong>Profundidad Z₀ (mm):</strong>
            <input
              type="number"
              min={200}
              max={800}
              step={10}
              value={params.referenceDimensions.z}
              onChange={(e) => handleUpdateOriginalDimension('z', Number(e.target.value) || 200)}
              style={{ width: 74, marginLeft: 4 }}
            />
          </label>

          <button
            type="button"
            className="btn-primary"
            onClick={handleRunPhotoVectorComparison}
            disabled={!imgEl || !homography}
            title="Compara la foto rectificada con el plano vectorial V₀ y ajusta bordes y medidas"
          >
            Comparar Foto ↔ Vector y Auto-Corregir
          </button>

          {tool === 'calibA4' && (
            <>
              <span>| Ref. segmento (mm):</span>
              <input
                type="number"
                value={calibRefMm}
                onChange={(e) => setCalibRefMm(Number(e.target.value) || 297)}
                style={{ width: 68 }}
              />
              <button type="button" className="chip-btn" onClick={() => setCalibRefMm(297)}>
                Hoja A4 (297 mm)
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={calibPts.length !== 2}
                onClick={handleApplyCalibA4}
              >
                Aplicar calibración A4 ({calibPts.length}/2 pts)
              </button>
            </>
          )}
        </div>
      )}

      {!homography && viewTab === 'frontal' && (
        <div className="alert-box critical">
          Cuadrilátero degenerado o cruzado. Separa las 4 esquinas en orden horario (TL, TR, BR, BL).
        </div>
      )}

      <p className="muted small-note">{statusMsg}</p>

      <div className="canvas-layout">
        <canvas
          ref={canvasRef}
          className="photo-canvas"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />

        <div className="rect-preview-panel">
          <strong>Vista Rectificada (H) + Divisiones V₀</strong>
          <canvas ref={rectPreviewRef} className="rect-preview-canvas" />
          <label className="toggle-label small-note">
            <input
              type="checkbox"
              checked={showOverlayOnRectified}
              onChange={(e) => setShowOverlayOnRectified(e.target.checked)}
            />
            Superponer divisiones y cotas (mm)
          </label>
          <div className="mono small-note">
            Proporción Foto W/H: <strong>{estimatedAspectXY.toFixed(3)}</strong> · V₀: <strong>{params.referenceDimensions.x}×{params.referenceDimensions.y}×{params.referenceDimensions.z} mm</strong>
          </div>
          {conf !== undefined && topology.detectionSource === 'auto' && (
            <div className={`conf-badge ${confClass}`}>
              {detectedModeLabel ? `${detectedModeLabel} · ` : ''}
              Equiparación: {lastComparisonAudit ? `${lastComparisonAudit.matchScorePct}%` : `${Math.round(conf * 100)}%`}
            </div>
          )}
          <div className="small-note muted">
            Divisores V: {topology.vDividers.length} · Niveles H: {topology.hShelves.length} · Módulos: {(topology.frontZones ?? []).length}
          </div>
          <div className="mono small-note muted">
            Vanos X: [{liveDivisionAudit.bayWidthsMm.map((w) => `${w}mm`).join(' | ')}]
          </div>
          <div className="mono small-note muted">
            Niveles Y: [{liveDivisionAudit.bandHeightsMm.map((h) => `${h}mm`).join(' | ')}]
          </div>
        </div>
      </div>

      {/* PANEL DE COMPARACIÓN LADO A LADO ETAPA 1: FOTO RECTIFICADA vs PLANO VECTORIAL ORIGINAL V₀ */}
      <div className="metric-card" style={{ marginTop: 14 }}>
        <div className="card-header-row">
          <div>
            <h4>
              Etapa 1 — Comparación y Equiparación: Fotografía Original Rectificada vs. Mueble Vectorial Original (V₀)
            </h4>
            <p className="muted small-note">
              Compara ambas versiones del mismo mueble fotografiado. Todas las medidas atribuidas al plano vectorial (V₀ ={' '}
              <strong>
                {params.referenceDimensions.x} × {params.referenceDimensions.y} × {params.referenceDimensions.z} mm
              </strong>
              ) y a cada división interna están corregidas según tus medidas de entrada. Aún no se solicitan medidas del mueble customizado.
            </p>
          </div>
          <div className="chip-row">
            <button
              type="button"
              className="btn-secondary"
              onClick={handleRunPhotoVectorComparison}
              disabled={!imgEl || !homography}
            >
              Comparar y Auto-Corregir Foto ↔ Vector
            </button>
            {onGoToBlueprint && (
              <button
                type="button"
                className="btn-approve"
                onClick={onGoToBlueprint}
              >
                Confirmar V₀ → Pasar a Etapa 2
              </button>
            )}
          </div>
        </div>

        {/* Vista Lado a Lado: 1. Foto Rectificada con Divisiones vs 2. Plano Vectorial Original V0 Acotado */}
        <div className="blueprint-grid" style={{ marginTop: 8 }}>
          <div className="blueprint-pane">
            <div className="blueprint-pane-title">
              1. Fotografía Original Rectificada + Divisiones y Cotas (X₀={params.referenceDimensions.x} mm × Y₀={params.referenceDimensions.y} mm)
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: 260,
                background: '#0f172a',
                borderRadius: 6,
                padding: 10,
              }}
            >
              {imgEl ? (
                <canvas
                  ref={rectCompareRef}
                  style={{ maxWidth: '100%', height: 'auto', border: '1px solid #38bdf8', borderRadius: 4 }}
                />
              ) : (
                <span className="muted small-note" style={{ color: '#94a3b8' }}>
                  Carga una fotografía frontal o el croquis local para comparar la foto rectificada con el vector V₀.
                </span>
              )}
            </div>
          </div>

          <div className="blueprint-pane">
            <div className="blueprint-pane-title resized">
              2. Mueble Vectorial Original (V₀: {params.referenceDimensions.x}×{params.referenceDimensions.y}×{params.referenceDimensions.z} mm — Cotas por División Corregidas)
            </div>
            <div
              className="svg-preview"
              dangerouslySetInnerHTML={{ __html: liveBlueprintSvg }}
            />
          </div>
        </div>

        {/* Controles rápidos para corregir y equiparar divisiones y módulos entre la Foto y el Vector V₀ */}
        <div className="calib-box" style={{ marginTop: 10, flexWrap: 'wrap', gap: 10 }}>
          <strong>Equiparar Divisiones (Foto ↔ Vector V₀):</strong>
          <div className="chip-row">
            <span className="small-note">Divisores Verticales ({topology.vDividers.length}):</span>
            {[0, 1, 2, 3, 4].map((n) => (
              <button
                key={`vcol_${n}`}
                type="button"
                className={topology.vDividers.length === n ? 'chip-btn active' : 'chip-btn'}
                onClick={() => handleSetColumnDividersCount(n)}
                title={`Fijar ${n} divisor(es) vertical(es) (${n + 1} columnas simétricas)`}
              >
                {n} div ({n + 1} col)
              </button>
            ))}
          </div>

          <div className="chip-row">
            <span className="small-note">Niveles Horizontales ({topology.hShelves.length}):</span>
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <button
                key={`hrow_${n}`}
                type="button"
                className={topology.hShelves.length === n ? 'chip-btn active' : 'chip-btn'}
                onClick={() => handleSetHorizontalShelvesCount(n)}
                title={`Fijar ${n} repisa(s)/nivel(es) horizontal(es)`}
              >
                {n} rep
              </button>
            ))}
          </div>
        </div>

        {/* Tabla / Chips de Auditoría Dimensional por cada Módulo del Mueble Original V₀ */}
        {liveDivisionAudit.zoneMeasures.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div className="mono small-note" style={{ marginBottom: 6 }}>
              <strong>Verificación de Cierre Dimensional V₀:</strong>{' '}
              Ancho X₀ = {liveDivisionAudit.bayWidthsMm.join(' + ')} + ({liveDivisionAudit.bayWidthsMm.length + 1}×{params.boardThickness}mm tablero) ={' '}
              <strong>{params.referenceDimensions.x} mm</strong> (Error: {liveDivisionAudit.widthClosureErrorMm} mm) ·{' '}
              Alto Y₀ = {liveDivisionAudit.bandHeightsMm.join(' + ')} + ({liveDivisionAudit.bandHeightsMm.length + 1}×{params.boardThickness}mm tablero) ={' '}
              <strong>{params.referenceDimensions.y} mm</strong> (Error: {liveDivisionAudit.heightClosureErrorMm} mm)
            </div>
            <div className="zone-editor-grid">
              {(topology.frontZones ?? []).map((z, idx) => {
                const zm = liveDivisionAudit.zoneMeasures[idx];
                return (
                  <div key={z.id} className="zone-chip">
                    <strong>
                      {z.label ?? `Módulo ${idx + 1}`}{' '}
                      <span className="mono" style={{ color: '#0284c7' }}>
                        ({zm ? `${zm.widthMm}×${zm.heightMm} mm` : ''})
                      </span>
                    </strong>
                    <select
                      value={z.kind}
                      onChange={(e) => handleChangeStage1ZoneKind(z.id, e.target.value as FrontModuleKind)}
                    >
                      <option value="open">Abierto (Vano)</option>
                      <option value="door_left">Puerta (Abre Izq)</option>
                      <option value="door_right">Puerta (Abre Der)</option>
                      <option value="door_double">Puerta Doble</option>
                      <option value="door_glass">Puerta con Vidrio</option>
                      <option value="drawers">Cajonera (5 pzas/cajón)</option>
                      <option value="leg_void">Hueco Piernas</option>
                    </select>
                    {z.kind === 'drawers' && (
                      <input
                        type="number"
                        min={1}
                        max={6}
                        value={z.drawerCount ?? 3}
                        onChange={(e) => handleChangeStage1DrawerCount(z.id, Number(e.target.value) || 1)}
                        style={{ width: 52 }}
                        title="Cantidad de cajones en este módulo"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
