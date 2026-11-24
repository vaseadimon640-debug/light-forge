'use client';

import { useState } from 'react';
import type { GeminiDrawingAnalysis, GeminiPhotoAnalysis } from '@/ai/gemini-contract';
import {
  dimensions,
  directions,
  newComponent,
  productTypes,
  sources,
  type DimensionKey,
  type ProductType,
  type Project,
} from '@/domain/project';
import type { SearchResult } from '@/visual-search/catalogue';
import { AlertIcon, CheckIcon, PlusIcon, SearchIcon } from '../icons';
import { formatProvenance } from '../quick-rfq/geminiAutofill';
import { orderedPhotos } from '../quick-rfq/helpers';
import type { AttachedDrawing } from './wizardState';

const productTypeKeys = Object.keys(productTypes) as ProductType[];

export type DimensionsStageProps = {
  project: Project;
  photoUrls: Record<string, string>;
  drawings: readonly AttachedDrawing[];
  aiPhoto: GeminiPhotoAnalysis | null;
  aiDrawing: GeminiDrawingAnalysis | null;
  originalMatches: readonly SearchResult[];
  onImportCatalogueResult: (result: SearchResult, sku?: string) => void;
  onUpdateProject: (mutator: (p: Project) => Project, touchedKey?: string) => void;
  onBack: () => void;
  onNext: () => void;
};

