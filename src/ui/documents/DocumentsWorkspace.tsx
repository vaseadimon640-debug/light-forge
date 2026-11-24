'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createMyline } from '@/domain/myline';
import { productTypes, type Project } from '@/domain/project';
import type { Composition } from '@/geometry/schema';
import {
  analyzeProjectReadiness,
  buildDetailedRfq,
  type RfqTier,
} from '@/rfq/detailed';
import { buildQuickRfq, localize, RfqConflict, type QuickRfq, type RfqLanguage } from '@/rfq/quick';
import { openCompositionStore, type SavedComposition } from '@/storage/compositions';
import {
  computeDocumentFingerprint,
  openDocumentStore,
  type DocumentRevisionMeta,
  type DocumentStatus,
} from '@/storage/documents';
import { loadStudioPreferences } from '@/storage/preferences';
import { exportProject, openProjectStore, type ProjectSnapshot } from '@/storage/projects';
import {
  AlertIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  EditIcon,
  ExternalLinkIcon,
  FilePdfIcon,
  LayersIcon,
  LinkIcon,
  RefreshIcon,
  ShieldIcon,
  TrashIcon,
} from '../icons';
import {
  formatBytes,
  formatIssuePath,
  languageOptions,
  orderedPhotos,
  requestDetailedRfqPdf,
  requestDetailedRfqText,
  requestQuickRfqPdf,
  requestQuickRfqText,
  validateProject,
  type RfqApiError,
} from '../quick-rfq/helpers';
import './documents.css';

const SAMPLE_PROJECT_ID = '__sample_myline__';
const unknownEn = 'To be confirmed by manufacturer';
const unknownZh = '待制造商确认';

const statusLabels: Record<DocumentStatus, string> = {
  draft: 'Черновик',
  ready: 'Готов к отправке',
  sent: 'Отправлен фабрике',
};

