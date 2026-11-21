# SmartFurniture — Especificación Técnica y Plan de Ejecución (v2.1 Rev. 2)

> Documento maestro de alineación del equipo y especificación modular lista para implementación.
> **Sincronización (20 nov 2026 — v2.1 Rev. 2):** 100 % alineado con [`docs/ANALISIS_TECNICO_v2.1.md`](./docs/ANALISIS_TECNICO_v2.1.md), [`docs/RESUMEN_PARA_EL_EQUIPO.md`](./docs/RESUMEN_PARA_EL_EQUIPO.md), [`Auditoria y Prompts.txt`](./Auditoria%20y%20Prompts.txt) y las 6 skills en [`.agents/skills/`](./.agents/skills/). Mantiene cumplimiento íntegro de los requisitos académicos de INACAP Etapa 2 y Etapa 3.

---

## 1. Encabezado y Ficha del Proyecto

El presente documento establece la arquitectura del sistema, la formulación matemática corregida y el plan de implementación guiado para el prototipo interactivo de **SmartFurniture**. Sirve como referencia técnica compartida para el desarrollo, validación y grabación del video explicativo.

| Campo | Detalle Operativo |
|---|---|
| **Proyecto** | SmartFurniture (Diseño, análisis desde foto, escalamiento y optimización de cortes para muebles en melamina) |
| **Asignatura / Unidad** | Funciones y Matrices — Unidad 3 (Sucesiones, Sumatorias, Vectores y Matrices), INACAP |
| **Docente** | Marco Antonio Troncoso Soto |
| **Integrantes** | Fernando A. Durán Leiva · Cristopher D. Figueroa Arthur · Francisco A. Lara Yevenes · Génesis T. Sepúlveda Muñoz |
| **Entregable Etapa 3** | Prototipo web local + Video explicativo de funcionamiento y respaldo matemático |
| **Fecha Límite Objetivo** | **1 de diciembre de 2026** (Prototipo listo: 28 nov · Grabación y edición de video: 29–30 nov) |
| **Restricción Clave (Etapa 2)** | Ejecución **100 % local en navegador**, sin APIs, CDNs de fuentes/HDRI ni motores externos en tiempo de ejecución. |

---

## 2. Visión Concreta del Prototipo Web

El prototipo se construye como una Web App **100 % cliente** (SPA) con **React `18.3.1`, TypeScript `~5.8.3` y Vite `6.3.5`**. La renderización 3D se realiza con **Three.js `0.162.0`** a través de **`@react-three/fiber@8.18.0`** y **`@react-three/drei@9.122.0`** (versiones verificadas offline en [`docs/evidencia/toolchain-spike/`](./docs/evidencia/toolchain-spike/)), usando únicamente iluminación nativa y texturas procedurales (`THREE.CanvasTexture`).

Todo el procesamiento —rectificación de perspectiva por homografía $3\times 3$, visión clásica offline para asistencia de estructura (`src/core/vision/`), transformaciones matriciales, progresiones aritméticas y empaquetado 2D (*Cutting Stock*)— se ejecuta localmente en el navegador.

El núcleo del sistema es un **motor paramétrico unificado de paneles rectangulares de melamina**: cualquier mueble abierto recto (estantería, rack de TV, velador, módulo de cocina o clóset) se modela como una caja exterior, divisiones internas continuas y repisas horizontales (con soporte de vanos mixtos) más un fondo opcional de Durolac/MDF de 3 mm.

---

## 3. Flujo Funcional del Usuario (Paso a Paso)

La aplicación ofrece un flujo de **4 pasos secuenciales** más acceso instantáneo a **3 Presets oficiales** de demostración:

### Paso 1 — Carga de referencia (1 vista frontal + vista lateral ZY opcional)
- **Vista Frontal (Obligatoria, plano XY):** carga local (`URL.createObjectURL` con limpieza `revokeObjectURL`) de una foto o croquis del mueble, siguiendo el protocolo en pantalla (mueble abierto, cámara centrada a media altura, `≥ 3 m`, zoom `1×–2×`, nunca `0,5×`, sin recortar). Incluye un generador local de croquis procedural de muestra (con perspectiva leve y hoja A4 de referencia).
- **Vista Lateral (Opcional, pestaña plano ZY):** carga opcional de una foto lateral para calcular la relación Profundidad/Alto (`aspectRatioZY`), complementada con **presets rápidos de profundidad** por tipología (estantería `320 mm`, rack `400 mm`, módulo `500 mm`, clóset `550 mm`) e ingreso manual.
- **Selector de Fondo:** interruptor simple (*¿Incluye fondo de Durolac/MDF de 3 mm? Sí / No*) que extiende la matriz de despiece de $n \times 3$ a $n \times 5$.

