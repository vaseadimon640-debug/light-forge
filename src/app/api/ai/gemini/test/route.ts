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
  const result = await geminiService.testConnection(request.signal);
  return Response.json(result, { status: 200, headers });
}
