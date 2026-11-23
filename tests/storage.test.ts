import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMylineComposition } from '../src/geometry/examples.ts';
import { exportComposition, importComposition, openCompositionStore } from '../src/storage/compositions.ts';

test('opens, saves, updates, reads after reopening and removes a composition', async () => {
  const name = 'life-cycle';
  const first = await openCompositionStore(name);
  const original = createMylineComposition();
  await first.save(original);
  first.close();

  const reopened = await openCompositionStore(name);
  try {
    assert.deepEqual((await reopened.get(original.id))?.composition, original);
    const updated = { ...original, name: 'MYLINE rev 2' };
    await reopened.save(updated);
    assert.equal((await reopened.list()).length, 1);
    assert.equal((await reopened.get(original.id))?.composition.name, updated.name);
    await reopened.remove(original.id);
    assert.deepEqual(await reopened.list(), []);
  } finally {
    reopened.close();
  }
});

test('portable project data preserves unknown dimensions, material links and version', () => {
  const original = createMylineComposition();
  assert.deepEqual(importComposition(exportComposition(original)), original);
  assert.throws(() => importComposition('{"schemaVersion":2}'));
});
