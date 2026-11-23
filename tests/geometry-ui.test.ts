import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGeometryExample, createMylineComposition } from '../src/geometry/examples.ts';
import { resolveComposition } from '../src/geometry/resolve.ts';
import {
  addCanopyToComposition,
  addElementToComposition,
  addSuspensionToComposition,
  collectMissingInputs,
  computeElementDistances,
  computeVisualLayout,
  formatSuspensionFormula,
  safeResolveLocal,
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

  // Canonical data remains untouched: unknown tabletop, unknown XY, zero fabricated suspensions
  assert.equal(resolved.site.tabletopFromFloorMm, undefined);
  assert.equal(resolved.suspensions.length, 0);
  for (const el of resolved.elements) {
    assert.equal(el.origin.x.valueMm, null);
    assert.equal(el.origin.z.valueMm, null);
    assert.equal(layout.elements[el.id].xStaged, true);
    assert.equal(layout.elements[el.id].zMode, 'relative-tabletop-staged');
  }

  // Pairwise XY distances stay null (never invented) while known ΔZ above tabletop is computed accurately
  const pairs = computeElementDistances(resolved);
  assert.equal(pairs.length, 6);
  for (const pair of pairs) {
    assert.equal(pair.centerDistanceMm, null);
  }
  assert.equal(pairs[0].deltaZLowestMm, 50); // 950 - 900 mm

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
