import { describe, expect, it } from 'vitest';
import type { BoardPiece } from '../../types/contracts';
import { calculateDespiece } from '../mathEngine';
import { generateCuttingPlan } from '../cuttingStock';
import { CATALOG_14_MUEBLES, cloneCatalogFurniture } from './catalog14';
import {
  inferFrontZonesFromDetection,
  renderFurnitureVectorBlueprintSvg,
} from './index';

function assertNo3DOverlap(pieces: readonly BoardPiece[], label: string): void {
  const tol = 1e-3;
  for (let i = 0; i < pieces.length; i++) {
    const a = pieces[i];
    const [ax, ay, az] = a.posicion3D;
    const [adx, ady, adz] = a.dimensiones3D;
    for (let j = i + 1; j < pieces.length; j++) {
      const b = pieces[j];
      const [bx, by, bz] = b.posicion3D;
      const [bdx, bdy, bdz] = b.dimensiones3D;
      const ox = Math.min(ax + adx / 2, bx + bdx / 2) - Math.max(ax - adx / 2, bx - bdx / 2);
      const oy = Math.min(ay + ady / 2, by + bdy / 2) - Math.max(ay - ady / 2, by - bdy / 2);
      const oz = Math.min(az + adz / 2, bz + bdz / 2) - Math.max(az - adz / 2, bz - bdz / 2);
      expect(
        ox > tol && oy > tol && oz > tol,
        `[${label}] Solapamiento 3D entre "${a.id}" y "${b.id}"`,
      ).toBe(false);
    }
  }
}

describe('SmartFurniture QA — 14 Muebles Reales: Planos Vectoriales, Redimensionamiento y Planchas 244×122 cm', () => {
  it('Existen exactamente 14 muebles en el catálogo QA y cada uno genera plano vectorial, despiece 0-solapamiento, redimensionamiento y corte 244×122 sin piezas sobrantes', () => {
    expect(CATALOG_14_MUEBLES).toHaveLength(14);

    for (const item of CATALOG_14_MUEBLES) {
      const cloned = cloneCatalogFurniture(item.id)!;
      expect(cloned).not.toBeNull();

      // 1. Modelo Vectorial Original (V0) + Despiece + Corte 244×122
      const despOrig = calculateDespiece(cloned.topology, cloned.params);
      expect(despOrig.matrizDespiece.length).toBeGreaterThanOrEqual(4);
      assertNo3DOverlap(despOrig.matrizDespiece, `${item.id} ORIGINAL`);

      const planOrig = generateCuttingPlan(despOrig.matrizDespiece, cloned.params);
      expect(planOrig.unplacedPieces, `[${item.id}] piezas sin ubicar en 2440×1220`).toHaveLength(0);
      expect(planOrig.usagePercentage + planOrig.wastePercentage).toBeCloseTo(100, 1);

      const svgOrig = renderFurnitureVectorBlueprintSvg(
        cloned.topology,
        cloned.params,
        despOrig,
        { stageLabel: 'ORIGINAL V0', cuttingPlan: planOrig },
      );
      expect(svgOrig).toContain('<svg ');
      expect(svgOrig).toContain('</svg>');
      expect(svgOrig).toContain('ALZADO FRONTAL');
      expect(svgOrig).toContain('PERFIL LATERAL');

      // 2. Redimensionamiento a voluntad del cliente (+15% ancho, -8% alto, +5% fondo)
      const resizedParams = {
        ...cloned.params,
        targetDimensions: {
          x: Math.min(2200, Math.round(cloned.params.targetDimensions.x * 1.15)),
          y: Math.max(400, Math.round(cloned.params.targetDimensions.y * 0.92)),
          z: Math.min(700, Math.round(cloned.params.targetDimensions.z * 1.05)),
        },
      };
      const despRedim = calculateDespiece(cloned.topology, resizedParams);
      assertNo3DOverlap(despRedim.matrizDespiece, `${item.id} REDIMENSIONADO`);

      const planRedim = generateCuttingPlan(despRedim.matrizDespiece, resizedParams);
      expect(planRedim.unplacedPieces, `[${item.id} REDIM] piezas sin ubicar`).toHaveLength(0);

      const svgRedim = renderFurnitureVectorBlueprintSvg(
        cloned.topology,
        resizedParams,
        despRedim,
        { stageLabel: 'REDIMENSIONADO Vf', cuttingPlan: planRedim },
      );
      expect(svgRedim).toContain(`Ancho X = ${resizedParams.targetDimensions.x} mm`);
      expect(svgRedim).toContain(`Alto Y = ${resizedParams.targetDimensions.y} mm`);
    }
  });

  it('inferFrontZonesFromDetection traduce automáticamente buffet cerrado (3 puertas + 3 cajones) en zonas funcionales', () => {
    const zones = inferFrontZonesFromDetection(
      [
        { id: 'd1', position: 0.253, start: 0, end: 1 },
        { id: 'd2', position: 0.508, start: 0, end: 1 },
        { id: 'd3', position: 0.765, start: 0, end: 1 },
      ],
      [
        { id: 'r1', position: 0.282, start: 0.765, end: 1 },
        { id: 'r2', position: 0.639, start: 0.765, end: 1 },
      ],
      'closed_front',
      [
        { u: 0.235, v: 0.45 },
        { u: 0.281, v: 0.45 },
        { u: 0.534, v: 0.45 },
        { u: 0.89, v: 0.80 },
        { u: 0.89, v: 0.45 },
        { u: 0.89, v: 0.11 },
      ],
    );

    expect(zones).toHaveLength(4);
    expect(zones[0].kind).toBe('door_left');
    expect(zones[1].kind).toBe('door_right');
    expect(zones[2].kind).toBe('door_right');
    expect(zones[3].kind).toBe('drawers');
    expect(zones[3].drawerCount).toBe(3);
  });
});
