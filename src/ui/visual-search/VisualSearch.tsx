'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { openProjectStore } from '@/storage/projects';
import {
  canonicalSource,
  catalogueSearch,
  importReviewLinks,
  searchResponseSchema,
  type ReviewLink,
  type SearchInput,
  type SearchResponse,
  type SearchResult,
  type SearchUsage,
} from '@/visual-search/catalogue';
import {
  localSearchCapabilitiesSchema,
  localSearchResponseSchema,
} from '@/visual-search/local-contract';
import {
  AlertIcon,
  BookmarkIcon,
  BrandMarkIcon,
  ChatIcon,
  ColumnsIcon,
  ExternalLinkIcon,
  EyeIcon,
  FilePdfIcon,
  LayersIcon,
  LensIcon,
  RefreshIcon,
  SearchIcon,
  ShieldIcon,
  SlidersIcon,
  SparkIcon,
  StarIcon,
} from '../icons';
import { ComparisonStudio, type ComparisonTab } from './ComparisonStudio';
import {
  buildRfqSnapshotFromSearch,
  buildSimilarQuery,
  clampZoom,
  DEFAULT_RESULT_FILTERS,
  extractDisplayHost,
  extractFilterOptions,
  filterAndSortResults,
  filterLightingConfigurations,
  formatGeminiWarning,
  formatLanguageLabel,
  formatLightDirection,
  formatTransformSummary,
  FULL_CROP,
  groupSearchResults,
  isDefaultResultFilters,
  isFullCrop,
  isTransformDefault,
  mergeSearchResults,
  readResultSpecifications,
  resolveLocalMatchResult,
  rotateCropRect,
  rotateDegrees,
  shouldUseOriginalForLocalSearch,
  validateIncomingPhotos,
  type CropRect,
  type LocalSearchCapabilities,
  type LocalSearchResponse,
  type ResultFilterState,
  type ResultViewMode,
  type RotationDeg,
  type SearchPhotoItem,
} from './helpers';
import { createWorkingPhotoCopy } from './image-processing';
import { HISTORY_KEY, SAVED_KEY, readHistory, readSavedLinks } from './local-history';
import { LocalMatchesSection } from './LocalMatchesSection';
import { PhotoCropStage } from './PhotoCropStage';
import { ProductDetailView } from './ProductDetailView';
import { ResultCard } from './ResultCard';
import { ResultsTableView } from './ResultsTableView';
import { ResultsToolbar } from './ResultsToolbar';
import { ChatGptDrawer, LensDrawer, SettingsDrawer } from './VisualSearchDrawers';

const INITIAL_ACTIVE_CROP: CropRect = { x: 14, y: 10, width: 72, height: 78 };

type SearchRunContext = {
  query: string;
  mode: SearchInput['mode'];
  photoId?: string;
  photoName?: string;
  photoTransform?: string;
  photoCropKey?: string;
  photoRotation?: RotationDeg;
  usedWorkingCopy: boolean;
  photoCount: number;
  ranLocalIndex: boolean;
  ranGemini: boolean;
};

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

function cropKey(crop: CropRect): string {
  return `${crop.x},${crop.y},${crop.width},${crop.height}`;
}

