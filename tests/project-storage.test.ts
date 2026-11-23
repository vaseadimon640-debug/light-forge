import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMyline } from '../src/domain/myline.ts';
import { exportProject, importProject, openProjectStore, quickRfqForm } from '../src/storage/projects.ts';

test('saving, reopening, exporting and importing a project preserves the original bytes and primary selection', async () => {
  const project = createMyline();
  const original = new Uint8Array([0, 1, 128, 255]);
  project.photos = [{ id: 'photo-a', name: 'reference.jpg', type: 'image/jpeg', size: original.length }];
  project.primaryPhotoId = 'photo-a';
  const snapshot = { project, originals: { 'photo-a': new Blob([original], { type: 'image/jpeg' }) } };
  const store = await openProjectStore('rfq-test');
  const saved = await store.save(snapshot);
  store.close();
  const reopened = await openProjectStore('rfq-test');
  try {
    const restored = await reopened.get(project.id);
    assert.equal(restored?.project.primaryPhotoId, 'photo-a');
    assert.deepEqual(new Uint8Array(await restored!.originals['photo-a'].arrayBuffer()), original);
    const imported = await importProject(await exportProject(saved));
    assert.equal(imported.project.primaryPhotoId, 'photo-a');
    const form = quickRfqForm(imported);
    const photo = form.get('photo:photo-a');
    assert.ok(photo instanceof File);
    assert.deepEqual(new Uint8Array(await photo.arrayBuffer()), original);
    await assert.rejects(reopened.save({ project, originals: {} }), /original/i);
  } finally {
    reopened.close();
  }
});
