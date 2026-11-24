import { z } from 'zod';
import { maxTotalPhotoBytes } from '../../../../domain/project.ts';
import { buildDetailedRfq, detailedRfqRequestSchema, textDetailedRfq } from '../../../../rfq/detailed.ts';
import { languageSchema, RfqConflict } from '../../../../rfq/quick.ts';
import { InvalidPhoto, readProjectPhotos } from '../../../../server/project-photos.ts';
import { limitBody, parseMultipart, RequestProblem } from '../../../../server/request-body.ts';
import { PdfBusy, PdfUnavailable, renderRfqPdf } from '../../../../server/rfq-pdf.ts';

export const runtime = 'nodejs';
const megabyte = 1024 * 1024;
const noStore = { 'Cache-Control': 'no-store' };

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new RequestProblem(400, 'invalid_body', 'Expected valid JSON.');
  }
}

async function parseForm(request: Request) {
  const form = await parseMultipart(request, maxTotalPhotoBytes + 2 * megabyte);
  const payload = form.getAll('input');
  if (payload.length !== 1 || typeof payload[0] !== 'string')
    throw new RequestProblem(400, 'invalid_body', 'Exactly one text field named input is required.');
  if (new TextEncoder().encode(payload[0]).length > megabyte)
    throw new RequestProblem(413, 'request_too_large', 'JSON input exceeds 1 MiB.');
  return { input: parseJson(payload[0]), form };
}

export async function POST(request: Request): Promise<Response> {
  const search = new URL(request.url).searchParams;
  const language = languageSchema.safeParse(search.get('lang') ?? 'en');
  const format = search.get('format') ?? 'text';
  if (!language.success || (format !== 'text' && format !== 'pdf'))
    return Response.json(
      { error: 'invalid_options', message: 'Use lang=en|zh|en-zh and format=text|pdf.' },
      { status: 400, headers: noStore },
    );
  if (request.headers.get('sec-fetch-site') === 'cross-site')
    return Response.json(
      { error: 'cross_site_request', message: 'Cross-site document generation is disabled.' },
      { status: 403, headers: noStore },
    );

  try {
    const mediaType = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    let input: unknown;
    let form: FormData | undefined;
    if (mediaType === 'multipart/form-data' && format === 'pdf') {
      ({ input, form } = await parseForm(request));
    } else if (mediaType === 'application/json') {
      const bytes = await limitBody(request, megabyte);
      let data: string;
      try {
        data = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        throw new RequestProblem(400, 'invalid_body', 'JSON input must be UTF-8.');
      }
      input = parseJson(data);
    } else {
      throw new RequestProblem(415, 'unsupported_media_type', 'Send JSON or use multipart with format=pdf.');
    }

    const parsed = detailedRfqRequestSchema.parse(input);
    const model = buildDetailedRfq(parsed);
    if (format === 'text') {
      return Response.json(
        { language: language.data, text: textDetailedRfq(model, language.data) },
        { headers: noStore },
      );
    }

    if (!form && parsed.project.photos.length)
      throw new InvalidPhoto('PDF generation requires the original bytes for all project photos.');
    const photos = form ? await readProjectPhotos(form, parsed.project.photos) : [];
    const primaryIndex = photos.findIndex(photo => photo.metadata.id === parsed.project.primaryPhotoId);
    if (primaryIndex > 0) photos.unshift(photos.splice(primaryIndex, 1)[0]);

    const output = await renderRfqPdf(model, photos, language.data);
    const code = (parsed.project.code || 'light-forge').replace(/[^A-Za-z0-9_-]/g, '-');
    const revSuffix = parsed.revision ? `-v${parsed.revision}` : '';
    return new Response(output, {
      headers: {
        ...noStore,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${code}-detailed-rfq${revSuffix}-${language.data}.pdf"`,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        {
          error: 'invalid_snapshot',
          issues: error.issues.map(issue => ({ path: issue.path, message: issue.message })),
        },
        { status: 422, headers: noStore },
      );
    }
    const problem =
      error instanceof RequestProblem
        ? error
        : error instanceof InvalidPhoto
          ? new RequestProblem(422, 'invalid_photo', error.message)
          : error instanceof RfqConflict
            ? new RequestProblem(422, 'project_geometry_conflict', error.message)
            : error instanceof PdfBusy
              ? new RequestProblem(503, 'pdf_busy', error.message)
              : error instanceof PdfUnavailable
                ? new RequestProblem(503, 'pdf_unavailable', error.message)
                : null;
    if (!problem) throw error;
    return Response.json(
      { error: problem.code, message: problem.message },
      { status: problem.status, headers: noStore },
    );
  }
}
