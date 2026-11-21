/**
 * SMARTFURNITURE / OFG — CLASE POO `VectorRenderer2D`
 * Encapsula el renderizado de planos vectoriales técnicos 2D en SVG (Alzado Frontal + Perfil Lateral + Cartela).
 */
import type {
  DespieceResult,
  FurnitureTopology,
  ScaleAndBoardParams,
} from '../../types/contracts';
import {
  renderFurnitureVectorBlueprintSvg,
  type BlueprintRenderOptions,
} from '../vectorBlueprint';
import type { IVectorRenderer } from './types';

export class VectorRenderer2D implements IVectorRenderer {
  public readonly format = 'svg' as const;

  public render(
    topology: FurnitureTopology,
    params: ScaleAndBoardParams,
    despiece: DespieceResult,
    opts: BlueprintRenderOptions = {},
  ): string {
    return renderFurnitureVectorBlueprintSvg(topology, params, despiece, opts);
  }

  /**
   * Genera en una sola llamada el par comparativo Original (V0) vs. Redimensionado (Vf).
   */
  public renderComparisonPair(
    topology: FurnitureTopology,
    originalParams: ScaleAndBoardParams,
    originalDespiece: DespieceResult,
    resizedParams: ScaleAndBoardParams,
    resizedDespiece: DespieceResult,
    opts: BlueprintRenderOptions = {},
  ): { originalSvg: string; resizedSvg: string } {
    const originalSvg = this.render(topology, originalParams, originalDespiece, {
      ...opts,
      stageLabel: 'MODELO VECTORIAL ORIGINAL (INTERPRETADO V₀)',
    });
    const resizedSvg = this.render(topology, resizedParams, resizedDespiece, {
      ...opts,
      stageLabel: 'NUEVO MODELO VECTORIAL REDIMENSIONADO (V_f)',
    });
    return { originalSvg, resizedSvg };
  }
}
