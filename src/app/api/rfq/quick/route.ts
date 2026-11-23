import { imageSize } from 'image-size';
import { z } from 'zod';
import { maxTotalPhotoBytes, type Project } from '../../../../domain/project.ts';
import { buildQuickRfq, languageSchema, quickRfqRequestSchema, RfqConflict, textQuickRfq } from '../../../../rfq/quick.ts';
import { InvalidPhoto, PdfBusy, PdfUnavailable, renderRfqPdf, type OriginalPhoto } from '../../../../server/rfq-pdf.ts';

export const runtime = 'nodejs';
const megabyte = 1024 * 1024;
const typeExtension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;
const noStore = { 'Cache-Control': 'no-store' };

class RequestProblem extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function limitBody(request: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const declared = request.headers.get('content-length');
  if (declared && Number(declared) > maxBytes) throw new RequestProblem(413, 'request_too_large', 'Request exceeds supported size.');
  if (!request.body) throw new RequestProblem(400, 'invalid_body', 'Request body is required.');

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (received > maxBytes) {
        void reader.cancel().catch(() => undefined);
        throw new RequestProblem(413, 'request_too_large', 'Request exceeds supported size.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function parseJson(value: string): unknown {
  try { return JSON.parse(value); } catch {
    throw new RequestProblem(400, 'invalid_body', 'Expected valid JSON.');
  }
}

async function parseForm(request: Request) {
  const bytes = await limitBody(request, maxTotalPhotoBytes + 2 * megabyte);
  let form: FormData;
  try {
    form = await new Response(bytes, { headers: { 'Content-Type': request.headers.get('content-type')! } }).formData();
  } catch {
    throw new RequestProblem(400, 'invalid_body', 'Expected multipart form data.');
  }
  const payload = form.getAll('input');
  if (payload.length !== 1 || typeof payload[0] !== 'string')
    throw new RequestProblem(400, 'invalid_body', 'Exactly one text field named input is required.');
  if (new TextEncoder().encode(payload[0]).length > megabyte)
    throw new RequestProblem(413, 'request_too_large', 'JSON input exceeds 1 MiB.');
  return { input: parseJson(payload[0]), form };
}

async function photosFrom(form: FormData, project: Project): Promise<OriginalPhoto[]> {
  const expected = new Set(project.photos.map(photo => `photo:${photo.id}`));
  for (const key of form.keys()) {
    if (key !== 'input' && !expected.has(key))
      throw new InvalidPhoto('The upload contains a file outside the project snapshot.');
  }
  const photos: OriginalPhoto[] = [];
  let pixels = 0;
  for (const metadata of project.photos) {
    const [image, duplicate] = form.getAll(`photo:${metadata.id}`);
    if (!image || duplicate !== undefined || typeof image === 'string' || image.type !== metadata.type || image.size !== metadata.size)
      throw new InvalidPhoto(`Provide the original photo matching metadata for ${metadata.name}.`);
    const bytes = new Uint8Array(await image.arrayBuffer());
    let info: ReturnType<typeof imageSize>;
    try { info = imageSize(bytes); } catch { throw new InvalidPhoto(`Invalid image data for ${metadata.name}.`); }
    if (info.type !== typeExtension[metadata.type] || !info.width || !info.height || info.width * info.height > 60_000_000)
      throw new InvalidPhoto(`Unsupported image type or pixel count for ${metadata.name}.`);
    pixels += info.width * info.height;
    if (pixels > 120_000_000) throw new InvalidPhoto('The combined photo pixel count exceeds 120 megapixels.');
    photos.push({ metadata, bytes });
  }
  const primaryIndex = photos.findIndex(photo => photo.metadata.id === project.primaryPhotoId);
  if (primaryIndex > 0) photos.unshift(photos.splice(primaryIndex, 1)[0]);
  return photos;
}

export async function POST(request: Request): Promise<Response> {
  const search = new URL(request.url).searchParams;
  const language = languageSchema.safeParse(search.get('lang') ?? 'en');
  const format = search.get('format') ?? 'text';
  if (!language.success || (format !== 'text' && format !== 'pdf'))
    return Response.json({ error: 'invalid_options', message: 'Use lang=en|zh|en-zh and format=text|pdf.' }, { status: 400, headers: noStore });
  if (request.headers.get('sec-fetch-site') === 'cross-site')
    return Response.json({ error: 'cross_site_request', message: 'Cross-site document generation is disabled.' }, { status: 403, headers: noStore });

  try {
    const mediaType = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    let input: unknown;
    let form: FormData | undefined;
    if (mediaType === 'multipart/form-data' && format === 'pdf') {
      ({ input, form } = await parseForm(request));
    } else if (mediaType === 'application/json') {
      const bytes = await limitBody(request, megabyte);
      let data: string;
      try { data = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch {
        throw new RequestProblem(400, 'invalid_body', 'JSON input must be UTF-8.');
      }
      input = parseJson(data);
    } else {
      throw new RequestProblem(415, 'unsupported_media_type', 'Send JSON or use multipart with format=pdf.');
    }
    const snapshot = quickRfqRequestSchema.parse(input);
    const model = buildQuickRfq(snapshot);
    if (format === 'text')
      return Response.json({ language: language.data, text: textQuickRfq(model, language.data) }, { headers: noStore });
    if (!form && snapshot.project.photos.length)
      throw new InvalidPhoto('PDF generation requires the original bytes for all project photos.');
    const photos = form ? await photosFrom(form, snapshot.project) : [];
    const output = await renderRfqPdf(model, photos, language.data);
    const code = (snapshot.project.code || 'light-forge').replace(/[^A-Za-z0-9_-]/g, '-');
    return new Response(output, {
      headers: {
        ...noStore,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${code}-quick-rfq-${language.data}.pdf"`,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({
      error: 'invalid_snapshot',
      issues: error.issues.map(issue => ({ path: issue.path, message: issue.message })),
    }, { status: 422, headers: noStore });
    const problem = (
      error instanceof RequestProblem ? error :
        error instanceof InvalidPhoto ? new RequestProblem(422, 'invalid_photo', error.message) :
        error instanceof RfqConflict ? new RequestProblem(422, 'project_geometry_conflict', error.message) :
        error instanceof PdfBusy ? new RequestProblem(503, 'pdf_busy', error.message) :
        error instanceof PdfUnavailable ? new RequestProblem(503, 'pdf_unavailable', error.message) :
        null
    );
    if (!problem) throw error;
    return Response.json({ error: problem.code, message: problem.message }, { status: problem.status, headers: noStore });
  }
}
