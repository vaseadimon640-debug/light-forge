import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMyline } from '../src/domain/myline.ts';
import { newProject } from '../src/domain/project.ts';
import {
  addComponentToProject,
  addPhotosToSnapshot,
  addPlacementToProject,
  displayToMm,
  formatIssuePath,
  mmToDisplay,
  orderedPhotos,
  parseRfqError,
  pruneExcessPlacements,
  removeComponentFromProject,
  removePhotoFromSnapshot,
  setPrimaryPhoto,
  snapshotFingerprint,
  validateProject,
} from '../src/ui/quick-rfq/helpers.ts';

test('display unit conversions preserve canonical millimetre values cleanly', () => {
  assert.equal(mmToDisplay(5750, 'mm'), '5750');
  assert.equal(mmToDisplay(5750, 'cm'), '575');
  assert.equal(mmToDisplay(5750, 'm'), '5.75');
  assert.equal(displayToMm('0.9', 'm'), 900);
  assert.equal(displayToMm('70,5', 'cm'), 705);
  assert.equal(displayToMm('', 'mm'), null);
  assert.equal(displayToMm('abc', 'mm'), null);
});

test('photo manager helpers preserve original bytes, enforce limits, and maintain primaryPhotoId invariant', () => {
  const initial = { project: newProject(), originals: {} };
  const jpg = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'lamp-main.jpg', { type: 'image/jpeg' });
  const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'lamp-detail.png', { type: 'image/png' });
  const bad = new File([new Uint8Array([1, 2, 3])], 'notes.txt', { type: 'text/plain' });

  const added = addPhotosToSnapshot(initial, [jpg, bad, png]);
  assert.equal(added.errors.length, 1);
  assert.equal(added.snapshot.project.photos.length, 2);
  const firstId = added.snapshot.project.photos[0].id;
  const secondId = added.snapshot.project.photos[1].id;
  assert.equal(added.snapshot.project.primaryPhotoId, firstId);
  assert.equal(added.snapshot.originals[firstId], jpg);
  assert.equal(added.snapshot.originals[secondId], png);
  assert.deepEqual(validateProject(added.snapshot.project), []);

  const switched = setPrimaryPhoto(added.snapshot, secondId);
  assert.equal(switched.project.primaryPhotoId, secondId);
  assert.equal(orderedPhotos(switched.project)[0].id, secondId);

  const afterRemovePrimary = removePhotoFromSnapshot(switched, secondId);
  assert.equal(afterRemovePrimary.project.photos.length, 1);
  assert.equal(afterRemovePrimary.project.primaryPhotoId, firstId);
  assert.deepEqual(validateProject(afterRemovePrimary.project), []);

  const empty = removePhotoFromSnapshot(afterRemovePrimary, firstId);
  assert.equal(empty.project.photos.length, 0);
  assert.equal(empty.project.primaryPhotoId, undefined);
  assert.deepEqual(validateProject(empty.project), []);
});

test('component and placement helpers keep MYLINE valid and prune excess placements cleanly', () => {
  const myline = createMyline();
  assert.equal(myline.mounting.tabletopFromFloorMm, undefined);
  assert.deepEqual(validateProject(myline), []);

  // All 4 MYLINE units are already placed, so adding another placement is a no-op
  const unchanged = addPlacementToProject(myline);
  assert.equal(unchanged.mounting.placements.length, 4);

  // Lowering quantity triggers validation issue until explicitly pruned
  const lowered = {
    ...myline,
    components: myline.components.map((comp, idx) => (idx === 0 ? { ...comp, quantity: 1 } : comp)),
  };
  const issues = validateProject(lowered);
  assert.ok(issues.length >= 1);
  assert.match(formatIssuePath(issues[0].path, lowered), /Монтаж → Размещение/);

  const pruned = pruneExcessPlacements(lowered);
  assert.equal(pruned.mounting.placements.length, 3);
  assert.deepEqual(validateProject(pruned), []);

  const { project: withExtra, componentId } = addComponentToProject(pruned, 'ring');
  assert.equal(withExtra.components.length, 3);
  const removed = removeComponentFromProject(withExtra, componentId);
  assert.equal(removed.components.length, 2);
});

test('API error parser classifies 503 retryable PDF errors and 422 domain conflicts accurately', async () => {
  const busy = await parseRfqError(
    new Response(JSON.stringify({ error: 'pdf_busy', message: 'PDF renderer is busy.' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    }),
  );
  assert.equal(busy.status, 503);
  assert.equal(busy.code, 'pdf_busy');
  assert.equal(busy.retryable, true);

  const conflict = await parseRfqError(
    new Response(
      JSON.stringify({ error: 'project_geometry_conflict', message: 'Project and composition disagree on ceiling level.' }),
      { status: 422, headers: { 'content-type': 'application/json' } },
    ),
  );
  assert.equal(conflict.code, 'project_geometry_conflict');
  assert.equal(conflict.retryable, false);
  assert.match(conflict.message, /ceiling level/);

  const invalid = await parseRfqError(
    new Response(
      JSON.stringify({
        error: 'invalid_snapshot',
        issues: [{ path: ['project', 'components', 0, 'dimensions', 'innerDiameter'], message: 'Inner diameter must be less than outer diameter' }],
      }),
      { status: 422, headers: { 'content-type': 'application/json' } },
    ),
  );
  assert.equal(invalid.issues?.length, 1);
  assert.match(invalid.issues![0].message, /Внутренний диаметр/);
});

test('snapshotFingerprint ignores updatedAt changes and tracks language and edits', () => {
  const a = { project: createMyline(), originals: {} };
  const b = { project: { ...a.project, updatedAt: new Date(Date.now() + 60_000).toISOString() }, originals: {} };
  assert.equal(snapshotFingerprint(a, 'en-zh'), snapshotFingerprint(b, 'en-zh'));
  assert.notEqual(snapshotFingerprint(a, 'en-zh'), snapshotFingerprint(a, 'en'));
  const edited = { project: { ...a.project, orderQuantity: 5 }, originals: {} };
  assert.notEqual(snapshotFingerprint(a, 'en-zh'), snapshotFingerprint(edited, 'en-zh'));
});
