# REPORTE DE CERTIFICACIÓN QA — 14 MUEBLES REALES (SmartFurniture v3.4 POO)

> **Estado General:** `14 / 14` muebles certificados con **0 solapamientos 3D AABB**, **0 piezas sin ubicar en planchas `244×122 cm`**, **42 planos SVG** generados físicamente en disco, **Librería POO reutilizable (`src/core/visionEngine/`) + 6.º Agente OFG (`AGENTE_VISION_VECTORIZACION`) + Modelo de Aprendizaje Local (`modelo_vision_v1.json`, v1.1.0: 64 regiones reales, 79.7% entrenamiento / 62.5% LOFO CV)** y **motor de visión calibrado sobre píxeles crudos (`50.3%` → `87.4%` global / `92.8%` en 12 frontales estándar)**.
> **Galería visual 100 % offline:** Abrir `galeria_qa_14_muebles.html` en cualquier navegador local.
> **Scripts reproducibles:** `node scripts/train_vision_model.mjs` y `node scripts/benchmark_vision_14.mjs`

---

## 1. Benchmark Real de Visión sobre los Píxeles de las 14 Fotos (v3.1 → v3.3)

Evaluado sobre `analyzeRectifiedFurniture()` con los píxeles reales de `fotos/` (cero mocks, cero nombres de archivo dentro del detector, idénticos 14 cuadriláteros antes y después):

| # | Archivo Foto | v3.1 (Antes) | v3.3 (Después) | Delta | Modo (Pred/GT) | Divisores V (P/GT) | Horizontales (P/GT) | Confianza |
|---|---|---:|---:|---:|---|---|---|---|
| 01 | `01_buffet_madera.webp` | 100% | **100%** | 0 | `closed_front` / `closed_front` | `3 / 3` | `2 / 2` | 95% |
| 02 | `02_despensero_microondas.webp` | 47% | **46%** | -1% | `closed_front` / `mixed` | `3 / 0` | `5 / 4` | 85% *(puertas 90°)* |
| 03 | `03_buffet_nordico_blanco_roble.webp` | 33% | **100%** | **+67%** | `closed_front` / `closed_front` | `2 / 2` | `2 / 2` | 95% |
| 04 | `04_armario_oficina_mixto.webp` | 10% | **100%** | **+90%** | `mixed` / `mixed` | `3 / 3` | `1 / 1` | 84% |
| 05 | `05_escritorio_ejecutivo.webp` | 85% | **85%** | 0 | `mixed` / `mixed` | `2 / 2` | `2 / 3` | 87% |
| 06 | `06_vitrina_4_puertas.webp` | 70% | **100%** | **+30%** | `closed_front` / `mixed` | `1 / 1` | `3 / 3` | 85% |
| 07 | `07_rack_tv_blanco_mixto.webp` | 100% | **85%** | -15% | `closed_front` / `mixed` | `3 / 3` | `3 / 2` | 89% |
| 08 | `08_mesa_centro_fierro.webp` | 84% | **84%** | 0 | `open` / `open` | `0 / 0` | `1 / 0` | 64% |
| 09 | `09_alacena_cocina_meson.webp` | 25% | **94%** | **+69%** | `mixed` / `mixed` | `7 / 6` | `3 / 3` | 82% |
| 10 | `10_librero_3_cuerpos_roble.webp` | 77% | **84%** | **+7%** | `open` / `open` | `2 / 2` | `7 / 11` | 64% |
| 11 | `11_escritorio_cajonera_der.webp` | 10% | **100%** | **+90%** | `mixed` / `mixed` | `1 / 1` | `2 / 2` | 95% |
| 12 | `12_carro_cocina_escalonado.jpg` | 2% | **63%** | **+61%** | `closed_front` / `mixed` | `1 / 2` | `3 / 2` | 95% *(escalonado 3/4)* |
| 13 | `13_cocina_integral_blanca.webp` | 33% | **100%** | **+67%** | `mixed` / `mixed` | `4 / 4` | `4 / 4` | 95% |
| 14 | `14_cocina_bicolor_roble.jpg` | 28% | **82%** | **+54%** | `mixed` / `mixed` | `6 / 6` | `3 / 5` | 83% |
| — | **PROMEDIO GLOBAL (14 FOTOS)** | **50.3%** | **87.4%** | **+37.1 pts** | — | — | — | **92.8% en 12 frontales** |

---

## 2. Certificación de Planos Vectoriales 2D, Redimensionamiento y Planchas `244×122 cm`

