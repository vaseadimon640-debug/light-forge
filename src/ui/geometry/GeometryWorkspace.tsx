'use client';


import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Project } from '@/domain/project';
import { createGeometryExample, createMylineComposition } from '@/geometry/examples';
import type { ResolvedComposition } from '@/geometry/result';
import type { Composition, Shape } from '@/geometry/schema';
import {
  exportComposition,
  importComposition,
  openCompositionStore,
  type SavedComposition,
} from '@/storage/compositions';
import { openProjectStore } from '@/storage/projects';
import { CanopiesTab, SuspensionsTab } from './CanopiesSuspensionsTab';
import { CompositionLibraryModal } from './CompositionLibraryModal';
import { ElementsTab } from './ElementsTab';
import {
  addCanopyToComposition,
  addElementToComposition,
  addSuspensionToComposition,
  cloneCompositionWithNewId,
  linkCompositionToProject,
  removeCanopyExitFromComposition,
  removeCanopyFromComposition,
  removeElementAttachmentFromComposition,
  removeElementFromComposition,
  resolveCompositionViaApi,
  safeResolveLocal,
  visualMaterialPresets,
  type CameraPreset,
  type GeometryFieldIssue,
  type LightVisualMode,
} from './helpers';
import { LevelsSummaryTab } from './LevelsSummaryTab';
import type { SelectionTarget } from './Scene3D';
import { SceneOutliner } from './SceneOutliner';
import './geometry.css';

const Scene3D = dynamic(() => import('./Scene3D').then(mod => mod.Scene3D), {
  ssr: false,
  loading: () => (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#5a6a70',
        fontSize: 13,
      }}
    >
      Инициализация 3D-сцены React Three Fiber...
    </div>
  ),
});

type InspectorTab = 'elements' | 'canopies' | 'suspensions' | 'levels';

const cameraButtons: { id: CameraPreset; label: string }[] = [
  { id: 'iso', label: '3D' },
  { id: 'top', label: 'Сверху' },
  { id: 'front', label: 'Спереди' },
  { id: 'side', label: 'Сбоку' },
];