### Paso 2 — Vectores de estructura sobre la imagen (Híbrido: Auto-detección + Edición rápida)
- **Rectificación de contorno (4 nodos + Homografía $3 \times 3$ + Lupa 4×):** el usuario posiciona los 4 nodos exteriores en orden horario (`TL, TR, BR, BL`) con lupa de aumento 4× y vista previa rectificada en vivo. Una homografía pura $H \in \mathbb{R}^{3\times 3}$ (eliminación gaussiana $8\times 8$) corrige la perspectiva y mapea al cuadrado normalizado $[0,1]^2$ con $v = 0$ en base y $v = 1$ en cubierta.
- **Asistente de detección automática offline (`src/core/vision/`):**
  - Rectifica la imagen en RGBA, estima la proporción `W/H` mediante Zhang con **focal fija** (`26 mm` eq. o selector `1×/2×`), aprende el color/luminancia de la melamina desde los 4 bordes exteriores (o desde un **gotero de 1 clic** sobre un canto) y detecta divisores y repisas con **anclaje consciente de paralaje** (robusto a caras superiores/inferiores visibles en perspectiva).
  - Emite un índice de confianza (`detectionConfidence`): si `< 0,5` (ej. mueble blanco sobre fondo blanco), avisa explícitamente y habilita el trazado manual inmediato.
- **Edición manual garantizada con vanos mixtos:** el usuario agrega, arrastra o borra divisores verticales y repisas horizontales en segundos sobre la foto (dibujados en perspectiva vía $H^{-1}$), con enganche automático (*snap*) a bordes exteriores y divisores existentes. Todas las coordenadas exteriores de la foto se convierten con `exteriorToInterior()` al espacio interior normativo de los contratos.
- **Calibración por Referencia A4 (Opcional, invariante a perspectiva):** marca un segmento conocido (botón rápido *Hoja A4 = 297 mm* o medida manual) proyectado vía `toUnit` para prellenar $V_0$ y $V_f$ sin sesgo de perspectiva.

### Paso 3 — Parámetros del espacio disponible y carpintería real
- **Vector de Espacio Objetivo:** sliders + inputs de $V_f = (x_f, y_f, z_f)$ en mm respecto a $V_0$ (con botón *"Fijar $V_0$ actual"*).
- **Restricciones de Tablero y Sierra:**
  - Plancha estándar de pauta **`2440 × 1220 mm`** por defecto (veta en el eje de `2440 mm`), más selector de formatos comerciales chilenos (**`2500 × 1830 mm`** melamina Arauco/Masisa y **`2440 × 1520 mm`** Durolac 3 mm) y margen de escuadrado opcional (`trimMm`, default `0`).
  - Espesor de melamina $e = 18\text{ mm}$ (**invariante** al escalar) y fondo opcional $e_{\text{fondo}} = 3\text{ mm}$ (sin veta ni tapacanto).
  - Grosor de disco / *kerf* (`3,2` a `4,0 mm`, default `4,0 mm`).
  - Restricción de sentido de veta (`respectGrain`): bloquea rotación `90°` cuando está activa y habilita optimización multi-orientación cuando está desactivada.
  - Estrategia de corte: **Guillotina 2 etapas** por defecto (cortes de lado a lado, realistas para seccionadora de taller) + opción **MaxRects BSSF** (estilo CNC).
- **Criterios Constructivos:** encuentro en esquinas (`topOverSides` vs. `topBetweenSides`) y modalidad de tapacanto (`fullPerimeter` vs. `visibleEdgesOnly`).