export function DimensionsStage({
  project,
  photoUrls,
  drawings,
  aiPhoto,
  aiDrawing,
  originalMatches,
  onImportCatalogueResult,
  onUpdateProject,
  onBack,
  onNext,
}: DimensionsStageProps) {
  const [activeCompIdx, setActiveCompIdx] = useState(0);
  const [showConstructionEditor, setShowConstructionEditor] = useState(false);
  const [scaleAxis, setScaleAxis] = useState<'width' | 'outerDiameter' | 'height'>('width');
  const [scaleInputMm, setScaleInputMm] = useState('');
  const [importedNotice, setImportedNotice] = useState<string | null>(null);

  const safeIdx = Math.min(activeCompIdx, Math.max(0, project.components.length - 1));
  const comp = project.components[safeIdx];
  const photos = orderedPhotos(project);
  const primaryPhoto = photos.find((p) => p.id === project.primaryPhotoId) ?? photos[0];
  const primaryUrl = primaryPhoto ? photoUrls[primaryPhoto.id] : undefined;

  const hasAnyDimension = project.components.some((c) => Object.keys(c.dimensions).length > 0);

  function updateCompDimension(key: DimensionKey, rawValue: string) {
    const trimmed = rawValue.trim().replace(',', '.');
    onUpdateProject((p) => ({
      ...p,
      components: p.components.map((item, i) => {
        if (i !== safeIdx) return item;
        const nextDims = { ...item.dimensions };
        if (!trimmed) {
          delete nextDims[key];
        } else {
          const val = Number(trimmed);
          if (Number.isFinite(val) && val >= 0 && val <= 1_000_000) {
            nextDims[key] = { value: val, source: 'user' };
          }
        }
        return { ...item, dimensions: nextDims };
      }),
    }), `dim:${key}`);
  }

  function applyReferenceScale() {
    const val = Number(scaleInputMm.trim().replace(',', '.'));
    if (!Number.isFinite(val) || val <= 0 || val > 1_000_000) return;
    onUpdateProject((p) => ({
      ...p,
      components: p.components.map((item, idx) =>
        idx === safeIdx
          ? { ...item, dimensions: { ...item.dimensions, [scaleAxis]: { value: val, source: 'user' } } }
          : item,
      ),
    }), `dim:${scaleAxis}`);
    setScaleInputMm('');
  }

  const confirmedDrawingItems = aiDrawing
    ? [
        { label: 'Ширина (Width)', field: aiDrawing.dimensionsMm.width, unit: 'мм' },
        { label: 'Высота корпуса (Body Height)', field: aiDrawing.dimensionsMm.height, unit: 'мм' },
        { label: 'Глубина (Depth)', field: aiDrawing.dimensionsMm.depth, unit: 'мм' },
        { label: 'Диаметр (Diameter)', field: aiDrawing.dimensionsMm.diameter, unit: 'мм' },
        { label: 'Внутренний Ø', field: aiDrawing.dimensionsMm.innerDiameter, unit: 'мм' },
        { label: 'Высота профиля', field: aiDrawing.dimensionsMm.profileHeight, unit: 'мм' },
        { label: 'Толщина профиля', field: aiDrawing.dimensionsMm.profileThickness, unit: 'мм' },
        { label: 'Радиус (Radius)', field: aiDrawing.dimensionsMm.radius, unit: 'мм' },
        {
          label: 'Монтажная высота подвеса (отдельно)',
          field: aiDrawing.dimensionsMm.suspensionDrop,
          unit: 'мм',
        },
        { label: 'Мощность', field: aiDrawing.electrical.wattageW, unit: 'Вт' },
        { label: 'Световой поток', field: aiDrawing.electrical.lumensLm, unit: 'лм' },
        { label: 'CCT', field: aiDrawing.electrical.cctK, unit: 'K' },
        { label: 'CRI', field: aiDrawing.electrical.cri, unit: 'Ra' },
      ].filter((item) => item.field.value !== null && item.field.status === 'confirmed')
    : [];

  const estimatedDrawingItems = aiDrawing
    ? [
        { label: 'Ширина', field: aiDrawing.dimensionsMm.width, unit: 'мм' },
        { label: 'Высота корпуса', field: aiDrawing.dimensionsMm.height, unit: 'мм' },
        { label: 'Диаметр', field: aiDrawing.dimensionsMm.diameter, unit: 'мм' },
        { label: 'Внутренний Ø', field: aiDrawing.dimensionsMm.innerDiameter, unit: 'мм' },
        { label: 'Подвес', field: aiDrawing.dimensionsMm.suspensionDrop, unit: 'мм' },
      ].filter((item) => item.field.value !== null && item.field.status === 'estimated')
    : [];

  const missingInfoList = [
    ...(aiDrawing?.missingInformation ?? []),
    ...(aiPhoto?.missingInformation ?? []),
  ].filter((item, idx, arr) => arr.indexOf(item) === idx);

  const dimFields: DimensionKey[] = [
    'width',
    'height',
    'depth',
    'outerDiameter',
    'innerDiameter',
    'profileHeight',
    'profileThickness',
    'radius',
  ];

  return (
    <section aria-labelledby="lfw-stage2-title">
      <div className="lfw-stage-head" style={{ marginBottom: 18 }}>
        <div>
          <h1 id="lfw-stage2-title">Результаты анализа и размеры</h1>
          <p>
            Данные разделены по достоверности (Confirmed / Estimated / Unknown). Ручные правки всегда имеют приоритет над AI.
          </p>
        </div>
        <button
          id="lfw-toggle-construction-btn"
          type="button"
          className="lf-btn lf-btn--subtle"
          onClick={() => setShowConstructionEditor((v) => !v)}
        >
          {showConstructionEditor ? 'Скрыть редактор конструкции' : 'Изменить конструкцию'}
        </button>
      </div>

      <div className="lfw-split">
        <aside className="lfw-visual-aside">
          <div className="lfw-visual-aside-img">
            {primaryUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={primaryUrl} alt={primaryPhoto?.name ?? project.name} />
            ) : (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--atelier-muted)', fontSize: 13 }}>
                Фотография не загружена — можно вернуться на шаг 1.
              </div>
            )}
          </div>
          <div className="lfw-visual-aside-meta">
            <strong>{project.name}</strong>
            <span className="lf-field-hint">
              {productTypes[project.kind][0]} · Элементов: {project.components.length} · Чертежи/PDF:{' '}
              {drawings.length}
            </span>
            {aiPhoto?.possibleBrand.value && (
              <span className="lf-badge lf-badge--estimated">
                Предпол. бренд (не доказано): {aiPhoto.possibleBrand.value}
                {aiPhoto.possibleCollection.value ? ` · ${aiPhoto.possibleCollection.value}` : ''}
              </span>
            )}
          </div>
        </aside>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Separate Original Catalogue Search Results (Section 10) */}
          {originalMatches.length > 0 && (
            <div className="lfw-panel" id="lfw-original-matches-panel">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <h2>
                  <SearchIcon size={15} /> Поиск оригинала по каталогу (отдельно от Gemini Vision)
                </h2>
                <span className="lf-badge lf-badge--unknown">Импорт только по вашему выбору</span>
              </div>
              {originalMatches.slice(0, 3).map((match) => (
                <div key={match.id} className="lfw-status-row">
                  <div style={{ display: 'grid', gap: 3 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <strong>
                        {match.brand ? `${match.brand} ` : ''}
                        {match.name}
                      </strong>
                      <span
                        className={`lf-badge ${
                          match.category === 'verified_original'
                            ? 'lf-badge--documentation'
                            : 'lf-badge--estimated'
                        }`}
                      >
                        {match.category === 'verified_original'
                          ? 'Оригинал в каталоге'
                          : 'Похожая модель'}
                      </span>
                    </div>
                    <span className="lf-field-hint">
                      {match.variants && match.variants.length > 0
                        ? `Варианты SKU: ${match.variants.map((v) => v.sku).join(', ')}`
                        : match.source}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {match.variants && match.variants.length > 0 ? (
                      match.variants.slice(0, 2).map((variant) => (
                        <button
                          key={variant.sku}
                          type="button"
                          className="lf-btn lf-btn--sm lf-btn--subtle"
                          onClick={() => {
                            onImportCatalogueResult(match, variant.sku);
                            setImportedNotice(
                              `Импортированы документированные характеристики ${match.name} (${variant.sku}). Ручные поля сохранены.`,
                            );
                          }}
                        >
                          Импортировать {variant.sku}
                        </button>
                      ))
                    ) : (
                      <button
                        type="button"
                        className="lf-btn lf-btn--sm lf-btn--subtle"
                        onClick={() => {
                          onImportCatalogueResult(match);
                          setImportedNotice(`Импортированы доступные данные «${match.name}».`);
                        }}
                      >
                        Импортировать характеристики
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {importedNotice && (
                <span className="lf-field-hint" role="status">
                  {importedNotice}
                </span>
              )}
            </div>
          )}

          {/* Conflicting Dimensions Alert from Drawing */}
          {aiDrawing && aiDrawing.conflicts.length > 0 && (
            <div id="lfw-drawing-conflicts" className="lf-alert lf-alert--danger" role="alert">
              <div className="lf-alert-content">
                <AlertIcon size={15} style={{ flexShrink: 0, marginTop: 2 }} />
                <div style={{ display: 'grid', gap: 4 }}>
                  <strong>Обнаружены противоречивые размеры в чертеже:</strong>
                  {aiDrawing.conflicts.map((c) => (
                    <span key={`${c.field}-${c.values.join('-')}`}>
                      {c.field}: {c.values.join(' vs ')} — {c.message}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* AI Results Grouped by CONFIRMED / ESTIMATED / UNKNOWN */}
          {(aiPhoto || aiDrawing) && (
            <div className="lfw-panel" id="lfw-ai-grouped-panel">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <h2>Распознанные характеристики по статусам</h2>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {(aiPhoto?.cached || aiDrawing?.cached) && (
                    <span className="lf-badge lf-badge--documentation">Из кеша (0 токенов)</span>
                  )}
                  <span className="lf-badge lf-badge--user mono">
                    {aiDrawing?.model ?? aiPhoto?.model}
                  </span>
                </div>
              </div>

              {/* CONFIRMED group */}
              {confirmedDrawingItems.length > 0 && (
                <div style={{ display: 'grid', gap: 6 }}>
                  <span className="lf-badge lf-badge--documentation" style={{ justifySelf: 'start' }}>
                    CONFIRMED · Подтверждено из чертежа / PDF ({confirmedDrawingItems.length})
                  </span>
                  {confirmedDrawingItems.map((item) => {
                    const prov = formatProvenance(item.field.provenance);
                    return (
                      <div key={item.label} className="lfw-status-row">
                        <span>
                          <strong>{item.label}:</strong> {item.field.value} {item.unit}
                        </span>
                        {prov && <span className="lf-field-hint">{prov}</span>}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ESTIMATED group */}
              {(aiPhoto || estimatedDrawingItems.length > 0) && (
                <div style={{ display: 'grid', gap: 6 }}>
                  <span className="lf-badge lf-badge--estimated" style={{ justifySelf: 'start' }}>
                    ESTIMATED · Предполагается по изображению
                  </span>
                  {aiPhoto && (
                    <div className="lfw-grid-2" style={{ gap: 6, fontSize: 12.5 }}>
                      <div>
                        <strong>Тип:</strong>{' '}
                        {aiPhoto.fixtureType.value ? productTypes[aiPhoto.fixtureType.value][0] : 'Unknown'}
                      </div>
                      <div>
                        <strong>Форма:</strong> {aiPhoto.shape.value ?? 'Unknown'}
                      </div>
                      <div>
                        <strong>Элементов:</strong> {aiPhoto.elementCount.value ?? 'Unknown'}
                      </div>
                      <div>
                        <strong>Цвета:</strong>{' '}
                        {aiPhoto.primaryColors.length > 0 ? aiPhoto.primaryColors.join(', ') : 'Unknown'}
                      </div>
                      <div>
                        <strong>Материал (оценка):</strong>{' '}
                        {aiPhoto.suspectedMaterial.label ?? 'Unknown'}
                      </div>
                      <div>
                        <strong>Отделка (оценка):</strong>{' '}
                        {aiPhoto.suspectedFinish.label ?? 'Unknown'}
                      </div>
                      <div>
                        <strong>Рассеиватель:</strong>{' '}
                        {aiPhoto.hasDiffuser.value === null
                          ? 'Unknown'
                          : aiPhoto.hasDiffuser.value
                            ? aiPhoto.hasDiffuser.description ?? 'Да (виден)'
                            : 'Не виден'}
                      </div>
                      <div>
                        <strong>Направление света:</strong>{' '}
                        {aiPhoto.lightDirection.value ? directions[aiPhoto.lightDirection.value][0] : 'Unknown'}
                      </div>
                      <div>
                        <strong>Подвес:</strong> {aiPhoto.suspensionType.value ?? 'Unknown'}
                      </div>
                      <div>
                        <strong>Потолочное крепление:</strong>{' '}
                        {aiPhoto.ceilingMountVisible.value ?? 'Unknown'}
                      </div>
                    </div>
                  )}
                  {aiPhoto?.geometricFeatures && aiPhoto.geometricFeatures.length > 0 && (
                    <span className="lf-field-hint">
                      Геометрия: {aiPhoto.geometricFeatures.join(' · ')}
                    </span>
                  )}
                  {estimatedDrawingItems.map((item) => (
                    <div key={item.label} className="lfw-status-row">
                      <span>
                        <strong>{item.label}:</strong> {item.field.value} {item.unit}
                      </span>
                      <span className="lf-field-hint">
                        {formatProvenance(item.field.provenance) ?? 'Оценка по чертежу'}
                      </span>
                    </div>
                  ))}
                  {aiPhoto && <span className="lf-field-hint">{aiPhoto.suspectedMaterial.uncertaintyReason}</span>}
                </div>
              )}

              {/* UNKNOWN group */}
              {missingInfoList.length > 0 && (
                <div style={{ display: 'grid', gap: 4 }}>
                  <span className="lf-badge lf-badge--unknown" style={{ justifySelf: 'start' }}>
                    UNKNOWN · Требуется ввод или подтверждение фабрики
                  </span>
                  <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 12, color: 'var(--atelier-muted)' }}>
                    {missingInfoList.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Reference Scaling Helper when no dimensions are known yet */}
          {!hasAnyDimension && (
            <div className="lfw-panel" id="lfw-scale-helper">
              <h2>Размеры неизвестны — задайте базовый размер для масштаба</h2>
              <p className="lf-field-hint" style={{ margin: 0 }}>
                AI не придумывает размеры по фотографии. Введите один известный габарит (мм), чтобы зафиксировать масштаб модели.
              </p>
              <div className="lfw-grid-3" style={{ alignItems: 'end' }}>
                <div className="lfw-field">
                  <label htmlFor="lfw-scale-axis">Опорный габарит</label>
                  <select
                    id="lfw-scale-axis"
                    value={scaleAxis}
                    onChange={(e) => setScaleAxis(e.target.value as 'width' | 'outerDiameter' | 'height')}
                  >
                    <option value="width">Ширина (мм)</option>
                    <option value="outerDiameter">Внешний диаметр (мм)</option>
                    <option value="height">Высота корпуса (мм)</option>
                  </select>
                </div>
                <div className="lfw-field">
                  <label htmlFor="lfw-scale-val">Значение (мм)</label>
                  <input
                    id="lfw-scale-val"
                    type="number"
                    min={1}
                    placeholder="Например, 900"
                    value={scaleInputMm}
                    onChange={(e) => setScaleInputMm(e.target.value)}
                  />
                </div>
                <button
                  id="lfw-apply-scale-btn"
                  type="button"
                  className="lf-btn lf-btn--subtle"
                  disabled={!scaleInputMm.trim()}
                  onClick={applyReferenceScale}
                >
                  Зафиксировать (мм)
                </button>
              </div>
            </div>
          )}

          {/* Core Editable Identity & Dimensions Panel */}
          <div className="lfw-panel">
            <h2>Модель и размеры корпуса (мм)</h2>
            <div className="lfw-grid-3">
              <div className="lfw-field">
                <label htmlFor="lfw-proj-name">Название проекта / модели</label>
                <input
                  id="lfw-proj-name"
                  type="text"
                  value={project.name}
                  onChange={(e) => onUpdateProject((p) => ({ ...p, name: e.target.value }), 'name')}
                />
              </div>
              <div className="lfw-field">
                <label htmlFor="lfw-proj-code">Артикул / SKU</label>
                <input
                  id="lfw-proj-code"
                  type="text"
                  placeholder="Unknown → на подтверждение"
                  value={project.code}
                  onChange={(e) => onUpdateProject((p) => ({ ...p, code: e.target.value }), 'code')}
                />
              </div>
              <div className="lfw-field">
                <label htmlFor="lfw-proj-kind">Тип светильника</label>
                <select
                  id="lfw-proj-kind"
                  value={project.kind}
                  onChange={(e) => {
                    const nextKind = e.target.value as ProductType;
                    onUpdateProject(
                      (p) => ({
                        ...p,
                        kind: nextKind,
                        components: p.components.map((c) =>
                          p.components.length === 1 || c.kind === p.kind
                            ? { ...c, kind: nextKind }
                            : c,
                        ),
                      }),
                      'kind',
                    );
                  }}
                >
                  {productTypeKeys.map((k) => (
                    <option key={k} value={k}>
                      {productTypes[k][0]} ({productTypes[k][1]})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Component selector pills */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              {project.components.map((c, idx) => (
                <button
                  key={c.id}
                  type="button"
                  className={`lf-btn lf-btn--sm${idx === safeIdx ? ' lf-btn--primary' : ' lf-btn--subtle'}`}
                  onClick={() => setActiveCompIdx(idx)}
                >
                  {c.name} ×{c.quantity}
                </button>
              ))}
              <button
                type="button"
                className="lf-btn lf-btn--sm lf-btn--subtle"
                onClick={() => {
                  const nextComp = newComponent(project.kind);
                  nextComp.name = `Элемент ${project.components.length + 1}`;
                  onUpdateProject((p) => ({
                    ...p,
                    components: [...p.components, nextComp],
                  }));
                  setActiveCompIdx(project.components.length);
                }}
              >
                <PlusIcon size={12} /> Добавить часть
              </button>
            </div>

            {showConstructionEditor && (
              <div
                id="lfw-construction-editor"
                style={{
                  padding: 12,
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--atelier-edge)',
                  background: 'var(--bg-subtle)',
                  display: 'grid',
                  gap: 10,
                }}
              >
                <div className="lfw-grid-3">
                  <div className="lfw-field">
                    <label htmlFor="lfw-comp-name">Название части</label>
                    <input
                      id="lfw-comp-name"
                      type="text"
                      value={comp.name}
                      onChange={(e) =>
                        onUpdateProject((p) => ({
                          ...p,
                          components: p.components.map((item, i) =>
                            i === safeIdx ? { ...item, name: e.target.value } : item,
                          ),
                        }))
                      }
                    />
                  </div>
                  <div className="lfw-field">
                    <label htmlFor="lfw-comp-kind">Форма части</label>
                    <select
                      id="lfw-comp-kind"
                      value={comp.kind}
                      onChange={(e) =>
                        onUpdateProject((p) => ({
                          ...p,
                          components: p.components.map((item, i) =>
                            i === safeIdx ? { ...item, kind: e.target.value as ProductType } : item,
                          ),
                        }))
                      }
                    >
                      {productTypeKeys.map((k) => (
                        <option key={k} value={k}>
                          {productTypes[k][0]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="lfw-field">
                    <label htmlFor="lfw-comp-qty">Кол-во в изделии</label>
                    <input
                      id="lfw-comp-qty"
                      type="number"
                      min={1}
                      max={1000}
                      value={comp.quantity}
                      onChange={(e) => {
                        const qty = Math.max(1, Number.parseInt(e.target.value, 10) || 1);
                        onUpdateProject((p) => ({
                          ...p,
                          components: p.components.map((item, i) =>
                            i === safeIdx ? { ...item, quantity: qty } : item,
                          ),
                        }));
                      }}
                    />
                  </div>
                </div>
                {project.components.length > 1 && (
                  <div>
                    <button
                      type="button"
                      className="lf-btn lf-btn--sm lf-btn--danger"
                      onClick={() => {
                        onUpdateProject((p) => ({
                          ...p,
                          components: p.components.filter((_, i) => i !== safeIdx),
                          mounting: {
                            ...p.mounting,
                            placements: p.mounting.placements.filter((pl) => pl.componentId !== comp.id),
                          },
                        }));
                        setActiveCompIdx(Math.max(0, safeIdx - 1));
                      }}
                    >
                      Удалить часть «{comp.name}»
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="lfw-grid-3">
              {dimFields.map((key) => {
                const current = comp.dimensions[key];
                return (
                  <div key={key} className="lfw-field">
                    <label htmlFor={`lfw-dim-${key}`}>
                      {dimensions[key][0]} (мм)
                      {current && (
                        <span style={{ marginLeft: 6, fontWeight: 400, opacity: 0.75 }}>
                          · {sources[current.source][0]}
                        </span>
                      )}
                    </label>
                    <input
                      id={`lfw-dim-${key}`}
                      type="number"
                      min={0}
                      step="1"
                      placeholder="Unknown"
                      value={current ? String(current.value) : ''}
                      onChange={(e) => updateCompDimension(key, e.target.value)}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          <div className="lfw-footer-nav">
            <button type="button" className="lf-btn lf-btn--subtle" onClick={onBack}>
              ← Назад к загрузке
            </button>
            <button id="lfw-confirm-dims-btn" type="button" className="lf-btn lf-btn--primary" onClick={onNext}>
              <CheckIcon size={15} /> Подтвердить размеры →
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
