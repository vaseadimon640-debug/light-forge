import { compositionSchema, type Axis, type Canopy, type Composition, type Element, type Point, type Shape } from './schema.ts';

import type { ResolvedComposition, ResolvedValue } from './result.ts';

type KnownQuality = 'specified' | 'estimated';
type SiteVariable = 'ceilingFromFloorMm' | 'tabletopFromFloorMm';
type Term = { offsetMm: number; variables: Partial<Record<SiteVariable, number>>; quality: KnownQuality };
type UnresolvedPoint = { x: Term | null; y: Term | null; z: Term };
export type XYZ = { x: number; y: number; z: number };
type ResolvedPoint = { x: ResolvedValue; y: ResolvedValue; z: ResolvedValue };

const qualityOf = (...axes: Axis[]): KnownQuality => axes.some(axis => axis.source === 'estimated') ? 'estimated' : 'specified';
const qualityOfTerms = (...terms: Term[]): KnownQuality => terms.some(term => term.quality === 'estimated') ? 'estimated' : 'specified';
const numeric = (offsetMm: number, quality: KnownQuality = 'specified'): Term => ({ offsetMm, variables: {}, quality });
const axisTerm = (axis: Axis): Term => numeric(axis.value, qualityOf(axis));
const variables: SiteVariable[] = ['ceilingFromFloorMm', 'tabletopFromFloorMm'];

function add(first: Term, second: Term, scale = 1): Term {
  const coefficients: Term['variables'] = {};
  for (const key of variables) {
    const coefficient = (first.variables[key] ?? 0) + scale * (second.variables[key] ?? 0);
    if (coefficient) coefficients[key] = coefficient;
  }
  return { offsetMm: first.offsetMm + scale * second.offsetMm, variables: coefficients, quality: qualityOfTerms(first, second) };
}

function siteReference(variable: SiteVariable): Term {
  return { ...numeric(0), variables: { [variable]: 1 } };
}

function evaluate(term: Term | null, site: Composition['site'], path: string): ResolvedValue {
  if (!term) return { valueMm: null, quality: 'unknown', missing: [path] };
  const missing = variables.filter(key => term.variables[key] && site[key] === undefined);
  if (missing.length) return { valueMm: null, quality: 'unknown', missing };
  let valueMm = term.offsetMm;
  const data: Axis[] = [];
  for (const key of variables) {
    const coefficient = term.variables[key];
    const axis = site[key];
    if (coefficient && axis) {
      valueMm += coefficient * axis.value;
      data.push(axis);
    }
  }
  return { valueMm, quality: term.quality === 'estimated' ? 'estimated' : qualityOf(...data) };
}

function resolvePoint(point: UnresolvedPoint, site: Composition['site'], path: string): ResolvedPoint {
  return {
    x: evaluate(point.x, site, `${path}.x`),
    y: evaluate(point.y, site, `${path}.y`),
    z: evaluate(point.z, site, `${path}.z`),
  };
}

function elevation({ datum, offsetMm }: Element['position']['lowest']): Term {
  const offset = axisTerm(offsetMm);
  if (datum === 'floor') return offset;
  return add(offset, siteReference(datum === 'ceiling' ? 'ceilingFromFloorMm' : 'tabletopFromFloorMm'));
}

function rotate(point: Pick<XYZ, 'x' | 'y'>, angleDegrees: number) {
  const yaw = angleDegrees * Math.PI / 180;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
}

function anchorPoint(point: Point, position: Canopy['position'], z: Term, yaw?: Axis): UnresolvedPoint {
  const atCenter = point.x.value === 0 && point.y.value === 0 && qualityOf(point.x, point.y) === 'specified';
  const offset = atCenter ? { x: 0, y: 0 } : yaw
    ? rotate({ x: point.x.value, y: point.y.value }, yaw.value)
    : undefined;
  const quality = atCenter || !yaw ? 'specified' : qualityOf(point.x, point.y, yaw);
  return {
    x: position.x && offset ? add(axisTerm(position.x), numeric(offset.x, quality)) : null,
    y: position.y && offset ? add(axisTerm(position.y), numeric(offset.y, quality)) : null,
    z: add(z, axisTerm(point.z)),
  };
}

function worldGuide(point: Point): UnresolvedPoint {
  return { x: axisTerm(point.x), y: axisTerm(point.y), z: axisTerm(point.z) };
}

