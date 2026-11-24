import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import sharp from 'sharp';
import { POST } from '../src/app/api/rfq/detailed/route.ts';
import { createMyline } from '../src/domain/myline.ts';
import { createMylineComposition } from '../src/geometry/examples.ts';
import {
  analyzeProjectReadiness,
  buildDetailedRfq,
  textDetailedRfq,
} from '../src/rfq/detailed.ts';
import { RfqConflict } from '../src/rfq/quick.ts';
import { closePdfBrowser } from '../src/server/rfq-pdf.ts';
import { computeDocumentFingerprint, openDocumentStore } from '../src/storage/documents.ts';
import { catalogueSearch, projectFromSearch } from '../src/visual-search/catalogue.ts';

after(closePdfBrowser);

const endpoint = 'http://test/api/rfq/detailed';
const postJson = (input: unknown, query = '') =>
  new Request(endpoint + query, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });

test('buildDetailedRfq generates bilingual BOM, revision metadata, and honest open confirmations for MYLINE (4 arcs + unknown tabletop)', () => {
  const project = createMyline();
  project.orderQuantity = 3;
  const composition = createMylineComposition(project);

  const detailed = buildDetailedRfq({
    project,
    composition,
    revision: 2,
    releaseNote: 'Engineering revision for Zhongshan factory',
  });

  assert.equal(detailed.tier, 'detailed');
  assert.equal(detailed.revision, 2);
  assert.equal(detailed.readiness.hasSolidBrass, true);
  assert.equal(detailed.readiness.hasGenuineLeather, true);
  assert.equal(detailed.readiness.strictMaterials, true);
  assert.equal(detailed.readiness.compositionAttached, true);
  assert.equal(detailed.readiness.totalOrderUnits, 12); // (2 + 2) * 3

  const en = textDetailedRfq(detailed, 'en');
  const zh = textDetailedRfq(detailed, 'zh');

  assert.match(en, /DETAILED RFQ · REV\. V2/);
  assert.match(zh, /详细询价规范 · 版本 V2/);
  assert.match(en, /Document control & revision/);
  assert.match(zh, /文件控制与版本信息/);
  assert.match(en, /Engineering revision for Zhongshan factory/);
  assert.match(en, /Bill of materials \(materials, finishes & colours\)/);
  assert.match(zh, /材料与表面处理清单（BOM）/);
  // Total order qty = 2 per set * 3 sets = 6
  assert.match(en, /×2\/set · total 6/);
  assert.match(en, /Solid brass only \(no plated substitutes\)/);
  assert.match(zh, /须实心黄铜（禁镀层替代）/);
  assert.match(en, /Genuine leather only \(no PU\/PVC\)/);
  assert.match(zh, /须真皮（禁 PU\/PVC）/);
  // Unknown tabletop height must remain honestly unconfirmed and listed in open engineering checklist
  assert.match(en, /Tabletop above finished floor: To be confirmed by manufacturer/);
  assert.match(zh, /桌面距完成地面: 待制造商确认/);
  assert.match(en, /Tabletop height above finished floor \(mm\): To be confirmed by manufacturer/);
});

test('analyzeProjectReadiness separates documentation values from empty factory confirmations for MYLINE ICBA02', () => {
  const [myline] = catalogueSearch('Emmemobili MYLINE', 'standard');
  const icba02 = myline.variants?.find(item => item.sku === 'ICBA02');
  assert.ok(icba02);

  const snapshot = projectFromSearch(myline, icba02);
  const readiness = analyzeProjectReadiness(snapshot.project);

  assert.equal(readiness.documentationCount, 3); // 900, 60, 700 mm from documentation
  assert.equal(readiness.userCount, 0);
  assert.equal(readiness.estimatedCount, 0);
  assert.ok(readiness.unknownItems.some(item => /CCT/.test(item.labelEn)));
  assert.ok(readiness.unknownItems.some(item => /Power per component/.test(item.labelEn)));
  assert.ok(readiness.unknownItems.some(item => /Luminous flux/.test(item.labelEn)));
  assert.ok(readiness.unknownItems.some(item => /Materials and finishes/.test(item.labelEn)));
  assert.ok(readiness.unknownItems.some(item => /Mounting levels/.test(item.labelEn)));

  // Geometry conflict detection must stay active in Detailed RFQ too
  const project = createMyline();
  const composition = createMylineComposition(project);
  project.components[0].dimensions.width = { value: 999, source: 'user' };
  assert.throws(() => buildDetailedRfq({ project, composition }), RfqConflict);
});

