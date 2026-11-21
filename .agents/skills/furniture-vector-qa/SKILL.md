---
name: furniture-vector-qa
description: Skill especializada de SmartFurniture/OFG para asegurar la interpretación fiel de fotografías reales de muebles (abiertos, cerrados con puertas/cajones, mixtos, escritorios, dos niveles y con herrajes externos), generar planos vectoriales 2D acotados, validar redimensionamiento paramétrico y auditar despiece + optimización 244x122 cm con compuertas QA y rollback seguro en Git.
---

# Skill: Interpretación Fiel, Planos Vectoriales y QA de Muebles (`furniture-vector-qa`)

> **Origen y Versión:** v1.0 · Generada bajo `OFG-POL-GEN-2026-11-20` (Principio 08: Evolución Controlada de Skills) tras calibración real sobre el dataset de **14 muebles reales** (`docs/evidencia/catalogo_14_muebles/`).

## 1. Flujo Inmutable de 6 Etapas (De Foto a Planchas `244×122 cm`)

Toda interpretación y redimensionamiento de un mueble DEBE respetar estrictamente estas 6 etapas sin saltarse ninguna:

1. **Encuadre del Cuerpo de Melamina (Homografía `3×3`):**
   * Enmarcar con `[TL, TR, BR, BL]` **EXCLUSIVAMENTE el cuerpo de melamina** (excluyendo paredes, decoración superior y **patas/ruedas/marcos metálicos externos**).
   * Estimar `aspectRatioXY` con fórmula vectorial de Zhang con **focal fija (`26 mm` en 1× o `52 mm` en 2×)** — nunca estimar `f` libre.
   * Calibrar escala real confirmando **1 sola medida conocida del cuerpo** (`extrapolateDimensionsFromSingleMeasure`) o un segmento de referencia (**Hoja A4 = 297 mm**).

