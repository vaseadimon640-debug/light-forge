'use client';

import { useEffect, useState } from 'react';
import type { SearchResult } from '@/visual-search/catalogue';
import {
  CloseIcon,
  ColumnsIcon,
  ExternalLinkIcon,
  FilePdfIcon,
  LayersIcon,
  PlusIcon,
  UploadIcon,
} from '../icons';
import {
  extractComparisonSpec,
  extractDisplayHost,
  formatCropSummary,
  isFullCrop,
  type CropRect,
} from './helpers';
import { LuminaireVisualPlate } from './LuminaireVisualPlate';

export type ComparisonTab = 'side-by-side' | 'matrix';

type ComparisonStudioProps = {
  items: SearchResult[];
  allResults: SearchResult[];
  selectedVariants: Record<string, string>;
  photo?: File;
  photoUrl: string;
  crop: CropRect;
  activeTab: ComparisonTab;
  creatingRfqId: string | null;
  onTabChange: (tab: ComparisonTab) => void;
  onSelectSku: (resultId: string, sku: string) => void;
  onToggleCompare: (result: SearchResult) => void;
  onClearCompare: () => void;
  onCreateRfq: (result: SearchResult) => void;
  onRequestUpload: () => void;
};

const specRows = [
  ['design', 'Дизайн'],
  ['dimensions', 'Размеры (мм)'],
  ['materials', 'Материалы'],
  ['finish', 'Отделка'],
  ['lighting', 'Светотехнические характеристики'],
  ['documentation', 'Документация'],
] as const;

