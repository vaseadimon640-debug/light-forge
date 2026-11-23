'use client';

import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Grid, Html, Line, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { ResolvedComposition } from '@/geometry/result';
import {
  computeVisualLayout,
  formatMm,
  mmToMeters,
  toThreeMetres,
  type CameraPreset,
  type LightVisualMode,
  type VisualMaterialPreset,
} from './helpers';

export type SelectionTarget =
  | { kind: 'element'; id: string }
  | { kind: 'canopy'; id: string }
  | { kind: 'suspension'; id: string }
  | null;

type Scene3DProps = {
  resolved: ResolvedComposition;
  selection: SelectionTarget;
  onSelect: (target: SelectionTarget) => void;
  cameraPreset: CameraPreset;
  cameraTrigger: number;
  materialPreset: VisualMaterialPreset;
  lightMode: LightVisualMode;
  showAxes: boolean;
  showDimensions: boolean;
  showRoomPlanes: boolean;
  captureRef: MutableRefObject<(() => string | null) | null>;
};

const DEG2RAD = Math.PI / 180;

function CameraController({
  preset,
  trigger,
  center,
  radius,
  captureRef,
}: {
  preset: CameraPreset;
  trigger: number;
  center: [number, number, number];
  radius: number;
  captureRef: MutableRefObject<(() => string | null) | null>;
}) {
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const { camera, gl, scene } = useThree();

  useEffect(() => {
    captureRef.current = () => {
      gl.render(scene, camera);
      return gl.domElement.toDataURL('image/png');
    };
    return () => {
      captureRef.current = null;
    };
  }, [camera, captureRef, gl, scene]);

  useEffect(() => {
    const dist = Math.max(3.2, radius * 2.15);
    const [cx, cy, cz] = center;
    if (preset === 'iso') {
      camera.position.set(cx + dist * 0.72, cy + dist * 0.44, cz + dist * 0.85);
    } else if (preset === 'top') {
      camera.position.set(cx, cy + dist * 1.45, cz + 0.01);
    } else if (preset === 'front') {
      camera.position.set(cx, cy, cz + dist * 1.25);
    } else if (preset === 'side') {
      camera.position.set(cx + dist * 1.25, cy, cz);
    }
    camera.lookAt(cx, cy, cz);
    if (controlsRef.current) {
      controlsRef.current.target.set(cx, cy, cz);
      controlsRef.current.update();
    }
  }, [camera, center, preset, radius, trigger]);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={0.4}
      maxDistance={28}
      maxPolarAngle={Math.PI * 0.495}
    />
  );
}

function RingGeometryMesh({
  outerDiameterMm,
  innerDiameterMm,
  profileHeightMm,
  material,
}: {
  outerDiameterMm: number;
  innerDiameterMm: number;
  profileHeightMm: number;
  material: VisualMaterialPreset;
}) {
  const geometry = useMemo(() => {
    const rOut = mmToMeters(outerDiameterMm) / 2;
    const rIn = mmToMeters(innerDiameterMm) / 2;
    const h = mmToMeters(profileHeightMm);
    const shape = new THREE.Shape();
    shape.absarc(0, 0, rOut, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, rIn, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const geom = new THREE.ExtrudeGeometry(shape, {
      depth: h,
      bevelEnabled: false,
      curveSegments: 64,
    });
    // Extrude along +Z becomes +Y (upward from local z=0)
    geom.rotateX(-Math.PI / 2);
    geom.computeVertexNormals();
    return geom;
  }, [outerDiameterMm, innerDiameterMm, profileHeightMm]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial
        color={material.color}
        metalness={material.metalness}
        roughness={material.roughness}
      />
    </mesh>
  );
}

function ArcGeometryMesh({
  innerRadiusMm,
  outerRadiusMm,
  halfSweepRad,
  centerZMm,
  depthMm,
  material,
}: {
  innerRadiusMm: number;
  outerRadiusMm: number;
  halfSweepRad: number;
  centerZMm: number;
  depthMm: number;
  material: VisualMaterialPreset;
}) {
  const geometry = useMemo(() => {
    const rOut = mmToMeters(outerRadiusMm);
    const rIn = mmToMeters(innerRadiusMm);
    const cy = mmToMeters(centerZMm);
    const depth = mmToMeters(depthMm);
    const aStart = Math.PI / 2 - halfSweepRad;
    const aEnd = Math.PI / 2 + halfSweepRad;

    const shape = new THREE.Shape();
    shape.absarc(0, cy, rOut, aStart, aEnd, false);
    shape.absarc(0, cy, rIn, aEnd, aStart, true);
    shape.closePath();

    const geom = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: false,
      curveSegments: 48,
    });
    geom.translate(0, 0, -depth / 2);
    geom.computeVertexNormals();
    return geom;
  }, [innerRadiusMm, outerRadiusMm, halfSweepRad, centerZMm, depthMm]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial
        color={material.color}
        metalness={material.metalness}
        roughness={material.roughness}
      />
    </mesh>
  );
}

