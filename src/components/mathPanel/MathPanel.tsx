/**
 * SMARTFURNITURE — PANEL MATEMÁTICO (UNIDAD 3), HERRAJES Y PLANO DE CORTE 2D (v3.0)
 * 5 pestañas limpias y legibles para grabación de video + exportación offline (.xls / .csv / .svg).
 */
import { useState } from 'react';
import {
  AlertTriangle,
  Download,
  FileSpreadsheet,
  Grid,
  Layers,
  Sigma,
  Wrench,
} from 'lucide-react';
import type {
  CuttingPlanResult,
  DespieceResult,
  FurnitureTopology,
  HardwareCategory,
  HardwareItem,
  ScaleAndBoardParams,
} from '../../types/contracts';
import {
  ETAPA2_BASE_MATRIX_M0,
  scaleBaseMatrix,
} from '../../core/mathEngine';
import {
  generateDespieceCsv,
  generateExcelSpreadsheetML,
} from '../../core/cuttingStock';

interface MathPanelProps {
  despiece: DespieceResult;
  cuttingPlan: CuttingPlanResult;
  topology: FurnitureTopology;
  params: ScaleAndBoardParams;
  onFixReferenceV0: () => void;
  onAddCenterDivider: () => void;
  onAddHardwareItem: (item: HardwareItem) => void;
  onRemoveHardwareItem: (id: string) => void;
}

type PanelTab = 'unidad3' | 'alertas' | 'matrices' | 'herrajes' | 'corte';

