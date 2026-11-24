'use client';

import './settings.css';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { openCompositionStore } from '@/storage/compositions';
import { openDocumentStore, type DocumentRevisionMeta } from '@/storage/documents';
import {
  defaultStudioPreferences,
  formatRfqLanguageLabel,
  formatRfqTierLabel,
  loadStudioPreferences,
  saveStudioPreferences,
  type StudioPreferences,
} from '@/storage/preferences';
import type { Project } from '@/domain/project';
import { openProjectStore } from '@/storage/projects';
import {
  exportSupplierJournalJson,
  openSupplierStore,
  summarizeSupplierQuotes,
  type FactoryResponse,
  type FactoryResponseStatus,
  type Incoterms,
  type MaterialConfirmation,
  type QuoteCurrency,
} from '@/storage/suppliers';
import { themeKey } from '@/ui/StudioNavigation';
import { GeminiAiPanel } from './GeminiAiPanel';
import {
  factoryStatusMeta,
  fetchProviderStatuses,
  formatDays,
  formatMoney,
  formatTimestampRu,
  materialConfirmationMeta,
  type LiveProvidersSnapshot,
} from './helpers';

type ActiveTab = 'providers' | 'suppliers';

type StorageCounts = {
  projects: number;
  compositions: number;
  documents: number;
  suppliers: number;
};

type SupplierFormDraft = {
  id?: string;
  supplierName: string;
  supplierRegion: string;
  contactInfo: string;
  projectId: string;
  documentRevisionId: string;
  status: FactoryResponseStatus;
  currency: QuoteCurrency;
  unitPrice: string;
  moq: string;
  sampleLeadDays: string;
  productionLeadDays: string;
  incoterms: '' | Incoterms;
  materialConfirmation: MaterialConfirmation;
  substitutionNote: string;
  certificationsConfirmed: string;
  engineeringNotes: string;
  eventNote: string;
};

const emptyDraft = (defaultCurrency: QuoteCurrency, projectId = '', documentRevisionId = ''): SupplierFormDraft => ({
  supplierName: '',
  supplierRegion: '',
  contactInfo: '',
  projectId,
  documentRevisionId,
  status: 'requested',
  currency: defaultCurrency,
  unitPrice: '',
  moq: '',
  sampleLeadDays: '',
  productionLeadDays: '',
  incoterms: '',
  materialConfirmation: 'unconfirmed',
  substitutionNote: '',
  certificationsConfirmed: '',
  engineeringNotes: '',
  eventNote: '',
});

function parsePositiveNumber(raw: string): number | undefined {
  const normalized = raw.trim().replace(',', '.');
  if (!normalized) return undefined;
  const num = Number(normalized);
  return Number.isFinite(num) && num > 0 ? num : undefined;
}

