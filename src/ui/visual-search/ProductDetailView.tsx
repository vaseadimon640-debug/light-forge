'use client';

import { useEffect, useRef, useState } from 'react';
import type { SearchResult } from '@/visual-search/catalogue';
import {
  AlertIcon,
  ArrowLeftIcon,
  BookmarkIcon,
  ChatIcon,
  CheckIcon,
  ColumnsIcon,
  ExternalLinkIcon,
  FilePdfIcon,
  LayersIcon,
  SearchIcon,
  ShieldIcon,
  StarIcon,
} from '../icons';
import {
  buildUnconfirmedChecklist,
  categoryMeta,
  extractDisplayHost,
  filterLightingConfigurations,
  formatLightDirection,
  formatTransformSummary,
  isTransformDefault,
  localMatchMeta,
  productKindLabel,
  readResultSpecifications,
  type LocalSearchMatch,
  type SearchPhotoItem,
} from './helpers';
import { createWorkingPhotoCopy } from './image-processing';
import { LuminaireVisualPlate } from './LuminaireVisualPlate';

type ProductDetailViewProps = {
  result: SearchResult;
  selectedSku: string;
  isCompared: boolean;
  isSaved: boolean;
  creatingRfq: boolean;
  localMatch?: LocalSearchMatch;
  photos: SearchPhotoItem[];
  photoUrls: Record<string, string>;
  primaryPhotoId: string | null;
  onBack: () => void;
  onSelectSku: (sku: string) => void;
  onToggleCompare: (result: SearchResult) => void;
  onFindSimilar: (result: SearchResult) => void;
  onToggleSave: (result: SearchResult) => void;
  onReviewChatGpt: (result: SearchResult) => void;
  onCreateRfq: (result: SearchResult) => void;
};

