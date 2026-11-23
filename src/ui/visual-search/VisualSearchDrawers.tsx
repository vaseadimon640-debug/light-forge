'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { ReviewLink, SearchResult, SearchUsage } from '@/visual-search/catalogue';
import {
  BookmarkIcon,
  ChatIcon,
  CheckIcon,
  CloseIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  LensIcon,
  SlidersIcon,
  TrashIcon,
} from '../icons';
import {
  buildReviewPrompt,
  extractDisplayHost,
  parseChatGptJsonInput,
  parseLensUrlsInput,
} from './helpers';

function DrawerShell({
  open,
  title,
  subtitle,
  icon,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  icon: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="vs-drawer-backdrop"
      role="presentation"
      onClick={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside className="vs-drawer" role="dialog" aria-modal="true" aria-label={title}>
        <div className="vs-drawer-head">
          <div className="vs-drawer-title-wrap">
            <span className="vs-drawer-icon" aria-hidden="true">
              {icon}
            </span>
            <div>
              <h2 className="vs-drawer-title">{title}</h2>
              {subtitle && <p className="vs-drawer-sub">{subtitle}</p>}
            </div>
          </div>
          <button
            type="button"
            className="lf-btn lf-btn--icon lf-btn--subtle"
            aria-label="Закрыть панель"
            onClick={onClose}
          >
            <CloseIcon size={16} />
          </button>
        </div>
        <div className="vs-drawer-body">{children}</div>
      </aside>
    </div>
  );
}

/* ==========================================================================
   Settings & Sources Drawer (hides API/provider internals from main screen)
   ========================================================================== */

type SettingsDrawerProps = {
  open: boolean;
  gemini?: SearchUsage;
  allowGemini: boolean;
  saved: ReviewLink[];
  history: string[];
  onClose: () => void;
  onToggleAllowGemini: (allowed: boolean) => void;
  onImportSaved: () => void;
  onRemoveSaved: (url: string) => void;
  onPickHistory: (term: string) => void;
  onClearHistory: () => void;
};

export function SettingsDrawer({
  open,
  gemini,
  allowGemini,
  saved,
  history,
  onClose,
  onToggleAllowGemini,
  onImportSaved,
  onRemoveSaved,
  onPickHistory,
  onClearHistory,
}: SettingsDrawerProps) {
  return (
    <DrawerShell
      open={open}
      title="Настройки и источники"
      subtitle="Источники поиска, лимиты, сохранённые ссылки и история"
      icon={<SlidersIcon size={17} />}
      onClose={onClose}
    >
      <section className="vs-drawer-section">
        <h3 className="vs-drawer-h3">Источники и статус API</h3>
        <div className="vs-source-list">
          <div className="vs-source-row">
            <div>
              <strong>Каталог производителей и ручные ссылки</strong>
              <p>Стартовый каталог LIGHT FORGE, проверка URL и импорт ссылок.</p>
            </div>
            <span className="lf-badge lf-badge--documentation">Активен</span>
          </div>

          <div className="vs-source-row">
            <div>
              <strong>Gemini Free Tier</strong>
              <p>
                {gemini?.enabled
                  ? `Запросов сегодня: ${gemini.requestsToday} из ${gemini.appDailyLimit} (лимит приложения). Квоту аккаунта смотрите в AI Studio.`
                  : 'Выключен на сервере. Поиск работает автономно без внешнего AI.'}
              </p>
            </div>
            <span className={`lf-badge ${gemini?.enabled ? 'lf-badge--accent' : 'lf-badge--unknown'}`}>
              {gemini?.enabled ? 'Включён' : 'Выключен'}
            </span>
          </div>

          {gemini?.enabled && (
            <label className="vs-consent-box">
              <input
                type="checkbox"
                checked={allowGemini}
                onChange={event => onToggleAllowGemini(event.target.checked)}
              />
              <span>
                Разрешить отправку оптимизированной копии фото в Gemini при поиске (оригинал файла остаётся на устройстве).
              </span>
            </label>
          )}

          <div className="vs-source-row">
            <div>
              <strong>Google Lens и ChatGPT</strong>
              <p>Ручной режим: вы сами решаете, какую копию фото отправить и какие ссылки импортировать.</p>
            </div>
            <span className="lf-badge lf-badge--user">Ручной режим</span>
          </div>

          <div className="vs-source-row">
            <div>
              <strong>Платный поиск и SerpApi</strong>
              <p>Автоматические платные поисковые API отключены по умолчанию.</p>
            </div>
            <span className="lf-badge lf-badge--unknown">Выключен</span>
          </div>
        </div>
      </section>

      <section className="vs-drawer-section">
        <div className="vs-drawer-section-head">
          <h3 className="vs-drawer-h3">
            <BookmarkIcon size={14} />
            <span>Сохранённые ссылки ({saved.length})</span>
          </h3>
          {saved.length > 0 && (
            <button
              type="button"
              className="lf-btn lf-btn--sm"
              onClick={() => {
                onImportSaved();
                onClose();
              }}
            >
              Показать в результатах
            </button>
          )}
        </div>
        {saved.length === 0 ? (
          <p className="vs-drawer-empty">
            Пока нет сохранённых моделей. Нажмите «Сохранить» на любой карточке результата.
          </p>
        ) : (
          <ul className="vs-saved-list">
            {saved.map(item => (
              <li key={item.url} className="vs-saved-item">
                <div className="vs-saved-info">
                  <strong>{item.title}</strong>
                  <span>{extractDisplayHost(item.url)}</span>
                </div>
                <div className="vs-saved-actions">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="lf-btn lf-btn--icon lf-btn--subtle"
                    aria-label={`Открыть ${item.title}`}
                  >
                    <ExternalLinkIcon size={13} />
                  </a>
                  <button
                    type="button"
                    className="lf-btn lf-btn--icon lf-btn--subtle"
                    aria-label={`Удалить ${item.title}`}
                    onClick={() => onRemoveSaved(item.url)}
                  >
                    <TrashIcon size={13} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="vs-drawer-section">
        <div className="vs-drawer-section-head">
          <h3 className="vs-drawer-h3">История поиска ({history.length})</h3>
          {history.length > 0 && (
            <button type="button" className="lf-btn lf-btn--sm lf-btn--subtle" onClick={onClearHistory}>
              Очистить
            </button>
          )}
        </div>
        {history.length === 0 ? (
          <p className="vs-drawer-empty">История запросов пока пуста.</p>
        ) : (
          <div className="vs-history-chips">
            {history.map(term => (
              <button
                key={term}
                type="button"
                className="lf-btn lf-btn--sm"
                onClick={() => {
                  onPickHistory(term);
                  onClose();
                }}
              >
                {term}
              </button>
            ))}
          </div>
        )}
      </section>
    </DrawerShell>
  );
}

/* ==========================================================================
   Google Lens Manual Search & Link Import Drawer
   ========================================================================== */

type LensDrawerProps = {
  open: boolean;
  hasPhoto: boolean;
  onClose: () => void;
  onDownloadLensCopy: () => void;
  onDownloadOriginal: () => void;
  onAddLinks: (links: ReviewLink[]) => void;
};

export function LensDrawer({
  open,
  hasPhoto,
  onClose,
  onDownloadLensCopy,
  onDownloadOriginal,
  onAddLinks,
}: LensDrawerProps) {
  const [rawUrls, setRawUrls] = useState('');
  const [error, setError] = useState('');

  function handleImport() {
    setError('');
    try {
      const links = parseLensUrlsInput(rawUrls);
      onAddLinks(links);
      setRawUrls('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Проверьте формат ссылок.');
    }
  }

  return (
    <DrawerShell
      open={open}
      title="Поиск через Google Lens"
      subtitle="Найдите визуальные совпадения по фото и добавьте найденные ссылки в LIGHT FORGE"
      icon={<LensIcon size={17} />}
      onClose={onClose}
    >
      <div className="vs-step-card">
        <span className="vs-step-num">1</span>
        <div className="vs-step-body">
          <strong>Подготовьте фотографию</strong>
          <p>
            {hasPhoto
              ? 'Скачайте оптимизированную копию выделенной области или исходный оригинал.'
              : 'Сначала загрузите фото светильника на главном экране или сразу перейдите в Google Lens.'}
          </p>
          <div className="vs-step-actions">
            {hasPhoto && (
              <>
                <button type="button" className="lf-btn lf-btn--sm" onClick={onDownloadLensCopy}>
                  <DownloadIcon size={13} />
                  <span>Скачать копию для Lens</span>
                </button>
                <button
                  type="button"
                  className="lf-btn lf-btn--sm lf-btn--subtle"
                  onClick={onDownloadOriginal}
                >
                  <span>Скачать оригинал</span>
                </button>
              </>
            )}
            <a
              href="https://lens.google.com/"
              target="_blank"
              rel="noreferrer"
              className="lf-btn lf-btn--sm lf-btn--primary"
            >
              <ExternalLinkIcon size={13} />
              <span>Открыть Google Lens</span>
            </a>
          </div>
        </div>
      </div>

      <div className="vs-step-card">
        <span className="vs-step-num">2</span>
        <div className="vs-step-body">
          <strong>Вставьте найденные ссылки</strong>
          <p>
            По одной ссылке HTTP/HTTPS на строку. Официальные карточки каталога будут распознаны автоматически, остальные появятся как ссылки на проверку.
          </p>
          <textarea
            id="vs-lens-links-input"
            className="lf-textarea"
            rows={4}
            aria-label="Ссылки из Lens"
            placeholder={'https://www.emmemobili.it/en/prodotti/illuminazione/myline\nhttps://example.com/product'}
            value={rawUrls}
            onChange={event => {
              setRawUrls(event.target.value);
              if (error) setError('');
            }}
          />
          {error && <p className="lf-field-error">{error}</p>}
          <div className="vs-step-actions">
            <button
              id="vs-lens-import-btn"
              type="button"
              className="lf-btn lf-btn--primary"
              disabled={!rawUrls.trim()}
              onClick={handleImport}
            >
              Добавить ссылки в результаты
            </button>
          </div>
        </div>
      </div>
    </DrawerShell>
  );
}

/* ==========================================================================
   ChatGPT Verification & JSON Import Drawer
   ========================================================================== */

type ChatGptDrawerProps = {
  open: boolean;
  query: string;
  results: SearchResult[];
  focusedResult?: SearchResult;
  onClose: () => void;
  onAddLinks: (links: ReviewLink[]) => void;
  onExportPrompt: (text: string) => void;
};

export function ChatGptDrawer({
  open,
  query,
  results,
  focusedResult,
  onClose,
  onAddLinks,
  onExportPrompt,
}: ChatGptDrawerProps) {
  const [jsonInput, setJsonInput] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const promptText = buildReviewPrompt(query, results, focusedResult);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(promptText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onExportPrompt(promptText);
    }
  }

  function handleImport() {
    setError('');
    try {
      const links = parseChatGptJsonInput(jsonInput);
      onAddLinks(links);
      setJsonInput('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Проверьте формат JSON.');
    }
  }

  return (
    <DrawerShell
      open={open}
      title="Проверить через ChatGPT"
      subtitle={
        focusedResult
          ? `Проверка модели: ${[focusedResult.brand, focusedResult.name].filter(Boolean).join(' ')}`
          : 'Сверьте фото, артикул и официальный первоисточник'
      }
      icon={<ChatIcon size={17} />}
      onClose={onClose}
    >
      <div className="vs-step-card">
        <span className="vs-step-num">1</span>
        <div className="vs-step-body">
          <strong>Скопируйте задание и прикрепите исходное фото в ChatGPT</strong>
          <p>
            Задание уже содержит проверку официального артикула, правило «Original not verified» и формат ответа JSON.
          </p>
          <pre className="vs-prompt-preview">{promptText}</pre>
          <div className="vs-step-actions">
            <button
              id="vs-chatgpt-copy-btn"
              type="button"
              className="lf-btn lf-btn--sm lf-btn--primary"
              onClick={() => void handleCopy()}
            >
              {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
              <span>{copied ? 'Скопировано' : 'Скопировать задание'}</span>
            </button>
            <button
              type="button"
              className="lf-btn lf-btn--sm"
              onClick={() => onExportPrompt(promptText)}
            >
              <DownloadIcon size={13} />
              <span>Экспорт .txt</span>
            </button>
            <a
              href="https://chatgpt.com/"
              target="_blank"
              rel="noreferrer"
              className="lf-btn lf-btn--sm"
            >
              <ExternalLinkIcon size={13} />
              <span>Открыть ChatGPT</span>
            </a>
          </div>
        </div>
      </div>

      <div className="vs-step-card">
        <span className="vs-step-num">2</span>
        <div className="vs-step-body">
          <strong>Импортируйте JSON со ссылками из ответа</strong>
          <p>Поддерживается чистый JSON или блок кода ```json``` формата {"{"}"results":[…]{"}"}.</p>
          <textarea
            id="vs-chatgpt-json-input"
            className="lf-textarea mono"
            rows={4}
            aria-label="Результат проверки JSON"
            placeholder={'{"results":[{"title":"Emmemobili MYLINE","url":"https://www.emmemobili.it/en/prodotti/illuminazione/myline"}]}'}
            value={jsonInput}
            onChange={event => {
              setJsonInput(event.target.value);
              if (error) setError('');
            }}
          />
          {error && <p className="lf-field-error">{error}</p>}
          <div className="vs-step-actions">
            <button
              id="vs-chatgpt-import-btn"
              type="button"
              className="lf-btn lf-btn--primary"
              disabled={!jsonInput.trim()}
              onClick={handleImport}
            >
              Импортировать ссылки
            </button>
          </div>
        </div>
      </div>
    </DrawerShell>
  );
}
