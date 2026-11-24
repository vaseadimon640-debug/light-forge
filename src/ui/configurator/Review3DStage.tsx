'use client';

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Component as ReactComponent, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { resolveComposition } from '@/geometry/resolve';
import type { Composition } from '@/geometry/schema';
import type { RfqTier } from '@/rfq/detailed';
import type { RfqLanguage } from '@/rfq/quick';
import { openCompositionStore } from '@/storage/compositions';
import { computeDocumentFingerprint, openDocumentStore } from '@/storage/documents';
import type { ProjectSnapshot } from '@/storage/projects';
import {
  AlertIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FilePdfIcon,
  LayersIcon,
  RefreshIcon,
  ShieldIcon,
} from '../icons';
import {
  visualMaterialPresets,
  type CameraPreset,
} from '../geometry/helpers';
import type { SelectionTarget } from '../geometry/Scene3D';
import {
  formatIssuePath,
  languageOptions,
  requestDetailedRfqPdf,
  requestDetailedRfqText,
  requestQuickRfqPdf,
  requestQuickRfqText,
} from '../quick-rfq/helpers';
import {
  buildPreviewCompositionFromProject,
  buildReviewAudit,
  mapIssuePathToStep,
} from './installationAnd3d';
import type { WizardStepId } from './wizardState';

const Scene3D = dynamic(() => import('../geometry/Scene3D').then((mod) => mod.Scene3D), {
  ssr: false,
  loading: () => (
    <div className="lfw-3d-placeholder">
      <RefreshIcon size={18} className="lf-spin" />
      <span>Инициализация 3D-предпросмотра…</span>
    </div>
  ),
});

class SceneErrorBoundary extends ReactComponent<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; fallback: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
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
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

const cameraPresets: { id: CameraPreset; label: string }[] = [
  { id: 'iso', label: '3D' },
  { id: 'top', label: 'Сверху' },
  { id: 'front', label: 'Спереди' },
  { id: 'side', label: 'Сбоку' },
];

type Review3DStageProps = {
  snapshot: ProjectSnapshot;
  linkedComposition?: Composition;
  saving: boolean;
  onSaveProject: () => Promise<boolean>;
  onCompositionLinked: (composition: Composition) => void;
  onJumpStep: (step: WizardStepId) => void;
  onBack: () => void;
};

