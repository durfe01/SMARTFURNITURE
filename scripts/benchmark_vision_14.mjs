/**
 * BENCHMARK REAL DE VISIÓN SOBRE LAS 14 FOTOGRAFÍAS DEL USUARIO (SmartFurniture v3.3)
 * Mide objetivamente qué detecta `analyzeRectifiedFurniture()` sobre los PÍXELES REALES
 * de las 14 fotos archivadas en `docs/evidencia/catalogo_14_muebles/fotos/`
 * (cero trucos, cero nombres de archivo dentro del detector, 100 % reproducible).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FOTOS_DIR = path.join(ROOT, 'docs', 'evidencia', 'catalogo_14_muebles', 'fotos');
const DEFAULT_CACHE = 'C:/Users/durfe/.gemini/antigravity/brain/b892f276-185f-4d21-a216-8b61df576f31/scratch/raw14';
const RAW_DIR = fs.existsSync(path.join(DEFAULT_CACHE, 'meta.json'))
  ? DEFAULT_CACHE
  : path.join(os.tmpdir(), 'smartfurniture_raw14_cache');

// Coordenadas [TL, TR, BR, BL] del cuerpo de melamina en fracciones [0..1] + verdad terreno de conteo estructural
export const BENCHMARK_CASES = [
  {
    id: '01', file: '01_buffet_madera.webp', dims: { x: 1800, y: 760 },
    quadN: [[0.158, 0.382], [0.895, 0.352], [0.900, 0.662], [0.158, 0.742]],
    gt: { mode: 'closed_front', vDivs: 3, hLines: 2, hasLegs: true },
  },
  {
    id: '02', file: '02_despensero_microondas.webp', dims: { x: 650, y: 1820 },
    quadN: [[0.33, 0.02], [0.58, 0.04], [0.62, 0.87], [0.37, 0.92]],
    gt: { mode: 'mixed', vDivs: 0, hLines: 4, hasLegs: true },
  },
  {
    id: '03', file: '03_buffet_nordico_blanco_roble.webp', dims: { x: 1600, y: 640 },
    quadN: [[0.098, 0.255], [0.985, 0.195], [0.975, 0.555], [0.118, 0.692]],
    gt: { mode: 'closed_front', vDivs: 2, hLines: 2, hasLegs: true },
  },
  {
    id: '04', file: '04_armario_oficina_mixto.webp', dims: { x: 800, y: 1200 },
    quadN: [[0.192, 0.105], [0.935, 0.082], [0.935, 0.840], [0.192, 0.905]],
    gt: { mode: 'mixed', vDivs: 3, hLines: 1, hasLegs: true },
  },
  {
    id: '05', file: '05_escritorio_ejecutivo.webp', dims: { x: 1500, y: 750 },
    quadN: [[0.052, 0.118], [0.990, 0.088], [0.990, 0.855], [0.052, 0.945]],
    gt: { mode: 'mixed', vDivs: 2, hLines: 3, hasLegs: false },
  },
  {
    id: '06', file: '06_vitrina_4_puertas.webp', dims: { x: 800, y: 1900 },
    quadN: [[0.015, 0.015], [0.985, 0.015], [0.985, 0.955], [0.015, 0.955]],
    gt: { mode: 'mixed', vDivs: 1, hLines: 3, hasLegs: false },
  },
  {
    id: '07', file: '07_rack_tv_blanco_mixto.webp', dims: { x: 1800, y: 480 },
    quadN: [[0.072, 0.608], [0.928, 0.608], [0.928, 0.785], [0.072, 0.785]],
    gt: { mode: 'mixed', vDivs: 3, hLines: 2, hasLegs: false },
  },
  {
    id: '08', file: '08_mesa_centro_fierro.webp', dims: { x: 1100, y: 420 },
    quadN: [[0.270, 0.600], [0.880, 0.435], [0.865, 0.665], [0.275, 0.875]],
    gt: { mode: 'open', vDivs: 0, hLines: 0, hasLegs: true },
  },
  {
    id: '09', file: '09_alacena_cocina_meson.webp', dims: { x: 1600, y: 1950 },
    quadN: [[0.010, 0.045], [0.955, 0.010], [0.910, 0.960], [0.105, 0.815]],
    gt: { mode: 'mixed', vDivs: 6, hLines: 3, hasLegs: false },
  },
  {
    id: '10', file: '10_librero_3_cuerpos_roble.webp', dims: { x: 1700, y: 2000 },
    quadN: [[0.205, 0.165], [0.770, 0.228], [0.770, 0.768], [0.205, 0.830]],
    gt: { mode: 'open', vDivs: 2, hLines: 11, hasLegs: false },
  },
  {
    id: '11', file: '11_escritorio_cajonera_der.webp', dims: { x: 1200, y: 750 },
    quadN: [[0.032, 0.236], [0.968, 0.236], [0.968, 0.850], [0.032, 0.850]],
    gt: { mode: 'mixed', vDivs: 1, hLines: 2, hasLegs: false },
  },
  {
    id: '12', file: '12_carro_cocina_escalonado.jpg', dims: { x: 950, y: 820 },
    quadN: [[0.200, 0.180], [0.835, 0.365], [0.835, 0.805], [0.200, 0.920]],
    gt: { mode: 'mixed', vDivs: 2, hLines: 2, hasLegs: true },
  },
  {
    id: '13', file: '13_cocina_integral_blanca.webp', dims: { x: 1500, y: 1920 },
    quadN: [[0.182, 0.012], [0.865, 0.014], [0.892, 0.935], [0.212, 0.985]],
    gt: { mode: 'mixed', vDivs: 4, hLines: 4, hasLegs: false },
  },
  {
    id: '14', file: '14_cocina_bicolor_roble.jpg', dims: { x: 1600, y: 1950 },
    quadN: [[0.262, 0.140], [0.748, 0.155], [0.776, 0.785], [0.278, 0.852]],
    gt: { mode: 'mixed', vDivs: 6, hLines: 5, hasLegs: false },
  },
];

function ensureRawCache() {
  if (fs.existsSync(path.join(RAW_DIR, 'meta.json'))) return;
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const py = [
    'import json, os, sys',
    'from PIL import Image',
    'src, dst = sys.argv[1], sys.argv[2]',
    'meta = {}',
    'for fn in sorted(os.listdir(src)):',
    '    if not fn.lower().endswith((".webp", ".jpg", ".jpeg", ".png")): continue',
    '    im = Image.open(os.path.join(src, fn)).convert("RGBA")',
    '    meta[fn] = [im.width, im.height]',
    '    open(os.path.join(dst, fn + ".raw"), "wb").write(im.tobytes())',
    'open(os.path.join(dst, "meta.json"), "w").write(json.dumps(meta))',
  ].join('\n');
  execFileSync('python', ['-c', py, FOTOS_DIR, RAW_DIR], { stdio: 'inherit' });
}

function scoreCount(pred, gt) {
  if (gt === 0) return pred === 0 ? 1 : Math.max(0, 1 - pred * 0.35);
  return Math.max(0, 1 - Math.abs(pred - gt) / Math.max(gt, pred));
}

ensureRawCache();
const meta = JSON.parse(fs.readFileSync(path.join(RAW_DIR, 'meta.json'), 'utf-8'));

const srv = await createServer({
  root: ROOT,
  server: { middlewareMode: true },
  appType: 'custom',
});

try {
  const homM = await srv.ssrLoadModule('/src/core/mathEngine/homography.ts');
  const visM = await srv.ssrLoadModule('/src/core/vision/index.ts');

  let sumScore = 0;
  let sumStandard12 = 0;
  console.log('| # | Archivo | Mode (Pred/GT) | Conf | vDiv (P/GT) | hLine (P/GT) | Handles | Legs | Score |');
  console.log('|---|---|---|---|---|---|---|---|---|');

  for (const c of BENCHMARK_CASES) {
    const [srcW, srcH] = meta[c.file];
    const buf = fs.readFileSync(path.join(RAW_DIR, c.file + '.raw'));
    const srcRgba = new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.byteLength);
    const quad = c.quadN.map(([nx, ny]) => ({ x: nx * srcW, y: ny * srcH }));
    const hom = homM.computeQuadToUnitHomography(quad);
    const sz = visM.computeRectifiedSize(c.dims.x, c.dims.y, 18);
    const rect = visM.rectifyImageRGBA(srcRgba, srcW, srcH, hom.toCanvas, sz.width, sz.height);
    const det = visM.analyzeRectifiedFurniture(rect, sz.width, sz.height, c.dims, 18);
    const legs = visM.detectLowerGapHint(srcRgba, srcW, srcH, quad);

    const sV = scoreCount(det.vDividers.length, c.gt.vDivs);
    const sH = scoreCount(det.hShelves.length, c.gt.hLines);
    const sConf = det.confidence >= 0.5 ? 1 : 0.2;
    const score = Math.round((0.45 * sV + 0.45 * sH + 0.10 * sConf) * 100);
    sumScore += score;
    if (c.id !== '02' && c.id !== '12') sumStandard12 += score;

    console.log(
      `| ${c.id} | ${c.file.slice(0, 24)} | ${det.furnitureMode}/${c.gt.mode} | ${Math.round(det.confidence * 100)}% | ${det.vDividers.length}/${c.gt.vDivs} | ${det.hShelves.length}/${c.gt.hLines} | ${det.detectedHandles.length} | ${legs.possibleExternalLegs} | ${score}% |`,
    );
  }

  const globalPct = sumScore / BENCHMARK_CASES.length;
  const std12Pct = sumStandard12 / 12;
  console.log(`\nPUNTAJE GLOBAL REAL (14 FOTOS CRUDAS): ${globalPct.toFixed(1)}%`);
  console.log(`PUNTAJE 12 MUEBLES FRONTALES ESTANDAR (excl. #02 puertas 90° y #12 escalonado 3/4): ${std12Pct.toFixed(1)}%`);
  if (globalPct < 80) {
    console.error(`FAIL QA GATE: puntaje global ${globalPct.toFixed(1)}% < 80%`);
    process.exitCode = 1;
  }
} finally {
  await srv.close();
}
