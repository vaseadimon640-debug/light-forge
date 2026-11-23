import assert from 'node:assert/strict';
import { test } from 'node:test';
import { POST } from '../src/app/api/rfq/quick/route.ts';
import { createMyline } from '../src/domain/myline.ts';
import { newComponent, newProject } from '../src/domain/project.ts';
import { createGeometryExample, createMylineComposition } from '../src/geometry/examples.ts';
import { buildQuickRfq, RfqConflict, textQuickRfq } from '../src/rfq/quick.ts';

const endpoint = 'http://test/api/rfq/quick';
const post = (input: unknown, query = '') => new Request(endpoint + query, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
});

test('MYLINE retains dimensions, per-part electrical values, all placements and unknown table height in both languages', () => {
  const project = createMyline();
  const document = buildQuickRfq({ project, composition: createMylineComposition(project) });
  const en = textQuickRfq(document, 'en');
  const zh = textQuickRfq(document, 'zh');
  for (const string of ['59 W', '4779 lm', '44 W', '3555 lm', '3000 K', 'DALI', '5750 mm', '900 mm', '950 mm', '1250 mm', '1500 mm'])
    assert.ok(en.includes(string) && zh.includes(string), string);
  assert.match(en, /Tabletop above finished floor: To be confirmed by manufacturer/);
  assert.match(zh, /桌面距完成地面: 待制造商确认/);
  assert.match(en, /Canopy and suspension fabrication lengths: To be confirmed by manufacturer/);
  assert.match(en, /solid brass/i);
  assert.match(zh, /实心黄铜/);
  assert.match(en, /PU, PVC/);
  assert.match(zh, /真皮/);
});

test('known geometry fills absent dimensions; mismatched sizes and mounting levels are detected', () => {
  const project = createMyline();
  const composition = createMylineComposition(project);
  delete project.components[0].dimensions.width;
  assert.match(textQuickRfq(buildQuickRfq({ project, composition }), 'en'), /Width: 900 mm/);
  project.components[0].dimensions.width = { value: 999, source: 'user' };
  assert.throws(() => buildQuickRfq({ project, composition }), RfqConflict);
  delete project.components[0].dimensions.width;
  composition.elements[0].position.lowest.offsetMm = { value: 902, source: 'user' };
  assert.throws(() => buildQuickRfq({ project, composition }), RfqConflict);
});

function linkedEngineeringExample() {
  const project = newProject();
  const composition = createGeometryExample();
  composition.projectId = project.id;
  project.components = composition.elements.map(element => {
    const component = newComponent(element.shape.type === 'envelope' ? element.shape.intendedShape : element.shape.type);
    element.productComponentId = component.id;
    return component;
  });
  return { project, composition };
}

test('RFQ keeps canopy dimensions and individual calculated cable and strap lengths in both languages', async () => {
  const input = linkedEngineeringExample();
  const response = await POST(post(input, '?lang=en-zh'));
  assert.equal(response.status, 200);
  const { text } = await response.json();
  assert.match(text, /Round canopy · Diameter[^\n]*240 mm/);
  assert.match(text, /Round canopy · Drop below ceiling[^\n]*60 mm/);
  assert.match(text, /Load-bearing cable \(cable\) · Path length[^\n]*1150 mm/);
  assert.match(text, /Load-bearing cable \(cable\) · Cut length for quotation, including allowance[^\n]*1200 mm/);
  assert.match(text, /Decorative strap \(strap\) · Cut length for quotation, including allowance[^\n]*1283\.91 mm/);
  assert.match(text, /装饰吊带（strap） · 报价参考裁切长度（含余量）/);
  assert.match(text, /Canopy and suspension fabrication lengths[^\n]*To be confirmed by manufacturer/);
});

test('RFQ distinguishes estimated, missing and invalid lengths', () => {
  const input = linkedEngineeringExample();
  delete input.composition.suspensions[0].allowanceMm;
  input.composition.canopies[0].dropMm.source = 'estimated';
  let text = textQuickRfq(buildQuickRfq(input), 'en');
  assert.match(text, /Load-bearing cable \(cable\) · Path length: 1150 mm · Estimated/);
  assert.match(text, /Load-bearing cable \(cable\) · Cut length for quotation, including allowance: To be confirmed/);

  input.composition.elements[0].position.lowest = { datum: 'floor', offsetMm: { value: 2990, source: 'user' } };
  text = textQuickRfq(buildQuickRfq(input), 'en');
  assert.match(text, /Load-bearing cable \(cable\): Invalid mounting geometry/);
  assert.doesNotMatch(text, /Load-bearing cable \(cable\) · (Path|Cut) length/);
});

test('estimates stay labelled and the text route supports bilingual responses', async () => {
  const project = createMyline();
  project.components[0].light.watts = { value: 61, source: 'estimated' };
  const response = await POST(post({ project }, '?lang=en-zh'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const { language, text } = await response.json();
  assert.equal(language, 'en-zh');
  assert.match(text, /61 W · Estimated \/ 61 W · 估算/);
  assert.match(text, /显色指数/);
  assert.match(text, /CRI/);
});

test('PDF upload requires original images and rejects mismatched file contents before rendering', async () => {
  const project = createMyline();
  project.photos = [{ id: 'original', name: 'original.png', size: 4, type: 'image/png' }];
  project.primaryPhotoId = 'original';
  const response = await POST(post({ project }, '?format=pdf'));
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error, 'invalid_photo');

  const form = new FormData();
  form.set('input', JSON.stringify({ project }));
  form.set('photo:original', new Blob(['fake'], { type: 'image/png' }), 'original.png');
  const invalid = await POST(new Request(endpoint + '?format=pdf', { method: 'POST', body: form }));
  assert.equal(invalid.status, 422);
  assert.equal((await invalid.json()).error, 'invalid_photo');
});

test('RFQ rejects oversized and cross-site requests', async () => {
  const large = await POST(new Request(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: ' '.repeat(1048577) }));
  assert.equal(large.status, 413);
  const crossSite = await POST(new Request(endpoint, { method: 'POST', headers: { 'sec-fetch-site': 'cross-site' } }));
  assert.equal(crossSite.status, 403);
});
