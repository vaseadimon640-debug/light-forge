import { z } from 'zod';
import { measureMmSchema } from '../domain/project.ts';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const title = z.string().trim().min(1).max(120);
const coordinate = z.number().min(-1_000_000).max(1_000_000);
const provenance = z.enum(['user', 'documentation', 'estimated']);
const axis = z.strictObject({ value: coordinate, source: provenance });
const height = measureMmSchema;
const size = z.strictObject({ value: z.number().min(0.001).max(1_000_000), source: provenance });
export const pointSchema = z.strictObject({ x: axis, y: axis, z: axis });
const positionSchema = z.strictObject({ x: axis.optional(), y: axis.optional() });
export const yawSchema = z.strictObject({ value: z.number().min(-360).max(360), source: provenance });
const datum = z.enum(['floor', 'ceiling', 'tabletop']);
const elevationSchema = z.strictObject({
  datum,
  offsetMm: axis,
});

export const shapeSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('ring'),
    outerDiameterMm: size,
    innerDiameterMm: size,
    profileHeightMm: size,
  }),
  z.strictObject({
    type: z.literal('arc'),
    chordMm: size,
    riseMm: size,
    radialThicknessMm: size,
    depthMm: size,
  }),
  z.strictObject({
    type: z.literal('linear'),
    lengthMm: size,
    widthMm: size,
    heightMm: size,
  }),
  z.strictObject({
    type: z.literal('envelope'),
    intendedShape: z.enum(['ring', 'arc', 'linear', 'custom']),
    widthMm: size,
    depthMm: size,
    heightMm: size,
  }),
]);

const anchor = z.strictObject({ id, label: title, point: pointSchema });
const elementSchema = z.strictObject({
  id,
  name: title,
  productComponentId: id.optional(),
  shape: shapeSchema,
  position: z.strictObject({
    xy: positionSchema,
    lowest: elevationSchema,
    yawDeg: yawSchema.optional(),
  }),
  attachments: z.array(anchor).max(24),
});

export const footprintSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('round'), diameterMm: size }),
  z.strictObject({ type: z.literal('rectangular'), widthMm: size, depthMm: size }),
]);

const canopySchema = z.strictObject({
  id,
  name: title,
  footprint: footprintSchema,
  dropMm: size,
  position: positionSchema,
  yawDeg: yawSchema.optional(),
  ceilingFixings: z.array(anchor).max(24),
  exits: z.array(anchor).max(24),
});

const routingSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('straight') }),
  z.strictObject({ type: z.literal('guided'), guides: z.array(pointSchema).min(1).max(16) }),
]);

const suspensionSchema = z.strictObject({
  id,
  type: z.enum(['loadBearingCable', 'decorativeStrap']),
  from: z.strictObject({ canopyId: id, exitId: id }),
  to: z.strictObject({ elementId: id, attachmentId: id }),
  routing: routingSchema,
  allowanceMm: height.optional(),
});

export const siteSchema = z.strictObject({
  ceilingFromFloorMm: size.optional(),
  tabletopFromFloorMm: height.optional(),
});

export const compositionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id,
  name: title,
  projectId: id.optional(),
  site: siteSchema,
  elements: z.array(elementSchema).min(1).max(96),
  canopies: z.array(canopySchema).max(96),
  suspensions: z.array(suspensionSchema).max(192),
}).superRefine((composition, ctx) => {
  function issue(path: (string | number)[], message: string) {
    ctx.addIssue({ code: 'custom', path, message });
  }

  function checkUnique(items: { id: string }[], path: (string | number)[]) {
    if (new Set(items.map(item => item.id)).size !== items.length) issue(path, 'IDs must be unique');
  }

  for (const key of ['elements', 'canopies', 'suspensions'] as const) checkUnique(composition[key], [key]);

  const ceiling = composition.site.ceilingFromFloorMm;
  const tabletop = composition.site.tabletopFromFloorMm;
  if (ceiling && tabletop && tabletop.value >= ceiling.value)
    issue(['site', 'tabletopFromFloorMm'], 'Tabletop must be below the ceiling');

  for (const [index, element] of composition.elements.entries()) {
    checkUnique(element.attachments, ['elements', index, 'attachments']);
    const shape = element.shape;
    const lowest = element.position.lowest;
    if (lowest.datum === 'ceiling' && lowest.offsetMm.value > 0)
      issue(['elements', index, 'position', 'lowest'], 'An offset below the ceiling is negative');
    if (lowest.datum === 'floor' && lowest.offsetMm.value < 0)
      issue(['elements', index, 'position', 'lowest'], 'The body must be above the floor');
    if (shape.type === 'ring' && shape.innerDiameterMm.value >= shape.outerDiameterMm.value)
      issue(['elements', index, 'shape', 'innerDiameterMm'], 'Inner diameter must be less than outer diameter');
    if (shape.type === 'arc') {
      const halfChord = shape.chordMm.value / 2;
      const rise = shape.riseMm.value;
      const radius = (halfChord ** 2 + rise ** 2) / (2 * rise);
      if (rise > halfChord) issue(['elements', index, 'shape', 'riseMm'], 'Circular arc rise must be at most half the chord');
      if (shape.radialThicknessMm.value / 2 >= radius)
        issue(['elements', index, 'shape', 'radialThicknessMm'], 'Radial thickness must be less than the centerline diameter');
    }
  }

  for (const [index, canopy] of composition.canopies.entries()) {
    checkUnique(canopy.exits, ['canopies', index, 'exits']);
    checkUnique(canopy.ceilingFixings, ['canopies', index, 'ceilingFixings']);
    if (ceiling && canopy.dropMm.value > ceiling.value)
      issue(['canopies', index, 'dropMm'], 'Canopy extends below the floor');
    for (const key of ['exits', 'ceilingFixings'] as const) {
      for (const [pointIndex, anchor] of canopy[key].entries()) {
        const { x, y, z } = anchor.point;
        const footprint = canopy.footprint;
        const inFootprint = footprint.type === 'round'
          ? Math.hypot(x.value, y.value) <= footprint.diameterMm.value / 2
          : Math.abs(x.value) <= footprint.widthMm.value / 2 && Math.abs(y.value) <= footprint.depthMm.value / 2;
        if (!inFootprint || z.value < 0 || z.value > canopy.dropMm.value)
          issue(['canopies', index, key, pointIndex, 'point'], 'Anchor must be within the canopy envelope');
        if (key === 'ceilingFixings' && z.value !== canopy.dropMm.value)
          issue(['canopies', index, key, pointIndex, 'point', 'z'], 'Ceiling fixing must lie on the upper canopy face');
      }
    }
  }

  for (const [index, suspension] of composition.suspensions.entries()) {
    const canopy = composition.canopies.find(item => item.id === suspension.from.canopyId);
    const element = composition.elements.find(item => item.id === suspension.to.elementId);
    if (!canopy?.exits.some(exit => exit.id === suspension.from.exitId))
      issue(['suspensions', index, 'from'], 'Unknown canopy exit');
    if (!element?.attachments.some(attachment => attachment.id === suspension.to.attachmentId))
      issue(['suspensions', index, 'to'], 'Unknown element attachment');
  }
});

export type Composition = z.infer<typeof compositionSchema>;
export type Element = Composition['elements'][number];
export type Canopy = Composition['canopies'][number];
export type Shape = z.infer<typeof shapeSchema>;
export type Point = z.infer<typeof pointSchema>;
export type Axis = Point['x'];
