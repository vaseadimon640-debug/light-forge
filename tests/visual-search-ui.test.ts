import assert from 'node:assert/strict';
import { test } from 'node:test';
import { catalogueSearch, importReviewLinks, projectFromSearch } from '../src/visual-search/catalogue.ts';
import { maxLocalPhotoBytes } from '../src/visual-search/local-contract.ts';
import {
  buildGeminiInsights,
  buildReviewPrompt,
  buildRfqSnapshotFromSearch,
  buildSimilarQuery,
  buildUnconfirmedChecklist,
  clampCrop,
  clampZoom,
  DEFAULT_RESULT_FILTERS,
  evidenceBadgeTone,
  extractComparisonSpec,
  extractFilterOptions,
  filterAndSortResults,
  formatTransformSummary,
  FULL_CROP,
  groupSearchResults,
  isFullCrop,
  isTransformDefault,
  localMatchMeta,
  mergeAllSearchCandidates,
  mergeSearchResults,
  normalizeClipboardFile,
  parseChatGptJsonInput,
  parseLensUrlsInput,
  resolveLocalMatchResult,
  rotateCropRect,
  rotateDegrees,
  shouldUseOriginalForLocalSearch,
  UNBRANDED_FILTER_VALUE,
  validateIncomingPhotos,
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

test('rotation, crop rotation, zoom clamp, and working-copy routing keep transforms exact and non-destructive', () => {
  assert.equal(rotateDegrees(0, 90), 90);
  assert.equal(rotateDegrees(0, -90), 270);
  assert.equal(rotateDegrees(270, 90), 0);

  // Rotating a crop rectangle 90° CW and back 90° CCW restores the exact coordinates
  const rect = { x: 10, y: 20, width: 30, height: 40 };
  const cw = rotateCropRect(rect, 90);
  assert.deepEqual(cw, { x: 40, y: 10, width: 40, height: 30 });
  assert.deepEqual(rotateCropRect(cw, -90), rect);
  assert.deepEqual(rotateCropRect(FULL_CROP, 90), FULL_CROP);

  assert.equal(clampZoom(0.5), 1);
  assert.equal(clampZoom(2.25), 2.25);
  assert.equal(clampZoom(8), 3);

  // Any non-zero rotation forces a working copy for local search while original bytes stay untouched
  assert.equal(isTransformDefault(FULL_CROP, 0), true);
  assert.equal(isTransformDefault(FULL_CROP, 90), false);
  assert.equal(shouldUseOriginalForLocalSearch({ size: 120_000 }, FULL_CROP, 0), true);
  assert.equal(shouldUseOriginalForLocalSearch({ size: 120_000 }, FULL_CROP, 90), false);
  assert.match(formatTransformSummary(rect, 90), /Область 30% × 40% · Поворот 90°/);
});

test('validateIncomingPhotos enforces image types, max count (8), total bytes (32 MiB), and normalizes clipboard names', () => {
  const pngA = new File([new Uint8Array([137, 80, 78, 71])], 'image.png', { type: 'image/png' });
  const named = normalizeClipboardFile(pngA, 2);
  assert.equal(named.name, 'clipboard-photo-2.png');
  assert.equal(named.size, pngA.size);

  const gif = new File([new Uint8Array([71, 73, 70])], 'anim.gif', { type: 'image/gif' });
  const validJpg = new File([new Uint8Array(1024)], 'fixture.jpg', { type: 'image/jpeg' });
  const result = validateIncomingPhotos([], [pngA, gif, validJpg], 'clipboard');
  assert.equal(result.accepted.length, 2);
  assert.equal(result.accepted[0].name, 'clipboard-photo-1.png');
  assert.equal(result.accepted[1].name, 'fixture.jpg');
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /JPEG, PNG или WebP/);

  // Max 8 photos limit
  const existing = Array.from({ length: 7 }, () => ({ size: 1000 }));
  const more = [validJpg, new File([new Uint8Array(500)], 'extra.webp', { type: 'image/webp' })];
  const capped = validateIncomingPhotos(existing, more, 'upload');
  assert.equal(capped.accepted.length, 1);
  assert.equal(capped.errors.length, 1);
  assert.match(capped.errors[0], /8/);
});