function EnvelopeGeometryMesh({
  widthMm,
  depthMm,
  heightMm,
  intendedShape,
  material,
  selected,
}: {
  widthMm: number;
  depthMm: number;
  heightMm: number;
  intendedShape: 'ring' | 'arc' | 'linear' | 'custom';
  material: VisualMaterialPreset;
  selected: boolean;
}) {
  const w = mmToMeters(widthMm);
  const d = mmToMeters(depthMm);
  const h = mmToMeters(heightMm);

  const boxEdges = useMemo(() => {
    const box = new THREE.BoxGeometry(w, h, d);
    const edges = new THREE.EdgesGeometry(box);
    box.dispose();
    return edges;
  }, [w, h, d]);

  // Conceptual silhouette for envelope with intendedShape === 'arc' (strictly marked as envelope/concept)
  const conceptArcPoints = useMemo(() => {
    if (intendedShape !== 'arc') return null;
    const pts: [number, number, number][] = [];
    const rx = w / 2;
    const ry = h;
    const steps = 32;
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * Math.PI;
      pts.push([Math.cos(t) * rx, Math.sin(t) * ry, 0]);
    }
    return pts;
  }, [intendedShape, w, h]);

  useEffect(() => () => boxEdges.dispose(), [boxEdges]);

  return (
    <group>
      {/* Translucent bounding envelope volume */}
      <mesh position={[0, h / 2, 0]}>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial
          color={selected ? '#244752' : material.color}
          transparent
          opacity={selected ? 0.22 : 0.14}
          roughness={0.6}
          depthWrite={false}
        />
      </mesh>
      {/* Wireframe bounding box outline */}
      <lineSegments geometry={boxEdges} position={[0, h / 2, 0]}>
        <lineBasicMaterial color={selected ? '#1f4e5c' : '#8c6a2f'} />
      </lineSegments>
      {/* Conceptual inner silhouette indicating intended shape inside envelope */}
      {conceptArcPoints && (
        <Line
          points={conceptArcPoints}
          color={selected ? '#244752' : material.color}
          lineWidth={3}
          dashed
          dashSize={0.04}
          gapSize={0.025}
        />
      )}
    </group>
  );
}

