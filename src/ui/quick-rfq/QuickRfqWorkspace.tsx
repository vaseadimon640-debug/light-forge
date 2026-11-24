'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createMyline } from '@/domain/myline';
import { newProject, productTypes, type ProductType, type Project, type Unit } from '@/domain/project';
import type { Composition } from '@/geometry/schema';
import type { RfqLanguage } from '@/rfq/quick';
import {
  exportProject,
  importProject,
  openProjectStore,
  type ProjectSnapshot,
} from '@/storage/projects';
import {
  BrandMarkIcon,
  FilePdfIcon,
  FolderIcon,
  PlusIcon,
  SaveIcon,
  ShieldIcon,
  SparkIcon,
} from '../icons';
import { ComponentEditor } from './ComponentEditor';
import {
  addComponentToProject,
  addPhotosToSnapshot,
  addPlacementToProject,
  issuesMatching,
  orderedPhotos,
  pruneExcessPlacements,
  removeComponentFromProject,
  removePhotoFromSnapshot,
  requestQuickRfqPdf,
  requestQuickRfqText,
  setPrimaryPhoto,
  snapshotFingerprint,
  unitLabels,
  updateComponentInProject,
  validateProject,
  type RfqApiError,
} from './helpers';
import { requestPhotoAnalysis } from '@/photo-analysis/client';
import { MountingSection } from './MountingSection';
import { PhotoAnalysisPanel, type PhotoAnalysisStatus } from './PhotoAnalysisPanel';
import { PhotoManager } from './PhotoManager';
import { ProjectLibraryModal } from './ProjectLibraryModal';
import { RfqPreviewPanel, type PreviewTab } from './RfqPreviewPanel';
import {
  applyEmptySuggestions,
  applyPhotoSuggestion,
  createPreviewDemoSuggestions,
  formatPhotoAnalysisError,
  isAbortError,
  syncSelectedPhotoIds,
  type AnalyzedPhoto,
  type PhotoAnalysisMode,
  type PhotoAnalysisProvider,
  type PhotoAnalysisUiError,
  type PhotoSuggestion,
  type PhotoSuggestionEditOverride,
} from './photoAnalysis';

const productTypeKeys = Object.keys(productTypes) as ProductType[];
const currencies: Project['currency'][] = ['USD', 'EUR', 'CNY'];
const units: Unit[] = ['mm', 'cm', 'm'];

const defaultPhotoAnalysisProvider: PhotoAnalysisProvider = {
  label: 'LIGHT FORGE',
  analyze: ({ snapshot, photoIds, signal }) => requestPhotoAnalysis(snapshot, photoIds, signal),
};

function createInitialSnapshot(): ProjectSnapshot {
  return { project: createMyline(), originals: {} };
}

type QuickRfqWorkspaceProps = {
  /** Photo-analysis API provider (defaults to LIGHT FORGE /api/photo-analysis via @/photo-analysis/client). */
  photoAnalysisProvider?: PhotoAnalysisProvider | null;
};

