import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import {
  geminiDrawingAnalysisSchema,
  geminiPhotoAnalysisSchema,
  geminiStatusResponseSchema,
  geminiTestResponseSchema,
} from '../src/ai/gemini-contract.ts';
import { GET as getStatusRoute } from '../src/app/api/ai/gemini/status/route.ts';
import { POST as postTestRoute } from '../src/app/api/ai/gemini/test/route.ts';
import { POST as postAnalyzePhotoRoute } from '../src/app/api/ai/gemini/analyze-photo/route.ts';
import { POST as postAnalyzeDrawingRoute } from '../src/app/api/ai/gemini/analyze-drawing/route.ts';
import { newProject } from '../src/domain/project.ts';
import {
  convertLengthToMm,
  createGeminiService,
  extractPdfTextSnippets,
  GeminiServiceError,
  sanitizeSecret,
  type GeminiSdkAdapter,
} from '../src/server/gemini-client.ts';
import {
  applyGeminiProposals,
  buildDrawingProposals,
  buildPhotoProposals,
} from '../src/ui/quick-rfq/geminiAutofill.ts';

async function createRealPhotoBytes(): Promise<Uint8Array> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240">
    <rect width="100%" height="100%" fill="#f4f0e8"/>
    <line x1="160" y1="0" x2="160" y2="90" stroke="#3a3028" stroke-width="4"/>
    <circle cx="160" cy="145" r="52" fill="none" stroke="#a67c37" stroke-width="10"/>
  </svg>`;
  const buf = await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
  return new Uint8Array(buf);
}

function createRealPdfBytes(): Uint8Array {
  const pdf = [
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >> endobj',
    'trailer << /Root 1 0 R >>',
    '%%EOF',
  ].join('\n');
  return new Uint8Array(Buffer.from(pdf, 'ascii'));
}

test('unit conversion converts mm, cm, m, in, ft to millimetres and rejects unknown units', () => {
  assert.deepEqual(convertLengthToMm(900, 'mm'), { mm: 900, recognizedUnit: true });
  assert.deepEqual(convertLengthToMm(90, 'cm'), { mm: 900, recognizedUnit: true });
  assert.deepEqual(convertLengthToMm(1.25, 'm'), { mm: 1250, recognizedUnit: true });
  assert.deepEqual(convertLengthToMm(10, 'in'), { mm: 254, recognizedUnit: true });
  assert.deepEqual(convertLengthToMm(2, 'ft'), { mm: 609.6, recognizedUnit: true });
  assert.deepEqual(convertLengthToMm(42, 'cubits'), { mm: null, recognizedUnit: false });
  assert.deepEqual(convertLengthToMm(null, 'mm'), { mm: null, recognizedUnit: true });
});

test('missing GEMINI_API_KEY reports safe unconfigured status and fails gracefully', async () => {
  const service = createGeminiService({ getEnv: () => ({}) });
  const status = geminiStatusResponseSchema.parse(service.getStatus());
  assert.equal(status.configured, false);
  assert.equal(status.connected, false);
  assert.equal(status.selectedModel, null);
  assert.equal(status.freeTierOnly, true);
  assert.equal(status.paidAutoSwitchDisabled, true);

  const testResult = geminiTestResponseSchema.parse(await service.testConnection());
  assert.equal(testResult.ok, false);
  assert.equal(testResult.code, 'missing_api_key');

  const photoBytes = await createRealPhotoBytes();
  await assert.rejects(
    () => service.analyzePhoto({ name: 'lamp.jpg', mimeType: 'image/jpeg', bytes: photoBytes }),
    (err: unknown) => err instanceof GeminiServiceError && err.code === 'missing_api_key' && err.httpStatus === 503,
  );
});

test('invalid API key maps to invalid_api_key and never leaks the secret key', async () => {
  const fakeSecret = 'AIzaSyFakeSecretKey1234567890abcdef';
  const service = createGeminiService({
    getEnv: () => ({ GEMINI_API_KEY: fakeSecret }),
    createAdapter: (): GeminiSdkAdapter => ({
      async listModels() {
        const err = new Error(`API_KEY_INVALID for key ${fakeSecret}`);
        Object.assign(err, { status: 401 });
        throw err;
      },
      async generateJson() {
        return '{}';
      },
    }),
  });

  const result = await service.testConnection();
  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid_api_key');
  assert.equal(result.message.includes(fakeSecret), false);
  assert.equal(JSON.stringify(result).includes(fakeSecret), false);
  assert.equal(sanitizeSecret(`Key ${fakeSecret} failed`, fakeSecret), 'Key [REDACTED] failed');
});

test('unavailable model and blocked paid models are caught cleanly while dynamic Flash discovery works', async () => {
  const blockedService = createGeminiService({
    getEnv: () => ({ GEMINI_API_KEY: 'test-key-123456', GEMINI_MODEL: 'gemini-4-carbon' }),
    createAdapter: (): GeminiSdkAdapter => ({
      async listModels() {
        return [{ name: 'models/gemini-4-carbon', supportedActions: ['generateContent'] }];
      },
      async generateJson() {
        return '{"ok":true}';
      },
    }),
  });
  const blocked = await blockedService.testConnection();
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'paid_model_blocked');

  const unavailableService = createGeminiService({
    getEnv: () => ({ GEMINI_API_KEY: 'test-key-123456', GEMINI_MODEL: 'gemini-3.8-flash' }),
    createAdapter: (): GeminiSdkAdapter => ({
      async listModels() {
        return [{ name: 'models/gemini-3.5-flash-lite', supportedActions: ['generateContent'] }];
      },
      async generateJson() {
        return '{"ok":true}';
      },
    }),
  });
  const unavail = await unavailableService.testConnection();
  assert.equal(unavail.ok, false);
  assert.equal(unavail.code, 'model_unavailable');
  assert.match(unavail.message, /gemini-3\.5-flash-lite/);

  // Auto-selection picks available Free-Tier Flash model dynamically
  const autoService = createGeminiService({
    getEnv: () => ({ GEMINI_API_KEY: 'test-key-123456' }),
    createAdapter: (): GeminiSdkAdapter => ({
      async listModels() {
        return [
          { name: 'models/gemini-4-carbon', supportedActions: ['generateContent'] },
          { name: 'models/gemini-2.5-pro', supportedActions: ['generateContent'] },
          { name: 'models/gemini-3.5-flash-lite', supportedActions: ['generateContent'] },
          { name: 'models/gemini-2.5-flash-lite', supportedActions: ['generateContent'] },
        ];
      },
      async generateJson({ model }) {
        assert.equal(model, 'gemini-3.5-flash-lite');
        return '{"ok":true}';
      },
    }),
  });
  const ok = await autoService.testConnection();
  assert.equal(ok.ok, true);
  assert.equal(ok.status.selectedModel, 'gemini-3.5-flash-lite');
  assert.equal(ok.status.modelAvailable, true);
  assert.deepEqual(ok.status.availableFlashModels, ['gemini-3.5-flash-lite', 'gemini-2.5-flash-lite']);
});

test('quota exceeded (429), daily app cap, and network errors map cleanly', async () => {
  const quotaService = createGeminiService({
    getEnv: () => ({ GEMINI_API_KEY: 'test-key-123456' }),
    createAdapter: (): GeminiSdkAdapter => ({
      async listModels() {
        return [{ name: 'models/gemini-3.6-flash', supportedActions: ['generateContent'] }];
      },
      async generateJson() {
        const err = new Error('RESOURCE_EXHAUSTED: Free tier quota exceeded');
        Object.assign(err, { status: 429 });
        throw err;
      },
    }),
  });
  const quotaRes = await quotaService.testConnection();
  assert.equal(quotaRes.ok, false);
  assert.equal(quotaRes.code, 'quota_exceeded');

  const networkService = createGeminiService({
    getEnv: () => ({ GEMINI_API_KEY: 'test-key-123456' }),
    createAdapter: (): GeminiSdkAdapter => ({
      async listModels() {
        throw new TypeError('fetch failed: ECONNREFUSED');
      },
      async generateJson() {
        return '{}';
      },
    }),
  });
  const netRes = await networkService.testConnection();
  assert.equal(netRes.ok, false);
  assert.equal(netRes.code, 'network_error');

  // Daily app limit check
  const photoBytes = await createRealPhotoBytes();
  const cappedService = createGeminiService({
    getEnv: () => ({ GEMINI_API_KEY: 'test-key-123456', LIGHT_FORGE_GEMINI_DAILY_LIMIT: '1' }),
    createAdapter: (): GeminiSdkAdapter => ({
      async listModels() {
        return [{ name: 'models/gemini-3.6-flash', supportedActions: ['generateContent'] }];
      },
      async generateJson() {
        return JSON.stringify({
          fixtureType: 'pendant',
          fixtureTypeNote: null,
          shape: 'Кольцо',
          elementCount: 1,
          elementCountNote: null,
          primaryColors: ['Тёплая латунь'],
          suspectedMaterialKey: 'solidBrass',
          suspectedMaterialLabel: 'Латунь (предположительно)',
          materialUncertaintyReason: 'По фото невозможно отличить массив латуни от покрытия.',
          suspectedFinishKey: 'naturalSatinBrass',
          suspectedFinishLabel: 'Сатиновая латунь',
          finishUncertaintyReason: 'Освещение влияет на оттенок.',
          suspensionType: 'Тонкий стальной трос',
          lightDirection: 'down',
          structuralDetails: ['Встроенный рассеиватель по внутреннему контуру'],
          summary: 'Подвесной кольцевой светильник.',
          warnings: [],
        });
      },
    }),
  });

  const first = await cappedService.analyzePhoto({ name: 'one.jpg', mimeType: 'image/jpeg', bytes: photoBytes });
  assert.equal(first.cached, false);
  // Repeating identical photo hits SHA-256 cache without consuming additional daily quota!
  const secondCached = await cappedService.analyzePhoto({ name: 'one.jpg', mimeType: 'image/jpeg', bytes: photoBytes });
  assert.equal(secondCached.cached, true);
  assert.equal(cappedService.getStatus().requestsToday, 1);

  // Distinct photo consumes new call and hits daily cap
  const distinctBytes = new Uint8Array(
    await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 220, g: 190, b: 140 } } })
      .jpeg({ quality: 85 })
      .toBuffer(),
  );
  await assert.rejects(
    () => cappedService.analyzePhoto({ name: 'two.jpg', mimeType: 'image/jpeg', bytes: distinctBytes }),
    (err: unknown) => err instanceof GeminiServiceError && err.code === 'daily_limit_reached' && err.httpStatus === 429,
  );
});

test('real photograph analysis returns all 9 validated traits, preserves original bytes, and autofill protects manual edits', async () => {
  const originalPhoto = await createRealPhotoBytes();
  const originalSnapshotCopy = Uint8Array.from(originalPhoto);

  const service = createGeminiService({
    getEnv: () => ({ GEMINI_API_KEY: 'test-key-123456' }),
    createAdapter: (): GeminiSdkAdapter => ({
      async listModels() {
        return [{ name: 'models/gemini-3.6-flash', supportedActions: ['generateContent'] }];
      },
      async generateJson({ inlineData }) {
        assert.ok(inlineData?.data && inlineData.data.length > 50);
        return JSON.stringify({
          fixtureType: 'ring',
          fixtureTypeNote: 'Одиночное подвесное кольцо',
          shape: 'Круглое тонкое кольцо',
          elementCount: 1,
          elementCountNote: 'Один светящийся контур',
          primaryColors: ['Тёплый золотистый', 'Молочно-белый'],
          suspectedMaterialKey: 'solidBrass',
          suspectedMaterialLabel: 'Латунь или металл с покрытием под латунь',
          materialUncertaintyReason: 'По фото нельзя подтвердить, массив ли это латуни — требуется подтверждение фабрики.',
          suspectedFinishKey: 'naturalSatinBrass',
          suspectedFinishLabel: 'Сатиновая латунь',
          finishUncertaintyReason: 'Степень матовости требует проверки по образцу.',
          suspensionType: 'Тонкие вертикальные тросы',
          lightDirection: 'down',
          structuralDetails: ['Тонкий цилиндрический профиль', 'Внутренний опаловый диффузор'],
          summary: 'Визуально определяется подвесной кольцевой светильник с тёплой металлической отделкой.',
          warnings: ['Точный диаметр и материал корпуса не могут быть подтверждены только по фото.'],
        });
      },
    }),
  });

  const analysis = geminiPhotoAnalysisSchema.parse(
    await service.analyzePhoto({ name: 'ring-photo.jpg', mimeType: 'image/jpeg', bytes: originalPhoto }),
  );
  // Original caller bytes must remain untouched
  assert.deepEqual(originalPhoto, originalSnapshotCopy);
  assert.equal(analysis.widthPx, 320);
  assert.equal(analysis.heightPx, 240);
  assert.equal(analysis.fixtureType.value, 'ring');
  assert.equal(analysis.fixtureType.status, 'estimated');
  assert.equal(analysis.elementCount.value, 1);
  assert.equal(analysis.dimensionsCannotBeVerifiedFromPhoto, true);
  assert.match(analysis.sourceDisclaimer, /AI Visual Search/);

  // User already manually selected 'chandelier' -> must NOT be auto-checked or overwritten
  const project = newProject();
  project.kind = 'chandelier';
  const manualFields = new Set(['kind']);
  const proposals = buildPhotoProposals(project, analysis, manualFields);
  const kindProposal = proposals.find((p) => p.id === 'photo-fixture-type');
  assert.ok(kindProposal);
  assert.equal(kindProposal.hasManualValue, true);
  assert.equal(kindProposal.defaultChecked, false);

  // Applying default-checked proposals fills empty lightDirection + material + notes, keeping manual 'chandelier'!
  const selectedIds = new Set(proposals.filter((p) => p.defaultChecked).map((p) => p.id));
  const applied = applyGeminiProposals(project, proposals, selectedIds);
  assert.equal(applied.project.kind, 'chandelier');
  assert.equal(applied.project.components[0].light.directionId, 'down');
  assert.equal(applied.project.components[0].materials.length, 1);
  assert.equal(applied.project.components[0].materials[0].material, 'solidBrass');
  assert.equal(applied.project.components[0].materials[0].finish, 'naturalSatinBrass');
  assert.ok(applied.project.components[0].materials[0].color);
  assert.match(applied.project.notes, /AI фото/);
});

test('real PDF drawing analysis converts units to mm, preserves Confirmed/Estimated/Unknown, and rejects spoofed PDFs', async () => {
  const realPdf = createRealPdfBytes();
  const service = createGeminiService({
    getEnv: () => ({ GEMINI_API_KEY: 'test-key-123456' }),
    createAdapter: (): GeminiSdkAdapter => ({
      async listModels() {
        return [{ name: 'models/gemini-3.6-flash', supportedActions: ['generateContent'] }];
      },
      async generateJson({ inlineData }) {
        assert.equal(inlineData?.mimeType, 'application/pdf');
        return JSON.stringify({
          width: { value: 90, unit: 'cm', originalText: '90 cm', status: 'confirmed' },
          height: { value: 27.56, unit: 'in', originalText: '27.56 in', status: 'confirmed' },
          depth: { value: 0.06, unit: 'm', originalText: '0.06 m', status: 'confirmed' },
          diameter: { value: 900, unit: 'mm', originalText: 'Ø900 mm', status: 'confirmed' },
          innerDiameter: { value: 840, unit: 'mm', originalText: 'Ø840 mm', status: 'estimated' },
          profileHeight: { value: 45, unit: 'mm', originalText: '45 mm', status: 'confirmed' },
          profileThickness: { value: null, unit: null, originalText: null, status: 'unknown' },
          wattageW: { value: 48, originalText: '48 W', status: 'confirmed' },
          lumensLm: { value: 4725, originalText: '4725 lm', status: 'confirmed' },
          cctK: { value: 3000, originalText: '3000K', status: 'confirmed' },
          cri: { value: 90, originalText: 'CRI >90', status: 'confirmed' },
          voltage: { value: '220–240V AC 50/60Hz', originalText: '220-240V AC', status: 'confirmed' },
          ipRating: { value: 'IP 20', originalText: 'IP20', status: 'confirmed' },
          dimming: { value: 'DALI / Push', originalText: 'DALI', status: 'confirmed' },
          materials: [
            { part: 'Кольцо / Ring', materialKey: 'solidBrass', label: 'Solid brass', status: 'confirmed' },
            { part: 'Подвес / Strap', materialKey: 'genuineLeather', label: 'Genuine leather', status: 'confirmed' },
          ],
          finishes: [
            { part: 'Кольцо / Ring', finishKey: 'naturalSatinBrass', label: 'Natural satin brass', color: 'Латунь', status: 'confirmed' },
          ],
          documentNotes: ['Данные из таблицы спецификации листа 1'],
          warnings: [],
          summary: 'Извлечены габариты, электрические и материальные параметры из PDF-чертежа.',
        });
      },
    }),
  });

  // Spoofed PDF bytes rejected before hitting SDK
  await assert.rejects(
    () =>
      service.analyzeDrawing({
        name: 'fake.pdf',
        mimeType: 'application/pdf',
        bytes: new Uint8Array(Buffer.from('NOT-A-PDF-FILE')),
      }),
    (err: unknown) => err instanceof GeminiServiceError && err.code === 'invalid_input' && err.httpStatus === 422,
  );

  const drawing = geminiDrawingAnalysisSchema.parse(
    await service.analyzeDrawing({ name: 'myline-spec.pdf', mimeType: 'application/pdf', bytes: realPdf }),
  );
  assert.equal(drawing.unitStandard, 'mm');
  assert.equal(drawing.dimensionsMm.width.value, 900);
  assert.equal(drawing.dimensionsMm.width.status, 'confirmed');
  assert.equal(drawing.dimensionsMm.width.source, 'documentation');
  assert.equal(drawing.dimensionsMm.height.value, 700.02);
  assert.equal(drawing.dimensionsMm.depth.value, 60);
  assert.equal(drawing.dimensionsMm.innerDiameter.status, 'estimated');
  assert.equal(drawing.dimensionsMm.innerDiameter.source, 'estimated');
  assert.equal(drawing.dimensionsMm.profileThickness.value, null);
  assert.equal(drawing.dimensionsMm.profileThickness.status, 'unknown');
  assert.equal(drawing.electrical.ipRating.value, 'IP20');
  assert.equal(drawing.electrical.dimming.value, 'DALI');

  // Protect existing manual width (950 mm user) while filling empty height/depth/wattage/IP/dimming/materials!
  const project = newProject();
  project.components[0].dimensions.width = { value: 950, source: 'user' };
  const proposals = buildDrawingProposals(project, drawing);
  const widthProposal = proposals.find((p) => p.id === 'drawing-dim-width');
  assert.ok(widthProposal);
  assert.equal(widthProposal.hasManualValue, true);
  assert.equal(widthProposal.defaultChecked, false);

  const selectedIds = new Set(proposals.filter((p) => p.defaultChecked).map((p) => p.id));
  const applied = applyGeminiProposals(project, proposals, selectedIds);
  assert.equal(applied.project.components[0].dimensions.width?.value, 950);
  assert.equal(applied.project.components[0].dimensions.width?.source, 'user');
  assert.equal(applied.project.components[0].dimensions.height?.value, 700.02);
  assert.equal(applied.project.components[0].dimensions.height?.source, 'documentation');
  assert.equal(applied.project.components[0].light.watts?.value, 48);
  assert.equal(applied.project.components[0].light.ip, 'IP20');
  assert.equal(applied.project.components[0].light.dimming, 'DALI');
  assert.equal(applied.project.components[0].materials.length, 2);
});

test('Gemini HTTP route handlers enforce no-store, CSRF cross-site guard, and content-type validation', async () => {
  const statusRes = getStatusRoute();
  assert.equal(statusRes.status, 200);
  assert.equal(statusRes.headers.get('Cache-Control'), 'no-store');
  geminiStatusResponseSchema.parse(await statusRes.json());

  const crossTest = await postTestRoute(
    new Request('http://localhost/api/ai/gemini/test', {
      method: 'POST',
      headers: { 'sec-fetch-site': 'cross-site' },
    }),
  );
  assert.equal(crossTest.status, 403);

  const wrongMimePhoto = await postAnalyzePhotoRoute(
    new Request('http://localhost/api/ai/gemini/analyze-photo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }),
  );
  assert.equal(wrongMimePhoto.status, 415);

  const wrongMimeDrawing = await postAnalyzeDrawingRoute(
    new Request('http://localhost/api/ai/gemini/analyze-drawing', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }),
  );
  assert.equal(wrongMimeDrawing.status, 415);
});

test('Phase 2 prioritizes gemini-3.8-flash, extracts PDF text snippets, preserves page provenance, separates suspensionDrop, and flags dimension conflicts', async () => {
  const pdfWithSpecText = new Uint8Array(
    Buffer.from(
      '%PDF-1.4\n(MYLINE ICBA02 Width 900 mm) Tj\n(Height 700 mm Suspension Drop 1500 mm) Tj\n(3000K CRI 90 DALI IP20 59W) Tj\n%%EOF\n',
      'ascii',
    ),
  );
  const extracted = extractPdfTextSnippets(pdfWithSpecText);
  assert.match(extracted, /900 mm/);
  assert.match(extracted, /DALI/);

  let receivedPrompt = '';
  let usedModel = '';
  const service = createGeminiService({
    getEnv: () => ({ GEMINI_API_KEY: 'test-key-123456' }),
    createAdapter: (): GeminiSdkAdapter => ({
      async listModels() {
        return [
          { name: 'models/gemini-3.5-flash-lite', supportedActions: ['generateContent'] },
          { name: 'models/gemini-3.8-flash', supportedActions: ['generateContent'] },
        ];
      },
      async generateJson({ model, prompt }) {
        usedModel = model;
        receivedPrompt = prompt;
        return JSON.stringify({
          modelName: { value: 'MYLINE', originalText: 'MYLINE', page: 1, status: 'confirmed' },
          sku: { value: 'ICBA02', originalText: 'ICBA02', page: 1, status: 'confirmed' },
          width: { value: 900, unit: 'mm', originalText: 'L 900 mm', page: 2, snippet: 'L 900 mm', dimensionLabel: 'Width', confidence: 'high', status: 'confirmed' },
          height: { value: 700, unit: 'mm', originalText: 'H 700 mm', page: 2, snippet: 'H 700 mm', status: 'confirmed' },
          depth: { value: 60, unit: 'mm', originalText: '60 mm', page: 2, status: 'confirmed' },
          diameter: { value: 900, unit: 'mm', originalText: 'Ø900', page: 2, status: 'confirmed' },
          innerDiameter: { value: 920, unit: 'mm', originalText: 'Ø920', page: 2, status: 'confirmed' },
          profileHeight: { value: null, unit: null, originalText: null, status: 'unknown' },
          profileThickness: { value: null, unit: null, originalText: null, status: 'unknown' },
          radius: { value: 450, unit: 'mm', originalText: 'R450', page: 2, status: 'confirmed' },
          suspensionDrop: { value: 1500, unit: 'mm', originalText: 'Drop 1500 mm', page: 2, status: 'confirmed' },
          elementCount: { value: 4, originalText: '4 arcs', page: 1, status: 'confirmed' },
          mountingPointsCount: { value: 8, originalText: '8 ceiling fixings', page: 2, status: 'confirmed' },
          angles: ['180° U-arc'],
          sections: ['60×40 mm'],
          wattageW: { value: 59, originalText: '59W', page: 1, status: 'confirmed' },
          lumensLm: { value: 4779, originalText: '4779 lm', page: 1, status: 'confirmed' },
          cctK: { value: 3000, originalText: '3000K', page: 1, status: 'confirmed' },
          cri: { value: 90, originalText: 'CRI 90', page: 1, status: 'confirmed' },
          voltage: { value: '220–240V AC', originalText: '220-240V', page: 1, status: 'confirmed' },
          ipRating: { value: 'IP20', originalText: 'IP20', page: 1, status: 'confirmed' },
          dimming: { value: 'DALI', originalText: 'DALI', page: 1, status: 'confirmed' },
          materials: [],
          finishes: [],
          conflicts: [],
          missingInformation: ['Высота стола от пола (мм)'],
          documentNotes: [],
          warnings: [],
          summary: 'Извлечены габариты и электрика MYLINE.',
        });
      },
    }),
  });

  const drawing = geminiDrawingAnalysisSchema.parse(
    await service.analyzeDrawing(
      { name: 'drawing.pdf', mimeType: 'application/pdf', bytes: pdfWithSpecText },
      undefined,
      { deepAnalysis: true },
    ),
  );
  assert.equal(usedModel, 'gemini-3.8-flash');
  assert.match(receivedPrompt, /900 mm/);
  assert.equal(drawing.identity.sku.value, 'ICBA02');
  assert.equal(drawing.dimensionsMm.width.provenance?.fileName, 'drawing.pdf');
  assert.equal(drawing.dimensionsMm.width.provenance?.page, 2);
  assert.equal(drawing.dimensionsMm.width.provenance?.snippet, 'L 900 mm');
  assert.equal(drawing.dimensionsMm.height.value, 700);
  assert.equal(drawing.dimensionsMm.suspensionDrop.value, 1500);
  assert.equal(drawing.dimensionsMm.radius.value, 450);
  // Automatic conflict detection when innerDiameter (920) >= diameter (900)
  assert.ok(drawing.conflicts.some((c) => c.field === 'diameter'));

  // Second call hits cache -> 0 extra API calls!
  const cachedDrawing = await service.analyzeDrawing(
    { name: 'drawing.pdf', mimeType: 'application/pdf', bytes: pdfWithSpecText },
    undefined,
    { deepAnalysis: true },
  );
  assert.equal(cachedDrawing.cached, true);
  assert.equal(service.getStatus().requestsThisMonth, 1);
});

