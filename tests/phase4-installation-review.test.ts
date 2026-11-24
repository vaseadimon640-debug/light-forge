import assert from 'node:assert/strict';
import test from 'node:test';
import { createMyline } from '../src/domain/myline.ts';
import { newComponent, newProject } from '../src/domain/project.ts';
import { compositionSchema } from '../src/geometry/schema.ts';
import {
  analyzeMountingPlacement,
  analyzeProjectMounting,
  appendNotePreset,
  buildPreviewCompositionFromProject,
  buildReviewAudit,
  INSTALLATION_NOTE_PRESETS,
  mapIssuePathToStep,
  mapReadinessCategoryToStep,
  populateMissingPlacements,
} from '../src/ui/configurator/installationAnd3d.ts';

test('appendNotePreset adds unique presets and enforces 1000-char limit', () => {
  const first = appendNotePreset('', INSTALLATION_NOTE_PRESETS[0]);
  assert.equal(first, INSTALLATION_NOTE_PRESETS[0]);

  const deduped = appendNotePreset(first, INSTALLATION_NOTE_PRESETS[0]);
  assert.equal(deduped, first);

  const second = appendNotePreset(first, INSTALLATION_NOTE_PRESETS[1]);
  assert.equal(second, `${INSTALLATION_NOTE_PRESETS[0]}\n${INSTALLATION_NOTE_PRESETS[1]}`);

  const capped = appendNotePreset('A'.repeat(995), INSTALLATION_NOTE_PRESETS[0]);
  assert.equal(capped.length, 1000);
});

test('analyzeProjectMounting preserves unknown tabletop on MYLINE without fabricating lengths', () => {
  const myline = createMyline();
  const summary = analyzeProjectMounting(myline);

  assert.equal(summary.totalComponentUnits, 4);
  assert.equal(summary.placedUnits, 4);
  assert.equal(summary.unplacedUnits, 0);
  assert.equal(summary.hasExcessPlacements, false);
  assert.equal(summary.missingCeiling, false);
  assert.equal(summary.missingTabletop, true);
  assert.equal(summary.conflictCount, 0);

  for (const placement of summary.placements) {
    assert.equal(placement.bottomFromFloorMm, undefined);
    assert.equal(placement.suspensionVerticalMm, undefined);
    assert.equal(placement.quality, 'unknown');
    assert.ok(placement.missing.includes('Высота столешницы'));
  }
});

test('analyzeProjectMounting computes exact mm floor levels and vertical drops when tabletop is provided', () => {
  const myline = createMyline();
  const withTabletop = {
    ...myline,
    mounting: {
      ...myline.mounting,
      tabletopFromFloorMm: { value: 750, source: 'user' as const },
    },
  };

  const summary = analyzeProjectMounting(withTabletop);
  assert.equal(summary.missingTabletop, false);
  assert.equal(summary.conflictCount, 0);

  // MYLINE placements: 900, 950, 1250, 1500 mm above 750 mm tabletop -> 1650, 1700, 2000, 2250 mm from floor
  assert.deepEqual(
    summary.placements.map((p) => p.bottomFromFloorMm),
    [1650, 1700, 2000, 2250],
  );

  // Large arcs (700 mm) & Small arcs (550 mm) under 5750 mm ceiling;
  // attachmentAboveLowestMm is not explicitly set so bodyHeight fallback marks quality as 'estimated'
  assert.deepEqual(
    summary.placements.map((p) => p.suspensionVerticalMm),
    [5750 - (1650 + 700), 5750 - (1700 + 700), 5750 - (2000 + 550), 5750 - (2250 + 550)],
  );
  assert.ok(summary.placements.every((p) => p.quality === 'estimated'));

  // Explicit attachmentAboveLowestMm from documentation upgrades quality to 'specified'
  const explicitPlacement = {
    ...withTabletop.mounting.placements[0],
    attachmentAboveLowestMm: { value: 700, source: 'documentation' as const },
  };
  const explicitAnalysis = analyzeMountingPlacement(withTabletop, explicitPlacement);
  assert.equal(explicitAnalysis.quality, 'specified');
  assert.equal(explicitAnalysis.suspensionVerticalMm, 3400);
});

test('analyzeProjectMounting detects physical height conflicts and excess placements', () => {
  const myline = createMyline();
  const conflicting = {
    ...myline,
    mounting: {
      ...myline.mounting,
      ceilingFromFloorMm: { value: 2200, source: 'user' as const },
      tabletopFromFloorMm: { value: 750, source: 'user' as const },
    },
  };
  const summary = analyzeProjectMounting(conflicting);
  assert.ok(summary.conflictCount >= 1);
  assert.ok(summary.placements[3].conflict?.includes('превышает уровень потолка'));

  const excess = {
    ...myline,
    mounting: {
      ...myline.mounting,
      placements: [
        ...myline.mounting.placements,
        { id: crypto.randomUUID(), componentId: myline.components[0].id },
      ],
    },
  };
  assert.equal(analyzeProjectMounting(excess).hasExcessPlacements, true);
});

