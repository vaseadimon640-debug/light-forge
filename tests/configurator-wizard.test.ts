import assert from 'node:assert/strict';
import test from 'node:test';
import { createMyline } from '../src/domain/myline.ts';
import { newProject } from '../src/domain/project.ts';
import {
  commitWizardProject,
  computeStepBadges,
  createWizardHistory,
  processWizardUploads,
  redoWizardHistory,
  undoWizardHistory,
  WIZARD_STEPS,
} from '../src/ui/configurator/wizardState.ts';

test('wizard defines 6 focused stages starting with Image-First Upload', () => {
  assert.equal(WIZARD_STEPS.length, 6);
  assert.equal(WIZARD_STEPS[0].id, 'upload');
  assert.equal(WIZARD_STEPS[0].title, 'Начните с фотографии светильника');
});

test('wizard Undo / Redo history stack restores previous and future canonical projects cleanly', () => {
  const base = newProject();
  let h = createWizardHistory(base);
  assert.equal(h.past.length, 0);
  assert.equal(h.future.length, 0);

  h = commitWizardProject(h, { ...h.present, name: 'Atelier Ring 900' });
  h = commitWizardProject(h, { ...h.present, orderQuantity: 4 });
  assert.equal(h.present.name, 'Atelier Ring 900');
  assert.equal(h.present.orderQuantity, 4);
  assert.equal(h.past.length, 2);

  h = undoWizardHistory(h);
  assert.equal(h.present.orderQuantity, 1);
  assert.equal(h.present.name, 'Atelier Ring 900');
  assert.equal(h.future.length, 1);

  h = redoWizardHistory(h);
  assert.equal(h.present.orderQuantity, 4);
  assert.equal(h.future.length, 0);

  // Branching edit after undo clears future
  h = undoWizardHistory(h);
  h = commitWizardProject(h, { ...h.present, orderQuantity: 8 });
  assert.equal(h.present.orderQuantity, 8);
  assert.equal(h.future.length, 0);
});

test('processWizardUploads separates photos, PDF drawings, and reports honest HEIC/unsupported messages', () => {
  const snapshot = { project: newProject(), originals: {} };
  const jpgFile = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'front.jpg', {
    type: 'image/jpeg',
  });
  const pdfFile = new File([new Uint8Array(Buffer.from('%PDF-1.4\n%%EOF'))], 'spec.pdf', {
    type: 'application/pdf',
  });
  const heicFile = new File([new Uint8Array([1, 2, 3])], 'iphone.heic', {
    type: 'image/heic',
  });

  const res = processWizardUploads(snapshot, [], [jpgFile, pdfFile, heicFile]);
  assert.equal(res.addedPhotoCount, 1);
  assert.equal(res.snapshot.project.photos.length, 1);
  assert.equal(res.addedDrawings.length, 1);
  assert.equal(res.addedDrawings[0].name, 'spec.pdf');
  assert.equal(res.errors.length, 1);
  assert.match(res.errors[0], /HEIC/);
});

test('computeStepBadges reflects live counts for MYLINE reference project', () => {
  const myline = createMyline();
  const badges = computeStepBadges(myline, 1);
  assert.equal(badges.upload, '1');
  assert.ok(Number(badges.dimensions) >= 6);
  assert.ok(Number(badges.materials) >= 2);
  assert.equal(badges.installation, '1 шт.');
  assert.equal(badges.studio3d, '2');
});