export function ComparisonStudio({
  items,
  allResults,
  selectedVariants,
  photo,
  photoUrl,
  crop,
  activeTab,
  creatingRfqId,
  onTabChange,
  onSelectSku,
  onToggleCompare,
  onClearCompare,
  onCreateRfq,
  onRequestUpload,
}: ComparisonStudioProps) {
  const [focusedId, setFocusedId] = useState<string>(() => items[0]?.id ?? '');
  const [showCroppedPhoto, setShowCroppedPhoto] = useState<boolean>(true);
  const [croppedUrl, setCroppedUrl] = useState<string>('');

  const effectiveFocusedId = items.some(item => item.id === focusedId)
    ? focusedId
    : (items[0]?.id ?? '');
  const focusedItem = items.find(item => item.id === effectiveFocusedId) ?? items[0];

  const hasCrop = !isFullCrop(crop);

  // Render an accurate cropped preview URL when user selected a sub-region
  useEffect(() => {
    if (!photo || !hasCrop) {
      setCroppedUrl('');
      return;
    }
    let cancelled = false;
    let objectUrl = '';

    (async () => {
      try {
        const bitmap = await createImageBitmap(photo);
        try {
          const sx = Math.round((bitmap.width * crop.x) / 100);
          const sy = Math.round((bitmap.height * crop.y) / 100);
          const sw = Math.max(1, Math.min(bitmap.width - sx, Math.round((bitmap.width * crop.width) / 100)));
          const sh = Math.max(1, Math.min(bitmap.height - sy, Math.round((bitmap.height * crop.height) / 100)));
          const scale = Math.min(1, 960 / Math.max(sw, sh));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(sw * scale));
          canvas.height = Math.max(1, Math.round(sh * scale));
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
          const blob = await new Promise<Blob | null>(resolve =>
            canvas.toBlob(resolve, 'image/jpeg', 0.9),
          );
          if (!blob || cancelled) return;
          objectUrl = URL.createObjectURL(blob);
          setCroppedUrl(objectUrl);
        } finally {
          bitmap.close();
        }
      } catch {
        if (!cancelled) setCroppedUrl('');
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photo, crop, hasCrop]);

  if (items.length === 0) return null;

  const availableToAdd = allResults.filter(
    candidate => !items.some(existing => existing.id === candidate.id),
  );
  const activePhotoSrc = hasCrop && showCroppedPhoto && croppedUrl ? croppedUrl : photoUrl;
  const focusedSpec = focusedItem
    ? extractComparisonSpec(focusedItem, selectedVariants[focusedItem.id])
    : null;

  return (
    <section
      id="vs-comparison-studio"
      className="vs-section vs-compare-studio"
      aria-labelledby="vs-compare-heading"
    >
      <div className="vs-compare-head">
        <div className="vs-compare-title-wrap">
          <span className="vs-section-eyebrow">Сравнение</span>
          <h2 id="vs-compare-heading" className="vs-section-title">
            <ColumnsIcon size={18} />
            <span>Сравнение светильников ({items.length})</span>
          </h2>
        </div>

        <div className="vs-compare-controls">
          <div className="lf-segment" role="tablist" aria-label="Режим сравнения">
            <button
              id="vs-compare-tab-side"
              type="button"
              role="tab"
              aria-selected={activeTab === 'side-by-side'}
              className={`lf-segment-btn ${activeTab === 'side-by-side' ? 'lf-segment-btn--active' : ''}`}
              onClick={() => onTabChange('side-by-side')}
            >
              Фото и модель рядом
            </button>
            <button
              id="vs-compare-tab-matrix"
              type="button"
              role="tab"
              aria-selected={activeTab === 'matrix'}
              className={`lf-segment-btn ${activeTab === 'matrix' ? 'lf-segment-btn--active' : ''}`}
              onClick={() => onTabChange('matrix')}
            >
              Сравнение моделей ({items.length})
            </button>
          </div>

          <button
            type="button"
            className="lf-btn lf-btn--sm lf-btn--subtle"
            onClick={onClearCompare}
          >
            <CloseIcon size={13} />
            <span>Очистить</span>
          </button>
        </div>
      </div>

      {/* Quick chips to add other found models into comparison */}
      {availableToAdd.length > 0 && (
        <div className="vs-compare-add-bar">
          <span className="vs-compare-add-label">Добавить к сравнению:</span>
          <div className="vs-compare-add-chips">
            {availableToAdd.map(candidate => (
              <button
                key={candidate.id}
                type="button"
                className="lf-btn lf-btn--sm lf-btn--subtle"
                onClick={() => onToggleCompare(candidate)}
              >
                <PlusIcon size={12} />
                <span>{[candidate.brand, candidate.name].filter(Boolean).join(' ')}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'side-by-side' && focusedItem && focusedSpec && (
        <div className="vs-side-by-side">
          {/* Left: User's Original Photo */}
          <div className="vs-compare-pane">
            <div className="vs-compare-pane-head">
              <div>
                <span className="vs-pane-eyebrow">Исходное фото</span>
                <h3 className="vs-pane-title">{photo ? photo.name : 'Фотография не загружена'}</h3>
              </div>
              {photo && hasCrop && (
                <div className="lf-segment" role="group" aria-label="Вид исходного фото">
                  <button
                    type="button"
                    className={`lf-segment-btn ${showCroppedPhoto ? 'lf-segment-btn--active' : ''}`}
                    aria-pressed={showCroppedPhoto}
                    onClick={() => setShowCroppedPhoto(true)}
                  >
                    Фрагмент
                  </button>
                  <button
                    type="button"
                    className={`lf-segment-btn ${!showCroppedPhoto ? 'lf-segment-btn--active' : ''}`}
                    aria-pressed={!showCroppedPhoto}
                    onClick={() => setShowCroppedPhoto(false)}
                  >
                    Полное
                  </button>
                </div>
              )}
            </div>

            {activePhotoSrc ? (
              <div className="vs-side-photo-box">
                <img
                  src={activePhotoSrc}
                  alt="Исходное фото светильника для сравнения"
                  className="vs-side-photo-img"
                />
                {hasCrop && (
                  <span className="vs-side-photo-tag mono">
                    {showCroppedPhoto ? formatCropSummary(crop) : 'Полный кадр'}
                  </span>
                )}
              </div>
            ) : (
              <div className="vs-side-empty-photo">
                <UploadIcon size={24} />
                <p>Загрузите фотографию светильника, чтобы визуально сравнить её рядом с найденной моделью.</p>
                <button type="button" className="lf-btn lf-btn--sm" onClick={onRequestUpload}>
                  Загрузить фото
                </button>
              </div>
            )}
          </div>

          {/* Right: Found Luminaire */}
          <div className="vs-compare-pane">
            <div className="vs-compare-pane-head">
              <div>
                <span className="vs-pane-eyebrow">
                  {focusedItem.brand ?? extractDisplayHost(focusedItem.source)}
                </span>
                <h3 className="vs-pane-title">{focusedItem.name}</h3>
              </div>
              {items.length > 1 && (
                <div className="vs-switcher-pills" role="group" aria-label="Выбор модели для сравнения с фото">
                  {items.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      className={`vs-sku-pill ${item.id === focusedItem.id ? 'vs-sku-pill--active' : ''}`}
                      onClick={() => setFocusedId(item.id)}
                    >
                      {item.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <LuminaireVisualPlate
              result={focusedItem}
              selectedSku={selectedVariants[focusedItem.id]}
              compact
            />

            {focusedItem.variants && focusedItem.variants.length > 0 && (
              <label className="vs-inline-select">
                <span>Артикул из техпаспорта</span>
                <select
                  className="lf-select"
                  value={selectedVariants[focusedItem.id] ?? ''}
                  onChange={event => onSelectSku(focusedItem.id, event.target.value)}
                >
                  <option value="">Все варианты ({focusedItem.variants.length})</option>
                  {focusedItem.variants.map(v => (
                    <option key={v.sku} value={v.sku}>
                      {v.sku} · {v.widthMm} × {v.depthMm} × {v.heightMm} мм
                    </option>
                  ))}
                </select>
              </label>
            )}

            <dl className="vs-side-spec-list">
              {specRows.map(([key, label]) => {
                const field = focusedSpec[key];
                return (
                  <div key={key} className="vs-side-spec-row">
                    <dt>{label}</dt>
                    <dd>
                      <span className={field.confirmed ? 'vs-val-confirmed' : 'vs-val-pending'}>
                        {field.value}
                      </span>
                      {field.hint && <small>{field.hint}</small>}
                    </dd>
                  </div>
                );
              })}
            </dl>

            <div className="vs-side-actions">
              <a
                href={focusedItem.source}
                target="_blank"
                rel="noreferrer"
                className="lf-btn lf-btn--sm"
              >
                <ExternalLinkIcon size={13} />
                <span>Открыть сайт</span>
              </a>
              {focusedItem.documentUrl && (
                <a
                  href={focusedItem.documentUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="lf-btn lf-btn--sm"
                >
                  <FilePdfIcon size={13} />
                  <span>PDF техпаспорт</span>
                </a>
              )}
              <button
                type="button"
                className="lf-btn lf-btn--sm lf-btn--primary"
                disabled={creatingRfqId === focusedItem.id}
                onClick={() => onCreateRfq(focusedItem)}
              >
                <LayersIcon size={13} />
                <span>Создать запрос фабрике</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'matrix' && (
        <div className="vs-matrix-wrap">
          <table className="vs-matrix-table">
            <thead>
              <tr>
                <th scope="col" className="vs-matrix-axis-col">
                  Параметр
                </th>
                {items.map(item => (
                  <th key={item.id} scope="col" className="vs-matrix-item-col">
                    <div className="vs-matrix-col-head">
                      <div>
                        <span className="vs-matrix-brand">
                          {item.brand ?? extractDisplayHost(item.source)}
                        </span>
                        <div className="vs-matrix-name">{item.name}</div>
                      </div>
                      <button
                        type="button"
                        className="lf-btn lf-btn--icon lf-btn--subtle"
                        aria-label={`Убрать ${item.name} из сравнения`}
                        onClick={() => onToggleCompare(item)}
                      >
                        <CloseIcon size={13} />
                      </button>
                    </div>
                    {item.variants && item.variants.length > 0 && (
                      <select
                        aria-label={`Артикул ${item.name}`}
                        className="lf-select vs-matrix-select"
                        value={selectedVariants[item.id] ?? ''}
                        onChange={event => onSelectSku(item.id, event.target.value)}
                      >
                        <option value="">Все варианты</option>
                        {item.variants.map(v => (
                          <option key={v.sku} value={v.sku}>
                            {v.sku} ({v.widthMm}×{v.depthMm}×{v.heightMm} мм)
                          </option>
                        ))}
                      </select>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {specRows.map(([key, label]) => (
                <tr key={key}>
                  <th scope="row" className="vs-matrix-axis">
                    {label}
                  </th>
                  {items.map(item => {
                    const spec = extractComparisonSpec(item, selectedVariants[item.id]);
                    const field = spec[key];
                    return (
                      <td key={item.id} className="vs-matrix-cell">
                        <span className={field.confirmed ? 'vs-val-confirmed' : 'vs-val-pending'}>
                          {field.value}
                        </span>
                        {field.hint && <small className="vs-matrix-hint">{field.hint}</small>}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr>
                <th scope="row" className="vs-matrix-axis">
                  Действия
                </th>
                {items.map(item => (
                  <td key={item.id} className="vs-matrix-cell">
                    <div className="vs-matrix-actions">
                      <a
                        href={item.source}
                        target="_blank"
                        rel="noreferrer"
                        className="lf-btn lf-btn--sm"
                      >
                        <ExternalLinkIcon size={12} />
                        <span>Открыть</span>
                      </a>
                      {item.documentUrl && (
                        <a
                          href={item.documentUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="lf-btn lf-btn--sm"
                        >
                          <FilePdfIcon size={12} />
                          <span>PDF</span>
                        </a>
                      )}
                      <button
                        type="button"
                        className="lf-btn lf-btn--sm lf-btn--primary"
                        disabled={creatingRfqId === item.id}
                        onClick={() => onCreateRfq(item)}
                      >
                        <span>Запрос фабрике</span>
                      </button>
                    </div>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