test('populateMissingPlacements fills unplaced units while keeping existing placements intact', () => {
  const base = newProject();
  const comp = { ...base.components[0], quantity: 3 };
  const existingId = crypto.randomUUID();
  const project = {
    ...base,
    components: [comp],
    mounting: {
      placements: [
        {
          id: existingId,
          componentId: comp.id,
          lowestAboveTabletopMm: { value: 900, source: 'user' as const },
        },
      ],
    },
  };

  const filled = populateMissingPlacements(project);
  assert.equal(filled.mounting.placements.length, 3);
  assert.equal(filled.mounting.placements[0].id, existingId);
  assert.equal(filled.mounting.placements[0].lowestAboveTabletopMm?.value, 900);
});

test('buildPreviewCompositionFromProject generates honest, schema-valid 3D preview across fixture types', () => {
  // 1. Fresh blank project
  const blank = newProject();
  const blankPreview = buildPreviewCompositionFromProject(blank);
  assert.doesNotThrow(() => compositionSchema.parse(blankPreview.composition));
  assert.equal(blankPreview.composition.site.ceilingFromFloorMm, undefined);
  assert.equal(blankPreview.composition.site.tabletopFromFloorMm, undefined);
  assert.equal(blankPreview.isEstimatedPreview, true);
  assert.equal(blankPreview.resolved.elements.length, 1);

  // 2. MYLINE preset (preserves 5750 ceiling, unknown tabletop, 4 arcs, decorative straps for leather)
  const myline = createMyline();
  const mylinePreview = buildPreviewCompositionFromProject(myline);
  assert.doesNotThrow(() => compositionSchema.parse(mylinePreview.composition));
  assert.equal(mylinePreview.composition.site.ceilingFromFloorMm?.value, 5750);
  assert.equal(mylinePreview.composition.site.tabletopFromFloorMm, undefined);
  assert.equal(mylinePreview.composition.elements.length, 4);
  assert.ok(mylinePreview.composition.elements.every((el) => el.position.lowest.datum === 'tabletop'));
  assert.ok(mylinePreview.composition.suspensions.every((s) => s.type === 'decorativeStrap'));
  assert.ok(mylinePreview.notes.some((note) => note.includes('столешницы')));

  // 3. Ring, Linear, and Shallow Arc shapes
  const multi = {
    ...newProject(),
    mounting: {
      ceilingFromFloorMm: { value: 3200, source: 'user' as const },
      placements: [],
    },
    components: [
      {
        ...newComponent('ring'),
        dimensions: {
          outerDiameter: { value: 1000, source: 'documentation' as const },
          innerDiameter: { value: 880, source: 'documentation' as const },
          profileHeight: { value: 60, source: 'documentation' as const },
        },
      },
      {
        ...newComponent('linear'),
        dimensions: {
          length: { value: 1500, source: 'user' as const },
          width: { value: 55, source: 'user' as const },
          height: { value: 75, source: 'user' as const },
        },
      },
      {
        ...newComponent('arc'),
        dimensions: {
          width: { value: 1200, source: 'user' as const },
          height: { value: 350, source: 'user' as const },
          depth: { value: 60, source: 'user' as const },
        },
      },
    ],
  };

  const multiPreview = buildPreviewCompositionFromProject(multi);
  assert.doesNotThrow(() => compositionSchema.parse(multiPreview.composition));
  assert.deepEqual(
    multiPreview.composition.elements.map((el) => el.shape.type),
    ['ring', 'linear', 'arc'],
  );
});

test('buildReviewAudit maps readiness categories & validation issues to exact wizard steps', () => {
  assert.equal(mapReadinessCategoryToStep('photos'), 'upload');
  assert.equal(mapReadinessCategoryToStep('dimensions'), 'dimensions');
  assert.equal(mapReadinessCategoryToStep('materials'), 'materials');
  assert.equal(mapReadinessCategoryToStep('lighting'), 'lighting');
  assert.equal(mapReadinessCategoryToStep('mounting'), 'installation');

  assert.equal(mapIssuePathToStep(['photos', 0]), 'upload');
  assert.equal(mapIssuePathToStep(['mounting', 'placements', 0]), 'installation');
  assert.equal(mapIssuePathToStep(['components', 0, 'materials', 0]), 'materials');
  assert.equal(mapIssuePathToStep(['components', 0, 'light', 'cct']), 'lighting');
  assert.equal(mapIssuePathToStep(['name']), 'dimensions');

  const myline = createMyline();
  const audit = buildReviewAudit(myline);
  assert.equal(audit.canExportPdf, true);
  assert.equal(audit.validationIssues.length, 0);
  assert.equal(audit.readiness.hasSolidBrass, true);
  assert.equal(audit.readiness.hasGenuineLeather, true);
  assert.ok(audit.openItems.some((item) => item.targetStep === 'installation'));

  const invalid = { ...myline, name: '   ' };
  const invalidAudit = buildReviewAudit(invalid);
  assert.equal(invalidAudit.canExportPdf, false);
  assert.ok(invalidAudit.validationIssues.length > 0);
});
