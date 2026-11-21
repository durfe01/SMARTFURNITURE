/**
 * Exportadores 100% offline y sin dependencias externas:
 * 1. CSV con BOM UTF-8 (`\uFEFF`) y delimitador `;` por defecto para Excel Chile.
 * 2. Excel `.xls` nativo multi-hoja (SpreadsheetML XML 2003) con 3 hojas reales:
 *    - `Despiece_Melamina`
 *    - `Herrajes_y_Patas`
 *    - `Resumen_U3_y_Planchas`
 */
import type {
  CuttingPlanResult,
  DespieceResult,
  EdgeBandingFlags,
  ScaleAndBoardParams,
} from '../../types/contracts';

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeCsvCell(value: string | number, delimiter: string): string {
  const s = String(value);
  if (s.includes(delimiter) || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function formatEdges(edges: EdgeBandingFlags): string {
  const active: string[] = [];
  if (edges.top) active.push('L1(Frente)');
  if (edges.bottom) active.push('L2');
  if (edges.left) active.push('A1');
  if (edges.right) active.push('A2');
  return active.length > 0 ? active.join('+') : 'Sin tapacanto';
}

export function generateDespieceCsv(
  despiece: DespieceResult,
  delimiter: ';' | ',' = ';',
): string {
  const lines: string[] = [];
  const header = [
    'ID',
    'Pieza',
    'Tipo',
    'Ancho_Veta_mm',
    'Alto_Prof_mm',
    'Espesor_mm',
    'Cantidad',
    'Material',
    'Respeta_Veta',
    'Tapacantos',
  ];
  lines.push(header.join(delimiter));

  for (const p of despiece.matrizDespiece) {
    lines.push(
      [
        p.id,
        p.nombre,
        p.tipo,
        p.ancho.toFixed(2),
        p.alto.toFixed(2),
        p.espesor.toFixed(1),
        p.cantidad,
        p.material,
        p.respectGrain ? 'SI' : 'NO',
        formatEdges(p.edges),
      ]
        .map((v) => escapeCsvCell(v, delimiter))
        .join(delimiter),
    );
  }

  lines.push('');
  lines.push('HERRAJES Y ACCESORIOS (NO MELAMINA)');
  lines.push(['Categoria', 'Descripcion', 'Cantidad', 'Medida_Ref_mm', 'Nota_Compra'].join(delimiter));

  for (const hw of despiece.hardwareSummary) {
    lines.push(
      [
        hw.categoria,
        hw.descripcion,
        hw.cantidad,
        hw.medidaReferenciaMm ?? '',
        hw.notaCompra,
      ]
        .map((v) => escapeCsvCell(v, delimiter))
        .join(delimiter),
    );
  }

  lines.push(
    [
      'tapacanto',
      'Tapacanto melamina total estimado',
      despiece.totalEdgeBandingMeters.toFixed(2),
      'metros',
      'Metros lineales totales según modalidad de cantos',
    ]
      .map((v) => escapeCsvCell(v, delimiter))
      .join(delimiter),
  );

  return '\uFEFF' + lines.join('\r\n');
}

function xmlRow(cells: ReadonlyArray<{ type: 'String' | 'Number'; value: string | number; style?: string }>): string {
  const tds = cells
    .map((c) => {
      const styleAttr = c.style ? ` ss:StyleID="${c.style}"` : '';
      const val = c.type === 'Number' ? String(c.value) : escapeXml(String(c.value));
      return `<Cell${styleAttr}><Data ss:Type="${c.type}">${val}</Data></Cell>`;
    })
    .join('');
  return `      <Row>${tds}</Row>`;
}

/**
 * Genera libro Excel `.xls` válido (SpreadsheetML XML 2003) 100% offline con 3 hojas.
 */
export function generateExcelSpreadsheetML(
  despiece: DespieceResult,
  cuttingPlan: CuttingPlanResult,
  params: ScaleAndBoardParams,
): string {
  // Hoja 1: Despiece_Melamina
  const h1Rows: string[] = [
    xmlRow([
      { type: 'String', value: 'ID', style: 'hdr' },
      { type: 'String', value: 'Pieza', style: 'hdr' },
      { type: 'String', value: 'Tipo', style: 'hdr' },
      { type: 'String', value: 'Ancho (Eje Veta mm)', style: 'hdr' },
      { type: 'String', value: 'Alto (Perp. Veta mm)', style: 'hdr' },
      { type: 'String', value: 'Espesor (mm)', style: 'hdr' },
      { type: 'String', value: 'Cantidad', style: 'hdr' },
      { type: 'String', value: 'Material', style: 'hdr' },
      { type: 'String', value: 'Veta', style: 'hdr' },
      { type: 'String', value: 'Tapacantos', style: 'hdr' },
    ]),
  ];
  for (const p of despiece.matrizDespiece) {
    h1Rows.push(
      xmlRow([
        { type: 'String', value: p.id },
        { type: 'String', value: p.nombre },
        { type: 'String', value: p.tipo },
        { type: 'Number', value: Number(p.ancho.toFixed(2)) },
        { type: 'Number', value: Number(p.alto.toFixed(2)) },
        { type: 'Number', value: p.espesor },
        { type: 'Number', value: p.cantidad },
        { type: 'String', value: p.material },
        { type: 'String', value: p.respectGrain ? 'SI' : 'NO' },
        { type: 'String', value: formatEdges(p.edges) },
      ]),
    );
  }

  // Hoja 2: Herrajes_y_Patas
  const h2Rows: string[] = [
    xmlRow([
      { type: 'String', value: 'Categoría', style: 'hdr' },
      { type: 'String', value: 'Descripción', style: 'hdr' },
      { type: 'String', value: 'Cantidad', style: 'hdr' },
      { type: 'String', value: 'Medida Ref. (mm)', style: 'hdr' },
      { type: 'String', value: 'Origen', style: 'hdr' },
      { type: 'String', value: 'Nota de Compra (No Melamina)', style: 'hdr' },
    ]),
  ];
  for (const hw of despiece.hardwareSummary) {
    h2Rows.push(
      xmlRow([
        { type: 'String', value: hw.categoria },
        { type: 'String', value: hw.descripcion },
        { type: 'Number', value: hw.cantidad },
        { type: 'String', value: hw.medidaReferenciaMm !== undefined ? String(hw.medidaReferenciaMm) : '-' },
        { type: 'String', value: hw.origen },
        { type: 'String', value: hw.notaCompra },
      ]),
    );
  }
  h2Rows.push(
    xmlRow([
      { type: 'String', value: 'tapacanto' },
      { type: 'String', value: `Tapacanto PVC/Melamina (${params.edgeBandingMode})` },
      { type: 'Number', value: Number(despiece.totalEdgeBandingMeters.toFixed(2)) },
      { type: 'String', value: 'metros lineales' },
      { type: 'String', value: 'calculado' },
      { type: 'String', value: 'Agregar 10% holgura de corte en compra' },
    ]),
  );

  // Hoja 3: Resumen_U3_y_Planchas
  const h3Rows: string[] = [
    xmlRow([
      { type: 'String', value: 'Parámetro / Métrica', style: 'hdr' },
      { type: 'String', value: 'Valor', style: 'hdr' },
      { type: 'String', value: 'Unidad / Detalle', style: 'hdr' },
    ]),
    xmlRow([
      { type: 'String', value: 'Vector Referencia V0' },
      { type: 'String', value: `(${params.referenceDimensions.x}, ${params.referenceDimensions.y}, ${params.referenceDimensions.z})` },
      { type: 'String', value: 'mm' },
    ]),
    xmlRow([
      { type: 'String', value: 'Vector Objetivo Vf (cuerpo melamina)' },
      { type: 'String', value: `(${params.targetDimensions.x}, ${params.targetDimensions.y}, ${params.targetDimensions.z})` },
      { type: 'String', value: 'mm' },
    ]),
    xmlRow([
      { type: 'String', value: 'Factores Escalamiento (kx, ky, kz)' },
      { type: 'String', value: `(${despiece.scaleFactors.kx.toFixed(3)}, ${despiece.scaleFactors.ky.toFixed(3)}, ${despiece.scaleFactors.kz.toFixed(3)})` },
      { type: 'String', value: `Espesor invariante e = ${params.boardThickness} mm` },
    ]),
    xmlRow([
      { type: 'String', value: 'Área Neta Total' },
      { type: 'Number', value: Number(despiece.totalNetAreaM2.toFixed(4)) },
      { type: 'String', value: 'm²' },
    ]),
    xmlRow([
      { type: 'String', value: 'Planchas Melamina 18 mm' },
      { type: 'Number', value: cuttingPlan.melamineSheetsCount },
      { type: 'String', value: `${params.sheetDimensions.width}×${params.sheetDimensions.height} mm` },
    ]),
    xmlRow([
      { type: 'String', value: 'Planchas Fondo 3 mm' },
      { type: 'Number', value: cuttingPlan.backPanelSheetsCount },
      {
        type: 'String',
        value: `${(params.backPanelSheetDimensions ?? params.sheetDimensions).width}×${(params.backPanelSheetDimensions ?? params.sheetDimensions).height} mm`,
      },
    ]),
    xmlRow([
      { type: 'String', value: 'Aprovechamiento Global (Ponderado)' },
      { type: 'Number', value: cuttingPlan.usagePercentage },
      { type: 'String', value: `% (Desperdicio: ${cuttingPlan.wastePercentage}%)` },
    ]),
    xmlRow([
      { type: 'String', value: 'Alertas Estructurales' },
      { type: 'Number', value: despiece.alerts.length },
      { type: 'String', value: despiece.alerts.map((a) => a.mensaje).join(' | ') || 'Sin alertas' },
    ]),
  ];

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<?mso-application progid="Excel.Sheet"?>',
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"',
    '  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">',
    '  <Styles>',
    '    <Style ss:ID="hdr">',
    '      <Font ss:Bold="1" ss:Color="#FFFFFF"/>',
    '      <Interior ss:Color="#0F2B4C" ss:Pattern="Solid"/>',
    '    </Style>',
    '  </Styles>',
    '  <Worksheet ss:Name="Despiece_Melamina">',
    '    <Table>',
    ...h1Rows,
    '    </Table>',
    '  </Worksheet>',
    '  <Worksheet ss:Name="Herrajes_y_Patas">',
    '    <Table>',
    ...h2Rows,
    '    </Table>',
    '  </Worksheet>',
    '  <Worksheet ss:Name="Resumen_U3_y_Planchas">',
    '    <Table>',
    ...h3Rows,
    '    </Table>',
    '  </Worksheet>',
    '</Workbook>',
  ].join('\n');
}
