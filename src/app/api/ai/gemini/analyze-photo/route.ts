import { maxPhotoBytes } from '../../../../../domain/project.ts';
import {
  GeminiServiceError,
  geminiService,
} from '../../../../../server/gemini-client.ts';
import { parseMultipart, RequestProblem } from '../../../../../server/request-body.ts';

export const runtime = 'nodejs';

const headers = { 'Cache-Control': 'no-store' };

export async function POST(request: Request): Promise<Response> {
  if (request.headers.get('sec-fetch-site') === 'cross-site') {
    return Response.json(
      { error: 'invalid_input', message: 'Cross-site requests are not allowed.' },
      { status: 403, headers },
    );
  }

  const mediaType = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (mediaType !== 'multipart/form-data') {
    return Response.json(
      { error: 'invalid_input', message: 'Отправьте фотографию как multipart/form-data.' },
      { status: 415, headers },
    );
  }

  try {
    const form = await parseMultipart(request, maxPhotoBytes + 128 * 1024);
    const entry = form.get('file');
    if (!(entry instanceof File)) {
      return Response.json(
        { error: 'invalid_input', message: 'Не передано поле file с изображением.' },
        { status: 400, headers },
      );
    }

    const rawModel = form.get('model');
    const modelOverride = typeof rawModel === 'string' && rawModel.trim() ? rawModel.trim().slice(0, 80) : undefined;
    const deepAnalysis = form.get('deepAnalysis') === '1' || form.get('deepAnalysis') === 'true';

    const bytes = new Uint8Array(await entry.arrayBuffer());
    const result = await geminiService.analyzePhoto(
      {
        name: entry.name || 'luminaire-photo.jpg',
        mimeType: entry.type || 'application/octet-stream',
        bytes,
      },
      request.signal,
      { modelOverride, deepAnalysis },
    );
    return Response.json(result, { status: 200, headers });
  } catch (error) {
    if (error instanceof RequestProblem) {
      return Response.json(
        { error: 'invalid_input', message: error.message },
        { status: error.status, headers },
      );
    }
    if (error instanceof GeminiServiceError) {
      return Response.json(
        { error: error.code, message: error.message },
        { status: error.httpStatus, headers },
      );
    }
    return Response.json(
      { error: 'invalid_response', message: 'Не удалось выполнить анализ фотографии через Gemini API.' },
      { status: 502, headers },
    );
  }
}
