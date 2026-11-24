import { fingerprintPhoto, matchLocalReferences, openLocalIndex } from '../../../../server/visual-catalogue-index.ts';
import { InvalidPhoto, readProjectPhotos } from '../../../../server/project-photos.ts';
import { parseMultipart, RequestProblem } from '../../../../server/request-body.ts';
import { localSearchInputSchema, maxLocalPhotoBytes } from '../../../../visual-search/local-contract.ts';

export const runtime = 'nodejs';

const response = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET() {
  const index = await openLocalIndex();
  return response({ available: Boolean(index), referenceCount: index?.references.length ?? 0 });
}

export async function POST(request: Request) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return response({ error: 'cross_site_request' }, 403);
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'multipart/form-data') {
    return response({ error: 'unsupported_media_type' }, 415);
  }
  const index = await openLocalIndex();
  if (!index) return response({ error: 'local_index_unavailable' }, 503);

  try {
    const form = await parseMultipart(request, maxLocalPhotoBytes + 64 * 1024);
    const input = form.getAll('input');
    if (input.length !== 1 || typeof input[0] !== 'string' || input[0].length > 8192) {
      return response({ error: 'invalid_body' }, 400);
    }
    let raw: unknown;
    try { raw = JSON.parse(input[0]); } catch { return response({ error: 'invalid_body' }, 400); }
    const parsed = localSearchInputSchema.safeParse(raw);
    if (!parsed.success || parsed.data.photo.size > maxLocalPhotoBytes) return response({ error: 'invalid_photo' }, 422);
    const [photo] = await readProjectPhotos(form, [parsed.data.photo]);
    const fingerprint = await fingerprintPhoto(photo.bytes).catch(() => { throw new InvalidPhoto('Could not decode photo.'); });
    return response(matchLocalReferences(index, fingerprint));
  } catch (error) {
    if (error instanceof RequestProblem) return response({ error: error.code }, error.status);
    if (error instanceof InvalidPhoto) return response({ error: 'invalid_photo' }, 422);
    throw error;
  }
}
