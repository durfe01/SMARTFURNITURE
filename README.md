# SmartFurniture v3.0 (100 % Local Offline)

Prototipo paramétrico de diseño de muebles en melamina, visión computacional offline (**Foto → Homografía 3×3 → 3D**), respaldo matemático Unidad 3 (INACAP) y optimización de corte 2D (Guillotina / MaxRects) con exportación **Excel `.xls` (3 hojas)**, **CSV Chile (`;`)** y **SVG**.

## Stack Fijado (Verificado Offline)
- React `18.3.1` · TypeScript `~5.8.3` · Vite `6.3.5` · Vitest `3.2.4`
- Three.js `0.162.0` · `@react-three/fiber 8.18.0` · `@react-three/drei 9.122.0` · `lucide-react`

## Comandos

```powershell
# Instalar dependencias (solo primera vez)
npm.cmd install

# Ejecutar suite completa de pruebas unitarias (Bloques 1 + 2 + Visión)
node node_modules/vitest/vitest.mjs run

# Compilación estricta TypeScript + Bundle de producción
node node_modules/typescript/bin/tsc -b
node node_modules/vite/bin/vite.js build

# Iniciar aplicación local (o doble clic en INICIAR_SMARTFURNITURE.bat)
node node_modules/vite/bin/vite.js --open
```

## Documentación del Equipo
La auditoría técnica, resolución de los 10 hallazgos y prompts blindados v3.0 se encuentran en `docs/`.
