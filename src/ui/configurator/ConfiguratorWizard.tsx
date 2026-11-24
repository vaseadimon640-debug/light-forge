'use client';

import './wizard.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { GeminiDrawingAnalysis, GeminiPhotoAnalysis } from '@/ai/gemini-contract';
import { createMyline } from '@/domain/myline';
import { newProject, projectSchema, type Project } from '@/domain/project';
import { openProjectStore, type ProjectSnapshot } from '@/storage/projects';
import {
  applyGeminiProposals,
  buildDrawingProposals,
  buildPhotoProposals,
  GeminiClientError,
  requestGeminiDrawingAnalysis,
  requestGeminiPhotoAnalysis,
} from '../quick-rfq/geminiAutofill';
import { removePhotoFromSnapshot, setPrimaryPhoto } from '../quick-rfq/helpers';
import { UploadStage } from './UploadStage';
import {
  DimensionsStage,
  InstallationStage,
  LightingStage,
  MaterialsStage,
  Review3DStage,
} from './WizardSecondaryStages';
import {
  commitWizardProject,
  computeStepBadges,
  createWizardHistory,
  processWizardUploads,
  redoWizardHistory,
  undoWizardHistory,
  WIZARD_STEPS,
  type AttachedDrawing,
  type WizardStepId,
} from './wizardState';

