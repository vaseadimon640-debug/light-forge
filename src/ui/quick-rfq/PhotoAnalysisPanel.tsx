'use client';

import { useMemo, useState } from 'react';
import {
  directions,
  finishes,
  materials,
  productTypes,
  sources,
  type Component,
  type Material,
  type Measurement,
  type ProductType,
  type Project,
  type Unit,
} from '@/domain/project';
import type { ProjectSnapshot } from '@/storage/projects';
import {
  AlertIcon,
  CheckIcon,
  CloseIcon,
  EditIcon,
  RefreshIcon,
  SkipIcon,
  SparkIcon,
  StarIcon,
} from '../icons';
import {
  displayToMm,
  formatBytes,
  mmToDisplay,
  orderedPhotos,
  parsePlainNumber,
  unitLabels,
} from './helpers';
import {
  confidenceLabels,
  formatMegapixels,
  formatMimeLabel,
  formatSuggestionProposal,
  getCurrentFieldSummary,
  lightMetricLabels,
  type AnalyzedPhoto,
  type PhotoAnalysisMode,
  type PhotoAnalysisProvider,
  type PhotoAnalysisUiError,
  type PhotoSuggestion,
  type PhotoSuggestionEditOverride,
} from './photoAnalysis';

const productTypeKeys = Object.keys(productTypes) as ProductType[];
const materialKeys = Object.keys(materials) as Material['material'][];
const finishKeys = Object.keys(finishes) as NonNullable<Material['finish']>[];
const directionKeys = Object.keys(directions) as NonNullable<Component['light']['directionId']>[];
const sourceKeys: Measurement['source'][] = ['estimated', 'user', 'documentation'];

export type PhotoAnalysisStatus = 'idle' | 'loading' | 'ready' | 'error';

type PhotoAnalysisPanelProps = {
  snapshot: ProjectSnapshot;
  photoUrls: Record<string, string>;
  unit: Unit;
  provider?: PhotoAnalysisProvider | null;
  selectedPhotoIds: string[];
  onTogglePhotoSelection: (photoId: string) => void;
  onSelectAllPhotos: () => void;
  onClearPhotoSelection: () => void;
  status: PhotoAnalysisStatus;
  mode: PhotoAnalysisMode | null;
  analyzedPhotos: AnalyzedPhoto[];
  selectionStale: boolean;
  cancelledNotice: string | null;
  error: PhotoAnalysisUiError | null;
  summaryNote?: string | null;
  warnings?: string[];
  suggestions: PhotoSuggestion[];
  isPreviewDemo: boolean;
  stepSkipped: boolean;
  onRunAnalysis: () => void;
  onCancelAnalysis: () => void;
  onLoadPreviewDemo: () => void;
  onClearSuggestions: () => void;
  onSkipStep: () => void;
  onRestoreStep: () => void;
  onAcceptSuggestion: (id: string) => { ok: boolean; error?: string };
  onEditSuggestion: (id: string, override: PhotoSuggestionEditOverride) => { ok: boolean; error?: string };
  onSkipSuggestion: (id: string) => void;
  onRestoreSuggestion: (id: string) => void;
  onAcceptAllEmpty: () => void;
};

type FilterMode = 'all' | 'pending' | 'resolved';

type SuggestionCardProps = {
  suggestion: PhotoSuggestion;
  project: Project;
  photoUrls: Record<string, string>;
  unit: Unit;
  onAccept: (id: string) => { ok: boolean; error?: string };
  onEdit: (id: string, override: PhotoSuggestionEditOverride) => { ok: boolean; error?: string };
  onSkip: (id: string) => void;
  onRestore: (id: string) => void;
};

