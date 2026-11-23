import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGeometryExample, createMylineComposition } from '../src/geometry/examples.ts';
import { resolveComposition } from '../src/geometry/resolve.ts';
import {
  addCanopyToComposition,
  addElementToComposition,
  addSuspensionToComposition,
  cloneCompositionWithNewId,
  collectMissingInputs,
  computeElementDistances,
  computeVisualLayout,
  formatGeometryIssuePath,
  formatSuspensionFormula,
  removeCanopyExitFromComposition,
  removeElementAttachmentFromComposition,
  removeSuspensionGuidePoint,
  safeResolveLocal,
  switchCanopyFootprint,
  toThreeMetres,
} from '../src/ui/geometry/helpers.ts';

test('toThreeMetres converts right-handed engineering millimetres to Three.js metres', () => {
  assert.deepEqual(toThreeMetres({ x: 1000, y: 500, z: 2500 }), [1, 2.5, -0.5]);
});

test('MYLINE visual layout preserves known envelope dimensions and above-tabletop elevations without inventing tabletop or strap lengths', () => {
  const comp = createMylineComposition();
  const resolved = resolveComposition(comp);
  const layout = computeVisualLayout(resolved);

  assert.equal(layout.ceilingIsReal, true);
  assert.equal(layout.displayCeilingMm, 5750);
  assert.equal(layout.tabletopIsReal, false);
  assert.equal(layout.tabletopIsReferenceOnly, true);

  assert.equal(resolved.site.tabletopFromFloorMm, undefined);
  assert.equal(resolved.suspensions.length, 0);
  for (const el of resolved.elements) {
    assert.equal(el.origin.x.valueMm, null);
    assert.equal(el.origin.z.valueMm, null);
    assert.equal(layout.elements[el.id].xStaged, true);
    assert.equal(layout.elements[el.id].zMode, 'relative-tabletop-staged');
  }

  const pairs = computeElementDistances(resolved);
  assert.equal(pairs.length, 6);
  for (const pair of pairs) {
    assert.equal(pair.centerDistanceMm, null);
  }
  assert.equal(pairs[0].deltaZLowestMm, 50);

  const missing = collectMissingInputs(resolved);
  assert.ok(missing.some(line => line.includes('tabletopFromFloorMm')));
  assert.ok(missing.some(line => line.includes('suspensions')));
});

test('symbolic suspension formula reflects unknown tabletop without inventing cutLength', () => {
  const example = createGeometryExample();
  delete example.site.tabletopFromFloorMm;
  const resolved = resolveComposition(example);
  const [cable] = resolved.suspensions;
  assert.equal(cable.cutLength.valueMm, null);
  const formula = formatSuspensionFormula(cable);
  assert.match(formula, /H_потолка/);
  assert.match(formula, /H_стола/);
  assert.match(formula, /припуск 50 мм/);
});

test('composition mutation helpers add shapes, canopies, and separate cable/strap suspensions cleanly', () => {
  const start = createGeometryExample();
  const { composition: withArc } = addElementToComposition(start, 'arc');
  assert.equal(withArc.elements.length, 4);
  const { composition: withCanopy } = addCanopyToComposition(withArc, 'rectangular');
  assert.equal(withCanopy.canopies.length, 2);
  const { composition: withStrap, suspensionId } = addSuspensionToComposition(withCanopy, 'decorativeStrap');
  assert.ok(suspensionId);
  assert.equal(withStrap.suspensions.length, 3);
  const checked = safeResolveLocal(withStrap);
  assert.deepEqual(checked.issues, []);
  assert.ok(checked.resolved);
});

test('deleting referenced canopy exit or element attachment cascades dependent suspensions without schema errors', () => {
  const example = createGeometryExample();
  const exitResult = removeCanopyExitFromComposition(example, 'canopy', 'cable');
  assert.equal(exitResult.removedSuspensions, 1);
  assert.equal(exitResult.composition.suspensions.length, 1);
  assert.deepEqual(safeResolveLocal(exitResult.composition).issues, []);

  const attResult = removeElementAttachmentFromComposition(exitResult.composition, 'ring', 'strap');
  assert.equal(attResult.removedSuspensions, 1);
  assert.equal(attResult.composition.suspensions.length, 0);
  assert.deepEqual(safeResolveLocal(attResult.composition).issues, []);
});

test('switchCanopyFootprint preserves anchor validity between round and rectangular canopies', () => {
  const example = createGeometryExample();
  const rect = switchCanopyFootprint(example.canopies[0], 'rectangular');
  assert.equal(rect.footprint.type, 'rectangular');
  assert.deepEqual(safeResolveLocal({ ...example, canopies: [rect] }).issues, []);

  const backToRound = switchCanopyFootprint(rect, 'round');
  assert.equal(backToRound.footprint.type, 'round');
  assert.deepEqual(safeResolveLocal({ ...example, canopies: [backToRound] }).issues, []);
});