test('POST /api/rfq/detailed renders bilingual text, authentic PDF with original photos, and enforces security guards', async () => {
  const project = createMyline();
  const pngBytes = await sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 170, g: 130, b: 64 } },
  })
    .png()
    .toBuffer();

  const photoId = 'photo-detail-1';
  project.photos = [{ id: photoId, name: 'myline-studio.png', type: 'image/png', size: pngBytes.length }];
  project.primaryPhotoId = photoId;

  // 1. Bilingual text endpoint
  const textRes = await POST(
    postJson({ project, revision: 3, releaseNote: 'Factory quote pack' }, '?format=text&lang=en-zh'),
  );
  assert.equal(textRes.status, 200);
  assert.equal(textRes.headers.get('cache-control'), 'no-store');
  const textBody = await textRes.json();
  assert.equal(textBody.language, 'en-zh');
  assert.match(textBody.text, /DETAILED RFQ · REV\. V3/);
  assert.match(textBody.text, /材料与表面处理清单（BOM）/);
  assert.match(textBody.text, /Factory quote pack/);

  // 2. PDF without photo bytes must fail with 422 invalid_photo
  const missingPhotoRes = await POST(postJson({ project, revision: 1 }, '?format=pdf&lang=en-zh'));
  assert.equal(missingPhotoRes.status, 422);
  assert.equal((await missingPhotoRes.json()).error, 'invalid_photo');

  // 3. Cross-site request must be rejected with 403
  const crossSiteRes = await POST(
    new Request(`${endpoint}?format=text&lang=en`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
      body: JSON.stringify({ project }),
    }),
  );
  assert.equal(crossSiteRes.status, 403);

  // 4. Authentic PDF generation via multipart/form-data with original PNG bytes
  const form = new FormData();
  form.set('input', JSON.stringify({ project, revision: 1, releaseNote: 'Initial factory package' }));
  form.set(`photo:${photoId}`, new Blob([new Uint8Array(pngBytes)], { type: 'image/png' }), 'myline-studio.png');

  const pdfRes = await POST(
    new Request(`${endpoint}?format=pdf&lang=en-zh`, {
      method: 'POST',
      body: form,
    }),
  );
  assert.equal(pdfRes.status, 200);
  assert.equal(pdfRes.headers.get('cache-control'), 'no-store');
  assert.match(pdfRes.headers.get('content-type') ?? '', /application\/pdf/);
  assert.equal(
    pdfRes.headers.get('content-disposition'),
    'inline; filename="MYLINE-detailed-rfq-v1-en-zh.pdf"',
  );
  const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
  assert.equal(pdfBuf.subarray(0, 5).toString('utf8'), '%PDF-');
  assert.ok(pdfBuf.length > 5_000, 'Rendered PDF should contain real document pages');
});

test('openDocumentStore persists numbered PDF revisions, exact bytes, statuses, and freshness fingerprints across reopen', async () => {
  const project = createMyline();
  const fpQuick = computeDocumentFingerprint(project, undefined, 'quick', 'en-zh');
  const fpDetailed = computeDocumentFingerprint(project, undefined, 'detailed', 'en-zh');
  assert.notEqual(fpQuick, fpDetailed);

  // Changing updatedAt alone must NOT invalidate fingerprint
  const sameContentProject = { ...project, updatedAt: '2026-12-01T00:00:00.000Z' };
  assert.equal(
    computeDocumentFingerprint(sameContentProject, undefined, 'detailed', 'en-zh'),
    fpDetailed,
  );

  // Changing a dimension MUST invalidate fingerprint
  const editedProject = structuredClone(project);
  editedProject.components[0].dimensions.width = { value: 950, source: 'user' };
  assert.notEqual(
    computeDocumentFingerprint(editedProject, undefined, 'detailed', 'en-zh'),
    fpDetailed,
  );

  const dbName = `lf-docs-test-${crypto.randomUUID()}`;
  const pdfBytes1 = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55, 10, 1, 2, 3]);
  const pdfBytes2 = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55, 10, 9, 8, 7, 6]);

  const store = await openDocumentStore(dbName);
  assert.equal(await store.nextRevisionNumber(project.id), 1);

  const rev1 = await store.saveRevision({
    projectId: project.id,
    projectName: project.name,
    projectCode: project.code,
    tier: 'quick',
    language: 'en-zh',
    fingerprint: fpQuick,
    photoCount: 0,
    unknownCount: 2,
    pdfFilename: 'MYLINE-quick-rfq-en-zh.pdf',
    pdfBlob: new Blob([pdfBytes1], { type: 'application/pdf' }),
    note: 'First preliminary quote',
  });
  assert.equal(rev1.revision, 1);
  assert.equal(rev1.status, 'draft');

  assert.equal(await store.nextRevisionNumber(project.id), 2);
  const rev2 = await store.saveRevision({
    projectId: project.id,
    projectName: project.name,
    projectCode: project.code,
    tier: 'detailed',
    language: 'en-zh',
    fingerprint: fpDetailed,
    photoCount: 1,
    unknownCount: 2,
    pdfFilename: 'MYLINE-detailed-rfq-v2-en-zh.pdf',
    pdfBlob: new Blob([pdfBytes2], { type: 'application/pdf' }),
    note: 'Detailed BOM package',
  });
  assert.equal(rev2.revision, 2);

  await store.updateMeta(rev2.id, { status: 'sent', note: 'Sent to Factory A' });
  store.close();

  const reopened = await openDocumentStore(dbName);
  try {
    const list = await reopened.list(project.id);
    assert.equal(list.length, 2);
    assert.equal(list[0].revision, 2);
    assert.equal(list[0].status, 'sent');
    assert.equal(list[0].note, 'Sent to Factory A');

    const restoredRev2 = await reopened.get(rev2.id);
    assert.ok(restoredRev2);
    assert.deepEqual(new Uint8Array(await restoredRev2.pdfBlob.arrayBuffer()), pdfBytes2);

    await reopened.remove(rev1.id);
    const remaining = await reopened.list(project.id);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].id, rev2.id);
  } finally {
    reopened.close();
  }
});