export function SettingsWorkspace() {
  const searchParams = useSearchParams();
  const initialTab: ActiveTab = searchParams.get('tab') === 'suppliers' ? 'suppliers' : 'providers';
  const paramProjectId = searchParams.get('rfqProject') ?? '';
  const paramRevisionId = searchParams.get('revisionId') ?? '';

  const [tab, setTab] = useState<ActiveTab>(initialTab);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [prefs, setPrefs] = useState<StudioPreferences>(defaultStudioPreferences);
  const [saveError, setSaveError] = useState(false);
  const [prefNotice, setPrefNotice] = useState<string | null>(null);

  const [providers, setProviders] = useState<LiveProvidersSnapshot | null>(null);
  const [providersLoading, setProvidersLoading] = useState(false);

  const [counts, setCounts] = useState<StorageCounts>({
    projects: 0,
    compositions: 0,
    documents: 0,
    suppliers: 0,
  });
  const [projects, setProjects] = useState<Project[]>([]);
  const [revisions, setRevisions] = useState<DocumentRevisionMeta[]>([]);
  const [responses, setResponses] = useState<FactoryResponse[]>([]);

  const [filterProjectId, setFilterProjectId] = useState<string>(paramProjectId);
  const [filterStatus, setFilterStatus] = useState<'all' | FactoryResponseStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [showForm, setShowForm] = useState(Boolean(paramProjectId || paramRevisionId));
  const [draft, setDraft] = useState<SupplierFormDraft>(() =>
    emptyDraft('USD', paramProjectId, paramRevisionId),
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [supplierNotice, setSupplierNotice] = useState<string | null>(null);

  const [eventDrafts, setEventDrafts] = useState<
    Record<string, { status: FactoryResponseStatus; note: string }>
  >({});

  const refreshProviders = useCallback(async () => {
    setProvidersLoading(true);
    try {
      const snapshot = await fetchProviderStatuses();
      setProviders(snapshot);
    } finally {
      setProvidersLoading(false);
    }
  }, []);

  const refreshLocalStores = useCallback(async () => {
    const [projList, compList, docList, supList] = await Promise.all([
      openProjectStore()
        .then(async (store) => {
          try { return await store.list(); } finally { store.close(); }
        })
        .catch(() => [] as Project[]),
      openCompositionStore()
        .then(async (store) => {
          try { return await store.list(); } finally { store.close(); }
        })
        .catch(() => []),
      openDocumentStore()
        .then(async (store) => {
          try { return await store.list(); } finally { store.close(); }
        })
        .catch(() => [] as DocumentRevisionMeta[]),
      openSupplierStore()
        .then(async (store) => {
          try { return await store.list(); } finally { store.close(); }
        })
        .catch(() => [] as FactoryResponse[]),
    ]);

    setProjects(projList);
    setRevisions(docList);
    setResponses(supList);
    setCounts({
      projects: projList.length,
      compositions: compList.length,
      documents: docList.length,
      suppliers: supList.length,
    });
  }, []);

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
    const loaded = loadStudioPreferences();
    setPrefs(loaded);
    setDraft((prev) => ({ ...prev, currency: loaded.defaultCurrency }));
    void refreshProviders();
    void refreshLocalStores();
  }, [refreshProviders, refreshLocalStores]);

  function selectTheme(next: 'light' | 'dark') {
    document.documentElement.dataset.theme = next;
    setTheme(next);
    try {
      localStorage.setItem(themeKey, next);
      setSaveError(false);
    } catch {
      setSaveError(true);
    }
  }

  function updatePreferences(
    patch: Partial<Pick<StudioPreferences, 'defaultRfqLanguage' | 'defaultRfqTier' | 'defaultCurrency'>>,
  ) {
    const { preferences, persisted } = saveStudioPreferences(patch);
    setPrefs(preferences);
    setSaveError(!persisted);
    setPrefNotice(
      persisted
        ? 'Настройки сохранены в браузере и будут применяться в Документах и журнале фабрик.'
        : 'Настройки применены в текущей сессии, но localStorage недоступен.',
    );
  }

  const filteredResponses = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return responses.filter((item) => {
      if (filterProjectId && item.projectId !== filterProjectId) return false;
      if (filterStatus !== 'all' && item.status !== filterStatus) return false;
      if (!q) return true;
      const haystack = [
        item.supplierName,
        item.supplierRegion,
        item.contactInfo,
        item.projectName,
        item.certificationsConfirmed,
        item.engineeringNotes,
        item.substitutionNote,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [responses, filterProjectId, filterStatus, searchQuery]);

  const summary = useMemo(() => summarizeSupplierQuotes(filteredResponses), [filteredResponses]);

  const availableRevisionsForDraft = useMemo(() => {
    if (!draft.projectId) return revisions;
    return revisions.filter((rev) => rev.projectId === draft.projectId);
  }, [revisions, draft.projectId]);

  function openNewForm() {
    setDraft(emptyDraft(prefs.defaultCurrency, filterProjectId, ''));
    setFormError(null);
    setShowForm(true);
  }

  function openEditForm(item: FactoryResponse) {
    setDraft({
      id: item.id,
      supplierName: item.supplierName,
      supplierRegion: item.supplierRegion ?? '',
      contactInfo: item.contactInfo ?? '',
      projectId: item.projectId ?? '',
      documentRevisionId: item.documentRevisionId ?? '',
      status: item.status,
      currency: item.currency ?? prefs.defaultCurrency,
      unitPrice: item.unitPrice !== undefined ? String(item.unitPrice) : '',
      moq: item.moq !== undefined ? String(item.moq) : '',
      sampleLeadDays: item.sampleLeadDays !== undefined ? String(item.sampleLeadDays) : '',
      productionLeadDays: item.productionLeadDays !== undefined ? String(item.productionLeadDays) : '',
      incoterms: item.incoterms ?? '',
      materialConfirmation: item.materialConfirmation,
      substitutionNote: item.substitutionNote ?? '',
      certificationsConfirmed: item.certificationsConfirmed ?? '',
      engineeringNotes: item.engineeringNotes ?? '',
      eventNote: '',
    });
    setFormError(null);
    setShowForm(true);
  }

  async function handleSaveResponse(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!draft.supplierName.trim()) {
      setFormError('Укажите название фабрики или поставщика.');
      return;
    }
    if (draft.unitPrice.trim() && parsePositiveNumber(draft.unitPrice) === undefined) {
      setFormError('Цена за единицу должна быть положительным числом или пустой.');
      return;
    }

    const linkedProject = projects.find((p) => p.id === draft.projectId);
    const linkedRevision = revisions.find((r) => r.id === draft.documentRevisionId);
    const revisionLabel = linkedRevision
      ? `v${linkedRevision.revision} · ${linkedRevision.language.toUpperCase()}`
      : undefined;

    try {
      const store = await openSupplierStore();
      try {
        await store.save({
          id: draft.id,
          supplierName: draft.supplierName.trim(),
          supplierRegion: draft.supplierRegion,
          contactInfo: draft.contactInfo,
          projectId: draft.projectId || undefined,
          projectName: linkedProject?.name,
          documentRevisionId: draft.documentRevisionId || undefined,
          documentRevisionLabel: revisionLabel,
          status: draft.status,
          currency: draft.currency,
          unitPrice: parsePositiveNumber(draft.unitPrice),
          moq: parsePositiveNumber(draft.moq),
          sampleLeadDays: parsePositiveNumber(draft.sampleLeadDays),
          productionLeadDays: parsePositiveNumber(draft.productionLeadDays),
          incoterms: draft.incoterms || undefined,
          materialConfirmation: draft.materialConfirmation,
          substitutionNote: draft.substitutionNote,
          certificationsConfirmed: draft.certificationsConfirmed,
          engineeringNotes: draft.engineeringNotes,
          eventNote: draft.eventNote,
        });
      } finally {
        store.close();
      }
      await refreshLocalStores();
      setShowForm(false);
      setSupplierNotice(
        draft.id
          ? `Обновлена запись по фабрике «${draft.supplierName.trim()}».`
          : `Сохранена запись по фабрике «${draft.supplierName.trim()}».`,
      );
      setDraft(emptyDraft(prefs.defaultCurrency, filterProjectId, ''));
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Не удалось сохранить запись.');
    }
  }

  async function handleAppendHistory(item: FactoryResponse) {
    const entry = eventDrafts[item.id];
    const note = entry?.note.trim() ?? '';
    if (!note) return;
    const status = entry?.status ?? item.status;
    const store = await openSupplierStore();
    try {
      await store.appendEvent(item.id, { status, note });
    } finally {
      store.close();
    }
    setEventDrafts((prev) => ({ ...prev, [item.id]: { status, note: '' } }));
    await refreshLocalStores();
    setSupplierNotice(`Добавлена запись в историю фабрики «${item.supplierName}».`);
  }

  async function handleDeleteResponse(item: FactoryResponse) {
    const store = await openSupplierStore();
    try {
      await store.remove(item.id);
    } finally {
      store.close();
    }
    await refreshLocalStores();
    setSupplierNotice(`Удалена запись фабрики «${item.supplierName}».`);
  }

  function handleExportJson() {
    const json = exportSupplierJournalJson(filteredResponses, filterProjectId || undefined);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `light-forge-suppliers-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setSupplierNotice('Экспортирован JSON-журнал ответов фабрик.');
  }

  return (
    <main className="atelier-page lf-settings-page">
      <header className="atelier-heading">
        <div>
          <h1>Настройки и поставщики</h1>
          <p>
            Проверяемые параметры студии, живые статусы серверных провайдеров и журнал реальных ответов фабрик.
          </p>
        </div>
        <div role="tablist" aria-label="Разделы настроек" className="lf-segment">
          <button
            id="lf-tab-providers"
            type="button"
            role="tab"
            className="lf-segment-btn"
            aria-selected={tab === 'providers'}
            aria-pressed={tab === 'providers'}
            onClick={() => setTab('providers')}
          >
            Настройки и провайдеры
          </button>
          <button
            id="lf-tab-suppliers"
            type="button"
            role="tab"
            className="lf-segment-btn"
            aria-selected={tab === 'suppliers'}
            aria-pressed={tab === 'suppliers'}
            onClick={() => setTab('suppliers')}
          >
            Поставщики и фабрики ({counts.suppliers})
          </button>
        </div>
      </header>

      {tab === 'providers' ? (
        <>
          <div className="lf-settings-grid-2">
            <section className="atelier-panel" aria-labelledby="lf-pref-heading">
              <h2 id="lf-pref-heading">Параметры интерфейса и RFQ</h2>

              <div className="lf-settings-pref-row">
                <div className="lf-settings-pref-label">
                  <strong>Тема интерфейса</strong>
                  <span className="lf-st-pill lf-st-pill--neutral">
                    {theme === 'dark' ? 'Тёмная Atelier' : 'Светлая Atelier'}
                  </span>
                </div>
                <div role="group" aria-label="Тема интерфейса" className="lf-segment">
                  <button
                    type="button"
                    className="lf-segment-btn"
                    aria-pressed={theme === 'light'}
                    onClick={() => selectTheme('light')}
                  >
                    Светлая
                  </button>
                  <button
                    type="button"
                    className="lf-segment-btn"
                    aria-pressed={theme === 'dark'}
                    onClick={() => selectTheme('dark')}
                  >
                    Тёмная
                  </button>
                </div>
              </div>

              <div className="lf-settings-pref-row">
                <div className="lf-settings-pref-label">
                  <strong>Язык RFQ по умолчанию</strong>
                  <span className="lf-st-pill lf-st-pill--info">
                    {formatRfqLanguageLabel(prefs.defaultRfqLanguage)}
                  </span>
                </div>
                <div role="group" aria-label="Язык RFQ по умолчанию" className="lf-segment">
                  <button
                    type="button"
                    className="lf-segment-btn"
                    aria-pressed={prefs.defaultRfqLanguage === 'en-zh'}
                    onClick={() => updatePreferences({ defaultRfqLanguage: 'en-zh' })}
                  >
                    EN + ZH
                  </button>
                  <button
                    type="button"
                    className="lf-segment-btn"
                    aria-pressed={prefs.defaultRfqLanguage === 'en'}
                    onClick={() => updatePreferences({ defaultRfqLanguage: 'en' })}
                  >
                    EN
                  </button>
                  <button
                    type="button"
                    className="lf-segment-btn"
                    aria-pressed={prefs.defaultRfqLanguage === 'zh'}
                    onClick={() => updatePreferences({ defaultRfqLanguage: 'zh' })}
                  >
                    ZH
                  </button>
                </div>
                <p className="lf-settings-pref-hint">
                  Применяется при открытии рабочего пространства «Документы и PDF».
                </p>
              </div>

              <div className="lf-settings-pref-row">
                <div className="lf-settings-pref-label">
                  <strong>Режим RFQ по умолчанию</strong>
                  <span className="lf-st-pill lf-st-pill--neutral">
                    {formatRfqTierLabel(prefs.defaultRfqTier)}
                  </span>
                </div>
                <div role="group" aria-label="Режим RFQ по умолчанию" className="lf-segment">
                  <button
                    type="button"
                    className="lf-segment-btn"
                    aria-pressed={prefs.defaultRfqTier === 'detailed'}
                    onClick={() => updatePreferences({ defaultRfqTier: 'detailed' })}
                  >
                    Detailed RFQ
                  </button>
                  <button
                    type="button"
                    className="lf-segment-btn"
                    aria-pressed={prefs.defaultRfqTier === 'quick'}
                    onClick={() => updatePreferences({ defaultRfqTier: 'quick' })}
                  >
                    Quick RFQ
                  </button>
                </div>
              </div>

              <div className="lf-settings-pref-row">
                <div className="lf-settings-pref-label">
                  <strong>Валюта КП фабрик по умолчанию</strong>
                  <span className="lf-st-pill lf-st-pill--neutral">{prefs.defaultCurrency}</span>
                </div>
                <div role="group" aria-label="Валюта КП по умолчанию" className="lf-segment">
                  {(['USD', 'EUR', 'CNY'] as const).map((curr) => (
                    <button
                      key={curr}
                      type="button"
                      className="lf-segment-btn"
                      aria-pressed={prefs.defaultCurrency === curr}
                      onClick={() => updatePreferences({ defaultCurrency: curr })}
                    >
                      {curr}
                    </button>
                  ))}
                </div>
              </div>

              {saveError && (
                <p role="alert" className="lf-suppliers-alert">
                  Браузер не сохранил настройки для следующих сеансов.
                </p>
              )}
              {prefNotice && !saveError && (
                <p role="status" className="lf-settings-pref-hint">
                  {prefNotice}
                </p>
              )}
            </section>

            <section className="atelier-panel" aria-labelledby="lf-policy-heading">
              <h2 id="lf-policy-heading">Инженерная политика и данные браузера</h2>

              <div className="lf-settings-policy-box">
                <div className="lf-settings-policy-row">
                  <span>Каноническая единица длины</span>
                  <span className="lf-st-pill lf-st-pill--good">Миллиметры (мм)</span>
                </div>
                <div className="lf-settings-policy-row">
                  <span>Оригиналы загруженных фотографий</span>
                  <span className="lf-st-pill lf-st-pill--good">Сохраняются без изменений</span>
                </div>
                <div className="lf-settings-policy-row">
                  <span>Платные AI API и авто-биллинг</span>
                  <span className="lf-st-pill lf-st-pill--disabled">Отключено</span>
                </div>
                <div className="lf-settings-policy-row">
                  <span>Отсутствующие цены / сертификаты / размеры</span>
                  <span className="lf-st-pill lf-st-pill--warn">Не выдумываются (подтверждает фабрика)</span>
                </div>
              </div>

              <h3 style={{ fontSize: '14px', margin: '16px 0 10px' }}>
                Локальное хранилище IndexedDB
              </h3>
              <div className="lf-storage-kpis" id="lf-storage-summary">
                <div className="lf-storage-kpi">
                  <strong>{counts.projects}</strong>
                  <span>Проекты RFQ</span>
                </div>
                <div className="lf-storage-kpi">
                  <strong>{counts.compositions}</strong>
                  <span>3D-композиции</span>
                </div>
                <div className="lf-storage-kpi">
                  <strong>{counts.documents}</strong>
                  <span>Версии PDF</span>
                </div>
                <div className="lf-storage-kpi">
                  <strong>{counts.suppliers}</strong>
                  <span>Ответы фабрик</span>
                </div>
              </div>

              <div className="atelier-inline" style={{ marginTop: '14px' }}>
                <a href="/projects" className="lf-btn lf-btn--subtle">
                  Проекты
                </a>
                <a href="/documents" className="lf-btn lf-btn--subtle">
                  Документы и PDF
                </a>
                <a href="/search" className="lf-btn lf-btn--subtle">
                  AI Visual Search
                </a>
                <button
                  type="button"
                  className="lf-btn lf-btn--primary"
                  onClick={() => setTab('suppliers')}
                >
                  Журнал фабрик →
                </button>
              </div>
            </section>
          </div>

          <GeminiAiPanel />

          <section className="atelier-panel" aria-labelledby="lf-providers-heading">
            <div className="lf-providers-head">
              <div>
                <h2 id="lf-providers-heading">Статусы реальных провайдеров (Live Check)</h2>
                <p className="lf-settings-pref-hint">
                  Данные запрашиваются напрямую с серверных маршрутов без кеширования.
                  {providers ? ` Последняя проверка: ${formatTimestampRu(providers.checkedAt)}` : ''}
                </p>
              </div>
              <button
                id="lf-refresh-providers-btn"
                type="button"
                className="lf-btn lf-btn--subtle"
                disabled={providersLoading}
                onClick={() => void refreshProviders()}
              >
                {providersLoading ? 'Проверяем…' : 'Проверить сейчас'}
              </button>
            </div>

            {providers ? (
              <div className="lf-providers-grid" id="lf-providers-grid">
                {providers.cards.map((card) => (
                  <article key={card.id} className="lf-provider-card" data-provider-id={card.id}>
                    <div className="lf-provider-top">
                      <div>
                        <h3>{card.title}</h3>
                        <span className="lf-provider-endpoint">
                          {card.endpoint}
                          {card.latencyMs !== undefined ? ` · ${card.latencyMs} мс` : ''}
                        </span>
                      </div>
                      <span className={`lf-st-pill lf-st-pill--${card.state}`}>
                        {card.stateLabel}
                      </span>
                    </div>
                    <p className="lf-provider-summary">{card.summary}</p>
                    <ul className="lf-provider-details">
                      {card.details.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            ) : (
              <p className="lf-settings-pref-hint">Запрашиваем состояние серверных провайдеров…</p>
            )}
          </section>
        </>
      ) : (
        <>
          <section className="atelier-panel" aria-labelledby="lf-suppliers-heading">
            <div className="lf-providers-head">
              <div>
                <h2 id="lf-suppliers-heading">Поставщики, КП и история ответов фабрик</h2>
                <p className="lf-settings-pref-hint">
                  Фиксируйте только реальные ответы и условия производителей. Неполученные цены, сроки и сертификаты остаются пустыми.
                </p>
              </div>
              <div className="atelier-inline">
                <button
                  id="lf-suppliers-export-btn"
                  type="button"
                  className="lf-btn lf-btn--subtle"
                  disabled={filteredResponses.length === 0}
                  onClick={handleExportJson}
                >
                  Экспорт JSON
                </button>
                <button
                  id="lf-new-supplier-btn"
                  type="button"
                  className="lf-btn lf-btn--primary"
                  onClick={openNewForm}
                >
                  + Добавить ответ фабрики
                </button>
              </div>
            </div>

            <div className="lf-suppliers-kpis" style={{ marginBottom: '14px' }}>
              <div className="lf-storage-kpi">
                <strong>{summary.totalResponses}</strong>
                <span>Всего записей</span>
              </div>
              <div className="lf-storage-kpi">
                <strong>{summary.quotedCount}</strong>
                <span>С КП / в образце</span>
              </div>
              <div className="lf-storage-kpi">
                <strong>{summary.substitutionAlerts}</strong>
                <span>Запросов замены материалов</span>
              </div>
              <div className="lf-storage-kpi">
                <strong>{summary.missingPriceCount}</strong>
                <span>Без указанной цены</span>
              </div>
            </div>

            <div className="lf-suppliers-toolbar">
              <div className="lf-suppliers-field">
                <label htmlFor="lf-suppliers-project-filter">Проект RFQ</label>
                <select
                  id="lf-suppliers-project-filter"
                  value={filterProjectId}
                  onChange={(e) => setFilterProjectId(e.target.value)}
                >
                  <option value="">Все проекты ({responses.length})</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name} {project.code ? `(${project.code})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="lf-suppliers-field">
                <label htmlFor="lf-suppliers-status-filter">Статус</label>
                <select
                  id="lf-suppliers-status-filter"
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value as 'all' | FactoryResponseStatus)}
                >
                  <option value="all">Все статусы</option>
                  <option value="requested">Запрос отправлен</option>
                  <option value="clarification">Вопросы фабрики</option>
                  <option value="quoted">Получено КП</option>
                  <option value="sampling">Образец в работе</option>
                  <option value="approved">Согласовано</option>
                  <option value="declined">Отклонено</option>
                </select>
              </div>

              <div className="lf-suppliers-field">
                <label htmlFor="lf-suppliers-search">Поиск</label>
                <input
                  id="lf-suppliers-search"
                  type="search"
                  placeholder="Фабрика, город, заметка…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <button
                type="button"
                className="lf-btn lf-btn--subtle"
                onClick={() => {
                  setFilterProjectId('');
                  setFilterStatus('all');
                  setSearchQuery('');
                }}
              >
                Сбросить
              </button>
            </div>

            {supplierNotice && (
              <p role="status" className="lf-settings-pref-hint" style={{ marginTop: '10px' }}>
                {supplierNotice}
              </p>
            )}
          </section>

          {showForm && (
            <section className="atelier-panel" aria-labelledby="lf-supplier-form-title">
              <div className="lf-providers-head">
                <h2 id="lf-supplier-form-title">
                  {draft.id ? 'Редактирование ответа фабрики' : 'Новая запись ответа фабрики'}
                </h2>
                <button
                  type="button"
                  className="lf-btn lf-btn--subtle"
                  onClick={() => setShowForm(false)}
                >
                  Закрыть форму
                </button>
              </div>

              <form id="lf-supplier-form" className="lf-suppliers-form" onSubmit={handleSaveResponse}>
                <div className="lf-suppliers-form-grid">
                  <div className="lf-suppliers-field">
                    <label htmlFor="lf-sup-name">Название фабрики / поставщика *</label>
                    <input
                      id="lf-sup-name"
                      type="text"
                      required
                      placeholder="Например, Zhongshan Brass Lighting Co."
                      value={draft.supplierName}
                      onChange={(e) => setDraft({ ...draft, supplierName: e.target.value })}
                    />
                  </div>
                  <div className="lf-suppliers-field">
                    <label htmlFor="lf-sup-region">Регион / город</label>
                    <input
                      id="lf-sup-region"
                      type="text"
                      placeholder="Например, Guzhen, Zhongshan / Милан"
                      value={draft.supplierRegion}
                      onChange={(e) => setDraft({ ...draft, supplierRegion: e.target.value })}
                    />
                  </div>
                  <div className="lf-suppliers-field">
                    <label htmlFor="lf-sup-contact">Контакт (WeChat / Email / менеджер)</label>
                    <input
                      id="lf-sup-contact"
                      type="text"
                      placeholder="Опционально"
                      value={draft.contactInfo}
                      onChange={(e) => setDraft({ ...draft, contactInfo: e.target.value })}
                    />
                  </div>
                </div>

                <div className="lf-suppliers-form-grid">
                  <div className="lf-suppliers-field">
                    <label htmlFor="lf-sup-project">Привязанный проект RFQ</label>
                    <select
                      id="lf-sup-project"
                      value={draft.projectId}
                      onChange={(e) =>
                        setDraft({ ...draft, projectId: e.target.value, documentRevisionId: '' })
                      }
                    >
                      <option value="">Без привязки к проекту</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} {p.code ? `(${p.code})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="lf-suppliers-field">
                    <label htmlFor="lf-sup-revision">Отправленная версия PDF</label>
                    <select
                      id="lf-sup-revision"
                      value={draft.documentRevisionId}
                      onChange={(e) => setDraft({ ...draft, documentRevisionId: e.target.value })}
                    >
                      <option value="">Не указана</option>
                      {availableRevisionsForDraft.map((rev) => (
                        <option key={rev.id} value={rev.id}>
                          v{rev.revision} · {rev.tier.toUpperCase()} · {rev.language.toUpperCase()} ({rev.projectName})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="lf-suppliers-field">
                    <label htmlFor="lf-sup-status">Статус</label>
                    <select
                      id="lf-sup-status"
                      value={draft.status}
                      onChange={(e) =>
                        setDraft({ ...draft, status: e.target.value as FactoryResponseStatus })
                      }
                    >
                      <option value="requested">Запрос отправлен</option>
                      <option value="clarification">Вопросы фабрики</option>
                      <option value="quoted">Получено КП</option>
                      <option value="sampling">Образец в работе</option>
                      <option value="approved">Согласовано</option>
                      <option value="declined">Отклонено</option>
                    </select>
                  </div>
                </div>

                <div className="lf-suppliers-form-grid">
                  <div className="lf-suppliers-field">
                    <label htmlFor="lf-sup-price">Цена за шт. (оставьте пустой, если нет КП)</label>
                    <input
                      id="lf-sup-price"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Не указано"
                      value={draft.unitPrice}
                      onChange={(e) => setDraft({ ...draft, unitPrice: e.target.value })}
                    />
                  </div>
                  <div className="lf-suppliers-field">
                    <label htmlFor="lf-sup-currency">Валюта</label>
                    <select
                      id="lf-sup-currency"
                      value={draft.currency}
                      onChange={(e) =>
                        setDraft({ ...draft, currency: e.target.value as QuoteCurrency })
                      }
                    >
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                      <option value="CNY">CNY</option>
                    </select>
                  </div>
                  <div className="lf-suppliers-field">
                    <label htmlFor="lf-sup-incoterms">Условия поставки (Incoterms)</label>
                    <select
                      id="lf-sup-incoterms"
                      value={draft.incoterms}
                      onChange={(e) =>
                        setDraft({ ...draft, incoterms: e.target.value as '' | Incoterms })
                      }
                    >
                      <option value="">Не указано</option>
                      <option value="EXW">EXW</option>
                      <option value="FOB">FOB</option>
                      <option value="CIF">CIF</option>
                      <option value="DAP">DAP</option>
                      <option value="DDP">DDP</option>
                    </select>
                  </div>
                </div>

                <div className="lf-suppliers-form-grid">
                  <div className="lf-suppliers-field">
                    <label htmlFor="lf-sup-moq">MOQ (мин. партия, шт.)</label>
                    <input
                      id="lf-sup-moq"
                      type="number"
                      min="1"
                      step="1"
                      placeholder="Не указано"
                      value={draft.moq}
                      onChange={(e) => setDraft({ ...draft, moq: e.target.value })}
                    />
                  </div>
                  <div className="lf-suppliers-field">
                    <label htmlFor="lf-sup-sample-days">Срок образца (дней)</label>
                    <input
                      id="lf-sup-sample-days"
                      type="number"
                      min="1"
                      step="1"
                      placeholder="Не указано"
                      value={draft.sampleLeadDays}
                      onChange={(e) => setDraft({ ...draft, sampleLeadDays: e.target.value })}
                    />
                  </div>
                  <div className="lf-suppliers-field">
                    <label htmlFor="lf-sup-prod-days">Срок производства (дней)</label>
                    <input
                      id="lf-sup-prod-days"
                      type="number"
                      min="1"
                      step="1"
                      placeholder="Не указано"
                      value={draft.productionLeadDays}
                      onChange={(e) => setDraft({ ...draft, productionLeadDays: e.target.value })}
                    />
                  </div>
                </div>

                <div className="lf-suppliers-form-grid-2">
                  <div className="lf-suppliers-field">
                    <label htmlFor="lf-sup-materials">Подтверждение материалов (Strict Materials)</label>
                    <select
                      id="lf-sup-materials"
                      value={draft.materialConfirmation}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          materialConfirmation: e.target.value as MaterialConfirmation,
                        })
                      }
                    >
                      <option value="unconfirmed">Не подтверждено фабрикой</option>
                      <option value="confirmed">Подтверждено без замен (Strict Materials)</option>
                      <option value="substitution_proposed">
                        Предложена замена материала — требуется письменное согласие
                      </option>
                    </select>
                  </div>
                  <div className="lf-suppliers-field">
                    <label htmlFor="lf-sup-certs">Подтверждённые сертификаты</label>
                    <input
                      id="lf-sup-certs"
                      type="text"
                      placeholder="Например, CE, UL — оставьте пустым, если не подтверждены"
                      value={draft.certificationsConfirmed}
                      onChange={(e) =>
                        setDraft({ ...draft, certificationsConfirmed: e.target.value })
                      }
                    />
                  </div>
                </div>

                {draft.materialConfirmation === 'substitution_proposed' && (
                  <div className="lf-suppliers-field">
                    <label htmlFor="lf-sup-sub-note">
                      Какую замену предложила фабрика (требуется письменное согласование)?
                    </label>
                    <input
                      id="lf-sup-sub-note"
                      type="text"
                      placeholder="Например, предложена сталь с покрытием вместо solid brass"
                      value={draft.substitutionNote}
                      onChange={(e) => setDraft({ ...draft, substitutionNote: e.target.value })}
                    />
                  </div>
                )}

                <div className="lf-suppliers-form-grid-2">
                  <div className="lf-suppliers-field">
                    <label htmlFor="lf-sup-notes">Инженерные и коммерческие замечания</label>
                    <textarea
                      id="lf-sup-notes"
                      placeholder="Вопросы по драйверу, узлу потолочного крепления, длине тросов (мм)…"
                      value={draft.engineeringNotes}
                      onChange={(e) => setDraft({ ...draft, engineeringNotes: e.target.value })}
                    />
                  </div>
                  <div className="lf-suppliers-field">
                    <label htmlFor="lf-sup-event">Запись в журнал истории (опционально)</label>
                    <textarea
                      id="lf-sup-event"
                      placeholder="Например, Получено первичное КП по ревизии v1 (EN+ZH)"
                      value={draft.eventNote}
                      onChange={(e) => setDraft({ ...draft, eventNote: e.target.value })}
                    />
                  </div>
                </div>

                {formError && (
                  <p role="alert" className="lf-suppliers-alert">
                    {formError}
                  </p>
                )}

                <div className="atelier-inline">
                  <button id="lf-save-supplier-btn" type="submit" className="lf-btn lf-btn--primary">
                    {draft.id ? 'Сохранить изменения' : 'Сохранить запись фабрики'}
                  </button>
                  <button
                    type="button"
                    className="lf-btn lf-btn--subtle"
                    onClick={() => setShowForm(false)}
                  >
                    Отмена
                  </button>
                </div>
              </form>
            </section>
          )}

          {filteredResponses.length > 0 && (
            <section className="atelier-panel" aria-labelledby="lf-compare-heading">
              <h2 id="lf-compare-heading">Сравнение предложений фабрик</h2>
              <div className="lf-suppliers-table-wrap">
                <table className="lf-suppliers-table" id="lf-suppliers-compare-table">
                  <thead>
                    <tr>
                      <th>Фабрика</th>
                      <th>Проект / PDF</th>
                      <th>Статус</th>
                      <th>Цена / Incoterms</th>
                      <th>MOQ</th>
                      <th>Образец / Произв.</th>
                      <th>Материалы</th>
                      <th>Сертификаты</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredResponses.map((item) => {
                      const st = factoryStatusMeta(item.status);
                      const mat = materialConfirmationMeta(item.materialConfirmation);
                      return (
                        <tr key={item.id}>
                          <td>
                            <strong>{item.supplierName}</strong>
                            {item.supplierRegion && (
                              <div className="lf-settings-pref-hint">{item.supplierRegion}</div>
                            )}
                          </td>
                          <td>
                            <div>{item.projectName ?? 'Без проекта'}</div>
                            {item.documentRevisionLabel && (
                              <div className="lf-settings-pref-hint">
                                {item.documentRevisionLabel}
                              </div>
                            )}
                          </td>
                          <td>
                            <span className={`lf-st-pill lf-st-pill--${st.tone}`}>{st.label}</span>
                          </td>
                          <td className="num">
                            <strong>{formatMoney(item.unitPrice, item.currency)}</strong>
                            <div className="lf-settings-pref-hint">
                              {item.incoterms ?? 'Incoterms: не указано'}
                            </div>
                          </td>
                          <td className="num">{item.moq ? `${item.moq} шт.` : 'Не указано'}</td>
                          <td className="num">
                            {formatDays(item.sampleLeadDays)} / {formatDays(item.productionLeadDays)}
                          </td>
                          <td>
                            <span className={`lf-st-pill lf-st-pill--${mat.tone}`}>
                              {mat.label}
                            </span>
                          </td>
                          <td>{item.certificationsConfirmed ?? 'Не подтверждены'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="atelier-panel" aria-labelledby="lf-journal-heading">
            <h2 id="lf-journal-heading">Журнал и история взаимодействий ({filteredResponses.length})</h2>
            {filteredResponses.length === 0 ? (
              <div className="lf-supplier-empty">
                <p style={{ margin: 0 }}>
                  Записей ответов фабрик пока нет. Добавьте фабрику после отправки PDF-пакета из раздела «Документы и PDF».
                </p>
                <div className="atelier-inline">
                  <button
                    type="button"
                    className="lf-btn lf-btn--primary"
                    onClick={openNewForm}
                  >
                    + Добавить первый ответ фабрики
                  </button>
                  <a href="/documents" className="lf-btn lf-btn--subtle">
                    Открыть Документы и PDF
                  </a>
                </div>
              </div>
            ) : (
              <div className="lf-supplier-cards" id="lf-supplier-cards">
                {filteredResponses.map((item) => {
                  const st = factoryStatusMeta(item.status);
                  const mat = materialConfirmationMeta(item.materialConfirmation);
                  const eventDraft = eventDrafts[item.id] ?? { status: item.status, note: '' };
                  return (
                    <article key={item.id} className="lf-supplier-card" data-supplier-id={item.id}>
                      <div className="lf-supplier-card-head">
                        <div className="lf-supplier-card-title">
                          <h3>{item.supplierName}</h3>
                          <div className="lf-supplier-meta-line">
                            {item.projectName && <span>Проект: {item.projectName}</span>}
                            {item.documentRevisionLabel && (
                              <span>Ревизия: {item.documentRevisionLabel}</span>
                            )}
                            {item.supplierRegion && <span>{item.supplierRegion}</span>}
                            {item.contactInfo && <span>Контакт: {item.contactInfo}</span>}
                            <span>Обновлено: {formatTimestampRu(item.updatedAt)}</span>
                          </div>
                        </div>
                        <div className="atelier-inline">
                          <span className={`lf-st-pill lf-st-pill--${st.tone}`}>{st.label}</span>
                          <span className={`lf-st-pill lf-st-pill--${mat.tone}`}>{mat.label}</span>
                          <button
                            type="button"
                            className="lf-btn lf-btn--subtle"
                            onClick={() => openEditForm(item)}
                          >
                            Изменить
                          </button>
                          <button
                            type="button"
                            className="lf-btn lf-btn--subtle"
                            onClick={() => void handleDeleteResponse(item)}
                          >
                            Удалить
                          </button>
                        </div>
                      </div>

                      {item.materialConfirmation === 'substitution_proposed' && (
                        <div className="lf-suppliers-alert">
                          <strong>Strict Materials:</strong> фабрика предложила замену материала
                          {item.substitutionNote ? ` — ${item.substitutionNote}` : ''}. Замены допускаются только после письменного согласия.
                        </div>
                      )}

                      <div className="lf-supplier-metrics">
                        <div className="lf-supplier-metric">
                          <span>Цена за единицу</span>
                          <strong>{formatMoney(item.unitPrice, item.currency)}</strong>
                        </div>
                        <div className="lf-supplier-metric">
                          <span>Условия / MOQ</span>
                          <strong>
                            {item.incoterms ?? 'Не указано'} · {item.moq ? `${item.moq} шт.` : 'MOQ н/д'}
                          </strong>
                        </div>
                        <div className="lf-supplier-metric">
                          <span>Срок образца</span>
                          <strong>{formatDays(item.sampleLeadDays)}</strong>
                        </div>
                        <div className="lf-supplier-metric">
                          <span>Срок производства</span>
                          <strong>{formatDays(item.productionLeadDays)}</strong>
                        </div>
                        <div className="lf-supplier-metric">
                          <span>Сертификаты</span>
                          <strong>{item.certificationsConfirmed ?? 'Не подтверждены'}</strong>
                        </div>
                      </div>

                      {item.engineeringNotes && (
                        <p className="lf-provider-summary" style={{ margin: 0 }}>
                          <strong>Замечания:</strong> {item.engineeringNotes}
                        </p>
                      )}

                      <div className="lf-supplier-history">
                        <strong style={{ fontSize: '12px' }}>
                          История переписки и статусов ({item.history.length})
                        </strong>
                        <ul className="lf-supplier-history-list">
                          {item.history.map((ev) => {
                            const evStatus = factoryStatusMeta(ev.status);
                            return (
                              <li key={ev.id} className="lf-supplier-history-item">
                                <span>
                                  <strong>[{evStatus.label}]</strong> {ev.note}
                                </span>
                                <span className="lf-settings-pref-hint">
                                  {formatTimestampRu(ev.at)}
                                </span>
                              </li>
                            );
                          })}
                        </ul>

                        <div className="lf-supplier-history-add">
                          <select
                            aria-label={`Новый статус для ${item.supplierName}`}
                            value={eventDraft.status}
                            onChange={(e) =>
                              setEventDrafts((prev) => ({
                                ...prev,
                                [item.id]: {
                                  status: e.target.value as FactoryResponseStatus,
                                  note: eventDraft.note,
                                },
                              }))
                            }
                          >
                            <option value="requested">Запрос отправлен</option>
                            <option value="clarification">Вопросы фабрики</option>
                            <option value="quoted">Получено КП</option>
                            <option value="sampling">Образец в работе</option>
                            <option value="approved">Согласовано</option>
                            <option value="declined">Отклонено</option>
                          </select>
                          <input
                            type="text"
                            placeholder="Добавить запись в историю (ответ фабрики, номер образца, правка)…"
                            value={eventDraft.note}
                            onChange={(e) =>
                              setEventDrafts((prev) => ({
                                ...prev,
                                [item.id]: {
                                  status: eventDraft.status,
                                  note: e.target.value,
                                },
                              }))
                            }
                          />
                          <button
                            type="button"
                            className="lf-btn lf-btn--subtle"
                            disabled={!eventDraft.note.trim()}
                            onClick={() => void handleAppendHistory(item)}
                          >
                            Добавить в историю
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
