import { z } from 'zod';
import { measureMmSchema } from '../domain/project.ts';
import { footprintSchema, pointSchema, shapeSchema, siteSchema, yawSchema } from './schema.ts';

const quality = z.enum(['specified', 'estimated']);
const value = z.union([
  z.strictObject({ valueMm: z.number(), quality }),
  z.strictObject({ valueMm: z.null(), quality: z.literal('unknown'), missing: z.array(z.string()) }),
]);
const resolvedPoint = z.strictObject({ x: value, y: value, z: value });
const anchor = z.strictObject({ id: z.string(), label: z.string(), point: pointSchema, world: resolvedPoint });
const levels = z.strictObject({ fromFloor: value, belowCeiling: value, aboveTabletop: value });
const formulaTerm = z.strictObject({
  offsetMm: z.number(),
  variables: z.partialRecord(z.enum(['ceilingFromFloorMm', 'tabletopFromFloorMm']), z.number()),
  quality,
});
const formulaAxis = z.union([formulaTerm, z.strictObject({ missing: z.string() })]);

export const resolvedCompositionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  units: z.literal('mm'),
  compositionId: z.string(),
  site: siteSchema,
  elements: z.array(z.strictObject({
    id: z.string(),
    name: z.string(),
    productComponentId: z.string().optional(),
    shape: shapeSchema,
    geometry: z.strictObject({
      widthMm: z.number(), depthMm: z.number(), heightMm: z.number(), quality, heightQuality: quality,
      representation: z.enum(['envelope', 'parametric']),
      arc: z.strictObject({
        centerlineRadiusMm: z.number(), halfSweepRad: z.number(), centerZMm: z.number(),
        innerRadiusMm: z.number(), outerRadiusMm: z.number(),
      }).optional(),
    }),
    origin: resolvedPoint,
    yawDeg: yawSchema.optional(),
    lowest: levels,
    highest: levels,
    issues: z.array(z.enum(['bodyBelowFloor', 'bodyAboveCeiling'])),
    attachments: z.array(anchor),
  })),
  canopies: z.array(z.strictObject({
    id: z.string(), name: z.string(), footprint: footprintSchema, dropMm: measureMmSchema,
    origin: resolvedPoint, yawDeg: yawSchema.optional(), exits: z.array(anchor), ceilingFixings: z.array(anchor),
  })),
  suspensions: z.array(z.strictObject({
    id: z.string(),
    type: z.enum(['loadBearingCable', 'decorativeStrap']),
    from: z.strictObject({ canopyId: z.string(), exitId: z.string() }),
    to: z.strictObject({ elementId: z.string(), attachmentId: z.string() }),
    points: z.array(resolvedPoint),
    verticalDrop: value,
    pathLength: value,
    cutLength: value,
    status: z.enum(['invalid', 'incomplete', 'calculated']),
    formula: z.strictObject({
      segments: z.array(z.strictObject({ x: formulaAxis, y: formulaAxis, z: formulaTerm })),
      rule: z.literal('sum(hypot(deltaX, deltaY, deltaZ)) + allowanceMm'),
      allowanceMm: measureMmSchema.nullable(),
    }),
  })),
});

export type ResolvedValue = z.infer<typeof value>;
export type ResolvedComposition = z.infer<typeof resolvedCompositionSchema>;
