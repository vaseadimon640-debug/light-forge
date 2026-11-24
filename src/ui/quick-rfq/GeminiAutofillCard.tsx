'use client';

import { useMemo, useRef, useState } from 'react';
import type {
  CertaintyStatus,
  GeminiDrawingAnalysis,
  GeminiPhotoAnalysis,
} from '@/ai/gemini-contract';
import {
  directions,
  productTypes,
  type Project,
} from '@/domain/project';
import type { ProjectSnapshot } from '@/storage/projects';
import { AlertIcon, CheckIcon, RefreshIcon, SparkIcon } from '../icons';
import {
  applyGeminiProposals,
  buildDrawingProposals,
  buildPhotoProposals,
  GeminiClientError,
  requestGeminiDrawingAnalysis,
  requestGeminiPhotoAnalysis,
  type GeminiAutofillProposal,
} from './geminiAutofill';
import { orderedPhotos } from './helpers';

type GeminiAutofillCardProps = {
  snapshot: ProjectSnapshot;
  selectedPhotoIds: string[];
  manualTouchedFields: ReadonlySet<string>;
  onApplyProject: (nextProject: Project, message: string) => Promise<void>;
};

function certaintyBadge(status: CertaintyStatus): { label: string; cls: string } {
  if (status === 'confirmed') return { label: 'Confirmed · документация', cls: 'lf-badge--documentation' };
  if (status === 'estimated') return { label: 'Estimated · оценка', cls: 'lf-badge--estimated' };
  return { label: 'Unknown · неизвестно', cls: 'lf-badge--unknown' };
}

