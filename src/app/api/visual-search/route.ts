import { catalogueSearch, searchInputSchema, searchLinks, type SearchResponse } from '../../../visual-search/catalogue.ts';
import { describeWithGemini, geminiStatus } from '../../../server/visual-search-gemini.ts';
import { InvalidPhoto, readProjectPhotos } from '../../../server/project-photos.ts';
import { limitBody, parseMultipart, RequestProblem } from '../../../server/request-body.ts';

export const runtime = 'nodejs';

const headers = { 'Cache-Control': 'no-store' };
const response = (data: unknown, status = 200) => Response.json(data, { status, headers });

export function GET() {
  return response({ gemini: geminiStatus(), serpApi: { enabled: false }, manualLens: true, paidEnabled: false });
}

export async function POST(request: Request) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return response({ error: 'cross_site_request' }, 403);
  const mediaType = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (mediaType !== 'multipart/form-data' && mediaType !== 'application/json')
    return response({ error: 'unsupported_media_type' }, 415);
  try {
    const form = mediaType === 'multipart/form-data' ? await parseMultipart(request, 6 * 1024 * 1024) : undefined;
    if (form && form.getAll('input').length !== 1) return response({ error: 'invalid_body' }, 400);
    const raw = form ? form.get('input') : new TextDecoder().decode(await limitBody(request, 8192));
    if (typeof raw !== 'string' || raw.length > 8192) return response({ error: 'invalid_body' }, 400);
    let input: unknown;
    try { input = JSON.parse(raw); } catch { return response({ error: 'invalid_body' }, 400); }
    const parsed = searchInputSchema.safeParse(input);
    if (!parsed.success) return response({ error: 'invalid_search' }, 422);
    const { query, mode, photo, runGemini } = parsed.data;
    let traits: string[] = [];
    let warning: string | undefined;
    if (runGemini) {
      if (!form || !photo || photo.size > 5 * 1024 * 1024) return response({ error: 'invalid_photo' }, 422);
      const [selected] = await readProjectPhotos(form, [photo]);
      try { traits = await describeWithGemini(selected, request.signal); }
      catch (exception) {
        const reason = exception instanceof Error ? exception.message : '';
        warning = ['gemini_disabled','gemini_quota','gemini_busy','gemini_daily_limit','gemini_model_unavailable'].includes(reason)
          ? reason : 'gemini_failed';
      }
    }
    const terms = [query, ...traits].join(' ').slice(0, 300);
    const results = catalogueSearch(query || terms, mode).map(item => !query && item.category === 'verified_original'
      ? { ...item, category: 'visual_alternative' as const, evidence: 'catalogue_similarity' as const } : item);
    const payload: SearchResponse = { results, links: searchLinks(terms, mode), traits, warning,
      originalVerified: false, gemini: geminiStatus(), paidEnabled: false };
    return response(payload);
  } catch (error) {
    if (error instanceof RequestProblem) return response({ error: error.code }, error.status);
    if (error instanceof InvalidPhoto) return response({ error: 'invalid_photo' }, 422);
    throw error;
  }
}