export function VisualSearch() {
  // Multi-photo gallery state (originals are never overwritten)
  const [photos, setPhotos] = useState<SearchPhotoItem[]>([]);
  const [primaryPhotoId, setPrimaryPhotoId] = useState<string | null>(null);
  const [activePhotoId, setActivePhotoId] = useState<string | null>(null);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const photoUrlCacheRef = useRef<Map<string, { file: File; url: string }>>(new Map());

  // Search controls
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchInput['mode']>('standard');
  const [gemini, setGemini] = useState<SearchUsage | undefined>();
  const [localCapabilities, setLocalCapabilities] = useState<LocalSearchCapabilities | undefined>();
  const [allowGemini, setAllowGemini] = useState(false);

  // Real API results, local photo matches, imported links, library & history
  const [lastResponse, setLastResponse] = useState<SearchResponse | undefined>();
  const [localResponse, setLocalResponse] = useState<LocalSearchResponse | undefined>();
  const [localUsedCrop, setLocalUsedCrop] = useState(false);
  const [lastSearchContext, setLastSearchContext] = useState<SearchRunContext | undefined>();
  const [imported, setImported] = useState<SearchResult[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [saved, setSaved] = useState<ReviewLink[]>([]);

  // Filtering, sorting, view mode & product detail view
  const [filters, setFilters] = useState<ResultFilterState>(DEFAULT_RESULT_FILTERS);
  const [viewMode, setViewMode] = useState<ResultViewMode>('grid');
  const [detailResultId, setDetailResultId] = useState<string | null>(null);
  const [directDetailResult, setDirectDetailResult] = useState<SearchResult | undefined>();

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
  const localCapabilitiesRequest = useRef<Promise<LocalSearchCapabilities | undefined> | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const primaryPhoto = useMemo(
    () => photos.find(item => item.id === primaryPhotoId) ?? photos[0],
    [photos, primaryPhotoId],
  );
  const activePhoto = useMemo(
    () => photos.find(item => item.id === activePhotoId) ?? primaryPhoto,
    [photos, activePhotoId, primaryPhoto],
  );

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    if (message) {
      noticeTimerRef.current = setTimeout(() => setNotice(''), 4400);
    }
  }, []);

  // Maintain stable Object URLs for uploaded original files without leaking memory
  useEffect(() => {
    const cache = photoUrlCacheRef.current;
    const nextIds = new Set(photos.map(item => item.id));
    const nextUrls: Record<string, string> = {};

    for (const item of photos) {
      const existing = cache.get(item.id);
      if (existing && existing.file === item.file) {
        nextUrls[item.id] = existing.url;
      } else {
        if (existing) URL.revokeObjectURL(existing.url);
        const url = URL.createObjectURL(item.file);
        cache.set(item.id, { file: item.file, url });
        nextUrls[item.id] = url;
      }
    }

    for (const [id, entry] of cache.entries()) {
      if (!nextIds.has(id)) {
        URL.revokeObjectURL(entry.url);
        cache.delete(id);
      }
    }

    setPhotoUrls(nextUrls);
  }, [photos]);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const requestedQuery = urlParams.get('q');
    const requestedModel = urlParams.get('model');
    if (requestedQuery) setQuery(requestedQuery.slice(0, 240));
    if (requestedModel) {
      // Allow opening a documented starter catalogue model directly by ?model=<id>
      const starterMatches = catalogueSearch('ring', 'deep');
      const direct = starterMatches.find(item => item.id === requestedModel);
      if (direct) {
        setDirectDetailResult(direct);
        setDetailResultId(direct.id);
      }
    }
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

    localCapabilitiesRequest.current = fetch('/api/visual-search/local', {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
    })
      .then(response => (response.ok ? response.json() : null))
      .then(data => {
        if (controller.signal.aborted || !data) return;
        const parsed = localSearchCapabilitiesSchema.safeParse(data);
        if (parsed.success) {
          setLocalCapabilities(parsed.data);
          return parsed.data;
        }
      })
      .catch(() => undefined);

    const onPopState = () => {
      const modelId = new URLSearchParams(window.location.search).get('model');
      setDetailResultId(modelId);
    };
    window.addEventListener('popstate', onPopState);

    const urlCache = photoUrlCacheRef.current;
    return () => {
      window.removeEventListener('popstate', onPopState);
      controller.abort();
      searchAbortRef.current?.abort();
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
      for (const entry of urlCache.values()) {
        URL.revokeObjectURL(entry.url);
      }
      urlCache.clear();
    };
  }, []);

  const addPhotos = useCallback(
    (incoming: FileList | File[] | null, source: 'upload' | 'clipboard' = 'upload') => {
      if (!incoming) return;
      const list = Array.from(incoming);
      if (list.length === 0) return;

      const { accepted, errors } = validateIncomingPhotos(
        photos.map(item => item.file),
        list,
        source,
      );

      if (accepted.length > 0) {
        const created: SearchPhotoItem[] = accepted.map(file => ({
          id: crypto.randomUUID(),
          file,
          crop: FULL_CROP,
          rotation: 0,
          zoom: 1,
          cropActive: false,
        }));

        setAllowGemini(false);
        setPhotos(prev => [...prev, ...created]);
        setActivePhotoId(created[0].id);
        setPrimaryPhotoId(prev => prev ?? created[0].id);

        if (errors.length > 0) {
          showNotice(`${errors[0]} (добавлено фото: ${created.length})`);
        } else if (source === 'clipboard') {
          showNotice(
            created.length === 1
              ? `Вставлено фото из буфера: ${created[0].file.name}`
              : `Вставлено фото из буфера: ${created.length}`,
          );
        } else {
          showNotice(
            created.length === 1
              ? `Загружено фото: ${created[0].file.name}`
              : `Загружено фотографий: ${created.length}`,
          );
        }
      } else if (errors.length > 0) {
        showNotice(errors[0]);
      }
    },
    [photos, showNotice],
  );

  // Global clipboard paste handler (Ctrl+V / Cmd+V) for images
  useEffect(() => {
    function handleWindowPaste(event: ClipboardEvent) {
      const clipboard = event.clipboardData;
      if (!clipboard) return;
      const imageFiles: File[] = [];
      for (const item of Array.from(clipboard.items ?? [])) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
      if (imageFiles.length === 0 && clipboard.files?.length) {
        for (const file of Array.from(clipboard.files)) {
          if (file.type.startsWith('image/')) imageFiles.push(file);
        }
      }
      if (imageFiles.length > 0) {
        event.preventDefault();
        addPhotos(imageFiles, 'clipboard');
      }
    }

    window.addEventListener('paste', handleWindowPaste);
    return () => window.removeEventListener('paste', handleWindowPaste);
  }, [addPhotos]);

  const handlePasteFromClipboard = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.read) {
      showNotice('Нажмите Ctrl+V / ⌘V на странице, чтобы вставить изображение из буфера.');
      return;
    }
    try {
      const items = await navigator.clipboard.read();
      const files: File[] = [];
      let index = photos.length + 1;
      for (const item of items) {
        const mime = item.types.find(
          type => type === 'image/png' || type === 'image/jpeg' || type === 'image/webp',
        );
        if (!mime) continue;
        const blob = await item.getType(mime);
        const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
        files.push(new File([blob], `clipboard-photo-${index}.${ext}`, { type: mime }));
        index += 1;
      }
      if (files.length === 0) {
        showNotice('В буфере обмена не найдено изображение JPEG, PNG или WebP.');
        return;
      }
      addPhotos(files, 'clipboard');
    } catch {
      showNotice('Браузер ограничил чтение буфера — нажмите Ctrl+V / ⌘V на странице.');
    }
  }, [addPhotos, photos.length, showNotice]);

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

  const isResultSaved = useCallback(
    (result: SearchResult): boolean => {
      try {
        return savedUrls.has(canonicalSource(result.source));
      } catch {
        return savedUrls.has(result.source);
      }
    },
    [savedUrls],
  );

  const results = useMemo(
    () => mergeSearchResults(lastResponse?.results ?? [], imported),
    [lastResponse, imported],
  );

  const filterOptions = useMemo(() => extractFilterOptions(results), [results]);

  const filteredResults = useMemo(
    () => filterAndSortResults(results, filters, isResultSaved),
    [results, filters, isResultSaved],
  );

  const sections = useMemo(() => groupSearchResults(filteredResults), [filteredResults]);

  const localMatchesByResultId = useMemo(() => {
    const map = new Map<string, LocalSearchResponse['matches'][number]>();
    for (const match of localResponse?.matches ?? []) {
      const linked = resolveLocalMatchResult(match);
      if (linked && !map.has(linked.id)) {
        map.set(linked.id, match);
      }
    }
    return map;
  }, [localResponse]);

  const localLinkedResults = useMemo(() => {
    const map = new Map<string, SearchResult>();
    for (const match of localResponse?.matches ?? []) {
      const linked = resolveLocalMatchResult(match);
      if (linked && !map.has(linked.id)) {
        map.set(linked.id, linked);
      }
    }
    return [...map.values()];
  }, [localResponse]);

  const allComparableResults = useMemo(
    () => mergeSearchResults(results, localLinkedResults),
    [results, localLinkedResults],
  );

  const documentationItems = useMemo(
    () =>
      mergeSearchResults(
        sections.documentation,
        groupSearchResults(localLinkedResults).documentation,
      ),
    [sections.documentation, localLinkedResults],
  );

  const comparedItems = useMemo(
    () =>
      compareIds
        .map(id => allComparableResults.find(item => item.id === id))
        .filter((item): item is SearchResult => Boolean(item)),
    [compareIds, allComparableResults],
  );

  const detailResult = useMemo(() => {
    if (!detailResultId) return undefined;
    return (
      allComparableResults.find(item => item.id === detailResultId) ??
      (directDetailResult?.id === detailResultId ? directDetailResult : undefined)
    );
  }, [detailResultId, allComparableResults, directDetailResult]);

  useEffect(() => {
    if (comparedItems.length === 0 || detailResult) {
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
  }, [comparedItems.length, detailResult]);

  const hasLocalMatches = (localResponse?.matches.length ?? 0) > 0;
  const hasResultsArea = Boolean(lastResponse || localResponse || imported.length > 0);
  const hasAnyMatches = results.length > 0 || hasLocalMatches;
  const geminiWarningText = formatGeminiWarning(lastResponse?.warning);

  const isPhotoContextStale = Boolean(
    lastSearchContext &&
      primaryPhoto &&
      (lastSearchContext.photoId !== primaryPhoto.id ||
        lastSearchContext.photoRotation !== primaryPhoto.rotation ||
        lastSearchContext.photoCropKey !== cropKey(primaryPhoto.crop)),
  );

  function handleSetPrimaryPhoto(id: string) {
    const target = photos.find(item => item.id === id);
    if (!target) return;
    setAllowGemini(false);
    setPrimaryPhotoId(id);
    setActivePhotoId(id);
    showNotice(`Основное фото для поиска: ${target.file.name}`);
  }

  function handleRemovePhoto(id: string) {
    const remaining = photos.filter(item => item.id !== id);
    setPhotos(remaining);
    setAllowGemini(false);

    if (remaining.length === 0) {
      searchAbortRef.current?.abort();
      setLoading(false);
      setPrimaryPhotoId(null);
      setActivePhotoId(null);
      setLocalResponse(undefined);
      setLocalUsedCrop(false);
      return;
    }

    const nextPrimary = primaryPhotoId === id ? remaining[0].id : primaryPhotoId;
    setPrimaryPhotoId(nextPrimary);
    if (activePhotoId === id) {
      setActivePhotoId(nextPrimary ?? remaining[0].id);
    }
  }

  function updatePhotoItem(id: string, updater: (item: SearchPhotoItem) => SearchPhotoItem) {
    setPhotos(prev => prev.map(item => (item.id === id ? updater(item) : item)));
    if (id === primaryPhoto?.id) {
      setAllowGemini(false);
    }
  }

  function handleCropChange(id: string, nextCrop: CropRect) {
    updatePhotoItem(id, item => ({ ...item, crop: nextCrop }));
  }

  function handleToggleCrop(id: string) {
    updatePhotoItem(id, item => ({
      ...item,
      crop: !item.cropActive && isFullCrop(item.crop) ? INITIAL_ACTIVE_CROP : item.crop,
      cropActive: !item.cropActive,
    }));
  }

  function handleRotatePhoto(id: string, delta: 90 | -90) {
    updatePhotoItem(id, item => ({
      ...item,
      rotation: rotateDegrees(item.rotation, delta),
      crop: rotateCropRect(item.crop, delta),
    }));
  }

  function handleZoomChange(id: string, nextZoom: number) {
    setPhotos(prev =>
      prev.map(item => (item.id === id ? { ...item, zoom: clampZoom(nextZoom) } : item)),
    );
  }

  function handleResetTransform(id: string) {
    updatePhotoItem(id, item => ({
      ...item,
      crop: FULL_CROP,
      rotation: 0,
      zoom: 1,
      cropActive: false,
    }));
  }

  const openDetailView = useCallback((result: SearchResult) => {
    setDetailResultId(result.id);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('model', result.id);
      window.history.pushState({ model: result.id }, '', url);
    } catch {
      // Ignore history API issues
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const closeDetailView = useCallback(() => {
    setDetailResultId(null);
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has('model')) {
        url.searchParams.delete('model');
        window.history.replaceState(window.history.state, '', url);
      }
    } catch {
      // Ignore history API issues
    }
  }, []);

  const runSearch = useCallback(
    async (
      targetQuery = query,
      targetMode = mode,
      photoConsent = false,
      runLocalPhoto = false,
    ) => {
      const searchPhoto = primaryPhoto;
      if (!targetQuery.trim() && !searchPhoto) return;

      searchAbortRef.current?.abort();
      const controller = new AbortController();
      searchAbortRef.current = controller;

      setLoading(true);
      setNotice('');
      setDetailResultId(null);
      setFilters(DEFAULT_RESULT_FILTERS);
      // Gemini photo consent is strictly single-use per main form submission (PR #13).
      setAllowGemini(false);

      let ranLocalIndex = false;
      let usedWorkingCopy = false;

      try {
        const shouldRunGemini = Boolean(gemini?.enabled && photoConsent && searchPhoto);

        // Local photo search runs offline without external AI APIs or Gemini consent.
        const localTask = (async () => {
          if (!runLocalPhoto || !searchPhoto) return;
          const available =
            localCapabilities?.available ?? (await localCapabilitiesRequest.current)?.available;
          if (!available || controller.signal.aborted) return;

          const useOriginal = shouldUseOriginalForLocalSearch(
            searchPhoto.file,
            searchPhoto.crop,
            searchPhoto.rotation,
          );
          const localFile = useOriginal
            ? searchPhoto.file
            : await createWorkingPhotoCopy(
                searchPhoto.file,
                searchPhoto.crop,
                searchPhoto.rotation,
              );
          if (controller.signal.aborted) return;

          ranLocalIndex = true;
          usedWorkingCopy = usedWorkingCopy || !useOriginal;

          const form = new FormData();
          form.set(
            'input',
            JSON.stringify({
              photo: {
                id: 'query',
                name: localFile.name,
                type: localFile.type,
                size: localFile.size,
              },
            }),
          );
          form.set('photo:query', localFile, localFile.name);

          const res = await fetch('/api/visual-search/local', {
            method: 'POST',
            body: form,
            signal: controller.signal,
          });
          if (controller.signal.aborted) return;
          if (res.status === 503) {
            setLocalCapabilities({ available: false, referenceCount: 0 });
            setLocalResponse(undefined);
            setLocalUsedCrop(false);
            ranLocalIndex = false;
            return;
          }
          if (!res.ok) {
            throw new Error('Локальный фотопоиск не смог обработать изображение.');
          }
          const parsedLocal = localSearchResponseSchema.parse(await res.json());
          if (controller.signal.aborted) return;
          setLocalResponse(parsedLocal);
          setLocalUsedCrop(!useOriginal);
        })();

        const mainTask = (async () => {
          const input: SearchInput = {
            query: targetQuery,
            mode: targetMode,
            runGemini: shouldRunGemini,
          };

          let requestInit: RequestInit;
          if (shouldRunGemini && searchPhoto) {
            const copy = await createWorkingPhotoCopy(
              searchPhoto.file,
              searchPhoto.crop,
              searchPhoto.rotation,
            );
            if (controller.signal.aborted) return;
            usedWorkingCopy = true;
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
        })();

        const [mainOutcome, localOutcome] = await Promise.allSettled([mainTask, localTask]);
        if (controller.signal.aborted) return;

        if (mainOutcome.status === 'rejected' && localOutcome.status === 'rejected') {
          throw mainOutcome.reason;
        }
        if (mainOutcome.status === 'rejected') {
          showNotice(
            mainOutcome.reason instanceof Error
              ? mainOutcome.reason.message
              : 'Поиск по каталогу временно недоступен.',
          );
        } else if (localOutcome.status === 'rejected') {
          showNotice(
            localOutcome.reason instanceof Error
              ? localOutcome.reason.message
              : 'Локальный фотопоиск не завершился.',
          );
        }

        setLastSearchContext({
          query: targetQuery.trim(),
          mode: targetMode,
          photoId: searchPhoto?.id,
          photoName: searchPhoto?.file.name,
          photoTransform: searchPhoto
            ? formatTransformSummary(searchPhoto.crop, searchPhoto.rotation)
            : undefined,
          photoCropKey: searchPhoto ? cropKey(searchPhoto.crop) : undefined,
          photoRotation: searchPhoto?.rotation,
          usedWorkingCopy,
          photoCount: photos.length,
          ranLocalIndex,
          ranGemini: shouldRunGemini,
        });

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
    [gemini?.enabled, localCapabilities?.available, mode, photos.length, primaryPhoto, query, showNotice],
  );

  function handleSearchSubmit(event: FormEvent) {
    event.preventDefault();
    void runSearch(query, mode, allowGemini, true);
  }

  function handleFindSimilar(result: SearchResult) {
    const similarQuery = buildSimilarQuery(result);
    closeDetailView();
    setQuery(similarQuery);
    setMode('deep');
    void runSearch(similarQuery, 'deep', false, false);
    showNotice(`Ищем похожие модели по запросу «${similarQuery}»…`);
  }

  function handleSearchByTitle(title: string) {
    const clean = title.trim();
    if (!clean) return;
    closeDetailView();
    setQuery(clean);
    void runSearch(clean, mode, false, false);
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
      const title =
        [result.brand, result.name].filter(Boolean).join(' ').slice(0, 180) || result.name;
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
    if (detailResult) closeDetailView();
    if (tab) setCompareTab(tab);
    requestAnimationFrame(() => {
      document.getElementById('vs-comparison-studio')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  }

  async function handleDownloadLensCopy(targetId?: string) {
    const target = (targetId ? photos.find(item => item.id === targetId) : primaryPhoto) ?? primaryPhoto;
    if (!target) return;
    try {
      const copy = await createWorkingPhotoCopy(target.file, target.crop, target.rotation);
      triggerDownload(copy, copy.name);
      showNotice('Рабочая копия для Google Lens скачана.');
    } catch {
      showNotice('Не удалось подготовить копию изображения.');
    }
  }

  function handleDownloadOriginal(targetId?: string) {
    const target = (targetId ? photos.find(item => item.id === targetId) : primaryPhoto) ?? primaryPhoto;
    if (!target) return;
    triggerDownload(target.file, target.file.name);
  }

  async function handleCreateRfq(result: SearchResult) {
    setCreatingRfqId(result.id);
    try {
      const chosenSku = selectedVariants[result.id];
      const chosenVariant = result.variants?.find(item => item.sku === chosenSku);
      const snapshot = buildRfqSnapshotFromSearch(result, chosenVariant, photos, primaryPhoto?.id);
      const store = await openProjectStore();
      try {
        await store.save(snapshot);
      } finally {
        store.close();
      }
      window.dispatchEvent(new Event('light-forge-project-saved'));
      window.location.assign(`/?rfqProject=${encodeURIComponent(snapshot.project.id)}`);
    } catch {
      setCreatingRfqId(null);
      showNotice('Не удалось создать проект Quick RFQ.');
    }
  }

  const primaryPhotoUrl = primaryPhoto ? (photoUrls[primaryPhoto.id] ?? '') : '';

  return (
    <div className="lf-shell vs-shell">
      {/* Cohesive LIGHT FORGE Topbar */}
      <header className="lf-topbar vs-topbar lf-studio-topbar">
        <div className="lf-brand-group">
          <a href="/search" className="lf-brand">
            <span className="lf-brand-mark" aria-hidden="true">
              <BrandMarkIcon />
            </span>
            <span className="lf-brand-text">
              <span className="lf-brand-title">LIGHT FORGE</span>
            </span>
          </a>
        </div>

        <div className="lf-topbar-actions">
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
        </div>
      </header>

      {/* Live status feedback */}
      {notice && (
        <div className="vs-toast-wrap" role="status" aria-live="polite">
          <div className="vs-toast">{notice}</div>
        </div>
      )}

      <main className="vs-main">
        {detailResult ? (
          <ProductDetailView
            result={detailResult}
            selectedSku={selectedVariants[detailResult.id] ?? ''}
            isCompared={compareIds.includes(detailResult.id)}
            isSaved={isResultSaved(detailResult)}
            creatingRfq={creatingRfqId === detailResult.id}
            localMatch={localMatchesByResultId.get(detailResult.id)}
            photos={photos}
            photoUrls={photoUrls}
            primaryPhotoId={primaryPhoto?.id ?? null}
            onBack={closeDetailView}
            onSelectSku={sku =>
              setSelectedVariants(prev => ({ ...prev, [detailResult.id]: sku }))
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
        ) : (
          <>
            {/* Centered Hero: Upload + Multi-photo + Rotate/Zoom/Crop + Search Controls */}
            <section className="vs-hero" aria-labelledby="vs-hero-title">
              <header className="vs-hero-header lf-studio-banner lf-studio-banner--search">
                <h1 id="vs-hero-title" className="vs-hero-title">
                  Поиск светильника по фотографии
                </h1>
                <p className="vs-hero-sub">
                  Загрузите или вставьте фото, поверните и выделите светильник — найдите официальную карточку, аналоги и техпаспорт для Quick RFQ.
                </p>
              </header>

              <div className="vs-studio-card">
                <PhotoCropStage
                  photos={photos}
                  photoUrls={photoUrls}
                  activePhoto={activePhoto}
                  primaryPhotoId={primaryPhoto?.id ?? null}
                  onAddPhotos={addPhotos}
                  onPasteFromClipboard={() => void handlePasteFromClipboard()}
                  onSelectActivePhoto={setActivePhotoId}
                  onSetPrimaryPhoto={handleSetPrimaryPhoto}
                  onRemovePhoto={handleRemovePhoto}
                  onCropChange={handleCropChange}
                  onToggleCrop={handleToggleCrop}
                  onRotatePhoto={handleRotatePhoto}
                  onResetTransform={handleResetTransform}
                  onZoomChange={handleZoomChange}
                  onDownloadLensCopy={id => void handleDownloadLensCopy(id)}
                  onDownloadOriginal={handleDownloadOriginal}
                />

                <form className="vs-search-bar" onSubmit={handleSearchSubmit}>
                  {/* Explicit link between selected primary photo and search query */}
                  {primaryPhoto && (
                    <div className="vs-primary-link-bar" data-testid="vs-primary-search-context">
                      <div className="vs-primary-link-left">
                        {primaryPhotoUrl && (
                          <img
                            src={primaryPhotoUrl}
                            alt=""
                            aria-hidden="true"
                            className="vs-primary-mini-thumb"
                            style={
                              primaryPhoto.rotation !== 0
                                ? { transform: `rotate(${primaryPhoto.rotation}deg)` }
                                : undefined
                            }
                          />
                        )}
                        <div className="vs-primary-link-text">
                          <span className="vs-primary-link-label">
                            <StarIcon size={11} filled />
                            <span>Основное фото для поиска:</span>
                            <strong>{primaryPhoto.file.name}</strong>
                          </span>
                          <span className="vs-primary-link-meta">
                            {!isTransformDefault(primaryPhoto.crop, primaryPhoto.rotation)
                              ? `Рабочая копия (${formatTransformSummary(primaryPhoto.crop, primaryPhoto.rotation)}) · оригинал сохранён`
                              : 'Оригинал без изменений'}
                            {photos.length > 1 ? ` · всего фото: ${photos.length}` : ''}
                          </span>
                        </div>
                      </div>
                      <span
                        className={`lf-badge ${
                          localCapabilities?.available
                            ? 'lf-badge--documentation'
                            : 'lf-badge--unknown'
                        }`}
                      >
                        {localCapabilities?.available
                          ? `Локальный индекс: ${localCapabilities.referenceCount}`
                          : 'Без локального индекса'}
                      </span>
                    </div>
                  )}

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
                      disabled={loading || (!query.trim() && !primaryPhoto)}
                    >
                      <SearchIcon size={15} />
                      <span>{loading ? 'Ищем светильник…' : 'Найти оригинал и аналоги'}</span>
                    </button>
                  </div>

                  {/* Explicit user consent shown ONLY when server Gemini Free Tier is enabled */}
                  {gemini?.enabled && primaryPhoto && (
                    <label className="vs-consent-inline">
                      <input
                        id="vs-gemini-consent"
                        type="checkbox"
                        checked={allowGemini}
                        onChange={event => setAllowGemini(event.target.checked)}
                      />
                      <span>
                        Отправить рабочую копию основного фото ({primaryPhoto.file.name}) в Gemini для этого поиска (оригинал остаётся на вашем устройстве)
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
                              void runSearch(term, mode, false, false);
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
                {/* Honest provenance, active photo link & verification banner */}
                <div className="vs-status-strip">
                  <div className="vs-status-main">
                    <ShieldIcon size={16} className="vs-status-icon" />
                    <div>
                      <strong>Original not verified</strong>
                      <span>
                        {' '}
                        — запись каталога подтверждает изделие производителя, но совпадение с вашей фотографией требует визуальной проверки по официальной карточке и техпаспорту.
                      </span>
                      {lastSearchContext?.photoName && (
                        <div className="vs-result-photo-link" data-testid="vs-result-photo-link">
                          <span>
                            Связанное фото: <strong>{lastSearchContext.photoName}</strong>
                            {lastSearchContext.photoTransform
                              ? ` · ${lastSearchContext.photoTransform}`
                              : ''}
                          </span>
                          {isPhotoContextStale && (
                            <button
                              type="button"
                              className="lf-btn lf-btn--sm lf-btn--brass"
                              onClick={() => void runSearch(query, mode, allowGemini, true)}
                            >
                              <RefreshIcon size={12} />
                              <span>Обновить по текущему фото</span>
                            </button>
                          )}
                        </div>
                      )}
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

                {localResponse && (
                  <LocalMatchesSection
                    matches={localResponse.matches}
                    usedCrop={localUsedCrop}
                    selectedVariants={selectedVariants}
                    compareIds={compareIds}
                    creatingRfqId={creatingRfqId}
                    isResultSaved={isResultSaved}
                    onSelectSku={(resultId, sku) =>
                      setSelectedVariants(prev => ({ ...prev, [resultId]: sku }))
                    }
                    onOpenDetail={openDetailView}
                    onToggleCompare={handleToggleCompare}
                    onFindSimilar={handleFindSimilar}
                    onSearchByTitle={handleSearchByTitle}
                    onToggleSave={handleToggleSave}
                    onReviewChatGpt={target => {
                      setChatGptFocused(target);
                      setChatGptOpen(true);
                    }}
                    onCreateRfq={target => void handleCreateRfq(target)}
                    onOpenLens={() => setLensOpen(true)}
                  />
                )}

                {/* Empty / No results state */}
                {!hasAnyMatches ? (
                  <section className="vs-empty-results" aria-live="polite">
                    <h2>
                      {!localCapabilities?.available &&
                      lastSearchContext?.photoName &&
                      !lastSearchContext.query
                        ? 'Локальный фотоиндекс не подключён'
                        : 'Совпадений в каталоге пока не найдено'}
                    </h2>
                    <p>
                      {!localCapabilities?.available &&
                      lastSearchContext?.photoName &&
                      !lastSearchContext.query
                        ? 'Для поиска только по изображению без локального индекса откройте ручной Google Lens (можно скачать готовую рабочую копию фото), введите название/артикул светильника или проверьте через ChatGPT.'
                        : 'Уточните название, артикул или материалы светильника, переключитесь на глубокий поиск или найдите страницу товара через Google Lens и добавьте ссылку сюда.'}
                    </p>
                    <div className="vs-empty-actions">
                      {mode === 'standard' && (
                        <button
                          type="button"
                          className="lf-btn lf-btn--primary"
                          onClick={() => {
                            setMode('deep');
                            void runSearch(query, 'deep', false, false);
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
                    {results.length > 0 && (
                      <>
                        {/* Filters, Sort & Grid/Table View Switcher */}
                        <ResultsToolbar
                          totalCount={results.length}
                          filteredCount={filteredResults.length}
                          filters={filters}
                          viewMode={viewMode}
                          availableKinds={filterOptions.kinds}
                          availableBrands={filterOptions.brands}
                          hasUnbranded={filterOptions.hasUnbranded}
                          savedCount={saved.length}
                          onFiltersChange={setFilters}
                          onResetFilters={() => setFilters(DEFAULT_RESULT_FILTERS)}
                          onViewModeChange={setViewMode}
                        />

                        {filteredResults.length === 0 ? (
                          <section className="vs-empty-results" aria-live="polite">
                            <h2>По выбранным фильтрам модели не найдены</h2>
                            <p>
                              Найдено записей: {results.length}, но текущие фильтры скрыли все результаты.
                            </p>
                            <div className="vs-empty-actions">
                              <button
                                type="button"
                                className="lf-btn lf-btn--primary"
                                onClick={() => setFilters(DEFAULT_RESULT_FILTERS)}
                              >
                                <RefreshIcon size={14} />
                                <span>Сбросить фильтры</span>
                              </button>
                            </div>
                          </section>
                        ) : viewMode === 'table' ? (
                          <ResultsTableView
                            results={filteredResults}
                            selectedVariants={selectedVariants}
                            compareIds={compareIds}
                            creatingRfqId={creatingRfqId}
                            isResultSaved={isResultSaved}
                            onSelectSku={(resultId, sku) =>
                              setSelectedVariants(prev => ({ ...prev, [resultId]: sku }))
                            }
                            onOpenDetail={openDetailView}
                            onToggleCompare={handleToggleCompare}
                            onToggleSave={handleToggleSave}
                            onCreateRfq={target => void handleCreateRfq(target)}
                          />
                        ) : (
                          <>
                            {/* 1. ОРИГИНАЛ */}
                            {(isDefaultResultFilters(filters) || sections.originals.length > 0) && (
                              <section className="vs-section" aria-labelledby="vs-sec-originals">
                                <div className="vs-section-head">
                                  <div>
                                    <span className="vs-section-eyebrow">01 · Оригинал</span>
                                    <h2 id="vs-sec-originals" className="vs-section-title">
                                      Оригинал
                                      <span className="vs-count-pill">
                                        {sections.originals.length}
                                      </span>
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
                                        onOpenDetail={openDetailView}
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
                            )}

                            {/* 2. ТОЧНЫЕ СОВПАДЕНИЯ И ССЫЛКИ НА ПРОВЕРКУ */}
                            {[
                              {
                                id: 'exact',
                                title: 'Точные совпадения',
                                description: 'Та же модель на разных сайтах.',
                                items: sections.exactMatches,
                              },
                              {
                                id: 'unverified',
                                title: 'Ссылки на проверку',
                                description: 'Источники из Google Lens и ChatGPT требуют сверки.',
                                items: sections.unverified,
                              },
                            ]
                              .filter(
                                group =>
                                  (group.id === 'exact' && isDefaultResultFilters(filters)) ||
                                  group.items.length > 0,
                              )
                              .map(group => (
                                <section
                                  key={group.id}
                                  className="vs-section"
                                  aria-labelledby={`vs-sec-${group.id}`}
                                >
                                  <div className="vs-section-head">
                                    <div>
                                      <h2 id={`vs-sec-${group.id}`} className="vs-section-title">
                                        {group.title}
                                        <span className="vs-count-pill">{group.items.length}</span>
                                      </h2>
                                      <p className="vs-section-desc">{group.description}</p>
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
                                            setSelectedVariants(prev => ({
                                              ...prev,
                                              [item.id]: sku,
                                            }))
                                          }
                                          onOpenDetail={openDetailView}
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
                            {(isDefaultResultFilters(filters) ||
                              sections.similarModels.length > 0) && (
                              <section className="vs-section" aria-labelledby="vs-sec-similar">
                                <div className="vs-section-head">
                                  <div>
                                    <span className="vs-section-eyebrow">03 · Похожие модели</span>
                                    <h2 id="vs-sec-similar" className="vs-section-title">
                                      Похожие модели
                                      <span className="vs-count-pill">
                                        {sections.similarModels.length}
                                      </span>
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
                                        onOpenDetail={openDetailView}
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
                            )}
                          </>
                        )}
                      </>
                    )}

                    {/* 4. ТЕХНИЧЕСКАЯ ДОКУМЕНТАЦИЯ */}
                    {(filteredResults.length > 0 || documentationItems.length > 0) && (
                      <section className="vs-section" aria-labelledby="vs-sec-docs">
                        <div className="vs-section-head">
                          <div>
                            <span className="vs-section-eyebrow">
                              04 · Техническая документация
                            </span>
                            <h2 id="vs-sec-docs" className="vs-section-title">
                              Техническая документация
                              <span className="vs-count-pill">{documentationItems.length}</span>
                            </h2>
                            <p className="vs-section-desc">
                              Официальные PDF-листы, подтверждённые габариты в миллиметрах, материалы и светотехнические параметры.
                            </p>
                          </div>
                        </div>

                        {documentationItems.length > 0 ? (
                          <div className="vs-docs-list">
                            {documentationItems.map(item => {
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
                                      {item.details && (
                                        <p className="vs-doc-details">{item.details}</p>
                                      )}
                                    </div>

                                    <div className="vs-doc-head-actions">
                                      <button
                                        type="button"
                                        className="lf-btn lf-btn--sm"
                                        onClick={() => openDetailView(item)}
                                      >
                                        <EyeIcon size={13} />
                                        <span>Подробнее</span>
                                      </button>
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
                                                <td>
                                                  {item.confirmedDimming ?? 'На подтверждение'}
                                                </td>
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
                                              {specs.materials
                                                .map(m => `${m.part}: ${m.material}`)
                                                .join(' · ')}
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
                                        {(specs.dimensionsReferTo ||
                                          specs.standardMaxBandLengthMm) && (
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
                                            Световые конфигурации из техпаспорта (
                                            {specs.lighting.sourceType}{' '}
                                            {specs.lighting.sourceVoltageV} В
                                            {chosenVariant
                                              ? ` · фильтр по кольцу ${chosenVariant.widthMm} мм`
                                              : ''}
                                            )
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
                    )}
                  </>
                )}

                {/* Comparison Studio */}
                <ComparisonStudio
                  items={comparedItems}
                  allResults={allComparableResults}
                  selectedVariants={selectedVariants}
                  photo={primaryPhoto?.file}
                  photoUrl={primaryPhotoUrl}
                  crop={primaryPhoto?.crop ?? FULL_CROP}
                  rotation={primaryPhoto?.rotation ?? 0}
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
          </>
        )}
      </main>

      {/* Sticky Comparison Dock when models are selected and studio is offscreen */}
      {comparedItems.length > 0 && !compareInView && !detailResult && (
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
        localCapabilities={localCapabilities}
        allowGemini={allowGemini}
        saved={saved}
        history={history}
        onClose={() => setSettingsOpen(false)}
        onToggleAllowGemini={setAllowGemini}
        onImportSaved={() => handleAddLinks(saved)}
        onRemoveSaved={handleRemoveSaved}
        onPickHistory={term => {
          setQuery(term);
          void runSearch(term, mode, false, false);
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
        hasPhoto={Boolean(primaryPhoto)}
        primaryPhotoName={primaryPhoto?.file.name}
        transformSummary={
          primaryPhoto && !isTransformDefault(primaryPhoto.crop, primaryPhoto.rotation)
            ? formatTransformSummary(primaryPhoto.crop, primaryPhoto.rotation)
            : undefined
        }
        onClose={() => setLensOpen(false)}
        onDownloadLensCopy={() => void handleDownloadLensCopy(primaryPhoto?.id)}
        onDownloadOriginal={() => handleDownloadOriginal(primaryPhoto?.id)}
        onAddLinks={handleAddLinks}
      />

      <ChatGptDrawer
        open={chatGptOpen}
        query={query}
        results={allComparableResults}
        focusedResult={chatGptFocused}
        onClose={() => setChatGptOpen(false)}
        onAddLinks={handleAddLinks}
        onExportPrompt={text => {
          triggerDownload(
            new Blob([text], { type: 'text/plain;charset=utf-8' }),
            'light-forge-review.txt',
          );
          showNotice('Задание для проверки сохранено в light-forge-review.txt.');
        }}
      />
    </div>
  );
}
