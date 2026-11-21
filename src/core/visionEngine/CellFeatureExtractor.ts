/**
 * SMARTFURNITURE / OFG — CLASE POO `CellFeatureExtractor`
 * Extrae el vector normalizado de 11 características fotométricas y geométricas
 * directamente desde los píxeles RGBA de una región/celda rectificada.
 * Compartido entre el entrenamiento offline (`train_vision_model.mjs`) y la inferencia en vivo.
 */
import type { NormalizedSegment } from '../../types/contracts';
import type { CellFeatureVector, ImageFrameRGBA } from './types';

export interface CellRegionBounds {
  uStart: number;
  uEnd: number;
  vStart: number;
  vEnd: number;
}

export class CellFeatureExtractor {
  /**
   * Extrae características fotométricas + estructurales de una celda interior [uStart..uEnd] x [vStart..vEnd].
   */
  public extract(
    frame: ImageFrameRGBA,
    cell: CellRegionBounds,
    refLum: number,
    hShelves: readonly NormalizedSegment[],
    isMiddleBand: boolean,
  ): CellFeatureVector {
    const { rgba, width: W, height: H } = frame;
    const x0 = Math.max(0, Math.min(W - 1, Math.round(cell.uStart * W)));
    const x1 = Math.max(x0 + 1, Math.min(W, Math.round(cell.uEnd * W)));
    const y0 = Math.max(0, Math.min(H - 1, Math.round((1 - cell.vEnd) * H)));
    const y1 = Math.max(y0 + 1, Math.min(H, Math.round((1 - cell.vStart) * H)));

    const bw = Math.max(1, x1 - x0);
    const bh = Math.max(1, y1 - y0);
    const ix0 = x0 + Math.round(bw * 0.1);
    const ix1 = Math.max(ix0 + 1, x1 - Math.round(bw * 0.1));
    const iy0 = y0 + Math.round(bh * 0.1);
    const iy1 = Math.max(iy0 + 1, y1 - Math.round(bh * 0.1));

    const cx0 = x0 + Math.round(bw * 0.28);
    const cx1 = x1 - Math.round(bw * 0.28);
    const cy0 = y0 + Math.round(bh * 0.22);
    const cy1 = y1 - Math.round(bh * 0.22);

    let sumL = 0;
    let sumL2 = 0;
    let sumC = 0;
    let brightW = 0;
    let dark = 0;
    let total = 0;
    let cSum = 0;
    let cCnt = 0;
    let bSum = 0;
    let bCnt = 0;

    for (let y = iy0; y < iy1; y += 2) {
      const ro = y * W;
      const inCY = y >= cy0 && y < cy1;
      for (let x = ix0; x < ix1; x += 2) {
        const p = (ro + x) * 4;
        const r = rgba[p];
        const g = rgba[p + 1];
        const b = rgba[p + 2];
        const l = 0.299 * r + 0.587 * g + 0.114 * b;
        const denom = r + g + b + 15;
        const c1 = (r - g) / denom;
        const c2 = (b - 0.5 * (r + g)) / denom;
        const ch = Math.hypot(c1, c2);

        sumL += l;
        sumL2 += l * l;
        sumC += ch;
        if (l > 235 && ch < 0.035) brightW++;
        if (l < 95) dark++;
        total++;

        if (inCY && x >= cx0 && x < cx1) {
          cSum += l;
          cCnt++;
        } else {
          bSum += l;
          bCnt++;
        }
      }
    }

    const meanLum = total > 0 ? sumL / total : refLum;
    const lumStd = total > 0 ? Math.sqrt(Math.max(0, sumL2 / total - meanLum * meanLum)) : 0;
    const meanChroma = total > 0 ? sumC / total : 0;
    const brightWhiteRatio = total > 0 ? brightW / total : 0;
    const darkRatio = total > 0 ? dark / total : 0;
    const centerLum = cCnt > 0 ? cSum / cCnt : meanLum;
    const borderLum = bCnt > 0 ? bSum / bCnt : meanLum;

    // Contar subdivisiones horizontales estrictamente interiores a esta celda
    const interiorShelves = hShelves.filter(
      (s) =>
        s.position > cell.vStart + 0.04 &&
        s.position < cell.vEnd - 0.04 &&
        s.start <= cell.uStart + 0.08 &&
        s.end >= cell.uEnd - 0.08,
    );

    const isDarkInterior = darkRatio > 0.32 || borderLum - centerLum > 18;
    const localSeamCount = isDarkInterior ? 0 : interiorShelves.length;
    const brightShelfCount = isDarkInterior ? interiorShelves.length : 0;

    const cellW = Math.max(0.04, cell.uEnd - cell.uStart);
    const cellH = Math.max(0.04, cell.vEnd - cell.vStart);

    return {
      meanLumRatio: Number((meanLum / Math.max(30, refLum)).toFixed(4)),
      lumStdNorm: Number(Math.min(2, lumStd / 80).toFixed(4)),
      meanChroma: Number(Math.min(3, meanChroma * 10).toFixed(4)),
      brightWhiteRatio: Number(brightWhiteRatio.toFixed(4)),
      darkRatio: Number(darkRatio.toFixed(4)),
      borderMinusCenterNorm: Number(Math.max(-2, Math.min(2, (borderLum - centerLum) / 60)).toFixed(4)),
      seamCountNorm: Number((Math.min(4, localSeamCount) / 4).toFixed(4)),
      brightShelfCountNorm: Number((Math.min(4, brightShelfCount) / 4).toFixed(4)),
      touchesBottom: cell.vStart <= 0.05 ? 1 : 0,
      isMiddleBand: isMiddleBand ? 1 : 0,
      carcassIsBright: refLum >= 200 ? 1 : 0,
      cellHeightNorm: Number(cellH.toFixed(4)),
      cellAspectWH: Number(Math.min(3.5, cellW / cellH).toFixed(4)),
    };
  }
}
