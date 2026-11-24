import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultStudioPreferences,
  loadStudioPreferences,
  parseStudioPreferences,
  preferencesStorageKey,
  saveStudioPreferences,
} from '../src/storage/preferences.ts';
import {
  exportSupplierJournalJson,
  openSupplierStore,
  summarizeSupplierQuotes,
} from '../src/storage/suppliers.ts';
import { fetchProviderStatuses } from '../src/ui/settings/helpers.ts';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

test('studio preferences persist valid values, keep mm & paidAiApisEnabled locked, and recover from invalid JSON', () => {
  const store = memoryStorage();
  assert.deepEqual(loadStudioPreferences(store), defaultStudioPreferences);

  const saved = saveStudioPreferences(
    { defaultRfqLanguage: 'zh', defaultRfqTier: 'quick', defaultCurrency: 'CNY' },
    store,
  );
  assert.equal(saved.persisted, true);
  assert.equal(saved.preferences.defaultRfqLanguage, 'zh');
  assert.equal(saved.preferences.defaultRfqTier, 'quick');
  assert.equal(saved.preferences.defaultCurrency, 'CNY');
  assert.equal(saved.preferences.lengthUnit, 'mm');
  assert.equal(saved.preferences.paidAiApisEnabled, false);

  const reloaded = loadStudioPreferences(store);
  assert.deepEqual(reloaded, saved.preferences);

  // Tampering with locked invariants or invalid JSON falls back safely
  const coerced = parseStudioPreferences({
    defaultRfqLanguage: 'en',
    lengthUnit: 'inches',
    paidAiApisEnabled: true,
  });
  assert.equal(coerced.defaultRfqLanguage, 'en');
  assert.equal(coerced.lengthUnit, 'mm');
  assert.equal(coerced.paidAiApisEnabled, false);

  store.setItem(preferencesStorageKey, '{broken-json');
  assert.deepEqual(loadStudioPreferences(store), defaultStudioPreferences);
});

test('supplier store persists factory responses, history timeline, and preserves missing commercial fields honestly', async () => {
  const dbName = `light-forge-suppliers-test-${crypto.randomUUID()}`;
  const store = await openSupplierStore(dbName);

  const r1 = await store.save({
    supplierName: 'Zhongshan Solid Brass Factory',
    supplierRegion: 'Guzhen, Zhongshan',
    projectId: 'proj-myline-1',
    projectName: 'MYLINE',
    documentRevisionId: 'rev-1',
    documentRevisionLabel: 'v1 · EN-ZH',
    status: 'quoted',
    currency: 'USD',
    unitPrice: 680,
    moq: 2,
    sampleLeadDays: 18,
    productionLeadDays: 30,
    incoterms: 'EXW',
    materialConfirmation: 'confirmed',
    certificationsConfirmed: 'CE (driver UL listed)',
    eventNote: 'Получено первичное КП по v1',
  });

  // Second factory has NOT provided price, lead time, or certifications yet — must stay undefined!
  const r2 = await store.save({
    supplierName: 'Foshan Lighting Workshop',
    projectId: 'proj-myline-1',
    projectName: 'MYLINE',
    status: 'clarification',
    materialConfirmation: 'substitution_proposed',
    substitutionNote: 'Предложили замену solid brass на окрашенную сталь',
    engineeringNotes: 'Запрашивают подтверждение высоты стола (мм)',
  });

  assert.equal(r1.unitPrice, 680);
  assert.equal(r2.unitPrice, undefined);
  assert.equal(r2.productionLeadDays, undefined);
  assert.equal(r2.certificationsConfirmed, undefined);
  assert.equal(r2.materialConfirmation, 'substitution_proposed');

  const withEvent = await store.appendEvent(r2.id, {
    status: 'declined',
    note: 'Замена латуни отклонена по правилу Strict Materials',
  });
  assert.ok(withEvent);
  assert.equal(withEvent.status, 'declined');
  assert.equal(withEvent.history.length, 2);
  assert.match(withEvent.history[0].note, /Strict Materials/);

  store.close();

  // Reopen store and verify full persistence + summary honesty
  const reopened = await openSupplierStore(dbName);
  try {
    const listed = await reopened.list('proj-myline-1');
    assert.equal(listed.length, 2);

    const summary = summarizeSupplierQuotes(listed);
    assert.equal(summary.totalResponses, 2);
    assert.equal(summary.quotedCount, 1);
    assert.equal(summary.substitutionAlerts, 1);
    assert.equal(summary.missingPriceCount, 1);
    assert.equal(summary.missingLeadTimeCount, 1);
    assert.equal(summary.missingCertificationsCount, 1);
    assert.equal(summary.lowestQuotedByCurrency.USD?.unitPrice, 680);

    const exported = JSON.parse(exportSupplierJournalJson(listed, 'proj-myline-1'));
    assert.equal(exported.schema, 'light-forge-supplier-journal/v1');
    assert.equal(exported.responses.length, 2);

    await reopened.remove(r2.id);
    assert.equal((await reopened.list('proj-myline-1')).length, 1);
  } finally {
    reopened.close();
  }
});

test('fetchProviderStatuses reflects live endpoint states and handles provider errors cleanly', async () => {
  const mockFetch = async (url: string): Promise<Response> => {
    if (url === '/api/health') {
      return Response.json({ status: 'ok', geometryVersion: 1 });
    }
    if (url === '/api/visual-search') {
      return Response.json({
        gemini: { enabled: false, requestsToday: 0, appDailyLimit: 20, providerRemaining: null },
        serpApi: { enabled: false },
        manualLens: true,
        paidEnabled: false,
      });
    }
    if (url === '/api/visual-search/local') {
      return Response.json({ available: true, referenceCount: 4 });
    }
    if (url === '/api/photo-analysis') {
      return new Response('unavailable', { status: 503 });
    }
    return new Response('not found', { status: 404 });
  };

  const snapshot = await fetchProviderStatuses(mockFetch);
  const byId = Object.fromEntries(snapshot.cards.map((c) => [c.id, c]));

  assert.equal(byId.server.state, 'active');
  assert.equal(byId.gemini.state, 'standby');
  assert.equal(byId['paid-policy'].state, 'disabled');
  assert.equal(byId['local-index'].state, 'active');
  assert.match(byId['local-index'].stateLabel, /4/);
  assert.equal(byId['photo-analysis'].state, 'error');
  assert.match(byId['photo-analysis'].summary, /HTTP 503/);
});
