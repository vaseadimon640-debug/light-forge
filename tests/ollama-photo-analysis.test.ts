import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPhotoAnalysisHandlers } from '../src/server/photo-analysis.ts';
import { createOllamaPhotoAnalysisEngine } from '../src/server/photo-analysis-ollama.ts';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+hVkcAAAAASUVORK5CYII=', 'base64');
const photo = { id: 'front', name: 'front.png', type: 'image/png', size: png.length };
const suggestion = { confidence: 'medium', payload: { kind: 'productKind', value: 'pendant' } };

function request(ids = ['front']) {
  const photos = ids.map(id => ({ ...photo, id }));
  const form = new FormData();
  form.set('input', JSON.stringify({ photos }));
  for (const item of photos) form.set(`photo:${item.id}`, new Blob([png], { type: photo.type }), item.name);
  return new Request('http://localhost/api/photo-analysis', { method: 'POST', body: form });
}

function ollamaAnswer(suggestions: unknown[]) {
  return Response.json({ done: true, message: { content: JSON.stringify({ suggestions }) } });
}

test('Ollama adapter sends only images to loopback and ties cached estimates to selected photo IDs', async () => {
  let calls = 0;
  const engine = createOllamaPhotoAnalysisEngine(async (url, init) => {
    calls += 1;
    assert.equal(url, 'http://127.0.0.1:11434/api/chat');
    assert.equal(init?.redirect, 'error');
    const body = JSON.parse(init?.body as string);
    assert.equal(body.model, 'qwen3-vl:2b-instruct');
    assert.equal(body.stream, false);
    assert.equal(body.format.type, 'object');
    assert.deepEqual(body.messages[0].images, [png.toString('base64')]);
    assert.equal(JSON.stringify(body).includes('front.png'), false);
    assert.equal('tools' in body, false);
    return ollamaAnswer([suggestion]);
  });
  const handlers = createPhotoAnalysisHandlers(engine);
  const response = await handlers.POST(request(['front', 'copy']));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.mode, 'visual_analysis');
  assert.deepEqual(result.suggestions, [
    { ...suggestion, photoId: 'front', id: 'suggestion-1', source: 'estimated' },
    { ...suggestion, photoId: 'copy', id: 'suggestion-2', source: 'estimated' },
  ]);
  assert.equal((await handlers.POST(request(['another']))).status, 200);
  assert.equal(calls, 1);
});

test('Ollama adapter refuses unsupported output and reports an unavailable local model', async () => {
  const invalid = createPhotoAnalysisHandlers(createOllamaPhotoAnalysisEngine(async () => ollamaAnswer([
    { confidence: 'high', payload: { kind: 'dimension', valueMm: 100 } },
  ])));
  assert.equal((await invalid.POST(request())).status, 502);

  const missing = createPhotoAnalysisHandlers(createOllamaPhotoAnalysisEngine(async () =>
    Response.json({ error: 'not found' }, { status: 404 })));
  const unavailable = await missing.POST(request());
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).error, 'engine_unavailable');
});

test('Ollama adapter rejects concurrent work while the local model is running', async () => {
  let markStarted!: () => void;
  let finish!: () => void;
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const handlers = createPhotoAnalysisHandlers(createOllamaPhotoAnalysisEngine(async () => {
    markStarted();
    await pending;
    return ollamaAnswer([]);
  }));
  const first = handlers.POST(request());
  await started;
  try {
    const second = await handlers.POST(request());
    assert.equal(second.status, 503);
    assert.equal((await second.json()).error, 'engine_busy');
  } finally {
    finish();
    assert.equal((await first).status, 200);
  }
});
