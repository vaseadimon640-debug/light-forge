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
  ]);
  assert.equal(imported.length, 2);
  assert.equal(imported[0].category, 'unverified');
  assert.equal(imported[0].source, canonical);
  assert.equal(imported[1].name, 'MYLINE');
  assert.equal(imported[1].category, 'verified_original');
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
  assert.equal(result.originalVerified,false);
  assert.equal(result.paidEnabled,false);
  assert.deepEqual(result.links.map(link=>link.language),['en','zh-CN','it','de']);
  const capabilities = await GET().json();
  assert.equal(capabilities.serpApi.enabled,false);
  assert.equal(capabilities.manualLens,true);
});