function isUnknownText(value: string): boolean {
  return value.includes(unknownEn) || value.includes(unknownZh);
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

export function DocumentsWorkspace() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [snapshot, setSnapshot] = useState<ProjectSnapshot>(() => ({
    project: createMyline(),
    originals: {},
  }));
  const [isSampleFallback, setIsSampleFallback] = useState(true);

  const [compositions, setCompositions] = useState<SavedComposition[]>([]);
  const [selectedCompositionId, setSelectedCompositionId] = useState<string>('');

  const [tier, setTier] = useState<RfqTier>('detailed');
  const [language, setLanguage] = useState<RfqLanguage>('en-zh');
  const [activeTab, setActiveTab] = useState<'sheet' | 'pdf' | 'text'>('sheet');
  const [releaseNote, setReleaseNote] = useState('');

  useEffect(() => {
    const prefs = loadStudioPreferences();
    setTier(prefs.defaultRfqTier);
    setLanguage(prefs.defaultRfqLanguage);
  }, []);

  // Version history state (IndexedDB)
  const [revisions, setRevisions] = useState<DocumentRevisionMeta[]>([]);
  const [historyScope, setHistoryScope] = useState<'project' | 'all'>('project');
  const [activeRevisionId, setActiveRevisionId] = useState<string | null>(null);
  const [nextRevisionNum, setNextRevisionNum] = useState<number>(1);

  // Generated PDF & Text preview state
  const [pdfStatus, setPdfStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfFilename, setPdfFilename] = useState<string>('');
  const [pdfBannerLabel, setPdfBannerLabel] = useState<string>('');
  const [pdfError, setPdfError] = useState<RfqApiError | null>(null);

  const [textStatus, setTextStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [apiText, setApiText] = useState<string>('');
  const [textError, setTextError] = useState<RfqApiError | null>(null);
  const [copied, setCopied] = useState(false);

  const [notice, setNotice] = useState<string>('');
  const [loadingProjects, setLoadingProjects] = useState(true);

  const pdfUrlRef = useRef<string | null>(null);
  const photoUrlMapRef = useRef<Record<string, string>>({});
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const pdfAbortRef = useRef<AbortController | null>(null);
  const textAbortRef = useRef<AbortController | null>(null);

  const replacePdfUrl = useCallback((nextUrl: string | null) => {
    if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
    pdfUrlRef.current = nextUrl;
    setPdfUrl(nextUrl);
  }, []);

  // Sync object URLs for original reference photos
  useEffect(() => {
    for (const url of Object.values(photoUrlMapRef.current)) {
      URL.revokeObjectURL(url);
    }
    const next: Record<string, string> = {};
    for (const photo of snapshot.project.photos) {
      const blob = snapshot.originals[photo.id];
      if (blob) next[photo.id] = URL.createObjectURL(blob);
    }
    photoUrlMapRef.current = next;
    setPhotoUrls(next);
  }, [snapshot]);

  useEffect(() => {
    return () => {
      pdfAbortRef.current?.abort();
      textAbortRef.current?.abort();
      if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
      for (const url of Object.values(photoUrlMapRef.current)) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  const refreshRevisions = useCallback(
    async (projectId: string, scope: 'project' | 'all') => {
      try {
        const store = await openDocumentStore();
        try {
          const [list, nextNum] = await Promise.all([
            store.list(scope === 'project' ? projectId : undefined),
            store.nextRevisionNumber(projectId),
          ]);
          setRevisions(list);
          setNextRevisionNum(nextNum);
        } finally {
          store.close();
        }
      } catch {
        setRevisions([]);
      }
    },
    [],
  );

  const loadProjectById = useCallback(
    async (id: string, allCompositions: SavedComposition[]) => {
      pdfAbortRef.current?.abort();
      textAbortRef.current?.abort();
      replacePdfUrl(null);
      setPdfStatus('idle');
      setPdfError(null);
      setPdfBannerLabel('');
      setActiveRevisionId(null);
      setApiText('');
      setTextStatus('idle');
      setTextError(null);

      if (!id || id === SAMPLE_PROJECT_ID) {
        const sample = createMyline();
        setSnapshot({ project: sample, originals: {} });
        setSelectedProjectId(SAMPLE_PROJECT_ID);
        setIsSampleFallback(true);
        setSelectedCompositionId('');
        await refreshRevisions(sample.id, historyScope);
        return;
      }

      try {
        const store = await openProjectStore();
        try {
          const found = await store.get(id);
          if (!found) {
            setNotice('Выбранный проект не найден в локальной библиотеке — открыт пример MYLINE.');
            const sample = createMyline();
            setSnapshot({ project: sample, originals: {} });
            setSelectedProjectId(SAMPLE_PROJECT_ID);
            setIsSampleFallback(true);
            setSelectedCompositionId('');
            return;
          }
          setSnapshot(found);
          setSelectedProjectId(found.project.id);
          setIsSampleFallback(false);

          const matchingComp = allCompositions.find(
            item => item.composition.projectId === found.project.id,
          );
          setSelectedCompositionId(matchingComp ? matchingComp.composition.id : '');
          await refreshRevisions(found.project.id, historyScope);
        } finally {
          store.close();
        }
      } catch {
        setNotice('Не удалось загрузить проект из хранилища браузера.');
      }
    },
    [historyScope, replacePdfUrl, refreshRevisions],
  );

  // Initial load: projects, compositions, ?rfqProject=ID query param
  useEffect(() => {
    let active = true;
    async function bootstrap() {
      setLoadingProjects(true);
      let loadedProjects: Project[] = [];
      let loadedCompositions: SavedComposition[] = [];

      try {
        const pStore = await openProjectStore();
        try {
          loadedProjects = await pStore.list();
        } finally {
          pStore.close();
        }
      } catch {
        // IndexedDB unavailable
      }

      try {
        const cStore = await openCompositionStore();
        try {
          loadedCompositions = await cStore.list();
        } finally {
          cStore.close();
        }
      } catch {
        // Optional geometry store
      }

      if (!active) return;
      setProjects(loadedProjects);
      setCompositions(loadedCompositions);

      const urlId = new URLSearchParams(window.location.search).get('rfqProject');
      const targetId =
        urlId && loadedProjects.some(p => p.id === urlId)
          ? urlId
          : loadedProjects[0]?.id ?? SAMPLE_PROJECT_ID;

      await loadProjectById(targetId, loadedCompositions);
      if (active) setLoadingProjects(false);
    }

    void bootstrap();
    return () => {
      active = false;
    };
  }, [loadProjectById]);

  useEffect(() => {
    if (!loadingProjects) {
      void refreshRevisions(snapshot.project.id, historyScope);
    }
  }, [historyScope, loadingProjects, refreshRevisions, snapshot.project.id]);

  const matchingCompositions = useMemo(
    () => compositions.filter(item => item.composition.projectId === snapshot.project.id),
    [compositions, snapshot.project.id],
  );

  const attachedComposition: Composition | undefined = useMemo(
    () =>
      matchingCompositions.find(item => item.composition.id === selectedCompositionId)?.composition,
    [matchingCompositions, selectedCompositionId],
  );

  const validationIssues = useMemo(
    () => validateProject(snapshot.project),
    [snapshot.project],
  );
  const canGenerate = validationIssues.length === 0;

  const readiness = useMemo(
    () => analyzeProjectReadiness(snapshot.project, attachedComposition),
    [snapshot.project, attachedComposition],
  );

  const currentFingerprint = useMemo(
    () => computeDocumentFingerprint(snapshot.project, attachedComposition, tier, language),
    [snapshot.project, attachedComposition, tier, language],
  );

  const previewModel = useMemo((): { model: QuickRfq | null; conflict: string | null } => {
    if (!canGenerate) return { model: null, conflict: null };
    try {
      if (tier === 'detailed') {
        const model = buildDetailedRfq({
          project: snapshot.project,
          ...(attachedComposition ? { composition: attachedComposition } : {}),
          revision: nextRevisionNum,
          ...(releaseNote.trim() ? { releaseNote: releaseNote.trim() } : {}),
        });
        return { model, conflict: null };
      }
      const model = buildQuickRfq(
        attachedComposition
          ? { project: snapshot.project, composition: attachedComposition }
          : { project: snapshot.project },
      );
      return { model, conflict: null };
    } catch (error) {
      if (error instanceof RfqConflict) {
        return { model: null, conflict: error.message };
      }
      return { model: null, conflict: null };
    }
  }, [canGenerate, tier, snapshot.project, attachedComposition, nextRevisionNum, releaseNote]);

  const handleGenerateText = useCallback(async () => {
    if (!canGenerate || previewModel.conflict) return;
    textAbortRef.current?.abort();
    const controller = new AbortController();
    textAbortRef.current = controller;

    setTextStatus('loading');
    setTextError(null);
    setActiveTab('text');

    try {
      const response =
        tier === 'detailed'
          ? await requestDetailedRfqText(
              snapshot,
              language,
              {
                composition: attachedComposition,
                revision: nextRevisionNum,
                releaseNote,
              },
              controller.signal,
            )
          : await requestQuickRfqText(snapshot, language, attachedComposition, controller.signal);

      if (controller.signal.aborted) return;
      setApiText(response.text);
      setTextStatus('ready');
    } catch (err) {
      if (controller.signal.aborted) return;
      setTextError(
        err && typeof err === 'object' && 'status' in err
          ? (err as RfqApiError)
          : {
              status: 0,
              code: 'network_error',
              message: err instanceof Error ? err.message : 'Не удалось получить текст документа.',
              retryable: true,
            },
      );
      setTextStatus('error');
    }
  }, [
    attachedComposition,
    canGenerate,
    language,
    nextRevisionNum,
    previewModel.conflict,
    releaseNote,
    snapshot,
    tier,
  ]);

  const handleIssuePdfAndSaveVersion = useCallback(async () => {
    if (!canGenerate || previewModel.conflict) return;
    pdfAbortRef.current?.abort();
    const controller = new AbortController();
    pdfAbortRef.current = controller;

    setPdfStatus('loading');
    setPdfError(null);
    setActiveTab('pdf');
    setNotice('');

    try {
      const revNumber = nextRevisionNum;
      const result =
        tier === 'detailed'
          ? await requestDetailedRfqPdf(
              snapshot,
              language,
              {
                composition: attachedComposition,
                revision: revNumber,
                releaseNote,
              },
              controller.signal,
            )
          : await requestQuickRfqPdf(snapshot, language, attachedComposition, controller.signal);

      if (controller.signal.aborted) return;

      const store = await openDocumentStore();
      let savedId: string | null = null;
      let savedRev = revNumber;
      try {
        const saved = await store.saveRevision({
          projectId: snapshot.project.id,
          projectName: snapshot.project.name,
          projectCode: snapshot.project.code,
          tier,
          language,
          status: 'draft',
          fingerprint: currentFingerprint,
          compositionId: attachedComposition?.id,
          compositionName: attachedComposition?.name,
          photoCount: snapshot.project.photos.length,
          unknownCount: readiness.unknownItems.length,
          pdfFilename: result.filename,
          pdfBlob: result.blob,
          note: releaseNote,
          revision: revNumber,
        });
        savedId = saved.id;
        savedRev = saved.revision;
      } finally {
        store.close();
      }

      const objectUrl = URL.createObjectURL(result.blob);
      replacePdfUrl(objectUrl);
      setPdfFilename(result.filename);
      setPdfBannerLabel(
        `Версия v${savedRev} · ${tier === 'detailed' ? 'Detailed RFQ' : 'Quick RFQ'} (${language.toUpperCase()}) · ${formatBytes(result.blob.size)}`,
      );
      setPdfStatus('ready');
      setActiveRevisionId(savedId);
      setReleaseNote('');
      setNotice(`Сформирован и сохранён подлинный PDF — версия v${savedRev} (${result.filename}).`);
      await refreshRevisions(snapshot.project.id, historyScope);
    } catch (err) {
      if (controller.signal.aborted) return;
      setPdfError(
        err && typeof err === 'object' && 'status' in err
          ? (err as RfqApiError)
          : {
              status: 0,
              code: 'network_error',
              message: err instanceof Error ? err.message : 'Не удалось сформировать PDF.',
              retryable: true,
            },
      );
      setPdfStatus('error');
    }
  }, [
    attachedComposition,
    canGenerate,
    currentFingerprint,
    historyScope,
    language,
    nextRevisionNum,
    previewModel.conflict,
    readiness.unknownItems.length,
    refreshRevisions,
    releaseNote,
    replacePdfUrl,
    snapshot,
    tier,
  ]);

  const handleOpenSavedRevision = useCallback(
    async (meta: DocumentRevisionMeta) => {
      try {
        const store = await openDocumentStore();
        try {
          const full = await store.get(meta.id);
          if (!full) {
            setNotice('Эта версия документа уже удалена.');
            await refreshRevisions(snapshot.project.id, historyScope);
            return;
          }
          const url = URL.createObjectURL(full.pdfBlob);
          replacePdfUrl(url);
          setPdfFilename(full.pdfFilename);
          setPdfBannerLabel(
            `Архивная версия v${full.revision} · ${full.tier === 'detailed' ? 'Detailed RFQ' : 'Quick RFQ'} (${full.language.toUpperCase()}) · ${formatBytes(full.pdfSizeBytes)}`,
          );
          setPdfError(null);
          setPdfStatus('ready');
          setActiveRevisionId(full.id);
          setActiveTab('pdf');
        } finally {
          store.close();
        }
      } catch {
        setNotice('Не удалось открыть сохранённый PDF из хранилища браузера.');
      }
    },
    [historyScope, refreshRevisions, replacePdfUrl, snapshot.project.id],
  );

  const handleDownloadSavedRevision = useCallback(async (meta: DocumentRevisionMeta) => {
    try {
      const store = await openDocumentStore();
      try {
        const full = await store.get(meta.id);
        if (!full) return;
        triggerDownload(full.pdfBlob, full.pdfFilename);
      } finally {
        store.close();
      }
    } catch {
      setNotice('Не удалось скачать архивный PDF.');
    }
  }, []);

  const handleUpdateRevisionStatus = useCallback(
    async (id: string, status: DocumentStatus) => {
      try {
        const store = await openDocumentStore();
        try {
          await store.updateMeta(id, { status });
        } finally {
          store.close();
        }
        setRevisions(prev => prev.map(item => (item.id === id ? { ...item, status } : item)));
        setNotice(`Статус версии обновлён: ${statusLabels[status]}.`);
      } catch {
        setNotice('Не удалось обновить статус версии.');
      }
    },
    [],
  );

  const handleDeleteRevision = useCallback(
    async (id: string) => {
      try {
        const store = await openDocumentStore();
        try {
          await store.remove(id);
        } finally {
          store.close();
        }
        if (activeRevisionId === id) {
          replacePdfUrl(null);
          setPdfStatus('idle');
          setActiveRevisionId(null);
        }
        setNotice('Версия документа удалена из локального архива.');
        await refreshRevisions(snapshot.project.id, historyScope);
      } catch {
        setNotice('Не удалось удалить версию документа.');
      }
    },
    [activeRevisionId, historyScope, refreshRevisions, replacePdfUrl, snapshot.project.id],
  );

  const handleExportProjectArchive = useCallback(async () => {
    try {
      const blob = await exportProject(snapshot);
      const code = (snapshot.project.code || snapshot.project.name || 'light-forge').replace(
        /[^A-Za-z0-9_-]/g,
        '-',
      );
      triggerDownload(blob, `${code}-project-archive.json`);
      setNotice('Архив проекта с оригиналами фотографий сохранён.');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Не удалось экспортировать архив проекта.');
    }
  }, [snapshot]);

  const handleCopyText = useCallback(async () => {
    if (!apiText) return;
    try {
      await navigator.clipboard.writeText(apiText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard unavailable
    }
  }, [apiText]);

  const ordered = orderedPhotos(snapshot.project);
  const projectLinkSuffix = !isSampleFallback
    ? `?rfqProject=${encodeURIComponent(snapshot.project.id)}`
    : '';

  return (
    <main className="lf-docs-page">
      <header className="lf-docs-header">
        <div>
          <h1>Документы и пакет RFQ</h1>
          <p>
            Отдельное рабочее пространство для выпуска подлинных двуязычных PDF (EN / 中文),
            подготовки Detailed RFQ с BOM и чек-листом подтверждений, а также хранения версий
            документа в браузере.
          </p>
        </div>
        <div className="lf-docs-header-actions">
          <a className="lf-btn" href={`/${projectLinkSuffix}`}>
            <FilePdfIcon size={14} />
            Quick RFQ
          </a>
          <a className="lf-btn lf-btn--subtle" href={`/configure${projectLinkSuffix}`}>
            <EditIcon size={14} />
            Конфигуратор
          </a>
          <a className="lf-btn lf-btn--subtle" href={`/geometry${projectLinkSuffix}`}>
            <LayersIcon size={14} />
            3D Studio
          </a>
        </div>
      </header>

      {/* Project & 3D Composition Context Selector */}
      <section className="atelier-panel lf-docs-context" aria-label="Выбор проекта и 3D-композиции">
        <div className="lf-docs-field">
          <label htmlFor="lf-doc-project-select">Проект для выпуска документа</label>
          <select
            id="lf-doc-project-select"
            className="lf-select"
            value={selectedProjectId}
            disabled={loadingProjects}
            onChange={event => void loadProjectById(event.target.value, compositions)}
          >
            {projects.map(project => (
              <option key={project.id} value={project.id}>
                {project.name}
                {project.code ? ` (${project.code})` : ''} · {productTypes[project.kind][0]}
              </option>
            ))}
            <option value={SAMPLE_PROJECT_ID}>
              Образец MYLINE (эталонный пример для проверки PDF)
            </option>
          </select>
        </div>

        <div className="lf-docs-field">
          <label htmlFor="lf-doc-composition-select">Связанная 3D-композиция</label>
          <select
            id="lf-doc-composition-select"
            className="lf-select"
            value={selectedCompositionId}
            disabled={matchingCompositions.length === 0}
            onChange={event => setSelectedCompositionId(event.target.value)}
          >
            <option value="">
              {matchingCompositions.length > 0
                ? 'Без 3D-композиции (только данные проекта)'
                : 'Нет сохранённых композиций для этого проекта'}
            </option>
            {matchingCompositions.map(item => (
              <option key={item.composition.id} value={item.composition.id}>
                {item.composition.name} ({item.composition.elements.length} элем.,{' '}
                {item.composition.suspensions.length} подв.)
              </option>
            ))}
          </select>
        </div>

        <div className="lf-docs-context-links">
          <button
            id="lf-doc-export-archive-btn"
            type="button"
            className="lf-btn lf-btn--sm"
            onClick={() => void handleExportProjectArchive()}
          >
            <DownloadIcon size={14} />
            Архив JSON
          </button>
        </div>
      </section>

      {notice && (
        <div className="lf-docs-notice" role="status" data-testid="lf-docs-notice">
          {notice}
        </div>
      )}

      {/* Readiness & Data Provenance Audit Card */}
      <section className="atelier-panel lf-docs-audit" aria-labelledby="lf-docs-audit-heading">
        <div className="lf-docs-audit-head">
          <h2 id="lf-docs-audit-heading" className="lf-docs-audit-title">
            <ShieldIcon size={16} />
            Аудит достоверности и готовности спецификации
          </h2>
          <div className="lf-docs-audit-badges">
            <span
              className={`lf-badge ${
                readiness.strictMaterials ? 'lf-badge--documentation' : 'lf-badge--unknown'
              }`}
            >
              {readiness.strictMaterials ? 'Strict Materials: ВКЛ' : 'Замены: стандартно'}
            </span>
            {readiness.hasSolidBrass && (
              <span className="lf-badge lf-badge--accent">Solid Brass (запрет подмен)</span>
            )}
            {readiness.hasGenuineLeather && (
              <span className="lf-badge lf-badge--accent">Genuine Leather (запрет PU/PVC)</span>
            )}
            {attachedComposition && (
              <span className="lf-badge lf-badge--documentation">
                <LinkIcon size={12} /> 3D: {attachedComposition.name}
              </span>
            )}
          </div>
        </div>

        <div className="lf-docs-kpis">
          <div className="lf-docs-kpi lf-docs-kpi--doc">
            <span className="lf-docs-kpi-value" data-testid="lf-kpi-doc">
              {readiness.documentationCount}
            </span>
            <span className="lf-docs-kpi-label">По документации</span>
          </div>
          <div className="lf-docs-kpi">
            <span className="lf-docs-kpi-value" data-testid="lf-kpi-user">
              {readiness.userCount}
            </span>
            <span className="lf-docs-kpi-label">Данные пользователя</span>
          </div>
          <div className="lf-docs-kpi lf-docs-kpi--est">
            <span className="lf-docs-kpi-value" data-testid="lf-kpi-est">
              {readiness.estimatedCount}
            </span>
            <span className="lf-docs-kpi-label">Оценки (проверить)</span>
          </div>
          <div className="lf-docs-kpi lf-docs-kpi--unknown">
            <span className="lf-docs-kpi-value" data-testid="lf-kpi-unknown">
              {readiness.unknownItems.length}
            </span>
            <span className="lf-docs-kpi-label">На подтверждение фабрике</span>
          </div>
          <div className="lf-docs-kpi">
            <span className="lf-docs-kpi-value" data-testid="lf-kpi-photos">
              {readiness.photoCount}
            </span>
            <span className="lf-docs-kpi-label">
              Оригиналов фото · {readiness.totalOrderUnits} шт.
            </span>
          </div>
        </div>

        {readiness.unknownItems.length > 0 && (
          <details className="lf-docs-checklist-details">
            <summary>
              Показать открытые инженерные подтверждения ({readiness.unknownItems.length}) — не
              подменяются фиктивными значениями
            </summary>
            <ol className="lf-docs-checklist">
              {readiness.unknownItems.map((item, idx) => (
                <li key={`${item.category}-${idx}`}>{item.labelRu}</li>
              ))}
            </ol>
          </details>
        )}
      </section>

      {/* Main 2-Column Workspace: Composer + Version History */}
      <div className="lf-docs-grid">
        <section className="lf-docs-composer" aria-label="Формирование и предпросмотр документа">
          <div className="lf-docs-toolbar">
            <div className="lf-docs-toolbar-row">
              <div className="lf-segment" role="group" aria-label="Тип документа RFQ">
                <button
                  id="lf-doc-tier-quick"
                  type="button"
                  className="lf-segment-btn"
                  aria-pressed={tier === 'quick'}
                  onClick={() => setTier('quick')}
                >
                  Quick RFQ
                </button>
                <button
                  id="lf-doc-tier-detailed"
                  type="button"
                  className="lf-segment-btn"
                  aria-pressed={tier === 'detailed'}
                  onClick={() => setTier('detailed')}
                >
                  Detailed RFQ (BOM + Ревизия)
                </button>
              </div>

              <div className="lf-segment" role="group" aria-label="Язык документа">
                {languageOptions.map(option => (
                  <button
                    key={option.id}
                    id={`lf-doc-lang-${option.id}`}
                    type="button"
                    className="lf-segment-btn"
                    aria-pressed={language === option.id}
                    title={option.hint}
                    onClick={() => setLanguage(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="lf-docs-toolbar-row">
              <div className="lf-segment" role="tablist" aria-label="Режим просмотра документа">
                <button
                  id="lf-doc-tab-sheet"
                  type="button"
                  role="tab"
                  className="lf-segment-btn"
                  aria-selected={activeTab === 'sheet'}
                  onClick={() => setActiveTab('sheet')}
                >
                  Спецификация
                </button>
                <button
                  id="lf-doc-tab-pdf"
                  type="button"
                  role="tab"
                  className="lf-segment-btn"
                  aria-selected={activeTab === 'pdf'}
                  onClick={() => setActiveTab('pdf')}
                >
                  PDF A4
                </button>
                <button
                  id="lf-doc-tab-text"
                  type="button"
                  role="tab"
                  className="lf-segment-btn"
                  aria-selected={activeTab === 'text'}
                  onClick={() => {
                    setActiveTab('text');
                    if (textStatus === 'idle' && canGenerate && !previewModel.conflict) {
                      void handleGenerateText();
                    }
                  }}
                >
                  Текст API
                </button>
              </div>

              <span className="lf-field-hint">
                Следующий выпуск: <strong className="mono">v{nextRevisionNum}</strong>
              </span>
            </div>

            <div className="lf-docs-release-row">
              <input
                id="lf-doc-release-note"
                type="text"
                className="lf-input"
                maxLength={400}
                value={releaseNote}
                onChange={event => setReleaseNote(event.target.value)}
                aria-label="Комментарий к версии документа"
                placeholder="Комментарий к версии (например: «Редакция для фабрики — подтвердить DALI и крепление»)"
              />

              <div className="lf-docs-release-actions">
                <button
                  id="lf-doc-issue-pdf-btn"
                  type="button"
                  className="lf-btn lf-btn--primary"
                  disabled={!canGenerate || Boolean(previewModel.conflict) || pdfStatus === 'loading'}
                  onClick={() => void handleIssuePdfAndSaveVersion()}
                >
                  {pdfStatus === 'loading' ? (
                    <RefreshIcon size={14} className="lf-spin" />
                  ) : (
                    <FilePdfIcon size={14} />
                  )}
                  {pdfStatus === 'loading'
                    ? 'Сборка PDF…'
                    : `Выпустить PDF v${nextRevisionNum}`}
                </button>

                {pdfUrl && (
                  <>
                    <a
                      id="lf-doc-download-pdf-link"
                      href={pdfUrl}
                      download={pdfFilename}
                      className="lf-btn lf-btn--sm"
                      style={{ textDecoration: 'none' }}
                    >
                      <DownloadIcon size={14} />
                      Скачать
                    </a>
                    <a
                      href={pdfUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="lf-btn lf-btn--subtle lf-btn--icon"
                      style={{ textDecoration: 'none', width: 32, minWidth: 32, minHeight: 32 }}
                      title="Открыть PDF в новой вкладке"
                      aria-label="Открыть PDF в новой вкладке"
                    >
                      <ExternalLinkIcon size={14} />
                    </a>
                  </>
                )}
              </div>
            </div>

            {!canGenerate && (
              <div className="lf-alert lf-alert--danger" role="alert">
                <div className="lf-alert-content">
                  <AlertIcon size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                  <div>
                    <strong>Есть ошибки заполнения проекта:</strong>{' '}
                    {validationIssues
                      .slice(0, 3)
                      .map(issue => `${formatIssuePath(issue.path, snapshot.project)}: ${issue.message}`)
                      .join(' · ')}
                  </div>
                </div>
              </div>
            )}

            {previewModel.conflict && (
              <div className="lf-alert lf-alert--danger" role="alert">
                <div className="lf-alert-content">
                  <AlertIcon size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>Конфликт проекта и 3D-композиции: {previewModel.conflict}</span>
                </div>
                <button
                  type="button"
                  className="lf-btn lf-btn--sm"
                  onClick={() => setSelectedCompositionId('')}
                >
                  Отвязать 3D
                </button>
              </div>
            )}

            {activeTab === 'pdf' && pdfError && (
              <div className="lf-alert lf-alert--danger" role="alert">
                <div className="lf-alert-content">
                  <AlertIcon size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>{pdfError.message}</span>
                </div>
                {pdfError.retryable && (
                  <button
                    type="button"
                    className="lf-btn lf-btn--sm"
                    onClick={() => void handleIssuePdfAndSaveVersion()}
                  >
                    <RefreshIcon size={13} /> Повторить
                  </button>
                )}
              </div>
            )}

            {activeTab === 'text' && textError && (
              <div className="lf-alert lf-alert--danger" role="alert">
                <div className="lf-alert-content">
                  <AlertIcon size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>{textError.message}</span>
                </div>
                {textError.retryable && (
                  <button
                    type="button"
                    className="lf-btn lf-btn--sm"
                    onClick={() => void handleGenerateText()}
                  >
                    <RefreshIcon size={13} /> Повторить
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="lf-docs-stage">
            {activeTab === 'sheet' &&
              (previewModel.model ? (
                <article
                  className="lf-sheet"
                  aria-label={`Предпросмотр ${tier === 'detailed' ? 'Detailed RFQ' : 'Quick RFQ'}`}
                >
                  <header className="lf-sheet-header">
                    <p className="lf-sheet-brand">LIGHT FORGE</p>
                    <h2 className="lf-sheet-doc-title">
                      {localize(previewModel.model.documentTitle, language)}
                    </h2>
                    <p className="lf-sheet-project">{previewModel.model.title}</p>
                    <p className="lf-sheet-subtitle">
                      {localize(previewModel.model.subtitle, language)}
                    </p>
                  </header>

                  <section className="lf-sheet-section">
                    <h3 className="lf-sheet-h2">
                      {localize(previewModel.model.photoTitle, language)}
                    </h3>
                    {ordered.length > 0 ? (
                      <div>
                        {photoUrls[ordered[0].id] && (
                          <figure style={{ margin: 0 }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={photoUrls[ordered[0].id]}
                              alt={ordered[0].name}
                              className="lf-sheet-photos-primary"
                            />
                            <figcaption className="lf-sheet-figcaption">{ordered[0].name}</figcaption>
                          </figure>
                        )}
                        {ordered.length > 1 && (
                          <div className="lf-sheet-photos-extra">
                            {ordered.slice(1).map(photo => (
                              <figure key={photo.id} style={{ margin: 0 }}>
                                {photoUrls[photo.id] && (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={photoUrls[photo.id]} alt={photo.name} />
                                )}
                                <figcaption className="lf-sheet-figcaption">
                                  {photo.name}
                                </figcaption>
                              </figure>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="lf-sheet-unknown" style={{ margin: 0 }}>
                        {localize(previewModel.model.noPhoto, language)}
                      </p>
                    )}
                  </section>

                  {previewModel.model.sections.map((section, sectionIdx) => (
                    <section key={sectionIdx} className="lf-sheet-section">
                      <h3 className="lf-sheet-h2">{localize(section.title, language)}</h3>
                      <table className="lf-sheet-table">
                        <tbody>
                          {section.rows.map(([cellLabel, cellValue], rowIdx) => {
                            const labelText = localize(cellLabel, language);
                            const valueText = localize(cellValue, language);
                            return (
                              <tr key={rowIdx}>
                                <th scope="row">{labelText}</th>
                                <td className={isUnknownText(valueText) ? 'lf-sheet-unknown' : 'num'}>
                                  {valueText}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </section>
                  ))}

                  <section className="lf-sheet-section" style={{ marginBottom: 0 }}>
                    <h3 className="lf-sheet-h2">
                      {localize(previewModel.model.requestTitle, language)}
                    </h3>
                    <ul className="lf-sheet-requests">
                      {previewModel.model.requested.map((item, idx) => (
                        <li key={idx}>{localize(item, language)}</li>
                      ))}
                    </ul>
                  </section>
                </article>
              ) : (
                <div className="lf-pdf-placeholder">
                  <AlertIcon size={28} style={{ color: 'var(--danger)' }} />
                  <strong>Предпросмотр недоступен</strong>
                  <p className="lf-card-desc">
                    Устраните ошибки заполнения или расхождение с 3D-композицией.
                  </p>
                </div>
              ))}

            {activeTab === 'pdf' &&
              (pdfStatus === 'loading' ? (
                <div className="lf-pdf-placeholder">
                  <RefreshIcon size={28} className="lf-spin" style={{ color: 'var(--accent)' }} />
                  <strong>Сборка печатного PDF A4 ({language.toUpperCase()})…</strong>
                  <p className="lf-card-desc">
                    Запрос к <code>/api/rfq/{tier}?format=pdf&amp;lang={language}</code> с
                    оригиналами фото и двуязычными шрифтами CJK.
                  </p>
                </div>
              ) : pdfUrl ? (
                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div className="lf-docs-pdf-banner" data-testid="lf-docs-pdf-banner">
                    <strong>{pdfBannerLabel}</strong>
                    <span className="mono">{pdfFilename}</span>
                  </div>
                  <iframe
                    id="lf-doc-pdf-iframe"
                    title={`Предпросмотр PDF (${pdfFilename})`}
                    src={pdfUrl}
                    className="lf-pdf-frame"
                  />
                </div>
              ) : (
                <div className="lf-pdf-placeholder">
                  <FilePdfIcon size={32} style={{ color: 'var(--accent)' }} />
                  <strong>PDF для этого просмотра ещё не открыт</strong>
                  <p className="lf-card-desc">
                    Нажмите «Выпустить PDF v{nextRevisionNum}», чтобы собрать подлинный PDF на
                    сервере и сохранить версию, или откройте любую сохранённую версию из истории
                    справа.
                  </p>
                  <button
                    type="button"
                    className="lf-btn lf-btn--primary"
                    disabled={!canGenerate || Boolean(previewModel.conflict)}
                    onClick={() => void handleIssuePdfAndSaveVersion()}
                  >
                    <FilePdfIcon size={15} />
                    Выпустить PDF v{nextRevisionNum} ({language.toUpperCase()})
                  </button>
                </div>
              ))}

            {activeTab === 'text' && (
              <div style={{ width: '100%', maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="lf-docs-toolbar-row">
                  <span className="lf-field-hint">
                    Ответ сервера <code>POST /api/rfq/{tier}?format=text&amp;lang={language}</code>
                  </span>
                  <div style={{ display: 'inline-flex', gap: 6 }}>
                    <button
                      id="lf-doc-refresh-text-btn"
                      type="button"
                      className="lf-btn lf-btn--sm"
                      disabled={!canGenerate || Boolean(previewModel.conflict) || textStatus === 'loading'}
                      onClick={() => void handleGenerateText()}
                    >
                      <RefreshIcon size={13} className={textStatus === 'loading' ? 'lf-spin' : undefined} />
                      Обновить текст
                    </button>
                    <button
                      id="lf-doc-copy-text-btn"
                      type="button"
                      className="lf-btn lf-btn--primary lf-btn--sm"
                      disabled={!apiText}
                      onClick={() => void handleCopyText()}
                    >
                      {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
                      {copied ? 'Скопировано' : 'Копировать'}
                    </button>
                  </div>
                </div>

                {textStatus === 'loading' ? (
                  <div className="lf-pdf-placeholder">
                    <RefreshIcon size={24} className="lf-spin" style={{ color: 'var(--accent)' }} />
                    <span>Загрузка текста документа…</span>
                  </div>
                ) : apiText ? (
                  <pre id="lf-doc-text-output" className="lf-text-pre">
                    {apiText}
                  </pre>
                ) : (
                  <div className="lf-pdf-placeholder">
                    <span>Нажмите «Обновить текст», чтобы получить текст спецификации от API.</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Version History Sidebar */}
        <aside className="lf-docs-history" aria-labelledby="lf-docs-history-heading">
          <div className="lf-docs-history-head">
            <h2 id="lf-docs-history-heading">
              <FilePdfIcon size={16} />
              История версий ({revisions.length})
            </h2>
            <div className="lf-segment" role="group" aria-label="Фильтр истории версий">
              <button
                id="lf-doc-scope-project"
                type="button"
                className="lf-segment-btn"
                aria-pressed={historyScope === 'project'}
                onClick={() => setHistoryScope('project')}
              >
                Проект
              </button>
              <button
                id="lf-doc-scope-all"
                type="button"
                className="lf-segment-btn"
                aria-pressed={historyScope === 'all'}
                onClick={() => setHistoryScope('all')}
              >
                Все
              </button>
            </div>
          </div>

          <p className="lf-field-hint" style={{ margin: 0 }}>
            Каждая выпущенная версия сохраняет точный PDF-файл, полученный от сервера, и статус
            отправки в локальном IndexedDB этого браузера.
          </p>

          {revisions.length === 0 ? (
            <div className="lf-docs-empty" data-testid="lf-docs-empty-history">
              <FilePdfIcon size={26} />
              <strong>Сохранённых версий пока нет</strong>
              <span>
                Нажмите «Выпустить PDF v{nextRevisionNum}», чтобы создать первую зафиксированную
                версию документа.
              </span>
            </div>
          ) : (
            <ul className="lf-docs-rev-list" data-testid="lf-docs-rev-list">
              {revisions.map(item => {
                const isSameProject = item.projectId === snapshot.project.id;
                const matchesCurrentCombo =
                  isSameProject && item.tier === tier && item.language === language;
                const isUpToDate =
                  matchesCurrentCombo && item.fingerprint === currentFingerprint;
                const isStaleForCurrent =
                  matchesCurrentCombo && item.fingerprint !== currentFingerprint;

                return (
                  <li
                    key={item.id}
                    data-revision-id={item.id}
                    data-revision-num={item.revision}
                    className={`lf-docs-rev-card ${
                      activeRevisionId === item.id ? 'lf-docs-rev-card--active' : ''
                    }`}
                  >
                    <div className="lf-docs-rev-top">
                      <div className="lf-docs-rev-pills">
                        <span className="lf-docs-rev-num">v{item.revision}</span>
                        <span
                          className={`lf-badge ${
                            item.tier === 'detailed'
                              ? 'lf-badge--accent'
                              : 'lf-badge--user'
                          }`}
                        >
                          {item.tier === 'detailed' ? 'Detailed RFQ' : 'Quick RFQ'}
                        </span>
                        <span className="lf-badge lf-badge--unknown">
                          {item.language.toUpperCase()}
                        </span>
                        {isUpToDate && (
                          <span className="lf-badge lf-badge--documentation">Актуален</span>
                        )}
                        {isStaleForCurrent && (
                          <span className="lf-badge lf-badge--estimated">Проект изменён</span>
                        )}
                      </div>
                    </div>

                    <p className="lf-docs-rev-title">
                      {item.projectName}
                      {item.projectCode ? ` · ${item.projectCode}` : ''}
                    </p>

                    <div className="lf-docs-rev-meta">
                      <time dateTime={item.createdAt}>
                        {new Date(item.createdAt).toLocaleString('ru-RU', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </time>
                      <span>{formatBytes(item.pdfSizeBytes)}</span>
                      <span>Фото: {item.photoCount}</span>
                      <span>Подтвердить: {item.unknownCount}</span>
                    </div>

                    {item.note && <p className="lf-docs-rev-note">{item.note}</p>}

                    <div className="lf-docs-rev-controls">
                      <select
                        aria-label={`Статус версии v${item.revision}`}
                        className="lf-docs-status-select"
                        value={item.status}
                        onChange={event =>
                          void handleUpdateRevisionStatus(
                            item.id,
                            event.target.value as DocumentStatus,
                          )
                        }
                      >
                        <option value="draft">{statusLabels.draft}</option>
                        <option value="ready">{statusLabels.ready}</option>
                        <option value="sent">{statusLabels.sent}</option>
                      </select>

                      <div className="lf-docs-rev-actions">
                        <button
                          type="button"
                          className="lf-btn lf-btn--sm"
                          onClick={() => void handleOpenSavedRevision(item)}
                        >
                          Открыть
                        </button>
                        <a
                          className="lf-btn lf-btn--sm lf-btn--subtle"
                          href={`/settings?tab=suppliers&rfqProject=${encodeURIComponent(item.projectId)}&revisionId=${encodeURIComponent(item.id)}`}
                          title="Записать КП или ответ фабрики по этой версии"
                        >
                          Фабрика
                        </a>
                        <button
                          type="button"
                          className="lf-btn lf-btn--sm lf-btn--subtle"
                          aria-label={`Скачать PDF v${item.revision}`}
                          onClick={() => void handleDownloadSavedRevision(item)}
                        >
                          <DownloadIcon size={13} />
                        </button>
                        <button
                          type="button"
                          className="lf-btn lf-btn--sm lf-btn--danger"
                          aria-label={`Удалить версию v${item.revision}`}
                          onClick={() => void handleDeleteRevision(item.id)}
                        >
                          <TrashIcon size={13} />
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>
      </div>
    </main>
  );
}
