import assert from 'node:assert/strict';
import { test } from 'node:test';
import { catalogueSearch, importReviewLinks, projectFromSearch } from '../src/visual-search/catalogue.ts';
import { maxLocalPhotoBytes } from '../src/visual-search/local-contract.ts';
import {
  buildReviewPrompt,
  buildSimilarQuery,
  clampCrop,
  extractComparisonSpec,
  FULL_CROP,
  groupSearchResults,
  isFullCrop,
  localMatchMeta,
  mergeSearchResults,
  parseChatGptJsonInput,
  parseLensUrlsInput,
  resolveLocalMatchResult,
  shouldUseOriginalForLocalSearch,
} from '../src/ui/visual-search/helpers.ts';

test('groupSearchResults keeps unverified imports separate from exact matches', () => {
  const api = catalogueSearch('Emmemobili MYLINE', 'deep');
  const imported = importReviewLinks([
    { url: 'https://showroom.example.invalid/item/myline?utm_source=lens', title: 'Showroom Listing' },
  ]);
  const merged = mergeSearchResults(api, imported);
  const sections = groupSearchResults(merged);

  assert.equal(sections.originals.length, 1);
  assert.equal(sections.originals[0].id, 'emmemobili-myline');

  assert.equal(sections.exactMatches.length, 0);
  assert.equal(sections.unverified.length, 1);
  assert.equal(sections.unverified[0].category, 'unverified');

  assert.equal(sections.similarModels.length, 1);
  assert.equal(sections.similarModels[0].id, 'emmemobili-myring-table');

  assert.equal(sections.documentation.length, 1);
  assert.equal(sections.documentation[0].id, 'emmemobili-myline');
  assert.match(sections.documentation[0].documentUrl!, /\.pdf$/);
});

test('mergeSearchResults deduplicates by canonical URL and prefers verified_original over unverified', () => {
  const [myline] = catalogueSearch('MYLINE', 'standard');
  const unverifiedSame = {
    id: 'raw-link',
    name: 'Some Link',
    category: 'unverified' as const,
    evidence: 'user_link' as const,
    source: 'https://www.emmemobili.it/en/prodotti/illuminazione/myline?utm_medium=social#top',
  };

  const mergedA = mergeSearchResults([unverifiedSame], [myline]);
  assert.equal(mergedA.length, 1);
  assert.equal(mergedA[0].category, 'verified_original');

  const mergedB = mergeSearchResults([myline], [unverifiedSame]);
  assert.equal(mergedB.length, 1);
  assert.equal(mergedB[0].category, 'verified_original');
});

test('extractComparisonSpec reflects documented MYLINE specifications from PR #11 and keeps absent specs honest', () => {
  const [myline, myring] = catalogueSearch('Emmemobili MYLINE', 'deep');
  assert.ok(myline.specifications, 'MYLINE catalogue entry should include documented specifications');

  // ICBA02 (900 mm ring): filters lighting configurations to 900 mm showing BOTH up and down
  const spec900 = extractComparisonSpec(myline, 'ICBA02');
  assert.equal(spec900.design.confirmed, true);
  assert.match(spec900.design.value, /Люстра/);
  assert.match(spec900.design.value, /Подвесное кольцо/);
  assert.match(spec900.design.value, /Adele Martelli/);

  assert.equal(spec900.dimensions.confirmed, true);
  assert.match(spec900.dimensions.value, /ICBA02 · 900 × 60 × 700 мм/);
  assert.match(spec900.dimensions.hint ?? '', /Латунное кольцо/);
  assert.match(spec900.dimensions.hint ?? '', /2000 мм/);

  assert.equal(spec900.materials.confirmed, true);
  assert.match(spec900.materials.value, /Кольцо: Латунь/);
  assert.match(spec900.materials.value, /Декоративные ремни: Кожа/);

  assert.equal(spec900.finish.confirmed, true);
  assert.match(spec900.finish.value, /Natural Satin Brass/);
  assert.match(spec900.finish.value, /Burnished Hand-Brushed Brass/);
  assert.match(spec900.finish.value, /Brezza Leather/);

  assert.equal(spec900.lighting.confirmed, true);
  assert.match(spec900.lighting.value, /LED strip 24 В/);
  assert.match(spec900.lighting.value, /DALI/);
  assert.match(spec900.lighting.value, /900 мм вверх: 59 Вт/);
  assert.match(spec900.lighting.value, /900 мм вниз: 59 Вт/);
  assert.doesNotMatch(spec900.lighting.value, /700 мм/);
  assert.match(spec900.lighting.hint ?? '', /не привязаны к конкретному артикулу/);
  assert.equal(spec900.documentation.confirmed, true);

  // ICBA01 (700 mm ring): filters lighting configurations to 700 mm showing BOTH up (45 W) and down (44 W)
  const spec700 = extractComparisonSpec(myline, 'ICBA01');
  assert.match(spec700.dimensions.value, /ICBA01 · 700 × 60 × 550 мм/);
  assert.match(spec700.lighting.value, /700 мм вверх: 45 Вт/);
  assert.match(spec700.lighting.value, /700 мм вниз: 44 Вт/);
  assert.doesNotMatch(spec700.lighting.value, /900 мм/);

  // Without specifications object, finish MUST remain unconfirmed (separate from material)
  const { specifications: _omitted, ...withoutSpecs } = myline;
  const fallbackSpec = extractComparisonSpec(withoutSpecs, 'ICBA02');
  assert.equal(fallbackSpec.finish.confirmed, false);
  assert.match(fallbackSpec.materials.value, /Латунные кольца/);

  // Myring Table has no variants, PDF, specifications, or dimming — must remain honestly unconfirmed
  const myringSpec = extractComparisonSpec(myring);
  assert.equal(myringSpec.dimensions.confirmed, false);
  assert.equal(myringSpec.materials.confirmed, false);
  assert.equal(myringSpec.finish.confirmed, false);
  assert.equal(myringSpec.lighting.confirmed, false);
  assert.equal(myringSpec.documentation.confirmed, false);
});

