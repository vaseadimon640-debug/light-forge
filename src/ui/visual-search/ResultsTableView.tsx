'use client';

import type { SearchResult } from '@/visual-search/catalogue';
import {
  BookmarkIcon,
  CheckIcon,
  ColumnsIcon,
  ExternalLinkIcon,
  EyeIcon,
  FilePdfIcon,
  LayersIcon,
} from '../icons';
import {
  categoryMeta,
  extractComparisonSpec,
  extractDisplayHost,
  productKindLabel,
} from './helpers';

type ResultsTableViewProps = {
  results: SearchResult[];
  selectedVariants: Record<string, string>;
  compareIds: string[];
  creatingRfqId: string | null;
  isResultSaved: (result: SearchResult) => boolean;
  onSelectSku: (resultId: string, sku: string) => void;
  onOpenDetail: (result: SearchResult) => void;
  onToggleCompare: (result: SearchResult) => void;
  onToggleSave: (result: SearchResult) => void;
  onCreateRfq: (result: SearchResult) => void;
};

export function ResultsTableView({
  results,
  selectedVariants,
  compareIds,
  creatingRfqId,
  isResultSaved,
  onSelectSku,
  onOpenDetail,
  onToggleCompare,
  onToggleSave,
  onCreateRfq,
}: ResultsTableViewProps) {
  return (
    <section
      id="vs-results-table-section"
      className="vs-section"
      aria-labelledby="vs-table-heading"
    >
      <div className="vs-section-head">
        <div>
          <span className="vs-section-eyebrow">Табличное представление</span>
          <h2 id="vs-table-heading" className="vs-section-title">
            Сводная таблица найденных моделей
            <span className="vs-count-pill">{results.length}</span>
          </h2>
          <p className="vs-section-desc">
            Подтверждённые данные из официальных карточек и техпаспортов. Статус совпадения с фото: Original not verified.
          </p>
        </div>
      </div>

      <div className="vs-table-card">
        <div className="vs-table-wrap">
          <table className="vs-results-table">
            <thead>
              <tr>
                <th scope="col">Модель и источник</th>
                <th scope="col">Тип</th>
                <th scope="col">Артикул и габариты (мм)</th>
                <th scope="col">Материалы / Отделка</th>
                <th scope="col">Свет и техпаспорт</th>
                <th scope="col" className="vs-table-actions-col">
                  Действия
                </th>
              </tr>
            </thead>
            <tbody>
              {results.map(result => {
                const meta = categoryMeta(result.category);
                const selectedSku = selectedVariants[result.id] ?? '';
                const spec = extractComparisonSpec(result, selectedSku);
                const isCompared = compareIds.includes(result.id);
                const isSaved = isResultSaved(result);
                const host = extractDisplayHost(result.source);
                const kind = productKindLabel(result.kind);
                const variants = result.variants ?? [];

                return (
                  <tr key={result.id} data-result-row={result.id}>
                    <td className="vs-table-model-cell">
                      <div className="vs-table-model-top">
                        <span className={`vs-pill vs-pill--${meta.tone}`}>{meta.shortLabel}</span>
                        <span className="vs-table-brand">{result.brand ?? host}</span>
                      </div>
                      <button
                        type="button"
                        className="vs-table-title-btn"
                        onClick={() => onOpenDetail(result)}
                      >
                        {result.name}
                      </button>
                      <span className="vs-table-sub">
                        Original not verified ·{' '}
                        <a href={result.source} target="_blank" rel="noreferrer">
                          {host}
                        </a>
                      </span>
                    </td>

                    <td className="vs-table-kind-cell">
                      <span>{kind ?? 'Не указан'}</span>
                      {result.specifications?.designer && (
                        <small>{result.specifications.designer}</small>
                      )}
                    </td>

                    <td className="vs-table-dim-cell">
                      {variants.length > 0 ? (
                        <div className="vs-table-sku-stack">
                          <select
                            aria-label={`Артикул ${result.name}`}
                            className="lf-input lf-select vs-table-sku-select mono"
                            value={selectedSku}
                            onChange={event => onSelectSku(result.id, event.target.value)}
                          >
                            <option value="">Выберите SKU ({variants.length})</option>
                            {variants.map(v => (
                              <option key={v.sku} value={v.sku}>
                                {v.sku} · {v.widthMm}×{v.depthMm}×{v.heightMm} мм
                              </option>
                            ))}
                          </select>
                          <span className="mono vs-table-dim-val">{spec.dimensions.value}</span>
                        </div>
                      ) : (
                        <span className="vs-val-pending">{spec.dimensions.value}</span>
                      )}
                    </td>

                    <td className="vs-table-mat-cell">
                      <div className="vs-table-spec-pair">
                        <span className={spec.materials.confirmed ? 'vs-val-confirmed' : 'vs-val-pending'}>
                          {spec.materials.value}
                        </span>
                        <small className={spec.finish.confirmed ? '' : 'vs-val-pending'}>
                          Отделка: {spec.finish.value}
                        </small>
                      </div>
                    </td>

                    <td className="vs-table-light-cell">
                      <div className="vs-table-spec-pair">
                        <span className={spec.lighting.confirmed ? 'vs-val-confirmed' : 'vs-val-pending'}>
                          {result.confirmedDimming ? `Диммирование ${result.confirmedDimming}` : spec.lighting.value}
                        </span>
                        <div className="vs-table-links">
                          {result.documentUrl ? (
                            <a
                              href={result.documentUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="vs-link-chip vs-link-chip--pdf"
                            >
                              <FilePdfIcon size={12} />
                              <span>PDF</span>
                            </a>
                          ) : (
                            <span className="vs-val-pending">PDF не приложен</span>
                          )}
                          <a
                            href={result.source}
                            target="_blank"
                            rel="noreferrer"
                            className="vs-link-chip"
                          >
                            <span>Сайт</span>
                            <ExternalLinkIcon size={11} />
                          </a>
                        </div>
                      </div>
                    </td>

                    <td className="vs-table-actions-cell">
                      <div className="vs-table-action-stack">
                        <button
                          type="button"
                          className="lf-btn lf-btn--sm"
                          onClick={() => onOpenDetail(result)}
                        >
                          <EyeIcon size={13} />
                          <span>Подробнее</span>
                        </button>
                        <div className="vs-table-action-row">
                          <button
                            type="button"
                            className={`lf-btn lf-btn--sm ${isCompared ? 'lf-btn--brass' : ''}`}
                            aria-pressed={isCompared}
                            title={isCompared ? 'Убрать из сравнения' : 'Добавить к сравнению'}
                            onClick={() => onToggleCompare(result)}
                          >
                            {isCompared ? <CheckIcon size={13} /> : <ColumnsIcon size={13} />}
                            <span>{isCompared ? 'В сравн.' : 'Сравнить'}</span>
                          </button>
                          <button
                            type="button"
                            className={`lf-btn lf-btn--sm lf-btn--icon ${isSaved ? 'lf-btn--brass' : ''}`}
                            aria-pressed={isSaved}
                            aria-label={isSaved ? `Убрать ${result.name} из сохранённых` : `Сохранить ${result.name}`}
                            title={isSaved ? 'Сохранено' : 'Сохранить'}
                            onClick={() => onToggleSave(result)}
                          >
                            <BookmarkIcon size={13} filled={isSaved} />
                          </button>
                        </div>
                        <button
                          type="button"
                          className="lf-btn lf-btn--sm lf-btn--primary"
                          disabled={creatingRfqId === result.id}
                          onClick={() => onCreateRfq(result)}
                        >
                          <LayersIcon size={13} />
                          <span>
                            {creatingRfqId === result.id
                              ? 'Открываем…'
                              : selectedSku
                                ? `RFQ (${selectedSku})`
                                : 'Запрос фабрике'}
                          </span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
