/**
 * SMARTFURNITURE — PANEL DE PLANO VECTORIAL 2D Y APROBACIÓN DE REDIMENSIONAMIENTO (v3.2)
 * Muestra el esquema vectorial técnico 2D del mueble original (V0) frente al nuevo modelo
 * vectorial redimensionado (Vf), permite ajustar módulos frontales (puertas/cajones/abierto)
 * y exige aprobación explícita del usuario antes de pasar al despiece y corte en planchas 244×122.
 */
import { useMemo } from 'react';
import { CheckCircle2, Download, SlidersHorizontal } from 'lucide-react';
import type {
  CuttingPlanResult,
  DespieceResult,
  FrontModuleKind,
  FrontZone,
  FurnitureTopology,
  ScaleAndBoardParams,
} from '../../types/contracts';
import { calculateDespiece } from '../../core/mathEngine';
import { renderFurnitureVectorBlueprintSvg } from '../../core/vectorBlueprint';

interface VectorBlueprintPanelProps {
  topology: FurnitureTopology;
  params: ScaleAndBoardParams;
  despiece: DespieceResult;
  cuttingPlan: CuttingPlanResult;
  modelApproved: boolean;
  onUpdateDim: (axis: 'x' | 'y' | 'z', value: number) => void;
  onUpdateFrontZones: (zones: FrontZone[]) => void;
  onApproveModel: () => void;
}