### Paso 4 — Resultados sincronizados en tiempo real (4 vistas conectadas)
- **Visor 3D Paramétrico:** modelo 3D interactivo 1:1 con cada pieza física (`cantidad: 1`), `<Edges />`, acabados procedurales offline (**Blanco Estándar**, **Roble Claro**, **Grafito Mate**, **Durolac 3 mm**), **Vista Explotada** (`0%–100%`), cotas 3D en mm y resaltado ámbar/rojo de repisas con alerta de pandeo.
- **Panel Matemático en Vivo:** $V_0$, $V_f$, factores $(k_x, k_y, k_z)$, progresión aritmética ($H_{\text{int}}, s_{\text{libre}}, a_1, d, a_n$), matriz $H \in \mathbb{R}^{3\times 3}$, matrices $n\times 3$ y $n\times 5$, y sumatorias de área neta ($\text{m}^2$) y tapacanto ($\text{m}$).
- **Despiece, Alertas y CSV:** tabla consolidada exportable a **CSV con BOM UTF-8 (`\uFEFF`)** y alertas mecánicas (`StructuralAlert`) cuando una repisa de 18 mm supera **850 mm** de luz libre (al agregar un divisor vertical, se subdivide automáticamente y la alerta desaparece en vivo).
- **Plano de Corte 2D (SVG descargable):** planchas vectoriales separadas por espesor (**18 mm** vs **3 mm**), *kerf* exacto, marca de veta y piezas rotadas `(R)`, conteo de planchas y aprovechamiento/desperdicio exactos ($\text{uso}\% + \text{desperdicio}\% = 100\%$).

---

## 4. Conexión Directa con la Materia (Guion Visual para el Video de Etapa 3)

| Contenido Unidad 3 | Formulación Matemática / Concepto | Demostración Práctica en Video |
|---|---|---|
| **Vectores en $\mathbb{R}^3$** | $V_f = (x_f, y_f, z_f)$ en mm y topología interior $P_i = (u_i, v_i) \in [0, 1]^2$ obtenida vía `exteriorToInterior()`. | Fijar $V_0$ en 1500 mm, mover ancho a 1800 mm y mostrar $k_x = 1{,}20$ en tiempo real. |
| **Funciones de Escalamiento** | $k_x = x_f / x_0,\; k_y = y_f / y_0,\; k_z = z_f / z_0$ con $e = 18\text{ mm}$ constante; descuentos `topOverSides` vs `topBetweenSides`. | Variar altura/ancho en 3D comprobando que el espesor permanece invariante en 18 mm. |
| **Sucesiones (Progresiones Aritméticas)** | $H_{\text{int}} = y_f - 2e$, $s_{\text{libre}} = \frac{H_{\text{int}} - N e}{N + 1}$, $a_1 = e + s_{\text{libre}}$, $d = s_{\text{libre}} + e$, $a_n = a_1 + (n-1)d$. | En Estantería, pasar de 3 a 5 repisas y verificar el recálculo exacto sincronizado con el 3D; disparar y apagar alerta de pandeo `> 850 mm`. |
| **Álgebra de Matrices** | 1) Escalamiento base $M = M_0 \cdot \text{diag}(k_1, k_2, 1)$ (valida Etapa 2: `0,8800 → 1,2672 m²`, `6,80 → 8,16 m`).<br>2) Extensión $n \times 3 \to n \times 5$ con fondo 3 mm.<br>3) Homografía proyectiva $H \in \mathbb{R}^{3\times 3}$ y su inversa $H^{-1}$ sobre fotografía. | Activar fondo 3 mm en Clóset (`n×3 → n×5`) y mostrar la rectificación de 4 esquinas sobre una foto real. |
| **Sumatorias y Optimización** | $A = \sum (\text{ancho}_i \cdot \text{alto}_i \cdot \text{cant}_i)$, tapacanto total vs. cantos vistos, perfiles de cobertura en visión y corte 2D guillotina con *kerf* $s$ y veta. | Alternar `respectGrain` mostrando rotación de piezas y ahorro de planchas, más comparación `2440×1220` vs `2500×1830`. |

### Casos de Prueba (3 Presets Oficiales)

1. **Preset 1 — Estantería / Librero Abierto:** $V_f = (800, 1800, 320)\text{ mm}$, `equidistant`, `N = 4`, sin fondo, `topOverSides`. (`x_int = 764 mm`; pandeo se dispara si $x_f > 886\text{ mm}$).
2. **Preset 2 — Rack de TV / Módulo Bajo:** $V_f = (1600, 550, 400)\text{ mm}$, `custom`, divisores exactos en $u = 1/3$ y $2/3$ + 1 repisa central en $v = 0{,}5$ sobre $[1/3, 2/3]$ (`ancho = 503,33 mm`), sin fondo, `topBetweenSides`.
3. **Preset 3 — Clóset / Módulo Alto con Fondo:** $V_f = (1500, 2100, 550)\text{ mm}$, `custom`, 1 divisor central $u = 0{,}5$, 3 repisas izquierdas ($v = 0{,}25;\; 0{,}50;\; 0{,}75$) + 1 derecha ($v = 0{,}82$) (`ancho = 723 mm`), con fondo 3 mm subdividido en 2 paños de `750 × 2100 mm`, `topOverSides`.

