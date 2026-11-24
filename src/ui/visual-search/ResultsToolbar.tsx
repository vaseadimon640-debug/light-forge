'use client';

import type { ProductType } from '@/domain/project';
import { FilterIcon, GridIcon, RefreshIcon, TableIcon } from '../icons';
import {
  isDefaultResultFilters,
  productKindLabel,
  UNBRANDED_FILTER_VALUE,
  type ResultCategoryFilter,
  type ResultFilterState,
  type ResultSortKey,
  type ResultViewMode,
} from './helpers';

type ResultsToolbarProps = {
  totalCount: number;
  filteredCount: number;
  filters: ResultFilterState;
  viewMode: ResultViewMode;
  availableKinds: ProductType[];
  availableBrands: string[];
  hasUnbranded: boolean;
  savedCount: number;
  onFiltersChange: (next: ResultFilterState) => void;
  onResetFilters: () => void;
  onViewModeChange: (mode: ResultViewMode) => void;
};

export function ResultsToolbar({
  totalCount,
  filteredCount,
  filters,
  viewMode,
  availableKinds,
  availableBrands,
  hasUnbranded,
  savedCount,
  onFiltersChange,
  onResetFilters,
  onViewModeChange,
}: ResultsToolbarProps) {
  const defaultFilters = isDefaultResultFilters(filters);

  return (
    <section
      id="vs-results-toolbar"
      className="vs-filter-bar"
      aria-label="Фильтры и вид результатов"
    >
      <div className="vs-filter-head">
        <div className="vs-filter-title">
          <FilterIcon size={14} />
          <span>Фильтры и отображение</span>
          <span className="vs-count-pill mono" data-testid="vs-filtered-count">
            {filteredCount === totalCount ? totalCount : `${filteredCount} из ${totalCount}`}
          </span>
        </div>

        <div className="vs-filter-head-right">
          {!defaultFilters && (
            <button
              id="vs-filters-reset"
              type="button"
              className="lf-btn lf-btn--sm lf-btn--subtle"
              onClick={onResetFilters}
            >
              <RefreshIcon size={13} />
              <span>Сбросить фильтры</span>
            </button>
          )}

          <div className="lf-segment vs-view-switch" role="group" aria-label="Вид результатов">
            <button
              id="vs-view-grid"
              type="button"
              className={`lf-segment-btn ${viewMode === 'grid' ? 'lf-segment-btn--active' : ''}`}
              aria-pressed={viewMode === 'grid'}
              onClick={() => onViewModeChange('grid')}
            >
              <GridIcon size={13} />
              <span>Сетка</span>
            </button>
            <button
              id="vs-view-table"
              type="button"
              className={`lf-segment-btn ${viewMode === 'table' ? 'lf-segment-btn--active' : ''}`}
              aria-pressed={viewMode === 'table'}
              onClick={() => onViewModeChange('table')}
            >
              <TableIcon size={13} />
              <span>Таблица</span>
            </button>
          </div>
        </div>
      </div>

      <div className="vs-filter-controls">
        <label className="vs-filter-field">
          <span>Статус записи</span>
          <select
            id="vs-filter-category"
            className="lf-input lf-select"
            value={filters.category}
            onChange={event =>
              onFiltersChange({
                ...filters,
                category: event.target.value as ResultCategoryFilter,
              })
            }
          >
            <option value="all">Все категории</option>
            <option value="verified_original">Каталог производителя</option>
            <option value="similar">Похожие модели и аналоги</option>
            <option value="exact_match">Точные совпадения</option>
            <option value="unverified">Ссылки на проверку</option>
          </select>
        </label>

        <label className="vs-filter-field">
          <span>Тип светильника</span>
          <select
            id="vs-filter-kind"
            className="lf-input lf-select"
            value={filters.kind}
            onChange={event => onFiltersChange({ ...filters, kind: event.target.value })}
          >
            <option value="">Все типы</option>
            {availableKinds.map(kind => (
              <option key={kind} value={kind}>
                {productKindLabel(kind) ?? kind}
              </option>
            ))}
          </select>
        </label>

        <label className="vs-filter-field">
          <span>Производитель</span>
          <select
            id="vs-filter-brand"
            className="lf-input lf-select"
            value={filters.brand}
            onChange={event => onFiltersChange({ ...filters, brand: event.target.value })}
          >
            <option value="">Все производители</option>
            {availableBrands.map(brand => (
              <option key={brand} value={brand}>
                {brand}
              </option>
            ))}
            {hasUnbranded && (
              <option value={UNBRANDED_FILTER_VALUE}>Без бренда (внешняя ссылка)</option>
            )}
          </select>
        </label>

        <label className="vs-filter-field">
          <span>Сортировка</span>
          <select
            id="vs-filter-sort"
            className="lf-input lf-select"
            value={filters.sort}
            onChange={event =>
              onFiltersChange({
                ...filters,
                sort: event.target.value as ResultSortKey,
              })
            }
          >
            <option value="relevance">По релевантности</option>
            <option value="docs_first">Сначала с техпаспортом</option>
            <option value="name">По названию (А–Я)</option>
            <option value="width_asc">Ширина: по возрастанию</option>
            <option value="width_desc">Ширина: по убыванию</option>
          </select>
        </label>

        <div className="vs-filter-checks">
          <label className="vs-filter-check">
            <input
              id="vs-filter-pdf-only"
              type="checkbox"
              checked={filters.onlyWithPdf}
              onChange={event =>
                onFiltersChange({ ...filters, onlyWithPdf: event.target.checked })
              }
            />
            <span>Только с PDF</span>
          </label>

          {savedCount > 0 && (
            <label className="vs-filter-check">
              <input
                id="vs-filter-saved-only"
                type="checkbox"
                checked={filters.onlySaved}
                onChange={event =>
                  onFiltersChange({ ...filters, onlySaved: event.target.checked })
                }
              />
              <span>Сохранённые</span>
            </label>
          )}
        </div>
      </div>
    </section>
  );
}