test('buildRfqSnapshotFromSearch preserves primary photo selection and all untouched originals for MYLINE ICBA02', async () => {
  const [myline] = catalogueSearch('Emmemobili MYLINE', 'standard');
  const icba02 = myline.variants?.find(item => item.sku === 'ICBA02');
  assert.ok(icba02);

  const bytes1 = new Uint8Array([1, 2, 3, 4]);
  const bytes2 = new Uint8Array([5, 6, 7, 8, 9]);
  const file1 = new File([bytes1], 'room-wide.jpg', { type: 'image/jpeg' });
  const file2 = new File([bytes2], 'closeup-rings.png', { type: 'image/png' });

  const snapshot = buildRfqSnapshotFromSearch(
    myline,
    icba02,
    [
      { id: 'p1', file: file1 },
      { id: 'p2', file: file2 },
    ],
    'p2',
  );

  assert.equal(snapshot.project.name, 'Emmemobili MYLINE');
  assert.equal(snapshot.project.code, 'ICBA02');
  assert.deepEqual(snapshot.project.components[0].dimensions.width, {
    value: 900,
    source: 'documentation',
  });
  assert.equal(snapshot.project.components[0].light.dimming, 'DALI');
  assert.equal(snapshot.project.photos.length, 2);
  assert.equal(snapshot.project.photos[0].name, 'closeup-rings.png');
  assert.equal(snapshot.project.primaryPhotoId, snapshot.project.photos[0].id);
  assert.equal(snapshot.project.photos[1].name, 'room-wide.jpg');

  const storedPrimary = await snapshot.originals[snapshot.project.photos[0].id].arrayBuffer();
  const storedSecondary = await snapshot.originals[snapshot.project.photos[1].id].arrayBuffer();
  assert.deepEqual(new Uint8Array(storedPrimary), bytes2);
  assert.deepEqual(new Uint8Array(storedSecondary), bytes1);
});

test('filterAndSortResults filters by category, kind, brand, PDF, saved state and sorts deterministically', () => {
  const api = catalogueSearch('Emmemobili MYLINE', 'deep');
  const imported = importReviewLinks([
    { url: 'https://gallery.example.invalid/brass-ring', title: 'Gallery Ring Lamp' },
  ]);
  const combined = mergeSearchResults(api, imported);

  const options = extractFilterOptions(combined);
  assert.deepEqual(options.brands, ['Emmemobili']);
  assert.equal(options.hasUnbranded, true);
  assert.ok(options.kinds.includes('chandelier'));
  assert.ok(options.kinds.includes('table'));

  const onlyPdf = filterAndSortResults(combined, { ...DEFAULT_RESULT_FILTERS, onlyWithPdf: true });
  assert.equal(onlyPdf.length, 1);
  assert.equal(onlyPdf[0].id, 'emmemobili-myline');

  const onlySimilar = filterAndSortResults(combined, {
    ...DEFAULT_RESULT_FILTERS,
    category: 'similar',
  });
  assert.equal(onlySimilar.length, 1);
  assert.equal(onlySimilar[0].id, 'emmemobili-myring-table');

  const onlyUnbranded = filterAndSortResults(combined, {
    ...DEFAULT_RESULT_FILTERS,
    brand: UNBRANDED_FILTER_VALUE,
  });
  assert.equal(onlyUnbranded.length, 1);
  assert.equal(onlyUnbranded[0].category, 'unverified');

  const onlySaved = filterAndSortResults(
    combined,
    { ...DEFAULT_RESULT_FILTERS, onlySaved: true },
    item => item.id === 'emmemobili-myring-table',
  );
  assert.equal(onlySaved.length, 1);
  assert.equal(onlySaved[0].id, 'emmemobili-myring-table');

  // Width sorting keeps models with confirmed mm widths before unconfirmed models
  const byWidth = filterAndSortResults(combined, {
    ...DEFAULT_RESULT_FILTERS,
    sort: 'width_asc',
  });
  assert.equal(byWidth[0].id, 'emmemobili-myline');

  const byDocs = filterAndSortResults(combined, {
    ...DEFAULT_RESULT_FILTERS,
    sort: 'docs_first',
  });
  assert.equal(byDocs[0].id, 'emmemobili-myline');
});