export function Review3DStage({
  snapshot,
  linkedComposition,
  saving,
  onSaveProject,
  onCompositionLinked,
  onJumpStep,
  onBack,
}: Review3DStageProps) {
  const router = useRouter();
  const { project } = snapshot;

  // 3D viewport controls (pure presentation, never mutate project data)
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('iso');
  const [cameraTrigger, setCameraTrigger] = useState(0);
  const [selection, setSelection] = useState<SelectionTarget>(null);
  const [opening3d, setOpening3d] = useState(false);
  const captureRef = useRef<(() => string | null) | null>(null);

  // RFQ export controls
  const [tier, setTier] = useState<RfqTier>('detailed');
  const [language, setLanguage] = useState<RfqLanguage>('en-zh');
  const [releaseNote, setReleaseNote] = useState('');
  const [pdfStatus, setPdfStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfFilename, setPdfFilename] = useState('');
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [showPdfPreview, setShowPdfPreview] = useState(false);

  const [textLoading, setTextLoading] = useState(false);
  const [rfqText, setRfqText] = useState<string | null>(null);
  const [copiedText, setCopiedText] = useState(false);
  const [navBusy, setNavBusy] = useState<string | null>(null);

  const pdfUrlRef = useRef<string | null>(null);
  useEffect(() => {
    return () => {
      if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
    };
  }, []);

  const preview3d = useMemo(() => {
    if (linkedComposition) {
      try {
        return {
          composition: linkedComposition,
          resolved: resolveComposition(linkedComposition),
          isEstimatedPreview: false,
          notes: [] as string[],
        };
      } catch {
        // Fallback to generated preview if linked composition has an issue
      }
    }
    return buildPreviewCompositionFromProject(project);
  }, [linkedComposition, project]);

  const audit = useMemo(
    () => buildReviewAudit(project, linkedComposition),
    [linkedComposition, project],
  );

  // Pick a visual material finish matching project materials when available
  const visualPreset = useMemo(() => {
    const firstMat = project.components[0]?.materials[0];
    if (firstMat?.material === 'solidBrass' || firstMat?.material === 'copper') {
      return visualMaterialPresets.find((p) => p.id === 'satinBrass') ?? visualMaterialPresets[0];
    }
    if (
      firstMat?.material === 'steel' ||
      firstMat?.material === 'stainlessSteel' ||
      firstMat?.material === 'aluminium'
    ) {
      return visualMaterialPresets.find((p) => p.id === 'matteBlack') ?? visualMaterialPresets[0];
    }
    return visualMaterialPresets[0];
  }, [project.components]);

  async function handleSafeNavigate(targetPath: string, key: string) {
    setNavBusy(key);
    try {
      await onSaveProject();
      router.push(targetPath);
    } finally {
      setNavBusy(null);
    }
  }

  async function handleOpen3dStudio() {
    setOpening3d(true);
    try {
      await onSaveProject();
      if (!linkedComposition) {
        try {
          const store = await openCompositionStore();
          try {
            const existing = await store.list();
            const match = existing.find((item) => item.composition.projectId === project.id);
            if (match) {
              onCompositionLinked(match.composition);
            } else {
              await store.save(preview3d.composition);
              onCompositionLinked(preview3d.composition);
            }
          } finally {
            store.close();
          }
        } catch {
          // Non-fatal: still navigate to 3D Studio
        }
      }
      router.push(`/geometry?rfqProject=${encodeURIComponent(project.id)}`);
    } finally {
      setOpening3d(false);
    }
  }

  async function handleGeneratePdf() {
    setPdfStatus('loading');
    setPdfError(null);
    try {
      await onSaveProject();
      let blob: Blob;
      let filename: string;
      let revisionNum: number | undefined;

      try {
        const docStore = await openDocumentStore();
        try {
          revisionNum = await docStore.nextRevisionNumber(project.id);
        } finally {
          docStore.close();
        }
      } catch {
        revisionNum = 1;
      }

      if (tier === 'detailed') {
        const res = await requestDetailedRfqPdf(snapshot, language, {
          composition: linkedComposition,
          revision: revisionNum,
          releaseNote: releaseNote.trim() || undefined,
        });
        blob = res.blob;
        filename = res.filename;
      } else {
        const res = await requestQuickRfqPdf(snapshot, language, linkedComposition);
        blob = res.blob;
        filename = res.filename;
      }

      // Record issued revision cleanly in Document History store
      try {
        const docStore = await openDocumentStore();
        try {
          await docStore.saveRevision({
            projectId: project.id,
            projectName: project.name,
            projectCode: project.code,
            tier,
            language,
            status: 'ready',
            revision: revisionNum ?? 1,
            fingerprint: computeDocumentFingerprint(project, linkedComposition, tier, language),
            compositionId: linkedComposition?.id,
            compositionName: linkedComposition?.name,
            photoCount: project.photos.length,
            unknownCount: audit.openItems.length,
            pdfFilename: filename,
            pdfBlob: blob,
            note: releaseNote.trim() || 'Выпущено из шага 6 Конфигуратора',
          });
        } finally {
          docStore.close();
        }
      } catch {
        // Document history storage is optional
      }

      if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
      const nextUrl = URL.createObjectURL(blob);
      pdfUrlRef.current = nextUrl;
      setPdfUrl(nextUrl);
      setPdfFilename(filename);
      setPdfStatus('ready');
      triggerDownload(blob, filename);
    } catch (err) {
      setPdfStatus('error');
      const message =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: unknown }).message)
          : 'Не удалось сформировать PDF. Проверьте поля проекта и повторите попытку.';
      setPdfError(message);
    }
  }

  async function handleFetchAndCopyText() {
    setTextLoading(true);
    setCopiedText(false);
    setPdfError(null);
    try {
      await onSaveProject();
      const response =
        tier === 'detailed'
          ? await requestDetailedRfqText(snapshot, language, {
              composition: linkedComposition,
              releaseNote: releaseNote.trim() || undefined,
            })
          : await requestQuickRfqText(snapshot, language, linkedComposition);
      setRfqText(response.text);
      try {
        await navigator.clipboard.writeText(response.text);
        setCopiedText(true);
        setTimeout(() => setCopiedText(false), 2400);
      } catch {
        // Clipboard permission denied — text preview still displayed below
      }
    } catch {
      setPdfError('Не удалось получить двуязычный текст RFQ с сервера.');
    } finally {
      setTextLoading(false);
    }
  }

  const linkSuffix = `?rfqProject=${encodeURIComponent(project.id)}`;

  return (
    <section aria-labelledby="lfw-stage6-title" className="lfw-review-stage">
      <div className="lfw-stage-head" style={{ marginBottom: 18 }}>
        <div>
          <h1 id="lfw-stage6-title">Проверка, 3D и запрос фабрике</h1>
          <p>
            Проверьте 3D-предпросмотр, достоверность данных и выпустите двуязычный производственный PDF (EN / 中文) для фабрики.
          </p>
        </div>
        <button
          id="lfw-final-save-btn"
          type="button"
          className="lf-btn lf-btn--subtle"
          disabled={saving}
          onClick={() => void onSaveProject()}
        >
          <CheckIcon size={15} /> {saving ? 'Сохраняем…' : 'Сохранить проект'}
        </button>
      </div>

      {/* Interactive 3D Preview Card */}
      <div className="lfw-panel lfw-3d-panel">
        <div className="lfw-3d-toolbar">
          <div className="lfw-3d-title-wrap">
            <h2 style={{ margin: 0 }}>Интерактивный 3D-предпросмотр</h2>
            <span
              className={`lf-badge ${
                linkedComposition ? 'lf-badge--documentation' : 'lf-badge--estimated'
              }`}
            >
              {linkedComposition
                ? `Связанная 3D-композиция: ${linkedComposition.name}`
                : 'Предпросмотр по параметрам проекта · оценочно'}
            </span>
          </div>

          <div className="lfw-3d-controls">
            <div className="lf-segment" role="group" aria-label="Ракурс 3D-камеры">
              {cameraPresets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="lf-segment-btn"
                  aria-pressed={cameraPreset === preset.id}
                  onClick={() => {
                    setCameraPreset(preset.id);
                    setCameraTrigger((n) => n + 1);
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <button
              id="lfw-open-3d-link"
              type="button"
              className="lf-btn lf-btn--sm"
              disabled={opening3d}
              onClick={() => void handleOpen3dStudio()}
            >
              <LayersIcon size={14} />
              <span>{opening3d ? 'Открываем…' : 'Редактировать в 3D Studio'}</span>
            </button>
          </div>
        </div>

        <div className="lfw-3d-viewport" id="lfw-stage6-3d-viewport">
          <SceneErrorBoundary
            fallback={
              <div className="lfw-3d-placeholder">
                <LayersIcon size={22} />
                <span>3D-сцена недоступна в текущем WebGL-контексте — откройте 3D Studio или выпустите PDF.</span>
              </div>
            }
          >
            <Scene3D
              resolved={preview3d.resolved}
              selection={selection}
              onSelect={setSelection}
              cameraPreset={cameraPreset}
              cameraTrigger={cameraTrigger}
              materialPreset={visualPreset}
              lightMode="auto"
              showAxes={false}
              showDimensions={false}
              showRoomPlanes={true}
              captureRef={captureRef}
            />
          </SceneErrorBoundary>
        </div>

        <div className="lfw-3d-legend">
          <span>
            Элементов в сцене: <strong className="mono">{preview3d.resolved.elements.length}</strong>
          </span>
          <span>
            Потолок:{' '}
            <strong className="mono">
              {project.mounting.ceilingFromFloorMm
                ? `${project.mounting.ceilingFromFloorMm.value} мм`
                : 'не задан'}
            </strong>
          </span>
          <span>
            Столешница:{' '}
            <strong className="mono">
              {project.mounting.tabletopFromFloorMm
                ? `${project.mounting.tabletopFromFloorMm.value} мм`
                : 'не задана'}
            </strong>
          </span>
          <span className="lf-field-hint">Орбита: мышь / 1 палец · Размерные оси и инспектор — в 3D Studio</span>
        </div>

        {preview3d.notes.length > 0 && (
          <div className="lfw-3d-notes">
            {preview3d.notes.map((note) => (
              <span key={note} className="lf-field-hint">
                • {note}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Two-column Readiness Audit + Instant RFQ Release */}
      <div className="lfw-review-grid">
        {/* Left: Readiness & Provenance Audit */}
        <div className="lfw-panel">
          <div className="lfw-stage-head">
            <div>
              <h2 style={{ margin: 0 }}>Готовность спецификации</h2>
              <span className="lf-field-hint">
                {audit.kindLabelRu} · {project.components.length} комп. · Заказ {project.orderQuantity} шт. ({project.currency})
              </span>
            </div>
            <span
              className={`lf-badge ${
                audit.canExportPdf ? 'lf-badge--documentation' : 'lf-badge--danger'
              }`}
            >
              {audit.canExportPdf ? 'Готов к выпуску PDF' : `Ошибок: ${audit.validationIssues.length}`}
            </span>
          </div>

          <div className="lfw-summary-kpis">
            <div className="lfw-kpi">
              <strong>{audit.readiness.documentationCount}</strong>
              <span>По документации</span>
            </div>
            <div className="lfw-kpi">
              <strong>{audit.readiness.userCount}</strong>
              <span>От пользователя</span>
            </div>
            <div className="lfw-kpi">
              <strong>{audit.readiness.estimatedCount}</strong>
              <span>Оценочно</span>
            </div>
            <div className="lfw-kpi">
              <strong>{audit.openItems.length}</strong>
              <span>На подтверждение</span>
            </div>
          </div>

          <div className="lfw-status-row">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <ShieldIcon size={15} /> Strict Materials (NO MATERIAL SUBSTITUTIONS)
            </span>
            <span
              className={`lf-badge ${
                project.strictMaterials ? 'lf-badge--documentation' : 'lf-badge--unknown'
              }`}
            >
              {project.strictMaterials ? 'ВКЛ' : 'ВЫКЛ'}
            </span>
          </div>

          {(audit.readiness.hasSolidBrass || audit.readiness.hasGenuineLeather) && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {audit.readiness.hasSolidBrass && (
                <span className="lf-badge lf-badge--brass">Solid Brass — самостоятельный материал</span>
              )}
              {audit.readiness.hasGenuineLeather && (
                <span className="lf-badge lf-badge--brass">Genuine Leather — натуральная кожа</span>
              )}
            </div>
          )}

          {audit.validationIssues.length > 0 && (
            <div className="lfw-diag-row lfw-diag-row--error" role="alert">
              <AlertIcon size={16} style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ flex: 1 }}>
                <strong>Исправьте ошибки перед выпуском PDF</strong>
                <ul className="lfw-issue-list">
                  {audit.validationIssues.map((issue, idx) => (
                    <li key={`${issue.path.join('.')}-${idx}`}>
                      <span>
                        {formatIssuePath(issue.path, project)}: {issue.message}
                      </span>
                      <button
                        type="button"
                        className="lf-btn lf-btn--sm lf-btn--subtle"
                        onClick={() => onJumpStep(mapIssuePathToStep(issue.path))}
                      >
                        Исправить →
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {audit.mounting.conflictCount > 0 && (
            <div className="lfw-diag-row lfw-diag-row--error" role="alert">
              <AlertIcon size={16} style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ flex: 1 }}>
                <strong>Конфликт монтажных высот ({audit.mounting.conflictCount})</strong>
                <p>Проверьте отметки потолка, столешницы и нижних точек на шаге «Монтаж».</p>
              </div>
              <button
                type="button"
                className="lf-btn lf-btn--sm"
                onClick={() => onJumpStep('installation')}
              >
                К монтажу →
              </button>
            </div>
          )}

          <div className="lfw-open-list-wrap">
            <h3 style={{ margin: '4px 0 8px', fontSize: 13.5 }}>
              Что уйдёт фабрике на подтверждение ({audit.openItems.length})
            </h3>
            {audit.openItems.length === 0 ? (
              <div className="lfw-diag-row lfw-diag-row--ok">
                <CheckIcon size={15} />
                <span>Ключевые разделы заполнены — можно выпускать производственный запрос.</span>
              </div>
            ) : (
              <ul className="lfw-open-list">
                {audit.openItems.slice(0, 8).map((item, idx) => (
                  <li key={`${item.category}-${idx}`} className="lfw-open-item">
                    <span>{item.labelRu}</span>
                    <button
                      type="button"
                      className="lf-btn lf-btn--sm lf-btn--subtle"
                      onClick={() => onJumpStep(item.targetStep)}
                    >
                      Уточнить →
                    </button>
                  </li>
                ))}
                {audit.openItems.length > 8 && (
                  <li className="lf-field-hint" style={{ paddingTop: 4 }}>
                    И ещё {audit.openItems.length - 8} пунктов — полный список включён в Detailed RFQ PDF.
                  </li>
                )}
              </ul>
            )}
          </div>
        </div>

        {/* Right: Instant RFQ PDF & Bilingual Export */}
        <div className="lfw-panel">
          <h2 style={{ margin: 0 }}>Выпуск запроса фабрике (EN / 中文)</h2>
          <p className="lf-field-hint" style={{ margin: 0 }}>
            Проект автоматически сохраняется перед выпуском PDF или переходом в другой раздел.
          </p>

          <div className="lfw-grid-2">
            <div className="lfw-field">
              <span className="lf-label">Формат пакета</span>
              <div className="lf-segment" role="group" aria-label="Уровень документа RFQ">
                <button
                  id="lfw-tier-quick"
                  type="button"
                  className="lf-segment-btn"
                  aria-pressed={tier === 'quick'}
                  onClick={() => setTier('quick')}
                >
                  Quick RFQ
                </button>
                <button
                  id="lfw-tier-detailed"
                  type="button"
                  className="lf-segment-btn"
                  aria-pressed={tier === 'detailed'}
                  onClick={() => setTier('detailed')}
                >
                  Detailed RFQ
                </button>
              </div>
            </div>

            <div className="lfw-field">
              <span className="lf-label">Язык документа</span>
              <div className="lf-segment" role="group" aria-label="Язык документа RFQ">
                {languageOptions.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className="lf-segment-btn"
                    aria-pressed={language === opt.id}
                    onClick={() => setLanguage(opt.id)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {tier === 'detailed' && (
            <div className="lfw-field">
              <label htmlFor="lfw-release-note">Комментарий к ревизии (необязательно)</label>
              <input
                id="lfw-release-note"
                type="text"
                maxLength={400}
                placeholder="Например: Первичный запрос цены и срока с подтверждением отделки"
                value={releaseNote}
                onChange={(e) => setReleaseNote(e.target.value)}
              />
            </div>
          )}

          <div className="lfw-export-actions">
            <button
              id="lfw-generate-pdf-btn"
              type="button"
              className="lf-btn lf-btn--primary"
              disabled={!audit.canExportPdf || pdfStatus === 'loading'}
              onClick={() => void handleGeneratePdf()}
            >
              <FilePdfIcon size={15} />
              <span>
                {pdfStatus === 'loading'
                  ? 'Формируем PDF A4…'
                  : `Сформировать и скачать ${tier === 'detailed' ? 'Detailed' : 'Quick'} RFQ PDF`}
              </span>
            </button>

            <button
              id="lfw-copy-rfq-text-btn"
              type="button"
              className="lf-btn"
              disabled={!audit.canExportPdf || textLoading}
              onClick={() => void handleFetchAndCopyText()}
            >
              {copiedText ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
              <span>
                {textLoading ? 'Загрузка…' : copiedText ? 'Текст скопирован' : 'Скопировать текст RFQ'}
              </span>
            </button>
          </div>

          {pdfError && (
            <div className="lfw-diag-row lfw-diag-row--error" role="alert">
              <AlertIcon size={15} />
              <span>{pdfError}</span>
            </div>
          )}

          {pdfStatus === 'ready' && pdfUrl && (
            <div className="lfw-diag-row lfw-diag-row--ok" role="status">
              <CheckIcon size={15} style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ flex: 1 }}>
                <strong>PDF сформирован: {pdfFilename}</strong>
                <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                  <a
                    id="lfw-download-pdf-link"
                    href={pdfUrl}
                    download={pdfFilename}
                    className="lf-btn lf-btn--sm"
                  >
                    <DownloadIcon size={13} /> Скачать снова
                  </a>
                  <button
                    type="button"
                    className="lf-btn lf-btn--sm lf-btn--subtle"
                    onClick={() => setShowPdfPreview((prev) => !prev)}
                  >
                    {showPdfPreview ? 'Скрыть предпросмотр' : 'Показать PDF здесь'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {showPdfPreview && pdfUrl && (
            <iframe
              id="lfw-stage6-pdf-iframe"
              title="Предпросмотр RFQ PDF"
              src={pdfUrl}
              className="lfw-inline-pdf"
            />
          )}

          {rfqText && (
            <details className="lfw-text-preview" open>
              <summary>Двуязычный текст запроса ({language.toUpperCase()})</summary>
              <pre>{rfqText}</pre>
            </details>
          )}

          <div className="lfw-handoff-links">
            <span className="lf-label">Открыть проект в рабочих пространствах (в этой же вкладке)</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button
                id="lfw-open-documents-link"
                type="button"
                className="lf-btn lf-btn--sm"
                disabled={navBusy !== null}
                onClick={() => void handleSafeNavigate(`/documents${linkSuffix}`, 'documents')}
              >
                <FilePdfIcon size={14} />
                <span>{navBusy === 'documents' ? 'Сохраняем…' : 'Документы и ревизии'}</span>
              </button>
              <button
                id="lfw-open-quick-rfq-link"
                type="button"
                className="lf-btn lf-btn--sm lf-btn--subtle"
                disabled={navBusy !== null}
                onClick={() => void handleSafeNavigate(`/${linkSuffix}`, 'quick-rfq')}
              >
                <ExternalLinkIcon size={14} />
                <span>{navBusy === 'quick-rfq' ? 'Сохраняем…' : 'Таблица Quick RFQ'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="lfw-footer-nav">
        <button type="button" className="lf-btn lf-btn--subtle" onClick={onBack}>
          ← Назад к монтажу
        </button>
        <button
          type="button"
          className="lf-btn lf-btn--subtle"
          onClick={() => onJumpStep('upload')}
        >
          Вернуться к загрузке
        </button>
      </div>
    </section>
  );
}
