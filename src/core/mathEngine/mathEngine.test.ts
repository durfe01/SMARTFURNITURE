import { describe, expect, it } from 'vitest';
import type { BoardPiece, Point2D } from '../../types/contracts';
import {
  ETAPA2_BASE_MATRIX_M0,
  applyHomography,
  calculateDespiece,
  calculateShelfProgression,
  clonePreset,
  computeQuadToUnitHomography,
  exteriorToInterior,
  exteriorToInteriorRaw,
  interiorToExterior,
  scaleBaseMatrix,
} from './index';

/**
 * Invariante geométrico estricto: verifica que NINGÚN par de placas físicas en 3D
 * se solape en su volumen AABB (tolerancia 1e-4 mm).
 */
function assertNo3DOverlap(pieces: readonly BoardPiece[]): void {
  const tol = 1e-4;
  for (let i = 0; i < pieces.length; i++) {
    const a = pieces[i];
    const [ax, ay, az] = a.posicion3D;
    const [adx, ady, adz] = a.dimensiones3D;
    const aMin = [ax - adx / 2, ay - ady / 2, az - adz / 2];
    const aMax = [ax + adx / 2, ay + ady / 2, az + adz / 2];

    for (let j = i + 1; j < pieces.length; j++) {
      const b = pieces[j];
      const [bx, by, bz] = b.posicion3D;
      const [bdx, bdy, bdz] = b.dimensiones3D;
      const bMin = [bx - bdx / 2, by - bdy / 2, bz - bdz / 2];
      const bMax = [bx + bdx / 2, by + bdy / 2, bz + bdz / 2];

      const overlapX = Math.min(aMax[0], bMax[0]) - Math.max(aMin[0], bMin[0]);
      const overlapY = Math.min(aMax[1], bMax[1]) - Math.max(aMin[1], bMin[1]);
      const overlapZ = Math.min(aMax[2], bMax[2]) - Math.max(aMin[2], bMin[2]);

      const overlaps = overlapX > tol && overlapY > tol && overlapZ > tol;
      expect(
        overlaps,
        `Solapamiento 3D entre "${a.id}" y "${b.id}" (dx=${overlapX.toFixed(3)}, dy=${overlapY.toFixed(3)}, dz=${overlapZ.toFixed(3)})`,
      ).toBe(false);
    }
  }
}

