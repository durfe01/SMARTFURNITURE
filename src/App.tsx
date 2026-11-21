/**
 * SMARTFURNITURE v3.2 — APLICACIÓN PRINCIPAL 100% LOCAL Y OFFLINE
 * Flujo completo:
 *   1. Foto & Visión (Detectar) ->
 *   2. Plano Vectorial 2D Original vs. Redimensionado (Aprobación del Usuario) ->
 *   3. Despiece Completo (incl. Puertas y Cajones 5-piezas), Visor 3D y Planchas 244×122 cm.
 */
import { useMemo, useState } from 'react';
import type {
  FrontZone,
  FurnitureTopology,
  HardwareItem,
  MelamineMaterial,
  ScaleAndBoardParams,
} from './types/contracts';
import {
  CHILE_DUROLAC_SHEET,
  CHILE_MELAMINE_SHEET,
  PRESETS,
  calculateDespiece,
  clonePreset,
  type PresetKey,
} from './core/mathEngine';
import { generateCuttingPlan } from './core/cuttingStock';
import { CATALOG_14_MUEBLES, cloneCatalogFurniture } from './core/vectorBlueprint/catalog14';
import { Viewer3D } from './components/viewer3d/Viewer3D';
import { MathPanel } from './components/mathPanel/MathPanel';
import { VectorCanvas } from './components/vectorCanvas/VectorCanvas';
import { VectorBlueprintPanel } from './components/vectorBlueprint/VectorBlueprintPanel';

type ActiveStep = 'foto' | 'vectorial' | 'split' | '3d';
type SheetStandard = 'pauta' | 'chile';