---

## 5. Arquitectura Modular y Contratos Congelados

```text
src/
├── types/
│   └── contracts.ts              # Única fuente de verdad inmutable (v2.1 Rev. 2, congelada en Bloque 1)
├── core/
│   ├── mathEngine/
│   │   ├── homography.ts         # Homografía proyectiva 3x3 + inversa (álgebra lineal pura)
│   │   ├── presets.ts            # Presets 1, 2 y 3 (1/3 y 2/3 exactos en Rack TV)
│   │   ├── index.ts              # Motor matemático puro + exteriorToInterior / interiorToExterior
│   │   └── mathEngine.test.ts    # Suite Vitest (incluye Etapa 2 exacta y cero solapamiento 3D)
│   ├── cuttingStock/
│   │   ├── optimizer.ts          # Guillotina 2 etapas (default, rotación real sin veta) + MaxRects opcional
│   │   ├── svgGenerator.ts       # Generador SVG vectorial offline XML-safe
│   │   ├── index.ts              # Orquestador generateCuttingPlan()
│   │   └── cuttingStock.test.ts  # Suite Vitest (kerf, veta, 18 mm vs 3 mm, trimMm, unplaced)
│   └── vision/
│       ├── rectify.ts            # Rectificación bilineal RGBA + focal fija Zhang (26 mm)
│       ├── bandDetector.ts       # Detector croma + flat-field + paralaje unilateral + gotero 1 clic
│       ├── index.ts              # Pipeline analyzePhotoStructure() -> FurnitureTopology parcial + confianza
│       └── vision.test.ts        # Suite sintética (8 escenarios incl. paralaje/jitter/roble) + harness reales
├── components/
│   ├── vectorCanvas/
│   │   └── VectorCanvas.tsx      # 1 vista + ZY opcional, lupa 4x, preview rectificado, auto + manual + A4
│   ├── viewer3d/
│   │   └── Viewer3D.tsx          # Visor R3F/Three.js offline + CanvasTexture + Vista Explotada + cotas
│   └── mathPanel/
│       └── MathPanel.tsx         # Panel Unidad 3, matrices n×3/n×5, alertas, SVG y export CSV/SVG
└── App.tsx                       # Flujo de 4 pasos + barra de Presets + estado reactivo sincronizado
```

### Convenciones Geométricas Congeladas (Cero Ambigüedad)

1. **Sistema 3D (mano derecha, mm):** origen `(0, 0, 0)` en esquina **inferior-izquierda-trasera**; `+X` derecha, `+Y` arriba, `+Z` frente visible. Fondo 3 mm clavado atrás en `z ∈ [-3, 0]` (`cz = -1.5 mm`).
2. **Piezas físicas 1:1:** `matrizDespiece` emite una `BoardPiece` por placa (`cantidad: 1`) con `posicion3D: [cx, cy, cz]` y `dimensiones3D: [dx, dy, dz]` axis-aligned.
3. **Espacio interior normativo:** `NormalizedSegment` vive siempre en `[0,1]^2` interior. En modo `custom`, `v` es el **centro** de la repisa (`cy = e + v * y_int`, restringido a no solapar base/cubierta). En modo `equidistant`, `a_n` es la cara inferior (`cy = a_n + e/2`). Las coordenadas de foto (espacio exterior) se convierten siempre vía `exteriorToInterior()`.
4. **Veta y plancha:** `sheetDimensions = { width: 2440, height: 1220 }` por defecto (`width` = eje de veta). En cada `BoardPiece`, `ancho` es paralelo a la veta y `alto` es la profundidad `z_f`.
5. **Vanos mixtos (cruces y extremos):** al calcular una repisa sobre `[uStart, uEnd]`, se subdivide en cada divisor interior que la cruza **y** se descuenta `e/2` cuando un extremo coincide (`<= 1e-3`) con un divisor vertical.
6. **Subdivisión de fondo 3 mm:** se subdivide verticalmente cuando `(x_f > minS && y_f > minS)` **o** cuando cualquiera de sus lados supera `maxS` de la plancha de fondo (`backPanelSheetDimensions ?? sheetDimensions`).

