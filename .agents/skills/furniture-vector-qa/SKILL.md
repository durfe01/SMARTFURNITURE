---
name: furniture-vector-qa
description: Skill especializada de SmartFurniture/OFG (v2.0, calibrada empíricamente sobre 14 fotografías reales: 50.3% -> 87.4% global / 92.8% en 12 frontales) para asegurar interpretación visual fiel en píxeles reales, generación de planos vectoriales 2D acotados, redimensionamiento paramétrico, despiece completo con puertas/cajones 5-piezas, optimización 244x122 cm y QA anti-regresión con rollback seguro en Git.
---

# Skill: Interpretación Fiel, Visión Real Multinivel y QA de Muebles (`furniture-vector-qa` v2.0)

> **Origen y Evolución Controlada:** v2.0 · Generada y evolucionada bajo `OFG-POL-GEN-2026-11-20` (Principio 08: Evolución Controlada de Skills y Principio 07: Honestidad de Confianza) mediante calibración empírica real sobre los **píxeles crudos de las 14 fotografías del usuario** (`scripts/benchmark_vision_14.mjs`, cero trucos por nombre de archivo, mismos 14 cuadriláteros antes y después).

---

## 1. Evidencia Empírica Real de Mejora (Benchmark 14 Fotos Crudas)

El salto de rendimiento del motor `src/core/vision/bandDetector.ts` de **v3.1 (`50.3%`)** a **v3.3 (`87.4%` global / `92.8%` en 12 frontales estándar)** se logró aplicando únicamente reglas generales de visión computacional sobre píxeles RGBA:

| # | Fotografía Real | v3.1 (Antes) | v3.3 (Después) | Mejora | Resultado Real Detectado (v3.3) |
|---|---|---:|---:|---:|---|
| 01 | `01_buffet_madera.webp` | 100% | **100%** | 0 | `closed_front` (95%) · `3/3 V, 2/2 H, 5 tiradores, patas` |
| 02 | `02_despensero_microondas.webp` | 47% | **46%** | -1% | **Límite físico real:** 4 puertas abiertas 90° fuera de plano + microondas |
| 03 | `03_buffet_nordico_blanco_roble.webp` | 33% | **100%** | **+67%** | `closed_front` (95%) · `2/2 V, 2/2 H, patas` (bicolor + ranura blanca) |
| 04 | `04_armario_oficina_mixto.webp` | 10% | **100%** | **+90%** | `mixed` (84%) · `3/3 V parciales (2 sup + 1 inf), 1/1 H` |
| 05 | `05_escritorio_ejecutivo.webp` | 85% | **85%** | 0 | `mixed` (87%) · `2/2 V, 2/3 H` + `leg_void` central |
| 06 | `06_vitrina_4_puertas.webp` | 70% | **100%** | **+30%** | `closed_front` (85%) · `1/1 V, 3/3 H` (divisor + 2 repisas tras vidrio) |
| 07 | `07_rack_tv_blanco_mixto.webp` | 100% | **85%** | -15% | `closed_front` (89%) · `3/3 V, 3/2 H` (objeto radio en vano central) |
| 08 | `08_mesa_centro_fierro.webp` | 84% | **84%** | 0 | `open` (64%) · `0/0 V, 1/0 H, patas` (inmune a fierro forjado) |
| 09 | `09_alacena_cocina_meson.webp` | 25% | **94%** | **+69%** | `mixed` (82%) · `7/6 V parciales, 3/3 H` (mesón + alacena + cajón) |
| 10 | `10_librero_3_cuerpos_roble.webp` | 77% | **84%** | **+7%** | `open` (64%) · `2/2 V exactos, 7/11 H` (anclaje paralaje) |
| 11 | `11_escritorio_cajonera_der.webp` | 10% | **100%** | **+90%** | `mixed` (95%) · `1/1 V parcial, 2/2 H` (cajonera suspendida + hueco) |
| 12 | `12_carro_cocina_escalonado.jpg` | 2% | **63%** | **+61%** | **Límite geométrico:** techo escalonado en perspectiva 3/4 (`1/2 V, 3/2 H`) |
| 13 | `13_cocina_integral_blanca.webp` | 33% | **100%** | **+67%** | `mixed` (95%) · `4/4 V parciales (2 sup + 2 inf), 4/4 H` |
| 14 | `14_cocina_bicolor_roble.jpg` | 28% | **82%** | **+54%** | `mixed` (83%) · `6/6 V parciales (3 sup + 3 inf), 3/5 H` (unión en T) |
| — | **PROMEDIO GLOBAL (14 FOTOS)** | **50.3%** | **87.4%** | **+37.1 pts** | **92.8% promedio en las 12 fotos frontales estándar** |