describe('SmartFurniture Bloque 1 — Motor Matemático y Homografía (v3.0)', () => {
  it('Etapa 2 exacta: M0 escalada por k=1.2 pasa 0.8800 -> 1.2672 m² y 6.80 -> 8.16 m con e=18 mm invariante', () => {
    const res = scaleBaseMatrix(ETAPA2_BASE_MATRIX_M0, 1.2, 1.2);
    expect(res.originalAreaM2).toBeCloseTo(0.88, 6);
    expect(res.scaledAreaM2).toBeCloseTo(1.2672, 6);
    expect(res.originalEdgeBandingMeters).toBeCloseTo(6.8, 6);
    expect(res.scaledEdgeBandingMeters).toBeCloseTo(8.16, 6);
    for (const row of res.scaledMatrix) {
      expect(row[2]).toBe(18);
    }
  });

  it('Conversión exterior <-> interior exacta y clamping seguro en bordes', () => {
    const uInt = exteriorToInterior(0.25, 18, 800);
    expect(uInt).toBeCloseTo(0.238219895, 5);
    expect(interiorToExterior(uInt, 18, 800)).toBeCloseTo(0.25, 6);

    // Clamping seguro si el clic cae sobre el borde exterior (< e/dim)
    expect(exteriorToInteriorRaw(0.01, 18, 800)).toBeLessThan(0);
    expect(exteriorToInterior(0.01, 18, 800)).toBe(0);
    expect(exteriorToInterior(0.995, 18, 800)).toBe(1);
  });

  it('Progresión aritmética exacta para N = 3, 4 y 5 repisas en y_f = 1800 mm', () => {
    for (const n of [3, 4, 5]) {
      const prog = calculateShelfProgression(1800, 18, n);
      expect(prog.hInteriorMm).toBe(1764);
      expect(prog.terms).toHaveLength(n);
      const expectedClear = (1764 - n * 18) / (n + 1);
      expect(prog.clearSpanMm).toBeCloseTo(expectedClear, 6);
      expect(prog.a1).toBeCloseTo(18 + expectedClear, 6);
      expect(prog.d).toBeCloseTo(expectedClear + 18, 6);

      // Comprobación simétrica: espacio libre sobre última repisa hasta cara inferior de cubierta
      const lastTop = prog.terms[n - 1] + 18;
      const topGap = 1800 - 18 - lastTop;
      expect(topGap).toBeCloseTo(expectedClear, 6);
    }
  });

  it('Descuentos topOverSides vs topBetweenSides y cero solapamiento 3D en los 3 presets', () => {
    for (const key of ['estanteria', 'rack_tv', 'closet'] as const) {
      const { topology, params } = clonePreset(key);
      const res = calculateDespiece(topology, params);
      expect(res.matrizDespiece.length).toBeGreaterThan(0);
      assertNo3DOverlap(res.matrizDespiece);
    }

    const est = clonePreset('estanteria');
    const resOver = calculateDespiece(est.topology, est.params);
    const cubiertaOver = resOver.matrizDespiece.find((p) => p.id === 'cubierta')!;
    const lateralOver = resOver.matrizDespiece.find((p) => p.id === 'lateral_izq')!;
    expect(cubiertaOver.ancho).toBe(800);
    expect(lateralOver.ancho).toBe(1764);

    est.params.cornerJointType = 'topBetweenSides';
    const resBetween = calculateDespiece(est.topology, est.params);
    assertNo3DOverlap(resBetween.matrizDespiece);
    const cubiertaBetween = resBetween.matrizDespiece.find((p) => p.id === 'cubierta')!;
    const lateralBetween = resBetween.matrizDespiece.find((p) => p.id === 'lateral_izq')!;
    expect(cubiertaBetween.ancho).toBe(764);
    expect(lateralBetween.ancho).toBe(1800);
  });

  it('Preset 2 (rack_tv): repisa central exacta 503.33 mm y patas externas 150 mm aisladas del cuerpo', () => {
    const { topology, params } = clonePreset('rack_tv');
    const res = calculateDespiece(topology, params);
    assertNo3DOverlap(res.matrizDespiece);

    const centralShelf = res.matrizDespiece.find((p) => p.id === 'rep_central')!;
    expect(centralShelf.ancho).toBeCloseTo(503.3333, 2);

    // Patas externas excluidas de la melamina y listadas en hardwareSummary
    const lateral = res.matrizDespiece.find((p) => p.id === 'lateral_izq')!;
    expect(lateral.ancho).toBe(550); // cuerpo puro sin sumar patas
    const legs = res.hardwareSummary.find((h) => h.categoria === 'patas');
    expect(legs).toBeDefined();
    expect(legs?.cantidad).toBe(4);
    expect(legs?.medidaReferenciaMm).toBe(150);
  });

  it('Preset 3 (closet): repisas 723 mm, veta vertical en laterales (2064×550) y 2 fondos 750×2100×3 mm', () => {
    const { topology, params } = clonePreset('closet');
    const res = calculateDespiece(topology, params);
    assertNo3DOverlap(res.matrizDespiece);

    const shelves = res.matrizDespiece.filter((p) => p.tipo === 'repisa');
    expect(shelves).toHaveLength(4);
    for (const s of shelves) {
      expect(s.ancho).toBeCloseTo(723, 4);
    }

    // Orientación de veta vertical en laterales
    const lat = res.matrizDespiece.find((p) => p.id === 'lateral_izq')!;
    expect(lat.ancho).toBe(2064);
    expect(lat.alto).toBe(550);

    // Fondo Durolac 3 mm subdividido en 2 paños de 750×2100×3 mm sin veta ni tapacanto
    const backPanels = res.matrizDespiece.filter((p) => p.tipo === 'fondo');
    expect(backPanels).toHaveLength(2);
    for (const bp of backPanels) {
      expect(bp.ancho).toBeCloseTo(750, 4);
      expect(bp.alto).toBe(2100);
      expect(bp.espesor).toBe(3);
      expect(bp.respectGrain).toBe(false);
      expect(bp.edges).toEqual({ top: false, bottom: false, left: false, right: false });
      expect(bp.posicion3D[2]).toBe(-1.5);
    }
    expect(res.matrixNx5.some((r) => r[4] === 'durolac_3mm')).toBe(true);
  });

  it('ANTI-BUG H2: Estantería (equidistant) > 886 mm dispara pandeo y se apaga al agregar vDivider en u=0.5 sin solapamiento', () => {
    const { topology, params } = clonePreset('estanteria');
    params.targetDimensions.x = 1000;

    const resBefore = calculateDespiece(topology, params);
    const pandeoBefore = resBefore.alerts.filter((a) => a.tipo === 'pandeo');
    expect(pandeoBefore).toHaveLength(4);
    expect(pandeoBefore[0].luzLibreMm).toBeCloseTo(964, 3);

    // Agregar divisor vertical central en modo equidistant
    topology.vDividers.push({ id: 'div_centro', position: 0.5, start: 0, end: 1 });
    const resAfter = calculateDespiece(topology, params);
    assertNo3DOverlap(resAfter.matrizDespiece);

    const shelvesAfter = resAfter.matrizDespiece.filter((p) => p.tipo === 'repisa');
    expect(shelvesAfter).toHaveLength(8);
    for (const s of shelvesAfter) {
      expect(s.ancho).toBeCloseTo(473, 4);
    }
    expect(resAfter.alerts.filter((a) => a.tipo === 'pandeo')).toHaveLength(0);
  });

  it('Subdivisión de fondo 3 mm también cuando un solo eje excede 2440 mm', () => {
    const { topology, params } = clonePreset('estanteria');
    topology.hasBackPanel = true;
    params.targetDimensions = { x: 2600, y: 1000, z: 320 };
    const res = calculateDespiece(topology, params);
    const backPanels = res.matrizDespiece.filter((p) => p.tipo === 'fondo');
    expect(backPanels.length).toBeGreaterThanOrEqual(2);
    for (const bp of backPanels) {
      expect(bp.ancho).toBeLessThanOrEqual(1220);
    }
  });

  it('Homografía 3×3: mapeo exacto con eje Y invertido, ida y vuelta < 1e-6 y rechazo de cuadrilátero degenerado', () => {
    const quad: [Point2D, Point2D, Point2D, Point2D] = [
      { x: 180, y: 90 },  // TL
      { x: 820, y: 120 }, // TR
      { x: 880, y: 690 }, // BR
      { x: 140, y: 660 }, // BL
    ];

    const hom = computeQuadToUnitHomography(quad);
    expect(hom).not.toBeNull();
    const { toUnit, toCanvas } = hom!;

    const expectedUnit: Point2D[] = [
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 0 },
      { x: 0, y: 0 },
    ];

    for (let i = 0; i < 4; i++) {
      const u = applyHomography(toUnit, quad[i])!;
      expect(u.x).toBeCloseTo(expectedUnit[i].x, 6);
      expect(u.y).toBeCloseTo(expectedUnit[i].y, 6);
      const back = applyHomography(toCanvas, u)!;
      expect(Math.hypot(back.x - quad[i].x, back.y - quad[i].y)).toBeLessThan(1e-6);
    }

    // Punto interior ida y vuelta
    const probe: Point2D = { x: 480, y: 390 };
    const mapped = applyHomography(toUnit, probe)!;
    const restored = applyHomography(toCanvas, mapped)!;
    expect(Math.hypot(restored.x - probe.x, restored.y - probe.y)).toBeLessThan(1e-6);

    // Cuadrilátero degenerado (3 puntos colineales) -> null
    const degenerate: [Point2D, Point2D, Point2D, Point2D] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 0 },
      { x: 50, y: 100 },
    ];
    expect(computeQuadToUnitHomography(degenerate)).toBeNull();
  });
});