---

## 6. Plan de Ejecución Actualizado (20 de Noviembre al 1 de Diciembre)

**Regla de compuerta:** no se avanza al bloque siguiente hasta que `vitest` (y `tsc -b && vite build` desde el Bloque 3) finalice 100 % en verde.

| Bloque / Fechas | Objetivo Principal | Entregable Verificable |
|---|---|---|
| **Bloque 1 (20–21 nov)** | Scaffold (`toolchain-spike`), `contracts.ts` v2.1 Rev. 2, `homography.ts`, `presets.ts`, `mathEngine` + **toma de 8–12 fotos reales en paralelo**. | `vitest` verde validando Etapa 2, `exteriorToInterior`, descuentos, vanos mixtos (`503,33` y `723 mm`), progresión y pandeo. |
| **Bloque 2 (22 nov)** | `cuttingStock`: guillotina 2 etapas con rotación real sin veta (+ opción MaxRects, `trimMm`, `backPanelSheetDimensions`) + SVG offline. | `vitest` verde (Bloques 1 + 2): cero solapamientos, kerf, reducción de planchas al soltar veta, separación 18 mm / 3 mm. |
| **Visión (23–24 nov)** | `src/core/vision/`: rectificación RGBA, focal fija `26 mm`, `bandDetector` v2 (croma + paralaje + gotero) + calibración con fotos reales. | `vitest` verde (`8/8` sintéticos) + tabla de regresión sobre fotos reales del equipo. |
| **Bloque 3 (25–26 nov)** | `Viewer3D` offline, `MathPanel`, `App.tsx`, 3 presets, selector de planchas Chile, export CSV/SVG. | `vitest` + `tsc -b` + `vite build` en verde; validado offline en escritorio. |
| **Bloque 4 (27–28 nov)** | `VectorCanvas` completo (lupa 4×, preview rectificado, botón Detectar, gotero 1 clic, edición manual con snap, A4, ZY opcional) conectado en vivo al 3D. | Flujo completo 4 pasos + gate offline sin URLs externas. |
| **Video y Cierre (29–30 nov)** | Grabación de presets Unidad 3 + flujo real Foto → 3D, edición y entrega el **1 de diciembre de 2026**. | Video y prototipo listos para entrega oficial. |

---

## 7. Prompts Sincronizados por Bloque

Los **5 prompts definitivos (Bloque 1, Bloque 2, Módulo Visión, Bloque 3 y Bloque 4)**, 100 % sincronizados con esta especificación v2.1 Rev. 2, se encuentran en:

- [`Auditoria y Prompts.txt`](./Auditoria%20y%20Prompts.txt)

---

## 8. Decisiones del Equipo y Distribución de Roles

### Decisiones Confirmadas
- **Calibración A4 (`297 mm`):** `[x]` Implementada completamente en espacio rectificado (invariante a perspectiva).
- **Vista Lateral ZY:** `[x]` Disponible como pestaña opcional en Paso 1, acompañada de presets de profundidad (`320/400/500/550 mm`).
- **Paleta 3D Procedural (100 % offline):** Blanco Estándar / Roble Claro / Grafito Mate / Durolac 3 mm vía `CanvasTexture`.
- **Fotos reales de prueba:** `[ Completar entre 20–21 nov siguiendo RESUMEN_PARA_EL_EQUIPO.md ]`.

### Distribución de Roles (Asignar HOY 20 nov)

| Integrante | Rol de Desarrollo / QA | Bloque del Video a Presentar |
|---|---|---|
| **Fernando A. Durán Leiva** | `[ Definir dueño ]` | Introducción, problemática y flujo Foto → Homografía → Detección (`VectorCanvas`). |
| **Cristopher D. Figueroa Arthur** | `[ Definir dueño ]` | Motor matemático ($\mathbb{R}^3$, escalamiento $k$, invariancia `18 mm`, matrices $n\times 3 \to n\times 5$). |
| **Francisco A. Lara Yevenes** | `[ Definir dueño ]` | Progresiones aritméticas en repisas, alertas de pandeo (`> 850 mm`) y Visor 3D en vivo. |
| **Génesis T. Sepúlveda Muñoz** | `[ Definir dueño ]` | Optimización Cutting Stock 2D (guillotina, veta, *kerf*, planchas Chile, SVG/CSV) y conclusiones. |
