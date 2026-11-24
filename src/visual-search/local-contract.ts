import { z } from 'zod';
import { photoSchema } from '../domain/project.ts';
import { sourceUrlSchema } from './catalogue.ts';

export const maxReferences = 256;
export const maxLocalPhotoBytes = 5 * 1024 * 1024;
export const localSearchInputSchema = z.strictObject({ photo: photoSchema });
export const referenceSchema = z.strictObject({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  title: z.string().trim().min(1).max(180),
  source: sourceUrlSchema.optional(),
});
export const localSearchResponseSchema = z.strictObject({
  matches: z.array(referenceSchema.extend({ match: z.enum(['same_file', 'similar_image']) })).max(5),
  originalVerified: z.literal(false),
});
export const localSearchCapabilitiesSchema = z.strictObject({
  available: z.boolean(),
  referenceCount: z.number().int().min(0).max(maxReferences),
});
