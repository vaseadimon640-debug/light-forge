import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GET, POST } from '../src/app/api/photo-analysis/route.ts';
import { photoAnalysisCapabilitiesSchema, photoAnalysisResponseSchema } from '../src/photo-analysis/contract.ts';
import { createPhotoAnalysisHandlers } from '../src/server/photo-analysis.ts';

// Complete 1×1 PNG. The analysis endpoint reads raster dimensions without a browser or external service.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+hVkcAAAAASUVORK5CYII=', 'base64');
const photo = { id: 'front', name: 'front.png', type: 'image/png', size: png.length };
const endpoint = 'http://localhost/api/photo-analysis';

function formFor(value: unknown = { photos: [photo] }) {
  const form = new FormData();
  form.set('input', JSON.stringify(value));
  form.set('photo:front', new Blob([png], { type: photo.type }), photo.name);
  return form;
}

const request = (form = formFor()) => new Request(endpoint, { method: 'POST', body: form });
const light = { id: 's1', photoId: 'front', confidence: 'medium', payload: { kind: 'lightDirection', directionId: 'down' } };

test('photo-analysis without an engine reports honest pixel metadata and no suggestions', async () => {
  const caps = photoAnalysisCapabilitiesSchema.parse(await GET().json());
  assert.equal(caps.mode, 'metadata_only');
  const response = await POST(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(photoAnalysisResponseSchema.parse(await response.json()), {
    apiVersion: 1, mode: 'metadata_only', suggestions: [],
    photos: [{ ...photo, widthPx: 1, heightPx: 1 }],
  });
});

test('photo-analysis rejects invalid and unexpected originals and duplicate metadata IDs', async () => {
  const form = formFor();
  form.set('photo:unselected', new Blob([png], { type: photo.type }), 'other.png');
  const unexpected = await POST(request(form));
  assert.equal(unexpected.status, 422);
  assert.equal((await unexpected.json()).error, 'invalid_photo');

  const broken = formFor();
  broken.set('photo:front', new Blob([new Uint8Array(png.length)], { type: photo.type }), photo.name);
  const invalid = await POST(request(broken));
  assert.equal(invalid.status, 422);
  assert.equal((await invalid.json()).error, 'invalid_photo');

  const duplicate = await POST(request(formFor({ photos: [photo, photo] })));
  assert.equal(duplicate.status, 422);
  assert.equal((await duplicate.json()).error, 'invalid_photo_list');
});

test('photo-analysis rejects other content types, cross-site and oversized uploads', async () => {
  const plain = await POST(new Request(endpoint, { method: 'POST', body: '{}' }));
  assert.equal(plain.status, 415);
  const crossSite = await POST(new Request(endpoint, { method: 'POST', headers: { 'sec-fetch-site': 'cross-site' } }));
  assert.equal(crossSite.status, 403);
  const oversized = await POST(new Request(endpoint, {
    method: 'POST', headers: { 'content-type': 'multipart/form-data', 'content-length': String(35 * 1024 * 1024) }, body: 'a',
  }));
  assert.equal(oversized.status, 413);
});

test('engine results are estimates and only supported observations linked to uploaded photos are accepted', async () => {
  const engine = createPhotoAnalysisHandlers({ async analyze(photos) {
    assert.equal(photos[0].widthPx, 1);
    assert.deepEqual([...photos[0].bytes], [...png]);
    return { suggestions: [light] };
  } });
  const caps = photoAnalysisCapabilitiesSchema.parse(await engine.GET().json());
  assert.equal(caps.mode, 'visual_analysis');
  const ok = await engine.POST(request());
  const result = photoAnalysisResponseSchema.parse(await ok.json());
  assert.equal(result.mode, 'visual_analysis');
  assert.deepEqual(result.suggestions, [{ ...light, source: 'estimated' }]);

  for (const suggestions of [
    [{ ...light, photoId: 'missing' }],
    [light, light],
    [{ ...light, payload: { kind: 'lightMetric', metric: 'watts', value: 40 } }],
  ]) {
    const invalid = createPhotoAnalysisHandlers({ async analyze() { return { suggestions }; } });
    const response = await invalid.POST(request());
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, 'invalid_engine_response');
  }
});
