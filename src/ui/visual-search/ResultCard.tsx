'use client';

import type { SearchResult } from '@/visual-search/catalogue';
import {
  BookmarkIcon,
  ChatIcon,
  CheckIcon,
  ColumnsIcon,
  ExternalLinkIcon,
  EyeIcon,
  FilePdfIcon,
  LayersIcon,
  SearchIcon,
} from '../icons';
import {
  categoryMeta,
  evidenceBadgeTone,
  extractDisplayHost,
  filterLightingConfigurations,
  formatLightDirection,
  localMatchMeta,
  productKindLabel,
  type CandidateEvidence,
  type LocalSearchMatch,
} from './helpers';
import { LuminaireVisualPlate } from './LuminaireVisualPlate';

type ResultCardProps = {
  result: SearchResult;
  selectedSku: string;
  isCompared: boolean;
  isSaved: boolean;
  creatingRfq: boolean;
  featured?: boolean;
  localMatch?: LocalSearchMatch;
  evidences?: CandidateEvidence[];
  onSelectSku: (sku: string) => void;
  onOpenDetail?: (result: SearchResult) => void;
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
  localMatch,
  evidences = [],
  onSelectSku,
  onOpenDetail,
  onToggleCompare,
  onFindSimilar,
  onToggleSave,
  onReviewChatGpt,
  onCreateRfq,
}: ResultCardProps) {
  const meta = categoryMeta(result.category);
  const localMeta = localMatch ? localMatchMeta(localMatch.match) : null;
  const kind = productKindLabel(result.kind);
  const host = extractDisplayHost(result.source);
  const variants = result.variants ?? [];
  const activeVariant = variants.find(item => item.sku === selectedSku);
  const specs = result.specifications;
  const matchingLighting = filterLightingConfigurations(specs, activeVariant?.widthMm);

  return (
    <article
      className={`vs-card ${result.category === 'verified_original' ? 'vs-card--original' : ''} ${featured ? 'vs-card--featured' : ''} ${isCompared ? 'vs-card--compared' : ''}`}
      data-result-id={result.id}
      data-local-match={localMatch?.match}
    >
      <LuminaireVisualPlate result={result} selectedSku={selectedSku} />

      <div className="vs-card-body">
        {localMatch && localMeta && (
          <div className={`vs-local-strip vs-local-strip--${localMatch.match}`}>
            <span className={`vs-pill vs-pill--${localMeta.tone}`}>{localMeta.label}</span>
            <span className="vs-local-strip-copy">
              {localMatch.title} · <span className="mono">{localMatch.id}</span>
            </span>
          </div>
        )}

        {evidences.length > 0 && (
          <div className="vs-evidence-strip" aria-label="Доказательства и источники совпадения">
            {evidences.map(ev => (
              <span
                key={`${ev.kind}-${ev.detail}`}
                className={`vs-pill vs-pill--${evidenceBadgeTone(ev.kind)}`}
                title={ev.detail}
              >
                {ev.label}
              </span>
            ))}
          </div>
        )}

        <div className="vs-card-head">
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
                <span>{specs.designer}</span>
              </>
            )}
          </div>
          <h3 className="vs-card-title">
            {onOpenDetail ? (
              <button
                type="button"
                className="vs-card-title-btn"
                onClick={() => onOpenDetail(result)}
              >
                {result.name}
              </button>
            ) : (
              result.name
            )}
          </h3>
          <p className="vs-card-honest">
            {localMeta
              ? localMeta.explanation
              : result.category === 'verified_original'
                ? 'Запись производителя · Original not verified до сверки с вашим фото'
                : meta.explanation}
          </p>
        </div>

        {result.details && <p className="vs-card-details">{result.details}</p>}

        {/* Verified SKU & Dimensions */}
        {variants.length > 0 && (
          <div className="vs-variant-box">
            <div className="vs-variant-head">
              <span className="vs-variant-label">
                Артикул и габариты{specs?.dimensionsReferTo ? ` · ${specs.dimensionsReferTo}` : ' (техпаспорт)'}
              </span>
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
            {specs?.standardMaxBandLengthMm && (
              <span className="vs-variant-note">
                Макс. стандартная длина декоративного ремня: {specs.standardMaxBandLengthMm} мм
              </span>
            )}
          </div>
        )}

        {/* Documented specifications from manufacturer sheet (PR #11 contract) */}
        {specs && (
          <dl className="vs-card-spec-grid">
            {specs.materials && specs.materials.length > 0 && (
              <div className="vs-card-spec-row">
                <dt>Материалы</dt>
                <dd>{specs.materials.map(item => `${item.part}: ${item.material}`).join(' · ')}</dd>
              </div>
            )}
            {specs.finishes && specs.finishes.length > 0 && (
              <div className="vs-card-spec-row">
                <dt>Отделки</dt>
                <dd className="vs-finish-tags">
                  {specs.finishes.map(item => (
                    <span key={`${item.part}-${item.code}`} className="vs-finish-tag">
                      <strong className="mono">{item.code}</strong> {item.name}
                    </span>
                  ))}
                </dd>
              </div>
            )}
            {specs.lighting && matchingLighting.length > 0 && (
              <div className="vs-card-spec-row">
                <dt>
                  Свет ({specs.lighting.sourceType} {specs.lighting.sourceVoltageV} В)
                </dt>
                <dd className="vs-light-lines">
                  {matchingLighting.map(cfg => {
                    const lmMin = Math.min(...cfg.outputs.map(o => o.lumens));
                    const lmMax = Math.max(...cfg.outputs.map(o => o.lumens));
                    return (
                      <span key={`${cfg.ringWidthMm}-${cfg.direction}`} className="mono">
                        {cfg.ringWidthMm} мм {formatLightDirection(cfg.direction)}: {cfg.powerW} Вт ·{' '}
                        {lmMin}–{lmMax} Лм · {cfg.netWeightKg} кг
                      </span>
                    );
                  })}
                  <small className="vs-light-note">
                    Направление и мощность не привязаны к конкретному артикулу — уточнить при заказе
                  </small>
                </dd>
              </div>
            )}
          </dl>
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

        {/* Actions */}
        <div className="vs-card-actions">
          <div className="vs-card-actions-grid">
            {onOpenDetail && (
              <button
                type="button"
                className="lf-btn lf-btn--sm"
                onClick={() => onOpenDetail(result)}
              >
                <EyeIcon size={13} />
                <span>Подробнее</span>
              </button>
            )}

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
              className={`lf-btn lf-btn--sm ${onOpenDetail ? '' : 'vs-action-span'}`}
              onClick={() => onReviewChatGpt(result)}
            >
              <ChatIcon size={13} />
              <span>ChatGPT</span>
            </button>
          </div>

          <button
            type="button"
            className="lf-btn lf-btn--primary vs-rfq-btn"
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
        </div>
      </div>
    </article>
  );
}
