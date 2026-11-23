import assert from 'node:assert/strict';
import { test } from 'node:test';
import { POST } from '../src/app/api/geometry/resolve/route.ts';
import { createGeometryExample } from '../src/geometry/examples.ts';
import { resolvedCompositionSchema } from '../src/geometry/result.ts';

const request = (body: string, mediaType = 'application/json') => new Request('http://test/api/geometry/resolve', {
  method: 'POST', body, headers: { 'content-type': mediaType },
});

test('geometry API conforms to its response schema', async () => {
  const response = await POST(request(JSON.stringify(createGeometryExample())));
  assert.equal(response.status, 200);
  assert.equal(resolvedCompositionSchema.parse(await response.json()).suspensions[0].cutLength.valueMm, 1200);
});

test('geometry API rejects unsupported, malformed, invalid and oversized inputs', async () => {
  for (const [input, status, code] of [
    [request('{}', 'text/plain'), 415, 'expected_json'],
    [request('{x'), 400, 'invalid_json'],
    [request('{}'), 422, 'invalid_composition'],
    [request(' '.repeat(1024 * 1024 + 1)), 413, 'request_too_large'],
  ] as const) {
    const response = await POST(input);
    assert.equal(response.status, status);
    assert.equal((await response.json()).error, code);
  }
});