test('switchCanopyFootprint preserves estimated status when round diameter depends on an estimated size or fixing coordinate', () => {
  const example = createGeometryExample();
  const baseCanopy = example.canopies[0];

  // Width 240 mm (documentation), depth 260 mm (estimated) -> diameter 260 mm (estimated)
  const rectWithEstimatedDepth = {
    ...baseCanopy,
    footprint: {
      type: 'rectangular' as const,
      widthMm: { value: 240, source: 'documentation' as const },
      depthMm: { value: 260, source: 'estimated' as const },
    },
    exits: [
      {
        ...baseCanopy.exits[0],
        point: {
          x: { value: 0, source: 'documentation' as const },
          y: { value: 0, source: 'documentation' as const },
          z: { value: 0, source: 'documentation' as const },
        },
      },
    ],
    ceilingFixings: [
      {
        ...baseCanopy.ceilingFixings[0],
        point: {
          x: { value: 0, source: 'documentation' as const },
          y: { value: 0, source: 'documentation' as const },
          z: { value: baseCanopy.dropMm.value, source: 'documentation' as const },
        },
      },
    ],
  };
  const roundFromDepth = switchCanopyFootprint(rectWithEstimatedDepth, 'round');
  assert.equal(roundFromDepth.footprint.type, 'round');
  if (roundFromDepth.footprint.type === 'round') {
    assert.equal(roundFromDepth.footprint.diameterMm.value, 260);
    assert.equal(roundFromDepth.footprint.diameterMm.source, 'estimated');
  }

  // Both dimensions 240 mm (documentation), but ceiling fixing at (100 doc, 100 estimated) forces diameter 283 mm -> estimated
  const rectWithEstimatedFixing = {
    ...rectWithEstimatedDepth,
    footprint: {
      type: 'rectangular' as const,
      widthMm: { value: 240, source: 'documentation' as const },
      depthMm: { value: 240, source: 'documentation' as const },
    },
    ceilingFixings: [
      {
        ...baseCanopy.ceilingFixings[0],
        point: {
          x: { value: 100, source: 'documentation' as const },
          y: { value: 100, source: 'estimated' as const },
          z: { value: baseCanopy.dropMm.value, source: 'documentation' as const },
        },
      },
    ],
  };
  const roundFromFixing = switchCanopyFootprint(rectWithEstimatedFixing, 'round');
  assert.equal(roundFromFixing.footprint.type, 'round');
  if (roundFromFixing.footprint.type === 'round') {
    assert.equal(roundFromFixing.footprint.diameterMm.value, 283);
    assert.equal(roundFromFixing.footprint.diameterMm.source, 'estimated');
  }
  assert.deepEqual(
    safeResolveLocal({ ...example, canopies: [roundFromFixing], suspensions: [] }).issues,
    [],
  );

  // Pure documentation dimensions & centered anchors preserve documentation source
  const rectPureDoc = {
    ...rectWithEstimatedDepth,
    footprint: {
      type: 'rectangular' as const,
      widthMm: { value: 240, source: 'documentation' as const },
      depthMm: { value: 240, source: 'documentation' as const },
    },
  };
  const roundPureDoc = switchCanopyFootprint(rectPureDoc, 'round');
  assert.equal(roundPureDoc.footprint.type, 'round');
  if (roundPureDoc.footprint.type === 'round') {
    assert.equal(roundPureDoc.footprint.diameterMm.value, 240);
    assert.equal(roundPureDoc.footprint.diameterMm.source, 'documentation');
  }
});

test('removeSuspensionGuidePoint deletes single guides and reverts to straight when last guide is removed', () => {
  const example = createGeometryExample();
  const strap = example.suspensions[1];
  assert.equal(strap.routing.type, 'guided');
  const withTwo = {
    ...strap,
    routing: {
      type: 'guided' as const,
      guides: [...strap.routing.guides, { x: { value: 100, source: 'user' as const }, y: { value: 0, source: 'user' as const }, z: { value: 2100, source: 'user' as const } }],
    },
  };
  const afterFirst = removeSuspensionGuidePoint(withTwo, 0);
  assert.equal(afterFirst.routing.type, 'guided');
  if (afterFirst.routing.type === 'guided') {
    assert.equal(afterFirst.routing.guides.length, 1);
    assert.equal(afterFirst.routing.guides[0].x.value, 100);
  }
  const afterLast = removeSuspensionGuidePoint(afterFirst, 0);
  assert.deepEqual(afterLast.routing, { type: 'straight' });
});

test('cloneCompositionWithNewId creates distinct valid IDs and empty name errors are localized to Russian', () => {
  const myline = createMylineComposition();
  const copy = cloneCompositionWithNewId(myline, 'MYLINE Copy');
  assert.notEqual(copy.id, myline.id);
  assert.equal(copy.name, 'MYLINE Copy');
  assert.deepEqual(safeResolveLocal(copy).issues, []);

  const emptyName = safeResolveLocal({ ...myline, name: '   ' });
  assert.equal(emptyName.issues.length, 1);
  assert.equal(formatGeometryIssuePath(emptyName.issues[0].path), 'Название композиции');
  assert.equal(emptyName.issues[0].message, 'Поле не может быть пустым.');
});
