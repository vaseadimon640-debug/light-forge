import { z } from 'zod';
import {
  dimmingModes,
  directions,
  finishes,
  ipRatings,
  materials,
  productTypes,
} from '../domain/project.ts';

export const productTypeKeys = Object.keys(productTypes) as [
  keyof typeof productTypes,
  ...(keyof typeof productTypes)[],
];
export const materialKeys = Object.keys(materials) as [
  keyof typeof materials,
  ...(keyof typeof materials)[],
];
export const finishKeys = Object.keys(finishes) as [
  keyof typeof finishes,
  ...(keyof typeof finishes)[],
];
export const directionKeys = Object.keys(directions) as [
  keyof typeof directions,
  ...(keyof typeof directions)[],
];

export const geminiErrorCodeSchema = z.enum([
  'missing_api_key',
  'invalid_api_key',
  'model_unavailable',
  'paid_model_blocked',
  'quota_exceeded',
  'daily_limit_reached',
  'network_error',
  'timeout',
  'busy',
  'invalid_input',
  'invalid_response',
]);
export type GeminiErrorCode = z.infer<typeof geminiErrorCodeSchema>;

export const geminiLastTestSchema = z.strictObject({
  at: z.iso.datetime(),
  ok: z.boolean(),
  latencyMs: z.number().int().min(0),
  model: z.string().nullable(),
  code: geminiErrorCodeSchema.optional(),
  message: z.string().max(600),
});
export type GeminiLastTest = z.infer<typeof geminiLastTestSchema>;

export const geminiStatusResponseSchema = z.strictObject({
  apiVersion: z.literal(1),
  configured: z.boolean(),
  connected: z.boolean(),
  selectedModel: z.string().nullable(),
  configuredModel: z.string().nullable(),
  allowedModels: z.array(z.string()),
  availableFlashModels: z.array(z.string()),
  modelAvailable: z.boolean().nullable(),
  freeTierOnly: z.literal(true),
  paidAutoSwitchDisabled: z.literal(true),
  requestsToday: z.number().int().min(0),
  dailyLimit: z.number().int().positive(),
  lastTest: geminiLastTestSchema.nullable(),
});
export type GeminiStatusResponse = z.infer<typeof geminiStatusResponseSchema>;

export const geminiTestResponseSchema = z.strictObject({
  ok: z.boolean(),
  code: geminiErrorCodeSchema.optional(),
  message: z.string().max(600),
  status: geminiStatusResponseSchema,
});
export type GeminiTestResponse = z.infer<typeof geminiTestResponseSchema>;

// =============================================================================
// Photo Analysis Contract (all 9 required luminaire visual traits)
// =============================================================================

export const certaintyStatusSchema = z.enum(['confirmed', 'estimated', 'unknown']);
export type CertaintyStatus = z.infer<typeof certaintyStatusSchema>;

export const photoCertaintySchema = z.enum(['estimated', 'unknown']);

export const geminiPhotoAnalysisSchema = z.strictObject({
  apiVersion: z.literal(1),
  model: z.string().min(1).max(120),
  analyzedAt: z.iso.datetime(),
  photoName: z.string().min(1).max(255),
  widthPx: z.number().int().positive(),
  heightPx: z.number().int().positive(),
  fixtureType: z.strictObject({
    value: z.enum(productTypeKeys).nullable(),
    status: photoCertaintySchema,
    note: z.string().max(300).optional(),
  }),
  shape: z.strictObject({
    value: z.string().max(200).nullable(),
    status: photoCertaintySchema,
  }),
  elementCount: z.strictObject({
    value: z.number().int().min(1).max(500).nullable(),
    status: photoCertaintySchema,
    note: z.string().max(240).optional(),
  }),
  primaryColors: z.array(z.string().trim().min(1).max(80)).max(8),
  suspectedMaterial: z.strictObject({
    key: z.enum(materialKeys).nullable(),
    label: z.string().max(160).nullable(),
    status: photoCertaintySchema,
    uncertaintyReason: z.string().max(320).optional(),
  }),
  suspectedFinish: z.strictObject({
    key: z.enum(finishKeys).nullable(),
    label: z.string().max(160).nullable(),
    status: photoCertaintySchema,
    uncertaintyReason: z.string().max(320).optional(),
  }),
  suspensionType: z.strictObject({
    value: z.string().max(160).nullable(),
    status: photoCertaintySchema,
  }),
  lightDirection: z.strictObject({
    value: z.enum(directionKeys).nullable(),
    status: photoCertaintySchema,
  }),
  structuralDetails: z.array(z.string().trim().min(1).max(200)).max(12),
  dimensionsCannotBeVerifiedFromPhoto: z.literal(true),
  unverifiableNotice: z.string().max(500),
  sourceDisclaimer: z.string().max(500),
  summary: z.string().max(1000),
  warnings: z.array(z.string().max(300)).max(10),
});
export type GeminiPhotoAnalysis = z.infer<typeof geminiPhotoAnalysisSchema>;

