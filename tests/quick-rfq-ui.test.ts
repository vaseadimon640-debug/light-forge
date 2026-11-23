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
import { PhotoAnalysisError } from '../src/photo-analysis/client.ts';
import {
  applyEmptySuggestions,
  applyPhotoSuggestion,
  createPreviewDemoSuggestions,
  formatMegapixels,
  formatMimeLabel,
  formatPhotoAnalysisError,
  getCurrentFieldSummary,
  isAbortError,
  syncSelectedPhotoIds,
  type PhotoSuggestion,
} from '../src/ui/quick-rfq/photoAnalysis.ts';

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

test('photo analysis suggestions preserve estimated provenance, protect manual values, and keep material/finish/color separate', () => {
  const myline = createMyline();
  const demo = createPreviewDemoSuggestions(myline, 'photo-1');

  // MYLINE width (900 mm user) must be flagged as manually entered; profileHeight is empty
  const widthSugg = demo.find(item => item.id === 'preview-dim-width')!;
  const profileSugg = demo.find(item => item.id === 'preview-dim-profile')!;
  const widthSummary = getCurrentFieldSummary(myline, widthSugg, 'mm');
  assert.equal(widthSummary.isEmpty, false);
  assert.equal(widthSummary.hasManualValue, true);
  assert.equal(widthSummary.currentSource, 'user');

  const profileSummary = getCurrentFieldSummary(myline, profileSugg, 'mm');
  assert.equal(profileSummary.isEmpty, true);
  assert.equal(profileSummary.hasManualValue, false);

  // Bulk applyEmptySuggestions fills ONLY empty fields and protects MYLINE manual values (width=900, solidBrass, kind, direction)
  const bulk = applyEmptySuggestions(myline, demo, 'mm');
  assert.equal(bulk.appliedCount, 2); // profileHeight + new diffuser material
  assert.ok(bulk.protectedCount >= 3);
  assert.equal(bulk.project.components[0].dimensions.width?.value, 900);
  assert.equal(bulk.project.components[0].dimensions.width?.source, 'user');
  assert.equal(bulk.project.components[0].dimensions.profileHeight?.value, 45);
  assert.equal(bulk.project.components[0].dimensions.profileHeight?.source, 'estimated');
  assert.equal(bulk.project.mounting.tabletopFromFloorMm, undefined);
  assert.deepEqual(validateProject(bulk.project), []);

  // Direct Accept on a numeric suggestion always stamps source='estimated'
  const direct = applyPhotoSuggestion(myline, widthSugg, undefined, 'mm');
  assert.equal(direct.ok, true);
  if (direct.ok) {
    assert.equal(direct.project.components[0].dimensions.width?.value, 920);
    assert.equal(direct.project.components[0].dimensions.width?.source, 'estimated');
    assert.deepEqual(validateProject(direct.project), []);
  }

  // Inline Edit keeps solidBrass / genuineLeather material, finish, and color strictly separate
  const leatherSugg: PhotoSuggestion = {
    id: 'sugg-leather',
    confidence: 'medium',
    payload: {
      kind: 'material',
      componentId: myline.components[0].id,
      part: 'Suspension strap / 吊带',
      material: 'genuineLeather',
      color: 'Cognac',
    },
    status: 'pending',
  };
  const edited = applyPhotoSuggestion(
    myline,
    leatherSugg,
    {
      kind: 'material',
      part: 'Suspension strap / 吊带',
      material: 'genuineLeather',
      finish: 'custom',
      color: 'Dark saddle brown',
    },
    'mm',
  );
  assert.equal(edited.ok, true);
  if (edited.ok) {
    const strapMat = edited.project.components[0].materials.find(
      item => item.part === 'Suspension strap / 吊带',
    );
    assert.equal(strapMat?.material, 'genuineLeather');
    assert.equal(strapMat?.finish, 'custom');
    assert.equal(strapMat?.color, 'Dark saddle brown');
    assert.deepEqual(validateProject(edited.project), []);
  }

  // Mounting photo hint preserves source='estimated' in canonical mm and rejects invalid inner >= outer ring edit
  const mountHint: PhotoSuggestion = {
    id: 'sugg-ceil',
    confidence: 'low',
    payload: { kind: 'mounting', field: 'ceilingFromFloorMm', valueMm: 3200 },
    status: 'pending',
  };
  const mountRes = applyPhotoSuggestion(newProject(), mountHint, undefined, 'cm');
  assert.equal(mountRes.ok, true);
  if (mountRes.ok) {
    assert.equal(mountRes.project.mounting.ceilingFromFloorMm?.value, 3200);
    assert.equal(mountRes.project.mounting.ceilingFromFloorMm?.source, 'estimated');
    assert.match(mountRes.appliedSummary, /320 см/);
  }
});

test('photo analysis selection sync, abort detection, and structured error formatting match contract v1', () => {
  const photos = [
    { id: 'p1', name: 'main.png', type: 'image/png' as const, size: 1200 },
    { id: 'p2', name: 'detail.jpg', type: 'image/jpeg' as const, size: 2400 },
    { id: 'p3', name: 'angle.webp', type: 'image/webp' as const, size: 3600 },
  ];

  // Preserves existing selection, drops deleted IDs, auto-selects newly uploaded IDs in project order
  assert.deepEqual(syncSelectedPhotoIds(['p2', 'deleted'], photos, ['p3']), ['p2', 'p3']);
  assert.deepEqual(syncSelectedPhotoIds([], photos, ['p1']), ['p1']);

  assert.equal(formatMimeLabel('image/png'), 'PNG');
  assert.equal(formatMimeLabel('image/jpeg'), 'JPEG');
  assert.equal(formatMimeLabel('image/webp'), 'WebP');
  assert.match(formatMegapixels(1920, 1080), /2\.07 Мп/);
  assert.match(formatMegapixels(360, 240), /пикс\./);

  // AbortError detection
  assert.equal(isAbortError(new DOMException('The operation was aborted.', 'AbortError')), true);
  assert.equal(isAbortError(new Error('network down')), false);

  // Contract error classification
  const invalidPhoto = formatPhotoAnalysisError(new PhotoAnalysisError(422, 'invalid_photo'));
  assert.equal(invalidPhoto.status, 422);
  assert.equal(invalidPhoto.code, 'invalid_photo');
  assert.equal(invalidPhoto.retryable, false);
  assert.match(invalidPhoto.message, /60 Мп/);

  const tooLarge = formatPhotoAnalysisError(new PhotoAnalysisError(413, 'request_too_large'));
  assert.equal(tooLarge.retryable, false);
  assert.match(tooLarge.message, /32 МиБ/);

  const engineErr = formatPhotoAnalysisError(new PhotoAnalysisError(502, 'engine_error'));
  assert.equal(engineErr.retryable, true);
  assert.equal(engineErr.code, 'engine_error');

  const netErr = formatPhotoAnalysisError(new TypeError('Failed to fetch'));
  assert.equal(netErr.status, 0);
  assert.equal(netErr.code, 'network_error');
  assert.equal(netErr.retryable, true);
});