export function shapeGeometry(shape: Shape) {
  let widthMm: number;
  let depthMm: number;
  let heightMm: number;
  let heightQuality: KnownQuality;
  let quality: KnownQuality;
  let arc: { centerlineRadiusMm: number; halfSweepRad: number; centerZMm: number; innerRadiusMm: number; outerRadiusMm: number } | undefined;
  if (shape.type === 'ring') {
    widthMm = depthMm = shape.outerDiameterMm.value;
    heightMm = shape.profileHeightMm.value;
    heightQuality = qualityOf(shape.profileHeightMm);
    quality = qualityOf(shape.outerDiameterMm, shape.innerDiameterMm, shape.profileHeightMm);
  } else if (shape.type === 'arc') {
    const halfChord = shape.chordMm.value / 2;
    const rise = shape.riseMm.value;
    const radius = (halfChord ** 2 + rise ** 2) / (2 * rise);
    const halfSweepRad = 2 * Math.atan2(rise, halfChord);
    const halfThickness = shape.radialThicknessMm.value / 2;
    const innerRadiusMm = radius - halfThickness;
    const outerRadiusMm = radius + halfThickness;
    const cosine = Math.max(0, Math.cos(halfSweepRad));
    const centerZMm = -innerRadiusMm * cosine;
    widthMm = 2 * outerRadiusMm * Math.sin(halfSweepRad);
    depthMm = shape.depthMm.value;
    heightMm = rise + halfThickness * (1 + cosine);
    heightQuality = qualityOf(shape.chordMm, shape.riseMm, shape.radialThicknessMm);
    quality = qualityOf(shape.chordMm, shape.riseMm, shape.radialThicknessMm, shape.depthMm);
    arc = { centerlineRadiusMm: radius, halfSweepRad, centerZMm, innerRadiusMm, outerRadiusMm };
  } else if (shape.type === 'linear') {
    widthMm = shape.lengthMm.value;
    depthMm = shape.widthMm.value;
    heightMm = shape.heightMm.value;
    heightQuality = qualityOf(shape.heightMm);
    quality = qualityOf(shape.lengthMm, shape.widthMm, shape.heightMm);
  } else {
    widthMm = shape.widthMm.value;
    depthMm = shape.depthMm.value;
    heightMm = shape.heightMm.value;
    heightQuality = qualityOf(shape.heightMm);
    quality = qualityOf(shape.widthMm, shape.depthMm, shape.heightMm);
  }
  return { widthMm, depthMm, heightMm, heightQuality, quality, representation: shape.type === 'envelope' ? 'envelope' as const : 'parametric' as const, ...(arc && { arc }) };
}

function differences(first: UnresolvedPoint, second: UnresolvedPoint) {
  return {
    x: first.x && second.x ? add(second.x, first.x, -1) : null,
    y: first.y && second.y ? add(second.y, first.y, -1) : null,
    z: add(second.z, first.z, -1),
  };
}

function formulate(term: Term | null, path: string) {
  return term ?? { missing: path };
}

function calculateSuspension(
  suspension: Composition['suspensions'][number],
  from: UnresolvedPoint,
  to: UnresolvedPoint,
  site: Composition['site'],
) {
  const guides = suspension.routing.type === 'guided' ? suspension.routing.guides.map(worldGuide) : [];
  const route = [from, ...guides, to];
  const segments = route.slice(1).map((point, index) => differences(route[index], point));
  const resolved = segments.map((segment, index) => resolvePoint(segment, site, `suspensions.${suspension.id}.segments.${index}.delta`));
  const deltaZ = evaluate(add(from.z, to.z, -1), site, 'verticalDrop');
  const invalidVerticalDrop = deltaZ.valueMm !== null && deltaZ.valueMm < 0;
  const missing = new Set<string>();
  let lengthMm = 0;
  let quality: KnownQuality = 'specified';
  for (const { x, y, z } of resolved) {
    for (const result of [x, y, z]) {
      if (result.quality === 'unknown') result.missing.forEach(key => missing.add(key));
      if (result.quality === 'estimated') quality = 'estimated';
    }
    if (x.valueMm !== null && y.valueMm !== null && z.valueMm !== null)
      lengthMm += Math.hypot(x.valueMm, y.valueMm, z.valueMm);
  }
  const pathLength: ResolvedValue = missing.size
    ? { valueMm: null, quality: 'unknown', missing: [...missing] }
    : { valueMm: lengthMm, quality };
  if (!suspension.allowanceMm) missing.add('allowanceMm');
  if (invalidVerticalDrop) missing.add('attachmentAboveCanopyExit');
  const cutLength: ResolvedValue = missing.size || !suspension.allowanceMm
    ? { valueMm: null, quality: 'unknown', missing: [...missing] }
    : {
      valueMm: lengthMm + suspension.allowanceMm.value,
      quality: quality === 'estimated' ? 'estimated' : qualityOf(suspension.allowanceMm),
    };
  return {
    id: suspension.id, type: suspension.type, from: suspension.from, to: suspension.to,
    points: route.map((point, index) => resolvePoint(point, site, `suspensions.${suspension.id}.points.${index}`)),
    verticalDrop: deltaZ, pathLength, cutLength,
    status: invalidVerticalDrop ? 'invalid' as const : cutLength.valueMm === null ? 'incomplete' as const : 'calculated' as const,
    formula: {
      segments: segments.map((segment, i) => ({
        x: formulate(segment.x, `segments.${i}.deltaX`),
        y: formulate(segment.y, `segments.${i}.deltaY`),
        z: segment.z,
      })),
      rule: 'sum(hypot(deltaX, deltaY, deltaZ)) + allowanceMm' as const,
      allowanceMm: suspension.allowanceMm ?? null,
    },
  };
}

