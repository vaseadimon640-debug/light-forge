import { z } from 'zod';
import { resolveComposition } from '../../../../geometry/resolve.ts';

const MAX_BYTES = 1024 * 1024;

export async function POST(request: Request): Promise<Response> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json')
    return Response.json({ error: 'expected_json' }, { status: 415 });
  if (!request.body) return Response.json({ error: 'invalid_json' }, { status: 400 });
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let received = 0;
  let json = '';
  let input: unknown;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      received += result.value.byteLength;
      if (received > MAX_BYTES) {
        await reader.cancel();
        return Response.json({ error: 'request_too_large' }, { status: 413 });
      }
      json += decoder.decode(result.value, { stream: true });
    }
    json += decoder.decode();
    input = JSON.parse(json);
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  } finally {
    reader.releaseLock();
  }
  try {
    return Response.json(resolveComposition(input));
  } catch (error) {
    if (error instanceof z.ZodError)
      return Response.json({
        error: 'invalid_composition',
        issues: error.issues.map(issue => ({ path: issue.path, message: issue.message })),
      }, { status: 422 });
    throw error;
  }
}