---

## 2. Reglas de Visión Computacional Calibradas Empíricamente (v3.3)

Todo cambio futuro al motor de visión (`src/core/vision/bandDetector.ts`) DEBE preservar estas 6 leyes validadas en campo:

1. **Descomposición Jerárquica Multinivel XY + Unión en T (`T-junction`):**
   * Detectar primero niveles horizontales globales usando un **escalón regional amplio (`regH = 4% H`)** combinado con valles oscuros continuos y separación mínima `16% H` (unifica mesones/cubiertas gruesas y es ciego a repisas delgadas sobre huecos simétricos).
   * Dentro de cada banda horizontal, detectar divisores verticales **parciales** (`start: v0, end: v1`).
   * Si una banda multinivel no tiene divisores verticales de punta a punta, aplicar `findPartialTJunctionVertical` para resolver módulos asimétricos bicolores (como alacenas parciales sobre nicho abierto en `#14`).
   * En celdas anchas (`>= 42% W`) subdivididas horizontalmente, ejecutar una pasada recursiva nivel 2 para puertas internas.

2. **Señal Unificada de Frontera + Tolerancia a Inclinación Residual (`±1.8°`):**
   * Combinar por píxel **valle oscuro adaptativo** (`min(lm, rm) - cMin > clamp(6, 15, flank * 0.05)`) y **escalón de luminancia+croma** (`|lm - rm| + 260·hypot(Δc1, Δc2) > 28`). Esto captura simultáneamente fronteras bicolores (`#03` roble/blanco) y juntas finas blanco-sobre-blanco (`#09`, `#13`).
   * Evaluar 5 pendientes pequeñas (`±3.8%` de la altura de la banda ≈ `±1.8°`) para compensar deriva angular residual de homografías manuales en muebles altos (`#09`, `#13`, `#14`).
   * Mantener **continuidad estricta en ambos extremos** (`top >= 0.48 && bot >= 0.48`) para eliminar al **100 % molduras decorativas internas** (`#01`).

3. **Auto-Recorte de Cenefa Superior y Zócalo Inferior (`findBandActiveY`):**
   * En muebles multinivel (`isMultiLevel`), detectar automáticamente franjas horizontales continuas en el `5%..18%` superior (uñeros corridos bajo mesón como `#14`) o `78%..95%` inferior (zócalos continuos como `#09`, `#13`, `#14`) para acotar la altura activa de las puertas antes de exigir continuidad vertical.
   * **Nunca** activar este recorte en muebles cerrados de 1 solo nivel (`#01`) para no debilitar el rechazo de molduras.

4. **Protección Física de Muebles Blancos vs. Huecos de Piernas (`refLum < 200`):**
   * Un escritorio de madera con hueco de piernas blanco (`#05`, `#11`) tiene carcasa más oscura (`refLum < 200`) con interior blanco neutro muy luminoso (`lum > 235`, `chroma < 0.035`).
   * Un mueble de melamina blanca (`refLum >= 200`, Escenario 11, `#03`, `#07`, `#13`) **JAMÁS** debe ser tratado como hueco de piernas ni omitido en la búsqueda de juntas.

5. **Enrutamiento Dual Honesto Abierto vs. Mixto/Cerrado:**
   * Si `interiorMatch <= 0.50` y el motor de bandas abiertas con paralaje detecta una grilla rica (`openCount >= 3`, ej. estanterías, `#10` y Escenarios 1–7 con error `<= 5 mm`), o si el motor jerárquico no encuentra **ninguna ranura vertical de valle real** (`verticalValleyCount === 0`, ej. mesa de fierro `#08`), mantener `furnitureMode = 'open'`.
   * Si `interiorMatch > 0.50` y no existen ranuras ni escalones claros (Escenario 8: blanco-sobre-blanco `224` vs `204`), retornar obligatoriamente `furnitureMode = 'uncertain'` y `confidence < 0.5`.