export function ConfiguratorWizard() {
  const searchParams = useSearchParams();
  const requestedProjectId = searchParams.get('rfqProject');
  const requestedNew = searchParams.get('new') === '1';

  const [history, setHistory] = useState(() => createWizardHistory(newProject()));
  const [originals, setOriginals] = useState<Record<string, Blob>>({});
  const [drawings, setDrawings] = useState<AttachedDrawing[]>([]);
  const [step, setStep] = useState<WizardStepId>('upload');
  const [manualFields, setManualFields] = useState<Set<string>>(() => new Set());

  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [searchOriginals, setSearchOriginals] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisStageText, setAnalysisStageText] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<{ code: string; message: string } | null>(null);
  const [aiPhoto, setAiPhoto] = useState<GeminiPhotoAnalysis | null>(null);
  const [aiDrawing, setAiDrawing] = useState<GeminiDrawingAnalysis | null>(null);
  const [installationMode, setInstallationMode] = useState<'standard' | 'advanced'>('standard');

  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [hydrated, setHydrated] = useState(false);
  const dirtyRef = useRef(false);

  const project = history.present;
  const snapshot: ProjectSnapshot = useMemo(() => ({ project, originals }), [project, originals]);

  // Object URLs for uploaded photos (revoked cleanly on change/unmount)
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const urlMapRef = useRef<Record<string, string>>({});
  useEffect(() => {
    for (const url of Object.values(urlMapRef.current)) URL.revokeObjectURL(url);
    const next: Record<string, string> = {};
    for (const p of project.photos) {
      const blob = originals[p.id];
      if (blob) next[p.id] = URL.createObjectURL(blob);
    }
    urlMapRef.current = next;
    setPhotoUrls(next);
    return () => {
      for (const url of Object.values(urlMapRef.current)) URL.revokeObjectURL(url);
      urlMapRef.current = {};
    };
  }, [originals, project.photos]);

  // Load requested saved project via ?rfqProject=ID
  useEffect(() => {
    let active = true;
    async function hydrate() {
      if (requestedProjectId && !requestedNew) {
        try {
          const store = await openProjectStore();
          try {
            const existing = await store.get(requestedProjectId);
            if (!active) return;
            if (existing) {
              setHistory(createWizardHistory(existing.project));
              setOriginals(existing.originals);
              setInstallationMode(
                existing.project.mounting.ceilingFromFloorMm ||
                  existing.project.mounting.tabletopFromFloorMm ||
                  existing.project.components.length > 1
                  ? 'advanced'
                  : 'standard',
              );
              setSaveState('saved');
              dirtyRef.current = false;
            }
          } finally {
            store.close();
          }
        } catch {
          // Keep clean new project if IndexedDB read fails
        }
      }
      if (active) setHydrated(true);
    }
    void hydrate();
    return () => {
      active = false;
    };
  }, [requestedNew, requestedProjectId]);

  const persistSnapshot = useCallback(async (target: ProjectSnapshot) => {
    const valid = projectSchema.safeParse(target.project);
    if (!valid.success) {
      setSaveState('error');
      return;
    }
    setSaveState('saving');
    try {
      const store = await openProjectStore();
      try {
        await store.save({
          project: { ...valid.data, updatedAt: new Date().toISOString() },
          originals: target.originals,
        });
      } finally {
        store.close();
      }
      dirtyRef.current = false;
      setSaveState('saved');
      window.dispatchEvent(new Event('light-forge-project-saved'));
    } catch {
      setSaveState('error');
    }
  }, []);

  // Debounced autosave whenever user edits project
  useEffect(() => {
    if (!hydrated || !dirtyRef.current) return;
    const timer = setTimeout(() => {
      void persistSnapshot({ project, originals });
    }, 650);
    return () => clearTimeout(timer);
  }, [hydrated, originals, persistSnapshot, project]);

  const handleUpdateProject = useCallback(
    (mutator: (p: Project) => Project, touchedKey?: string) => {
      dirtyRef.current = true;
      setSaveState('idle');
      if (touchedKey) {
        setManualFields((prev) => new Set(prev).add(touchedKey));
      }
      setHistory((prev) => commitWizardProject(prev, mutator(prev.present)));
    },
    [],
  );

  const handleUndo = useCallback(() => {
    dirtyRef.current = true;
    setHistory((prev) => undoWizardHistory(prev));
  }, []);

  const handleRedo = useCallback(() => {
    dirtyRef.current = true;
    setHistory((prev) => redoWizardHistory(prev));
  }, []);

  // Keyboard shortcuts for Undo (Ctrl+Z) & Redo (Ctrl+Y / Ctrl+Shift+Z)
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) handleRedo();
        else handleUndo();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        handleRedo();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleRedo, handleUndo]);

  const handleAddFiles = useCallback(
    (files: File[]) => {
      const res = processWizardUploads(snapshot, drawings, files);
      setUploadErrors(res.errors);
      if (res.addedDrawings.length > 0) {
        setDrawings((prev) => [...prev, ...res.addedDrawings]);
      }
      if (res.addedPhotoCount > 0) {
        dirtyRef.current = true;
        setOriginals(res.snapshot.originals);
        setHistory((prev) => commitWizardProject(prev, res.snapshot.project));
      }
      setAnalysisError(null);
    },
    [drawings, snapshot],
  );

  const handleSelectPrimaryPhoto = useCallback(
    (photoId: string) => {
      dirtyRef.current = true;
      const next = setPrimaryPhoto(snapshot, photoId);
      setHistory((prev) => commitWizardProject(prev, next.project));
    },
    [snapshot],
  );

  const handleRemovePhoto = useCallback(
    (photoId: string) => {
      dirtyRef.current = true;
      const next = removePhotoFromSnapshot(snapshot, photoId);
      setOriginals(next.originals);
      setHistory((prev) => commitWizardProject(prev, next.project));
    },
    [snapshot],
  );

  const handleRemoveDrawing = useCallback((drawingId: string) => {
    setDrawings((prev) => prev.filter((d) => d.id !== drawingId));
  }, []);

  const handleLoadMylinePreset = useCallback(() => {
    const myline = createMyline();
    dirtyRef.current = true;
    setOriginals({});
    setDrawings([]);
    setAiPhoto(null);
    setAiDrawing(null);
    setManualFields(new Set());
    setInstallationMode('advanced');
    setHistory(createWizardHistory(myline));
    setStep('dimensions');
  }, []);

  const handleRecognizeAndFill = useCallback(async () => {
    const primaryPhoto =
      project.photos.find((p) => p.id === project.primaryPhotoId) ?? project.photos[0];
    const firstDrawing = drawings[0];

    if (!primaryPhoto && !firstDrawing) return;

    setAnalyzing(true);
    setAnalysisError(null);
    let workingProject = project;
    let nextPhotoRes: GeminiPhotoAnalysis | null = aiPhoto;
    let nextDrawingRes: GeminiDrawingAnalysis | null = aiDrawing;

    try {
      if (primaryPhoto && originals[primaryPhoto.id]) {
        setAnalysisStageText(`Отправка фото «${primaryPhoto.name}» в Gemini Vision…`);
        nextPhotoRes = await requestGeminiPhotoAnalysis(
          originals[primaryPhoto.id],
          primaryPhoto.name,
        );
        setAiPhoto(nextPhotoRes);
        const photoProposals = buildPhotoProposals(workingProject, nextPhotoRes, manualFields);
        const safeAutoIds = new Set(
          photoProposals.filter((item) => item.defaultChecked).map((item) => item.id),
        );
        workingProject = applyGeminiProposals(workingProject, photoProposals, safeAutoIds).project;
      }

      if (firstDrawing) {
        setAnalysisStageText(`Чтение технического чертежа «${firstDrawing.name}»…`);
        nextDrawingRes = await requestGeminiDrawingAnalysis(firstDrawing.file);
        setAiDrawing(nextDrawingRes);
        const drawingProposals = buildDrawingProposals(workingProject, nextDrawingRes);
        const safeAutoIds = new Set(
          drawingProposals.filter((item) => item.defaultChecked).map((item) => item.id),
        );
        workingProject = applyGeminiProposals(workingProject, drawingProposals, safeAutoIds).project;
      }

      if (workingProject !== project) {
        dirtyRef.current = true;
        setHistory((prev) => commitWizardProject(prev, workingProject));
      }

      setStep('dimensions');
    } catch (error) {
      if (error instanceof GeminiClientError) {
        setAnalysisError({ code: error.code, message: error.message });
      } else {
        setAnalysisError({
          code: 'network_error',
          message: error instanceof Error ? error.message : 'Ошибка анализа Gemini AI.',
        });
      }
    } finally {
      setAnalyzing(false);
      setAnalysisStageText(null);
    }
  }, [aiDrawing, aiPhoto, drawings, manualFields, originals, project]);

  const badges = useMemo(
    () => computeStepBadges(project, drawings.length),
    [drawings.length, project],
  );

  return (
    <div className="lfw-shell" data-wizard-step={step}>
      {/* Slim Top Bar with Autosave + Undo/Redo */}
      <header className="lfw-topbar">
        <div className="lfw-topbar-left">
          <span className="lfw-project-pill" title={project.name}>
            {project.name}
          </span>
          <span
            id="lfw-autosave-badge"
            className={`lfw-save-badge${saveState === 'saved' ? ' lfw-save-badge--saved' : ''}`}
            role="status"
          >
            {saveState === 'saving'
              ? 'Сохранение…'
              : saveState === 'saved'
                ? 'Сохранено'
                : saveState === 'error'
                  ? 'Проверьте поля'
                  : 'Черновик'}
          </span>
        </div>

        <div className="lfw-topbar-actions">
          <button
            id="lfw-undo-btn"
            type="button"
            className="lf-btn lf-btn--subtle lf-btn--sm"
            disabled={history.past.length === 0}
            title="Отменить последнее изменение (Ctrl+Z)"
            onClick={handleUndo}
          >
            ↶ Отменить
          </button>
          <button
            id="lfw-redo-btn"
            type="button"
            className="lf-btn lf-btn--subtle lf-btn--sm"
            disabled={history.future.length === 0}
            title="Повторить изменение (Ctrl+Y)"
            onClick={handleRedo}
          >
            ↷ Повторить
          </button>
          <button
            id="lfw-save-now-btn"
            type="button"
            className="lf-btn lf-btn--subtle lf-btn--sm"
            onClick={() => void persistSnapshot(snapshot)}
          >
            Сохранить
          </button>
        </div>
      </header>

      {/* Clean 6-Step Progress Stepper */}
      <nav className="lfw-stepper-wrap" aria-label="Этапы создания светильника">
        <ol className="lfw-stepper">
          {WIZARD_STEPS.map((item) => {
            const badge = badges[item.id];
            return (
              <li key={item.id}>
                <button
                  id={`lfw-step-${item.id}`}
                  type="button"
                  className="lfw-step-btn"
                  aria-current={step === item.id ? 'step' : undefined}
                  onClick={() => setStep(item.id)}
                >
                  <span className="lfw-step-num" aria-hidden="true">
                    {item.index}
                  </span>
                  <span className="lfw-step-title">{item.shortTitle}</span>
                  {badge && <span className="lfw-step-count">{badge}</span>}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Single Active Stage Canvas */}
      <main className="lfw-stage-container">
        {step === 'upload' && (
          <UploadStage
            project={project}
            photoUrls={photoUrls}
            drawings={drawings}
            uploadErrors={uploadErrors}
            searchOriginals={searchOriginals}
            onToggleSearchOriginals={setSearchOriginals}
            analyzing={analyzing}
            analysisStageText={analysisStageText}
            analysisError={analysisError}
            onAddFiles={handleAddFiles}
            onSelectPrimaryPhoto={handleSelectPrimaryPhoto}
            onRemovePhoto={handleRemovePhoto}
            onRemoveDrawing={handleRemoveDrawing}
            onRecognizeAndFill={() => void handleRecognizeAndFill()}
            onContinueManual={() => setStep('dimensions')}
            onLoadMylinePreset={handleLoadMylinePreset}
          />
        )}

        {step === 'dimensions' && (
          <DimensionsStage
            project={project}
            photoUrls={photoUrls}
            aiPhoto={aiPhoto}
            aiDrawing={aiDrawing}
            onUpdateProject={handleUpdateProject}
            onBack={() => setStep('upload')}
            onNext={() => setStep('materials')}
          />
        )}

        {step === 'materials' && (
          <MaterialsStage
            project={project}
            photoUrls={photoUrls}
            onUpdateProject={handleUpdateProject}
            onBack={() => setStep('dimensions')}
            onNext={() => setStep('lighting')}
          />
        )}

        {step === 'lighting' && (
          <LightingStage
            project={project}
            photoUrls={photoUrls}
            onUpdateProject={handleUpdateProject}
            onBack={() => setStep('materials')}
            onNext={() => setStep('installation')}
          />
        )}

        {step === 'installation' && (
          <InstallationStage
            project={project}
            photoUrls={photoUrls}
            mode={installationMode}
            onModeChange={setInstallationMode}
            onUpdateProject={handleUpdateProject}
            onBack={() => setStep('lighting')}
            onNext={() => setStep('studio3d')}
          />
        )}

        {step === 'studio3d' && (
          <Review3DStage
            project={project}
            photoUrls={photoUrls}
            saving={saveState === 'saving'}
            onSaveProject={() => persistSnapshot(snapshot)}
            onJumpStep={setStep}
            onBack={() => setStep('installation')}
          />
        )}
      </main>
    </div>
  );
}