function downloadSvg(filename: string, svg: string): void {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function VectorBlueprintPanel({
  topology,
  params,
  despiece,
  cuttingPlan,
  modelApproved,
  onUpdateDim,
  onUpdateFrontZones,
  onApproveModel,
}: VectorBlueprintPanelProps) {
  // Despiece del modelo ORIGINAL V0 para mostrar comparación lado a lado
  const originalParams = useMemo<ScaleAndBoardParams>(
    () => ({
      ...params,
      targetDimensions: { ...params.referenceDimensions },
    }),
    [params],
  );

  const despieceOriginal = useMemo(
    () => calculateDespiece(topology, originalParams),
    [topology, originalParams],
  );

  const svgOriginal = useMemo(
    () =>
      renderFurnitureVectorBlueprintSvg(topology, originalParams, despieceOriginal, {
        stageLabel: 'MODELO VECTORIAL ORIGINAL (INTERPRETADO V₀)',
      }),
    [topology, originalParams, despieceOriginal],
  );

  const svgResized = useMemo(
    () =>
      renderFurnitureVectorBlueprintSvg(topology, params, despiece, {
        stageLabel: 'NUEVO MODELO VECTORIAL REDIMENSIONADO (V_f)',
        cuttingPlan,
      }),
    [topology, params, despiece, cuttingPlan],
  );

  const dimsChanged =
    params.targetDimensions.x !== params.referenceDimensions.x ||
    params.targetDimensions.y !== params.referenceDimensions.y ||
    params.targetDimensions.z !== params.referenceDimensions.z;

  const zones = topology.frontZones ?? [];

  const handleChangeZoneKind = (id: string, kind: FrontModuleKind) => {
    const updated = zones.map((z) =>
      z.id === id
        ? {
            ...z,
            kind,
            drawerCount: kind === 'drawers' ? (z.drawerCount ?? 3) : undefined,
          }
        : z,
    );
    onUpdateFrontZones(updated);
  };

  const handleChangeDrawerCount = (id: string, count: number) => {
    const updated = zones.map((z) =>
      z.id === id ? { ...z, drawerCount: Math.max(1, Math.min(6, count)) } : z,
    );
    onUpdateFrontZones(updated);
  };

  return (
    <div className="vector-card">
      <div className="card-header-row">
        <div>
          <h3>Paso 2 — Esquema Vectorial 2D, Redimensionamiento y Aprobación</h3>
          <p className="muted small-note">
            Verifica la interpretación vectorial del mueble original (V₀), ajusta las nuevas dimensiones (V_f) y aprueba para generar el despiece completo y planchas 244×122 cm.
          </p>
        </div>
        <div className="export-bar">
          <button
            type="button"
            className="btn-secondary"
            onClick={() =>
              downloadSvg(
                `plano_vectorial_${params.targetDimensions.x}x${params.targetDimensions.y}.svg`,
                svgResized,
              )
            }
          >
            <Download size={15} /> Descargar Plano Vectorial SVG
          </button>
          <button
            type="button"
            className="btn-approve"
            onClick={onApproveModel}
          >
            <CheckCircle2 size={16} />{' '}
            {modelApproved
              ? 'Modelo Aprobado — Ver Despiece y Planchas 244×122'
              : 'Aceptar Modelo Vectorial → Generar Despiece y Corte 244×122'}
          </button>
        </div>
      </div>

      {/* Barra rápida de redimensionamiento solicitada por el cliente */}
      <div className="calib-box">
        <SlidersHorizontal size={15} />
        <strong>Redimensionar modelo vectorial (mm):</strong>
        <label className="small-note">
          Ancho X:
          <input
            type="number"
            min={300}
            max={2400}
            step={10}
            value={params.targetDimensions.x}
            onChange={(e) => onUpdateDim('x', Number(e.target.value) || 300)}
            style={{ width: 76, marginLeft: 4 }}
          />
        </label>
        <label className="small-note">
          Alto Y (cuerpo):
          <input
            type="number"
            min={300}
            max={2400}
            step={10}
            value={params.targetDimensions.y}
            onChange={(e) => onUpdateDim('y', Number(e.target.value) || 300)}
            style={{ width: 76, marginLeft: 4 }}
          />
        </label>
        <label className="small-note">
          Profundidad Z:
          <input
            type="number"
            min={200}
            max={800}
            step={10}
            value={params.targetDimensions.z}
            onChange={(e) => onUpdateDim('z', Number(e.target.value) || 200)}
            style={{ width: 72, marginLeft: 4 }}
          />
        </label>
        <span className="mono small-note">
          {dimsChanged ? 'Redimensionado activo (nuevo plano vectorial calculado)' : 'Dimensiones originales V₀'}
        </span>
      </div>

      {/* Planos Vectoriales SVG: Original V0 vs Nuevo Redimensionado Vf */}
      <div className="blueprint-grid">
        <div className="blueprint-pane">
          <div className="blueprint-pane-title">
            1. Plano Vectorial Original Interpretado (V₀: {params.referenceDimensions.x}×{params.referenceDimensions.y}×{params.referenceDimensions.z} mm)
          </div>
          <div
            className="svg-preview"
            dangerouslySetInnerHTML={{ __html: svgOriginal }}
          />
        </div>

        <div className="blueprint-pane">
          <div className="blueprint-pane-title resized">
            2. Nuevo Plano Vectorial Redimensionado (V_f: {params.targetDimensions.x}×{params.targetDimensions.y}×{params.targetDimensions.z} mm)
          </div>
          <div
            className="svg-preview"
            dangerouslySetInnerHTML={{ __html: svgResized }}
          />
        </div>
      </div>

      {/* Editor rápido de zonas frontales (Puertas / Cajones / Abierto / Vidrio) */}
      {zones.length > 0 && (
        <div className="metric-card">
          <h4>Ajuste fino de Módulos Frontales ({zones.length} zonas interpretadas)</h4>
          <div className="zone-editor-grid">
            {zones.map((z) => (
              <div key={z.id} className="zone-chip">
                <strong>{z.label ?? z.id}</strong>
                <select
                  value={z.kind}
                  onChange={(e) => handleChangeZoneKind(z.id, e.target.value as FrontModuleKind)}
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
                    onChange={(e) => handleChangeDrawerCount(z.id, Number(e.target.value) || 1)}
                    style={{ width: 52 }}
                    title="Cantidad de cajones"
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
