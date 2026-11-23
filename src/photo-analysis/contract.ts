import { z } from 'zod';
import {
  directions, finishes, imageTypes, materials, maxPhotos, maxTotalPhotoBytes, photoSchema, productTypes,
} from '../domain/project.ts';

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const summary = z.string().max(1000);
const label = z.string().trim().min(1).max(120);

export const photoAnalysisInputSchema = z.strictObject({
  photos: z.array(photoSchema).min(1).max(maxPhotos),
}).superRefine(({ photos }, ctx) => {
  if (new Set(photos.map(photo => photo.id)).size !== photos.length) {
    ctx.addIssue({ code: 'custom', path: ['photos'], message: 'Photo IDs must be unique.' });
  }
  if (photos.reduce((sum, photo) => sum + photo.size, 0) > maxTotalPhotoBytes) {
    ctx.addIssue({ code: 'custom', path: ['photos'], message: 'Total photo size exceeds 32 MiB.' });
  }
});

const payload = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('productKind'), value: z.enum(Object.keys(productTypes) as (keyof typeof productTypes)[]) }),
  z.strictObject({
    kind: z.literal('material'),
    part: label,
    material: z.enum(Object.keys(materials) as (keyof typeof materials)[]),
    materialDetail: summary.optional(),
    finish: z.enum(Object.keys(finishes) as (keyof typeof finishes)[]).optional(),
    finishDetail: summary.optional(),
    color: label.optional(),
  }),
  z.strictObject({ kind: z.literal('lightDirection'), directionId: z.enum(Object.keys(directions) as (keyof typeof directions)[]) }),
]);

const providerSuggestion = z.strictObject({
  id,
  photoId: id,
  confidence: z.enum(['high', 'medium', 'low']),
  confidenceScore: z.number().min(0).max(1).optional(),
  note: summary.optional(),
  payload,
});

export const photoAnalysisProviderResultSchema = z.strictObject({
  suggestions: z.array(providerSuggestion).max(32),
  summary: summary.optional(),
  warnings: z.array(summary).max(12).optional(),
});

const resultFields = {
  apiVersion: z.literal(1),
  photos: z.array(photoSchema.extend({
    widthPx: z.number().int().positive(),
    heightPx: z.number().int().positive(),
  })).min(1).max(maxPhotos),
  summary: summary.optional(),
  warnings: z.array(summary).max(12).optional(),
};

export const photoAnalysisResponseSchema = z.discriminatedUnion('mode', [
  z.strictObject({
    ...resultFields, mode: z.literal('metadata_only'), suggestions: z.tuple([]),
  }),
  z.strictObject({
    ...resultFields,
    mode: z.literal('visual_analysis'),
    suggestions: z.array(providerSuggestion.extend({ source: z.literal('estimated') })).max(32),
  }),
]);

export const photoAnalysisCapabilitiesSchema = z.strictObject({
  apiVersion: z.literal(1),
  mode: z.enum(['metadata_only', 'visual_analysis']),
  acceptedTypes: z.array(z.enum(imageTypes)),
  maxPhotos: z.number().int().positive(),
  maxPhotoBytes: z.number().int().positive(),
  maxTotalPhotoBytes: z.number().int().positive(),
  maxPhotoPixels: z.number().int().positive(),
  maxTotalPhotoPixels: z.number().int().positive(),
});

export type PhotoAnalysisInput = z.infer<typeof photoAnalysisInputSchema>;
export type PhotoAnalysisResponse = z.infer<typeof photoAnalysisResponseSchema>;
export type PhotoAnalysisCapabilities = z.infer<typeof photoAnalysisCapabilitiesSchema>;
