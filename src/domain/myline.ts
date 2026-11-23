import { newProject, type Component, type Measurement, type Project } from './project.ts';

const supplied = (value: number): Measurement => ({ value, source: 'user' });

function arc(id: string, name: string, width: number, height: number, watts: number, lumens: number, directionId: 'up' | 'down'): Component {
  return {
    id, name, kind: 'arc', quantity: 2,
    dimensions: { width: supplied(width), depth: supplied(60), height: supplied(height) },
    materials: [
      { id: 'body', part: 'Arc body / 弧形灯体', material: 'solidBrass' },
      { id: 'strap', part: 'Suspension strap / 吊带', material: 'genuineLeather' },
    ],
    light: { cct: supplied(3000), cri: supplied(90), watts: supplied(watts), lumens: supplied(lumens), dimming: 'DALI', directionId },
  };
}

export function createMyline(): Project {
  return {
    ...newProject(),
    name: 'MYLINE', code: 'MYLINE', kind: 'chandelier',
    components: [
      arc('large-arc', 'Large arc / 大弧', 900, 700, 59, 4779, 'up'),
      arc('small-arc', 'Small arc / 小弧', 700, 550, 44, 3555, 'down'),
    ],
    mounting: {
      ceilingFromFloorMm: supplied(5750),
      placements: [900, 950, 1250, 1500].map((height, index) => ({
        id: `mount-${index + 1}`,
        componentId: index < 2 ? 'large-arc' : 'small-arc',
        lowestAboveTabletopMm: supplied(height),
      })),
    },
  };
}
