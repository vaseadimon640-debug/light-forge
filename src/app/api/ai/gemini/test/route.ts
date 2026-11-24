import { geminiService } from '../../../../../server/gemini-client.ts';

export const runtime = 'nodejs';

const headers = { 'Cache-Control': 'no-store' };

export async function POST(request: Request): Promise<Response> {
  if (request.headers.get('sec-fetch-site') === 'cross-site') {
    return Response.json(
      { error: 'invalid_input', message: 'Cross-site requests are not allowed.' },
      { status: 403, headers },
    );
  }

  let modelOverride: string | undefined;
  const mediaType = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (mediaType === 'application/json') {
    try {
      const body = (await request.json()) as { model?: unknown };
      if (typeof body?.model === 'string' && body.model.trim()) {
        modelOverride = body.model.trim().slice(0, 80);
      }
    } catch {
      // Ignore empty/malformed optional body
    }
  }

  const result = await geminiService.testConnection(request.signal, { modelOverride });
  return Response.json(result, { status: 200, headers });
}