function triggerDownload(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function MathPanel({
  despiece,
  cuttingPlan,
  topology,
  params,
  onFixReferenceV0,
  onAddCenterDivider,
  onAddHardwareItem,
  onRemoveHardwareItem,
}: MathPanelProps) {
  const [tab, setTab] = useState<PanelTab>('unidad3');
  const [hwCategory, setHwCategory] = useState<HardwareCategory>('tiradores');
  const [hwDesc, setHwDesc] = useState('Tirador metálico 128 mm');
  const [hwQty, setHwQty] = useState(2);

  const etapa2Demo = scaleBaseMatrix(ETAPA2_BASE_MATRIX_M0, 1.2, 1.2);
  const { kx, ky, kz } = despiece.scaleFactors;
  const prog = despiece.shelfProgression;

  const handleExportExcel = () => {
    const xls = generateExcelSpreadsheetML(despiece, cuttingPlan, params);
    triggerDownload(
      `smartfurniture_despiece_${params.targetDimensions.x}x${params.targetDimensions.y}.xls`,
      xls,
      'application/vnd.ms-excel;charset=utf-8',
    );
  };

  const handleExportCsv = () => {
    const csv = generateDespieceCsv(despiece, ';');
    triggerDownload(
      `smartfurniture_despiece_${params.targetDimensions.x}x${params.targetDimensions.y}.csv`,
      csv,
      'text/csv;charset=utf-8',
    );
  };

  const handleExportSvg = () => {
    triggerDownload(
      `smartfurniture_corte_${params.targetDimensions.x}x${params.targetDimensions.y}.svg`,
      cuttingPlan.svgMarkup,
      'image/svg+xml;charset=utf-8',
    );
  };

  const handleAddHw = () => {
    if (!hwDesc.trim()) return;
    onAddHardwareItem({
      id: `hw_manual_${Date.now()}`,
      categoria: hwCategory,
      descripcion: hwDesc.trim(),
      cantidad: Math.max(1, hwQty),
      notaCompra: 'Accesorio ajeno a melamina — adquirir en ferretería aparte.',
      origen: 'manual',
    });
    setHwDesc('');
  };

  return (
    <div className="math-panel">
      <div className="panel-tabs">
        <button
          type="button"
          className={tab === 'unidad3' ? 'tab-btn active' : 'tab-btn'}
          onClick={() => setTab('unidad3')}
        >
          <Sigma size={15} /> Unidad 3
        </button>
        <button
          type="button"
          className={tab === 'alertas' ? 'tab-btn active' : 'tab-btn'}
          onClick={() => setTab('alertas')}
        >
          <AlertTriangle size={15} /> Alertas ({despiece.alerts.length})
        </button>
        <button
          type="button"
          className={tab === 'matrices' ? 'tab-btn active' : 'tab-btn'}
          onClick={() => setTab('matrices')}
        >
          <Grid size={15} /> Matrices n×3/n×5
        </button>
        <button
          type="button"
          className={tab === 'herrajes' ? 'tab-btn active' : 'tab-btn'}
          onClick={() => setTab('herrajes')}
        >
          <Wrench size={15} /> Herrajes ({despiece.hardwareSummary.length})
        </button>
        <button
          type="button"
          className={tab === 'corte' ? 'tab-btn active' : 'tab-btn'}
          onClick={() => setTab('corte')}
        >
          <Layers size={15} /> Corte 2D ({cuttingPlan.totalSheetsCount})
        </button>
      </div>

      <div className="panel-body">
        {tab === 'unidad3' && (
          <div className="tab-section">
            <div className="metric-card">
              <div className="card-header-row">
                <h4>1. Vectores en ℝ³ y Escalamiento (e = {params.boardThickness} mm invariante)</h4>
                <button type="button" className="btn-small" onClick={onFixReferenceV0}>
                  Fijar V₀ actual
                </button>
              </div>
              <p className="mono">
                V₀ = ({params.referenceDimensions.x}, {params.referenceDimensions.y}, {params.referenceDimensions.z}) mm
              </p>
              <p className="mono">
                V_f = ({params.targetDimensions.x}, {params.targetDimensions.y}, {params.targetDimensions.z}) mm
              </p>
              <p className="mono accent">
                k = (k_x={kx.toFixed(3)}, k_y={ky.toFixed(3)}, k_z={kz.toFixed(3)}) · Espesor e = {params.boardThickness} mm constante
              </p>
            </div>

            <div className="metric-card">
              <h4>2. Progresión Aritmética de Repisas ({topology.shelfMode})</h4>
              {topology.shelfMode === 'equidistant' && prog.count > 0 ? (
                <>
                  <p className="mono">
                    H_int = {prog.hInteriorMm.toFixed(1)} mm · s_libre = {prog.clearSpanMm.toFixed(2)} mm
                  </p>
                  <p className="mono">
                    a₁ = {prog.a1.toFixed(2)} mm · d = {prog.d.toFixed(2)} mm
                  </p>
                  <p className="mono">
                    a_n = [{prog.terms.map((t) => t.toFixed(1)).join(', ')}] mm
                  </p>
                </>
              ) : (
                <p className="muted">
                  Modo personalizado (`custom`): {topology.hShelves.length} repisas definidas en espacio interior [0, 1]².
                </p>
              )}
            </div>

            <div className="metric-card">
              <h4>3. Sumatorias de Materiales y Validación Etapa 2</h4>
              <div className="kpi-grid">
                <div>
                  <span className="kpi-label">Área Neta Total</span>
                  <strong>{despiece.totalNetAreaM2.toFixed(4)} m²</strong>
                </div>
                <div>
                  <span className="kpi-label">Fondo 3 mm</span>
                  <strong>{despiece.backPanelAreaM2.toFixed(4)} m²</strong>
                </div>
                <div>
                  <span className="kpi-label">Tapacanto ({params.edgeBandingMode === 'fullPerimeter' ? 'Perímetro' : 'Vistos'})</span>
                  <strong>{despiece.totalEdgeBandingMeters.toFixed(2)} m</strong>
                </div>
              </div>
              <p className="muted small-note">
                Validación matricial Etapa 2 (M = M₀·diag(1.2, 1.2, 1)): {etapa2Demo.originalAreaM2.toFixed(4)} → {etapa2Demo.scaledAreaM2.toFixed(4)} m² · Tapacanto {etapa2Demo.originalEdgeBandingMeters.toFixed(2)} → {etapa2Demo.scaledEdgeBandingMeters.toFixed(2)} m.
              </p>
            </div>

            {topology.homographyMatrix && (
              <div className="metric-card">
                <h4>4. Matriz de Homografía Proyectiva H (3×3)</h4>
                <pre className="matrix-pre">
                  {topology.homographyMatrix
                    .map((row) => `[ ${row.map((v) => v.toFixed(4).padStart(9)).join('  ')} ]`)
                    .join('\n')}
                </pre>
              </div>
            )}
          </div>
        )}

        {tab === 'alertas' && (
          <div className="tab-section">
            {despiece.alerts.length === 0 ? (
              <div className="ok-box">
                Todas las piezas cumplen luz libre estructural (≤ 850 mm) y dimensiones válidas.
              </div>
            ) : (
              <>
                {despiece.alerts.map((al) => (
                  <div
                    key={al.id}
                    className={al.severidad === 'critical' ? 'alert-box critical' : 'alert-box warning'}
                  >
                    <strong>[{al.severidad.toUpperCase()}] {al.tipo}</strong>
                    <p>{al.mensaje}</p>
                  </div>
                ))}
                {despiece.alerts.some((a) => a.tipo === 'pandeo') && (
                  <button type="button" className="btn-primary" onClick={onAddCenterDivider}>
                    Solucionar ahora: Agregar divisor vertical central (u = 0.5)
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {tab === 'matrices' && (
          <div className="tab-section">
            <div className="export-bar">
              <button type="button" className="btn-primary" onClick={handleExportExcel}>
                <FileSpreadsheet size={15} /> Exportar Excel (.xls · 3 Hojas)
              </button>
              <button type="button" className="btn-secondary" onClick={handleExportCsv}>
                <Download size={15} /> Exportar CSV (Excel Chile)
              </button>
            </div>
            <p className="muted small-note">
              Matriz activa: <strong>{topology.hasBackPanel ? 'n × 5 (Melamina 18 mm + Durolac 3 mm)' : 'n × 3 / n × 5 consolidada (Melamina 18 mm)'}</strong> — {despiece.matrizDespiece.length} placas físicas ({despiece.consolidatedRows.length} grupos consolidados).
            </p>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Pieza</th>
                    <th>Ancho Veta (mm)</th>
                    <th>Alto / Prof (mm)</th>
                    <th>Esp.</th>
                    <th>Cant.</th>
                    <th>Material</th>
                  </tr>
                </thead>
                <tbody>
                  {despiece.consolidatedRows.map((row, idx) => (
                    <tr key={`${row.nombre}_${idx}`}>
                      <td>{row.nombre}</td>
                      <td className="num">{row.ancho.toFixed(1)}</td>
                      <td className="num">{row.alto.toFixed(1)}</td>
                      <td className="num">{row.espesor}</td>
                      <td className="num">{row.cantidad}</td>
                      <td>{row.material}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'herrajes' && (
          <div className="tab-section">
            <p className="muted small-note">
              Elementos distintos a la melamina (patas independientes, tiradores, bisagras). Se aíslan del cálculo estructural del cuerpo y se exportan en su propia hoja de Excel.
            </p>
            {despiece.hardwareSummary.length === 0 ? (
              <div className="empty-box">No hay patas externas ni tiradores registrados para este mueble.</div>
            ) : (
              <div className="hw-list">
                {despiece.hardwareSummary.map((hw) => (
                  <div key={hw.id} className="hw-card">
                    <div>
                      <strong>[{hw.categoria.toUpperCase()}] {hw.descripcion} × {hw.cantidad}</strong>
                      <p className="muted small-note">{hw.notaCompra}</p>
                    </div>
                    {hw.id !== 'hw_patas_externas' && (
                      <button
                        type="button"
                        className="btn-danger-sm"
                        onClick={() => onRemoveHardwareItem(hw.id)}
                      >
                        Quitar
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="hw-form">
              <select
                value={hwCategory}
                onChange={(e) => setHwCategory(e.target.value as HardwareCategory)}
              >
                <option value="tiradores">Tiradores / Manillas</option>
                <option value="patas">Patas adicionales</option>
                <option value="bisagras">Bisagras</option>
                <option value="correderas">Correderas</option>
                <option value="otro">Otro herraje</option>
              </select>
              <input
                type="text"
                value={hwDesc}
                onChange={(e) => setHwDesc(e.target.value)}
                placeholder="Ej. Tirador metálico 128 mm"
              />
              <input
                type="number"
                min={1}
                max={50}
                value={hwQty}
                onChange={(e) => setHwQty(Number(e.target.value) || 1)}
                style={{ width: 64 }}
              />
              <button type="button" className="btn-small" onClick={handleAddHw}>
                + Agregar
              </button>
            </div>
          </div>
        )}

        {tab === 'corte' && (
          <div className="tab-section">
            <div className="kpi-grid">
              <div>
                <span className="kpi-label">Melamina 18 mm</span>
                <strong>{cuttingPlan.melamineSheetsCount} planchas</strong>
              </div>
              <div>
                <span className="kpi-label">Fondo 3 mm</span>
                <strong>{cuttingPlan.backPanelSheetsCount} planchas</strong>
              </div>
              <div>
                <span className="kpi-label">Aprovechamiento</span>
                <strong>{cuttingPlan.usagePercentage.toFixed(1)}%</strong>
              </div>
              <div>
                <span className="kpi-label">Desperdicio</span>
                <strong>{cuttingPlan.wastePercentage.toFixed(1)}%</strong>
              </div>
            </div>

            {cuttingPlan.unplacedPieces.length > 0 && (
              <div className="alert-box critical">
                <strong>Piezas sobredimensionadas ({cuttingPlan.unplacedPieces.length}):</strong>{' '}
                {cuttingPlan.unplacedPieces.map((p) => `${p.nombre} (${p.ancho}×${p.alto})`).join(', ')}
              </div>
            )}

            <div className="export-bar">
              <button type="button" className="btn-primary" onClick={handleExportSvg}>
                <Download size={15} /> Descargar Plano SVG
              </button>
              <button type="button" className="btn-secondary" onClick={handleExportExcel}>
                <FileSpreadsheet size={15} /> Exportar Excel (.xls)
              </button>
            </div>

            <div
              className="svg-preview"
              dangerouslySetInnerHTML={{ __html: cuttingPlan.svgMarkup }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
