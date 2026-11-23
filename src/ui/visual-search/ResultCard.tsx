'use client';

import type { SearchResult } from '@/visual-search/catalogue';
import {
  BookmarkIcon,
  ChatIcon,
  CheckIcon,
  ColumnsIcon,
  ExternalLinkIcon,
  FilePdfIcon,
  LayersIcon,
  SearchIcon,
} from '../icons';
import { categoryMeta, extractDisplayHost, productKindLabel } from './helpers';
import { LuminaireVisualPlate } from './LuminaireVisualPlate';

type ResultCardProps = {
  result: SearchResult;
  selectedSku: string;
  isCompared: boolean;
  isSaved: boolean;
  creatingRfq: boolean;
  featured?: boolean;
  onSelectSku: (sku: string) => void;
  onToggleCompare: (result: SearchResult) => void;
  onFindSimilar: (result: SearchResult) => void;
  onToggleSave: (result: SearchResult) => void;
  onReviewChatGpt: (result: SearchResult) => void;
  onCreateRfq: (result: SearchResult) => void;
};

export function ResultCard({
  result,
  selectedSku,
  isCompared,
  isSaved,
  creatingRfq,
  featured = false,
  onSelectSku,
  onToggleCompare,
  onFindSimilar,
  onToggleSave,
  onReviewChatGpt,
  onCreateRfq,
}: ResultCardProps) {
  const meta = categoryMeta(result.category);
  const kind = productKindLabel(result.kind);
  const host = extractDisplayHost(result.source);
  const variants = result.variants ?? [];
  const activeVariant = variants.find(item => item.sku === selectedSku);

  return (
    <article
      className={`vs-card ${result.category === 'verified_original' ? 'vs-card--original' : ''} ${featured ? 'vs-card--featured' : ''} ${isCompared ? 'vs-card--compared' : ''}`}
      data-result-id={result.id}
    >
      <LuminaireVisualPlate result={result} selectedSku={selectedSku} />

      <div className="vs-card-body">
        <div className="vs-card-head">
          <div className="vs-card-eyebrow">
            <span>{result.brand ?? host}</span>
            {kind && (
              <>
                <span aria-hidden="true">·</span>
                <span>{kind}</span>
              </>
            )}
          </div>
          <h3 className="vs-card-title">{result.name}</h3>
          <p className="vs-card-honest">
            {result.category === 'verified_original'
              ? 'Запись производителя · Original not verified до сверки с вашим фото'
              : meta.explanation}
          </p>
        </div>

        {result.details && <p className="vs-card-details">{result.details}</p>}

        {/* Verified SKU & Dimensions */}
        {variants.length > 0 && (
          <div className="vs-variant-box">
            <div className="vs-variant-head">
              <span className="vs-variant-label">Артикул и габариты (техпаспорт)</span>
              {activeVariant && (
                <span className="lf-badge lf-badge--documentation mono">
                  {activeVariant.widthMm} × {activeVariant.depthMm} × {activeVariant.heightMm} мм
                </span>
              )}
            </div>
            <div className="vs-variant-pills" role="group" aria-label={`Варианты ${result.name}`}>
              {variants.map(item => {
                const active = item.sku === selectedSku;
                return (
                  <button
                    key={item.sku}
                    type="button"
                    className={`vs-sku-pill mono ${active ? 'vs-sku-pill--active' : ''}`}
                    aria-pressed={active}
                    onClick={() => onSelectSku(active ? '' : item.sku)}
                    title={`${item.sku}: ${item.widthMm} × ${item.depthMm} × ${item.heightMm} мм`}
                  >
                    <span>{item.sku}</span>
                    <small>
                      {item.widthMm}×{item.heightMm}
                    </small>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Confirmed specs & links strip */}
        <div className="vs-specs-strip">
          {result.confirmedDimming && (
            <span className="lf-badge lf-badge--documentation">
              Диммирование: {result.confirmedDimming}
            </span>
          )}
          <a
            href={result.source}
            target="_blank"
            rel="noreferrer"
            className="vs-link-chip"
            title={result.source}
          >
            <span>{host}</span>
            <ExternalLinkIcon size={12} />
          </a>
          {result.documentUrl && (
            <a
              href={result.documentUrl}
              target="_blank"
              rel="noreferrer"
              className="vs-link-chip vs-link-chip--pdf"
            >
              <FilePdfIcon size={12} />
              <span>Техпаспорт PDF</span>
            </a>
          )}
        </div>

        {/* All 6 Required Actions */}
        <div className="vs-card-actions">
          <div className="vs-card-actions-grid">
            <a
              href={result.source}
              target="_blank"
              rel="noreferrer"
              className="lf-btn lf-btn--sm"
            >
              <ExternalLinkIcon size={13} />
              <span>Открыть</span>
            </a>

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
              className="lf-btn lf-btn--sm vs-action-span"
              onClick={() => onReviewChatGpt(result)}
            >
              <ChatIcon size={13} />
              <span>Проверить через ChatGPT</span>
            </button>
          </div>

          <button
            type="button"
            className="lf-btn lf-btn--primary vs-rfq-btn"
            disabled={creatingRfq}
            onClick={() => onCreateRfq(result)}
          >
            <LayersIcon size={15} />
            <span>{creatingRfq ? 'Открываем Quick RFQ…' : 'Создать запрос фабрике'}</span>
          </button>
        </div>
      </div>
    </article>
  );
}