export function GeminiAutofillCard({
  snapshot,
  selectedPhotoIds,
  manualTouchedFields,
  onApplyProject,
}: GeminiAutofillCardProps) {
  const [activeMode, setActiveMode] = useState<'photo' | 'drawing'>('photo');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [photoResult, setPhotoResult] = useState<GeminiPhotoAnalysis | null>(null);
  const [drawingResult, setDrawingResult] = useState<GeminiDrawingAnalysis | null>(null);
  const [drawingFile, setDrawingFile] = useState<File | null>(null);
  const [selectedProposalIds, setSelectedProposalIds] = useState<Set<string>>(new Set());
  const [appliedNotice, setAppliedNotice] = useState<string | null>(null);
  const [applyWarnings, setApplyWarnings] = useState<string[]>([]);
  const drawingInputRef = useRef<HTMLInputElement>(null);

  const photos = useMemo(() => orderedPhotos(snapshot.project), [snapshot.project]);
  const targetPhoto = useMemo(() => {
    const chosenId = selectedPhotoIds[0] ?? snapshot.project.primaryPhotoId ?? photos[0]?.id;
    return photos.find((p) => p.id === chosenId) ?? photos[0];
  }, [photos, selectedPhotoIds, snapshot.project.primaryPhotoId]);

  const proposals: GeminiAutofillProposal[] = useMemo(() => {
    if (activeMode === 'photo' && photoResult) {
      return buildPhotoProposals(snapshot.project, photoResult, manualTouchedFields);
    }
    if (activeMode === 'drawing' && drawingResult) {
      return buildDrawingProposals(snapshot.project, drawingResult);
    }
    return [];
  }, [activeMode, drawingResult, manualTouchedFields, photoResult, snapshot.project]);

  function initSelection(items: GeminiAutofillProposal[]) {
    setSelectedProposalIds(new Set(items.filter((i) => i.defaultChecked).map((i) => i.id)));
  }

  async function handleAnalyzePhoto() {
    if (!targetPhoto) return;
    const blob = snapshot.originals[targetPhoto.id];
    if (!blob) {
      setError({
        code: 'invalid_input',
        message: 'Оригинал выбранной фотографии не найден в памяти браузера.',
      });
      return;
    }
    setActiveMode('photo');
    setLoading(true);
    setError(null);
    setAppliedNotice(null);
    setApplyWarnings([]);
    try {
      const result = await requestGeminiPhotoAnalysis(blob, targetPhoto.name);
      setPhotoResult(result);
      const nextProposals = buildPhotoProposals(snapshot.project, result, manualTouchedFields);
      initSelection(nextProposals);
    } catch (err) {
      if (err instanceof GeminiClientError) {
        setError({ code: err.code, message: err.message });
      } else {
        setError({
          code: 'network_error',
          message: err instanceof Error ? err.message : 'Ошибка анализа фотографии.',
        });
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleAnalyzeDrawing() {
    if (!drawingFile) return;
    setActiveMode('drawing');
    setLoading(true);
    setError(null);
    setAppliedNotice(null);
    setApplyWarnings([]);
    try {
      const result = await requestGeminiDrawingAnalysis(drawingFile);
      setDrawingResult(result);
      const nextProposals = buildDrawingProposals(snapshot.project, result);
      initSelection(nextProposals);
    } catch (err) {
      if (err instanceof GeminiClientError) {
        setError({ code: err.code, message: err.message });
      } else {
        setError({
          code: 'network_error',
          message: err instanceof Error ? err.message : 'Ошибка чтения чертежа/PDF.',
        });
      }
    } finally {
      setLoading(false);
    }
  }

  function toggleProposal(id: string) {
    setSelectedProposalIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleApplySelected() {
    if (selectedProposalIds.size === 0) return;
    const { project, appliedCount, skippedInvalid } = applyGeminiProposals(
      snapshot.project,
      proposals,
      selectedProposalIds,
    );
    setApplyWarnings(skippedInvalid);
    if (appliedCount === 0) return;
    const sourceLabel = activeMode === 'drawing' ? 'чертежа/PDF' : 'фотографии';
    await onApplyProject(
      project,
      `Применено полей из Gemini AI (${sourceLabel}): ${appliedCount}. Изменения сохранены.`,
    );
    setAppliedNotice(
      `Применено и сохранено полей: ${appliedCount}. Поля, изменённые вручную без вашего подтверждения, остались нетронутыми.`,
    );
  }

  return (
    <section
      id="lf-gemini-autofill-section"
      className="lf-card"
      aria-labelledby="lf-gemini-autofill-heading"
    >
      <div className="lf-card-header">
        <div className="lf-card-title-wrap">
          <span className="lf-card-eyebrow">Gemini AI · Фотографии и технические чертежи / PDF</span>
          <h2 id="lf-gemini-autofill-heading" className="lf-card-title">
            Распознавание и автозаполнение проекта
          </h2>
        </div>
        <div className="lf-segment" role="tablist" aria-label="Режим Gemini AI">
          <button
            id="lf-gemini-mode-photo"
            type="button"
            role="tab"
            className="lf-segment-btn"
            aria-selected={activeMode === 'photo'}
            aria-pressed={activeMode === 'photo'}
            onClick={() => {
              setActiveMode('photo');
              if (photoResult) {
                initSelection(buildPhotoProposals(snapshot.project, photoResult, manualTouchedFields));
              }
            }}
          >
            Фото светильника
          </button>
          <button
            id="lf-gemini-mode-drawing"
            type="button"
            role="tab"
            className="lf-segment-btn"
            aria-selected={activeMode === 'drawing'}
            aria-pressed={activeMode === 'drawing'}
            onClick={() => {
              setActiveMode('drawing');
              if (drawingResult) {
                initSelection(buildDrawingProposals(snapshot.project, drawingResult));
              }
            }}
          >
            Чертёж / PDF
          </button>
        </div>
      </div>

      <div className="lf-card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {activeMode === 'photo' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p className="lf-field-hint" style={{ margin: 0 }}>
              Gemini анализирует визуальные признаки светильника (тип, форму, количество элементов,
              цвета, предполагаемый материал/отделку, подвес, направление света и детали).
              <strong> Не заменяет интернет-поиск оригинала</strong> — для поиска производителя
              используйте{' '}
              <a href="/search" style={{ color: 'var(--accent)' }}>
                AI Visual Search
              </a>
              .
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <button
                id="lf-gemini-analyze-photo-btn"
                type="button"
                className="lf-btn lf-btn--primary lf-btn--sm"
                disabled={!targetPhoto || loading}
                onClick={() => void handleAnalyzePhoto()}
              >
                {loading ? <RefreshIcon size={13} className="lf-spin" /> : <SparkIcon size={13} />}
                {loading ? 'Распознаём фото…' : 'Распознать и заполнить'}
              </button>
              <span className="lf-field-hint">
                {targetPhoto
                  ? `Выбрано фото: ${targetPhoto.name} (оригинал сохраняется без изменений)`
                  : 'Сначала загрузите фотографию светильника выше'}
              </span>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p className="lf-field-hint" style={{ margin: 0 }}>
              Загрузите технический чертёж или PDF-спецификацию (до 15 МиБ). Gemini извлечёт
              размеры (с переводом в <strong>мм</strong>), электрические и оптические параметры,
              материалы и отделки со статусом <strong>Confirmed / Estimated / Unknown</strong>.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <input
                ref={drawingInputRef}
                id="lf-gemini-drawing-input"
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                onChange={(e) => {
                  setDrawingFile(e.target.files?.[0] ?? null);
                  setError(null);
                  setAppliedNotice(null);
                }}
              />
              <button
                id="lf-gemini-analyze-drawing-btn"
                type="button"
                className="lf-btn lf-btn--primary lf-btn--sm"
                disabled={!drawingFile || loading}
                onClick={() => void handleAnalyzeDrawing()}
              >
                {loading ? <RefreshIcon size={13} className="lf-spin" /> : <SparkIcon size={13} />}
                {loading ? 'Читаем чертёж…' : 'Распознать и заполнить'}
              </button>
            </div>
          </div>
        )}

        {error && (
          <div id="lf-gemini-error" className="lf-alert lf-alert--danger" role="alert">
            <div className="lf-alert-content">
              <AlertIcon size={15} style={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span>{error.message}</span>
                <span className="lf-field-hint mono" style={{ color: 'inherit', opacity: 0.85 }}>
                  Код: {error.code} ·{' '}
                  <a href="/settings" style={{ color: 'inherit', textDecoration: 'underline' }}>
                    Проверить подключение в Настройках
                  </a>
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Photo structured summary */}
        {activeMode === 'photo' && photoResult && (
          <div
            id="lf-gemini-photo-result"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              padding: 12,
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              background: 'var(--bg-subtle)',
            }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }}>
              <strong style={{ fontSize: 13 }}>
                Результат анализа фото ({photoResult.photoName})
              </strong>
              <span className="lf-badge lf-badge--estimated mono">
                {photoResult.model} · Estimated
              </span>
            </div>
            <p style={{ margin: 0, fontSize: 12.5 }}>{photoResult.summary}</p>
            <div className="lf-grid-2" style={{ gap: 8, fontSize: 12 }}>
              <div>
                <strong>Тип:</strong>{' '}
                {photoResult.fixtureType.value
                  ? productTypes[photoResult.fixtureType.value][0]
                  : 'Не определено (Unknown)'}
              </div>
              <div>
                <strong>Форма:</strong> {photoResult.shape.value ?? 'Не определено'}
              </div>
              <div>
                <strong>Элементов:</strong>{' '}
                {photoResult.elementCount.value !== null
                  ? photoResult.elementCount.value
                  : 'Не определено'}
              </div>
              <div>
                <strong>Цвета:</strong>{' '}
                {photoResult.primaryColors.length > 0
                  ? photoResult.primaryColors.join(', ')
                  : 'Не определены'}
              </div>
              <div>
                <strong>Предпол. материал:</strong>{' '}
                {photoResult.suspectedMaterial.label ?? 'Не определён'}
              </div>
              <div>
                <strong>Предпол. отделка:</strong>{' '}
                {photoResult.suspectedFinish.label ?? 'Не определена'}
              </div>
              <div>
                <strong>Подвес:</strong> {photoResult.suspensionType.value ?? 'Не определён'}
              </div>
              <div>
                <strong>Направление света:</strong>{' '}
                {photoResult.lightDirection.value
                  ? directions[photoResult.lightDirection.value][0]
                  : 'Не определено'}
              </div>
            </div>
            {photoResult.structuralDetails.length > 0 && (
              <div style={{ fontSize: 12 }}>
                <strong>Конструктивные детали:</strong>{' '}
                {photoResult.structuralDetails.join(' · ')}
              </div>
            )}
            <div className="lf-alert lf-alert--warning" style={{ margin: 0 }}>
              <div className="lf-alert-content">
                <AlertIcon size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>
                  <span>{photoResult.unverifiableNotice}</span>
                  <span>{photoResult.sourceDisclaimer}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Drawing / PDF structured summary */}
        {activeMode === 'drawing' && drawingResult && (
          <div
            id="lf-gemini-drawing-result"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              padding: 12,
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              background: 'var(--bg-subtle)',
            }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }}>
              <strong style={{ fontSize: 13 }}>
                Результат чтения документа ({drawingResult.fileName})
              </strong>
              <span className="lf-badge lf-badge--documentation mono">
                {drawingResult.model} · размеры в мм
              </span>
            </div>
            <p style={{ margin: 0, fontSize: 12.5 }}>{drawingResult.summary}</p>
            <div className="lf-grid-2" style={{ gap: 6, fontSize: 12 }}>
              <div>
                <strong>Width / Height / Depth:</strong>{' '}
                {[
                  drawingResult.dimensionsMm.width.value !== null
                    ? `${drawingResult.dimensionsMm.width.value} мм`
                    : 'Unknown',
                  drawingResult.dimensionsMm.height.value !== null
                    ? `${drawingResult.dimensionsMm.height.value} мм`
                    : 'Unknown',
                  drawingResult.dimensionsMm.depth.value !== null
                    ? `${drawingResult.dimensionsMm.depth.value} мм`
                    : 'Unknown',
                ].join(' × ')}
              </div>
              <div>
                <strong>Diameter / Profile:</strong>{' '}
                {drawingResult.dimensionsMm.diameter.value !== null
                  ? `Ø${drawingResult.dimensionsMm.diameter.value} мм`
                  : 'Unknown'}
                {' · '}
                {drawingResult.dimensionsMm.profileHeight.value !== null
                  ? `H${drawingResult.dimensionsMm.profileHeight.value} мм`
                  : 'профиль Unknown'}
              </div>
              <div>
                <strong>Wattage / Lumens:</strong>{' '}
                {drawingResult.electrical.wattageW.value !== null
                  ? `${drawingResult.electrical.wattageW.value} Вт`
                  : 'Unknown'}{' '}
                /{' '}
                {drawingResult.electrical.lumensLm.value !== null
                  ? `${drawingResult.electrical.lumensLm.value} лм`
                  : 'Unknown'}
              </div>
              <div>
                <strong>CCT / CRI:</strong>{' '}
                {drawingResult.electrical.cctK.value !== null
                  ? `${Math.round(drawingResult.electrical.cctK.value)} K`
                  : 'Unknown'}{' '}
                /{' '}
                {drawingResult.electrical.cri.value !== null
                  ? `CRI ${drawingResult.electrical.cri.value}`
                  : 'Unknown'}
              </div>
              <div>
                <strong>Voltage / IP / Dimming:</strong>{' '}
                {drawingResult.electrical.voltage.value ?? 'Unknown'} ·{' '}
                {drawingResult.electrical.ipRating.value ?? 'Unknown'} ·{' '}
                {drawingResult.electrical.dimming.value ?? 'Unknown'}
              </div>
              <div>
                <strong>Материалы / отделки:</strong>{' '}
                {drawingResult.materials.length > 0
                  ? drawingResult.materials.map((m) => `${m.part}: ${m.label}`).join('; ')
                  : 'Unknown'}
              </div>
            </div>
            {drawingResult.warnings.length > 0 && (
              <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 12 }}>
                {drawingResult.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Selective Apply Checklist (protects manually edited values) */}
        {proposals.length > 0 && (
          <div
            id="lf-gemini-proposals"
            style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <strong style={{ fontSize: 13 }}>
                Предложения к применению ({selectedProposalIds.size} из {proposals.length})
              </strong>
              <button
                id="lf-gemini-apply-btn"
                type="button"
                className="lf-btn lf-btn--primary lf-btn--sm"
                disabled={selectedProposalIds.size === 0}
                onClick={() => void handleApplySelected()}
              >
                <CheckIcon size={13} /> Применить выбранные и сохранить
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {proposals.map((item) => {
                const badge = certaintyBadge(item.status);
                const checked = selectedProposalIds.has(item.id);
                return (
                  <label
                    key={item.id}
                    data-proposal-id={item.id}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      padding: '8px 10px',
                      borderRadius: 'var(--radius-xs)',
                      border: '1px solid var(--border)',
                      background: 'var(--bg-surface)',
                      cursor: 'pointer',
                      fontSize: 12.5,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleProposal(item.id)}
                      style={{ marginTop: 3 }}
                    />
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                        <strong>{item.label}</strong>
                        <span className={`lf-badge ${badge.cls}`}>{badge.label}</span>
                        {item.hasManualValue && (
                          <span className="lf-badge lf-badge--user">
                            Введено вручную — защищено
                          </span>
                        )}
                      </span>
                      <span>
                        Предложение: <strong>{item.proposedDisplay}</strong> · Сейчас:{' '}
                        <span className="lf-field-hint">{item.currentDisplay}</span>
                      </span>
                      {item.note && (
                        <span className="lf-field-hint" style={{ fontSize: 11.5 }}>
                          {item.note}
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {applyWarnings.length > 0 && (
          <div className="lf-alert lf-alert--warning" role="status">
            {applyWarnings.join(' ')}
          </div>
        )}

        {appliedNotice && (
          <div id="lf-gemini-applied-notice" className="lf-alert lf-alert--info" role="status">
            <div className="lf-alert-content">
              <CheckIcon size={15} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{appliedNotice}</span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