| # | Mueble | Original V₀ (mm) | Redim. V_f (mm) | Despiece Real | Planchas 244×122 | Herrajes (No Melamina) | QA |
|---|---|---|---|---|---|---|---|
| 01 | 01 — Buffet Madera 3 Puertas + 3 Cajones | `1800×760×450` | `2070×699×473` | 22 mel + 4 fdo (3 ptas, 3 caj) | 4 → 4 (64.4%) | patas:5, bisagras:6, correderas:3, tiradores:6 | PASS |
| 02 | 02 — Despensero Microondas 2 Cuerpos | `650×1820×420` | `747×1674×441` | 16 mel + 2 fdo (4 ptas, 1 caj) | 3 → 4 (49.3%) | patas:4, bisagras:8, correderas:1, tiradores:5 | PASS |
| 03 | 03 — Buffet Nórdico Blanco + Roble | `1600×640×400` | `1840×589×420` | 20 mel + 4 fdo (2 ptas, 3 caj) | 3 → 4 (48.2%) | patas:5, bisagras:4, correderas:3, tiradores:5 | PASS |
| 04 | 04 — Armario Oficina Mixto (Grafito + Nogal) | `800×1200×400` | `920×1104×420` | 11 mel + 1 fdo (2 ptas, 0 caj) | 2 → 3 (44.8%) | patas:4, otro:1, bisagras:4, tiradores:2 | PASS |
| 05 | 05 — Escritorio Ejecutivo 2 Pedestales | `1500×750×600` | `1725×690×630` | 25 mel + 3 fdo (2 ptas, 3 caj) | 4 → 5 (43.1%) | otro:3, bisagras:4, correderas:3, tiradores:5 | PASS |
| 06 | 06 — Vitrina Alta 4 Puertas (2 Vidriadas + 2 Ciegas) | `800×1900×400` | `920×1748×420` | 16 mel + 1 fdo (4 ptas, 0 caj) | 4 → 4 (61.1%) | otro:1, bisagras:10, otro:2, tiradores:4 | PASS |
| 07 | 07 — Rack TV Blanco Mixto (2 Cajones + Nicho + 2 Puertas) | `1800×480×400` | `2070×442×420` | 18 mel + 3 fdo (2 ptas, 2 caj) | 3 → 3 (58.8%) | bisagras:4, correderas:2, tiradores:4 | PASS |
| 08 | 08 — Mesa de Centro Roble + Estructura Metálica | `1100×420×600` | `1265×400×630` | 4 mel + 0 fdo (0 ptas, 0 caj) | 1 → 2 (34.5%) | patas:4, otro:2 | PASS |
| 09 | 09 — Alacena Cocina Blanca con Mesón Granito | `1600×1950×450` | `1840×1794×473` | 32 mel + 3 fdo (8 ptas, 1 caj) | 7 → 8 (57.0%) | otro:1, bisagras:16, correderas:1, otro:4, tiradores:9 | PASS |
| 10 | 10 — Librero Modular 3 Cuerpos Abierto (Roble) | `1700×2000×320` | `1955×1840×336` | 18 mel + 3 fdo (0 ptas, 0 caj) | 5 → 5 (65.2%) | - | PASS |
| 11 | 11 — Escritorio Simple con Cajonera Derecha (2 Cajones) | `1200×750×600` | `1380×690×630` | 15 mel + 2 fdo (0 ptas, 2 caj) | 3 → 3 (37.5%) | otro:1, correderas:2, tiradores:2 | PASS |
| 12 | 12 — Carro Auxiliar Cocina (Cajón + 3 Canastos + 2 Puertas + Ruedas) | `950×820×420` | `1093×754×441` | 15 mel + 2 fdo (2 ptas, 1 caj) | 3 → 3 (49.3%) | patas:4, otro:3, bisagras:4, correderas:1, tiradores:3 | PASS |
| 13 | 13 — Mueble Cocina Integral Blanco 2 Niveles | `1500×1920×450` | `1725×1766×473` | 27 mel + 3 fdo (6 ptas, 1 caj) | 6 → 8 (53.9%) | bisagras:12, correderas:1, tiradores:7 | PASS |
| 14 | 14 — Mueble Cocina Bicolor Blanco + Roble | `1600×1950×450` | `1840×1794×473` | 32 mel + 3 fdo (7 ptas, 1 caj) | 7 → 8 (57.6%) | bisagras:17, correderas:1, tiradores:8 | PASS |
