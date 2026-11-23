'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { imageTypes, maxPhotoBytes } from '@/domain/project';
import { openProjectStore } from '@/storage/projects';
import {
  canonicalSource,
  importReviewLinks,
  projectFromSearch,
  reviewSchema,
  searchResponseSchema,
  type ReviewLink,
  type SearchInput,
  type SearchResponse,
  type SearchResult,
  type SearchUsage,
} from '@/visual-search/catalogue';
import {
  AlertIcon,
  BookmarkIcon,
  BrandMarkIcon,
  ChatIcon,
  ColumnsIcon,
  ExternalLinkIcon,
  FilePdfIcon,
  LayersIcon,
  LensIcon,
  SearchIcon,
  ShieldIcon,
  SlidersIcon,
  SparkIcon,
} from '../icons';
import { ComparisonStudio, type ComparisonTab } from './ComparisonStudio';
import {
  buildSimilarQuery,
  extractDisplayHost,
  filterLightingConfigurations,
  formatGeminiWarning,
  formatLanguageLabel,
  formatLightDirection,
  FULL_CROP,
  groupSearchResults,
  isFullCrop,
  mergeSearchResults,
  readResultSpecifications,
  type CropRect,
} from './helpers';
import { PhotoCropStage } from './PhotoCropStage';
import { ResultCard } from './ResultCard';
import { ChatGptDrawer, LensDrawer, SettingsDrawer } from './VisualSearchDrawers';

const HISTORY_KEY = 'light-forge-visual-search-history';
const SAVED_KEY = 'light-forge-visual-search-links';
const INITIAL_ACTIVE_CROP: CropRect = { x: 14, y: 10, width: 72, height: 78 };

function readHistory(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
    return Array.isArray(raw)
      ? raw.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 10)
      : [];
  } catch {
    return [];
  }
}

function readSavedLinks(): ReviewLink[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]');
    return reviewSchema.parse({ results: raw }).results;
  } catch {
    return [];
  }
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function createOptimizedPhoto(file: File, crop: CropRect): Promise<File> {
  const bitmap = await createImageBitmap(file);
  try {
    const x = Math.round((bitmap.width * crop.x) / 100);
    const y = Math.round((bitmap.height * crop.y) / 100);
    const width = Math.max(
      1,
      Math.min(bitmap.width - x, Math.round((bitmap.width * crop.width) / 100)),
    );
    const height = Math.max(
      1,
      Math.min(bitmap.height - y, Math.round((bitmap.height * crop.height) / 100)),
    );
    const scale = Math.min(1, 1280 / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Не удалось обработать выделенную область.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, x, y, width, height, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        value => (value ? resolve(value) : reject(new Error('Не удалось создать копию изображения.'))),
        'image/jpeg',
        0.86,
      ),
    );
    return new File([blob], 'light-forge-search.jpg', { type: 'image/jpeg' });
  } finally {
    bitmap.close();
  }
}