export function QuickRfqWorkspace({
  photoAnalysisProvider = defaultPhotoAnalysisProvider,
}: QuickRfqWorkspaceProps = {}) {
  const [snapshot, setSnapshot] = useState<ProjectSnapshot>(() => createInitialSnapshot());
  const [linkedComposition, setLinkedComposition] = useState<Composition | undefined>(undefined);
  const [activeComponentId, setActiveComponentId] = useState<string>(() => snapshot.project.components[0].id);
  const [unit, setUnit] = useState<Unit>('mm');
  const [language, setLanguage] = useState<RfqLanguage>('en-zh');
  const [previewTab, setPreviewTab] = useState<PreviewTab>('sheet');
  const [mobilePane, setMobilePane] = useState<'form' | 'preview'>('form');
  const [mountingOpen, setMountingOpen] = useState<boolean>(true);
  const [notesOpen, setNotesOpen] = useState<boolean>(false);

  // Local service health & persistence states
  const [health, setHealth] = useState<'checking' | 'ok' | 'offline'>('checking');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [savedProjects, setSavedProjects] = useState<Project[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastSavedFingerprint, setLastSavedFingerprint] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);

  // Step 2: Photo Analysis state wired to /api/photo-analysis v1 contract
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>(() =>
    snapshot.project.photos.map(photo => photo.id),
  );
  const [analysisStatus, setAnalysisStatus] = useState<PhotoAnalysisStatus>('idle');
  const [analysisMode, setAnalysisMode] = useState<PhotoAnalysisMode | null>(null);
  const [analyzedPhotos, setAnalyzedPhotos] = useState<AnalyzedPhoto[]>([]);
  const [lastAnalyzedKey, setLastAnalyzedKey] = useState<string | null>(null);
  const [analysisCancelledNotice, setAnalysisCancelledNotice] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<PhotoAnalysisUiError | null>(null);
  const [analysisSummary, setAnalysisSummary] = useState<string | null>(null);
  const [analysisWarnings, setAnalysisWarnings] = useState<string[]>([]);
  const [analysisSuggestions, setAnalysisSuggestions] = useState<PhotoSuggestion[]>([]);
  const [analysisPreviewDemo, setAnalysisPreviewDemo] = useState<boolean>(false);
  const [analysisStepSkipped, setAnalysisStepSkipped] = useState<boolean>(false);
  const analysisAbortRef = useRef<AbortController | null>(null);
  const analysisRequestIdRef = useRef<number>(0);

  // Object URLs for uploaded photo thumbnails/previews — revoked cleanly on change/unmount
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const photoUrlsRef = useRef<Record<string, { blob: Blob; url: string }>>({});

  // PDF preview state — single Blob URL reused for inline preview & download, revoked cleanly
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const pdfUrlRef = useRef<string | null>(null);
  const [pdfFilename, setPdfFilename] = useState<string>('MYLINE-quick-rfq-en-zh.pdf');
  const [pdfStatus, setPdfStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [pdfFingerprint, setPdfFingerprint] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<RfqApiError | null>(null);
  const pdfAbortRef = useRef<AbortController | null>(null);

  // Server text preview state
  const [textStatus, setTextStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [serverText, setServerText] = useState<string>('');
  const [textFingerprint, setTextFingerprint] = useState<string | null>(null);
  const [textError, setTextError] = useState<RfqApiError | null>(null);
  const textAbortRef = useRef<AbortController | null>(null);

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3200);
  }, []);

  // Check /api/health on mount
  useEffect(() => {
    let active = true;
    fetch('/api/health')
      .then(res => (res.ok ? res.json() : Promise.reject(new Error('unhealthy'))))
      .then(data => {
        if (active) setHealth(data?.status === 'ok' ? 'ok' : 'offline');
      })
      .catch(() => {
        if (active) setHealth('offline');
      });
    return () => {
      active = false;
    };
  }, []);

  // Maintain object URLs for photo Blobs without leaking memory
  useEffect(() => {
    const cache = photoUrlsRef.current;
    const nextCache: Record<string, { blob: Blob; url: string }> = {};
    const nextUrls: Record<string, string> = {};

    for (const photo of snapshot.project.photos) {
      const blob = snapshot.originals[photo.id];
      if (!blob) continue;
      const existing = cache[photo.id];
      if (existing && existing.blob === blob) {
        nextCache[photo.id] = existing;
        nextUrls[photo.id] = existing.url;
      } else {
        if (existing) URL.revokeObjectURL(existing.url);
        const created = URL.createObjectURL(blob);
        nextCache[photo.id] = { blob, url: created };
        nextUrls[photo.id] = created;
      }
    }

    for (const [id, entry] of Object.entries(cache)) {
      if (!nextCache[id]) {
        URL.revokeObjectURL(entry.url);
      }
    }

    photoUrlsRef.current = nextCache;
    setPhotoUrls(nextUrls);
  }, [snapshot.originals, snapshot.project.photos]);

  // Cleanup all Object URLs and in-flight requests on unmount
  useEffect(() => {
    return () => {
      pdfAbortRef.current?.abort();
      textAbortRef.current?.abort();
      analysisAbortRef.current?.abort();
      if (pdfUrlRef.current) {
        URL.revokeObjectURL(pdfUrlRef.current);
        pdfUrlRef.current = null;
      }
      for (const entry of Object.values(photoUrlsRef.current)) {
        URL.revokeObjectURL(entry.url);
      }
      photoUrlsRef.current = {};
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const replacePdfUrl = useCallback((nextUrl: string | null) => {
    if (pdfUrlRef.current && pdfUrlRef.current !== nextUrl) {
      URL.revokeObjectURL(pdfUrlRef.current);
    }
    pdfUrlRef.current = nextUrl;
    setPdfUrl(nextUrl);
  }, []);

  const validationIssues = useMemo(() => validateProject(snapshot.project), [snapshot.project]);
  const currentFingerprint = useMemo(
    () => snapshotFingerprint(snapshot, language, linkedComposition),
    [snapshot, language, linkedComposition],
  );
  const projectFingerprint = useMemo(
    () => snapshotFingerprint(snapshot, 'en-zh'),
    [snapshot],
  );

  // Merge client validation issues with any server 422 invalid_snapshot issues
  const combinedIssues = useMemo(() => {
    if (validationIssues.length > 0) return validationIssues;
    return pdfError?.issues ?? textError?.issues ?? [];
  }, [validationIssues, pdfError, textError]);

  const updateProject = useCallback((updater: (project: Project) => Project) => {
    setSnapshot(current => ({
      ...current,
      project: updater(current.project),
    }));
  }, []);

  const generatePdf = useCallback(
    async (targetLang: RfqLanguage = language) => {
      const targetSnapshot = snapshot;
      const targetComp = linkedComposition;
      const targetFp = snapshotFingerprint(targetSnapshot, targetLang, targetComp);

      pdfAbortRef.current?.abort();
      const controller = new AbortController();
      pdfAbortRef.current = controller;

      setPdfStatus('loading');
      setPdfError(null);
      setPreviewTab('pdf');
      setMobilePane('preview');

      try {
        const { blob, filename } = await requestQuickRfqPdf(
          targetSnapshot,
          targetLang,
          targetComp,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        const nextUrl = URL.createObjectURL(blob);
        replacePdfUrl(nextUrl);
        setPdfFilename(filename);
        setPdfFingerprint(targetFp);
        setPdfStatus('ready');
        showToast('PDF Quick RFQ сформирован');
      } catch (err) {
        if (controller.signal.aborted) return;
        const apiError: RfqApiError =
          err && typeof err === 'object' && 'status' in err && 'code' in err
            ? (err as RfqApiError)
            : {
                status: 0,
                code: 'network_error',
                message: err instanceof Error ? err.message : 'Не удалось связаться с сервером PDF.',
                retryable: true,
              };
        setPdfError(apiError);
        setPdfStatus('error');
      }
    },
    [language, linkedComposition, replacePdfUrl, showToast, snapshot],
  );

  const generateText = useCallback(
    async (targetLang: RfqLanguage = language) => {
      const targetSnapshot = snapshot;
      const targetComp = linkedComposition;
      const targetFp = snapshotFingerprint(targetSnapshot, targetLang, targetComp);

      textAbortRef.current?.abort();
      const controller = new AbortController();
      textAbortRef.current = controller;

      setTextStatus('loading');
      setTextError(null);

      try {
        const result = await requestQuickRfqText(targetSnapshot, targetLang, targetComp, controller.signal);
        if (controller.signal.aborted) return;
        setServerText(result.text);
        setTextFingerprint(targetFp);
        setTextStatus('ready');
      } catch (err) {
        if (controller.signal.aborted) return;
        const apiError: RfqApiError =
          err && typeof err === 'object' && 'status' in err && 'code' in err
            ? (err as RfqApiError)
            : {
                status: 0,
                code: 'network_error',
                message: err instanceof Error ? err.message : 'Не удалось получить текст RFQ.',
                retryable: true,
              };
        setTextError(apiError);
        setTextStatus('error');
      }
    },
    [language, linkedComposition, snapshot],
  );

  // Switch preview tab cleanly; auto-fetch server text when entering Text tab if stale/empty
  const handleChangePreviewTab = useCallback(
    (nextTab: PreviewTab) => {
      setPreviewTab(nextTab);
      if (nextTab === 'text' && validationIssues.length === 0 && textFingerprint !== currentFingerprint) {
        void generateText(language);
      }
      if (nextTab === 'pdf' && !pdfUrlRef.current && validationIssues.length === 0 && pdfStatus === 'idle') {
        void generatePdf(language);
      }
    },
    [currentFingerprint, generatePdf, generateText, language, pdfStatus, textFingerprint, validationIssues.length],
  );

  // Switch document language; if user is currently viewing PDF or API text, re-fetch in new language
  const handleChangeLanguage = useCallback(
    (nextLang: RfqLanguage) => {
      setLanguage(nextLang);
      if (validationIssues.length > 0) return;
      if (previewTab === 'pdf' && pdfUrlRef.current) {
        void generatePdf(nextLang);
      } else if (previewTab === 'text') {
        void generateText(nextLang);
      }
    },
    [generatePdf, generateText, previewTab, validationIssues.length],
  );

  // IndexedDB Library operations
  const refreshLibrary = useCallback(async () => {
    setLibraryLoading(true);
    try {
      const store = await openProjectStore();
      try {
        const list = await store.list();
        setSavedProjects(list);
      } finally {
        store.close();
      }
    } catch {
      showToast('Не удалось открыть локальное хранилище IndexedDB');
    } finally {
      setLibraryLoading(false);
    }
  }, [showToast]);

  const handleSaveProject = useCallback(async () => {
    if (validationIssues.length > 0) {
      showToast('Сначала исправьте ошибки в полях формы');
      return;
    }
    setSaving(true);
    try {
      const store = await openProjectStore();
      try {
        const saved = await store.save(snapshot);
        setSnapshot(saved);
        setLastSavedFingerprint(snapshotFingerprint(saved, 'en-zh'));
        const list = await store.list();
        setSavedProjects(list);
        showToast(`Проект «${saved.project.name}» сохранён локально`);
      } finally {
        store.close();
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Ошибка сохранения проекта');
    } finally {
      setSaving(false);
    }
  }, [showToast, snapshot, validationIssues.length]);

  // Keyboard shortcut Ctrl/Cmd + S to save locally
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void handleSaveProject();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSaveProject]);

  const resetPreviewOutputs = useCallback(() => {
    pdfAbortRef.current?.abort();
    textAbortRef.current?.abort();
    replacePdfUrl(null);
    setPdfStatus('idle');
    setPdfFingerprint(null);
    setPdfError(null);
    setServerText('');
    setTextStatus('idle');
    setTextFingerprint(null);
    setTextError(null);
    setPreviewTab('sheet');
  }, [replacePdfUrl]);

  const orderedSelectedPhotoIds = useMemo(() => {
    const selectedSet = new Set(selectedPhotoIds);
    return orderedPhotos(snapshot.project)
      .filter(photo => selectedSet.has(photo.id))
      .map(photo => photo.id);
  }, [selectedPhotoIds, snapshot.project]);

  const currentSelectedKey = orderedSelectedPhotoIds.join(',');
  const analysisSelectionStale =
    Boolean(lastAnalyzedKey) && lastAnalyzedKey !== currentSelectedKey;

  const cancelInFlightAnalysis = useCallback((notice?: string) => {
    const hadInFlight = Boolean(analysisAbortRef.current);
    analysisRequestIdRef.current += 1;
    analysisAbortRef.current?.abort();
    analysisAbortRef.current = null;
    if (hadInFlight) {
      setAnalysisStatus('idle');
      setAnalysisError(null);
      if (notice) {
        setAnalysisCancelledNotice(notice);
      }
    }
    return hadInFlight;
  }, []);

  const resetPhotoAnalysis = useCallback((nextSelectedIds: string[] = []) => {
    analysisRequestIdRef.current += 1;
    analysisAbortRef.current?.abort();
    analysisAbortRef.current = null;
    setSelectedPhotoIds(nextSelectedIds);
    setAnalysisStatus('idle');
    setAnalysisMode(null);
    setAnalyzedPhotos([]);
    setLastAnalyzedKey(null);
    setAnalysisCancelledNotice(null);
    setAnalysisError(null);
    setAnalysisSummary(null);
    setAnalysisWarnings([]);
    setAnalysisSuggestions([]);
    setAnalysisPreviewDemo(false);
    setAnalysisStepSkipped(false);
  }, []);

  const handleTogglePhotoSelection = useCallback(
    (photoId: string) => {
      const wasLoading = cancelInFlightAnalysis(
        'Запрос анализа отменён из-за изменения выбранных фотографий.',
      );
      if (!wasLoading) setAnalysisCancelledNotice(null);
      setSelectedPhotoIds(current => {
        const exists = current.includes(photoId);
        const next = exists ? current.filter(id => id !== photoId) : [...current, photoId];
        return syncSelectedPhotoIds(next, snapshot.project.photos);
      });
    },
    [cancelInFlightAnalysis, snapshot.project.photos],
  );

  const handleSelectAllPhotos = useCallback(() => {
    const wasLoading = cancelInFlightAnalysis(
      'Запрос анализа отменён из-за изменения выбранных фотографий.',
    );
    if (!wasLoading) setAnalysisCancelledNotice(null);
    setSelectedPhotoIds(snapshot.project.photos.map(photo => photo.id));
  }, [cancelInFlightAnalysis, snapshot.project.photos]);

  const handleClearPhotoSelection = useCallback(() => {
    const wasLoading = cancelInFlightAnalysis(
      'Запрос анализа отменён: выбор фотографий снят.',
    );
    if (!wasLoading) setAnalysisCancelledNotice(null);
    setSelectedPhotoIds([]);
  }, [cancelInFlightAnalysis]);

  const handleCancelPhotoAnalysis = useCallback(() => {
    const cancelled = cancelInFlightAnalysis(
      'Запрос анализа отменён. Вы можете изменить выбор фото или запустить анализ снова.',
    );
    if (cancelled) {
      showToast('Запрос анализа фото отменён');
    }
  }, [cancelInFlightAnalysis, showToast]);

  const handleRunPhotoAnalysis = useCallback(async () => {
    if (!photoAnalysisProvider) return;
    if (orderedSelectedPhotoIds.length === 0) return;

    analysisAbortRef.current?.abort();
    const controller = new AbortController();
    analysisAbortRef.current = controller;
    const requestId = ++analysisRequestIdRef.current;
    const requestKey = orderedSelectedPhotoIds.join(',');

    setAnalysisStatus('loading');
    setAnalysisError(null);
    setAnalysisCancelledNotice(null);
    setAnalysisSummary(null);
    setAnalysisWarnings([]);
    setAnalysisPreviewDemo(false);

    try {
      const response = await photoAnalysisProvider.analyze({
        snapshot,
        photoIds: orderedSelectedPhotoIds,
        signal: controller.signal,
      });
      if (controller.signal.aborted || analysisRequestIdRef.current !== requestId) return;
      analysisAbortRef.current = null;
      setAnalysisMode(response.mode);
      setAnalyzedPhotos(response.photos);
      setLastAnalyzedKey(requestKey);
      setAnalysisSuggestions(
        response.suggestions.map(item => ({
          ...item,
          status: 'pending' as const,
        })),
      );
      setAnalysisSummary(response.summary ?? null);
      setAnalysisWarnings(response.warnings ?? []);
      setAnalysisStatus('ready');
      if (response.mode === 'metadata_only') {
        showToast(`Проверены метаданные ${response.photos.length} фото · распознавание ещё не подключено`);
      } else {
        showToast(`Получено подсказок по фото: ${response.suggestions.length}`);
      }
    } catch (error) {
      if (
        controller.signal.aborted ||
        analysisRequestIdRef.current !== requestId ||
        isAbortError(error)
      ) {
        return;
      }
      analysisAbortRef.current = null;
      setAnalysisError(formatPhotoAnalysisError(error));
      setAnalysisStatus('error');
    }
  }, [orderedSelectedPhotoIds, photoAnalysisProvider, showToast, snapshot]);

  const handleLoadPreviewDemo = useCallback(() => {
    const photos = orderedPhotos(snapshot.project);
    const primaryId = orderedSelectedPhotoIds[0] ?? photos[0]?.id;
    setAnalysisSuggestions(createPreviewDemoSuggestions(snapshot.project, primaryId));
    setAnalysisError(null);
    setAnalysisCancelledNotice(null);
    setAnalysisSummary(null);
    setAnalysisWarnings([]);
    setAnalysisPreviewDemo(true);
    setAnalysisStatus('ready');
    showToast('Открыт демо-просмотр интерфейса подсказок');
  }, [orderedSelectedPhotoIds, showToast, snapshot.project]);

  const handleAcceptSuggestion = useCallback(
    (id: string): { ok: boolean; error?: string } => {
      const target = analysisSuggestions.find(item => item.id === id);
      if (!target) return { ok: false, error: 'Подсказка не найдена.' };
      const result = applyPhotoSuggestion(snapshot.project, target, undefined, unit);
      if (!result.ok) return { ok: false, error: result.error };
      setSnapshot(current => ({ ...current, project: result.project }));
      setAnalysisSuggestions(current =>
        current.map(item =>
          item.id === id
            ? { ...item, status: 'accepted', appliedSummary: result.appliedSummary }
            : item,
        ),
      );
      showToast('Подсказка принята и добавлена в форму (Оценка)');
      return { ok: true };
    },
    [analysisSuggestions, showToast, snapshot.project, unit],
  );

  const handleEditSuggestion = useCallback(
    (id: string, override: PhotoSuggestionEditOverride): { ok: boolean; error?: string } => {
      const target = analysisSuggestions.find(item => item.id === id);
      if (!target) return { ok: false, error: 'Подсказка не найдена.' };
      const result = applyPhotoSuggestion(snapshot.project, target, override, unit);
      if (!result.ok) return { ok: false, error: result.error };
      setSnapshot(current => ({ ...current, project: result.project }));
      setAnalysisSuggestions(current =>
        current.map(item =>
          item.id === id
            ? { ...item, status: 'edited', appliedSummary: result.appliedSummary }
            : item,
        ),
      );
      showToast('Изменённое значение применено к форме');
      return { ok: true };
    },
    [analysisSuggestions, showToast, snapshot.project, unit],
  );

  const handleSkipSuggestion = useCallback((id: string) => {
    setAnalysisSuggestions(current =>
      current.map(item => (item.id === id ? { ...item, status: 'skipped' } : item)),
    );
  }, []);

  const handleRestoreSuggestion = useCallback((id: string) => {
    setAnalysisSuggestions(current =>
      current.map(item =>
        item.id === id ? { ...item, status: 'pending', appliedSummary: undefined } : item,
      ),
    );
  }, []);

  const handleAcceptAllEmpty = useCallback(() => {
    const result = applyEmptySuggestions(snapshot.project, analysisSuggestions, unit);
    if (result.appliedCount === 0) {
      showToast('Нет незаполненных полей для автоматического применения');
      return;
    }
    setSnapshot(current => ({ ...current, project: result.project }));
    setAnalysisSuggestions(result.suggestions);
    const protectedPart =
      result.protectedCount > 0 ? ` · Ручных полей защищено: ${result.protectedCount}` : '';
    showToast(`Применено к пустым полям: ${result.appliedCount}${protectedPart}`);
  }, [analysisSuggestions, showToast, snapshot.project, unit]);

  const loadSnapshotIntoWorkspace = useCallback(
    (next: ProjectSnapshot, message: string) => {
      setSnapshot(next);
      setLinkedComposition(undefined);
      setActiveComponentId(next.project.components[0].id);
      setUploadErrors([]);
      setMountingOpen(
        Boolean(
          next.project.mounting.ceilingFromFloorMm ||
            next.project.mounting.tabletopFromFloorMm ||
            next.project.mounting.placements.length > 0,
        ),
      );
      setNotesOpen(Boolean(next.project.notes));
      resetPreviewOutputs();
      resetPhotoAnalysis(next.project.photos.map(photo => photo.id));
      showToast(message);
    },
    [resetPhotoAnalysis, resetPreviewOutputs, showToast],
  );

  const handleOpenSavedProject = useCallback(
    async (id: string) => {
      try {
        const store = await openProjectStore();
        try {
          const restored = await store.get(id);
          if (!restored) {
            showToast('Проект не найден в хранилище');
            return;
          }
          setLastSavedFingerprint(snapshotFingerprint(restored, 'en-zh'));
          loadSnapshotIntoWorkspace(restored, `Открыт проект «${restored.project.name}»`);
        } finally {
          store.close();
        }
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Ошибка чтения проекта');
      }
    },
    [loadSnapshotIntoWorkspace, showToast],
  );

  useEffect(() => {
    const url = new URL(window.location.href);
    const id = url.searchParams.get('rfqProject');
    if (!id) return;
    url.searchParams.delete('rfqProject');
    window.history.replaceState(window.history.state, '', url);
    void handleOpenSavedProject(id);
  }, [handleOpenSavedProject]);

  const handleDeleteSavedProject = useCallback(
    async (id: string) => {
      try {
        const store = await openProjectStore();
        try {
          await store.remove(id);
          const list = await store.list();
          setSavedProjects(list);
          showToast('Проект удалён из локального хранилища');
        } finally {
          store.close();
        }
      } catch {
        showToast('Не удалось удалить проект');
      }
    },
    [showToast],
  );

  const handleExportArchive = useCallback(async () => {
    try {
      const archive = await exportProject(snapshot);
      const url = URL.createObjectURL(archive);
      const anchor = document.createElement('a');
      const code = (snapshot.project.code || snapshot.project.name || 'light-forge').replace(/[^A-Za-z0-9_-]/g, '-');
      anchor.href = url;
      anchor.download = `${code}-light-forge-project.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast('JSON-архив с оригиналами фото выгружен');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Не удалось экспортировать проект');
    }
  }, [showToast, snapshot]);

  const handleImportArchive = useCallback(
    async (file: File) => {
      try {
        const imported = await importProject(file);
        setLastSavedFingerprint(null);
        loadSnapshotIntoWorkspace(imported, `Импортирован проект «${imported.project.name}»`);
        setLibraryOpen(false);
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Ошибка импорта JSON-архива');
      }
    },
    [loadSnapshotIntoWorkspace, showToast],
  );

  const nameError = issuesMatching(combinedIssues, ['name'])[0]?.message;
  const qtyError = issuesMatching(combinedIssues, ['orderQuantity'])[0]?.message;
  const apiPhotoError = pdfError?.code === 'invalid_photo' ? pdfError.message : undefined;
  const isSavedCurrent = lastSavedFingerprint === projectFingerprint;

  return (
    <div className="lf-shell">
      {/* Top Studio Bar */}
      <header className="lf-topbar">
        <div className="lf-brand-group">
          <div className="lf-brand">
            <span className="lf-brand-mark">
              <BrandMarkIcon />
            </span>
            <div className="lf-brand-text">
              <span className="lf-brand-title">LIGHT FORGE</span>
              <span className="lf-brand-sub">Quick RFQ · Спецификация и PDF EN/ZH</span>
            </div>
          </div>

          <span className="lf-divider-v" aria-hidden="true" />

          <span className="lf-status-pill" title="Состояние локального API /api/health">
            <span
              className={`lf-status-dot ${
                health === 'ok'
                  ? 'lf-status-dot--ok'
                  : health === 'offline'
                    ? 'lf-status-dot--err'
                    : ''
              }`}
            />
            {health === 'ok' ? 'API готов' : health === 'offline' ? 'API недоступен' : 'Проверка API...'}
          </span>
        </div>

        <div className="lf-topbar-actions">
          <a href="/search" target="_blank" rel="noopener" className="lf-btn lf-btn--sm">AI Search</a>
          <a href="/geometry" target="_blank" rel="noopener" className="lf-btn lf-btn--sm" title="Открыть 3D-конструктор в новой вкладке">
            3D-конструктор
          </a>
          {/* Global Display Unit Switcher (storage stays canonical in mm) */}
          <div className="lf-segment" role="group" aria-label="Единицы отображения размеров">
            {units.map(u => (
              <button
                key={u}
                id={`lf-unit-${u}`}
                type="button"
                className="lf-segment-btn"
                aria-pressed={unit === u}
                title="Внутри системы все длины хранятся в миллиметрах"
                onClick={() => setUnit(u)}
              >
                {unitLabels[u]}
              </button>
            ))}
          </div>

          <button
            id="lf-new-project-btn"
            type="button"
            className="lf-btn lf-btn--sm"
            onClick={() => {
              setLastSavedFingerprint(null);
              loadSnapshotIntoWorkspace({ project: newProject(), originals: {} }, 'Создан новый проект');
            }}
          >
            <PlusIcon size={14} /> Новый
          </button>

          <button
            id="lf-load-myline-btn"
            type="button"
            className="lf-btn lf-btn--brass lf-btn--sm"
            title="Загрузить эталонный проект MYLINE с реальными параметрами"
            onClick={() => {
              setLastSavedFingerprint(null);
              loadSnapshotIntoWorkspace({ project: createMyline(), originals: {} }, 'Загружен шаблон MYLINE');
            }}
          >
            <SparkIcon size={14} /> MYLINE
          </button>

          <button
            id="lf-save-project-btn"
            type="button"
            className="lf-btn lf-btn--sm"
            disabled={saving || validationIssues.length > 0}
            onClick={() => void handleSaveProject()}
          >
            <SaveIcon size={14} />
            {saving ? 'Сохранение...' : isSavedCurrent ? 'Сохранено' : 'Сохранить'}
          </button>

          <button
            id="lf-open-library-btn"
            type="button"
            className="lf-btn lf-btn--sm"
            onClick={() => {
              setLibraryOpen(true);
              void refreshLibrary();
            }}
          >
            <FolderIcon size={14} /> Проекты
          </button>
        </div>
      </header>

      {/* Mobile Workbench Switcher */}
      <nav className="lf-mobile-switch" aria-label="Переключение редактора и предпросмотра">
        <div className="lf-segment">
          <button
            id="lf-mobile-form-tab"
            type="button"
            className="lf-segment-btn"
            aria-pressed={mobilePane === 'form'}
            onClick={() => setMobilePane('form')}
          >
            Форма запроса
          </button>
          <button
            id="lf-mobile-preview-tab"
            type="button"
            className="lf-segment-btn"
            aria-pressed={mobilePane === 'preview'}
            onClick={() => setMobilePane('preview')}
          >
            Предпросмотр / PDF
          </button>
        </div>
      </nav>

      {/* Main Split Workbench */}
      <main className="lf-main">
        <div className={`lf-editor-col${mobilePane === 'preview' ? ' lf-pane--hidden-mobile' : ''}`}>
          {/* Step 1: Photos */}
          <PhotoManager
            snapshot={snapshot}
            photoUrls={photoUrls}
            uploadErrors={uploadErrors}
            onDismissUploadErrors={() => setUploadErrors([])}
            apiPhotoError={apiPhotoError}
            onAddFiles={files => {
              const prevIds = new Set(snapshot.project.photos.map(photo => photo.id));
              const result = addPhotosToSnapshot(snapshot, files);
              setSnapshot(result.snapshot);
              setUploadErrors(result.errors);
              const addedIds = result.snapshot.project.photos
                .filter(photo => !prevIds.has(photo.id))
                .map(photo => photo.id);
              if (addedIds.length > 0) {
                cancelInFlightAnalysis('Запрос анализа отменён: добавлены новые фотографии.');
                setSelectedPhotoIds(current =>
                  syncSelectedPhotoIds(current, result.snapshot.project.photos, addedIds),
                );
                showToast('Оригиналы фотографий добавлены');
              }
            }}
            onRemovePhoto={photoId => {
              const nextSnapshot = removePhotoFromSnapshot(snapshot, photoId);
              setSnapshot(nextSnapshot);
              if (selectedPhotoIds.includes(photoId)) {
                cancelInFlightAnalysis('Запрос анализа отменён: удалено выбранное фото.');
              }
              setSelectedPhotoIds(current => syncSelectedPhotoIds(current, nextSnapshot.project.photos));
              if (nextSnapshot.project.photos.length === 0) {
                resetPhotoAnalysis([]);
              }
            }}
            onSelectPrimary={photoId => setSnapshot(current => setPrimaryPhoto(current, photoId))}
          />

          {/* Step 2: Photo Analysis & Suggestion Review (/api/photo-analysis v1) */}
          <PhotoAnalysisPanel
            snapshot={snapshot}
            photoUrls={photoUrls}
            unit={unit}
            provider={photoAnalysisProvider}
            selectedPhotoIds={selectedPhotoIds}
            onTogglePhotoSelection={handleTogglePhotoSelection}
            onSelectAllPhotos={handleSelectAllPhotos}
            onClearPhotoSelection={handleClearPhotoSelection}
            status={analysisStatus}
            mode={analysisMode}
            analyzedPhotos={analyzedPhotos}
            selectionStale={analysisSelectionStale}
            cancelledNotice={analysisCancelledNotice}
            error={analysisError}
            summaryNote={analysisSummary}
            warnings={analysisWarnings}
            suggestions={analysisSuggestions}
            isPreviewDemo={analysisPreviewDemo}
            stepSkipped={analysisStepSkipped}
            onRunAnalysis={() => void handleRunPhotoAnalysis()}
            onCancelAnalysis={handleCancelPhotoAnalysis}
            onLoadPreviewDemo={handleLoadPreviewDemo}
            onClearSuggestions={() => {
              setAnalysisSuggestions([]);
              setAnalysisPreviewDemo(false);
              setAnalysisError(null);
              setAnalysisStatus(analysisMode ? 'ready' : 'idle');
            }}
            onSkipStep={() => {
              cancelInFlightAnalysis();
              setAnalysisStepSkipped(true);
              showToast('Шаг анализа фото пропущен');
            }}
            onRestoreStep={() => setAnalysisStepSkipped(false)}
            onAcceptSuggestion={handleAcceptSuggestion}
            onEditSuggestion={handleEditSuggestion}
            onSkipSuggestion={handleSkipSuggestion}
            onRestoreSuggestion={handleRestoreSuggestion}
            onAcceptAllEmpty={handleAcceptAllEmpty}
          />

          {/* Step 3: Order & Core Project Parameters */}
          <section className="lf-card" aria-labelledby="project-heading">
            <div className="lf-card-header">
              <div className="lf-card-title-wrap">
                <span className="lf-card-eyebrow">Шаг 3 · Заказ и тип изделия</span>
                <h1 id="project-heading" className="lf-card-title">
                  Основные параметры запроса
                </h1>
              </div>
              <span className="lf-badge lf-badge--user">
                {productTypes[snapshot.project.kind][0]}
              </span>
            </div>

            <div className="lf-card-body">
              <div className="lf-grid-2">
                <div className="lf-field">
                  <label className="lf-label" htmlFor="lf-project-name">
                    Название проекта / светильника
                  </label>
                  <input
                    id="lf-project-name"
                    type="text"
                    className={`lf-input${nameError ? ' lf-input--error' : ''}`}
                    value={snapshot.project.name}
                    maxLength={120}
                    placeholder="Например: MYLINE"
                    onChange={event => updateProject(p => ({ ...p, name: event.target.value }))}
                  />
                  {nameError && <span className="lf-field-error">{nameError}</span>}
                </div>

                <div className="lf-field">
                  <label className="lf-label" htmlFor="lf-project-code">
                    Код / артикул проекта
                  </label>
                  <input
                    id="lf-project-code"
                    type="text"
                    className="lf-input mono"
                    value={snapshot.project.code}
                    maxLength={80}
                    placeholder="Оставьте пустым → на подтверждение"
                    onChange={event => updateProject(p => ({ ...p, code: event.target.value }))}
                  />
                </div>
              </div>

              <div className="lf-grid-3">
                <div className="lf-field">
                  <label className="lf-label" htmlFor="lf-project-kind">
                    Тип светильника
                  </label>
                  <select
                    id="lf-project-kind"
                    className="lf-select"
                    value={snapshot.project.kind}
                    onChange={event =>
                      updateProject(p => ({ ...p, kind: event.target.value as ProductType }))
                    }
                  >
                    {productTypeKeys.map(key => (
                      <option key={key} value={key}>
                        {productTypes[key][0]} ({productTypes[key][1]})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="lf-field">
                  <label className="lf-label" htmlFor="lf-order-qty">
                    Количество заказа
                  </label>
                  <input
                    id="lf-order-qty"
                    type="number"
                    min={1}
                    max={1000000}
                    step={1}
                    className={`lf-input num${qtyError ? ' lf-input--error' : ''}`}
                    value={snapshot.project.orderQuantity}
                    onChange={event => {
                      const parsed = Number.parseInt(event.target.value, 10);
                      if (Number.isFinite(parsed) && parsed >= 1) {
                        updateProject(p => ({ ...p, orderQuantity: parsed }));
                      }
                    }}
                  />
                  {qtyError && <span className="lf-field-error">{qtyError}</span>}
                </div>

                <div className="lf-field">
                  <label className="lf-label" htmlFor="lf-currency">
                    Валюта расчёта
                  </label>
                  <select
                    id="lf-currency"
                    className="lf-select mono"
                    value={snapshot.project.currency}
                    onChange={event =>
                      updateProject(p => ({
                        ...p,
                        currency: event.target.value as Project['currency'],
                      }))
                    }
                  >
                    {currencies.map(cur => (
                      <option key={cur} value={cur}>
                        {cur}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Strict Materials switch */}
              <div className={`lf-toggle-card${snapshot.project.strictMaterials ? ' lf-toggle-card--active' : ''}`}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontWeight: 600, fontSize: 13.5, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <ShieldIcon size={15} style={{ color: snapshot.project.strictMaterials ? 'var(--brass)' : 'var(--ink-muted)' }} />
                    Strict Materials — запрет замен без письменного согласия
                  </span>
                  <span className="lf-field-hint">
                    Добавляет в RFQ явное требование согласовывать любые замены материалов письменно.
                  </span>
                </div>
                <button
                  id="lf-strict-materials-switch"
                  type="button"
                  role="switch"
                  aria-checked={snapshot.project.strictMaterials}
                  aria-label="Строгие материалы без замен"
                  className="lf-switch"
                  onClick={() => updateProject(p => ({ ...p, strictMaterials: !p.strictMaterials }))}
                >
                  <span className="lf-switch-thumb" />
                </button>
              </div>
            </div>
          </section>

          {/* Step 3: Components (Dimensions, Light, Materials) */}
          <ComponentEditor
            project={snapshot.project}
            activeComponentId={activeComponentId}
            onSelectComponent={setActiveComponentId}
            onAddComponent={() => {
              const result = addComponentToProject(snapshot.project);
              setSnapshot(current => ({ ...current, project: result.project }));
              setActiveComponentId(result.componentId);
            }}
            onRemoveComponent={componentId => {
              const nextProject = removeComponentFromProject(snapshot.project, componentId);
              setSnapshot(current => ({ ...current, project: nextProject }));
              if (activeComponentId === componentId) {
                setActiveComponentId(nextProject.components[0].id);
              }
            }}
            onUpdateComponent={(componentId, updater) =>
              updateProject(project => updateComponentInProject(project, componentId, updater))
            }
            unit={unit}
            issues={combinedIssues}
          />

          {/* Step 4: Mounting levels & placements (Progressive disclosure) */}
          <MountingSection
            project={snapshot.project}
            unit={unit}
            open={mountingOpen}
            onToggleOpen={() => setMountingOpen(prev => !prev)}
            onChangeMounting={updater =>
              updateProject(project => ({ ...project, mounting: updater(project.mounting) }))
            }
            onAddPlacement={() =>
              updateProject(project => addPlacementToProject(project, activeComponentId))
            }
            onPruneExcessPlacements={() => updateProject(project => pruneExcessPlacements(project))}
            issues={combinedIssues}
          />

          {/* Step 6: Notes & Quick CTA Footer */}
          <section className="lf-card" aria-labelledby="notes-heading">
            <button
              id="lf-notes-toggle"
              type="button"
              className={`lf-card-header lf-card-header--collapsible${notesOpen ? ' lf-card-header--open' : ''}`}
              aria-expanded={notesOpen}
              onClick={() => setNotesOpen(prev => !prev)}
            >
              <div className="lf-card-title-wrap">
                <span className="lf-card-eyebrow">Шаг 6 · Комментарий фабрике</span>
                <h2 id="notes-heading" className="lf-card-title">
                  Дополнительные примечания
                </h2>
                <p className="lf-card-desc">
                  {snapshot.project.notes
                    ? `${snapshot.project.notes.slice(0, 90)}${snapshot.project.notes.length > 90 ? '…' : ''}`
                    : 'Опционально: требования к упаковке, образцам, маркировке или срокам'}
                </p>
              </div>
              <span className="lf-badge lf-badge--unknown num">{snapshot.project.notes.length} / 1000</span>
            </button>

            {notesOpen && (
              <div className="lf-card-body">
                <div className="lf-field">
                  <label className="lf-label" htmlFor="lf-project-notes">
                    Текст примечания (передаётся в раздел Additional project notes)
                  </label>
                  <textarea
                    id="lf-project-notes"
                    className="lf-textarea"
                    maxLength={1000}
                    value={snapshot.project.notes}
                    placeholder="Укажите дополнительные технические или логистические требования..."
                    onChange={event => updateProject(p => ({ ...p, notes: event.target.value }))}
                  />
                </div>
              </div>
            )}
          </section>

          {/* Bottom Form Action Bar */}
          <div
            className="lf-card"
            style={{
              padding: '14px 18px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <strong style={{ fontSize: 13.5 }}>Готово к отправке в Quick RFQ API</strong>
              <span className="lf-field-hint">
                Язык: {language.toUpperCase()} · Фото: {snapshot.project.photos.length} · Компонентов:{' '}
                {snapshot.project.components.length}
              </span>
            </div>
            <button
              id="lf-bottom-create-rfq-btn"
              type="button"
              className="lf-btn lf-btn--primary"
              disabled={validationIssues.length > 0 || pdfStatus === 'loading'}
              onClick={() => void generatePdf(language)}
            >
              <FilePdfIcon size={15} />
              Создать запрос PDF ({language.toUpperCase()})
            </button>
          </div>
        </div>

        {/* Right Sticky Preview Panel (direct grid item for full-height sticky behavior) */}
        <RfqPreviewPanel
          className={mobilePane === 'form' ? 'lf-pane--hidden-mobile' : undefined}
          snapshot={snapshot}
          photoUrls={photoUrls}
          composition={linkedComposition}
          onDetachComposition={() => {
            setLinkedComposition(undefined);
            setPdfError(null);
            setTextError(null);
          }}
          language={language}
          onChangeLanguage={handleChangeLanguage}
          activeTab={previewTab}
          onChangeTab={handleChangePreviewTab}
          validationIssues={combinedIssues}
          pdfState={{
            status: pdfStatus,
            url: pdfUrl,
            filename: pdfFilename,
            isStale: Boolean(pdfUrl && pdfFingerprint !== currentFingerprint),
            error: pdfError,
          }}
          textState={{
            status: textStatus,
            text: serverText,
            isStale: Boolean(serverText && textFingerprint !== currentFingerprint),
            error: textError,
          }}
          onGeneratePdf={() => void generatePdf(language)}
          onGenerateText={() => void generateText(language)}
        />
      </main>

      {/* Saved Projects & Archive Modal */}
      <ProjectLibraryModal
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        currentProjectId={snapshot.project.id}
        savedProjects={savedProjects}
        loading={libraryLoading}
        onOpenProject={id => void handleOpenSavedProject(id)}
        onDeleteProject={id => void handleDeleteSavedProject(id)}
        onExportCurrent={() => void handleExportArchive()}
        onImportArchive={file => void handleImportArchive(file)}
        linkedComposition={linkedComposition}
        onLinkComposition={comp => {
          setLinkedComposition(comp);
          showToast(comp ? `Подключена композиция «${comp.name}»` : 'Композиция отвязана');
        }}
      />

      {toast && (
        <div className="lf-toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  );
}