2. **Clasificación Tipológica Fiel (6 Familias Reales Validadas):**
   Antes de generar vectores, clasificar el mueble según su estructura física real:
   * **A) Mueble Abierto (`open`, ej. Librero #10):** `interiorMatch <= 0.50`. Detectar cantos de melamina sobre huecos con luminancia *flat-field* + crominancia RGBA + anclaje unilateral consciente de paralaje.
   * **B) Mueble Cerrado (`closed_front`, ej. Buffets #01 y #03):** `interiorMatch > 0.50` con ranuras oscuras continuas. Usar detector de valles exigiendo **continuidad en ambos extremos (`r_top > 0.55 && r_bot > 0.55` en verticales; `r_left > 0.55 && r_right > 0.55` en horizontales)** para eliminar al **100 % falsos positivos en molduras decorativas de puertas**.
   * **C) Mueble Mixto (`mixto`, ej. Armario #04, Rack TV #07, Carro #12):** combinar zonas `open` con `door_*` y `drawers` usando `FrontZone[]` con coordenadas interiores `[uStart, uEnd] × [vStart, vEnd]`.
   * **D) Escritorio con Hueco de Piernas (`escritorio`, ej. #05 y #11):** marcar el hueco libre inferior como `kind: 'leg_void'`; prohibido generar base corrida que bloquee las piernas; sustituir por bases parciales en pedestales + `faldon` trasero estructural.
   * **E) Mueble de Dos Niveles / Cocina (`dos_niveles`, ej. #02, #06, #09, #13, #14):** separar horizontalmente cuerpo inferior, nicho/mesón central abierto y alacena/vitrina superior (`door_glass` registra vidrios 4 mm como insumo externo).
   * **F) Estructura Mixta Melamina + Metal (`mesa_metal`, ej. #08):** calcular únicamente los tableros de melamina y registrar la estructura lateral de fierro/ruedas/canastos como `hardwareItems` externos.

3. **Aislamiento Estricto de Accesorios No-Melamina:**
   * **Patas / Ruedas:** detectadas siguiendo la **línea inclinada `BL → BR`** (`detectLowerGapHint`), jamás sumadas a `targetDimensions.y`. Se notifican en `hardwareSummary` para compra aparte.
   * **Tiradores / Cerraduras / Vidrios / Canastos / Mesón Granito:** detectados por umbral de núcleo metálico oscuro (descartando nudos cálidos de madera) o declarados por zona, siempre fuera de la matriz de melamina.

4. **Generación del Plano Vectorial 2D Original ($V_0$) y Redimensionado ($V_f$):**
   * Renderizar siempre **Alzado Frontal (XY) + Perfil Lateral (ZY)** en SVG técnico acotado (`renderFurnitureVectorBlueprintSvg`), diferenciando visualmente melamina `18 mm`, fondo `3 mm`, apertura de puertas, cajones (`5 pzas/cajón`), vidrios y herrajes externos.
   * Al modificar `V_f`, regenerar en vivo el **Nuevo Plano Vectorial Redimensionado** y exigir **aprobación explícita del usuario** antes de pasar a corte.

5. **Despiece Completo de Carpintería Real (Cero Simulación):**
   * **Puertas:** holgura perimetral `3–4 mm`, veta vertical (`ancho = alto_puerta`), tapacanto 4 cantos, y cálculo automático de **bisagras cazoleta 35 mm** (`2` por hoja, `3` si alto `> 900 mm`).
   * **Cajones (5 piezas obligatorias por cada cajón):**
     1. `frente_cajon` (`18 mm`, veta horizontal, 4 cantos tapacanto).
     2. `2 × costado_cajon` (`18 mm`, largo `min(z_f - 50, 450) mm`, descuento de `13 mm` por lado para corredera telescópica).
     3. `trasera_cajon` (`18 mm`, encajada entre ambos costados: `boxOuterW - 2e`).
     4. `fondo_cajon` (`3 mm` Durolac/MDF sin veta ni tapacanto).
     * Más **1 par de correderas telescópicas** por cajón en `hardwareSummary`.

6. **Optimización en Planchas `244 × 122 cm` (`2440 × 1220 mm`):**
   * Separación estricta de espesores (`18 mm` vs `3 mm`), estrategia Guillotina 2 etapas por defecto, kerf virtual-pad exacto (`4 mm`), orientación vertical de veta en laterales/divisores/puertas, promedio ponderado por área y `unplacedPieces === []`.

---

## 2. Protocolo Obligatorio de QA Anti-Regresión y Rollback Seguro en Git

**NUNCA** modificar `bandDetector.ts`, `mathEngine/index.ts`, `optimizer.ts` o `vectorBlueprint/index.ts` sin ejecutar este protocolo completo:

1. **Checkpoint antes de experimentar:** confirmar estado limpio en Git (`git status`) para poder revertir instantáneamente con `git revert` / `git checkout` si algún cambio degrada una métrica.
2. **Suite de Regresión Obligatoria (4 Compuertas):**
   ```powershell
   node node_modules/vitest/vitest.mjs run
   node node_modules/typescript/bin/tsc -b
   node node_modules/vite/bin/vite.js build
   node scripts/generate_14_blueprints.mjs
   ```
3. **Invariantes Innegociables que Bloquean el Commit si Fallan:**
   * `14 / 14` muebles del catálogo QA (`vectorBlueprint.test.ts`) con **0 solapamientos 3D AABB** tanto en `V0` como redimensionados (`+15% X, -8% Y, +5% Z`).
   * `unplacedPieces.length === 0` en planchas `2440 × 1220 mm` para los 14 muebles.
   * `0` regresiones en los 9 escenarios sintéticos + foto real de `vision.test.ts` (incluyendo blanco-sobre-blanco con `confidence < 0.5`).
   * `Gate Offline`: `0` URLs externas o CDNs en `src/` e `index.html`.
   * `Gate Anti-Escape`: `0` instancias de `@ts-ignore`, `as any` o `test.skip`.
4. **Política de Commits Incrementales (Vuelta Atrás Segura):**
   * Un commit atómico y pusheado a GitHub por cada bloque certificado (`mathEngine` &rarr; `vectorBlueprint` &rarr; `UI workflow` &rarr; `skills/docs`). Si un cambio posterior empeora la detección o rompe cualquiera de los 14 muebles, revertir inmediatamente al último commit verde.
