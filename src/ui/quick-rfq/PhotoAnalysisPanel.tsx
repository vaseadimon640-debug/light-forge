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
  EditIcon,
  RefreshIcon,
  SkipIcon,
  SparkIcon,
  StarIcon,
} from '../icons';
import {
  displayToMm,
  mmToDisplay,
  orderedPhotos,
  parsePlainNumber,
  unitLabels,
} from './helpers';
import {
  confidenceLabels,
  formatSuggestionProposal,
  getCurrentFieldSummary,
  lightMetricLabels,
  type PhotoAnalysisProvider,
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
  status: PhotoAnalysisStatus;
  errorMessage: string | null;
  summaryNote?: string | null;
  warnings?: string[];
  suggestions: PhotoSuggestion[];
  isPreviewDemo: boolean;
  stepSkipped: boolean;
  onRunAnalysis: () => void;
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

  // Local inline edit states (initialized cleanly on entering edit mode)
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

      {/* Explicit overwrite confirmation when replacing an existing manual value */}
      {confirmingOverwrite && suggestion.status === 'pending' && !editing && (
        <div className="lf-alert lf-alert--warning" role="alert">
          <div className="lf-alert-content">
            <AlertIcon size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              Заменить текущее значение «{summary.currentLabel}» на оценку по фото?
            </span>
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

      {/* Inline Editor ("Изменить") */}
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

      {/* Action Footer */}
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
  status,
  errorMessage,
  summaryNote,
  warnings = [],
  suggestions,
  isPreviewDemo,
  stepSkipped,
  onRunAnalysis,
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
            Подсказки по фото всегда помечаются как «Оценка». Введённые вручную данные не изменяются без
            вашего явного подтверждения.
          </p>
        </div>

        <div className="lf-analysis-head-actions">
          <span
            id="lf-photo-analysis-contract-badge"
            className={`lf-badge ${provider ? 'lf-badge--documentation' : 'lf-badge--unknown'}`}
          >
            {provider ? provider.label : 'Ожидает контракт API'}
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
                После загрузки фотографий здесь появятся управление анализом и список подсказок с кнопками
                «Принять», «Изменить» и «Пропустить». Ручное заполнение формы ниже доступно сразу.
              </span>
            </div>
            <span className="lf-badge lf-badge--unknown">0 фото для анализа</span>
          </div>
        ) : (
          <>
            {/* Attached photos summary + action toolbar */}
            <div className="lf-analysis-toolbar">
              <div className="lf-analysis-photos-strip">
                <div className="lf-analysis-thumbs" aria-label="Фотографии для анализа">
                  {photos.slice(0, 4).map((photo, idx) => {
                    const url = photoUrls[photo.id];
                    const isPrimary = photo.id === snapshot.project.primaryPhotoId || idx === 0;
                    return (
                      <span
                        key={photo.id}
                        className={`lf-analysis-mini-thumb${isPrimary ? ' lf-analysis-mini-thumb--primary' : ''}`}
                        title={isPrimary ? `Главное фото: ${photo.name}` : photo.name}
                      >
                        {url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={url} alt={photo.name} />
                        ) : null}
                        {isPrimary && (
                          <span className="lf-analysis-mini-star" aria-hidden="true">
                            <StarIcon size={9} filled />
                          </span>
                        )}
                      </span>
                    );
                  })}
                  {photos.length > 4 && (
                    <span className="lf-analysis-mini-more num">+{photos.length - 4}</span>
                  )}
                </div>

                <div className="lf-analysis-photos-meta">
                  <strong className="num">Готово к анализу: {photos.length} фото</strong>
                  <span className="lf-field-hint">
                    Оригиналы сохраняются без сжатия · главное фото: {photos[0].name}
                  </span>
                </div>
              </div>

              <div className="lf-analysis-toolbar-btns">
                <button
                  id="lf-photo-analysis-run-btn"
                  type="button"
                  className="lf-btn lf-btn--primary lf-btn--sm"
                  disabled={!provider || status === 'loading'}
                  title={
                    provider
                      ? 'Запустить анализ загруженных фотографий'
                      : 'Серверный анализ будет подключён после публикации контракта API от Codex'
                  }
                  onClick={onRunAnalysis}
                >
                  {status === 'loading' ? (
                    <RefreshIcon size={13} className="lf-spin" />
                  ) : (
                    <SparkIcon size={13} />
                  )}
                  {status === 'loading' ? 'Анализ фото...' : 'Анализировать фото'}
                </button>

                {!provider && !isPreviewDemo && (
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
            </div>

            {/* Honest API pending notice when no backend provider is connected yet */}
            {!provider && suggestions.length === 0 && (
              <div className="lf-alert lf-alert--info" role="status">
                <div className="lf-alert-content">
                  <SparkIcon size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>
                    Подключение серверного анализа начнётся после публикации контракта API от Codex.
                    Внешние AI-сервисы не вызываются. Нажмите «Просмотр подсказок (демо UI)», чтобы
                    проверить сценарий «Принять / Изменить / Пропустить», или пропустите этот шаг.
                  </span>
                </div>
              </div>
            )}

            {/* Explicit demo fixture disclaimer */}
            {isPreviewDemo && suggestions.length > 0 && (
              <div className="lf-alert lf-alert--warning" role="status">
                <div className="lf-alert-content">
                  <AlertIcon size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>
                    <strong>Демо-подсказки интерфейса</strong> · Не являются реальным анализом изображения.
                    Подключение анализа активируется после публикации контракта API от Codex.
                  </span>
                </div>
              </div>
            )}

            {status === 'error' && errorMessage && (
              <div className="lf-alert lf-alert--danger" role="alert">
                <div className="lf-alert-content">
                  <AlertIcon size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>{errorMessage}</span>
                </div>
                {provider && (
                  <button type="button" className="lf-btn lf-btn--sm" onClick={onRunAnalysis}>
                    <RefreshIcon size={13} /> Повторить
                  </button>
                )}
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
                    <span className="lf-badge lf-badge--estimated num">
                      Ожидают: {counts.pending}
                    </span>
                    <span className="lf-badge lf-badge--documentation num">
                      Принято: {counts.accepted}
                    </span>
                    {counts.edited > 0 && (
                      <span className="lf-badge lf-badge--accent num">
                        Изменено: {counts.edited}
                      </span>
                    )}
                    {counts.skipped > 0 && (
                      <span className="lf-badge lf-badge--unknown num">
                        Пропущено: {counts.skipped}
                      </span>
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