export function VisualSearch() {
  // Photo & crop state (user original is never overwritten)
  const [photo, setPhoto] = useState<File | undefined>();
  const [photoUrl, setPhotoUrl] = useState('');
  const [crop, setCrop] = useState<CropRect>(FULL_CROP);
  const [cropActive, setCropActive] = useState(false);

  // Search controls
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchInput['mode']>('standard');
  const [gemini, setGemini] = useState<SearchUsage | undefined>();
  const [allowGemini, setAllowGemini] = useState(false);

  // Real API results, imported links, local library & history
  const [lastResponse, setLastResponse] = useState<SearchResponse | undefined>();
  const [imported, setImported] = useState<SearchResult[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [saved, setSaved] = useState<ReviewLink[]>([]);

  // Per-card selections & comparison studio
  const [selectedVariants, setSelectedVariants] = useState<Record<string, string>>({});
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareTab, setCompareTab] = useState<ComparisonTab>('side-by-side');
  const [compareInView, setCompareInView] = useState(false);

  // Drawers
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lensOpen, setLensOpen] = useState(false);
  const [chatGptOpen, setChatGptOpen] = useState(false);
  const [chatGptFocused, setChatGptFocused] = useState<SearchResult | undefined>();

  // Status & feedback
  const [loading, setLoading] = useState(false);
  const [creatingRfqId, setCreatingRfqId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const searchAbortRef = useRef<AbortController | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    if (message) {
      noticeTimerRef.current = setTimeout(() => setNotice(''), 4200);
    }
  }, []);

  useEffect(() => {
    setHistory(readHistory());
    setSaved(readSavedLinks());

    const controller = new AbortController();
    fetch('/api/visual-search', { signal: controller.signal })
      .then(response => (response.ok ? response.json() : null))
      .then(data => {
        if (!controller.signal.aborted && data?.gemini) {
          setGemini(data.gemini);
        }
      })
      .catch(() => undefined);

    return () => {
      controller.abort();
      searchAbortRef.current?.abort();
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!photo) {
      setPhotoUrl('');
      return;
    }
    const url = URL.createObjectURL(photo);
    setPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const results = useMemo(
    () => mergeSearchResults(lastResponse?.results ?? [], imported),
    [lastResponse, imported],
  );
  const sections = useMemo(() => groupSearchResults(results), [results]);

  const comparedItems = useMemo(
    () =>
      compareIds
        .map(id => results.find(item => item.id === id))
        .filter((item): item is SearchResult => Boolean(item)),
    [compareIds, results],
  );

  useEffect(() => {
    if (comparedItems.length === 0) {
      setCompareInView(false);
      return;
    }
    const target = document.getElementById('vs-comparison-studio');
    if (!target || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      entries => {
        setCompareInView(Boolean(entries[0]?.isIntersecting));
      },
      { threshold: 0.12 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [comparedItems.length]);

  const savedUrls = useMemo(() => {
    const set = new Set<string>();
    for (const item of saved) {
      try {
        set.add(canonicalSource(item.url));
      } catch {
        set.add(item.url);
      }
    }
    return set;
  }, [saved]);

  const hasResultsArea = Boolean(lastResponse || imported.length > 0);
  const geminiWarningText = formatGeminiWarning(lastResponse?.warning);

  function resetPhotoSearch() {
    searchAbortRef.current?.abort();
    setLoading(false);
    setAllowGemini(false);
    setLastResponse(undefined);
  }

  function choosePhoto(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (!imageTypes.some(type => type === file.type) || file.size > maxPhotoBytes || !file.size) {
      showNotice('Выберите изображение JPEG, PNG или WebP размером до 12 МБ.');
      return;
    }
    resetPhotoSearch();
    setPhoto(file);
    setCrop(FULL_CROP);
    setCropActive(false);
    setNotice('');
  }

  function clearPhoto() {
    resetPhotoSearch();
    setPhoto(undefined);
    setCrop(FULL_CROP);
    setCropActive(false);
  }

  function toggleCrop() {
    if (!cropActive && isFullCrop(crop)) {
      setCrop(INITIAL_ACTIVE_CROP);
    }
    setCropActive(prev => !prev);
  }

  const runSearch = useCallback(
    async (targetQuery = query, targetMode = mode, photoConsent = false) => {
      if (!targetQuery.trim() && !photo) return;

      searchAbortRef.current?.abort();
      const controller = new AbortController();
      searchAbortRef.current = controller;

      setLoading(true);
      setNotice('');
      setAllowGemini(false);
      try {
        const shouldRunGemini = Boolean(gemini?.enabled && photoConsent && photo);
        const input: SearchInput = {
          query: targetQuery,
          mode: targetMode,
          runGemini: shouldRunGemini,
        };

        let requestInit: RequestInit;
        if (shouldRunGemini && photo) {
          const copy = await createOptimizedPhoto(photo, crop);
          input.photo = {
            id: 'selected-photo',
            name: copy.name,
            type: 'image/jpeg',
            size: copy.size,
          };
          const form = new FormData();
          form.set('input', JSON.stringify(input));
          form.set('photo:selected-photo', copy, copy.name);
          requestInit = { method: 'POST', body: form, signal: controller.signal };
        } else {
          requestInit = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
            signal: controller.signal,
          };
        }

        const response = await fetch('/api/visual-search', requestInit);
        if (controller.signal.aborted) return;
        if (!response.ok) {
          throw new Error('Не удалось выполнить поиск. Проверьте запрос и попробуйте ещё раз.');
        }

        const data = searchResponseSchema.parse(await response.json());
        if (controller.signal.aborted) return;

        setLastResponse(data);
        setGemini(data.gemini);

        const cleanTerm = targetQuery.trim();
        if (cleanTerm) {
          setHistory(prev => {
            const updated = [cleanTerm, ...prev.filter(item => item !== cleanTerm)].slice(0, 10);
            try {
              localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
            } catch {
              // Ignore storage quota errors
            }
            return updated;
          });
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        showNotice(err instanceof Error ? err.message : 'Поиск временно недоступен.');
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    },
    [crop, gemini?.enabled, mode, photo, query, showNotice],
  );

  function handleSearchSubmit(event: FormEvent) {
    event.preventDefault();
    void runSearch(query, mode, allowGemini);
  }

  function handleFindSimilar(result: SearchResult) {
    const similarQuery = buildSimilarQuery(result);
    setQuery(similarQuery);
    setMode('deep');
    void runSearch(similarQuery, 'deep');
    showNotice(`Ищем похожие модели по запросу «${similarQuery}»…`);
  }

  function handleAddLinks(links: ReviewLink[]) {
    const next = importReviewLinks(links);
    setImported(previous => mergeSearchResults(previous, next));
    showNotice(`Добавлено ссылок в результаты: ${next.length}.`);
  }

  function handleToggleSave(result: SearchResult) {
    let canonical = result.source;
    try {
      canonical = canonicalSource(result.source);
    } catch {
      // keep raw
    }
    const alreadySaved = savedUrls.has(canonical);
    let updated: ReviewLink[];
    if (alreadySaved) {
      updated = saved.filter(item => {
        try {
          return canonicalSource(item.url) !== canonical;
        } catch {
          return item.url !== canonical;
        }
      });
      showNotice('Удалено из сохранённых.');
    } else {
      const title = [result.brand, result.name].filter(Boolean).join(' ').slice(0, 180) || result.name;
      updated = [
        ...saved.filter(item => item.url !== result.source),
        { url: result.source, title },
      ].slice(-30);
      showNotice('Сохранено в библиотеке браузера.');
    }
    setSaved(updated);
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(updated));
    } catch {
      // Ignore storage quota errors
    }
  }

  function handleRemoveSaved(url: string) {
    const updated = saved.filter(item => item.url !== url);
    setSaved(updated);
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(updated));
    } catch {
      // Ignore storage quota errors
    }
  }

  function handleToggleCompare(result: SearchResult) {
    setCompareIds(prev => {
      if (prev.includes(result.id)) {
        return prev.filter(id => id !== result.id);
      }
      const next = [...prev, result.id];
      if (next.length >= 2) {
        setCompareTab('matrix');
      } else {
        setCompareTab('side-by-side');
      }
      return next;
    });
  }

  function scrollToComparison(tab?: ComparisonTab) {
    if (tab) setCompareTab(tab);
    requestAnimationFrame(() => {
      document.getElementById('vs-comparison-studio')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  }

  async function handleDownloadLensCopy() {
    if (!photo) return;
    try {
      const copy = await createOptimizedPhoto(photo, crop);
      triggerDownload(copy, copy.name);
      showNotice('Оптимизированная копия для Google Lens скачана.');
    } catch {
      showNotice('Не удалось подготовить копию изображения.');
    }
  }

  function handleDownloadOriginal() {
    if (!photo) return;
    triggerDownload(photo, photo.name);
  }

  async function handleCreateRfq(result: SearchResult) {
    setCreatingRfqId(result.id);
    try {
      const chosenSku = selectedVariants[result.id];
      const chosenVariant = result.variants?.find(item => item.sku === chosenSku);
      const snapshot = projectFromSearch(result, chosenVariant, photo);
      const store = await openProjectStore();
      try {
        await store.save(snapshot);
      } finally {
        store.close();
      }
      window.location.assign(`/?rfqProject=${encodeURIComponent(snapshot.project.id)}`);
    } catch {
      setCreatingRfqId(null);
      showNotice('Не удалось создать проект Quick RFQ.');
    }
  }

  function isResultSaved(result: SearchResult): boolean {
    try {
      return savedUrls.has(canonicalSource(result.source));
    } catch {
      return savedUrls.has(result.source);
    }
  }

  return (
    <div className="lf-shell vs-shell">
      {/* Cohesive LIGHT FORGE Topbar */}
      <header className="lf-topbar vs-topbar">
        <div className="lf-brand-group">
          <a href="/search" className="lf-brand">
            <span className="lf-brand-mark" aria-hidden="true">
              <BrandMarkIcon />
            </span>
            <span className="lf-brand-text">
              <span className="lf-brand-title">LIGHT FORGE</span>
              <span className="lf-brand-sub">Поиск светильников по фото</span>
            </span>
          </a>
        </div>

        <nav className="lf-topbar-actions" aria-label="Разделы LIGHT FORGE">
          <a href="/" className="lf-btn lf-btn--sm">
            Quick RFQ
          </a>
          <a href="/geometry" className="lf-btn lf-btn--sm">
            3D-конструктор
          </a>
          {comparedItems.length > 0 && (
            <button
              id="vs-topbar-compare-btn"
              type="button"
              className="lf-btn lf-btn--sm lf-btn--brass"
              onClick={() => scrollToComparison()}
            >
              <ColumnsIcon size={14} />
              <span>Сравнение · {comparedItems.length}</span>
            </button>
          )}
          <button
            id="vs-settings-btn"
            type="button"
            className="lf-btn lf-btn--sm"
            onClick={() => setSettingsOpen(true)}
          >
            <SlidersIcon size={14} />
            <span>Настройки</span>
          </button>
        </nav>
      </header>

      {/* Live status feedback */}
      {notice && (
        <div className="vs-toast-wrap" role="status" aria-live="polite">
          <div className="vs-toast">{notice}</div>
        </div>
      )}

      <main className="vs-main">
        {/* Centered Hero: Upload + Crop + Search Controls */}
        <section className="vs-hero" aria-labelledby="vs-hero-title">
          <header className="vs-hero-header">
            <h1 id="vs-hero-title" className="vs-hero-title">
              Поиск светильника по фотографии
            </h1>
            <p className="vs-hero-sub">
              Загрузите фото, выделите светильник и найдите оригинал, похожие модели и техпаспорт для запроса фабрике.
            </p>
          </header>

          <div className="vs-studio-card">
            <PhotoCropStage
              photo={photo}
              photoUrl={photoUrl}
              crop={crop}
              cropActive={cropActive}
              onChoosePhoto={choosePhoto}
              onClearPhoto={clearPhoto}
              onCropChange={setCrop}
              onToggleCrop={toggleCrop}
              onDownloadLensCopy={() => void handleDownloadLensCopy()}
              onDownloadOriginal={handleDownloadOriginal}
            />

            <form className="vs-search-bar" onSubmit={handleSearchSubmit}>
              <div className="vs-search-input-wrap">
                <span className="vs-search-input-icon" aria-hidden="true">
                  <SearchIcon size={16} />
                </span>
                <input
                  id="vs-query-input"
                  type="text"
                  className="vs-search-input"
                  aria-label="Название, артикул или видимые признаки светильника"
                  placeholder="Название, артикул или описание (например, Emmemobili MYLINE, ICBA02 или латунные кольца)"
                  value={query}
                  maxLength={240}
                  onChange={event => setQuery(event.target.value)}
                />
              </div>

              <div className="vs-search-controls-row">
                <div
                  className="lf-segment vs-mode-switch"
                  role="group"
                  aria-label="Режим поиска"
                >
                  <button
                    id="vs-mode-standard"
                    type="button"
                    className={`lf-segment-btn ${mode === 'standard' ? 'lf-segment-btn--active' : ''}`}
                    aria-pressed={mode === 'standard'}
                    onClick={() => setMode('standard')}
                  >
                    Быстрый поиск
                  </button>
                  <button
                    id="vs-mode-deep"
                    type="button"
                    className={`lf-segment-btn ${mode === 'deep' ? 'lf-segment-btn--active' : ''}`}
                    aria-pressed={mode === 'deep'}
                    onClick={() => setMode('deep')}
                  >
                    <SparkIcon size={13} />
                    <span>Глубокий поиск</span>
                  </button>
                </div>

                <button
                  id="vs-search-submit"
                  type="submit"
                  className="lf-btn lf-btn--primary vs-search-submit"
                  disabled={loading || (!query.trim() && !photo)}
                >
                  <SearchIcon size={15} />
                  <span>{loading ? 'Ищем светильник…' : 'Найти оригинал и аналоги'}</span>
                </button>
              </div>

              {/* Explicit user consent shown ONLY when server Gemini Free Tier is enabled */}
              {gemini?.enabled && photo && (
                <label className="vs-consent-inline">
                  <input
                    id="vs-gemini-consent"
                    type="checkbox"
                    checked={allowGemini}
                    onChange={event => setAllowGemini(event.target.checked)}
                  />
                  <span>
                    Отправить копию фото в Gemini для этого поиска (оригинал остаётся на вашем устройстве)
                  </span>
                </label>
              )}

              <div className="vs-hero-footer">
                <div className="vs-quick-tools">
                  <button
                    id="vs-open-lens-btn"
                    type="button"
                    className="lf-btn lf-btn--sm lf-btn--subtle"
                    onClick={() => setLensOpen(true)}
                  >
                    <LensIcon size={14} />
                    <span>Google Lens</span>
                  </button>
                  <button
                    id="vs-open-chatgpt-btn"
                    type="button"
                    className="lf-btn lf-btn--sm lf-btn--subtle"
                    onClick={() => {
                      setChatGptFocused(undefined);
                      setChatGptOpen(true);
                    }}
                  >
                    <ChatIcon size={14} />
                    <span>Проверить через ChatGPT</span>
                  </button>
                  {saved.length > 0 && (
                    <button
                      type="button"
                      className="lf-btn lf-btn--sm lf-btn--subtle"
                      onClick={() => handleAddLinks(saved)}
                    >
                      <BookmarkIcon size={13} filled />
                      <span>Сохранённые ({saved.length})</span>
                    </button>
                  )}
                </div>

                {history.length > 0 && (
                  <div className="vs-recent-strip" aria-label="Недавние запросы">
                    <span className="vs-recent-label">Недавние:</span>
                    {history.slice(0, 4).map(term => (
                      <button
                        key={term}
                        type="button"
                        className="vs-recent-chip"
                        onClick={() => {
                          setQuery(term);
                          void runSearch(term, mode);
                        }}
                      >
                        {term}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </form>
          </div>
        </section>

        {/* Results Workspace */}
        {hasResultsArea && (
          <div className="vs-results-flow">
            {/* Honest provenance & verification banner */}
            <div className="vs-status-strip">
              <div className="vs-status-main">
                <ShieldIcon size={16} className="vs-status-icon" />
                <div>
                  <strong>Original not verified</strong>
                  <span>
                    {' '}
                    — запись каталога подтверждает изделие производителя, но совпадение с вашей фотографией требует визуальной проверки по официальной карточке и техпаспорту.
                  </span>
                </div>
              </div>

              {lastResponse && lastResponse.links.length > 0 && (
                <div className="vs-ext-links" aria-label="Поиск по каталогам в Google">
                  <span className="vs-ext-label">Поиск в вебе:</span>
                  {lastResponse.links.map(link => (
                    <a
                      key={link.language}
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                      className="vs-ext-pill"
                    >
                      <span>{formatLanguageLabel(link.language)}</span>
                      <ExternalLinkIcon size={11} />
                    </a>
                  ))}
                </div>
              )}
            </div>

            {lastResponse && lastResponse.traits.length > 0 && (
              <div className="vs-traits-bar">
                <span className="vs-traits-label">Видимые признаки по фото:</span>
                <div className="vs-traits-list">
                  {lastResponse.traits.map(trait => (
                    <span key={trait} className="lf-badge lf-badge--accent">
                      {trait}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {geminiWarningText && (
              <div className="vs-warning-banner" role="status">
                <AlertIcon size={16} />
                <span>{geminiWarningText}</span>
              </div>
            )}

            {/* Empty / No results state */}
            {results.length === 0 ? (
              <section className="vs-empty-results" aria-live="polite">
                <h2>Совпадений в каталоге пока не найдено</h2>
                <p>
                  Уточните название, артикул или материалы светильника, переключитесь на глубокий поиск или найдите страницу товара через Google Lens и добавьте ссылку сюда.
                </p>
                <div className="vs-empty-actions">
                  {mode === 'standard' && (
                    <button
                      type="button"
                      className="lf-btn lf-btn--primary"
                      onClick={() => {
                        setMode('deep');
                        void runSearch(query, 'deep');
                      }}
                    >
                      <SparkIcon size={14} />
                      <span>Попробовать глубокий поиск</span>
                    </button>
                  )}
                  <button type="button" className="lf-btn" onClick={() => setLensOpen(true)}>
                    <LensIcon size={14} />
                    <span>Открыть Google Lens</span>
                  </button>
                  <button
                    type="button"
                    className="lf-btn"
                    onClick={() => {
                      setChatGptFocused(undefined);
                      setChatGptOpen(true);
                    }}
                  >
                    <ChatIcon size={14} />
                    <span>Проверить через ChatGPT</span>
                  </button>
                </div>
              </section>
            ) : (
              <>
                {/* 1. ОРИГИНАЛ */}
                <section className="vs-section" aria-labelledby="vs-sec-originals">
                  <div className="vs-section-head">
                    <div>
                      <span className="vs-section-eyebrow">01 · Оригинал</span>
                      <h2 id="vs-sec-originals" className="vs-section-title">
                        Оригинал
                        <span className="vs-count-pill">{sections.originals.length}</span>
                      </h2>
                      <p className="vs-section-desc">
                        Подтверждённый бренд, коллекция и официальная модель из каталога производителя.
                      </p>
                    </div>
                  </div>

                  {sections.originals.length > 0 ? (
                    <div
                      className={`vs-cards-grid ${sections.originals.length === 1 ? 'vs-cards-grid--single' : ''}`}
                    >
                      {sections.originals.map(item => (
                        <ResultCard
                          key={item.id}
                          result={item}
                          selectedSku={selectedVariants[item.id] ?? ''}
                          isCompared={compareIds.includes(item.id)}
                          isSaved={isResultSaved(item)}
                          creatingRfq={creatingRfqId === item.id}
                          featured={sections.originals.length === 1}
                          onSelectSku={sku =>
                            setSelectedVariants(prev => ({ ...prev, [item.id]: sku }))
                          }
                          onToggleCompare={handleToggleCompare}
                          onFindSimilar={handleFindSimilar}
                          onToggleSave={handleToggleSave}
                          onReviewChatGpt={target => {
                            setChatGptFocused(target);
                            setChatGptOpen(true);
                          }}
                          onCreateRfq={target => void handleCreateRfq(target)}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="vs-section-quiet">
                      <span>
                        Подтверждённая запись оригинала не найдена. Если вы нашли официальную карточку через Google Lens или ChatGPT — вставьте ссылку для проверки.
                      </span>
                      <button
                        type="button"
                        className="lf-btn lf-btn--sm"
                        onClick={() => setLensOpen(true)}
                      >
                        Добавить ссылку
                      </button>
                    </div>
                  )}
                </section>

                {/* 2. ТОЧНЫЕ СОВПАДЕНИЯ */}
                {[
                  { id: 'exact', title: 'Точные совпадения', description: 'Та же модель на разных сайтах.', items: sections.exactMatches },
                  { id: 'unverified', title: 'Ссылки на проверку', description: 'Источники из Google Lens и ChatGPT требуют сверки.', items: sections.unverified },
                ].filter(group => group.id === 'exact' || group.items.length > 0).map(group => (
                  <section key={group.id} className="vs-section" aria-labelledby={`vs-sec-${group.id}`}>
                    <div className="vs-section-head">
                      <div>
                        <h2 id={`vs-sec-${group.id}`} className="vs-section-title">
                          {group.title}
                          <span className="vs-count-pill">{group.items.length}</span>
                        </h2>
                        <p className="vs-section-desc">
                          {group.description}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="lf-btn lf-btn--sm"
                        onClick={() => setLensOpen(true)}
                      >
                        <LensIcon size={13} />
                        <span>Добавить ссылки из Lens</span>
                      </button>
                    </div>

                    {group.items.length > 0 ? (
                      <div className="vs-cards-grid">
                        {group.items.map(item => (
                          <ResultCard
                            key={item.id}
                            result={item}
                            selectedSku={selectedVariants[item.id] ?? ''}
                            isCompared={compareIds.includes(item.id)}
                            isSaved={isResultSaved(item)}
                            creatingRfq={creatingRfqId === item.id}
                            onSelectSku={sku =>
                              setSelectedVariants(prev => ({ ...prev, [item.id]: sku }))
                            }
                            onToggleCompare={handleToggleCompare}
                            onFindSimilar={handleFindSimilar}
                            onToggleSave={handleToggleSave}
                            onReviewChatGpt={target => {
                              setChatGptFocused(target);
                              setChatGptOpen(true);
                            }}
                            onCreateRfq={target => void handleCreateRfq(target)}
                          />
                      ))}
                    </div>
                  ) : (
                    <div className="vs-section-quiet">
                      <span>
                        Точных совпадений пока нет. Найдите страницу модели через Google Lens или ChatGPT и добавьте ссылку на проверку.
                      </span>
                      <button
                        type="button"
                        className="lf-btn lf-btn--sm lf-btn--subtle"
                        onClick={() => {
                          setChatGptFocused(sections.originals[0]);
                          setChatGptOpen(true);
                        }}
                      >
                        Импорт из ChatGPT
                      </button>
                    </div>
                  )}
                </section>
                ))}

                {/* 3. ПОХОЖИЕ МОДЕЛИ */}
                <section className="vs-section" aria-labelledby="vs-sec-similar">
                  <div className="vs-section-head">
                    <div>
                      <span className="vs-section-eyebrow">03 · Похожие модели</span>
                      <h2 id="vs-sec-similar" className="vs-section-title">
                        Похожие модели
                        <span className="vs-count-pill">{sections.similarModels.length}</span>
                      </h2>
                      <p className="vs-section-desc">
                        Визуальные и конструктивные аналоги других серий и производителей.
                      </p>
                    </div>
                    {sections.similarModels.length === 0 && sections.originals[0] && (
                      <button
                        type="button"
                        className="lf-btn lf-btn--sm"
                        onClick={() => handleFindSimilar(sections.originals[0])}
                      >
                        <SparkIcon size={13} />
                        <span>Искать аналоги в глубоком поиске</span>
                      </button>
                    )}
                  </div>

                  {sections.similarModels.length > 0 ? (
                    <div className="vs-cards-grid">
                      {sections.similarModels.map(item => (
                        <ResultCard
                          key={item.id}
                          result={item}
                          selectedSku={selectedVariants[item.id] ?? ''}
                          isCompared={compareIds.includes(item.id)}
                          isSaved={isResultSaved(item)}
                          creatingRfq={creatingRfqId === item.id}
                          onSelectSku={sku =>
                            setSelectedVariants(prev => ({ ...prev, [item.id]: sku }))
                          }
                          onToggleCompare={handleToggleCompare}
                          onFindSimilar={handleFindSimilar}
                          onToggleSave={handleToggleSave}
                          onReviewChatGpt={target => {
                            setChatGptFocused(target);
                            setChatGptOpen(true);
                          }}
                          onCreateRfq={target => void handleCreateRfq(target)}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="vs-section-quiet">
                      <span>
                        В быстром поиске показан только прямой результат. Включите глубокий поиск или нажмите «Найти похожие» на карточке.
                      </span>
                      {sections.originals[0] && (
                        <button
                          type="button"
                          className="lf-btn lf-btn--sm"
                          onClick={() => handleFindSimilar(sections.originals[0])}
                        >
                          Найти похожие
                        </button>
                      )}
                    </div>
                  )}
                </section>

                {/* 4. ТЕХНИЧЕСКАЯ ДОКУМЕНТАЦИЯ */}
                <section className="vs-section" aria-labelledby="vs-sec-docs">
                  <div className="vs-section-head">
                    <div>
                      <span className="vs-section-eyebrow">04 · Техническая документация</span>
                      <h2 id="vs-sec-docs" className="vs-section-title">
                        Техническая документация
                        <span className="vs-count-pill">{sections.documentation.length}</span>
                      </h2>
                      <p className="vs-section-desc">
                        Официальные PDF-листы, подтверждённые габариты в миллиметрах, материалы и светотехнические параметры.
                      </p>
                    </div>
                  </div>

                  {sections.documentation.length > 0 ? (
                    <div className="vs-docs-list">
                      {sections.documentation.map(item => {
                        const chosenSku = selectedVariants[item.id] ?? '';
                        const chosenVariant = item.variants?.find(v => v.sku === chosenSku);
                        const specs = readResultSpecifications(item);
                        const lightConfigs = filterLightingConfigurations(
                          specs,
                          chosenVariant?.widthMm,
                        );
                        return (
                          <article key={item.id} className="vs-doc-card">
                            <div className="vs-doc-head">
                              <div>
                                <span className="vs-card-eyebrow">
                                  {item.brand ?? extractDisplayHost(item.source)}
                                </span>
                                <h3 className="vs-doc-title">{item.name}</h3>
                                {item.details && <p className="vs-doc-details">{item.details}</p>}
                              </div>

                              <div className="vs-doc-head-actions">
                                {item.documentUrl && (
                                  <a
                                    href={item.documentUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="lf-btn lf-btn--sm lf-btn--primary"
                                  >
                                    <FilePdfIcon size={14} />
                                    <span>Открыть PDF техпаспорт</span>
                                  </a>
                                )}
                                <a
                                  href={item.source}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="lf-btn lf-btn--sm"
                                >
                                  <ExternalLinkIcon size={13} />
                                  <span>Карточка производителя</span>
                                </a>
                              </div>
                            </div>

                            {item.variants && item.variants.length > 0 && (
                              <div className="vs-doc-table-wrap">
                                <table className="vs-doc-table">
                                  <thead>
                                    <tr>
                                      <th>Артикул</th>
                                      <th>Ширина</th>
                                      <th>Глубина</th>
                                      <th>Высота</th>
                                      <th>Диммирование</th>
                                      <th>Статус</th>
                                      <th aria-label="Выбор для RFQ" />
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {item.variants.map(variant => {
                                      const active = chosenSku === variant.sku;
                                      return (
                                        <tr
                                          key={variant.sku}
                                          className={active ? 'vs-doc-row--active' : ''}
                                        >
                                          <td className="mono">
                                            <strong>{variant.sku}</strong>
                                          </td>
                                          <td className="mono">{variant.widthMm} мм</td>
                                          <td className="mono">{variant.depthMm} мм</td>
                                          <td className="mono">{variant.heightMm} мм</td>
                                          <td>{item.confirmedDimming ?? 'На подтверждение'}</td>
                                          <td>
                                            <span className="lf-badge lf-badge--documentation">
                                              По техпаспорту
                                            </span>
                                          </td>
                                          <td className="vs-doc-cell-action">
                                            <button
                                              type="button"
                                              className={`lf-btn lf-btn--sm ${active ? 'lf-btn--primary' : ''}`}
                                              onClick={() =>
                                                setSelectedVariants(prev => ({
                                                  ...prev,
                                                  [item.id]: variant.sku,
                                                }))
                                              }
                                            >
                                              {active ? 'Выбран для RFQ' : 'Выбрать'}
                                            </button>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}

                            {specs && (
                              <div className="vs-doc-specs">
                                <div className="vs-doc-specs-grid">
                                  {specs.materials && specs.materials.length > 0 && (
                                    <div className="vs-doc-spec-block">
                                      <strong>Материалы по деталям</strong>
                                      <span>
                                        {specs.materials.map(m => `${m.part}: ${m.material}`).join(' · ')}
                                      </span>
                                    </div>
                                  )}
                                  {specs.finishes && specs.finishes.length > 0 && (
                                    <div className="vs-doc-spec-block">
                                      <strong>Варианты отделок (техпаспорт)</strong>
                                      <span>
                                        {specs.finishes
                                          .map(f => `${f.part} ${f.code} (${f.name})`)
                                          .join(' · ')}
                                      </span>
                                    </div>
                                  )}
                                  {(specs.dimensionsReferTo || specs.standardMaxBandLengthMm) && (
                                    <div className="vs-doc-spec-block">
                                      <strong>Точка отсчёта и подвес</strong>
                                      <span>
                                        {[
                                          specs.dimensionsReferTo
                                            ? `Размеры: ${specs.dimensionsReferTo}`
                                            : undefined,
                                          specs.standardMaxBandLengthMm
                                            ? `Макс. стандартная длина ремня: ${specs.standardMaxBandLengthMm} мм`
                                            : undefined,
                                        ]
                                          .filter(Boolean)
                                          .join(' · ')}
                                      </span>
                                    </div>
                                  )}
                                </div>

                                {specs.lighting && lightConfigs.length > 0 && (
                                  <>
                                    <span className="vs-doc-subhead">
                                      Световые конфигурации из техпаспорта ({specs.lighting.sourceType}{' '}
                                      {specs.lighting.sourceVoltageV} В
                                      {chosenVariant ? ` · фильтр по кольцу ${chosenVariant.widthMm} мм` : ''})
                                    </span>
                                    <div className="vs-doc-table-wrap">
                                      <table className="vs-doc-table">
                                        <thead>
                                          <tr>
                                            <th>Ширина кольца</th>
                                            <th>Направление</th>
                                            <th>Мощность</th>
                                            <th>Световой поток (CCT)</th>
                                            <th>Вес нетто</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {lightConfigs.map(cfg => (
                                            <tr key={`${cfg.ringWidthMm}-${cfg.direction}`}>
                                              <td className="mono">{cfg.ringWidthMm} мм</td>
                                              <td>{formatLightDirection(cfg.direction)}</td>
                                              <td className="mono">{cfg.powerW} Вт</td>
                                              <td className="mono">
                                                {cfg.outputs
                                                  .map(o => `${o.cctK}K: ${o.lumens} Лм`)
                                                  .join(' · ')}
                                              </td>
                                              <td className="mono">{cfg.netWeightKg} кг</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </>
                                )}
                              </div>
                            )}

                            <div className="vs-doc-foot">
                              <span className="vs-doc-foot-note">
                                Привязка направления света и мощности к артикулу, а также цена и окончательная отделка подтверждаются фабрикой в RFQ.
                              </span>
                              <button
                                type="button"
                                className="lf-btn lf-btn--sm lf-btn--brass"
                                disabled={creatingRfqId === item.id}
                                onClick={() => void handleCreateRfq(item)}
                              >
                                <LayersIcon size={13} />
                                <span>
                                  {chosenSku
                                    ? `Создать запрос фабрике (${chosenSku})`
                                    : 'Создать запрос фабрике'}
                                </span>
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="vs-section-quiet">
                      <span>
                        Для текущих ссылок официальные PDF и размеры в каталоге не прикреплены. Проверьте первоисточник производителя или откройте запрос фабрике для уточнения чертежей.
                      </span>
                    </div>
                  )}
                </section>
              </>
            )}

            {/* Comparison Studio */}
            <ComparisonStudio
              items={comparedItems}
              allResults={results}
              selectedVariants={selectedVariants}
              photo={photo}
              photoUrl={photoUrl}
              crop={crop}
              activeTab={compareTab}
              creatingRfqId={creatingRfqId}
              onTabChange={setCompareTab}
              onSelectSku={(resultId, sku) =>
                setSelectedVariants(prev => ({ ...prev, [resultId]: sku }))
              }
              onToggleCompare={handleToggleCompare}
              onClearCompare={() => setCompareIds([])}
              onCreateRfq={target => void handleCreateRfq(target)}
              onRequestUpload={() => {
                document.getElementById('vs-photo-input')?.click();
              }}
            />
          </div>
        )}
      </main>

      {/* Sticky Comparison Dock when models are selected and studio is offscreen */}
      {comparedItems.length > 0 && !compareInView && (
        <div className="vs-compare-dock" role="region" aria-label="Панель сравнения">
          <div className="vs-compare-dock-inner">
            <div className="vs-compare-dock-info">
              <ColumnsIcon size={15} />
              <strong>Сравнение ({comparedItems.length}):</strong>
              <span className="vs-compare-dock-names">
                {comparedItems.map(item => item.name).join(' · ')}
              </span>
            </div>
            <div className="vs-compare-dock-actions">
              <button
                type="button"
                className="lf-btn lf-btn--sm"
                onClick={() => scrollToComparison('side-by-side')}
              >
                Фото рядом
              </button>
              <button
                type="button"
                className="lf-btn lf-btn--sm lf-btn--primary"
                onClick={() => scrollToComparison('matrix')}
              >
                Сравнить характеристики
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clean Slide-over Drawers */}
      <SettingsDrawer
        open={settingsOpen}
        gemini={gemini}
        allowGemini={allowGemini}
        saved={saved}
        history={history}
        onClose={() => setSettingsOpen(false)}
        onToggleAllowGemini={setAllowGemini}
        onImportSaved={() => handleAddLinks(saved)}
        onRemoveSaved={handleRemoveSaved}
        onPickHistory={term => {
          setQuery(term);
          void runSearch(term, mode);
        }}
        onClearHistory={() => {
          setHistory([]);
          try {
            localStorage.removeItem(HISTORY_KEY);
          } catch {
            // Ignore
          }
        }}
      />

      <LensDrawer
        open={lensOpen}
        hasPhoto={Boolean(photo)}
        onClose={() => setLensOpen(false)}
        onDownloadLensCopy={() => void handleDownloadLensCopy()}
        onDownloadOriginal={handleDownloadOriginal}
        onAddLinks={handleAddLinks}
      />

      <ChatGptDrawer
        open={chatGptOpen}
        query={query}
        results={results}
        focusedResult={chatGptFocused}
        onClose={() => setChatGptOpen(false)}
        onAddLinks={handleAddLinks}
        onExportPrompt={text => {
          triggerDownload(new Blob([text], { type: 'text/plain;charset=utf-8' }), 'light-forge-review.txt');
          showNotice('Задание для проверки сохранено в light-forge-review.txt.');
        }}
      />
    </div>
  );
}
