import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compositionSchema, type Axis } from '../src/geometry/schema.ts';
import { engineeringToThree, resolveComposition } from '../src/geometry/resolve.ts';
import { createGeometryExample, createMylineComposition } from '../src/geometry/examples.ts';
import { createMyline } from '../src/domain/myline.ts';
import { projectSchema } from '../src/domain/project.ts';
import { resolvedCompositionSchema } from '../src/geometry/result.ts';

const exact = (value: number): Axis => ({ value, source: 'user' });
const near = (actual: number | null, expected: number) => {
  assert.notEqual(actual, null);
  assert.ok(Math.abs(actual! - expected) < 1e-8, `${actual} should be near ${expected}`);
};

test('resolves shapes, datums, canopy exits and independent suspension routes', () => {
  const result = resolvedCompositionSchema.parse(resolveComposition(createGeometryExample()));
  const [ring, linear, arc] = result.elements;
  assert.equal(ring.geometry.widthMm, 800);
  assert.equal(ring.geometry.heightMm, 40);
  assert.equal(ring.lowest.fromFloor.valueMm, 1750);
  assert.equal(ring.highest.aboveTabletop.valueMm, 1040);
  assert.equal(linear.lowest.belowCeiling.valueMm, 1100);
  assert.equal(linear.highest.fromFloor.valueMm, 1960);
  assert.equal(linear.geometry.widthMm, 1000);
  assert.equal(arc.geometry.arc?.centerlineRadiusMm, 375);
  near(arc.geometry.widthMm, 616);
  near(arc.geometry.heightMm, 166);
  assert.equal(result.canopies[0].origin.z.valueMm, 2940);
  assert.equal(result.canopies[0].ceilingFixings[0].world.z.valueMm, 3000);
  const [cable, strap] = result.suspensions;
  assert.equal(cable.verticalDrop.valueMm, 1150);
  assert.equal(cable.pathLength.valueMm, 1150);
  assert.equal(cable.cutLength.valueMm, 1200);
  assert.equal(strap.verticalDrop.valueMm, 1170);
  assert.equal(strap.points.length, 3);
  near(strap.pathLength.valueMm, Math.hypot(120, 600) + Math.hypot(160, 570));
  near(strap.cutLength.valueMm, Math.hypot(120, 600) + Math.hypot(160, 570) + 80);
});

test('MYLINE preserves supplied dimensions, light data and the unknown tabletop datum', () => {
  const project = projectSchema.parse(createMyline());
  const result = resolveComposition(createMylineComposition(project));
  assert.equal(result.site.ceilingFromFloorMm?.value, 5750);
  assert.equal(result.site.tabletopFromFloorMm, undefined);
  assert.deepEqual(project.components.map(x => [x.quantity, x.light.directionId, x.light.watts?.value, x.light.lumens?.value]), [
    [2, 'up', 59, 4779], [2, 'down', 44, 3555],
  ]);
  assert.deepEqual(result.elements.map(x => x.geometry.widthMm), [900, 900, 700, 700]);
  assert.deepEqual(result.elements.map(x => x.geometry.heightMm), [700, 700, 550, 550]);
  assert.deepEqual(result.elements.map(x => x.lowest.aboveTabletop.valueMm), [900, 950, 1250, 1500]);
  for (const item of result.elements) {
    assert.equal(item.geometry.representation, 'envelope');
    assert.equal(item.geometry.arc, undefined);
    assert.equal(item.origin.z.valueMm, null);
    assert.equal(item.origin.x.valueMm, null);
    assert.equal(item.yawDeg, undefined);
  }
  assert.equal(result.suspensions.length, 0);
});

test('returns the symbolic dependency with unknown table height and rejects an invented number', () => {
  const data = createGeometryExample();
  delete data.site.tabletopFromFloorMm;
  const [cable] = resolveComposition(data).suspensions;
  assert.deepEqual(cable.cutLength, { valueMm: null, quality: 'unknown', missing: ['tabletopFromFloorMm'] });
  assert.equal(cable.formula.segments[0].z.offsetMm, 1100);
  assert.deepEqual(cable.formula.segments[0].z.variables, { ceilingFromFloorMm: -1, tabletopFromFloorMm: 1 });
});

test('a ceiling-relative drop can be calculated even when its world elevation is unknown', () => {
  const data = createGeometryExample();
  delete data.site.ceilingFromFloorMm;
  data.elements[0].position.lowest = { datum: 'ceiling', offsetMm: exact(-1200) };
  const result = resolveComposition(data);
  assert.equal(result.elements[0].origin.z.valueMm, null);
  assert.equal(result.elements[0].lowest.belowCeiling.valueMm, 1200);
  assert.equal(result.suspensions[0].cutLength.valueMm, 1150);
});

test('rotates local attachments and maps right-handed millimetre coordinates to Three.js', () => {
  const data = createGeometryExample();
  data.elements[0].position.yawDeg = exact(90);
  const point = resolveComposition(data).elements[0].attachments[1].world;
  near(point.x.valueMm, 0);
  near(point.y.valueMm, 380);
  assert.deepEqual(engineeringToThree({ x: 5, y: 7, z: 9 }), { x: 5, y: 9, z: -7 });
});

test('unknown yaw cannot resolve a displaced attachment but has no effect on a centered anchor', () => {
  const data = createGeometryExample();
  delete data.elements[0].position.yawDeg;
  const result = resolveComposition(data);
  assert.equal(result.elements[0].attachments[0].world.x.valueMm, 0);
  assert.equal(result.elements[0].attachments[1].world.x.valueMm, null);
});

test('unknown allowance, explicit zero and estimated source have distinct results', () => {
  const data = createGeometryExample();
  const [suspension] = data.suspensions;
  delete suspension.allowanceMm;
  let cable = resolveComposition(data).suspensions[0];
  assert.equal(cable.pathLength.valueMm, 1150);
  assert.deepEqual(cable.cutLength, { valueMm: null, quality: 'unknown', missing: ['allowanceMm'] });

  suspension.allowanceMm = exact(0);
  cable = resolveComposition(data).suspensions[0];
  assert.deepEqual(cable.cutLength, { valueMm: 1150, quality: 'specified' });

  data.canopies[0].dropMm.source = 'estimated';
  cable = resolveComposition(data).suspensions[0];
  assert.equal(cable.cutLength.quality, 'estimated');
});

test('a body above the ceiling or an inverted suspension is explicitly flagged', () => {
  const data = createGeometryExample();
  data.elements[0].position.lowest = { datum: 'floor', offsetMm: exact(2990) };
  const result = resolveComposition(data);
  assert.ok(result.elements[0].issues.includes('bodyAboveCeiling'));
  assert.equal(result.suspensions[0].status, 'invalid');
  assert.equal(result.suspensions[0].cutLength.valueMm, null);
});

test('impossible ring and arc geometry, unknown anchors and invalid canopy exits are rejected', () => {
  const data = createGeometryExample();
  const ring = data.elements[0].shape;
  const arc = data.elements[2].shape;
  assert.equal(ring.type, 'ring');
  assert.equal(arc.type, 'arc');
  ring.innerDiameterMm.value = 900;
  arc.riseMm.value = 350;
  data.canopies[0].exits[0].point.x.value = 200;
  data.suspensions[0].from.exitId = 'missing';
  const answer = compositionSchema.safeParse(data);
  assert.equal(answer.success, false);
  assert.deepEqual(answer.error?.issues.map(x => x.path.join('.')), [
    'elements.0.shape.innerDiameterMm', 'elements.2.shape.riseMm', 'canopies.0.exits.0.point', 'suspensions.0.from',
  ]);
});