function PhotoSuggestionCard({
  suggestion,
  project,
  photoUrls,
  unit,
  onAccept,
  onEdit,
  onSkip,
  onRestore,
}: SuggestionCardProps) {
  const [editing, setEditing] = useState(false);
  const [confirmingOverwrite, setConfirmingOverwrite] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);

  const [editKind, setEditKind] = useState<ProductType>('pendant');
  const [editNumber, setEditNumber] = useState<string>('');
  const [editSource, setEditSource] = useState<Measurement['source']>('estimated');
  const [editDirection, setEditDirection] = useState<NonNullable<Component['light']['directionId']>>('down');
  const [editPart, setEditPart] = useState<string>('');
  const [editMaterial, setEditMaterial] = useState<Material['material']>('solidBrass');
  const [editFinish, setEditFinish] = useState<NonNullable<Material['finish']> | ''>('');
  const [editColor, setEditColor] = useState<string>('');

  const summary = useMemo(
    () => getCurrentFieldSummary(project, suggestion, unit),
    [project, suggestion, unit],
  );
  const linkedPhoto = suggestion.photoId
    ? project.photos.find(photo => photo.id === suggestion.photoId)
    : undefined;
  const linkedThumbUrl = linkedPhoto ? photoUrls[linkedPhoto.id] : undefined;
  const needsOverwriteGuard =
    suggestion.status === 'pending' && summary.hasManualValue && !summary.matchesProposal;

  function openEditor() {
    setCardError(null);
    setConfirmingOverwrite(false);
    const { payload } = suggestion;
    if (payload.kind === 'productKind') {
      setEditKind(payload.value);
    } else if (payload.kind === 'dimension' || payload.kind === 'mounting') {
      setEditNumber(mmToDisplay(payload.valueMm, unit));
      setEditSource('estimated');
    } else if (payload.kind === 'lightMetric') {
      setEditNumber(String(payload.value));
      setEditSource('estimated');
    } else if (payload.kind === 'lightDirection') {
      setEditDirection(payload.directionId);
    } else if (payload.kind === 'material') {
      setEditPart(payload.part);
      setEditMaterial(payload.material);
      setEditFinish(payload.finish ?? '');
      setEditColor(payload.color ?? '');
    }
    setEditing(true);
  }

  function handleAcceptClick() {
    setCardError(null);
    if (needsOverwriteGuard && !confirmingOverwrite) {
      setConfirmingOverwrite(true);
      return;
    }
    const result = onAccept(suggestion.id);
    if (!result.ok) {
      setCardError(result.error ?? 'Не удалось применить подсказку.');
      return;
    }
    setConfirmingOverwrite(false);
  }

  function handleSaveEdit() {
    setCardError(null);
    const { payload } = suggestion;
    let override: PhotoSuggestionEditOverride;

    if (payload.kind === 'productKind') {
      override = { kind: 'productKind', value: editKind };
    } else if (payload.kind === 'dimension') {
      const mm = displayToMm(editNumber, unit);
      if (mm === null || mm < 0) {
        setCardError(`Введите корректный размер в ${unitLabels[unit]}.`);
        return;
      }
      override = { kind: 'dimension', valueMm: mm, source: editSource };
    } else if (payload.kind === 'mounting') {
      const mm = displayToMm(editNumber, unit);
      if (mm === null || mm < 0) {
        setCardError(`Введите корректную высоту в ${unitLabels[unit]}.`);
        return;
      }
      override = { kind: 'mounting', valueMm: mm, source: editSource };
    } else if (payload.kind === 'lightMetric') {
      const parsed = parsePlainNumber(editNumber);
      if (parsed === null) {
        setCardError('Введите корректное числовое значение.');
        return;
      }
      override = { kind: 'lightMetric', value: parsed, source: editSource };
    } else if (payload.kind === 'lightDirection') {
      override = { kind: 'lightDirection', directionId: editDirection };
    } else {
      const trimmedPart = editPart.trim();
      if (!trimmedPart) {
        setCardError('Укажите название детали.');
        return;
      }
      override = {
        kind: 'material',
        part: trimmedPart,
        material: editMaterial,
        ...(editFinish ? { finish: editFinish } : {}),
        ...(editColor.trim() ? { color: editColor.trim() } : {}),
      };
    }

    const result = onEdit(suggestion.id, override);
    if (!result.ok) {
      setCardError(result.error ?? 'Не удалось применить изменённое значение.');
      return;
    }
    setEditing(false);
    setConfirmingOverwrite(false);
  }

  const confidenceTone =
    suggestion.confidence === 'high'
      ? 'lf-badge--documentation'
      : suggestion.confidence === 'medium'
        ? 'lf-badge--estimated'
        : 'lf-badge--unknown';

  const statusTone =
    suggestion.status === 'accepted'
      ? 'lf-badge--documentation'
      : suggestion.status === 'edited'
        ? 'lf-badge--accent'
        : 'lf-badge--unknown';

  const statusText =
    suggestion.status === 'accepted'
      ? 'Принято'
      : suggestion.status === 'edited'
        ? 'Изменено и применено'
        : 'Пропущено';

  const scorePct =
    typeof suggestion.confidenceScore === 'number'
      ? ` · ${Math.round(suggestion.confidenceScore * 100)}%`
      : '';

  return (
    <article
      id={`lf-suggestion-${suggestion.id}`}
      className={`lf-suggestion-card lf-suggestion-card--${suggestion.status}`}
      aria-label={`Подсказка: ${summary.targetLabel}`}
    >
      <div className="lf-suggestion-head">
        <div className="lf-suggestion-title-wrap">
          <div className="lf-suggestion-meta-line">
            <span className="lf-suggestion-category">{summary.categoryLabel}</span>
            {summary.componentName && (
              <span className="lf-badge lf-badge--unknown">{summary.componentName}</span>
            )}
            {linkedPhoto && (
              <span className="lf-suggestion-photo-chip" title={linkedPhoto.name}>
                {linkedThumbUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={linkedThumbUrl} alt="" />
                )}
                <span>{linkedPhoto.name}</span>
              </span>
            )}
          </div>
          <h3 className="lf-suggestion-title">{summary.targetLabel}</h3>
        </div>

        <div className="lf-suggestion-badges">
          <span className="lf-badge lf-badge--estimated">Оценка по фото</span>
          <span className={`lf-badge ${confidenceTone} num`}>
            {confidenceLabels[suggestion.confidence]}
            {scorePct}
          </span>
          {suggestion.status !== 'pending' && (
            <span className={`lf-badge ${statusTone}`}>{statusText}</span>
          )}
        </div>
      </div>

      {/* Proposal vs Current form value */}
      <div className="lf-suggestion-compare">
        <div className="lf-suggestion-box lf-suggestion-box--proposal">
          <span className="lf-suggestion-box-label">Предлагаемое значение</span>
          {suggestion.payload.kind === 'material' ? (
            <div className="lf-suggestion-material-chips">
              <span className="lf-suggestion-kv">
                <strong>Деталь:</strong> {suggestion.payload.part}
              </span>
              <span className="lf-suggestion-kv">
                <strong>Материал:</strong> {materials[suggestion.payload.material][0]}
              </span>
              {suggestion.payload.finish && (
                <span className="lf-suggestion-kv">
                  <strong>Отделка:</strong> {finishes[suggestion.payload.finish][0]}
                </span>
              )}
              {suggestion.payload.color && (
                <span className="lf-suggestion-kv">
                  <strong>Цвет:</strong> {suggestion.payload.color}
                </span>
              )}
            </div>
          ) : (
            <div className="lf-suggestion-value num">
              {formatSuggestionProposal(suggestion.payload, unit)}
              {(suggestion.payload.kind === 'dimension' || suggestion.payload.kind === 'mounting') &&
                unit !== 'mm' && (
                  <span className="lf-field-hint mono" style={{ marginLeft: 6 }}>
                    ({suggestion.payload.valueMm} мм)
                  </span>
                )}
            </div>
          )}
        </div>

        <div className="lf-suggestion-box">
          <span className="lf-suggestion-box-label">Сейчас в форме</span>
          <div
            className={`lf-suggestion-value num${summary.isEmpty ? ' lf-suggestion-value--empty' : ''}`}
          >
            {summary.currentLabel}
          </div>
        </div>
      </div>

      {suggestion.note && <p className="lf-suggestion-note">{suggestion.note}</p>}

      {needsOverwriteGuard && !editing && !confirmingOverwrite && (
        <div className="lf-suggestion-guard" role="note">
          <AlertIcon size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            Поле уже заполнено вручную. Текущее значение сохраняется, пока вы явно не подтвердите замену или не
            отредактируете подсказку.
          </span>
        </div>
      )}

      {cardError && (
        <div className="lf-alert lf-alert--danger" role="alert">
          <div className="lf-alert-content">
            <AlertIcon size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{cardError}</span>
          </div>
        </div>
      )}

      {confirmingOverwrite && suggestion.status === 'pending' && !editing && (
        <div className="lf-alert lf-alert--warning" role="alert">
          <div className="lf-alert-content">
            <AlertIcon size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>Заменить текущее значение «{summary.currentLabel}» на оценку по фото?</span>
          </div>
          <div className="lf-suggestion-actions-inline">
            <button
              id={`lf-sugg-confirm-${suggestion.id}`}
              type="button"
              className="lf-btn lf-btn--brass lf-btn--sm"
              onClick={handleAcceptClick}
            >
              <CheckIcon size={13} /> Подтвердить замену
            </button>
            <button
              id={`lf-sugg-cancel-confirm-${suggestion.id}`}
              type="button"
              className="lf-btn lf-btn--sm"
              onClick={() => setConfirmingOverwrite(false)}
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {editing && (
        <div className="lf-suggestion-editor" aria-label="Редактирование подсказки перед применением">
          {suggestion.payload.kind === 'productKind' && (
            <div className="lf-field">
              <label className="lf-label" htmlFor={`lf-sugg-input-kind-${suggestion.id}`}>
                Тип светильника
              </label>
              <select
                id={`lf-sugg-input-kind-${suggestion.id}`}
                className="lf-select"
                value={editKind}
                onChange={event => setEditKind(event.target.value as ProductType)}
              >
                {productTypeKeys.map(key => (
                  <option key={key} value={key}>
                    {productTypes[key][0]} ({productTypes[key][1]})
                  </option>
                ))}
              </select>
            </div>
          )}

          {(suggestion.payload.kind === 'dimension' ||
            suggestion.payload.kind === 'mounting' ||
            suggestion.payload.kind === 'lightMetric') && (
            <div className="lf-grid-2">
              <div className="lf-field">
                <label className="lf-label" htmlFor={`lf-sugg-input-num-${suggestion.id}`}>
                  Значение (
                  {suggestion.payload.kind === 'lightMetric'
                    ? lightMetricLabels[suggestion.payload.metric].unit
                    : unitLabels[unit]}
                  )
                </label>
                <input
                  id={`lf-sugg-input-num-${suggestion.id}`}
                  type="text"
                  inputMode="decimal"
                  className="lf-input num"
                  value={editNumber}
                  onChange={event => setEditNumber(event.target.value)}
                />
              </div>

              <div className="lf-field">
                <label className="lf-label" htmlFor={`lf-sugg-input-src-${suggestion.id}`}>
                  Источник значения
                </label>
                <select
                  id={`lf-sugg-input-src-${suggestion.id}`}
                  className="lf-select"
                  value={editSource}
                  onChange={event => setEditSource(event.target.value as Measurement['source'])}
                >
                  {sourceKeys.map(src => (
                    <option key={src} value={src}>
                      {sources[src][0]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {suggestion.payload.kind === 'lightDirection' && (
            <div className="lf-field">
              <label className="lf-label" htmlFor={`lf-sugg-input-dir-${suggestion.id}`}>
                Направление света
              </label>
              <select
                id={`lf-sugg-input-dir-${suggestion.id}`}
                className="lf-select"
                value={editDirection}
                onChange={event =>
                  setEditDirection(event.target.value as NonNullable<Component['light']['directionId']>)
                }
              >
                {directionKeys.map(key => (
                  <option key={key} value={key}>
                    {directions[key][0]} ({directions[key][1]})
                  </option>
                ))}
              </select>
            </div>
          )}

          {suggestion.payload.kind === 'material' && (
            <div className="lf-grid-2">
              <div className="lf-field">
                <label className="lf-label" htmlFor={`lf-sugg-input-part-${suggestion.id}`}>
                  Деталь
                </label>
                <input
                  id={`lf-sugg-input-part-${suggestion.id}`}
                  type="text"
                  className="lf-input"
                  maxLength={120}
                  value={editPart}
                  onChange={event => setEditPart(event.target.value)}
                />
              </div>

              <div className="lf-field">
                <label className="lf-label" htmlFor={`lf-sugg-input-mat-${suggestion.id}`}>
                  Материал
                </label>
                <select
                  id={`lf-sugg-input-mat-${suggestion.id}`}
                  className="lf-select"
                  value={editMaterial}
                  onChange={event => setEditMaterial(event.target.value as Material['material'])}
                >
                  {materialKeys.map(key => (
                    <option key={key} value={key}>
                      {materials[key][0]} ({materials[key][1]})
                    </option>
                  ))}
                </select>
              </div>

              <div className="lf-field">
                <label className="lf-label" htmlFor={`lf-sugg-input-fin-${suggestion.id}`}>
                  Отделка (отдельное поле)
                </label>
                <select
                  id={`lf-sugg-input-fin-${suggestion.id}`}
                  className="lf-select"
                  value={editFinish}
                  onChange={event =>
                    setEditFinish(event.target.value as NonNullable<Material['finish']> | '')
                  }
                >
                  <option value="">Не указана</option>
                  {finishKeys.map(key => (
                    <option key={key} value={key}>
                      {finishes[key][0]} ({finishes[key][1]})
                    </option>
                  ))}
                </select>
              </div>

              <div className="lf-field">
                <label className="lf-label" htmlFor={`lf-sugg-input-col-${suggestion.id}`}>
                  Цвет (отдельное поле)
                </label>
                <input
                  id={`lf-sugg-input-col-${suggestion.id}`}
                  type="text"
                  className="lf-input"
                  maxLength={120}
                  placeholder="Например: Тёплая сатиновая латунь"
                  value={editColor}
                  onChange={event => setEditColor(event.target.value)}
                />
              </div>
            </div>
          )}

          <div className="lf-suggestion-actions">
            <button
              id={`lf-sugg-save-edit-${suggestion.id}`}
              type="button"
              className="lf-btn lf-btn--primary lf-btn--sm"
              onClick={handleSaveEdit}
            >
              <CheckIcon size={13} /> Применить изменения
            </button>
            <button
              id={`lf-sugg-cancel-edit-${suggestion.id}`}
              type="button"
              className="lf-btn lf-btn--sm"
              onClick={() => {
                setEditing(false);
                setCardError(null);
              }}
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {!editing && !confirmingOverwrite && (
        <div className="lf-suggestion-footer">
          {suggestion.status === 'pending' ? (
            <div className="lf-suggestion-actions">
              <button
                id={`lf-sugg-accept-${suggestion.id}`}
                type="button"
                className="lf-btn lf-btn--primary lf-btn--sm"
                onClick={handleAcceptClick}
              >
                <CheckIcon size={13} /> Принять
              </button>
              <button
                id={`lf-sugg-edit-${suggestion.id}`}
                type="button"
                className="lf-btn lf-btn--sm"
                onClick={openEditor}
              >
                <EditIcon size={13} /> Изменить
              </button>
              <button
                id={`lf-sugg-skip-${suggestion.id}`}
                type="button"
                className="lf-btn lf-btn--subtle lf-btn--sm"
                onClick={() => {
                  setCardError(null);
                  onSkip(suggestion.id);
                }}
              >
                <SkipIcon size={13} /> Пропустить
              </button>
            </div>
          ) : (
            <div className="lf-suggestion-resolved-bar">
              <span className="lf-field-hint">
                {suggestion.status === 'skipped'
                  ? 'Пропущено — значение в форме не изменено.'
                  : `Применено: ${suggestion.appliedSummary ?? formatSuggestionProposal(suggestion.payload, unit)}`}
              </span>
              <div className="lf-suggestion-actions-inline">
                {suggestion.status !== 'skipped' && (
                  <button
                    id={`lf-sugg-reedit-${suggestion.id}`}
                    type="button"
                    className="lf-btn lf-btn--subtle lf-btn--sm"
                    onClick={openEditor}
                  >
                    <EditIcon size={12} /> Изменить
                  </button>
                )}
                {suggestion.status === 'skipped' && (
                  <button
                    id={`lf-sugg-restore-${suggestion.id}`}
                    type="button"
                    className="lf-btn lf-btn--sm"
                    onClick={() => onRestore(suggestion.id)}
                  >
                    Вернуть
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

export function PhotoAnalysisPanel({
  snapshot,
  photoUrls,
  unit,
  provider = null,
  selectedPhotoIds,
  onTogglePhotoSelection,
  onSelectAllPhotos,
  onClearPhotoSelection,
  status,
  mode,
  analyzedPhotos,
  selectionStale,
  cancelledNotice,
  error,
  summaryNote,
  warnings = [],
  suggestions,
  isPreviewDemo,
  stepSkipped,
  onRunAnalysis,
  onCancelAnalysis,
  onLoadPreviewDemo,
  onClearSuggestions,
  onSkipStep,
  onRestoreStep,
  onAcceptSuggestion,
  onEditSuggestion,
  onSkipSuggestion,
  onRestoreSuggestion,
  onAcceptAllEmpty,
}: PhotoAnalysisPanelProps) {
  const [filter, setFilter] = useState<FilterMode>('all');

  const photos = orderedPhotos(snapshot.project);
  const selectedSet = useMemo(() => new Set(selectedPhotoIds), [selectedPhotoIds]);
  const selectedCount = photos.filter(photo => selectedSet.has(photo.id)).length;

  const counts = useMemo(() => {
    let pending = 0;
    let accepted = 0;
    let edited = 0;
    let skipped = 0;
    let emptyPending = 0;
    for (const item of suggestions) {
      if (item.status === 'pending') {
        pending += 1;
        if (getCurrentFieldSummary(snapshot.project, item, unit).isEmpty) {
          emptyPending += 1;
        }
      } else if (item.status === 'accepted') {
        accepted += 1;
      } else if (item.status === 'edited') {
        edited += 1;
      } else if (item.status === 'skipped') {
        skipped += 1;
      }
    }
    return { pending, accepted, edited, skipped, emptyPending, resolved: accepted + edited + skipped };
  }, [snapshot.project, suggestions, unit]);

  const visibleSuggestions = useMemo(() => {
    if (filter === 'pending') return suggestions.filter(item => item.status === 'pending');
    if (filter === 'resolved') return suggestions.filter(item => item.status !== 'pending');
    return suggestions;
  }, [filter, suggestions]);

  const modeBadge = useMemo(() => {
    if (!provider) return { text: 'Ожидает контракт API', cls: 'lf-badge--unknown' };
    if (mode === 'metadata_only') return { text: 'Режим: метаданные (v1)', cls: 'lf-badge--user' };
    if (mode === 'visual_analysis') return { text: 'Визуальный анализ (v1)', cls: 'lf-badge--documentation' };
    return { text: `${provider.label} · API v1`, cls: 'lf-badge--documentation' };
  }, [mode, provider]);

  if (stepSkipped) {
    return (
      <section
        id="lf-photo-analysis-section"
        className="lf-card lf-analysis-skipped-card"
        aria-labelledby="photo-analysis-heading"
      >
        <div className="lf-card-header" style={{ borderBottom: 0 }}>
          <div className="lf-card-title-wrap">
            <span className="lf-card-eyebrow">Шаг 2 · Анализ фото</span>
            <h2 id="photo-analysis-heading" className="lf-card-title">
              Анализ фото пропущен
            </h2>
            <p className="lf-card-desc">
              Вы заполняете параметры вручную. Оригиналы загруженных фотографий сохранены для PDF.
            </p>
          </div>
          <button
            id="lf-photo-analysis-restore-step-btn"
            type="button"
            className="lf-btn lf-btn--sm"
            onClick={onRestoreStep}
          >
            Вернуться к анализу
          </button>
        </div>
      </section>
    );
  }

  return (
    <section
      id="lf-photo-analysis-section"
      className="lf-card"
      aria-labelledby="photo-analysis-heading"
    >
      <div className="lf-card-header">
        <div className="lf-card-title-wrap">
          <span className="lf-card-eyebrow">Шаг 2 · Анализ фото (опционально)</span>
          <h2 id="photo-analysis-heading" className="lf-card-title">
            Анализ фото и разбор подсказок
          </h2>
          <p className="lf-card-desc">
            В анализ отправляются только выбранные фото без изменения оригиналов. Подсказки всегда
            помечаются как «Оценка» и не перезаписывают ручной ввод без вашего согласия.
          </p>
        </div>

        <div className="lf-analysis-head-actions">
          <span id="lf-photo-analysis-contract-badge" className={`lf-badge ${modeBadge.cls}`}>
            {modeBadge.text}
          </span>
          <button
            id="lf-photo-analysis-skip-step-btn"
            type="button"
            className="lf-btn lf-btn--subtle lf-btn--sm"
            onClick={onSkipStep}
          >
            <SkipIcon size={13} /> Пропустить шаг
          </button>
        </div>
      </div>

      <div className="lf-card-body">
        {photos.length === 0 ? (
          <div className="lf-analysis-empty">
            <div className="lf-analysis-empty-text">
              <strong>Сначала загрузите фото на шаге 1</strong>
              <span className="lf-field-hint">
                После загрузки фотографий вы сможете выбрать нужные снимки для проверки и разбора подсказок.
                Ручное заполнение формы ниже доступно сразу.
              </span>
            </div>
            <span className="lf-badge lf-badge--unknown">0 фото для анализа</span>
          </div>
        ) : (
          <>
            {/* Interactive photo selector */}
            <div className="lf-analysis-selector">
              <div className="lf-analysis-selector-head">
                <div className="lf-analysis-photos-meta">
                  <strong className="num">
                    Выбрано для анализа: {selectedCount} из {photos.length} фото
                  </strong>
                  <span className="lf-field-hint">
                    Передаются только отмеченные снимки · изменение выбора во время загрузки отменяет текущий запрос
                  </span>
                </div>
                {photos.length > 1 && (
                  <div className="lf-suggestion-actions-inline">
                    <button
                      id="lf-photo-analysis-select-all-btn"
                      type="button"
                      className="lf-btn lf-btn--subtle lf-btn--sm"
                      disabled={selectedCount === photos.length}
                      onClick={onSelectAllPhotos}
                    >
                      Выбрать все
                    </button>
                    <button
                      id="lf-photo-analysis-clear-sel-btn"
                      type="button"
                      className="lf-btn lf-btn--subtle lf-btn--sm"
                      disabled={selectedCount === 0}
                      onClick={onClearPhotoSelection}
                    >
                      Снять выбор
                    </button>
                  </div>
                )}
              </div>

              <div className="lf-analysis-picker-grid" role="group" aria-label="Выбор фотографий для анализа">
                {photos.map((photo, idx) => {
                  const selected = selectedSet.has(photo.id);
                  const url = photoUrls[photo.id];
                  const isPrimary = photo.id === snapshot.project.primaryPhotoId || idx === 0;
                  return (
                    <button
                      key={photo.id}
                      id={`lf-analysis-photo-pick-${photo.id}`}
                      type="button"
                      role="checkbox"
                      aria-checked={selected}
                      className={`lf-analysis-pick-chip${selected ? ' lf-analysis-pick-chip--selected' : ''}`}
                      onClick={() => onTogglePhotoSelection(photo.id)}
                    >
                      <span className="lf-analysis-pick-check" aria-hidden="true">
                        {selected && <CheckIcon size={11} />}
                      </span>
                      <span className="lf-analysis-mini-thumb">
                        {url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={url} alt="" />
                        ) : null}
                        {isPrimary && (
                          <span className="lf-analysis-mini-star" aria-hidden="true">
                            <StarIcon size={9} filled />
                          </span>
                        )}
                      </span>
                      <span className="lf-analysis-pick-info">
                        <span className="lf-analysis-pick-name" title={photo.name}>
                          {photo.name}
                        </span>
                        <span className="lf-field-hint num">
                          {formatMimeLabel(photo.type)} · {formatBytes(photo.size)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Action buttons row */}
              <div className="lf-analysis-toolbar-row">
                <div className="lf-analysis-toolbar-btns">
                  <button
                    id="lf-photo-analysis-run-btn"
                    type="button"
                    className="lf-btn lf-btn--primary lf-btn--sm"
                    disabled={!provider || selectedCount === 0 || status === 'loading'}
                    title={
                      !provider
                        ? 'Подключение анализа будет активировано после публикации контракта API'
                        : selectedCount === 0
                          ? 'Выберите хотя бы одно фото'
                          : 'Отправить выбранные фото в API анализа'
                    }
                    onClick={onRunAnalysis}
                  >
                    {status === 'loading' ? (
                      <RefreshIcon size={13} className="lf-spin" />
                    ) : (
                      <SparkIcon size={13} />
                    )}
                    {status === 'loading'
                      ? `Анализ (${selectedCount})...`
                      : `Анализировать фото (${selectedCount})`}
                  </button>

                  {status === 'loading' && (
                    <button
                      id="lf-photo-analysis-cancel-btn"
                      type="button"
                      className="lf-btn lf-btn--danger lf-btn--sm"
                      onClick={onCancelAnalysis}
                    >
                      <CloseIcon size={13} /> Отменить
                    </button>
                  )}

                  {!isPreviewDemo && status !== 'loading' && (mode === 'metadata_only' || !provider) && (
                    <button
                      id="lf-photo-analysis-demo-btn"
                      type="button"
                      className="lf-btn lf-btn--brass lf-btn--sm"
                      onClick={onLoadPreviewDemo}
                    >
                      Просмотр подсказок (демо UI)
                    </button>
                  )}

                  {isPreviewDemo && (
                    <button
                      id="lf-photo-analysis-clear-btn"
                      type="button"
                      className="lf-btn lf-btn--sm"
                      onClick={onClearSuggestions}
                    >
                      Скрыть демо
                    </button>
                  )}
                </div>

                {selectionStale && status === 'ready' && !isPreviewDemo && (
                  <span className="lf-badge lf-badge--estimated">
                    Выбор фото изменён — запустите анализ снова
                  </span>
                )}
              </div>
            </div>

            {/* Cancellation notice (clean, non-error feedback) */}
            {cancelledNotice && status === 'idle' && (
              <div id="lf-photo-analysis-cancelled-notice" className="lf-alert lf-alert--info" role="status">
                <div className="lf-alert-content">
                  <AlertIcon size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>{cancelledNotice}</span>
                </div>
              </div>
            )}

            {/* Structured error alert */}
            {status === 'error' && error && (
              <div id="lf-photo-analysis-error" className="lf-alert lf-alert--danger" role="alert">
                <div className="lf-alert-content">
                  <AlertIcon size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span>{error.message}</span>
                    <span className="lf-field-hint mono" style={{ color: 'inherit', opacity: 0.85 }}>
                      Код: {error.code}
                      {error.status > 0 ? ` · HTTP ${error.status}` : ''}
                    </span>
                  </div>
                </div>
                {provider && selectedCount > 0 && (
                  <button
                    id="lf-photo-analysis-retry-btn"
                    type="button"
                    className="lf-btn lf-btn--sm"
                    onClick={onRunAnalysis}
                  >
                    <RefreshIcon size={13} /> Повторить
                  </button>
                )}
              </div>
            )}

            {/* metadata_only mode notice + verified pixel metadata */}
            {status === 'ready' && mode === 'metadata_only' && !isPreviewDemo && (
              <div className="lf-analysis-metadata-block">
                <div
                  id="lf-photo-analysis-metadata-notice"
                  className="lf-alert lf-alert--info"
                  role="status"
                >
                  <div className="lf-alert-content">
                    <SparkIcon size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <strong>Распознавание ещё не подключено</strong>
                      <span>
                        Сервер проверил формат и размеры растра выбранных файлов. Заполните параметры
                        вручную ниже — введённые данные и оригиналы фото сохраняются полностью.
                      </span>
                    </div>
                  </div>
                </div>

                {analyzedPhotos.length > 0 && (
                  <div id="lf-photo-analysis-metadata-list" className="lf-metadata-grid">
                    {analyzedPhotos.map(photo => {
                      const thumbUrl = photoUrls[photo.id];
                      const isPrimary = photo.id === snapshot.project.primaryPhotoId;
                      return (
                        <div key={photo.id} className="lf-metadata-card">
                          <div className="lf-metadata-card-head">
                            {thumbUrl && (
                              <span className="lf-analysis-mini-thumb">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={thumbUrl} alt="" />
                              </span>
                            )}
                            <div className="lf-metadata-name-wrap">
                              <strong className="lf-metadata-name" title={photo.name}>
                                {photo.name}
                              </strong>
                              <span className="lf-field-hint">
                                {isPrimary ? 'Главное фото · ' : ''}
                                {formatMimeLabel(photo.type)} ({photo.type})
                              </span>
                            </div>
                          </div>
                          <div className="lf-metadata-stats">
                            <div className="lf-metadata-stat">
                              <span className="lf-suggestion-box-label">Растр (файл)</span>
                              <span className="lf-metadata-val mono">
                                {photo.widthPx} × {photo.heightPx} px
                              </span>
                            </div>
                            <div className="lf-metadata-stat">
                              <span className="lf-suggestion-box-label">Объём / разрешение</span>
                              <span className="lf-metadata-val num">
                                {formatBytes(photo.size)} · {formatMegapixels(photo.widthPx, photo.heightPx)}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <p className="lf-field-hint" style={{ gridColumn: '1 / -1', margin: 0 }}>
                      Размеры растра считаны из файла и могут относиться к ориентации до поворота EXIF.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* visual_analysis mode with verified photos strip and empty-suggestions distinction */}
            {status === 'ready' && mode === 'visual_analysis' && !isPreviewDemo && (
              <>
                {analyzedPhotos.length > 0 && (
                  <div id="lf-photo-analysis-metadata-list" className="lf-metadata-inline-strip">
                    {analyzedPhotos.map(photo => (
                      <span key={photo.id} className="lf-badge lf-badge--user mono">
                        {photo.name}: {photo.widthPx}×{photo.heightPx} px
                      </span>
                    ))}
                  </div>
                )}
                {suggestions.length === 0 && (
                  <div className="lf-alert lf-alert--info" role="status">
                    <div className="lf-alert-content">
                      <SparkIcon size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                      <span>
                        Подходящих визуальных подсказок по выбранным фото не найдено. Заполните
                        параметры вручную ниже.
                      </span>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Explicit demo fixture disclaimer */}
            {isPreviewDemo && suggestions.length > 0 && (
              <div className="lf-alert lf-alert--warning" role="status">
                <div className="lf-alert-content">
                  <AlertIcon size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>
                    <strong>Демо-подсказки интерфейса</strong> · Это локальный предпросмотр карточек
                    «Принять / Изменить / Пропустить», а не результат распознавания изображения.
                  </span>
                </div>
              </div>
            )}

            {summaryNote && (
              <p className="lf-field-hint" style={{ margin: 0 }}>
                {summaryNote}
              </p>
            )}

            {warnings.length > 0 && (
              <div className="lf-alert lf-alert--warning" role="status">
                <div className="lf-alert-content">
                  <AlertIcon size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {warnings.map((warn, idx) => (
                      <span key={idx}>{warn}</span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Suggestions Review List */}
            {suggestions.length > 0 && (
              <div className="lf-analysis-review">
                <div className="lf-analysis-summary-bar">
                  <div className="lf-analysis-counts">
                    <span className="lf-badge lf-badge--estimated num">Ожидают: {counts.pending}</span>
                    <span className="lf-badge lf-badge--documentation num">Принято: {counts.accepted}</span>
                    {counts.edited > 0 && (
                      <span className="lf-badge lf-badge--accent num">Изменено: {counts.edited}</span>
                    )}
                    {counts.skipped > 0 && (
                      <span className="lf-badge lf-badge--unknown num">Пропущено: {counts.skipped}</span>
                    )}
                  </div>

                  <div className="lf-analysis-summary-controls">
                    <div className="lf-segment" role="group" aria-label="Фильтр подсказок">
                      {(
                        [
                          { id: 'all', label: `Все (${suggestions.length})` },
                          { id: 'pending', label: `Ожидают (${counts.pending})` },
                          { id: 'resolved', label: `Готово (${counts.resolved})` },
                        ] as const
                      ).map(tab => (
                        <button
                          key={tab.id}
                          id={`lf-sugg-filter-${tab.id}`}
                          type="button"
                          className="lf-segment-btn"
                          aria-pressed={filter === tab.id}
                          onClick={() => setFilter(tab.id)}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>

                    {counts.emptyPending > 0 && (
                      <button
                        id="lf-photo-analysis-accept-empty-btn"
                        type="button"
                        className="lf-btn lf-btn--sm"
                        title="Применить только к незаполненным полям; ручной ввод не затрагивается"
                        onClick={onAcceptAllEmpty}
                      >
                        <CheckIcon size={13} /> Принять пустые ({counts.emptyPending})
                      </button>
                    )}
                  </div>
                </div>

                {visibleSuggestions.length === 0 ? (
                  <div className="lf-analysis-empty">
                    <span className="lf-field-hint">
                      {filter === 'pending'
                        ? 'Все подсказки рассмотрены.'
                        : 'В этой категории пока нет подсказок.'}
                    </span>
                  </div>
                ) : (
                  <div className="lf-suggestion-list">
                    {visibleSuggestions.map(suggestion => (
                      <PhotoSuggestionCard
                        key={suggestion.id}
                        suggestion={suggestion}
                        project={snapshot.project}
                        photoUrls={photoUrls}
                        unit={unit}
                        onAccept={onAcceptSuggestion}
                        onEdit={onEditSuggestion}
                        onSkip={onSkipSuggestion}
                        onRestore={onRestoreSuggestion}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
