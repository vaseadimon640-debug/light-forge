import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';
import { GET, POST } from '../src/app/api/visual-search/local/route.ts';
import { fingerprintPhoto } from '../src/server/visual-catalogue-index.ts';
import { localSearchResponseSchema } from '../src/visual-search/local-contract.ts';

function searchRequest(image: Uint8Array<ArrayBuffer>, type = 'image/jpeg') {
  const form = new FormData();
  form.set('input', JSON.stringify({ photo: { id: 'query', name: 'query.jpg', size: image.byteLength, type } }));
  form.set('photo:query', new File([image], 'query.jpg', { type }));
  return new Request('http://lf/api/visual-search/local', { method: 'POST', body: form });
}

test('the local index ranks byte-identical and re-encoded references without verifying product identity', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'lf-photo-index-'));
  const path = join(directory, 'index.json');
  const previous = process.env.LIGHT_FORGE_VISUAL_INDEX_PATH;
  t.after(async () => {
    if (previous === undefined) delete process.env.LIGHT_FORGE_VISUAL_INDEX_PATH;
    else process.env.LIGHT_FORGE_VISUAL_INDEX_PATH = previous;
    await rm(directory, { recursive: true, force: true });
  });
  delete process.env.LIGHT_FORGE_VISUAL_INDEX_PATH;
  assert.deepEqual(await (await GET()).json(), { available: false, referenceCount: 0 });

  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="96"><rect width="128" height="96" fill="#eee"/><path d="M20 25 H100 V70 H20 Z" fill="#841"/><path d="M40 30 V68" stroke="#555" stroke-width="6"/></svg>');
  const original = await sharp(svg).jpeg({ quality: 90 }).toBuffer();
  const resized = await sharp(original).resize(80).jpeg({ quality: 65 }).toBuffer();
  const unrelated = await sharp({ create: { width: 128, height: 96, channels: 3, background: '#2d318f' } }).jpeg().toBuffer();
  assert.equal((await POST(searchRequest(new Uint8Array(original)))).status, 503);
  const fingerprint = await fingerprintPhoto(original);
  await writeFile(path, JSON.stringify({ version: 1, references: [{
    id: 'reference-a', title: 'Test reference', source: 'https://example.invalid/a', fingerprint,
  }, {
    id: 'reference-b', title: 'Unrelated reference', fingerprint: await fingerprintPhoto(unrelated),
  }] }));
  process.env.LIGHT_FORGE_VISUAL_INDEX_PATH = path;
  assert.deepEqual(await (await GET()).json(), { available: true, referenceCount: 2 });

  const exact = await POST(searchRequest(new Uint8Array(original)));
  assert.equal(exact.status, 200);
  assert.deepEqual(localSearchResponseSchema.parse(await exact.json()), {
    matches: [{ id: 'reference-a', title: 'Test reference', source: 'https://example.invalid/a', match: 'same_file' }],
    originalVerified: false,
  });
  const similar = await POST(searchRequest(new Uint8Array(resized)));
  assert.equal(similar.status, 200);
  assert.deepEqual(localSearchResponseSchema.parse(await similar.json()).matches.map(item => [item.id, item.match]), [
    ['reference-a', 'similar_image'],
  ]);
  assert.equal((await POST(searchRequest(new Uint8Array(resized), 'image/png'))).status, 422);

  await writeFile(path, '{}');
  assert.deepEqual(await (await GET()).json(), { available: false, referenceCount: 0 });
});
