'use client';

import { useMemo, useState } from 'react';
import { buildQuickRfq, localize, RfqConflict, type QuickRfq, type RfqLanguage } from '@/rfq/quick';
import type { Composition } from '@/geometry/schema';
import type { ProjectSnapshot } from '@/storage/projects';
import {
  AlertIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FilePdfIcon,
  LinkIcon,
  RefreshIcon,
} from '../icons';
import {
  formatIssuePath,
  languageOptions,
  orderedPhotos,
  type FieldIssue,
  type RfqApiError,
} from './helpers';

export type PreviewTab = 'sheet' | 'pdf' | 'text';

type RfqPreviewPanelProps = {
  className?: string;
  snapshot: ProjectSnapshot;
  photoUrls: Record<string, string>;
  composition?: Composition;
  onDetachComposition: () => void;
  language: RfqLanguage;
  onChangeLanguage: (language: RfqLanguage) => void;
  activeTab: PreviewTab;
  onChangeTab: (tab: PreviewTab) => void;
  validationIssues: FieldIssue[];
  pdfState: {
    status: 'idle' | 'loading' | 'ready' | 'error';
    url: string | null;
    filename: string;
    isStale: boolean;
    error: RfqApiError | null;
  };
  textState: {
    status: 'idle' | 'loading' | 'ready' | 'error';
    text: string;
    isStale: boolean;
    error: RfqApiError | null;
  };
  onGeneratePdf: () => void;
  onGenerateText: () => void;
};

const unknownEn = 'To be confirmed by manufacturer';
const unknownZh = '待制造商确认';

function isUnknownText(value: string): boolean {
  return value.includes(unknownEn) || value.includes(unknownZh);
}

