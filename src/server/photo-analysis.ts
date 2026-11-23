import { imageTypes, maxPhotoBytes, maxPhotos, maxTotalPhotoBytes } from '../domain/project.ts';
import {
  photoAnalysisInputSchema, photoAnalysisProviderResultSchema,
  type PhotoAnalysisCapabilities, type PhotoAnalysisResponse,
} from '../photo-analysis/contract.ts';
import { InvalidPhoto, maxPhotoPixels, maxTotalPhotoPixels, readProjectPhotos, type OriginalPhoto } from './project-photos.ts';
import { parseMultipart, RequestProblem } from './request-body.ts';

export interface PhotoAnalysisEngine {
  analyze(photos: readonly OriginalPhoto[], signal: AbortSignal): Promise<unknown>;
}

const noStore = { 'Cache-Control': 'no-store' };

function problem(status: number, error: string, message: string) {
  return Response.json({ error, message }, { status, headers: noStore });
}

export function createPhotoAnalysisHandlers(engine?: PhotoAnalysisEngine) {
  const mode = engine ? 'visual_analysis' : 'metadata_only';

  function GET(): Response {
    const result: PhotoAnalysisCapabilities = {
      apiVersion: 1, mode, acceptedTypes: [...imageTypes], maxPhotos, maxPhotoBytes, maxTotalPhotoBytes,
      maxPhotoPixels, maxTotalPhotoPixels,
    };
    return Response.json(result, { headers: noStore });
  }

  async function POST(request: Request): Promise<Response> {
    if (request.headers.get('sec-fetch-site') === 'cross-site')
      return problem(403, 'cross_site_request', 'Cross-site photo analysis is disabled.');
    const mediaType = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (mediaType !== 'multipart/form-data')
      return problem(415, 'unsupported_media_type', 'Send multipart/form-data.');

    try {
      const form = await parseMultipart(request, maxTotalPhotoBytes + 2 * 1024 * 1024);
      const [entry, duplicate] = form.getAll('input');
      if (typeof entry !== 'string' || duplicate !== undefined)
        return problem(400, 'invalid_body', 'Exactly one text field named input is required.');
      if (entry.length > 8192)
        return problem(413, 'request_too_large', 'The photo list exceeds the supported length.');
      let input: unknown;
      try { input = JSON.parse(entry); } catch { return problem(400, 'invalid_body', 'Expected valid JSON in input.'); }

      const manifest = photoAnalysisInputSchema.safeParse(input);
      if (!manifest.success) return Response.json({
        error: 'invalid_photo_list',
        issues: manifest.error.issues.map(issue => ({ path: issue.path, message: issue.message })),
      }, { status: 422, headers: noStore });

      const originals = await readProjectPhotos(form, manifest.data.photos);
      const photos = originals.map(({ metadata, widthPx, heightPx }) => ({ ...metadata, widthPx, heightPx }));
      if (!engine) {
        const result: PhotoAnalysisResponse = { apiVersion: 1, mode: 'metadata_only', photos, suggestions: [] };
        return Response.json(result, { headers: noStore });
      }

      try {
        const raw = await engine.analyze(originals, request.signal);
        const parsed = photoAnalysisProviderResultSchema.safeParse(raw);
        const photoIds = new Set(photos.map(photo => photo.id));
        if (!parsed.success ||
          parsed.data.suggestions.some(suggestion => !photoIds.has(suggestion.photoId)) ||
          new Set(parsed.data.suggestions.map(suggestion => suggestion.id)).size !== parsed.data.suggestions.length)
          return problem(502, 'invalid_engine_response', 'The analysis engine returned invalid suggestions.');
        const result: PhotoAnalysisResponse = {
          ...parsed.data,
          apiVersion: 1,
          mode: 'visual_analysis',
          photos,
          suggestions: parsed.data.suggestions.map(suggestion => ({ ...suggestion, source: 'estimated' })),
        };
        return Response.json(result, { headers: noStore });
      } catch {
        return problem(502, 'engine_error', 'The analysis engine could not process the selected photos.');
      }
    } catch (error) {
      if (error instanceof RequestProblem) return problem(error.status, error.code, error.message);
      if (error instanceof InvalidPhoto) return problem(422, 'invalid_photo', error.message);
      throw error;
    }
  }

  return { GET, POST };
}
