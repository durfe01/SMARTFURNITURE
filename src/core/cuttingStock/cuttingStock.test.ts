import { describe, expect, it } from 'vitest';
import type { BoardPiece, ScaleAndBoardParams, SheetLayout } from '../../types/contracts';
import {
  CHILE_DUROLAC_SHEET,
  CHILE_MELAMINE_SHEET,
  calculateDespiece,
  clonePreset,
} from '../mathEngine';
import {
  generateCuttingPlan,
  generateDespieceCsv,
  generateExcelSpreadsheetML,
} from './index';

/**
 * Invariante geométrico obligatorio para cada plancha:
 * 1. Todas las piezas dentro de [trimMm, W - trimMm] × [trimMm, H - trimMm].
 * 2. Cero solapamientos y separación pairwise >= kerf.
 */
function assertSheetInvariants(sheets: readonly SheetLayout[], kerf: number, trimMm = 0): void {
  const tol = 1e-3;
  for (const sh of sheets) {
    for (const r of sh.piezasColocadas) {
      expect(r.x).toBeGreaterThanOrEqual(trimMm - tol);
      expect(r.y).toBeGreaterThanOrEqual(trimMm - tol);
      expect(r.x + r.ancho).toBeLessThanOrEqual(sh.anchoSheet - trimMm + tol);
      expect(r.y + r.alto).toBeLessThanOrEqual(sh.altoSheet - trimMm + tol);
    }

    for (let i = 0; i < sh.piezasColocadas.length; i++) {
      const a = sh.piezasColocadas[i];
      for (let j = i + 1; j < sh.piezasColocadas.length; j++) {
        const b = sh.piezasColocadas[j];
        const gapX = Math.max(b.x - (a.x + a.ancho), a.x - (b.x + b.ancho));
        const gapY = Math.max(b.y - (a.y + a.alto), a.y - (b.y + b.alto));
        // Al menos en uno de los ejes la separación debe ser >= kerf
        const sep = Math.max(gapX, gapY);
        expect(
          sep,
          `Violación de kerf/solapamiento en plancha #${sh.sheetId} entre "${a.idPieza}" y "${b.idPieza}": sep=${sep.toFixed(3)} < kerf=${kerf}`,
        ).toBeGreaterThanOrEqual(kerf - tol);
      }
    }
  }
}

function makePiece(id: string, ancho: number, alto: number, espesor = 18, respectGrain = true): BoardPiece {
  return {
    id,
    nombre: id,
    tipo: espesor === 3 ? 'fondo' : 'repisa',
    ancho,
    alto,
    espesor,
    cantidad: 1,
    respectGrain,
    edges: { top: true, bottom: false, left: false, right: false },
    posicion3D: [0, 0, 0],
    dimensiones3D: [ancho, espesor, alto],
    rotacion3D: [0, 0, 0],
    material: espesor === 3 ? 'durolac_3mm' : 'roble',
  };
}

function baseParams(overrides?: Partial<ScaleAndBoardParams>): ScaleAndBoardParams {
  return {
    targetDimensions: { x: 800, y: 1800, z: 320 },
    referenceDimensions: { x: 800, y: 1800, z: 320 },
    boardThickness: 18,
    backPanelThickness: 3,
    sheetDimensions: { width: 2440, height: 1220 },
    trimMm: 0,
    kerf: 4,
    respectGrain: true,
    packingStrategy: 'guillotine',
    cornerJointType: 'topOverSides',
    edgeBandingMode: 'visibleEdgesOnly',
    material: 'roble',
    ...overrides,
  };
}