export function RfqPreviewPanel({
  className,
  snapshot,
  photoUrls,
  composition,
  onDetachComposition,
  language,
  onChangeLanguage,
  activeTab,
  onChangeTab,
  validationIssues,
  pdfState,
  textState,
  onGeneratePdf,
  onGenerateText,
}: RfqPreviewPanelProps) {
  const [rfqMode, setRfqMode] = useState<'quick' | 'detailed'>('quick');
  const [copied, setCopied] = useState(false);

  const ordered = orderedPhotos(snapshot.project);
  const canSubmit = validationIssues.length === 0;

  // Live zero-duplication preview derived directly from Codex's buildQuickRfq()
  const localModel = useMemo((): { model: QuickRfq | null; conflict: string | null } => {
    if (!canSubmit) return { model: null, conflict: null };
    try {
      const input = composition ? { project: snapshot.project, composition } : { project: snapshot.project };
      return { model: buildQuickRfq(input), conflict: null };
    } catch (error) {
      if (error instanceof RfqConflict) {
        return { model: null, conflict: error.message };
      }
      return { model: null, conflict: null };
    }
  }, [canSubmit, composition, snapshot.project]);

  const activeError = activeTab === 'pdf' ? pdfState.error : activeTab === 'text' ? textState.error : null;

  async function handleCopyText() {
    if (!textState.text) return;
    try {
      await navigator.clipboard.writeText(textState.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API unavailable
    }
  }

  return (
    <aside
      className={`lf-preview-col${className ? ` ${className}` : ''}`}
      aria-label="Предпросмотр и экспорт документа RFQ"
    >
      <div className="lf-preview-card">
        <div className="lf-preview-toolbar">
          {/* Row 1: RFQ tier + Language switcher */}
          <div className="lf-preview-row">
            <div className="lf-segment" role="group" aria-label="Формат запроса RFQ">
              <button
                id="lf-mode-quick"
                type="button"
                className="lf-segment-btn"
                aria-pressed={rfqMode === 'quick'}
                onClick={() => setRfqMode('quick')}
              >
                Quick RFQ
              </button>
              <button
                id="lf-mode-detailed"
                type="button"
                className="lf-segment-btn"
                aria-pressed={rfqMode === 'detailed'}
                onClick={() => setRfqMode('detailed')}
              >
                Detailed RFQ
              </button>
            </div>

            <div className="lf-segment" role="group" aria-label="Язык документа">
              {languageOptions.map(option => (
                <button
                  key={option.id}
                  id={`lf-lang-${option.id}`}
                  type="button"
                  className="lf-segment-btn"
                  aria-pressed={language === option.id}
                  title={option.hint}
                  onClick={() => onChangeLanguage(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {rfqMode === 'detailed' && (
            <div className="lf-alert lf-alert--info" role="status">
              <div className="lf-alert-content">
                <AlertIcon size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>
                  <strong>Detailed RFQ (Этап 5)</strong> ещё не подключён в серверном API (BOM, чертежи, пакет
                  сравнения фабрик). Сейчас активен производственный предпросмотр <strong>Quick RFQ</strong> без
                  расхождения с бэкенд-контрактом.
                </span>
              </div>
              <button type="button" className="lf-btn lf-btn--sm" onClick={() => setRfqMode('quick')}>
                К Quick RFQ
              </button>
            </div>
          )}

          {/* Row 2: View Tabs + Primary PDF Actions */}
          <div className="lf-preview-row">
            <div className="lf-segment" role="tablist" aria-label="Режим предпросмотра">
              <button
                id="lf-tab-sheet"
                type="button"
                role="tab"
                className="lf-segment-btn"
                aria-selected={activeTab === 'sheet'}
                onClick={() => onChangeTab('sheet')}
              >
                Таблица
              </button>
              <button
                id="lf-tab-pdf"
                type="button"
                role="tab"
                className="lf-segment-btn"
                aria-selected={activeTab === 'pdf'}
                onClick={() => onChangeTab('pdf')}
              >
                PDF
                {pdfState.status === 'ready' && !pdfState.isStale && (
                  <span className="lf-status-dot lf-status-dot--ok" aria-label="PDF актуален" />
                )}
                {pdfState.status === 'ready' && pdfState.isStale && (
                  <span className="lf-status-dot lf-status-dot--warn" aria-label="PDF требует обновления" />
                )}
              </button>
              <button
                id="lf-tab-text"
                type="button"
                role="tab"
                className="lf-segment-btn"
                aria-selected={activeTab === 'text'}
                onClick={() => onChangeTab('text')}
              >
                Текст API
              </button>
            </div>

            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <button
                id="lf-generate-pdf-btn"
                type="button"
                className="lf-btn lf-btn--primary lf-btn--sm"
                disabled={!canSubmit || Boolean(localModel.conflict) || pdfState.status === 'loading'}
                onClick={onGeneratePdf}
              >
                {pdfState.status === 'loading' ? (
                  <RefreshIcon size={14} className="lf-spin" />
                ) : (
                  <FilePdfIcon size={14} />
                )}
                {pdfState.status === 'loading'
                  ? 'Сборка PDF...'
                  : pdfState.url && !pdfState.isStale
                    ? 'Пересобрать PDF'
                    : pdfState.url
                      ? 'Обновить PDF'
                      : 'Сформировать PDF'}
              </button>

              {pdfState.url && (
                <>
                  <a
                    id="lf-download-pdf-link"
                    href={pdfState.url}
                    download={pdfState.filename}
                    className="lf-btn lf-btn--sm"
                    style={{ textDecoration: 'none' }}
                    title="Скачивает уже сформированный PDF без повторного запроса"
                  >
                    <DownloadIcon size={14} />
                    Скачать
                  </a>
                  <a
                    href={pdfState.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="lf-btn lf-btn--subtle lf-btn--icon"
                    style={{ textDecoration: 'none', width: 30, minWidth: 30, minHeight: 30 }}
                    title="Открыть PDF в новой вкладке"
                    aria-label="Открыть PDF в новой вкладке"
                  >
                    <ExternalLinkIcon size={14} />
                  </a>
                </>
              )}
            </div>
          </div>

          {/* Linked composition strip */}
          {composition && (
            <div className="lf-alert lf-alert--info" style={{ padding: '8px 11px' }}>
              <div className="lf-alert-content">
                <LinkIcon size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>
                  Привязана 3D-композиция <strong>{composition.name}</strong> ({composition.elements.length} элем.) —
                  передаётся в Quick RFQ API.
                </span>
              </div>
              <button type="button" className="lf-btn lf-btn--sm" onClick={onDetachComposition}>
                Отвязать
              </button>
            </div>
          )}

          {/* Validation issues banner */}
          {!canSubmit && (
            <div className="lf-alert lf-alert--danger" role="alert">
              <div className="lf-alert-content">
                <AlertIcon size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <strong>Исправьте поля формы перед отправкой в API:</strong>
                  {validationIssues.slice(0, 4).map((issue, idx) => (
                    <span key={idx}>
                      {formatIssuePath(issue.path, snapshot.project)}: {issue.message}
                    </span>
                  ))}
                  {validationIssues.length > 4 && <span>И ещё ошибок: {validationIssues.length - 4}</span>}
                </div>
              </div>
            </div>
          )}

          {/* Local geometry conflict banner */}
          {localModel.conflict && (
            <div className="lf-alert lf-alert--danger" role="alert">
              <div className="lf-alert-content">
                <AlertIcon size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>
                  Конфликт проекта и композиции: {localModel.conflict}
                </span>
              </div>
              {composition && (
                <button type="button" className="lf-btn lf-btn--sm" onClick={onDetachComposition}>
                  Отвязать
                </button>
              )}
            </div>
          )}

          {/* API error banner (503 retryable, 422 invalid_photo, 422 conflict, etc.) */}
          {activeError && (
            <div className="lf-alert lf-alert--danger" role="alert">
              <div className="lf-alert-content">
                <AlertIcon size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span>{activeError.message}</span>
                  {activeError.issues && activeError.issues.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {activeError.issues.slice(0, 4).map((issue, idx) => (
                        <span key={idx}>
                          • {formatIssuePath(issue.path, snapshot.project)}: {issue.message}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: 'inline-flex', gap: 6, flexShrink: 0 }}>
                {activeError.code === 'project_geometry_conflict' && composition && (
                  <button type="button" className="lf-btn lf-btn--sm" onClick={onDetachComposition}>
                    Отвязать
                  </button>
                )}
                {activeError.retryable && (
                  <button
                    id="lf-retry-api-btn"
                    type="button"
                    className="lf-btn lf-btn--sm"
                    onClick={activeTab === 'pdf' ? onGeneratePdf : onGenerateText}
                  >
                    <RefreshIcon size={13} /> Повторить
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Stale PDF reminder */}
          {activeTab === 'pdf' && pdfState.status === 'ready' && pdfState.isStale && (
            <div className="lf-alert lf-alert--warning" role="status">
              <div className="lf-alert-content">
                <AlertIcon size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>Параметры формы изменились после сборки PDF — нажмите «Обновить PDF» для синхронизации.</span>
              </div>
              <button
                type="button"
                className="lf-btn lf-btn--sm"
                disabled={!canSubmit || Boolean(localModel.conflict)}
                onClick={onGeneratePdf}
              >
                Обновить
              </button>
            </div>
          )}
        </div>

        {/* Preview Stage */}
        <div className="lf-preview-stage">
          {activeTab === 'sheet' && (
            localModel.model ? (
              <article className="lf-sheet" aria-label="Предпросмотр таблицы Quick RFQ">
                <header className="lf-sheet-header">
                  <p className="lf-sheet-brand">LIGHT FORGE</p>
                  <h2 className="lf-sheet-doc-title">{localize(localModel.model.documentTitle, language)}</h2>
                  <p className="lf-sheet-project">{localModel.model.title}</p>
                  <p className="lf-sheet-subtitle">{localize(localModel.model.subtitle, language)}</p>
                </header>

                <section className="lf-sheet-section">
                  <h3 className="lf-sheet-h2">{localize(localModel.model.photoTitle, language)}</h3>
                  {ordered.length > 0 ? (
                    <div>
                      {photoUrls[ordered[0].id] && (
                        <figure style={{ margin: 0 }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={photoUrls[ordered[0].id]}
                            alt={ordered[0].name}
                            className="lf-sheet-photos-primary"
                          />
                          <figcaption className="lf-sheet-figcaption">{ordered[0].name}</figcaption>
                        </figure>
                      )}
                      {ordered.length > 1 && (
                        <div className="lf-sheet-photos-extra">
                          {ordered.slice(1).map(photo => (
                            <figure key={photo.id} style={{ margin: 0 }}>
                              {photoUrls[photo.id] && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={photoUrls[photo.id]} alt={photo.name} />
                              )}
                              <figcaption className="lf-sheet-figcaption">{photo.name}</figcaption>
                            </figure>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="lf-sheet-unknown" style={{ margin: 0 }}>
                      {localize(localModel.model.noPhoto, language)}
                    </p>
                  )}
                </section>

                {localModel.model.sections.map((section, sectionIdx) => (
                  <section key={sectionIdx} className="lf-sheet-section">
                    <h3 className="lf-sheet-h2">{localize(section.title, language)}</h3>
                    <table className="lf-sheet-table">
                      <tbody>
                        {section.rows.map(([cellLabel, cellValue], rowIdx) => {
                          const labelText = localize(cellLabel, language);
                          const valueText = localize(cellValue, language);
                          return (
                            <tr key={rowIdx}>
                              <th scope="row">{labelText}</th>
                              <td className={isUnknownText(valueText) ? 'lf-sheet-unknown' : 'num'}>
                                {valueText}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </section>
                ))}

                <section className="lf-sheet-section" style={{ marginBottom: 0 }}>
                  <h3 className="lf-sheet-h2">{localize(localModel.model.requestTitle, language)}</h3>
                  <ul className="lf-sheet-requests">
                    {localModel.model.requested.map((item, idx) => (
                      <li key={idx}>{localize(item, language)}</li>
                    ))}
                  </ul>
                </section>
              </article>
            ) : (
              <div className="lf-pdf-placeholder">
                <AlertIcon size={28} style={{ color: 'var(--danger)' }} />
                <div style={{ fontWeight: 600 }}>Предпросмотр таблицы недоступен</div>
                <p className="lf-card-desc">
                  Заполните обязательные поля или устраните расхождение с композицией, чтобы увидеть документ.
                </p>
              </div>
            )
          )}

          {activeTab === 'pdf' && (
            pdfState.status === 'loading' ? (
              <div className="lf-pdf-placeholder">
                <RefreshIcon size={28} className="lf-spin" style={{ color: 'var(--accent)' }} />
                <div style={{ fontWeight: 600 }}>Генерация печатного PDF A4...</div>
                <p className="lf-card-desc">
                  Сервер формирует документ через <code>/api/rfq/quick?format=pdf&amp;lang={language}</code> с
                  оригинальными фотографиями и шрифтами CJK.
                </p>
              </div>
            ) : pdfState.url ? (
              <div style={{ width: '100%', flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <iframe
                  id="lf-pdf-iframe"
                  title={`Предпросмотр PDF Quick RFQ (${language})`}
                  src={pdfState.url}
                  className="lf-pdf-frame"
                />
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    flexWrap: 'wrap',
                    fontSize: 12,
                    color: 'var(--ink-secondary)',
                  }}
                >
                  <span className="mono">{pdfState.filename}</span>
                  <span>
                    Предпросмотр и кнопка «Скачать» используют один и тот же PDF-файл из ответа сервера.
                  </span>
                </div>
              </div>
            ) : (
              <div className="lf-pdf-placeholder">
                <FilePdfIcon size={32} style={{ color: 'var(--accent)' }} />
                <div style={{ fontWeight: 650, fontSize: 15 }}>PDF ещё не сформирован</div>
                <p className="lf-card-desc">
                  Нажмите «Сформировать PDF», чтобы отправить текущий снимок и оригиналы фото на{' '}
                  <code>POST /api/rfq/quick?format=pdf&amp;lang={language}</code>.
                </p>
                <button
                  type="button"
                  className="lf-btn lf-btn--primary"
                  disabled={!canSubmit || Boolean(localModel.conflict)}
                  onClick={onGeneratePdf}
                >
                  <FilePdfIcon size={15} />
                  Сформировать PDF ({language.toUpperCase()})
                </button>
              </div>
            )
          )}

          {activeTab === 'text' && (
            <div style={{ width: '100%', maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span className="lf-field-hint">
                  Ответ сервера <code>POST /api/rfq/quick?format=text&amp;lang={language}</code>
                </span>
                <div style={{ display: 'inline-flex', gap: 6 }}>
                  <button
                    id="lf-refresh-text-btn"
                    type="button"
                    className="lf-btn lf-btn--sm"
                    disabled={!canSubmit || Boolean(localModel.conflict) || textState.status === 'loading'}
                    onClick={onGenerateText}
                  >
                    <RefreshIcon size={13} className={textState.status === 'loading' ? 'lf-spin' : undefined} />
                    Обновить текст
                  </button>
                  <button
                    id="lf-copy-text-btn"
                    type="button"
                    className="lf-btn lf-btn--primary lf-btn--sm"
                    disabled={!textState.text}
                    onClick={handleCopyText}
                  >
                    {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
                    {copied ? 'Скопировано' : 'Копировать'}
                  </button>
                </div>
              </div>

              {textState.status === 'loading' ? (
                <div className="lf-pdf-placeholder">
                  <RefreshIcon size={24} className="lf-spin" style={{ color: 'var(--accent)' }} />
                  <span>Загрузка текста Quick RFQ...</span>
                </div>
              ) : textState.text ? (
                <pre id="lf-rfq-text-output" className="lf-text-pre">
                  {textState.text}
                </pre>
              ) : (
                <div className="lf-pdf-placeholder">
                  <span>Нажмите «Обновить текст», чтобы получить текст запроса от API.</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