export function engineeringToThree({ x, y, z }: XYZ): XYZ {
  return { x, y: z, z: -y };
}

export function resolveComposition(input: unknown): ResolvedComposition {
  const composition = compositionSchema.parse(input);
  const site = composition.site;
  const elementPoints = new Map<string, Map<string, UnresolvedPoint>>();
  const canopyPoints = new Map<string, Map<string, UnresolvedPoint>>();
  const elements = composition.elements.map(element => {
    const { id, position } = element;
    const geometry = shapeGeometry(element.shape);
    const origin = { x: position.xy.x ? axisTerm(position.xy.x) : null, y: position.xy.y ? axisTerm(position.xy.y) : null, z: elevation(position.lowest) };
    const highest = add(origin.z, numeric(geometry.heightMm, geometry.heightQuality));
    const levels = (term: Term) => ({
      fromFloor: evaluate(term, site, 'floor'),
      belowCeiling: evaluate(add(siteReference('ceilingFromFloorMm'), term, -1), site, 'ceiling'),
      aboveTabletop: evaluate(add(term, siteReference('tabletopFromFloorMm'), -1), site, 'tabletop'),
    });
    const lowestLevels = levels(origin.z);
    const highestLevels = levels(highest);
    const attachments = new Map<string, UnresolvedPoint>();
    elementPoints.set(id, attachments);
    return {
      id, name: element.name, productComponentId: element.productComponentId, shape: element.shape, geometry,
      lowest: lowestLevels, highest: highestLevels,
      origin: resolvePoint(origin, site, `elements.${id}.position`), yawDeg: position.yawDeg,
      issues: [
        ...(lowestLevels.fromFloor.valueMm !== null && lowestLevels.fromFloor.valueMm < 0 ? ['bodyBelowFloor' as const] : []),
        ...(highestLevels.belowCeiling.valueMm !== null && highestLevels.belowCeiling.valueMm < 0 ? ['bodyAboveCeiling' as const] : []),
      ],
      attachments: element.attachments.map(attachment => {
        const world = anchorPoint(attachment.point, position.xy, origin.z, position.yawDeg);
        attachments.set(attachment.id, world);
        return { ...attachment, world: resolvePoint(world, site, `elements.${id}.attachments.${attachment.id}`) };
      }),
    };
  });
  const canopies = composition.canopies.map(canopy => {
    const bottom = add(siteReference('ceilingFromFloorMm'), axisTerm(canopy.dropMm), -1);
    const points = new Map<string, UnresolvedPoint>();
    canopyPoints.set(canopy.id, points);
    return {
      id: canopy.id, name: canopy.name, footprint: canopy.footprint, dropMm: canopy.dropMm,
      yawDeg: canopy.yawDeg,
      origin: {
        x: evaluate(canopy.position.x ? axisTerm(canopy.position.x) : null, site, `canopies.${canopy.id}.position.x`),
        y: evaluate(canopy.position.y ? axisTerm(canopy.position.y) : null, site, `canopies.${canopy.id}.position.y`),
        z: evaluate(bottom, site, `canopies.${canopy.id}.position.z`),
      },
      exits: canopy.exits.map(exit => {
        const point = anchorPoint(exit.point, canopy.position, bottom, canopy.yawDeg);
        points.set(exit.id, point);
        return { ...exit, world: resolvePoint(point, site, `canopies.${canopy.id}.exits.${exit.id}`) };
      }),
      ceilingFixings: canopy.ceilingFixings.map(fixing => {
        const point = anchorPoint(fixing.point, canopy.position, bottom, canopy.yawDeg);
        return { ...fixing, world: resolvePoint(point, site, `canopies.${canopy.id}.ceilingFixings.${fixing.id}`) };
      }),
    };
  });
  return {
    schemaVersion: 1 as const,
    units: 'mm' as const,
    compositionId: composition.id,
    site,
    elements,
    canopies,
    suspensions: composition.suspensions.map(suspension => {
      const from = canopyPoints.get(suspension.from.canopyId)!.get(suspension.from.exitId)!;
      const to = elementPoints.get(suspension.to.elementId)!.get(suspension.to.attachmentId)!;
      return calculateSuspension(suspension, from, to, site);
    }),
  };
}