// =============================================================================
// Technical Drawing & PDF Extraction Contract (dimensions strictly in mm)
// =============================================================================

function makeNumericFieldSchema(min = 0, max = 10_000_000) {
  return z.strictObject({
    value: z.number().finite().min(min).max(max).nullable(),
    originalText: z.string().max(120).optional(),
    originalUnit: z.string().max(24).optional(),
    status: certaintyStatusSchema,
    source: z.enum(['documentation', 'estimated', 'unknown']),
  });
}

function makeTextFieldSchema(maxLen = 160) {
  return z.strictObject({
    value: z.string().max(maxLen).nullable(),
    originalText: z.string().max(160).optional(),
    status: certaintyStatusSchema,
    source: z.enum(['documentation', 'estimated', 'unknown']),
  });
}

export const geminiDrawingAnalysisSchema = z.strictObject({
  apiVersion: z.literal(1),
  model: z.string().min(1).max(120),
  analyzedAt: z.iso.datetime(),
  fileName: z.string().min(1).max(255),
  mimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
  fileSizeBytes: z.number().int().positive(),
  unitStandard: z.literal('mm'),
  dimensionsMm: z.strictObject({
    width: makeNumericFieldSchema(0, 1_000_000),
    height: makeNumericFieldSchema(0, 1_000_000),
    depth: makeNumericFieldSchema(0, 1_000_000),
    diameter: makeNumericFieldSchema(0, 1_000_000),
    innerDiameter: makeNumericFieldSchema(0, 1_000_000),
    profileHeight: makeNumericFieldSchema(0, 1_000_000),
    profileThickness: makeNumericFieldSchema(0, 1_000_000),
  }),
  electrical: z.strictObject({
    wattageW: makeNumericFieldSchema(0, 100_000),
    lumensLm: makeNumericFieldSchema(0, 10_000_000),
    cctK: makeNumericFieldSchema(1000, 20000),
    cri: makeNumericFieldSchema(0, 100),
    voltage: makeTextFieldSchema(120),
    ipRating: z.strictObject({
      value: z.enum(ipRatings).nullable(),
      rawValue: z.string().max(40).optional(),
      status: certaintyStatusSchema,
      source: z.enum(['documentation', 'estimated', 'unknown']),
    }),
    dimming: z.strictObject({
      value: z.enum(dimmingModes).nullable(),
      rawValue: z.string().max(80).optional(),
      status: certaintyStatusSchema,
      source: z.enum(['documentation', 'estimated', 'unknown']),
    }),
  }),
  materials: z
    .array(
      z.strictObject({
        part: z.string().trim().min(1).max(120),
        materialKey: z.enum(materialKeys).nullable(),
        label: z.string().trim().min(1).max(160),
        status: certaintyStatusSchema,
        source: z.enum(['documentation', 'estimated', 'unknown']),
      }),
    )
    .max(16),
  finishes: z
    .array(
      z.strictObject({
        part: z.string().trim().min(1).max(120),
        finishKey: z.enum(finishKeys).nullable(),
        label: z.string().trim().min(1).max(160),
        color: z.string().trim().max(120).optional(),
        status: certaintyStatusSchema,
        source: z.enum(['documentation', 'estimated', 'unknown']),
      }),
    )
    .max(16),
  documentNotes: z.array(z.string().max(300)).max(12),
  warnings: z.array(z.string().max(300)).max(12),
  summary: z.string().max(1000),
});
export type GeminiDrawingAnalysis = z.infer<typeof geminiDrawingAnalysisSchema>;

export const maxDrawingBytes = 15 * 1024 * 1024; // 15 MiB inline PDF / drawing limit
export const drawingMimeTypes = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const geminiErrorResponseSchema = z.strictObject({
  error: geminiErrorCodeSchema,
  message: z.string().max(600),
});
export type GeminiErrorResponse = z.infer<typeof geminiErrorResponseSchema>;