function LightBeamOverlay({
  mode,
  widthM,
  heightM,
  productComponentId,
}: {
  mode: LightVisualMode;
  widthM: number;
  heightM: number;
  productComponentId?: string;
}) {
  if (mode === 'off') return null;
  let effective: 'up' | 'down' | 'both' | 'diffuse' = 'down';
  if (mode === 'auto') {
    if (productComponentId === 'large-arc') effective = 'up';
    else if (productComponentId === 'small-arc') effective = 'down';
    else effective = 'down';
  } else {
    effective = mode;
  }

  const beamR = Math.max(0.18, Math.min(0.65, widthM * 0.45));
  const beamH = 0.65;

  return (
    <group>
      {(effective === 'down' || effective === 'both') && (
        <mesh position={[0, -beamH / 2, 0]}>
          <coneGeometry args={[beamR, beamH, 24, 1, true]} />
          <meshBasicMaterial
            color="#f9dc9c"
            transparent
            opacity={0.18}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      )}
      {(effective === 'up' || effective === 'both') && (
        <mesh position={[0, heightM + beamH / 2, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[beamR, beamH, 24, 1, true]} />
          <meshBasicMaterial
            color="#f9dc9c"
            transparent
            opacity={0.18}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      )}
      {effective === 'diffuse' && (
        <mesh position={[0, heightM / 2, 0]}>
          <sphereGeometry args={[Math.max(0.24, widthM * 0.42), 20, 16]} />
          <meshBasicMaterial color="#fbe7b8" transparent opacity={0.13} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

function SuspensionSegmentMesh({
  start,
  end,
  type,
  invalid,
  selected,
  onClick,
}: {
  start: [number, number, number];
  end: [number, number, number];
  type: 'loadBearingCable' | 'decorativeStrap';
  invalid: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  const { midpoint, length, quaternion } = useMemo(() => {
    const a = new THREE.Vector3(...start);
    const b = new THREE.Vector3(...end);
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    const quat = new THREE.Quaternion();
    if (len > 1e-6) {
      quat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    }
    return { midpoint: mid, length: len, quaternion: quat };
  }, [start, end]);

  if (length < 1e-5) return null;

  const color = invalid
    ? '#c8372d'
    : selected
      ? '#244752'
      : type === 'decorativeStrap'
        ? '#7a4b2a'
        : '#495860';

  return (
    <mesh
      position={midpoint}
      quaternion={quaternion}
      onClick={event => {
        event.stopPropagation();
        onClick();
      }}
    >
      {type === 'decorativeStrap' ? (
        <boxGeometry args={[0.026, length, 0.005]} />
      ) : (
        <cylinderGeometry args={[0.0028, 0.0028, length, 10]} />
      )}
      <meshStandardMaterial
        color={color}
        metalness={type === 'loadBearingCable' ? 0.8 : 0.12}
        roughness={type === 'loadBearingCable' ? 0.3 : 0.72}
      />
    </mesh>
  );
}

function EngineeringAxes() {
  const axisLen = 0.75;
  return (
    <group position={[0, 0.004, 0]}>
      {/* +X engineering -> +X Three.js */}
      <Line points={[[0, 0, 0], [axisLen, 0, 0]]} color="#c74338" lineWidth={2} />
      <Html zIndexRange={[1, 8]} position={[axisLen + 0.08, 0.03, 0]} center>
        <span className="lfg-3d-tag" style={{ color: '#c74338' }}>+X шир.</span>
      </Html>
      {/* +Y engineering -> -Z Three.js */}
      <Line points={[[0, 0, 0], [0, 0, -axisLen]]} color="#247858" lineWidth={2} />
      <Html zIndexRange={[1, 8]} position={[0, 0.03, -axisLen - 0.1]} center>
        <span className="lfg-3d-tag" style={{ color: '#247858' }}>+Y глуб.</span>
      </Html>
      {/* +Z engineering -> +Y Three.js */}
      <Line points={[[0, 0, 0], [0, axisLen, 0]]} color="#275c88" lineWidth={2} />
      <Html zIndexRange={[1, 8]} position={[0.04, axisLen + 0.08, 0]} center>
        <span className="lfg-3d-tag" style={{ color: '#275c88' }}>+Z выс.</span>
      </Html>
    </group>
  );
}

export function Scene3D({
  resolved,
  selection,
  onSelect,
  cameraPreset,
  cameraTrigger,
  materialPreset,
  lightMode,
  showAxes,
  showDimensions,
  showRoomPlanes,
  captureRef,
}: Scene3DProps) {
  const layout = useMemo(() => computeVisualLayout(resolved), [resolved]);
  const ceilingY = mmToMeters(layout.displayCeilingMm);
  const tabletopY = layout.displayTabletopMm !== null ? mmToMeters(layout.displayTabletopMm) : null;

  const roomSpanM = Math.max(3.6, layout.boundsRadiusMetres * 2.1);
  const tableWidthM = Math.min(roomSpanM * 0.82, Math.max(1.8, layout.boundsRadiusMetres * 1.35));
  const tableDepthM = 1.05;

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ fov: 38, near: 0.05, far: 100, position: [3.2, 2.4, 3.8] }}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
      onPointerMissed={() => onSelect(null)}
    >
      <color attach="background" args={['#efeee9']} />
      <hemisphereLight args={['#ffffff', '#dad7ce', 1.1]} />
      <directionalLight position={[4, 8, 5]} intensity={1.15} castShadow shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[-4, 4, -3]} intensity={0.45} />

      <CameraController
        preset={cameraPreset}
        trigger={cameraTrigger}
        center={layout.boundsCenterThree}
        radius={layout.boundsRadiusMetres}
        captureRef={captureRef}
      />

      {/* Floor plane & architectural meter grid (Z = 0) */}
      <Grid
        position={[0, 0.001, 0]}
        args={[14, 14]}
        cellSize={0.5}
        cellThickness={0.5}
        cellColor="#d5d4ce"
        sectionSize={1}
        sectionThickness={1}
        sectionColor="#b9b8b0"
        fadeDistance={18}
        infiniteGrid
      />

      {showAxes && <EngineeringAxes />}

      {/* Ceiling & Tabletop Reference Planes */}
      {showRoomPlanes && (
        <group>
          {/* Ceiling slab */}
          <group position={[0, ceilingY, 0]}>
            <mesh position={[0, 0.015, 0]}>
              <boxGeometry args={[roomSpanM, 0.03, roomSpanM * 0.72]} />
              <meshStandardMaterial color="#dde3e5" transparent opacity={layout.ceilingIsReal ? 0.42 : 0.2} roughness={0.9} />
            </mesh>
            <Line
              points={[
                [-roomSpanM / 2, 0, -roomSpanM * 0.36],
                [roomSpanM / 2, 0, -roomSpanM * 0.36],
                [roomSpanM / 2, 0, roomSpanM * 0.36],
                [-roomSpanM / 2, 0, roomSpanM * 0.36],
                [-roomSpanM / 2, 0, -roomSpanM * 0.36],
              ]}
              color={layout.ceilingIsReal ? '#5e7680' : '#9aa6aa'}
              lineWidth={1.2}
              dashed={!layout.ceilingIsReal}
              dashSize={0.12}
              gapSize={0.08}
            />
            {showDimensions && (
              <Html zIndexRange={[1, 8]} position={[-roomSpanM / 2 + 0.1, 0.09, roomSpanM * 0.36]} center={false}>
                <span className={`lfg-3d-tag${layout.ceilingIsReal ? '' : ' lfg-3d-tag--warn'}`}>
                  {layout.ceilingIsReal
                    ? `Потолок: ${resolved.site.ceilingFromFloorMm!.value} мм`
                    : 'Потолок не задан (условно)'}
                </span>
              </Html>
            )}
          </group>

          {/* Tabletop plane (Real or Reference-only when unknown) */}
          {tabletopY !== null && (
            <group position={[0, tabletopY, 0]}>
              <mesh position={[0, -0.02, 0]} receiveShadow>
                <boxGeometry args={[tableWidthM, 0.04, tableDepthM]} />
                <meshStandardMaterial
                  color={layout.tabletopIsReal ? '#d7ccb9' : '#f4e6c8'}
                  transparent
                  opacity={layout.tabletopIsReal ? 0.78 : 0.34}
                  roughness={0.85}
                />
              </mesh>
              <Line
                points={[
                  [-tableWidthM / 2, 0.002, -tableDepthM / 2],
                  [tableWidthM / 2, 0.002, -tableDepthM / 2],
                  [tableWidthM / 2, 0.002, tableDepthM / 2],
                  [-tableWidthM / 2, 0.002, tableDepthM / 2],
                  [-tableWidthM / 2, 0.002, -tableDepthM / 2],
                ]}
                color={layout.tabletopIsReal ? '#7c6f5b' : '#b27b21'}
                lineWidth={1.5}
                dashed={layout.tabletopIsReferenceOnly}
                dashSize={0.1}
                gapSize={0.07}
              />
              {showDimensions && (
                <Html zIndexRange={[1, 8]} position={[-tableWidthM / 2 + 0.05, 0.06, tableDepthM / 2]} center={false}>
                  <span className={`lfg-3d-tag${layout.tabletopIsReferenceOnly ? ' lfg-3d-tag--warn' : ''}`}>
                    {layout.tabletopIsReal
                      ? `Столешница: ${resolved.site.tabletopFromFloorMm!.value} мм`
                      : 'Уровень стола · высота от пола НЕ ЗАДАНА'}
                  </span>
                </Html>
              )}
            </group>
          )}
        </group>
      )}

      {/* Luminaire Elements */}
      {resolved.elements.map(element => {
        const place = layout.elements[element.id];
        const pos = toThreeMetres({
          x: place.displayXMm,
          y: place.displayYMm,
          z: place.displayLowestZMm,
        });
        const yawRad = place.displayYawDeg * DEG2RAD;
        const selected = selection?.kind === 'element' && selection.id === element.id;
        const hasIssue = element.issues.length > 0;
        const widthM = mmToMeters(element.geometry.widthMm);
        const heightM = mmToMeters(element.geometry.heightMm);
        const depthM = mmToMeters(element.geometry.depthMm);

        const activeMaterial: VisualMaterialPreset = hasIssue
          ? { ...materialPreset, color: '#b43c32', metalness: 0.25 }
          : selected
            ? { ...materialPreset, color: materialPreset.color }
            : materialPreset;

        // Vertical dimension line base (tabletop if tabletop-relative, else floor)
        const dimBaseY =
          element.lowest.aboveTabletop.valueMm !== null && tabletopY !== null
            ? tabletopY
            : 0;
        const dimLabel =
          element.lowest.aboveTabletop.valueMm !== null
            ? `${Math.round(element.lowest.aboveTabletop.valueMm)} мм над столом`
            : element.lowest.fromFloor.valueMm !== null
              ? `${Math.round(element.lowest.fromFloor.valueMm)} мм от пола`
              : element.lowest.belowCeiling.valueMm !== null
                ? `${Math.round(element.lowest.belowCeiling.valueMm)} мм под потолком`
                : 'Уровень неизвестен';

        return (
          <group key={element.id}>
            <group
              position={pos}
              rotation={[0, yawRad, 0]}
              onClick={event => {
                event.stopPropagation();
                onSelect({ kind: 'element', id: element.id });
              }}
            >
              {element.shape.type === 'ring' && (
                <RingGeometryMesh
                  outerDiameterMm={element.shape.outerDiameterMm.value}
                  innerDiameterMm={element.shape.innerDiameterMm.value}
                  profileHeightMm={element.shape.profileHeightMm.value}
                  material={activeMaterial}
                />
              )}
              {element.shape.type === 'linear' && (
                <mesh position={[0, heightM / 2, 0]} castShadow receiveShadow>
                  <boxGeometry args={[widthM, heightM, depthM]} />
                  <meshStandardMaterial
                    color={activeMaterial.color}
                    metalness={activeMaterial.metalness}
                    roughness={activeMaterial.roughness}
                  />
                </mesh>
              )}
              {element.shape.type === 'arc' && element.geometry.arc && (
                <ArcGeometryMesh
                  innerRadiusMm={element.geometry.arc.innerRadiusMm}
                  outerRadiusMm={element.geometry.arc.outerRadiusMm}
                  halfSweepRad={element.geometry.arc.halfSweepRad}
                  centerZMm={element.geometry.arc.centerZMm}
                  depthMm={element.shape.depthMm.value}
                  material={activeMaterial}
                />
              )}
              {element.shape.type === 'envelope' && (
                <EnvelopeGeometryMesh
                  widthMm={element.shape.widthMm.value}
                  depthMm={element.shape.depthMm.value}
                  heightMm={element.shape.heightMm.value}
                  intendedShape={element.shape.intendedShape}
                  material={activeMaterial}
                  selected={selected}
                />
              )}

              {/* Subtle selection bounding wireframe for parametric elements */}
              {selected && element.shape.type !== 'envelope' && (
                <mesh position={[0, heightM / 2, 0]}>
                  <boxGeometry args={[widthM + 0.02, heightM + 0.02, depthM + 0.02]} />
                  <meshBasicMaterial color="#244752" wireframe transparent opacity={0.45} />
                </mesh>
              )}

              {/* Light direction cone visualization */}
              <LightBeamOverlay
                mode={lightMode}
                widthM={widthM}
                heightM={heightM}
                productComponentId={element.productComponentId}
              />

              {/* Local attachment anchors */}
              {element.attachments.map(att => {
                const localPos = toThreeMetres({
                  x: att.point.x.value,
                  y: att.point.y.value,
                  z: att.point.z.value,
                });
                return (
                  <mesh key={att.id} position={localPos}>
                    <sphereGeometry args={[0.016, 14, 14]} />
                    <meshStandardMaterial color="#1f684c" roughness={0.3} />
                  </mesh>
                );
              })}

              {/* Element name / envelope tag */}
              {showDimensions && (
                <Html zIndexRange={[1, 8]} position={[0, heightM + 0.1, 0]} center>
                  <span
                    className={`lfg-3d-tag${
                      selected ? ' lfg-3d-tag--accent' : element.shape.type === 'envelope' ? ' lfg-3d-tag--warn' : ''
                    }`}
                  >
                    {element.name} · {Math.round(element.geometry.widthMm)}×{Math.round(element.geometry.heightMm)} мм
                    {element.shape.type === 'envelope' ? ' (габарит)' : ''}
                  </span>
                </Html>
              )}
            </group>

            {/* Vertical Elevation Dimension Line */}
            {showDimensions && pos[1] > dimBaseY + 0.02 && (
              <group>
                <Line
                  points={[
                    [pos[0], dimBaseY, pos[2]],
                    [pos[0], pos[1], pos[2]],
                  ]}
                  color={place.hasStagedAny ? '#9b6b1b' : '#244752'}
                  lineWidth={1.2}
                  dashed={place.hasStagedAny}
                  dashSize={0.05}
                  gapSize={0.035}
                />
                <Html zIndexRange={[1, 8]} position={[pos[0], (dimBaseY + pos[1]) / 2, pos[2]]} center>
                  <span className={`lfg-3d-tag${place.hasStagedAny ? ' lfg-3d-tag--warn' : ''}`}>
                    {dimLabel}
                  </span>
                </Html>
              </group>
            )}
          </group>
        );
      })}

      {/* Ceiling Canopies */}
      {resolved.canopies.map(canopy => {
        const place = layout.canopies[canopy.id];
        const pos = toThreeMetres({
          x: place.displayXMm,
          y: place.displayYMm,
          z: place.displayBottomZMm,
        });
        const dropM = mmToMeters(canopy.dropMm.value);
        const yawRad = (canopy.yawDeg?.value ?? 0) * DEG2RAD;
        const selected = selection?.kind === 'canopy' && selection.id === canopy.id;

        return (
          <group
            key={canopy.id}
            position={pos}
            rotation={[0, yawRad, 0]}
            onClick={event => {
              event.stopPropagation();
              onSelect({ kind: 'canopy', id: canopy.id });
            }}
          >
            {canopy.footprint.type === 'round' ? (
              <mesh position={[0, dropM / 2, 0]} castShadow>
                <cylinderGeometry
                  args={[
                    mmToMeters(canopy.footprint.diameterMm.value) / 2,
                    mmToMeters(canopy.footprint.diameterMm.value) / 2,
                    dropM,
                    40,
                  ]}
                />
                <meshStandardMaterial
                  color={selected ? '#244752' : '#323e42'}
                  metalness={0.55}
                  roughness={0.42}
                />
              </mesh>
            ) : (
              <mesh position={[0, dropM / 2, 0]} castShadow>
                <boxGeometry
                  args={[
                    mmToMeters(canopy.footprint.widthMm.value),
                    dropM,
                    mmToMeters(canopy.footprint.depthMm.value),
                  ]}
                />
                <meshStandardMaterial
                  color={selected ? '#244752' : '#323e42'}
                  metalness={0.55}
                  roughness={0.42}
                />
              </mesh>
            )}

            {/* Canopy exits */}
            {canopy.exits.map(exit => {
              const p = toThreeMetres({ x: exit.point.x.value, y: exit.point.y.value, z: exit.point.z.value });
              return (
                <mesh key={exit.id} position={p}>
                  <sphereGeometry args={[0.015, 14, 14]} />
                  <meshStandardMaterial color="#246e82" roughness={0.35} />
                </mesh>
              );
            })}

            {/* Ceiling fixings on upper face */}
            {canopy.ceilingFixings.map(fixing => {
              const p = toThreeMetres({
                x: fixing.point.x.value,
                y: fixing.point.y.value,
                z: fixing.point.z.value,
              });
              return (
                <mesh key={fixing.id} position={p}>
                  <cylinderGeometry args={[0.01, 0.01, 0.02, 12]} />
                  <meshStandardMaterial color="#b48a3e" metalness={0.7} roughness={0.3} />
                </mesh>
              );
            })}
          </group>
        );
      })}

      {/* Suspensions (Separate Load-Bearing Cables vs Decorative Straps) */}
      {resolved.suspensions.map(suspension => {
        const selected = selection?.kind === 'suspension' && selection.id === suspension.id;
        const resolvedPoints = suspension.points
          .map(pt =>
            pt.x.valueMm !== null && pt.y.valueMm !== null && pt.z.valueMm !== null
              ? toThreeMetres({ x: pt.x.valueMm, y: pt.y.valueMm, z: pt.z.valueMm })
              : null,
          );

        const allKnown = resolvedPoints.every((p): p is [number, number, number] => p !== null);
        if (!allKnown) return null;

        const pts = resolvedPoints as [number, number, number][];
        const midIdx = Math.floor(pts.length / 2);
        const labelPos: [number, number, number] = [
          (pts[midIdx - 1][0] + pts[midIdx][0]) / 2,
          (pts[midIdx - 1][1] + pts[midIdx][1]) / 2,
          (pts[midIdx - 1][2] + pts[midIdx][2]) / 2,
        ];

        return (
          <group key={suspension.id}>
            {pts.slice(1).map((endPt, idx) => (
              <SuspensionSegmentMesh
                key={idx}
                start={pts[idx]}
                end={endPt}
                type={suspension.type}
                invalid={suspension.status === 'invalid'}
                selected={selected}
                onClick={() => onSelect({ kind: 'suspension', id: suspension.id })}
              />
            ))}
            {/* Intermediate guide points */}
            {pts.slice(1, -1).map((guidePt, idx) => (
              <mesh key={`g-${idx}`} position={guidePt}>
                <sphereGeometry args={[0.018, 14, 14]} />
                <meshStandardMaterial color="#8c6a2f" metalness={0.6} roughness={0.35} />
              </mesh>
            ))}
            {showDimensions && (
              <Html zIndexRange={[1, 8]} position={labelPos} center>
                <span className={`lfg-3d-tag${suspension.status === 'invalid' ? ' lfg-3d-tag--warn' : ''}`}>
                  {suspension.type === 'loadBearingCable' ? 'Трос' : 'Ремень'}:{' '}
                  {suspension.cutLength.valueMm !== null
                    ? formatMm(suspension.cutLength)
                    : suspension.pathLength.valueMm !== null
                      ? `путь ${formatMm(suspension.pathLength)}`
                      : 'неполные данные'}
                </span>
              </Html>
            )}
          </group>
        );
      })}
    </Canvas>
  );
}
