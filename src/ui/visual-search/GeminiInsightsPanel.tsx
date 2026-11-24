'use client';

import {
  AlertIcon,
  ChatIcon,
  LensIcon,
  SearchIcon,
  SparkIcon,
} from '../icons';
import { buildGeminiInsights } from './helpers';

type GeminiInsightsPanelProps = {
  traits: string[];
  query: string;
  photoName?: string;
  warningText?: string | null;
  localIndexAvailable?: boolean;
  onRunSuggestedQuery: (suggested: string) => void;
  onFocusQueryInput: () => void;
  onOpenLens: () => void;
  onOpenChatGpt: () => void;
};

export function GeminiInsightsPanel({
  traits,
  query,
  photoName,
  warningText,
  localIndexAvailable = false,
  onRunSuggestedQuery,
  onFocusQueryInput,
  onOpenLens,
  onOpenChatGpt,
}: GeminiInsightsPanelProps) {
  const insights = buildGeminiInsights(traits, query);
  const hasTraits = traits.length > 0;

  if (!hasTraits && !warningText) return null;

  return (
    <div className="vs-gemini-stack">
      {warningText && (
        <div
          id="vs-gemini-warning"
          className="vs-warning-banner vs-warning-banner--rich"
          role="status"
        >
          <div className="vs-warning-copy">
            <AlertIcon size={16} />
            <div>
              <strong>{warningText}</strong>
              <p>
                Продолжайте без ограничений: поиск по названию
                {localIndexAvailable ? ', локальный фотокаталог' : ''} и ручной Google Lens работают автономно.
              </p>
            </div>
          </div>
          <div className="vs-warning-actions">
            <button type="button" className="lf-btn lf-btn--sm" onClick={onFocusQueryInput}>
              <SearchIcon size={13} />
              <span>Поиск по названию</span>
            </button>
            <button type="button" className="lf-btn lf-btn--sm" onClick={onOpenLens}>
              <LensIcon size={13} />
              <span>Google Lens</span>
            </button>
            <button
              type="button"
              className="lf-btn lf-btn--sm lf-btn--subtle"
              onClick={onOpenChatGpt}
            >
              <ChatIcon size={13} />
              <span>ChatGPT</span>
            </button>
          </div>
        </div>
      )}

      {hasTraits && (
        <section
          id="vs-gemini-insights"
          className="vs-gemini-card"
          aria-labelledby="vs-gemini-heading"
        >
          <div className="vs-gemini-head">
            <div>
              <span className="vs-section-eyebrow">
                Gemini Free Tier · визуальные признаки (оценка)
              </span>
              <h2 id="vs-gemini-heading" className="vs-gemini-title">
                <SparkIcon size={16} />
                <span>Анализ выбранного кадра и поисковые запросы</span>
              </h2>
              <p className="vs-gemini-sub">
                {photoName
                  ? `Обработана оптимизированная копия «${photoName}» (оригинал сохранён без изменений). Признаки описывают только видимую форму и детали — производитель не подтверждается.`
                  : 'Признаки описывают только видимую форму и детали — производитель не подтверждается.'}
              </p>
            </div>
            <span className="vs-pill vs-pill--est">Original not verified</span>
          </div>

          <div className="vs-gemini-buckets">
            {insights.shape.length > 0 && (
              <div className="vs-gemini-bucket">
                <span className="vs-gemini-bucket-label">Форма и силуэт</span>
                <div className="vs-traits-list">
                  {insights.shape.map(trait => (
                    <span key={trait} className="lf-badge lf-badge--accent">
                      {trait}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {insights.suspension.length > 0 && (
              <div className="vs-gemini-bucket">
                <span className="vs-gemini-bucket-label">Подвес и опора</span>
                <div className="vs-traits-list">
                  {insights.suspension.map(trait => (
                    <span key={trait} className="lf-badge lf-badge--accent">
                      {trait}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {insights.details.length > 0 && (
              <div className="vs-gemini-bucket">
                <span className="vs-gemini-bucket-label">Видимые детали</span>
                <div className="vs-traits-list">
                  {insights.details.map(trait => (
                    <span key={trait} className="lf-badge lf-badge--user">
                      {trait}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {insights.suggestedQueries.length > 0 && (
            <div className="vs-gemini-queries">
              <span className="vs-gemini-bucket-label">
                Предложенные поисковые запросы (нажмите для поиска без повторного вызова Gemini)
              </span>
              <div className="vs-gemini-query-list">
                {insights.suggestedQueries.map(item => {
                  const isActive =
                    query.trim().toLocaleLowerCase() === item.query.toLocaleLowerCase();
                  return (
                    <button
                      key={item.query}
                      type="button"
                      className={`vs-suggested-query-btn ${
                        isActive ? 'vs-suggested-query-btn--active' : ''
                      }`}
                      aria-pressed={isActive}
                      onClick={() => onRunSuggestedQuery(item.query)}
                      title={`Искать: ${item.query}`}
                    >
                      <span className="vs-suggested-query-meta">
                        <SearchIcon size={12} />
                        <span className="vs-suggested-query-label">{item.label}:</span>
                      </span>
                      <strong>{item.query}</strong>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
