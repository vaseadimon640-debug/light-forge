import { createMyline } from '../domain/myline.ts';
import type { Project } from '../domain/project.ts';
import { type Axis, type Composition, type Point } from './schema.ts';

const supplied = (value: number): Axis => ({ value, source: 'user' });
const point = (x: number, y: number, z: number): Point => ({ x: supplied(x), y: supplied(y), z: supplied(z) });

export function createMylineComposition(project?: Project): Composition {
  const source = project ?? createMyline();
  return {
    schemaVersion: 1,
    id: 'myline-example',
    name: source.name,
    ...(project && { projectId: project.id }),
    site: {
      ...(source.mounting.ceilingFromFloorMm && { ceilingFromFloorMm: source.mounting.ceilingFromFloorMm }),
      ...(source.mounting.tabletopFromFloorMm && { tabletopFromFloorMm: source.mounting.tabletopFromFloorMm }),
    },
    elements: source.mounting.placements.map(placement => {
      const component = source.components.find(item => item.id === placement.componentId);
      const { width, depth, height } = component?.dimensions ?? {};
      if (!component || !width || !depth || !height || !placement.lowestAboveTabletopMm)
        throw new Error(`Incomplete MYLINE fixture at ${placement.id}`);
      return {
        id: placement.id,
        name: component.name,
        productComponentId: component.id,
        shape: { type: 'envelope', intendedShape: 'arc', widthMm: width, depthMm: depth, heightMm: height },
        position: {
          xy: {
            ...(placement.xMm !== undefined && { x: supplied(placement.xMm) }),
            ...(placement.yMm !== undefined && { y: supplied(placement.yMm) }),
          },
          lowest: { datum: 'tabletop', offsetMm: placement.lowestAboveTabletopMm },
        },
        attachments: [],
      };
    }),
    canopies: [],
    suspensions: [],
  };
}

/** Synthetic dimensions for verifying the renderer and suspension arithmetic. */
export function createGeometryExample(): Composition {
  return {
    schemaVersion: 1,
    id: 'geometry-example',
    name: 'Geometry test composition',
    site: { ceilingFromFloorMm: supplied(3000), tabletopFromFloorMm: supplied(750) },
    elements: [
      {
        id: 'ring', name: 'Ring', shape: {
          type: 'ring', outerDiameterMm: supplied(800), innerDiameterMm: supplied(760), profileHeightMm: supplied(40),
        },
        position: { xy: { x: supplied(0), y: supplied(0) }, lowest: { datum: 'tabletop', offsetMm: supplied(1000) }, yawDeg: supplied(0) },
        attachments: [
          { id: 'cable', label: 'Cable attachment', point: point(0, 0, 40) },
          { id: 'strap', label: 'Strap attachment', point: point(380, 0, 30) },
        ],
      },
      {
        id: 'linear', name: 'Linear', shape: {
          type: 'linear', lengthMm: supplied(1000), widthMm: supplied(45), heightMm: supplied(60),
        },
        position: { xy: { x: supplied(1000), y: supplied(0) }, lowest: { datum: 'ceiling', offsetMm: supplied(-1100) }, yawDeg: supplied(90) },
        attachments: [],
      },
      {
        id: 'arc', name: 'Arc', shape: {
          type: 'arc', chordMm: supplied(600), riseMm: supplied(150), radialThicknessMm: supplied(20), depthMm: supplied(40),
        },
        position: { xy: { x: supplied(-1000), y: supplied(0) }, lowest: { datum: 'floor', offsetMm: supplied(1650) }, yawDeg: supplied(0) },
        attachments: [],
      },
    ],
    canopies: [{
      id: 'canopy', name: 'Round canopy', footprint: { type: 'round', diameterMm: supplied(240) },
      dropMm: supplied(60), position: { x: supplied(0), y: supplied(0) }, yawDeg: supplied(0),
      exits: [
        { id: 'cable', label: 'Cable exit', point: point(0, 0, 0) },
        { id: 'strap', label: 'Strap exit', point: point(100, 0, 10) },
      ],
      ceilingFixings: [{ id: 'fixing', label: 'Ceiling fixing', point: point(0, 0, 60) }],
    }],
    suspensions: [
      {
        id: 'cable', type: 'loadBearingCable', from: { canopyId: 'canopy', exitId: 'cable' },
        to: { elementId: 'ring', attachmentId: 'cable' }, routing: { type: 'straight' }, allowanceMm: supplied(50),
      },
      {
        id: 'strap', type: 'decorativeStrap', from: { canopyId: 'canopy', exitId: 'strap' },
        to: { elementId: 'ring', attachmentId: 'strap' }, routing: { type: 'guided', guides: [point(220, 0, 2350)] }, allowanceMm: supplied(80),
      },
    ],
  };
}
