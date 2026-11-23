import assert from 'node:assert/strict';
import { test } from 'node:test';
import { catalogueSearch, importReviewLinks } from '../src/visual-search/catalogue.ts';
import {
  buildReviewPrompt,
  buildSimilarQuery,
  clampCrop,
  extractComparisonSpec,
  FULL_CROP,
  groupSearchResults,
  isFullCrop,
  mergeSearchResults,
  parseChatGptJsonInput,
  parseLensUrlsInput,
} from '../src/ui/visual-search/helpers.ts';

test('groupSearchResults distributes real API and imported items into all 4 UI sections', () => {
  const api = catalogueSearch('Emmemobili MYLINE', 'deep');
  const imported = importReviewLinks([
    { url: 'https://showroom.example.invalid/item/myline?utm_source=lens', title: 'Showroom Listing' },
  ]);
  const merged = mergeSearchResults(api, imported);
  const sections = groupSearchResults(merged);

  assert.equal(sections.originals.length, 1);
  assert.equal(sections.originals[0].id, 'emmemobili-myline');

  assert.equal(sections.exactMatches.length, 1);
  assert.equal(sections.exactMatches[0].category, 'unverified');

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

test('extractComparisonSpec reflects real catalogue data and keeps unconfirmed finish/specs honest', () => {
  const [myline, myring] = catalogueSearch('Emmemobili MYLINE', 'deep');

  const mylineSpec = extractComparisonSpec(myline, 'ICBA02');
  assert.equal(mylineSpec.design.confirmed, true);
  assert.match(mylineSpec.design.value, /Люстра/);
  assert.match(mylineSpec.design.value, /Adele Martelli/);

  assert.equal(mylineSpec.dimensions.confirmed, true);
  assert.match(mylineSpec.dimensions.value, /ICBA02 · 900 × 60 × 700 мм/);

  assert.equal(mylineSpec.materials.confirmed, true);
  assert.match(mylineSpec.materials.value, /Латунные кольца/);
  assert.match(mylineSpec.materials.value, /кожаные ремни/);

  // Finish MUST stay separate from material and remain unconfirmed when not explicitly stated
  assert.equal(mylineSpec.finish.confirmed, false);

  assert.equal(mylineSpec.lighting.confirmed, true);
  assert.match(mylineSpec.lighting.value, /LED/);
  assert.match(mylineSpec.lighting.value, /DALI/);
  assert.equal(mylineSpec.documentation.confirmed, true);

  // Myring Table has no variants, PDF, or dimming in starter catalogue — must remain honest/unconfirmed
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

test('extractComparisonSpec renders documented PR #11 specifications and filters lighting by ringWidthMm keeping both up and down directions', () => {
  const [baseMyline] = catalogueSearch('MYLINE', 'standard');
  const enriched = {
    ...baseMyline,
    specifications: {
      designer: 'Adele Martelli',
      form: 'Подвесное кольцо',
      materials: [
        { part: 'Кольцо', material: 'Латунь' },
        { part: 'Декоративные ремни', material: 'Кожа' },
      ],
      finishes: [
        { part: 'Кольцо', code: 'O', name: 'Natural Satin Brass' },
        { part: 'Кольцо', code: 'OB', name: 'Burnished Hand-Brushed Brass' },
        { part: 'Декоративные ремни', code: '602', name: 'Brezza Leather · Moro' },
      ],
      dimensionsReferTo: 'Латунное кольцо',
      standardMaxBandLengthMm: 2000,
      lighting: {
        sourceType: 'LED strip',
        sourceVoltageV: 24,
        supplyVoltageV: [
          { min: 220, max: 240 },
          { min: 110, max: 120 },
        ],
        configurations: [
          {
            ringWidthMm: 700,
            direction: 'up' as const,
            powerW: 45,
            netWeightKg: 5,
            outputs: [
              { cctK: 2700, lumens: 3288 },
              { cctK: 3000, lumens: 3609 },
              { cctK: 4000, lumens: 3930 },
            ],
          },
          {
            ringWidthMm: 700,
            direction: 'down' as const,
            powerW: 44,
            netWeightKg: 5,
            outputs: [
              { cctK: 2700, lumens: 3239 },
              { cctK: 3000, lumens: 3555 },
              { cctK: 4000, lumens: 3871 },
            ],
          },
          {
            ringWidthMm: 900,
            direction: 'up' as const,
            powerW: 59,
            netWeightKg: 7,
            outputs: [
              { cctK: 2700, lumens: 4354 },
              { cctK: 3000, lumens: 4779 },
              { cctK: 4000, lumens: 5204 },
            ],
          },
          {
            ringWidthMm: 900,
            direction: 'down' as const,
            powerW: 59,
            netWeightKg: 7,
            outputs: [
              { cctK: 2700, lumens: 4305 },
              { cctK: 3000, lumens: 4725 },
              { cctK: 4000, lumens: 5145 },
            ],
          },
        ],
      },
    },
  };

  const spec900 = extractComparisonSpec(enriched, 'ICBA02');
  assert.match(spec900.design.value, /Подвесное кольцо/);
  assert.match(spec900.design.value, /Adele Martelli/);
  assert.match(spec900.dimensions.hint ?? '', /Латунное кольцо/);
  assert.match(spec900.dimensions.hint ?? '', /2000 мм/);
  assert.match(spec900.materials.value, /Кольцо: Латунь/);
  assert.match(spec900.materials.value, /Декоративные ремни: Кожа/);
  assert.equal(spec900.finish.confirmed, true);
  assert.match(spec900.finish.value, /Natural Satin Brass/);
  assert.match(spec900.finish.value, /Burnished Hand-Brushed Brass/);
  assert.match(spec900.finish.value, /Brezza Leather/);
  assert.match(spec900.lighting.value, /LED strip 24 В/);
  assert.match(spec900.lighting.value, /900 мм вверх: 59 Вт/);
  assert.match(spec900.lighting.value, /900 мм вниз: 59 Вт/);
  assert.doesNotMatch(spec900.lighting.value, /700 мм/);
  assert.match(spec900.lighting.hint ?? '', /не привязаны к конкретному артикулу/);
});