export function GeometryWorkspace() {
  const [composition, setComposition] = useState<Composition>(() => createMylineComposition());
  const [activeTab, setActiveTab] = useState<InspectorTab>('elements');
  const [selection, setSelection] = useState<SelectionTarget>(() => ({
    kind: 'element',
    id: 'mount-1',
  }));
  const [selectedElementId, setSelectedElementId] = useState<string>('mount-1');
  const [selectedCanopyId, setSelectedCanopyId] = useState<string | null>(null);
  const [selectedSuspensionId, setSelectedSuspensionId] = useState<string | null>(null);

  // Viewport presentation controls (strictly visual — never mutate canonical geometry data)
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('iso');
  const [cameraTrigger, setCameraTrigger] = useState<number>(0);
  const [materialId, setMaterialId] = useState<string>('satinBrass');
  const [lightMode, setLightMode] = useState<LightVisualMode>('auto');
  const [showAxes, setShowAxes] = useState<boolean>(true);
  const [showDimensions, setShowDimensions] = useState<boolean>(true);
  const [showRoomPlanes, setShowRoomPlanes] = useState<boolean>(true);
  const [compactViewport, setCompactViewport] = useState<boolean>(false);
  const [outlinerOpen, setOutlinerOpen] = useState<boolean>(true);
  const [mobilePane, setMobilePane] = useState<'scene' | 'outliner' | 'inspector'>('scene');

  // Linked RFQ projects + Server API verification & IndexedDB storage
  const [projects, setProjects] = useState<Project[]>([]);
  const [apiStatus, setApiStatus] = useState<{ state: 'idle' | 'checking' | 'ok' | 'error'; message: string }>({
    state: 'idle',
    message: '',
  });
  const [apiIssues, setApiIssues] = useState<GeometryFieldIssue[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [savedItems, setSavedItems] = useState<SavedComposition[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const captureRef = useRef<(() => string | null) | null>(null);
  const lastValidResolvedRef = useRef<ResolvedComposition | null>(null);
  const loadedSavedIdRef = useRef<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(max-width: 768px)');
    const sync = () => setCompactViewport(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // Load saved RFQ projects & honor ?rfqProject=ID handoff
  useEffect(() => {
    let active = true;
    async function loadLinkedContext() {
      let loadedProjects: Project[] = [];
      try {
        const pStore = await openProjectStore();
        try {
          loadedProjects = await pStore.list();
        } finally {
          pStore.close();
        }
      } catch {
        // IndexedDB optional
      }
      if (!active) return;
      setProjects(loadedProjects);

      const urlProjectId = new URLSearchParams(window.location.search).get('rfqProject');
      if (!urlProjectId) return;

      try {
        const cStore = await openCompositionStore();
        try {
          const allComps = await cStore.list();
          if (!active) return;
          const match = allComps.find(item => item.composition.projectId === urlProjectId);
          if (match) {
            loadedSavedIdRef.current = match.composition.id;
            setComposition(match.composition);
            const firstEl = match.composition.elements[0]?.id ?? '';
            setSelectedElementId(firstEl);
            setSelection(firstEl ? { kind: 'element', id: firstEl } : null);
            showToast(`Открыта 3D-композиция «${match.composition.name}» для выбранного проекта`);
            return;
          }
        } finally {
          cStore.close();
        }
      } catch {
        // Ignore geometry store errors
      }

      if (active && loadedProjects.some(p => p.id === urlProjectId)) {
        setComposition(cur => linkCompositionToProject(cur, urlProjectId));
        const target = loadedProjects.find(p => p.id === urlProjectId);
        if (target) showToast(`Композиция привязана к проекту «${target.name}»`);
      }
    }

    void loadLinkedContext();
    return () => {
      active = false;
    };
  }, [showToast]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const localResult = useMemo(() => safeResolveLocal(composition), [composition]);
  if (localResult.resolved) {
    lastValidResolvedRef.current = localResult.resolved;
  }
  const activeResolved = localResult.resolved ?? lastValidResolvedRef.current;
  const activeIssues = localResult.issues.length > 0 ? localResult.issues : apiIssues;
  const compNameErr = activeIssues.find(issue => issue.path.length === 1 && issue.path[0] === 'name')?.message;

  const materialPreset =
    visualMaterialPresets.find(preset => preset.id === materialId) ?? visualMaterialPresets[0];

  const handleSelect3D = useCallback((target: SelectionTarget) => {
    setSelection(target);
    if (!target) return;
    if (target.kind === 'element') {
      setSelectedElementId(target.id);
      setActiveTab('elements');
    } else if (target.kind === 'canopy') {
      setSelectedCanopyId(target.id);
      setActiveTab('canopies');
    } else if (target.kind === 'suspension') {
      setSelectedSuspensionId(target.id);
      setActiveTab('suspensions');
    }
  }, []);

  const loadComposition = useCallback(
    (next: Composition, message: string, openedSavedId: string | null = null) => {
      loadedSavedIdRef.current = openedSavedId;
      setComposition(next);
      const firstEl = next.elements[0]?.id ?? '';
      setSelectedElementId(firstEl);
      setSelectedCanopyId(next.canopies[0]?.id ?? null);
      setSelectedSuspensionId(next.suspensions[0]?.id ?? null);
      setSelection(firstEl ? { kind: 'element', id: firstEl } : null);
      setApiIssues([]);
      setApiStatus({ state: 'idle', message: '' });
      setCameraPreset('iso');
      setCameraTrigger(t => t + 1);
      showToast(message);
    },
    [showToast],
  );

  const handleVerifyApi = useCallback(async () => {
    setApiStatus({ state: 'checking', message: 'Отправка в POST /api/geometry/resolve...' });
    try {
      const result = await resolveCompositionViaApi(composition);
      if (result.ok) {
        setApiIssues([]);
        setApiStatus({
          state: 'ok',
          message: `API 200 OK · элементов: ${result.data.elements.length}, оснований: ${result.data.canopies.length}, подвесов: ${result.data.suspensions.length}.`,
        });
        showToast('Геометрия подтверждена через /api/geometry/resolve');
      } else {
        setApiIssues(result.issues);
        setApiStatus({
          state: 'error',
          message: `API ${result.status} (${result.error}) — исправьте отмеченные поля.`,
        });
      }
    } catch (error) {
      setApiStatus({
        state: 'error',
        message: error instanceof Error ? error.message : 'Ошибка сети при обращении к API.',
      });
    }
  }, [composition, showToast]);

  const refreshLibrary = useCallback(async () => {
    setLibraryLoading(true);
    try {
      const store = await openCompositionStore();
      try {
        setSavedItems(await store.list());
      } finally {
        store.close();
      }
    } catch {
      showToast('Не удалось открыть IndexedDB CompositionStore');
    } finally {
      setLibraryLoading(false);
    }
  }, [showToast]);

  const handleSave = useCallback(
    async (forceNewCopy = false) => {
      if (localResult.issues.length > 0) {
        showToast('Устраните ошибки схемы перед сохранением');
        setActiveTab('levels');
        return;
      }
      try {
        const store = await openCompositionStore();
        try {
          let toSave = composition;
          let savedAsCopyMessage: string | null = null;
          if (forceNewCopy) {
            toSave = cloneCompositionWithNewId(composition);
            savedAsCopyMessage = `Сохранена новая копия «${toSave.name}» (${toSave.id})`;
          } else {
            const existing = await store.get(composition.id);
            if (existing && loadedSavedIdRef.current !== composition.id) {
              toSave = cloneCompositionWithNewId(composition);
              savedAsCopyMessage = `Сохранено с новым ID (${toSave.id}), предыдущая «${existing.composition.name}» сохранена`;
            }
          }
          await store.save(toSave);
          loadedSavedIdRef.current = toSave.id;
          if (toSave.id !== composition.id) {
            setComposition(toSave);
          }
          setSavedItems(await store.list());
          showToast(savedAsCopyMessage ?? `Композиция «${toSave.name}» сохранена в IndexedDB`);
        } finally {
          store.close();
        }
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Ошибка сохранения композиции');
      }
    },
    [composition, localResult.issues.length, showToast],
  );

  const handleOpenSaved = useCallback(
    async (id: string) => {
      try {
        const store = await openCompositionStore();
        try {
          const record = await store.get(id);
          if (record) {
            loadComposition(
              record.composition,
              `Открыта композиция «${record.composition.name}»`,
              record.composition.id,
            );
          }
        } finally {
          store.close();
        }
      } catch {
        showToast('Ошибка загрузки композиции');
      }
    },
    [loadComposition, showToast],
  );

  const handleDeleteSaved = useCallback(
    async (id: string) => {
      try {
        const store = await openCompositionStore();
        try {
          await store.remove(id);
          if (loadedSavedIdRef.current === id) loadedSavedIdRef.current = null;
          setSavedItems(await store.list());
          showToast('Композиция удалена');
        } finally {
          store.close();
        }
      } catch {
        showToast('Ошибка удаления');
      }
    },
    [showToast],
  );

  const handleExportJson = useCallback(() => {
    try {
      const json = exportComposition(composition);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${composition.id}.composition.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast('JSON-файл композиции выгружен');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Не удалось экспортировать JSON');
    }
  }, [composition, showToast]);

  const handleImportJson = useCallback(
    async (file: File) => {
      try {
        const imported = importComposition(await file.text());
        loadComposition(imported, `Импортирована композиция «${imported.name}»`, null);
        setLibraryOpen(false);
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Неверный JSON композиции');
      }
    },
    [loadComposition, showToast],
  );

  const handleCapturePng = useCallback(() => {
    const dataUrl = captureRef.current?.();
    if (!dataUrl) {
      showToast('3D-сцена ещё загружается');
      return;
    }
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `${composition.id}-3d-rfq-preview.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    showToast('Снимок 3D-вида сохранён как PNG для RFQ');
  }, [composition.id, showToast]);

  const handleSaveAndOpenDocuments = useCallback(async () => {
    if (!composition.projectId) return;
    if (localResult.issues.length > 0) {
      showToast('Устраните ошибки геометрии перед переходом к документам');
      setActiveTab('levels');
      setMobilePane('inspector');
      return;
    }
    try {
      const store = await openCompositionStore();
      try {
        await store.save(composition);
        loadedSavedIdRef.current = composition.id;
      } finally {
        store.close();
      }
      window.location.assign(`/documents?rfqProject=${encodeURIComponent(composition.projectId)}`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Не удалось сохранить 3D-композицию');
    }
  }, [composition, localResult.issues.length, showToast]);

  const hasUnknownTabletop = !composition.site.tabletopFromFloorMm;
  const hasEnvelope = composition.elements.some(el => el.shape.type === 'envelope');
  const totalStructureCount =
    composition.elements.length + composition.canopies.length + composition.suspensions.length;

  return (
    <div className="lfg-root">
      {/* Top Bar */}
      <header className="lfg-topbar lf-studio-topbar">
        <div className="lfg-brand-wrap">
          <span className="lfg-brand-mark" aria-hidden="true">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="12" r="7.5" />
              <path d="M12 2.5v3M12 18.5v3M8 12h8" />
            </svg>
          </span>
          <div>
            <div className="lfg-brand-title">LIGHT FORGE</div>
          </div>
        </div>

        <div className="lfg-actions">
          <button
            id="lfg-toggle-outliner"
            type="button"
            className={`lfg-btn lfg-btn--sm${outlinerOpen ? ' lfg-btn--active' : ''}`}
            aria-pressed={outlinerOpen}
            onClick={() => setOutlinerOpen(v => !v)}
          >
            Структура ({totalStructureCount})
          </button>
          <button
            id="lfg-preset-myline"
            type="button"
            className="lfg-btn lfg-btn--brass lfg-btn--sm"
            onClick={() => loadComposition(createMylineComposition(), 'Загружена композиция MYLINE (4 дуги)', null)}
          >
            MYLINE (4 дуги)
          </button>
          <button
            id="lfg-preset-example"
            type="button"
            className="lfg-btn lfg-btn--sm"
            onClick={() =>
              loadComposition(
                createGeometryExample(),
                'Загружен инженерный пример (кольцо, дуга, линейный, трос, ремень)',
                null,
              )
            }
          >
            Инженерный пример
          </button>
          <button
            id="lfg-capture-png-btn"
            type="button"
            className="lfg-btn lfg-btn--sm"
            onClick={handleCapturePng}
          >
            Снимок PNG для RFQ
          </button>
          <button
            id="lfg-save-btn"
            type="button"
            className="lfg-btn lfg-btn--primary lfg-btn--sm"
            onClick={() => void handleSave(false)}
          >
            Сохранить
          </button>
          <button
            id="lfg-library-btn"
            type="button"
            className="lfg-btn lfg-btn--sm"
            onClick={() => {
              setLibraryOpen(true);
              void refreshLibrary();
            }}
          >
            Композиции
          </button>
        </div>
      </header>

      {/* Mobile & Tablet 3-Pane Mode Switcher */}
      <div id="lfg-mobile-mode-bar" className="lfg-mobile-mode-bar">
        <div className="lfg-segment" role="tablist" aria-label="Панели 3D Studio">
          <button
            id="lfg-mobile-pane-scene"
            type="button"
            role="tab"
            className="lfg-seg-btn"
            aria-selected={mobilePane === 'scene'}
            onClick={() => setMobilePane('scene')}
          >
            Сцена 3D
          </button>
          <button
            id="lfg-mobile-pane-outliner"
            type="button"
            role="tab"
            className="lfg-seg-btn"
            aria-selected={mobilePane === 'outliner'}
            onClick={() => setMobilePane('outliner')}
          >
            Структура ({totalStructureCount})
          </button>
          <button
            id="lfg-mobile-pane-inspector"
            type="button"
            role="tab"
            className="lfg-seg-btn"
            aria-selected={mobilePane === 'inspector'}
            onClick={() => setMobilePane('inspector')}
          >
            Свойства
          </button>
        </div>
      </div>

      {/* Main 3-Pane Studio Workspace: Outliner | 3D Scene | Inspector */}
      <main
        className="lfg-workspace lfg-workspace--three-pane"
        data-outliner={outlinerOpen ? 'open' : 'collapsed'}
        data-mobile-pane={mobilePane}
      >
        <SceneOutliner
          composition={composition}
          resolved={activeResolved}
          selection={selection}
          activeTab={activeTab}
          projects={projects}
          onLinkProject={projectId => {
            setComposition(cur => linkCompositionToProject(cur, projectId));
            const found = projects.find(p => p.id === projectId);
            showToast(found ? `Привязано к проекту «${found.name}»` : 'Привязка к проекту снята');
          }}
          onSaveAndOpenDocuments={() => void handleSaveAndOpenDocuments()}
          onSelectElement={id => {
            setSelectedElementId(id);
            setSelection({ kind: 'element', id });
            setActiveTab('elements');
            setMobilePane('inspector');
          }}
          onSelectCanopy={id => {
            setSelectedCanopyId(id);
            setSelection({ kind: 'canopy', id });
            setActiveTab('canopies');
            setMobilePane('inspector');
          }}
          onSelectSuspension={id => {
            setSelectedSuspensionId(id);
            setSelection({ kind: 'suspension', id });
            setActiveTab('suspensions');
            setMobilePane('inspector');
          }}
          onSelectLevels={() => {
            setActiveTab('levels');
            setMobilePane('inspector');
          }}
          onAddElement={shapeType => {
            const next = addElementToComposition(composition, shapeType);
            setComposition(next.composition);
            setSelectedElementId(next.elementId);
            setSelection({ kind: 'element', id: next.elementId });
            setActiveTab('elements');
            setMobilePane('inspector');
          }}
          onAddCanopy={() => {
            const next = addCanopyToComposition(composition, 'round');
            setComposition(next.composition);
            setSelectedCanopyId(next.canopyId);
            setSelection({ kind: 'canopy', id: next.canopyId });
            setActiveTab('canopies');
            setMobilePane('inspector');
          }}
          onAddSuspension={type => {
            const next = addSuspensionToComposition(composition, type);
            if (next.suspensionId) {
              setComposition(next.composition);
              setSelectedSuspensionId(next.suspensionId);
              setSelection({ kind: 'suspension', id: next.suspensionId });
              setActiveTab('suspensions');
              setMobilePane('inspector');
            }
          }}
        />

        {/* Center: Interactive 3D Viewport */}
        <section className="lfg-viewport-pane" aria-label="Интерактивный 3D-просмотр">
          <div className="lfg-canvas-wrap">
            <div className="lfg-canvas-stage">
              {/* Top floating camera & overlay controls */}
              <div className="lfg-hud-top">
                <div className="lfg-hud-group" role="group" aria-label="Виды камеры">
                  {cameraButtons.map(btn => (
                    <button
                      key={btn.id}
                      id={`lfg-cam-${btn.id}`}
                      type="button"
                      className={`lfg-btn lfg-btn--sm${cameraPreset === btn.id ? ' lfg-btn--active' : ''}`}
                      onClick={() => {
                        setCameraPreset(btn.id);
                        setCameraTrigger(t => t + 1);
                      }}
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>

                <div className="lfg-hud-group" role="group" aria-label="Слои визуализации">
                  <button
                    id="lfg-toggle-axes"
                    type="button"
                    className={`lfg-btn lfg-btn--sm${showAxes ? ' lfg-btn--active' : ''}`}
                    aria-pressed={showAxes}
                    onClick={() => setShowAxes(v => !v)}
                  >
                    Оси XYZ
                  </button>
                  <button
                    id="lfg-toggle-dims"
                    type="button"
                    className={`lfg-btn lfg-btn--sm${showDimensions ? ' lfg-btn--active' : ''}`}
                    aria-pressed={showDimensions}
                    onClick={() => setShowDimensions(v => !v)}
                  >
                    Размеры
                  </button>
                  <button
                    id="lfg-toggle-room"
                    type="button"
                    className={`lfg-btn lfg-btn--sm${showRoomPlanes ? ' lfg-btn--active' : ''}`}
                    aria-pressed={showRoomPlanes}
                    onClick={() => setShowRoomPlanes(v => !v)}
                  >
                    Потолок / Стол
                  </button>
                </div>
              </div>

              {activeResolved && (
                <Scene3D
                  resolved={activeResolved}
                  selection={selection}
                  onSelect={handleSelect3D}
                  cameraPreset={cameraPreset}
                  cameraTrigger={cameraTrigger}
                  materialPreset={materialPreset}
                  lightMode={lightMode}
                  showAxes={showAxes}
                  showDimensions={showDimensions}
                  showRoomPlanes={showRoomPlanes}
                  compactViewport={compactViewport}
                  captureRef={captureRef}
                />
              )}
            </div>

            {/* Bottom engineering accuracy caveat (floats on desktop, docks cleanly below canvas on mobile) */}
            <div className="lfg-hud-bottom">
              <div className="lfg-cad-notice">
                <strong>Предпросмотр геометрии (мм)</strong> · Не является производственным CAD-чертежом.
                {hasEnvelope && ' Элементы «Габарит» показаны условной оболочкой.'}
                {hasUnknownTabletop && ' Высота стола не задана — длины подвесов не вычисляются.'}
              </div>
              {localResult.issues.length > 0 && (
                <button
                  type="button"
                  className="lfg-badge lfg-badge--danger"
                  style={{ pointerEvents: 'auto', border: '1px solid var(--danger-border)', padding: '5px 10px' }}
                  onClick={() => setActiveTab('levels')}
                >
                  Ошибок схемы: {localResult.issues.length}
                </button>
              )}
            </div>
          </div>

          {/* Bottom Material & Light Direction Visual Bar */}
          <div className="lfg-material-bar">
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
              <span className="lfg-hint" style={{ fontWeight: 600 }}>Отделка (3D):</span>
              <div className="lfg-swatches" role="group" aria-label="Визуальная отделка модели">
                {visualMaterialPresets.map(preset => (
                  <button
                    key={preset.id}
                    type="button"
                    className={`lfg-swatch${preset.id === materialPreset.id ? ' lfg-swatch--active' : ''}`}
                    style={{ background: preset.swatch }}
                    title={preset.label}
                    aria-label={preset.label}
                    aria-pressed={preset.id === materialPreset.id}
                    onClick={() => setMaterialId(preset.id)}
                  />
                ))}
              </div>
              <span className="lfg-hint">{materialPreset.label}</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <label className="lfg-hint" htmlFor="lfg-light-mode" style={{ fontWeight: 600 }}>
                Свет:
              </label>
              <select
                id="lfg-light-mode"
                className="lfg-select"
                style={{ width: 'auto', minHeight: 32, fontSize: 12, padding: '2px 8px' }}
                value={lightMode}
                onChange={e => setLightMode(e.target.value as LightVisualMode)}
              >
                <option value="auto">Авто (MYLINE верх/низ)</option>
                <option value="down">Вниз</option>
                <option value="up">Вверх</option>
                <option value="both">Вверх и вниз</option>
                <option value="diffuse">Рассеянный</option>
                <option value="off">Выкл</option>
              </select>
            </div>
          </div>
        </section>

        {/* Right: Structured Inspector */}
        <aside className="lfg-inspector" aria-label="Панель параметров композиции">
          <div className="lfg-inspector-head">
            <div className="lfg-field">
              <label className="lfg-label" htmlFor="lfg-comp-name">
                <span>Название композиции</span>
                <span className="lfg-mono" style={{ fontWeight: 500, color: 'var(--ink-muted)' }}>
                  {composition.id}
                </span>
              </label>
              <input
                id="lfg-comp-name"
                type="text"
                className={`lfg-input${compNameErr ? ' lfg-input--err' : ''}`}
                value={composition.name}
                aria-invalid={Boolean(compNameErr)}
                onChange={e => setComposition(cur => ({ ...cur, name: e.target.value }))}
              />
              {compNameErr && <span className="lfg-err-text">{compNameErr}</span>}
            </div>

            <div className="lfg-inspector-tabs" role="tablist" aria-label="Разделы конструктора">
              <button
                id="lfg-tab-elements"
                type="button"
                role="tab"
                className="lfg-inspector-tab"
                aria-selected={activeTab === 'elements'}
                onClick={() => setActiveTab('elements')}
              >
                <span className="lfg-tab-label">Формы</span>
                <span className="lfg-tab-count">{composition.elements.length}</span>
              </button>
              <button
                id="lfg-tab-canopies"
                type="button"
                role="tab"
                className="lfg-inspector-tab"
                aria-selected={activeTab === 'canopies'}
                onClick={() => setActiveTab('canopies')}
              >
                <span className="lfg-tab-label">Основания</span>
                <span className="lfg-tab-count">{composition.canopies.length}</span>
              </button>
              <button
                id="lfg-tab-suspensions"
                type="button"
                role="tab"
                className="lfg-inspector-tab"
                aria-selected={activeTab === 'suspensions'}
                onClick={() => setActiveTab('suspensions')}
              >
                <span className="lfg-tab-label">Подвесы</span>
                <span className="lfg-tab-count">{composition.suspensions.length}</span>
              </button>
              <button
                id="lfg-tab-levels"
                type="button"
                role="tab"
                className="lfg-inspector-tab"
                aria-selected={activeTab === 'levels'}
                onClick={() => setActiveTab('levels')}
              >
                <span className="lfg-tab-label">Уровни</span>
              </button>
            </div>
          </div>

          <div className="lfg-inspector-body">
            {activeTab === 'elements' && (
              <ElementsTab
                composition={composition}
                resolved={activeResolved}
                selectedElementId={selectedElementId}
                onSelectElement={id => {
                  setSelectedElementId(id);
                  setSelection({ kind: 'element', id });
                }}
                onAddElement={(shapeType: Shape['type']) => {
                  const next = addElementToComposition(composition, shapeType);
                  setComposition(next.composition);
                  setSelectedElementId(next.elementId);
                  setSelection({ kind: 'element', id: next.elementId });
                }}
                onRemoveElement={id => {
                  const next = removeElementFromComposition(composition, id);
                  setComposition(next);
                  const first = next.elements[0]?.id ?? '';
                  setSelectedElementId(first);
                  setSelection(first ? { kind: 'element', id: first } : null);
                }}
                onRemoveAttachment={(elementId, attachmentId) => {
                  const { composition: next, removedSuspensions } = removeElementAttachmentFromComposition(
                    composition,
                    elementId,
                    attachmentId,
                  );
                  setComposition(next);
                  if (removedSuspensions > 0) {
                    setSelectedSuspensionId(next.suspensions[0]?.id ?? null);
                    showToast(`Точка крепления удалена вместе со связанными подвесами (${removedSuspensions})`);
                  }
                }}
                onUpdateElement={(id, updater) =>
                  setComposition(cur => ({
                    ...cur,
                    elements: cur.elements.map(el => (el.id === id ? updater(el) : el)),
                  }))
                }
                issues={activeIssues}
              />
            )}

            {activeTab === 'canopies' && (
              <CanopiesTab
                composition={composition}
                resolved={activeResolved}
                selectedCanopyId={selectedCanopyId}
                onSelectCanopy={id => {
                  setSelectedCanopyId(id);
                  setSelection({ kind: 'canopy', id });
                }}
                onAddCanopy={type => {
                  const next = addCanopyToComposition(composition, type);
                  setComposition(next.composition);
                  setSelectedCanopyId(next.canopyId);
                  setSelection({ kind: 'canopy', id: next.canopyId });
                }}
                onRemoveCanopy={id => {
                  const next = removeCanopyFromComposition(composition, id);
                  setComposition(next);
                  setSelectedCanopyId(next.canopies[0]?.id ?? null);
                }}
                onRemoveExit={(canopyId, exitId) => {
                  const { composition: next, removedSuspensions } = removeCanopyExitFromComposition(
                    composition,
                    canopyId,
                    exitId,
                  );
                  setComposition(next);
                  if (removedSuspensions > 0) {
                    setSelectedSuspensionId(next.suspensions[0]?.id ?? null);
                    showToast(`Точка выхода удалена вместе со связанными подвесами (${removedSuspensions})`);
                  }
                }}
                onUpdateCanopy={(id, updater) =>
                  setComposition(cur => ({
                    ...cur,
                    canopies: cur.canopies.map(c => (c.id === id ? updater(c) : c)),
                  }))
                }
                issues={activeIssues}
              />
            )}

            {activeTab === 'suspensions' && (
              <SuspensionsTab
                composition={composition}
                resolved={activeResolved}
                selectedSuspensionId={selectedSuspensionId}
                onSelectSuspension={id => {
                  setSelectedSuspensionId(id);
                  setSelection({ kind: 'suspension', id });
                }}
                onAddSuspension={type => {
                  const next = addSuspensionToComposition(composition, type);
                  if (next.suspensionId) {
                    setComposition(next.composition);
                    setSelectedSuspensionId(next.suspensionId);
                    setSelection({ kind: 'suspension', id: next.suspensionId });
                  }
                }}
                onRemoveSuspension={id => {
                  setComposition(cur => ({
                    ...cur,
                    suspensions: cur.suspensions.filter(s => s.id !== id),
                  }));
                  setSelectedSuspensionId(null);
                }}
                onUpdateSuspension={(id, updater) =>
                  setComposition(cur => ({
                    ...cur,
                    suspensions: cur.suspensions.map(s => (s.id === id ? updater(s) : s)),
                  }))
                }
              />
            )}

            {activeTab === 'levels' && (
              <LevelsSummaryTab
                composition={composition}
                resolved={activeResolved}
                issues={activeIssues}
                onChangeSite={updater => setComposition(cur => ({ ...cur, site: updater(cur.site) }))}
                apiStatus={apiStatus}
                onVerifyApi={() => void handleVerifyApi()}
              />
            )}
          </div>
        </aside>
      </main>

      <CompositionLibraryModal
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        currentId={composition.id}
        items={savedItems}
        loading={libraryLoading}
        onOpen={id => void handleOpenSaved(id)}
        onDelete={id => void handleDeleteSaved(id)}
        onSaveAsCopy={() => void handleSave(true)}
        onExportJson={handleExportJson}
        onImportJson={file => void handleImportJson(file)}
      />

      {toast && (
        <div className="lfg-toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  );
}
