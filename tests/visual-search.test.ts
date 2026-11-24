import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GET, POST } from '../src/app/api/visual-search/route.ts';
import { selectGeminiModel } from '../src/server/visual-search-gemini.ts';
import { canonicalSource, catalogueSearch, importReviewLinks, projectFromSearch, searchResponseSchema } from '../src/visual-search/catalogue.ts';
import { projectSchema } from '../src/domain/project.ts';

test('starter catalogue retrieves verified product references and an explicitly unverified alternative', () => {
  for (const [query, id] of [['Emmemobili MYLINE', 'emmemobili-myline'], ['Myring Table', 'emmemobili-myring-table']]) {
    const topFive = catalogueSearch(query, 'standard').slice(0, 5);
    assert.equal(topFive[0]?.id, id);
    assert.equal(topFive[0]?.category, 'verified_original');
  }
  const [known, alternative] = catalogueSearch('MYLINE ring', 'deep');
  assert.equal(known.brand, 'Emmemobili');
  assert.match(known.documentUrl!, /\.pdf$/);
  assert.deepEqual(known.variants?.map(item => item.sku), ['ICBA02','ICBB02','ICBA01','ICBB01']);
  assert.equal(alternative.category, 'visual_alternative');
  assert.equal(alternative.name, 'Myring Table');
  assert.equal(catalogueSearch('unknownsku-9182', 'deep').length, 0);
  assert.ok(catalogueSearch('环形灯具', 'deep').length > 0);
});

test('review links remove trackers and duplicate pages without granting untrusted claims credibility', () => {
  const canonical = 'https://shop.example.invalid/item?variant=2';
  const imported = importReviewLinks([
    { url: canonical + '&utm_source=lens', title: 'Reference' },
    { url: canonical + '#gallery', title: 'Duplicate' },
    { url: 'https://www.emmemobili.it/prodotti/illuminazione/myline?utm_campaign=x', title: 'Maker' },
    { url: 'https://www.emmemobili.it/en/prodotti/illuminazione/myline', title: 'MYLINE English' },
  ]);
  assert.equal(imported.length, 2);
  assert.equal(imported[0].category, 'unverified');
  assert.equal(imported[0].source, canonical);
  assert.equal(imported[1].name, 'MYLINE');
  assert.equal(imported[1].category, 'verified_original');
  assert.equal(imported[1].source, 'https://www.emmemobili.it/en/prodotti/illuminazione/myline');
  const [myring] = importReviewLinks([{ url: 'https://www.emmemobili.it/en/prodotti/illuminazione/myring-table', title: 'Myring Table' }]);
  assert.equal(myring.category, 'verified_original');
  assert.equal(importReviewLinks([{ url: 'https://emmemobili.example.invalid/en/prodotti/illuminazione/myline', title: 'MYLINE' }])[0].category, 'unverified');
  assert.throws(() => canonicalSource('javascript:alert(1)'));
  assert.throws(() => canonicalSource('https://someone:secret@example.com/model'));
});

test('creating an RFQ imports documented variant dimensions and preserves the supplied image', async () => {
  const [result] = catalogueSearch('ICBA02', 'standard');
  const image = new File([new Uint8Array([0,128,255])], 'reference.png', { type: 'image/png' });
  const { project, originals } = projectFromSearch(result, result.variants![0], image);
  assert.equal(projectSchema.parse(project).code,'ICBA02');
  assert.deepEqual(project.components[0].dimensions.height, { value: 700, source: 'documentation' });
  assert.equal(project.components[0].light.dimming, 'DALI');
  assert.equal(project.components[0].light.watts, undefined);
  assert.equal(project.components[0].light.directionId, undefined);
  assert.deepEqual(new Uint8Array(await originals[project.primaryPhotoId!].arrayBuffer()), new Uint8Array([0,128,255]));
  assert.equal(projectFromSearch(result).project.components[0].dimensions.width, undefined);
});

test('an RFQ for a catalogue alternative uses only the documented data for the selected SKU', async () => {
  const response = await POST(new Request('http://lf/api/visual-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'латунь', mode: 'standard' }),
  }));
  assert.equal(response.status, 200);
  const { results, originalVerified } = searchResponseSchema.parse(await response.json());
  const result = results.find(item => item.id === 'emmemobili-myline');
  assert.ok(result);
  assert.equal(result.category, 'visual_alternative');
  assert.equal(originalVerified, false);
  const variant = result.variants?.find(item => item.sku === 'ICBA02');
  assert.ok(variant);
  const { project } = projectFromSearch(result, { ...variant, widthMm: 1 });
  const [component] = projectSchema.parse(project).components;
  assert.equal(project.code, 'ICBA02');
  assert.deepEqual(component.dimensions, {
    width: { value: 900, source: 'documentation' },
    depth: { value: 60, source: 'documentation' },
    height: { value: 700, source: 'documentation' },
  });
  assert.equal(component.light.dimming, 'DALI');
  assert.equal(component.light.watts, undefined);
  assert.equal(component.light.directionId, undefined);
  assert.equal(projectFromSearch({ ...result, evidence: 'user_link' }, variant).project.code, '');
  assert.equal(projectFromSearch(result, { ...variant, sku: 'UNKNOWN' }).project.code, '');
});

test('Gemini discovery chooses only an approved listed generation model', () => {
  assert.equal(selectGeminiModel(['gemini-approved','gemini-other-approved'], [
    { name: 'models/gemini-approved', supportedActions: ['countTokens'] },
    { name: 'models/gemini-paid', supportedActions: ['generateContent'] },
    { name: 'models/gemini-other-approved', supportedActions: ['generateContent'] },
  ]), 'gemini-other-approved');
  assert.equal(selectGeminiModel([],[]), undefined);
});

test('offline search API returns real catalogue links without activating paid providers', async () => {
  const payload = { query:'MYLINE', mode:'deep' };
  const url = 'http://lf/api/visual-search';
  const response = await POST(new Request(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}));
  assert.equal(response.status,200);
  const result = searchResponseSchema.parse(await response.json());
  assert.equal(result.results[0].name,'MYLINE');
  const specs = result.results[0].specifications;
  assert.equal(specs?.dimensionsReferTo, 'Латунное кольцо');
  assert.deepEqual(specs?.finishes?.map(finish => finish.code), ['O', 'OB', '602']);
  assert.deepEqual(specs?.lighting?.configurations.find(item => item.ringWidthMm === 900 && item.direction === 'down')?.outputs, [
    { cctK: 2700, lumens: 4305 }, { cctK: 3000, lumens: 4725 }, { cctK: 4000, lumens: 5145 },
  ]);
  assert.equal(result.originalVerified,false);
  assert.equal(result.paidEnabled,false);
  assert.deepEqual(result.links.map(link=>link.language),['en','zh-CN','it','de']);
  const capabilities = await GET().json();
  assert.equal(capabilities.serpApi.enabled,false);
  assert.equal(capabilities.manualLens,true);
});
