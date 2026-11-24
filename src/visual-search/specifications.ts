import { z } from 'zod';

export const specificationsSchema = z.strictObject({
  designer: z.string().optional(),
  form: z.string().optional(),
  materials: z.array(z.strictObject({ part: z.string(), material: z.string() })).optional(),
  finishes: z.array(z.strictObject({ part: z.string(), code: z.string(), name: z.string() })).optional(),
  dimensionsReferTo: z.string().optional(),
  standardMaxBandLengthMm: z.number().positive().optional(),
  lighting: z.strictObject({
    sourceType: z.string(),
    sourceVoltageV: z.number().positive(),
    supplyVoltageV: z.array(z.strictObject({ min: z.number().positive(), max: z.number().positive() })),
    configurations: z.array(z.strictObject({
      ringWidthMm: z.number().positive(),
      direction: z.enum(['up', 'down']),
      powerW: z.number().positive(),
      netWeightKg: z.number().positive(),
      outputs: z.array(z.strictObject({ cctK: z.number().positive(), lumens: z.number().positive() })),
    })),
  }).optional(),
});

type Specifications = z.infer<typeof specificationsSchema>;
type LightingConfiguration = NonNullable<Specifications['lighting']>['configurations'][number];

function configuration(
  ringWidthMm: number,
  direction: LightingConfiguration['direction'],
  powerW: number,
  netWeightKg: number,
  flux: [number, number, number],
): LightingConfiguration {
  return {
    ringWidthMm, direction, powerW, netWeightKg,
    outputs: [
      { cctK: 2700, lumens: flux[0] },
      { cctK: 3000, lumens: flux[1] },
      { cctK: 4000, lumens: flux[2] },
    ],
  };
}

// Emmemobili MYLINE technical sheet, pp. 2–4. The configuration table
// identifies ring widths and light directions independently of SKU.
export const mylineSpecifications = {
  designer: 'Adele Martelli',
  form: 'Подвесное кольцо',
  materials: [
    { part: 'Кольцо', material: 'Латунь' },
    { part: 'Декоративные ремни', material: 'Кожа' },
  ],
  finishes: [
    { part: 'Кольцо', code: 'O', name: 'Natural Satin Brass' },
    { part: 'Кольцо', code: 'OB', name: 'Burnished Hand-Brushed Brass' },
    { part: 'Декоративные ремни', code: '602', name: 'Brezza Leather · Moro' },
  ],
  dimensionsReferTo: 'Латунное кольцо',
  standardMaxBandLengthMm: 2000,
  lighting: {
    sourceType: 'LED strip',
    sourceVoltageV: 24,
    supplyVoltageV: [{ min: 220, max: 240 }, { min: 110, max: 120 }],
    configurations: [
      configuration(700, 'up', 45, 5, [3288, 3609, 3930]),
      configuration(700, 'down', 44, 5, [3239, 3555, 3871]),
      configuration(900, 'up', 59, 7, [4354, 4779, 5204]),
      configuration(900, 'down', 59, 7, [4305, 4725, 5145]),
    ],
  },
} satisfies Specifications;