test('buildUnconfirmedChecklist preserves Original not verified and explicitly lists missing factory confirmations', () => {
  const [myline, myring] = catalogueSearch('Emmemobili MYLINE', 'deep');
  const mylineNoSku = buildUnconfirmedChecklist(myline);
  assert.ok(mylineNoSku.some(line => /Original not verified/.test(line)));
  assert.ok(mylineNoSku.some(line => /SKU/.test(line)));
  assert.ok(mylineNoSku.some(line => /Направление света/.test(line)));

  const mylineIcba02 = buildUnconfirmedChecklist(myline, 'ICBA02');
  assert.ok(mylineIcba02.some(line => /Original not verified/.test(line)));
  assert.equal(mylineIcba02.some(line => /SKU\) ещё не выбран/.test(line)), false);

  const myringList = buildUnconfirmedChecklist(myring);
  assert.ok(myringList.some(line => /Габаритные размеры/.test(line)));
});

test('buildGeminiInsights categorizes shape, suspension, and visible details and suggests deduplicated queries without inventing brands', () => {
  const insights = buildGeminiInsights(
    [
      'brass ring pendant',
      'leather strap suspension',
      'warm LED strip',
      'satin metallic finish',
      'brass ring pendant',
    ],
    'Emmemobili',
  );

  assert.deepEqual(insights.shape, ['brass ring pendant']);
  assert.deepEqual(insights.suspension, ['leather strap suspension']);
  assert.deepEqual(insights.details, ['warm LED strip', 'satin metallic finish']);
  assert.ok(insights.suggestedQueries.length >= 3);
  assert.ok(
    insights.suggestedQueries.some(
      q => q.label === 'Форма и подвес' && /brass ring pendant/.test(q.query) && /leather strap/.test(q.query),
    ),
  );
  assert.ok(
    insights.suggestedQueries.some(
      q => q.label === 'Ваш запрос + признаки' && /^Emmemobili\b/.test(q.query),
    ),
  );
  // Empty input produces no fabricated traits or queries
  const empty = buildGeminiInsights([]);
  assert.deepEqual(empty, { shape: [], suspension: [], details: [], suggestedQueries: [] });
});