test('buildSimilarQuery produces real searchable keywords that find catalogue alternatives in deep mode', () => {
  const [myline] = catalogueSearch('MYLINE', 'standard');
  const similarQuery = buildSimilarQuery(myline);
  assert.match(similarQuery, /Emmemobili/);
  assert.match(similarQuery, /MYLINE/);
  const deepResults = catalogueSearch(similarQuery, 'deep');
  assert.ok(deepResults.some(item => item.id === 'emmemobili-myring-table'));
});

test('clampCrop keeps selection valid inside 0..100 bounds with minimum 10% size', () => {
  assert.equal(isFullCrop(FULL_CROP), true);
  assert.deepEqual(clampCrop({ x: -20, y: 95, width: 5, height: 40 }), {
    x: 0,
    y: 60,
    width: 10,
    height: 40,
  });
  assert.deepEqual(clampCrop({ x: 80, y: 10, width: 50, height: 50 }), {
    x: 50,
    y: 10,
    width: 50,
    height: 50,
  });
});

test('parseLensUrlsInput and parseChatGptJsonInput validate URLs and fenced JSON safely', () => {
  const lensLinks = parseLensUrlsInput(
    'https://www.emmemobili.it/en/prodotti/illuminazione/myline\nhttps://gallery.example.invalid/lamp',
  );
  assert.equal(lensLinks.length, 2);
  assert.equal(lensLinks[0].title, 'emmemobili.it');
  assert.throws(() => parseLensUrlsInput('javascript:alert(1)'));

  const fencedJson = '```json\n{"results":[{"title":"MYLINE","url":"https://www.emmemobili.it/en/prodotti/illuminazione/myline"}]}\n```';
  const parsed = parseChatGptJsonInput(fencedJson);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].title, 'MYLINE');
  assert.throws(() => parseChatGptJsonInput('{"results":[]}'));
  assert.throws(() => parseChatGptJsonInput('not json'));
});

test('buildReviewPrompt focuses on chosen card while preserving Original not verified rule', () => {
  const [myline, myring] = catalogueSearch('Emmemobili MYLINE', 'deep');
  const prompt = buildReviewPrompt('MYLINE', [myline, myring], myline);
  assert.match(prompt, /Original not verified/);
  assert.match(prompt, /Приоритетный кандидат для проверки: Emmemobili MYLINE/);
  assert.match(prompt, /Myring Table/);
  assert.match(prompt, /"results"/);
});

test('local visual search helpers distinguish same_file vs similar_image, preserve original bytes when uncropped, and link official catalogue specs for RFQ', () => {
  const same = localMatchMeta('same_file');
  assert.equal(same.label, 'Тот же файл');
  assert.match(same.explanation, /Original not verified/);

  const similar = localMatchMeta('similar_image');
  assert.equal(similar.label, 'Похожий кадр');
  assert.match(similar.explanation, /Original not verified/);

  // Full uncropped file <= 5 MiB uses untouched original bytes so SHA-256 can match same_file
  assert.equal(shouldUseOriginalForLocalSearch({ size: 200_000 }, FULL_CROP), true);
  // Any active crop or oversized file (> 5 MiB) must be rendered as cropped/resized JPEG copy
  assert.equal(
    shouldUseOriginalForLocalSearch({ size: 200_000 }, { x: 10, y: 10, width: 70, height: 70 }),
    false,
  );
  assert.equal(
    shouldUseOriginalForLocalSearch({ size: maxLocalPhotoBytes + 1 }, FULL_CROP),
    false,
  );

  // Official manufacturer URL (including IT alias from PR #14) enriches MYLINE specs & RFQ dimensions while keeping category visual_alternative
  const linkedMyline = resolveLocalMatchResult({
    id: 'myline-local-1',
    title: 'Emmemobili MYLINE',
    source: 'https://www.emmemobili.it/prodotti/illuminazione/myline',
    match: 'same_file',
  });
  assert.ok(linkedMyline);
  assert.equal(linkedMyline.id, 'emmemobili-myline');
  assert.equal(linkedMyline.category, 'visual_alternative');
  assert.ok(linkedMyline.specifications);
  const icba02 = linkedMyline.variants?.find(v => v.sku === 'ICBA02');
  assert.ok(icba02);
  const rfq = projectFromSearch(linkedMyline, icba02);
  assert.equal(rfq.project.code, 'ICBA02');
  assert.deepEqual(rfq.project.components[0].dimensions.width, { value: 900, source: 'documentation' });
  assert.equal(rfq.project.components[0].light.dimming, 'DALI');

  // Unknown domain remains unverified; missing source yields undefined
  const unverified = resolveLocalMatchResult({
    id: 'shop-1',
    title: 'External Lamp',
    source: 'https://shop.example.invalid/lamp',
    match: 'similar_image',
  });
  assert.equal(unverified?.category, 'unverified');
  assert.equal(
    resolveLocalMatchResult({ id: 'local-only', title: 'Studio Sample', match: 'similar_image' }),
    undefined,
  );
});



