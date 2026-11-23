import type { ProjectSnapshot } from '../storage/projects.ts';
import { photoAnalysisInputSchema, photoAnalysisResponseSchema, type PhotoAnalysisResponse } from './contract.ts';

export class PhotoAnalysisError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export async function requestPhotoAnalysis(
  snapshot: ProjectSnapshot,
  photoIds: string[],
  signal?: AbortSignal,
): Promise<PhotoAnalysisResponse> {
  const photos = photoIds.map(id => snapshot.project.photos.find(photo => photo.id === id));
  const input = photoAnalysisInputSchema.parse({ photos });
  const form = new FormData();
  form.set('input', JSON.stringify(input));
  for (const photo of input.photos) {
    const original = Object.hasOwn(snapshot.originals, photo.id) ? snapshot.originals[photo.id] : undefined;
    if (!(original instanceof Blob) || original.type !== photo.type || original.size !== photo.size)
      throw new PhotoAnalysisError(422, 'invalid_photo');
    form.set(`photo:${photo.id}`, original, photo.name);
  }
  const response = await fetch('/api/photo-analysis', { method: 'POST', body: form, signal });
  const value: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const error = value && typeof value === 'object' && 'error' in value && typeof value.error === 'string'
      ? value.error : 'photo_analysis_failed';
    throw new PhotoAnalysisError(response.status, error);
  }
  const result = photoAnalysisResponseSchema.safeParse(value);
  if (!result.success) throw new PhotoAnalysisError(502, 'invalid_response');
  return result.data;
}
