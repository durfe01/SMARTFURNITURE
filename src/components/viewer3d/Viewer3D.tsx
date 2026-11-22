/**
 * SMARTFURNITURE — VISOR 3D PARAMÉTRICO 100% OFFLINE (v3.0)
 * - Three.js 0.162 + R3F 8.18 + Drei 9.122 (luces nativas, cero Environment/HDRI remoto).
 * - Texturas procedurales `THREE.CanvasTexture` memorizadas SOLO por `params.material` + dispose().
 * - Patas externas dibujadas como referencia metálica separada sin alterar cotas del cuerpo.
 * - Resaltado en ámbar/rojo para piezas con alerta de pandeo (> 850 mm) + Vista Explotada + Cotas 3D.
 */
import { useEffect, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { Edges, Html, Line, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type {
  BoardPiece,
  DespieceResult,
  FurnitureTopology,
  MelamineMaterial,
  ScaleAndBoardParams,
} from '../../types/contracts';

interface Viewer3DProps {
  despiece: DespieceResult;
  topology: FurnitureTopology;
  params: ScaleAndBoardParams;
  explodeFactor: number;
}

function createProceduralTexture(kind: MelamineMaterial | 'durolac_3mm'): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    if (kind === 'blanco') {
      ctx.fillStyle = '#f4f6f8';
      ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = 'rgba(148, 163, 184, 0.08)';
      for (let i = 0; i < 256; i += 8) {
        ctx.fillRect(0, i, 256, 1);
      }
    } else if (kind === 'grafito') {
      ctx.fillStyle = '#334155';
      ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.18)';
      for (let y = 0; y < 256; y += 6) {
        ctx.fillRect(0, y, 256, 2);
      }
    } else if (kind === 'roble') {
      const grad = ctx.createLinearGradient(0, 0, 256, 0);
      grad.addColorStop(0, '#cfa06e');
      grad.addColorStop(0.5, '#d9ae7e');
      grad.addColorStop(1, '#c5925d');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 256, 256);
      ctx.strokeStyle = 'rgba(110, 68, 30, 0.22)';
      ctx.lineWidth = 1.5;
      for (let y = 4; y < 256; y += 9) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        for (let x = 0; x <= 256; x += 32) {
          ctx.lineTo(x, y + Math.sin(x * 0.04 + y * 0.2) * 2.5);
        }
        ctx.stroke();
      }
    } else {
      // durolac_3mm
      ctx.fillStyle = '#a47e58';
      ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = 'rgba(65, 42, 20, 0.12)';
      for (let i = 0; i < 256; i += 4) {
        ctx.fillRect(i, 0, 1, 256);
      }
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function FurnitureMeshGroup({
  despiece,
  topology,
  params,
  explodeFactor,
}: Viewer3DProps) {
  const { x: xf, y: yf, z: zf } = params.targetDimensions;
  const legHeightMm = topology.hasExternalLegs ? Math.max(40, topology.externalLegHeightMm ?? 150) : 0;
  const legOffsetY = legHeightMm / 1000;

  // Texturas memorizadas SOLO por params.material + limpieza explícita dispose()
  const textures = useMemo(() => {
    return {
      melamine: createProceduralTexture(params.material),
      durolac: createProceduralTexture('durolac_3mm'),
    };
  }, [params.material]);

  useEffect(() => {
    return () => {
      textures.melamine.dispose();
      textures.durolac.dispose();
    };
  }, [textures]);

  const alertMap = useMemo(() => {
    const map = new Map<string, 'warning' | 'critical'>();
    for (const al of despiece.alerts) {
      map.set(al.piezaId, al.severidad);
    }
    return map;
  }, [despiece.alerts]);

  const cx0 = xf / 2;
  const cy0 = yf / 2;
  const cz0 = zf / 2;
  const explodeDist = explodeFactor * 0.24;

  const piecePosition = (p: BoardPiece): [number, number, number] => {
    const [px, py, pz] = p.posicion3D;
    let dx = px - cx0;
    let dy = py - cy0;
    let dz = pz - cz0;
    const len = Math.hypot(dx, dy, dz);
    if (p.tipo === 'fondo') {
      dx = 0;
      dy = 0;
      dz = -1;
    } else if (len > 1e-4) {
      dx /= len;
      dy /= len;
      dz /= len;
    }
    return [
      px / 1000 + dx * explodeDist,
      py / 1000 + dy * explodeDist,
      pz / 1000 + dz * explodeDist,
    ];
  };

  const xm = xf / 1000;
  const ym = yf / 1000;
  const zm = zf / 1000;
  const legInset = Math.min(0.06, xm * 0.12, zm * 0.18);

  const legCoords: [number, number][] = [
    [legInset, legInset],
    [xm - legInset, legInset],
    [legInset, zm - legInset],
    [xm - legInset, zm - legInset],
  ];

  const edgeLineColor = params.material === 'grafito' ? '#94a3b8' : '#334155';

  return (
    <group position={[-xm / 2, 0, -zm / 2]}>
      {/* Patas independientes externas (NO forman parte de la melamina) */}
      {topology.hasExternalLegs && legHeightMm > 0 && (
        <group>
          {legCoords.map(([lx, lz], idx) => (
            <mesh
              key={`ext_leg_${idx}`}
              position={[lx, legOffsetY / 2, lz]}
              castShadow
            >
              <cylinderGeometry args={[0.016, 0.012, legOffsetY, 16]} />
              <meshStandardMaterial color="#1e293b" metalness={0.65} roughness={0.35} />
            </mesh>
          ))}
        </group>
      )}

      {/* Cuerpo de Melamina + Fondo Durolac 3 mm (correspondencia física 1:1) */}
      <group position={[0, legOffsetY, 0]}>
        {despiece.matrizDespiece.map((piece) => {
          const [dx, dy, dz] = piece.dimensiones3D;
          const pos = piecePosition(piece);
          const sev = alertMap.get(piece.id);
          const isBack = piece.tipo === 'fondo' || piece.tipo === 'fondo_cajon';
          const isDoor = piece.tipo === 'puerta';
          const isDrawerFront = piece.tipo === 'frente_cajon';
          const isDrawerBox = piece.tipo === 'costado_cajon' || piece.tipo === 'trasera_cajon';
          const isTrim = piece.tipo === 'zocalo' || piece.tipo === 'faldon';

          // Diferenciación visual clara en 3D entre carcasa, puertas, cajones, cajas internas y zócalos
          const tintColor = isDoor
            ? '#f8fafc'
            : isDrawerFront
              ? '#fef3c7'
              : isDrawerBox
                ? '#e2e8f0'
                : isTrim
                  ? '#94a3b8'
                  : '#ffffff';

          return (
            <group key={piece.id} position={pos}>
              <mesh castShadow receiveShadow>
                <boxGeometry args={[dx / 1000, dy / 1000, dz / 1000]} />
                {sev ? (
                  <meshStandardMaterial
                    color={sev === 'critical' ? '#ef4444' : '#f59e0b'}
                    roughness={0.45}
                  />
                ) : (
                  <meshStandardMaterial
                    map={isBack ? textures.durolac : textures.melamine}
                    color={tintColor}
                    roughness={isBack ? 0.85 : isDoor || isDrawerFront ? 0.42 : 0.58}
                  />
                )}
                <Edges color={sev ? '#7f1d1d' : isDoor || isDrawerFront ? '#0f172a' : edgeLineColor} />
              </mesh>
              {/* Tirador metálico 3D sobre puertas y frentes de cajón (orientación y altura coherentes con muebles multinivel y simples) */}
              {isDoor && (() => {
                const pyMm = piece.posicion3D[1];
                const isUpperAerialDoor = pyMm - dy / 2 >= yf * 0.52 && dy <= yf * 0.52;
                const isLowerBaseDoor = pyMm + dy / 2 <= yf * 0.56 && dy <= yf * 0.58 && topology.hShelves.length >= 1;
                if (isUpperAerialDoor) {
                  // Puerta aérea superior (ej. alacena cocina): tirador horizontal en borde inferior
                  return (
                    <mesh position={[0, -dy / 2000 + Math.min(0.042, (dy / 1000) * 0.12), dz / 2000 + 0.012]} castShadow>
                      <boxGeometry args={[Math.min(0.22, (dx / 1000) * 0.55), 0.012, 0.018]} />
                      <meshStandardMaterial color="#64748b" metalness={0.75} roughness={0.25} />
                    </mesh>
                  );
                }
                if (isLowerBaseDoor) {
                  // Puerta inferior bajo mesón: tirador horizontal en borde superior
                  return (
                    <mesh position={[0, dy / 2000 - Math.min(0.042, (dy / 1000) * 0.12), dz / 2000 + 0.012]} castShadow>
                      <boxGeometry args={[Math.min(0.22, (dx / 1000) * 0.55), 0.012, 0.018]} />
                      <meshStandardMaterial color="#64748b" metalness={0.75} roughness={0.25} />
                    </mesh>
                  );
                }
                return (
                  <mesh position={[dx / 2000 - 0.035, 0, dz / 2000 + 0.012]} castShadow>
                    <boxGeometry args={[0.012, Math.min(0.14, (dy / 1000) * 0.25), 0.018]} />
                    <meshStandardMaterial color="#475569" metalness={0.75} roughness={0.25} />
                  </mesh>
                );
              })()}
              {isDrawerFront && (
                <mesh position={[0, 0, dz / 2000 + 0.012]} castShadow>
                  <boxGeometry args={[Math.min(0.22, (dx / 1000) * 0.55), 0.012, 0.018]} />
                  <meshStandardMaterial color="#64748b" metalness={0.75} roughness={0.25} />
                </mesh>
              )}
            </group>
          );
        })}

        {/* Cotas 3D dinámicas del cuerpo de melamina */}
        {/* Cota Ancho X (frente inferior) */}
        <Line
          points={[
            [0, -0.05, zm + 0.06],
            [xm, -0.05, zm + 0.06],
          ]}
          color="#0284c7"
          lineWidth={2}
        />
        <Html position={[xm / 2, -0.09, zm + 0.06]} center>
          <div className="dim-badge">X: {Math.round(xf)} mm</div>
        </Html>

        {/* Cota Alto Y (costado derecho) */}
        <Line
          points={[
            [xm + 0.07, 0, zm],
            [xm + 0.07, ym, zm],
          ]}
          color="#059669"
          lineWidth={2}
        />
        <Html position={[xm + 0.14, ym / 2, zm]} center>
          <div className="dim-badge dim-y">
            Y: {Math.round(yf)} mm{topology.hasExternalLegs ? ` (+${legHeightMm} patas)` : ''}
          </div>
        </Html>

        {/* Cota Profundidad Z (lateral izquierdo superior) */}
        <Line
          points={[
            [-0.07, ym + 0.03, 0],
            [-0.07, ym + 0.03, zm],
          ]}
          color="#7c3aed"
          lineWidth={2}
        />
        <Html position={[-0.12, ym + 0.07, zm / 2]} center>
          <div className="dim-badge dim-z">Z: {Math.round(zf)} mm</div>
        </Html>
      </group>
    </group>
  );
}

export function Viewer3D({ despiece, topology, params, explodeFactor }: Viewer3DProps) {
  const maxDim = Math.max(
    params.targetDimensions.x,
    params.targetDimensions.y + (topology.hasExternalLegs ? (topology.externalLegHeightMm ?? 150) : 0),
    params.targetDimensions.z,
  ) / 1000;
  const camDist = Math.max(1.8, maxDim * 1.65);

  return (
    <div className="viewer3d-wrapper">
      <div className="viewer3d-overlay-top">
        <span>Visor 3D Paramétrico Offline ({despiece.matrizDespiece.length} placas físicas)</span>
        {topology.hasExternalLegs && (
          <span className="badge-legs">
            Patas externas ({topology.externalLegHeightMm ?? 150} mm) excluidas de melamina
          </span>
        )}
      </div>
      <Canvas
        shadows
        camera={{ position: [camDist * 0.72, camDist * 0.58, camDist * 1.05], fov: 42 }}
      >
        <color attach="background" args={['#eef2f6']} />
        <ambientLight intensity={0.75} />
        <hemisphereLight args={['#ffffff', '#cbd5e1', 0.6]} />
        <directionalLight position={[4, 7, 5]} intensity={1.1} castShadow />
        <directionalLight position={[-4, 3, -3]} intensity={0.4} />
        <gridHelper args={[6, 24, '#94a3b8', '#cbd5e1']} position={[0, -0.001, 0]} />
        <FurnitureMeshGroup
          despiece={despiece}
          topology={topology}
          params={params}
          explodeFactor={explodeFactor}
        />
        <OrbitControls makeDefault target={[0, (params.targetDimensions.y / 2000), 0]} />
      </Canvas>
    </div>
  );
}
