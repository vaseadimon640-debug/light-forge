import { geminiService } from '../../../../../server/gemini-client.ts';

export const runtime = 'nodejs';

export function GET(): Response {
  return Response.json(geminiService.getStatus(), {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}
