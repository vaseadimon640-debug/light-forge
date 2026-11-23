export class RequestProblem extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function limitBody(request: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
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

export async function parseMultipart(request: Request, maxBytes: number): Promise<FormData> {
  const bytes = await limitBody(request, maxBytes);
  try {
    return await new Response(bytes, { headers: { 'Content-Type': request.headers.get('content-type')! } }).formData();
  } catch {
    throw new RequestProblem(400, 'invalid_body', 'Expected multipart form data.');
  }
}