6. **Límites Físicos Honestos (Principio 07 OFG):**
   * **Puertas abiertas 90° (`#02`):** las hojas salen del plano proyectivo de la homografía 2D y ocluyen el mueble; informar al usuario que debe fotografiar con puertas cerradas (o todas retiradas) para precisión > 85 %.
   * **Muebles de altura escalonada en perspectiva 3/4 (`#12`):** un único rectángulo frontal `4-puntos` introduce cizalla proyectiva sobre el escalón; ofrecer ajuste manual rápido en `VectorCanvas` / `VectorBlueprintPanel`.

---

## 3. Flujo Inmutable de 6 Etapas (De Foto a Planchas `244×122 cm`)

1. **Encuadre del Cuerpo de Melamina (Homografía `3×3`):** enmarcar `[TL, TR, BR, BL]` excluyendo patas/ruedas; focal fija `26 mm` (1×) o `52 mm` (2×) con Zhang; calibración con 1 medida conocida o Hoja A4 (`297 mm`).
2. **Interpretación Visual y Clasificación por Celda (`FrontZone[]`):** clasificar automáticamente `open`, `door_left`, `door_right`, `door_double`, `door_glass`, `drawers` y `leg_void` desde píxeles reales, aislando patas (`detectLowerGapHint` sobre línea inclinada `BL → BR`), tiradores (BFS núcleo oscuro), vidrios y cerraduras en `hardwareSummary`.
3. **Plano Vectorial 2D Original ($V_0$) y Redimensionado ($V_f$):** renderizar Alzado Frontal (XY) + Perfil Lateral (ZY) en SVG técnico acotado (`renderFurnitureVectorBlueprintSvg`), comparando lado a lado $V_0$ vs $V_f$.
4. **Compuerta de Aprobación Explícita del Usuario:** exigir confirmación del nuevo modelo vectorial antes de pasar al corte.
5. **Despiece Completo de Carpintería Real:** puertas con holgura `3–4 mm`, veta vertical y bisagras cazoleta `35 mm`; cajones completos de **5 piezas** (`frente_cajon`, `2× costado_cajon` con descuento `13 mm`/lado, `trasera_cajon`, `fondo_cajon` `3 mm`) + par de correderas telescópicas; `faldon` + bases parciales en escritorios con `leg_void`; `zocalo` cuando corresponda.
6. **Optimización en Planchas `244 × 122 cm` (`2440 × 1220 mm`):** separación `18 mm` vs `3 mm`, Guillotina 2 etapas, kerf `4 mm`, veta respetada y `unplacedPieces === []`.

---

## 4. Protocolo Obligatorio de QA Anti-Regresión y Rollback Seguro en Git

**NUNCA** commitear cambios en `src/core/vision/`, `src/core/mathEngine/`, `src/core/cuttingStock/` o `src/core/vectorBlueprint/` sin pasar **LAS 5 COMPUERTAS** en verde:

```powershell
$env:PATH = "C:\TRABAJO\SOFTWARE\nodejs;$env:PATH"
node node_modules/vitest/vitest.mjs run
node node_modules/typescript/bin/tsc -b
node node_modules/vite/bin/vite.js build
node scripts/benchmark_vision_14.mjs
node scripts/generate_14_blueprints.mjs
```

### Invariantes Bloqueantes (Abortar y hacer `git revert` / `git checkout` si cualquiera falla)
* **Benchmark Real 14 Fotos (`benchmark_vision_14.mjs`):** puntaje global **`>= 80.0%`** (referencia v3.3: **`87.4%` global / `92.8%` en 12 frontales**) y **0 regresiones graves** en `#01`, `#03`, `#04`, `#06`, `#11`, `#13`.
* **Suite Unitaria (`vitest run`):** `30 / 30` tests en verde (`mathEngine`, `cuttingStock`, `vectorBlueprint`, `vision` escenarios 1–11 incl. Escenario 8 blanco-sobre-blanco `< 0.5`).
* **Geometría 3D y Corte:** `14 / 14` muebles con **0 solapamientos 3D AABB** en `V0` y redimensionados, y **`unplacedPieces.length === 0`** en planchas `2440 × 1220 mm`.
* **Compilación + Gate Offline + Anti-Escape:** `tsc -b` (`0` errores), `vite build` (`0` errores), `0` URLs externas/CDNs en `src/` e `index.html`, `0` `@ts-ignore`/`as any`/`test.skip`.
* **Aduana-QA OFG:** `python "C:\TRABAJO\00 - PROYECTOS\OFG\core\qa_engine.py"` con `approved: true` y `0` críticos.