describe('SmartFurniture Bloque 2 — Cutting Stock 2D, SVG y Exportadores Excel/CSV (v3.0)', () => {
  it('Casos límite de kerf exacto (virtual-pad) y piezas sobredimensionadas en unplacedPieces', () => {
    const p = baseParams({ kerf: 4, trimMm: 0 });

    // 1) 2440×1220 cabe exacto en 1 plancha sin sobrar margen de kerf
    const exact = generateCuttingPlan([makePiece('full', 2440, 1220)], p);
    expect(exact.unplacedPieces).toHaveLength(0);
    expect(exact.totalSheetsCount).toBe(1);
    assertSheetInvariants(exact.sheetsUsed, 4, 0);

    // 2) 2×(1218×600) con kerf 4 -> 1218 + 4 + 1218 = 2440 -> caben en 1 sola franja (misma Y)
    const oneRow = generateCuttingPlan([makePiece('a', 1218, 600), makePiece('b', 1218, 600)], p);
    expect(oneRow.totalSheetsCount).toBe(1);
    expect(oneRow.sheetsUsed[0].piezasColocadas[0].y).toBe(oneRow.sheetsUsed[0].piezasColocadas[1].y);
    assertSheetInvariants(oneRow.sheetsUsed, 4, 0);

    // 3) 2×(1220×600) con kerf 4 -> 1220 + 4 + 1220 = 2444 > 2440 -> pasan a 2 franjas en 1 plancha
    const twoRows = generateCuttingPlan([makePiece('a', 1220, 600), makePiece('b', 1220, 600)], p);
    expect(twoRows.totalSheetsCount).toBe(1);
    expect(twoRows.sheetsUsed[0].piezasColocadas[0].y).not.toBe(twoRows.sheetsUsed[0].piezasColocadas[1].y);
    assertSheetInvariants(twoRows.sheetsUsed, 4, 0);

    // 4) 2600×1500 no cabe -> unplacedPieces sin bucle infinito ni NaN
    const huge = generateCuttingPlan([makePiece('gigante', 2600, 1500)], p);
    expect(huge.unplacedPieces).toHaveLength(1);
    expect(huge.totalSheetsCount).toBe(0);
    expect(huge.usagePercentage).toBe(0);
    expect(huge.wastePercentage).toBe(0);
  });

  it('Bloqueo estricto de veta y reducción real de planchas (2 -> 1) al desactivar respectGrain en módulo 900×1150×410', () => {
    const { topology, params } = clonePreset('estanteria');
    topology.equalShelfCount = 1;
    params.targetDimensions = { x: 900, y: 1150, z: 410 };
    params.referenceDimensions = { x: 900, y: 1150, z: 410 };

    const despiece = calculateDespiece(topology, params);

    // Con veta ON: 2 planchas, 0 piezas rotadas
    params.respectGrain = true;
    const planWithGrain = generateCuttingPlan(despiece.matrizDespiece, params);
    expect(planWithGrain.melamineSheetsCount).toBe(2);
    assertSheetInvariants(planWithGrain.sheetsUsed, params.kerf, 0);
    for (const sh of planWithGrain.sheetsUsed) {
      expect(sh.piezasColocadas.every((r) => !r.rotado)).toBe(true);
    }

    // Con veta OFF: baja a 1 plancha con piezas rotadas y duplica el aprovechamiento
    params.respectGrain = false;
    const planNoGrain = generateCuttingPlan(despiece.matrizDespiece, params);
    expect(planNoGrain.melamineSheetsCount).toBe(1);
    expect(planNoGrain.usagePercentage).toBeGreaterThan(planWithGrain.usagePercentage * 1.8);
    expect(planNoGrain.sheetsUsed[0].piezasColocadas.some((r) => r.rotado)).toBe(true);
    assertSheetInvariants(planNoGrain.sheetsUsed, params.kerf, 0);
  });

  it('Preset 3 (closet): separación estricta 18 mm vs 3 mm, formatos Pauta y Chile, y promedio ponderado exacto', () => {
    const { topology, params } = clonePreset('closet');
    const despiece = calculateDespiece(topology, params);

    // Formato estándar 2440×1220
    const planStd = generateCuttingPlan(despiece.matrizDespiece, params);
    expect(planStd.unplacedPieces).toHaveLength(0);
    expect(planStd.melamineSheetsCount).toBe(3);
    expect(planStd.backPanelSheetsCount).toBe(2);
    expect(planStd.usagePercentage + planStd.wastePercentage).toBeCloseTo(100, 2);
    assertSheetInvariants(planStd.sheetsUsed, params.kerf, 0);

    // Formato Chile sin trim: Melamina 2500×1830 (2 planchas) + Durolac 2440×1520 (1 plancha: 750+4+750=1504 <= 1520)
    params.sheetDimensions = { ...CHILE_MELAMINE_SHEET };
    params.backPanelSheetDimensions = { ...CHILE_DUROLAC_SHEET };
    params.trimMm = 0;
    const planChile = generateCuttingPlan(despiece.matrizDespiece, params);
    expect(planChile.unplacedPieces).toHaveLength(0);
    expect(planChile.melamineSheetsCount).toBe(2);
    expect(planChile.backPanelSheetsCount).toBe(1);
    expect(planChile.usagePercentage + planChile.wastePercentage).toBeCloseTo(100, 2);
    assertSheetInvariants(planChile.sheetsUsed, params.kerf, 0);

    // Con trimMm = 10 (usableH = 1500 < 1504): respeta estrictamente el margen de escuadrado pasando Durolac a 2 planchas
    params.trimMm = 10;
    const planChileTrim = generateCuttingPlan(despiece.matrizDespiece, params);
    expect(planChileTrim.unplacedPieces).toHaveLength(0);
    expect(planChileTrim.backPanelSheetsCount).toBe(2);
    assertSheetInvariants(planChileTrim.sheetsUsed, params.kerf, 10);

    // Verificar que el porcentaje global es ponderado por área real de planchas
    const sumPieces = planChile.sheetsUsed.reduce(
      (s, sh) => s + sh.piezasColocadas.reduce((a, r) => a + r.ancho * r.alto, 0),
      0,
    );
    const sumSheets = planChile.sheetsUsed.reduce((s, sh) => s + sh.anchoSheet * sh.altoSheet, 0);
    expect(planChile.usagePercentage).toBeCloseTo((sumPieces / sumSheets) * 100, 1);
  });

  it('Ambas estrategias (guillotine y maxrects) cumplen invariantes geométricos en los 3 presets', () => {
    for (const strategy of ['guillotine', 'maxrects'] as const) {
      for (const key of ['estanteria', 'rack_tv', 'closet'] as const) {
        const { topology, params } = clonePreset(key);
        params.packingStrategy = strategy;
        const despiece = calculateDespiece(topology, params);
        const plan = generateCuttingPlan(despiece.matrizDespiece, params);
        expect(plan.unplacedPieces).toHaveLength(0);
        assertSheetInvariants(plan.sheetsUsed, params.kerf, params.trimMm ?? 0);
        expect(plan.svgMarkup).toContain('<svg ');
        expect(plan.svgMarkup).toContain('</svg>');
      }
    }
  });

  it('Exportadores offline: CSV con BOM UTF-8 + Excel .xls SpreadsheetML de 3 hojas incluyendo patas externas', () => {
    const { topology, params } = clonePreset('rack_tv');
    const despiece = calculateDespiece(topology, params);
    const plan = generateCuttingPlan(despiece.matrizDespiece, params);

    const csv = generateDespieceCsv(despiece, ';');
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('HERRAJES Y ACCESORIOS (NO MELAMINA)');
    expect(csv).toContain('Patas independientes externas');

    const xls = generateExcelSpreadsheetML(despiece, plan, params);
    expect(xls).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xls).toContain('<Worksheet ss:Name="Despiece_Melamina">');
    expect(xls).toContain('<Worksheet ss:Name="Herrajes_y_Patas">');
    expect(xls).toContain('<Worksheet ss:Name="Resumen_U3_y_Planchas">');
    expect(xls).toContain('Patas independientes externas (150 mm)');
  });
});
