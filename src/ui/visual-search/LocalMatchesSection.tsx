'use client';

import type { SearchResult } from '@/visual-search/catalogue';
import { ChatIcon, LensIcon, SearchIcon } from '../icons';
import {
  localMatchMeta,
  resolveLocalMatchResult,
  type LocalSearchMatch,
} from './helpers';
import { ResultCard } from './ResultCard';

type LocalMatchesSectionProps = {
  matches: LocalSearchMatch[];
  usedCrop: boolean;
  selectedVariants: Record<string, string>;
  compareIds: string[];
  creatingRfqId: string | null;
  isResultSaved: (result: SearchResult) => boolean;
  onSelectSku: (resultId: string, sku: string) => void;
  onToggleCompare: (result: SearchResult) => void;
  onFindSimilar: (result: SearchResult) => void;
  onSearchByTitle: (title: string) => void;
  onToggleSave: (result: SearchResult) => void;
  onReviewChatGpt: (result?: SearchResult) => void;
  onCreateRfq: (result: SearchResult) => void;
  onOpenLens: () => void;
};

export function LocalMatchesSection({
  matches,
  usedCrop,
  selectedVariants,
  compareIds,
  creatingRfqId,
  isResultSaved,
  onSelectSku,
  onToggleCompare,
  onFindSimilar,
  onSearchByTitle,
  onToggleSave,
  onReviewChatGpt,
  onCreateRfq,
  onOpenLens,
}: LocalMatchesSectionProps) {
  return (
    <section
      id="vs-local-matches"
      className="vs-section"
      aria-labelledby="vs-sec-local"
    >
      <div className="vs-section-head">
        <div>
          <span className="vs-section-eyebrow">
            Локальный фотопоиск · без внешних API
          </span>
          <h2 id="vs-sec-local" className="vs-section-title">
            Совпадения по локальному фотокаталогу
            <span className="vs-count-pill">{matches.length}</span>
          </h2>
          <p className="vs-section-desc">
            {usedCrop
              ? 'Поиск выполнен по выделенному фрагменту фото. Различаются «Тот же файл» и «Похожий кадр»; производитель требует проверки.'
              : 'Поиск выполнен локально по загруженному фото. Различаются «Тот же файл» и «Похожий кадр»; производитель требует проверки.'}
          </p>
        </div>
      </div>

      {matches.length > 0 ? (
        <div
          className={`vs-cards-grid ${matches.length === 1 ? 'vs-cards-grid--single' : ''}`}
        >
          {matches.map(match => {
            const linked = resolveLocalMatchResult(match);
            if (linked) {
              return (
                <ResultCard
                  key={match.id}
                  result={linked}
                  localMatch={match}
                  selectedSku={selectedVariants[linked.id] ?? ''}
                  isCompared={compareIds.includes(linked.id)}
                  isSaved={isResultSaved(linked)}
                  creatingRfq={creatingRfqId === linked.id}
                  featured={matches.length === 1}
                  onSelectSku={sku => onSelectSku(linked.id, sku)}
                  onToggleCompare={onToggleCompare}
                  onFindSimilar={onFindSimilar}
                  onToggleSave={onToggleSave}
                  onReviewChatGpt={target => onReviewChatGpt(target)}
                  onCreateRfq={onCreateRfq}
                />
              );
            }

            const meta = localMatchMeta(match.match);
            return (
              <article
                key={match.id}
                className="vs-card vs-local-plain-card"
                data-local-id={match.id}
                data-local-match={match.match}
              >
                <div className="vs-card-body">
                  <div className={`vs-local-strip vs-local-strip--${match.match}`}>
                    <span className={`vs-pill vs-pill--${meta.tone}`}>{meta.label}</span>
                    <span className="vs-local-strip-copy mono">{match.id}</span>
                  </div>

                  <div className="vs-card-head">
                    <span className="vs-card-eyebrow">Локальный фотокаталог</span>
                    <h3 className="vs-card-title">{match.title}</h3>
                    <p className="vs-card-honest">{meta.explanation}</p>
                  </div>

                  <p className="vs-card-details">
                    Ссылка на карточку производителя в индексе не указана. Можно найти модель по названию в каталоге или проверить через ChatGPT / Google Lens.
                  </p>

                  <div className="vs-card-actions">
                    <div className="vs-card-actions-grid">
                      <button
                        type="button"
                        className="lf-btn lf-btn--sm lf-btn--primary"
                        onClick={() => onSearchByTitle(match.title)}
                      >
                        <SearchIcon size={13} />
                        <span>Искать по названию</span>
                      </button>
                      <button
                        type="button"
                        className="lf-btn lf-btn--sm"
                        onClick={() => onReviewChatGpt(undefined)}
                      >
                        <ChatIcon size={13} />
                        <span>Проверить через ChatGPT</span>
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="vs-section-quiet">
          <span>
            В локальном фотокаталоге совпадений по кадру не найдено. Вы можете изменить область выделения, уточнить название или открыть Google Lens.
          </span>
          <button type="button" className="lf-btn lf-btn--sm" onClick={onOpenLens}>
            <LensIcon size={13} />
            <span>Открыть Google Lens</span>
          </button>
        </div>
      )}
    </section>
  );
}