export default function App() {
  const initial = useMemo(() => clonePreset('estanteria'), []);
  const [activePreset, setActivePreset] = useState<PresetKey | null>('estanteria');
  const [activeCatalogId, setActiveCatalogId] = useState<string>('');
  const [topology, setTopology] = useState<FurnitureTopology>(initial.topology);
  const [params, setParams] = useState<ScaleAndBoardParams>(initial.params);
  const [explodeFactor, setExplodeFactor] = useState<number>(0);
  const [sheetStandard, setSheetStandard] = useState<SheetStandard>('pauta');
  const [activeStep, setActiveStep] = useState<ActiveStep>('foto');
  const [modelApproved, setModelApproved] = useState<boolean>(true);

  const despiece = useMemo(
    () => calculateDespiece(topology, params),
    [topology, params],
  );

  const cuttingPlan = useMemo(
    () => generateCuttingPlan(despiece.matrizDespiece, params),
    [despiece.matrizDespiece, params],
  );

  const handleLoadPreset = (key: PresetKey) => {
    const cloned = clonePreset(key);
    if (sheetStandard === 'chile') {
      cloned.params.sheetDimensions = { ...CHILE_MELAMINE_SHEET };
      cloned.params.backPanelSheetDimensions = { ...CHILE_DUROLAC_SHEET };
    }
    setActivePreset(key);
    setActiveCatalogId('');
    setTopology(cloned.topology);
    setParams(cloned.params);
    setExplodeFactor(0);
    setModelApproved(true);
  };

  const handleLoadCatalog = (catalogId: string) => {
    if (!catalogId) return;
    const cloned = cloneCatalogFurniture(catalogId);
    if (!cloned) return;
    if (sheetStandard === 'chile') {
      cloned.params.sheetDimensions = { ...CHILE_MELAMINE_SHEET };
      cloned.params.backPanelSheetDimensions = { ...CHILE_DUROLAC_SHEET };
    }
    setActivePreset(null);
    setActiveCatalogId(catalogId);
    setTopology(cloned.topology);
    setParams(cloned.params);
    setExplodeFactor(0);
    setModelApproved(false);
    setActiveStep('vectorial');
  };

  const handleSheetStandardChange = (std: SheetStandard) => {
    setSheetStandard(std);
    setParams((prev) => ({
      ...prev,
      sheetDimensions: std === 'chile' ? { ...CHILE_MELAMINE_SHEET } : { width: 2440, height: 1220 },
      backPanelSheetDimensions: std === 'chile' ? { ...CHILE_DUROLAC_SHEET } : undefined,
    }));
  };

  const updateTargetDim = (axis: 'x' | 'y' | 'z', value: number) => {
    const clamped =
      axis === 'z'
        ? Math.max(200, Math.min(800, value))
        : Math.max(300, Math.min(2400, value));
    setModelApproved(false);
    setParams((prev) => ({
      ...prev,
      targetDimensions: { ...prev.targetDimensions, [axis]: clamped },
    }));
  };

  const handleToggleCenterDivider = () => {
    setModelApproved(false);
    setTopology((prev) => {
      const hasCenter = prev.vDividers.some((d) => Math.abs(d.position - 0.5) < 0.03);
      if (hasCenter) {
        return {
          ...prev,
          vDividers: prev.vDividers.filter((d) => Math.abs(d.position - 0.5) >= 0.03),
        };
      }
      return {
        ...prev,
        vDividers: [
          ...prev.vDividers,
          { id: 'div_central_rapido', position: 0.5, start: 0, end: 1 },
        ],
      };
    });
  };

  const handleToggleExternalLegs = (checked: boolean, heightMm?: number, count?: number) => {
    setTopology((prev) => ({
      ...prev,
      hasExternalLegs: checked,
      externalLegHeightMm: heightMm ?? prev.externalLegHeightMm ?? 150,
      externalLegCount: count ?? prev.externalLegCount ?? 4,
    }));
  };

  const handleAddHardwareItem = (item: HardwareItem) => {
    setTopology((prev) => ({
      ...prev,
      hardwareItems: [...(prev.hardwareItems ?? []), item],
    }));
  };

  const handleRemoveHardwareItem = (id: string) => {
    setTopology((prev) => ({
      ...prev,
      hardwareItems: (prev.hardwareItems ?? []).filter((h) => h.id !== id),
    }));
  };

  const handleUpdateFrontZones = (zones: FrontZone[]) => {
    setModelApproved(false);
    setTopology((prev) => ({ ...prev, frontZones: zones }));
  };

  const hasCenterDivider = topology.vDividers.some((d) => Math.abs(d.position - 0.5) < 0.03);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <div className="brand-title">SmartFurniture v3.4 — Agente POO Visión → Plano Vectorial → 3D &amp; Corte 244×122</div>
          <div className="brand-sub">
            100% Local Offline · INACAP Unidad 3 · Puertas, Cajones (5 pzas), Herrajes y Planchas 244×122 cm
          </div>
        </div>
        <div className="preset-bar">
          {(Object.keys(PRESETS) as PresetKey[]).map((k) => (
            <button
              key={k}
              type="button"
              className={activePreset === k ? 'preset-btn active' : 'preset-btn'}
              onClick={() => handleLoadPreset(k)}
            >
              {PRESETS[k].label}
            </button>
          ))}
          <select
            className="catalog-select"
            value={activeCatalogId}
            onChange={(e) => handleLoadCatalog(e.target.value)}
            title="Cargar uno de los 14 muebles reales del catálogo QA"
          >
            <option value="">Catálogo QA (14 Muebles Reales)...</option>
            {CATALOG_14_MUEBLES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      </header>

      <nav className="stepper-bar">
        <div className="step-group">
          <button
            type="button"
            className={activeStep === 'foto' ? 'step-btn active' : 'step-btn'}
            onClick={() => setActiveStep('foto')}
          >
            1. Foto &amp; Visión (Detectar)
          </button>
          <button
            type="button"
            className={activeStep === 'vectorial' ? 'step-btn active' : 'step-btn'}
            onClick={() => setActiveStep('vectorial')}
          >
            2. Plano Vectorial &amp; Redimensionar {!modelApproved ? '●' : '✓'}
          </button>
          <button
            type="button"
            className={activeStep === '3d' ? 'step-btn active' : 'step-btn'}
            onClick={() => setActiveStep('3d')}
          >
            3. Despiece, 3D &amp; Planchas 244×122
          </button>
          <button
            type="button"
            className={activeStep === 'split' ? 'step-btn active' : 'step-btn'}
            onClick={() => setActiveStep('split')}
          >
            Vista Dividida (Foto ↔ 3D)
          </button>
        </div>
        <span className="small-note muted">
          Cuerpo: {params.targetDimensions.x}×{params.targetDimensions.y}×{params.targetDimensions.z} mm ·{' '}
          {despiece.matrizDespiece.length} piezas · {cuttingPlan.totalSheetsCount} plancha(s) ({cuttingPlan.usagePercentage.toFixed(1)}% uso)
        </span>
      </nav>

      <div className="workspace-grid">
        {/* PANEL LATERAL DE PARÁMETROS */}
        <aside className="sidebar-controls">
          <div className="control-group">
            <h3>Dimensiones Cuerpo V_f (mm)</h3>
            <div className="slider-row">
              <div className="slider-head">
                <label>Ancho X</label>
                <input
                  type="number"
                  min={300}
                  max={2400}
                  value={params.targetDimensions.x}
                  onChange={(e) => updateTargetDim('x', Number(e.target.value) || 300)}
                />
              </div>
              <input
                type="range"
                min={300}
                max={2400}
                step={10}
                value={params.targetDimensions.x}
                onChange={(e) => updateTargetDim('x', Number(e.target.value))}
              />
            </div>

            <div className="slider-row">
              <div className="slider-head">
                <label>Alto Y (cuerpo melamina)</label>
                <input
                  type="number"
                  min={300}
                  max={2400}
                  value={params.targetDimensions.y}
                  onChange={(e) => updateTargetDim('y', Number(e.target.value) || 300)}
                />
              </div>
              <input
                type="range"
                min={300}
                max={2400}
                step={10}
                value={params.targetDimensions.y}
                onChange={(e) => updateTargetDim('y', Number(e.target.value))}
              />
            </div>

            <div className="slider-row">
              <div className="slider-head">
                <label>Profundidad Z</label>
                <input
                  type="number"
                  min={200}
                  max={800}
                  value={params.targetDimensions.z}
                  onChange={(e) => updateTargetDim('z', Number(e.target.value) || 200)}
                />
              </div>
              <input
                type="range"
                min={200}
                max={800}
                step={10}
                value={params.targetDimensions.z}
                onChange={(e) => updateTargetDim('z', Number(e.target.value))}
              />
              <div className="chip-row">
                {[320, 400, 500, 550].map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={params.targetDimensions.z === d ? 'chip-btn active' : 'chip-btn'}
                    onClick={() => updateTargetDim('z', d)}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="control-group">
            <h3>Estructura Interna y Patas</h3>
            {topology.shelfMode === 'equidistant' && (
              <div className="slider-row">
                <div className="slider-head">
                  <label>Repisas equidistantes (N)</label>
                  <strong>{topology.equalShelfCount}</strong>
                </div>
                <input
                  type="range"
                  min={0}
                  max={8}
                  value={topology.equalShelfCount}
                  onChange={(e) => {
                    setModelApproved(false);
                    setTopology((prev) => ({
                      ...prev,
                      equalShelfCount: Number(e.target.value),
                    }));
                  }}
                />
              </div>
            )}

            <button type="button" className="btn-secondary" onClick={handleToggleCenterDivider}>
              {hasCenterDivider ? 'Quitar divisor vertical central' : '+ Agregar divisor vertical central'}
            </button>

            <label className="toggle-label">
              <input
                type="checkbox"
                checked={topology.hasBackPanel}
                onChange={(e) =>
                  setTopology((prev) => ({ ...prev, hasBackPanel: e.target.checked }))
                }
              />
              Incluir Fondo Durolac 3 mm (n×3 → n×5)
            </label>

            <label className="toggle-label">
              <input
                type="checkbox"
                checked={Boolean(topology.hasExternalLegs)}
                onChange={(e) => handleToggleExternalLegs(e.target.checked)}
              />
              Patas externas independientes (no melamina)
            </label>
            {topology.hasExternalLegs && (
              <div className="chip-row">
                <label className="small-note">
                  Alto patas (mm):
                  <input
                    type="number"
                    min={40}
                    max={400}
                    value={topology.externalLegHeightMm ?? 150}
                    onChange={(e) =>
                      handleToggleExternalLegs(true, Number(e.target.value) || 150, topology.externalLegCount)
                    }
                    style={{ width: 64, marginLeft: 4 }}
                  />
                </label>
                <label className="small-note">
                  Cant:
                  <input
                    type="number"
                    min={2}
                    max={12}
                    value={topology.externalLegCount ?? 4}
                    onChange={(e) =>
                      handleToggleExternalLegs(true, topology.externalLegHeightMm, Number(e.target.value) || 4)
                    }
                    style={{ width: 48, marginLeft: 4 }}
                  />
                </label>
              </div>
            )}
          </div>

          <div className="control-group">
            <h3>Carpintería y Sierra</h3>
            <label className="small-note">
              Formato de plancha:
              <select
                className="select-input"
                value={sheetStandard}
                onChange={(e) => handleSheetStandardChange(e.target.value as SheetStandard)}
              >
                <option value="pauta">Estándar Pauta (2440×1220 mm)</option>
                <option value="chile">Chile (2500×1830 + Durolac 2440×1520)</option>
              </select>
            </label>

            <label className="small-note">
              Encuentro en esquinas:
              <select
                className="select-input"
                value={params.cornerJointType}
                onChange={(e) =>
                  setParams((p) => ({
                    ...p,
                    cornerJointType: e.target.value as ScaleAndBoardParams['cornerJointType'],
                  }))
                }
              >
                <option value="topOverSides">Cubierta sobre laterales (topOverSides)</option>
                <option value="topBetweenSides">Cubierta entre laterales (topBetweenSides)</option>
              </select>
            </label>

            <label className="small-note">
              Tapacanto:
              <select
                className="select-input"
                value={params.edgeBandingMode}
                onChange={(e) =>
                  setParams((p) => ({
                    ...p,
                    edgeBandingMode: e.target.value as ScaleAndBoardParams['edgeBandingMode'],
                  }))
                }
              >
                <option value="visibleEdgesOnly">Solo cantos vistos</option>
                <option value="fullPerimeter">Perímetro completo</option>
              </select>
            </label>

            <label className="small-note">
              Estrategia de corte 2D:
              <select
                className="select-input"
                value={params.packingStrategy ?? 'guillotine'}
                onChange={(e) =>
                  setParams((p) => ({
                    ...p,
                    packingStrategy: e.target.value as 'guillotine' | 'maxrects',
                  }))
                }
              >
                <option value="guillotine">Guillotina 2 etapas (Taller)</option>
                <option value="maxrects">MaxRects BSSF (CNC)</option>
              </select>
            </label>

            <label className="toggle-label">
              <input
                type="checkbox"
                checked={params.respectGrain}
                onChange={(e) => setParams((p) => ({ ...p, respectGrain: e.target.checked }))}
              />
              Respetar sentido de veta (bloquea rotación 90°)
            </label>

            <div className="chip-row">
              <label className="small-note">
                Kerf (mm):
                <select
                  value={params.kerf}
                  onChange={(e) => setParams((p) => ({ ...p, kerf: Number(e.target.value) }))}
                  style={{ marginLeft: 4 }}
                >
                  <option value={3.2}>3.2</option>
                  <option value={3.5}>3.5</option>
                  <option value={4}>4.0</option>
                </select>
              </label>
              <label className="small-note">
                Trim (mm):
                <select
                  value={params.trimMm ?? 0}
                  onChange={(e) => setParams((p) => ({ ...p, trimMm: Number(e.target.value) }))}
                  style={{ marginLeft: 4 }}
                >
                  <option value={0}>0</option>
                  <option value={10}>10</option>
                  <option value={15}>15</option>
                </select>
              </label>
            </div>
          </div>

          <div className="control-group">
            <h3>Acabado 3D y Vista Explotada</h3>
            <div className="chip-row">
              {(['blanco', 'roble', 'grafito'] as MelamineMaterial[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={params.material === m ? 'chip-btn active' : 'chip-btn'}
                  onClick={() => setParams((p) => ({ ...p, material: m }))}
                >
                  {m === 'blanco' ? 'Blanco' : m === 'roble' ? 'Roble Claro' : 'Grafito'}
                </button>
              ))}
            </div>
            <div className="slider-row">
              <div className="slider-head">
                <label>Vista Explotada</label>
                <strong>{Math.round(explodeFactor * 100)}%</strong>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={explodeFactor}
                onChange={(e) => setExplodeFactor(Number(e.target.value))}
              />
            </div>
          </div>
        </aside>

        {/* ESCENARIO CENTRAL */}
        <main className="main-stage">
          {/* Mantener VectorCanvas montado al cambiar de paso para no perder la foto cargada ni las esquinas */}
          <div style={{ display: activeStep === 'foto' ? 'block' : 'none' }}>
            <VectorCanvas
              topology={topology}
              params={params}
              despiece={despiece}
              onUpdateTopology={(next) => {
                setActivePreset(null);
                setActiveCatalogId('');
                setModelApproved(false);
                setTopology(next);
              }}
              onApplyCalibratedDims={(dims) => {
                setModelApproved(false);
                setParams((p) => ({
                  ...p,
                  referenceDimensions: { ...dims },
                  targetDimensions: { ...dims },
                }));
              }}
              onToggleBackPanel={(checked) =>
                setTopology((prev) => ({ ...prev, hasBackPanel: checked }))
              }
              onToggleExternalLegs={handleToggleExternalLegs}
              onAddHardwareItem={handleAddHardwareItem}
              onSelectDepthMm={(z) => updateTargetDim('z', z)}
              onGoToBlueprint={() => setActiveStep('vectorial')}
            />
            <div className="export-bar" style={{ marginTop: 10 }}>
              <button
                type="button"
                className="btn-approve"
                onClick={() => setActiveStep('vectorial')}
              >
                Siguiente → Ver Plano Vectorial 2D y Redimensionar
              </button>
            </div>
          </div>

          {activeStep === 'vectorial' && (
            <VectorBlueprintPanel
              topology={topology}
              params={params}
              despiece={despiece}
              cuttingPlan={cuttingPlan}
              modelApproved={modelApproved}
              onUpdateDim={updateTargetDim}
              onUpdateFrontZones={handleUpdateFrontZones}
              onApproveModel={() => {
                setModelApproved(true);
                setActiveStep('3d');
              }}
            />
          )}

          {activeStep === 'split' && (
            <div className="split-stage">
              <VectorCanvas
                topology={topology}
                params={params}
                despiece={despiece}
                onUpdateTopology={(next) => {
                  setActivePreset(null);
                  setActiveCatalogId('');
                  setModelApproved(false);
                  setTopology(next);
                }}
                onApplyCalibratedDims={(dims) => {
                  setModelApproved(false);
                  setParams((p) => ({
                    ...p,
                    referenceDimensions: { ...dims },
                    targetDimensions: { ...dims },
                  }));
                }}
                onToggleBackPanel={(checked) =>
                  setTopology((prev) => ({ ...prev, hasBackPanel: checked }))
                }
                onToggleExternalLegs={handleToggleExternalLegs}
                onAddHardwareItem={handleAddHardwareItem}
                onSelectDepthMm={(z) => updateTargetDim('z', z)}
                onGoToBlueprint={() => setActiveStep('vectorial')}
              />
              <Viewer3D
                despiece={despiece}
                topology={topology}
                params={params}
                explodeFactor={explodeFactor}
              />
            </div>
          )}

          {activeStep === '3d' && (
            <>
              {!modelApproved && (
                <div className="alert-box warning">
                  <strong>Modelo modificado pendiente de aprobación vectorial:</strong>{' '}
                  revisa el nuevo plano vectorial antes de enviar a corte o{' '}
                  <button
                    type="button"
                    className="btn-small"
                    onClick={() => setActiveStep('vectorial')}
                  >
                    Ir al Plano Vectorial 2D
                  </button>
                </div>
              )}
              <Viewer3D
                despiece={despiece}
                topology={topology}
                params={params}
                explodeFactor={explodeFactor}
              />
            </>
          )}

          <MathPanel
            despiece={despiece}
            cuttingPlan={cuttingPlan}
            topology={topology}
            params={params}
            modelApproved={modelApproved}
            onGoToBlueprint={() => setActiveStep('vectorial')}
            onFixReferenceV0={() =>
              setParams((p) => ({
                ...p,
                referenceDimensions: { ...p.targetDimensions },
              }))
            }
            onAddCenterDivider={() => {
              if (!hasCenterDivider) handleToggleCenterDivider();
            }}
            onAddHardwareItem={handleAddHardwareItem}
            onRemoveHardwareItem={handleRemoveHardwareItem}
          />
        </main>
      </div>
    </div>
  );
}