test('mergeAllSearchCandidates deduplicates catalogue, Gemini, local index, and manual Lens sources with evidence while preserving Original not verified', () => {
  const [mylineSimilarity] = catalogueSearch('ring brass leather', 'standard');
  assert.equal(mylineSimilarity.id, 'emmemobili-myline');
  assert.equal(mylineSimilarity.category, 'visual_alternative');
  assert.equal(mylineSimilarity.evidence, 'catalogue_similarity');

  // 1) Photo-only evidence (Gemini visual traits + local same_file) WITHOUT official manufacturer URL/text match
  // MUST NOT upgrade category to verified_original and MUST stay Original not verified
  const photoOnly = mergeAllSearchCandidates({
    apiResults: [mylineSimilarity],
    localMatches: [
      {
        id: 'myline-photo-ref',
        title: 'Emmemobili MYLINE',
        source: 'https://www.emmemobili.it/prodotti/illuminazione/myline',
        match: 'same_file',
      },
      {
        id: 'studio-unlinked',
        title: 'Unlinked Studio Sample',
        match: 'similar_image',
      },
    ],
    geminiTraits: ['brass ring pendant', 'leather strap suspension'],
  });

  assert.equal(photoOnly.candidates.length, 1);
  assert.equal(photoOnly.unlinkedLocalMatches.length, 1);
  assert.equal(photoOnly.unlinkedLocalMatches[0].id, 'studio-unlinked');

  const photoOnlyMyline = photoOnly.candidates[0];
  assert.equal(photoOnlyMyline.result.id, 'emmemobili-myline');
  assert.equal(photoOnlyMyline.result.category, 'visual_alternative');
  assert.equal(photoOnlyMyline.originalVerified, false);
  assert.equal(photoOnlyMyline.localMatch?.match, 'same_file');
  assert.deepEqual(
    photoOnlyMyline.evidences.map(ev => ev.kind),
    ['gemini_visual_traits', 'local_same_file'],
  );

  // 2) Adding an official manufacturer URL from manual Google Lens import deduplicates into the SAME single candidate,
  // preserves all corroborating evidences, and upgrades category to verified_original ONLY because official catalogue proof exists
  const manualImports = importReviewLinks([
    {
      url: 'https://www.emmemobili.it/en/prodotti/illuminazione/myline?utm_source=lens',
      title: 'MYLINE Official',
    },
    {
      url: 'https://showroom.example.invalid/ring-lamp',
      title: 'Showroom Listing',
    },
  ]);

  const withProof = mergeAllSearchCandidates({
    apiResults: [mylineSimilarity],
    localMatches: [
      {
        id: 'myline-photo-ref',
        title: 'Emmemobili MYLINE',
        source: 'https://www.emmemobili.it/prodotti/illuminazione/myline',
        match: 'same_file',
      },
    ],
    importedResults: manualImports,
    geminiTraits: ['brass ring pendant', 'leather strap suspension'],
  });

  assert.equal(withProof.candidates.length, 2);
  const mylineUnified = withProof.byId.get('emmemobili-myline');
  assert.ok(mylineUnified);
  assert.equal(mylineUnified.result.category, 'verified_original');
  assert.equal(mylineUnified.result.evidence, 'manufacturer_catalogue');
  assert.equal(mylineUnified.originalVerified, false);
  assert.equal(mylineUnified.localMatch?.match, 'same_file');
  assert.ok(mylineUnified.evidences.some(ev => ev.kind === 'gemini_visual_traits'));
  assert.ok(mylineUnified.evidences.some(ev => ev.kind === 'local_same_file'));
  assert.ok(mylineUnified.evidences.some(ev => ev.kind === 'manual_lens_link'));
  assert.ok(mylineUnified.evidences.some(ev => ev.kind === 'manufacturer_catalogue'));

  const showroom = withProof.candidates.find(c => c.result.category === 'unverified');
  assert.ok(showroom);
  assert.equal(showroom.originalVerified, false);
  assert.equal(showroom.evidences[0].kind, 'manual_lens_link');

  // Evidence badge tones distinguish verified catalogue / exact file from estimates and manual links
  assert.equal(evidenceBadgeTone('manufacturer_catalogue'), 'doc');
  assert.equal(evidenceBadgeTone('local_same_file'), 'doc');
  assert.equal(evidenceBadgeTone('gemini_visual_traits'), 'est');
  assert.equal(evidenceBadgeTone('manual_lens_link'), 'accent');
});

test('buildReviewPrompt includes Gemini visible traits as unverified estimates when present', () => {
  const [myline] = catalogueSearch('Emmemobili MYLINE', 'standard');
  const prompt = buildReviewPrompt(
    '',
    [myline],
    myline,
    ['brass ring pendant', 'leather strap suspension'],
  );
  assert.match(prompt, /Original not verified/);
  assert.match(prompt, /Видимые признаки по фото \(оценка Gemini, не подтверждает бренд\): brass ring pendant, leather strap suspension/);
});