export function ProductDetailView({
  result,
  selectedSku,
  isCompared,
  isSaved,
  creatingRfq,
  localMatch,
  photos,
  photoUrls,
  primaryPhotoId,
  onBack,
  onSelectSku,
  onToggleCompare,
  onFindSimilar,
  onToggleSave,
  onReviewChatGpt,
  onCreateRfq,
}: ProductDetailViewProps) {
  const backButtonRef = useRef<HTMLButtonElement | null>(null);
  const [inspectPhotoId, setInspectPhotoId] = useState<string>(
    () => primaryPhotoId ?? photos[0]?.id ?? '',
  );
  const [showWorkingCopy, setShowWorkingCopy] = useState(true);
  const [workingPreviewUrl, setWorkingPreviewUrl] = useState('');

  const meta = categoryMeta(result.category);
  const localMeta = localMatch ? localMatchMeta(localMatch.match) : null;
  const host = extractDisplayHost(result.source);
  const kind = productKindLabel(result.kind);
  const variants = result.variants ?? [];
  const activeVariant = variants.find(item => item.sku === selectedSku);
  const specs = readResultSpecifications(result);
  const lightConfigs = filterLightingConfigurations(specs, activeVariant?.widthMm);
  const checklist = buildUnconfirmedChecklist(result, selectedSku);

  const inspectedPhoto =
    photos.find(item => item.id === inspectPhotoId) ??
    photos.find(item => item.id === primaryPhotoId) ??
    photos[0];
  const inspectedHasEdit = Boolean(
    inspectedPhoto && !isTransformDefault(inspectedPhoto.crop, inspectedPhoto.rotation),
  );

  useEffect(() => {
    backButtonRef.current?.focus();
  }, [result.id]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        const tag = (event.target as HTMLElement | null)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        onBack();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onBack]);

  useEffect(() => {
    if (!inspectedPhoto || !inspectedHasEdit) {
      setWorkingPreviewUrl('');
      return;
    }
    let cancelled = false;
    let url = '';
    void createWorkingPhotoCopy(inspectedPhoto.file, inspectedPhoto.crop, inspectedPhoto.rotation, 960)
      .then(copy => {
        if (cancelled) return;
        url = URL.createObjectURL(copy);
        setWorkingPreviewUrl(url);
      })
      .catch(() => {
        if (!cancelled) setWorkingPreviewUrl('');
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [inspectedPhoto, inspectedHasEdit]);

  const inspectedSrc =
    inspectedPhoto
      ? inspectedHasEdit && showWorkingCopy && workingPreviewUrl
        ? workingPreviewUrl
        : (photoUrls[inspectedPhoto.id] ?? '')
      : '';

  return (
    <section
      id="vs-product-detail"
      className="vs-detail-view"
      aria-labelledby="vs-detail-heading"
    >
      {/* Navigation & Status Top Bar */}
      <div className="vs-detail-nav">
        <button
          ref={backButtonRef}
          id="vs-detail-back-btn"
          type="button"
          className="lf-btn lf-btn--sm"
          onClick={onBack}
        >
          <ArrowLeftIcon size={14} />
          <span>К результатам поиска</span>
        </button>

        <div className="vs-detail-badges">
          <span className={`vs-pill vs-pill--${meta.tone}`}>{meta.badge}</span>
          <span className="vs-pill vs-pill--est" data-testid="vs-detail-unverified-badge">
            Original not verified
          </span>
        </div>
      </div>

      {/* Prominent Honest Provenance Banner */}
      <div className="vs-status-strip vs-detail-banner">
        <div className="vs-status-main">
          <ShieldIcon size={16} className="vs-status-icon" />
          <div>
            <strong>Original not verified</strong>
            <span>
              {' '}
              — данные ниже относятся к указанной записи каталога ({host}), а не к автоматическому подтверждению вашей фотографии. Сверьте геометрию, отделку и техпаспорт перед заказом.
            </span>
          </div>
        </div>
        <div className="vs-detail-source-links">
          <a
            href={result.source}
            target="_blank"
            rel="noreferrer"
            className="lf-btn lf-btn--sm"
          >
            <ExternalLinkIcon size={13} />
            <span>Официальная страница</span>
          </a>
          {result.documentUrl && (
            <a
              href={result.documentUrl}
              target="_blank"
              rel="noreferrer"
              className="lf-btn lf-btn--sm lf-btn--brass"
            >
              <FilePdfIcon size={13} />
              <span>PDF техпаспорт</span>
            </a>
          )}
        </div>
      </div>

      {/* Main 2-Column Architectural Dossier */}
      <div className="vs-detail-grid">
        {/* Left Column: Real Sources & User Reference Photos */}
        <div className="vs-detail-media-col">
          <div className="vs-detail-panel">
            <div className="vs-detail-panel-head">
              <span className="vs-pane-eyebrow">Официальный источник</span>
              <span className="vs-detail-host mono">{host}</span>
            </div>

            <LuminaireVisualPlate result={result} selectedSku={selectedSku} />

            <p className="vs-detail-media-note">
              Фотографии изделия не копируются без разрешения — для просмотра официальных снимков откройте карточку производителя или PDF техпаспорт.
            </p>
          </div>

          {localMatch && localMeta && (
            <div className={`vs-local-strip vs-local-strip--${localMatch.match}`}>
              <span className={`vs-pill vs-pill--${localMeta.tone}`}>{localMeta.label}</span>
              <span className="vs-local-strip-copy">
                Локальный индекс: {localMatch.title} (<span className="mono">{localMatch.id}</span>) · {localMeta.explanation}
              </span>
            </div>
          )}

          {photos.length > 0 && inspectedPhoto && (
            <div className="vs-detail-panel vs-detail-user-photos">
              <div className="vs-detail-panel-head">
                <div>
                  <span className="vs-pane-eyebrow">Ваши оригиналы для сверки ({photos.length})</span>
                  <h3 className="vs-pane-title">{inspectedPhoto.file.name}</h3>
                </div>
                {inspectedHasEdit && (
                  <div className="lf-segment" role="group" aria-label="Режим просмотра загруженного фото">
                    <button
                      type="button"
                      className={`lf-segment-btn ${showWorkingCopy ? 'lf-segment-btn--active' : ''}`}
                      aria-pressed={showWorkingCopy}
                      onClick={() => setShowWorkingCopy(true)}
                    >
                      Рабочая копия
                    </button>
                    <button
                      type="button"
                      className={`lf-segment-btn ${!showWorkingCopy ? 'lf-segment-btn--active' : ''}`}
                      aria-pressed={!showWorkingCopy}
                      onClick={() => setShowWorkingCopy(false)}
                    >
                      Оригинал
                    </button>
                  </div>
                )}
              </div>

              {inspectedSrc && (
                <div className="vs-side-photo-box">
                  <img
                    src={inspectedSrc}
                    alt={`Ваше фото для сверки: ${inspectedPhoto.file.name}`}
                    className="vs-side-photo-img"
                  />
                  <span className="vs-side-photo-tag mono">
                    {inspectedPhoto.id === primaryPhotoId ? 'Основное · ' : ''}
                    {inspectedHasEdit && showWorkingCopy
                      ? formatTransformSummary(inspectedPhoto.crop, inspectedPhoto.rotation)
                      : 'Оригинал без изменений'}
                  </span>
                </div>
              )}

              {photos.length > 1 && (
                <div className="vs-detail-thumbs" role="group" aria-label="Выбор загруженного фото для сверки">
                  {photos.map(item => {
                    const active = item.id === inspectedPhoto.id;
                    const isPrimary = item.id === primaryPhotoId;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`vs-detail-thumb ${active ? 'vs-detail-thumb--active' : ''}`}
                        aria-pressed={active}
                        onClick={() => setInspectPhotoId(item.id)}
                      >
                        <img src={photoUrls[item.id] ?? ''} alt={item.file.name} />
                        {isPrimary && (
                          <span className="vs-detail-thumb-star" title="Основное фото">
                            <StarIcon size={10} filled />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              <p className="vs-detail-media-note">
                При создании Quick RFQ все загруженные оригиналы ({photos.length}) сохранятся без изменений, основное фото пойдёт первым в PDF.
              </p>
            </div>
          )}
        </div>

        {/* Right Column: Full Dossier, SKU Selector, Specs & RFQ CTA */}
        <div className="vs-detail-info-col">
          <div className="vs-detail-panel">
            <div className="vs-card-eyebrow">
              <span>{result.brand ?? host}</span>
              {kind && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{kind}</span>
                </>
              )}
              {specs?.designer && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>Дизайн {specs.designer}</span>
                </>
              )}
            </div>

            <h2 id="vs-detail-heading" className="vs-detail-title">
              {result.name}
            </h2>

            {result.details && <p className="vs-detail-desc">{result.details}</p>}

            {/* Primary & Secondary Actions */}
            <div className="vs-detail-actions">
              <button
                id="vs-detail-create-rfq"
                type="button"
                className="lf-btn lf-btn--primary vs-detail-rfq-btn"
                disabled={creatingRfq}
                onClick={() => onCreateRfq(result)}
              >
                <LayersIcon size={15} />
                <span>
                  {creatingRfq
                    ? 'Открываем Quick RFQ…'
                    : activeVariant
                      ? `Создать запрос фабрике (${activeVariant.sku})`
                      : 'Создать запрос фабрике'}
                </span>
              </button>

              <div className="vs-detail-secondary-actions">
                <button
                  type="button"
                  className={`lf-btn lf-btn--sm ${isCompared ? 'lf-btn--brass' : ''}`}
                  aria-pressed={isCompared}
                  onClick={() => onToggleCompare(result)}
                >
                  {isCompared ? <CheckIcon size={13} /> : <ColumnsIcon size={13} />}
                  <span>{isCompared ? 'В сравнении' : 'Сравнить'}</span>
                </button>
                <button
                  type="button"
                  className="lf-btn lf-btn--sm"
                  onClick={() => onFindSimilar(result)}
                >
                  <SearchIcon size={13} />
                  <span>Найти похожие</span>
                </button>
                <button
                  type="button"
                  className={`lf-btn lf-btn--sm ${isSaved ? 'lf-btn--brass' : ''}`}
                  aria-pressed={isSaved}
                  onClick={() => onToggleSave(result)}
                >
                  <BookmarkIcon size={13} filled={isSaved} />
                  <span>{isSaved ? 'Сохранено' : 'Сохранить'}</span>
                </button>
                <button
                  type="button"
                  className="lf-btn lf-btn--sm"
                  onClick={() => onReviewChatGpt(result)}
                >
                  <ChatIcon size={13} />
                  <span>Проверить через ChatGPT</span>
                </button>
              </div>
            </div>
          </div>

          {/* SKU Variants & Confirmed Dimensions */}
          {variants.length > 0 && (
            <div className="vs-detail-panel">
              <div className="vs-detail-panel-head">
                <h3 className="vs-detail-h3">Артикулы и подтверждённые габариты (мм)</h3>
                {specs?.dimensionsReferTo && (
                  <span className="lf-badge lf-badge--documentation">
                    Отсчёт: {specs.dimensionsReferTo}
                  </span>
                )}
              </div>

              <div className="vs-doc-table-wrap">
                <table className="vs-doc-table">
                  <thead>
                    <tr>
                      <th>Артикул</th>
                      <th>Ширина</th>
                      <th>Глубина</th>
                      <th>Высота</th>
                      <th>Диммирование</th>
                      <th aria-label="Выбор для RFQ" />
                    </tr>
                  </thead>
                  <tbody>
                    {variants.map(variant => {
                      const active = selectedSku === variant.sku;
                      return (
                        <tr
                          key={variant.sku}
                          className={active ? 'vs-doc-row--active' : ''}
                        >
                          <td className="mono">
                            <strong>{variant.sku}</strong>
                          </td>
                          <td className="mono">{variant.widthMm} мм</td>
                          <td className="mono">{variant.depthMm} мм</td>
                          <td className="mono">{variant.heightMm} мм</td>
                          <td>{result.confirmedDimming ?? 'На подтверждение'}</td>
                          <td className="vs-doc-cell-action">
                            <button
                              type="button"
                              className={`lf-btn lf-btn--sm ${active ? 'lf-btn--primary' : ''}`}
                              aria-pressed={active}
                              onClick={() => onSelectSku(active ? '' : variant.sku)}
                            >
                              {active ? 'Выбран' : 'Выбрать'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {specs?.standardMaxBandLengthMm && (
                <p className="vs-detail-footnote">
                  Максимальная стандартная длина декоративного ремня по техпаспорту:{' '}
                  <strong className="mono">{specs.standardMaxBandLengthMm} мм</strong>.
                </p>
              )}
            </div>
          )}

          {/* Documented Materials, Finishes & Form (kept strictly separate!) */}
          <div className="vs-detail-panel">
            <h3 className="vs-detail-h3">Документированные характеристики</h3>
            {specs ? (
              <dl className="vs-detail-spec-list">
                {specs.form && (
                  <div className="vs-detail-spec-row">
                    <dt>Форма и тип</dt>
                    <dd>{[kind, specs.form].filter(Boolean).join(' · ')}</dd>
                  </div>
                )}
                {specs.materials && specs.materials.length > 0 && (
                  <div className="vs-detail-spec-row">
                    <dt>Материалы по деталям</dt>
                    <dd>
                      <ul className="vs-detail-inline-list">
                        {specs.materials.map(item => (
                          <li key={`${item.part}-${item.material}`}>
                            <strong>{item.part}:</strong> {item.material}
                          </li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                )}
                {specs.finishes && specs.finishes.length > 0 && (
                  <div className="vs-detail-spec-row">
                    <dt>Отделки (отдельно от материала)</dt>
                    <dd className="vs-finish-tags">
                      {specs.finishes.map(item => (
                        <span key={`${item.part}-${item.code}`} className="vs-finish-tag">
                          <span>{item.part}</span>
                          <strong className="mono">{item.code}</strong>
                          <span>{item.name}</span>
                        </span>
                      ))}
                    </dd>
                  </div>
                )}
                {result.confirmedDimming && (
                  <div className="vs-detail-spec-row">
                    <dt>Диммирование</dt>
                    <dd>
                      <span className="lf-badge lf-badge--documentation">
                        {result.confirmedDimming}
                      </span>
                    </dd>
                  </div>
                )}
                {specs.lighting && (
                  <div className="vs-detail-spec-row">
                    <dt>Источник и питание</dt>
                    <dd className="mono">
                      {specs.lighting.sourceType} {specs.lighting.sourceVoltageV} В · Сеть{' '}
                      {specs.lighting.supplyVoltageV.map(v => `${v.min}–${v.max} В`).join(' / ')}
                    </dd>
                  </div>
                )}
              </dl>
            ) : (
              <p className="vs-detail-footnote">
                Подробная структурированная таблица характеристик для этой записи в каталоге не заполнена. Проверьте официальную страницу источника ({host}) и оставьте неизвестные поля на подтверждение фабрике.
              </p>
            )}
          </div>

          {/* Lighting Configurations Table */}
          {specs?.lighting && lightConfigs.length > 0 && (
            <div className="vs-detail-panel">
              <div className="vs-detail-panel-head">
                <h3 className="vs-detail-h3">
                  Световые конфигурации по техпаспорту
                </h3>
                {activeVariant && (
                  <span className="lf-badge lf-badge--accent mono">
                    Фильтр: кольцо {activeVariant.widthMm} мм
                  </span>
                )}
              </div>

              <div className="vs-doc-table-wrap">
                <table className="vs-doc-table">
                  <thead>
                    <tr>
                      <th>Ширина</th>
                      <th>Направление</th>
                      <th>Мощность</th>
                      <th>Световой поток (CCT)</th>
                      <th>Вес</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lightConfigs.map(cfg => (
                      <tr key={`${cfg.ringWidthMm}-${cfg.direction}`}>
                        <td className="mono">{cfg.ringWidthMm} мм</td>
                        <td>{formatLightDirection(cfg.direction)}</td>
                        <td className="mono">{cfg.powerW} Вт</td>
                        <td className="mono vs-doc-cell-wrap">
                          <span className="vs-cct-list">
                            {cfg.outputs.map(o => (
                              <span key={o.cctK} className="vs-cct-item">
                                {o.cctK}K: {o.lumens} Лм
                              </span>
                            ))}
                          </span>
                        </td>
                        <td className="mono">{cfg.netWeightKg} кг</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="vs-detail-footnote">
                В техпаспорте направление света, мощность и поток приведены по ширине кольца без привязки к SKU — укажите нужное направление в Quick RFQ.
              </p>
            </div>
          )}

          {/* Honest Unconfirmed / Factory Confirmation Checklist */}
          <div className="vs-detail-panel vs-detail-checklist-panel">
            <div className="vs-detail-panel-head">
              <h3 className="vs-detail-h3">
                <AlertIcon size={15} />
                <span>Требует подтверждения в Quick RFQ</span>
              </h3>
            </div>
            <ul className="vs-detail-checklist">
              {checklist.map(point => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
