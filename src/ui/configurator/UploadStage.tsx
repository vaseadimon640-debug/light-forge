'use client';

import { useEffect, useRef, useState, type DragEvent } from 'react';
import type { Project } from '@/domain/project';
import { AlertIcon, FilePdfIcon, RefreshIcon, SparkIcon, StarIcon, UploadIcon } from '../icons';
import { formatBytes, orderedPhotos } from '../quick-rfq/helpers';
import type { AttachedDrawing } from './wizardState';

type UploadStageProps = {
  project: Project;
  photoUrls: Record<string, string>;
  drawings: readonly AttachedDrawing[];
  uploadErrors: readonly string[];
  searchOriginals: boolean;
  onToggleSearchOriginals: (next: boolean) => void;
  analyzing: boolean;
  analysisStageText: string | null;
  analysisError: { code: string; message: string } | null;
  onAddFiles: (files: File[]) => void;
  onSelectPrimaryPhoto: (photoId: string) => void;
  onRemovePhoto: (photoId: string) => void;
  onRemoveDrawing: (drawingId: string) => void;
  onRecognizeAndFill: () => void;
  onContinueManual: () => void;
  onLoadMylinePreset: () => void;
};

export function UploadStage({
  project,
  photoUrls,
  drawings,
  uploadErrors,
  searchOriginals,
  onToggleSearchOriginals,
  analyzing,
  analysisStageText,
  analysisError,
  onAddFiles,
  onSelectPrimaryPhoto,
  onRemovePhoto,
  onRemoveDrawing,
  onRecognizeAndFill,
  onContinueManual,
  onLoadMylinePreset,
}: UploadStageProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const photos = orderedPhotos(project);
  const primaryPhoto = photos.find((p) => p.id === project.primaryPhotoId) ?? photos[0];
  const primaryUrl = primaryPhoto ? photoUrls[primaryPhoto.id] : undefined;
  const hasAnyMedia = photos.length > 0 || drawings.length > 0;

  // Clipboard paste support (Ctrl+V / Cmd+V) on Stage 1
  useEffect(() => {
    function handlePaste(event: ClipboardEvent) {
      const items = event.clipboardData?.items;
      if (!items) return;
      const pasted: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) {
            const name = file.name && file.name !== 'image.png'
              ? file.name
              : `pasted-luminaire-${Date.now()}.png`;
            pasted.push(new File([file], name, { type: file.type || 'image/png' }));
          }
        }
      }
      if (pasted.length > 0) {
        event.preventDefault();
        onAddFiles(pasted);
      }
    }
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [onAddFiles]);

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const dropped = Array.from(event.dataTransfer.files ?? []);
    if (dropped.length > 0) onAddFiles(dropped);
  }

  return (
    <section className="lfw-upload-stage" aria-labelledby="lfw-upload-title">
      <header className="lfw-hero-head">
        <h1 id="lfw-upload-title">Начните с фотографии светильника</h1>
        <p>
          Загрузите фото или чертёж — LIGHT FORGE поможет определить конструкцию и характеристики.
        </p>
      </header>

      <input
        ref={inputRef}
        id="lfw-upload-input"
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,.heic,.heif,application/pdf"
        style={{ display: 'none' }}
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          if (picked.length > 0) onAddFiles(picked);
          e.target.value = '';
        }}
      />

      {!hasAnyMedia ? (
        <div
          id="lfw-dropzone"
          role="button"
          tabIndex={0}
          className={`lfw-dropzone${dragging ? ' lfw-dropzone--drag' : ''}`}
          aria-label="Загрузите фотографии светильника или PDF-чертёж"
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          <span className="lfw-dropzone-icon" aria-hidden="true">
            <UploadIcon size={26} />
          </span>
          <span className="lfw-dropzone-title">
            Перетащите файлы сюда, вставьте из буфера (Ctrl+V) или выберите с устройства
          </span>
          <span className="lfw-dropzone-sub">
            Можно добавить несколько ракурсов светильника, технический паспорт и чертёж с размерами.
            Оригиналы сохраняются без изменений.
          </span>
          <div className="lfw-dropzone-formats">
            <span className="lfw-format-chip">JPG</span>
            <span className="lfw-format-chip">PNG</span>
            <span className="lfw-format-chip">WEBP</span>
            <span className="lfw-format-chip">PDF</span>
            <span className="lfw-format-chip">Ctrl+V</span>
          </div>
        </div>
      ) : (
        <div
          className="lfw-preview-card"
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          {primaryUrl ? (
            <div className="lfw-preview-hero">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={primaryUrl} alt={primaryPhoto?.name ?? 'Предпросмотр светильника'} />
            </div>
          ) : (
            <div className="lfw-preview-hero" style={{ padding: 28, textAlign: 'center' }}>
              <div style={{ display: 'grid', gap: 8, justifyItems: 'center' }}>
                <FilePdfIcon size={36} />
                <strong>Прикреплён технический документ / PDF ({drawings.length})</strong>
                <span className="lf-field-hint">
                  Можно сразу нажать «Распознать и заполнить» или добавить фото светильника.
                </span>
              </div>
            </div>
          )}

          <div className="lfw-preview-toolbar">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {primaryPhoto && (
                <span className="lf-badge lf-badge--brass">
                  <StarIcon size={11} filled /> Главное фото: {primaryPhoto.name}
                </span>
              )}
              <span className="lf-field-hint">
                Фото: {photos.length} · Чертежи/PDF: {drawings.length}
              </span>
            </div>
            <button
              id="lfw-add-more-files-btn"
              type="button"
              className="lf-btn lf-btn--subtle lf-btn--sm"
              onClick={() => inputRef.current?.click()}
            >
              + Добавить фото или PDF
            </button>
          </div>

          {photos.length > 0 && (
            <div className="lfw-thumb-strip" aria-label="Загруженные фотографии">
              {photos.map((photo) => {
                const isPrimary = photo.id === primaryPhoto?.id;
                const url = photoUrls[photo.id];
                return (
                  <div
                    key={photo.id}
                    className={`lfw-thumb${isPrimary ? ' lfw-thumb--primary' : ''}`}
                  >
                    <button
                      type="button"
                      style={{ width: '100%', height: '100%', padding: 0, border: 0, background: 'none' }}
                      title={`Сделать главным фото: ${photo.name}`}
                      onClick={() => onSelectPrimaryPhoto(photo.id)}
                    >
                      {url && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={url} alt={photo.name} />
                      )}
                    </button>
                    <button
                      type="button"
                      className="lfw-thumb-remove"
                      aria-label={`Удалить ${photo.name}`}
                      onClick={() => onRemovePhoto(photo.id)}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {drawings.length > 0 && (
            <div className="lfw-drawings-bar" aria-label="Прикреплённые PDF и чертежи">
              {drawings.map((doc) => (
                <span key={doc.id} className="lfw-drawing-pill">
                  <FilePdfIcon size={13} />
                  <span>
                    {doc.name} ({formatBytes(doc.size)})
                  </span>
                  <button
                    type="button"
                    style={{ border: 0, background: 'none', padding: '0 2px', fontWeight: 700 }}
                    aria-label={`Удалить документ ${doc.name}`}
                    onClick={() => onRemoveDrawing(doc.id)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {uploadErrors.length > 0 && (
        <div className="lf-alert lf-alert--warning" role="alert">
          <div className="lf-alert-content">
            <AlertIcon size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ display: 'grid', gap: 4 }}>
              {uploadErrors.map((err) => (
                <span key={err}>{err}</span>
              ))}
            </div>
          </div>
        </div>
      )}

      {hasAnyMedia && (
        <label className="lfw-upload-option">
          <input
            id="lfw-search-originals-checkbox"
            type="checkbox"
            checked={searchOriginals}
            onChange={(e) => onToggleSearchOriginals(e.target.checked)}
          />
          <span>
            <strong>Найти оригинал и технические характеристики</strong>
            <br />
            <span className="lf-field-hint">
              Выполняется отдельным поиском по каталогу/источникам (не путается с визуальным анализом Gemini Vision).
            </span>
          </span>
        </label>
      )}

      {analyzing && analysisStageText && (
        <div id="lfw-real-analysis-status" className="lf-alert lf-alert--info" role="status">
          <div className="lf-alert-content">
            <RefreshIcon size={15} className="lf-spin" style={{ flexShrink: 0 }} />
            <span>{analysisStageText}</span>
          </div>
        </div>
      )}

      {analysisError && (
        <div id="lfw-upload-ai-error" className="lf-alert lf-alert--danger" role="alert">
          <div className="lf-alert-content">
            <AlertIcon size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ display: 'grid', gap: 4 }}>
              <span>{analysisError.message}</span>
              <span className="lf-field-hint mono" style={{ color: 'inherit', opacity: 0.85 }}>
                Код: {analysisError.code} · Вы можете проверить ключ в{' '}
                <a href="/settings" style={{ color: 'inherit', textDecoration: 'underline' }}>
                  Настройках
                </a>{' '}
                или нажать «Заполнить вручную».
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="lfw-upload-actions">
        <button
          id="lfw-recognize-btn"
          type="button"
          className="lf-btn lf-btn--primary lfw-cta-primary"
          disabled={!hasAnyMedia || analyzing}
          onClick={onRecognizeAndFill}
        >
          {analyzing ? <RefreshIcon size={16} className="lf-spin" /> : <SparkIcon size={16} />}
          {analyzing ? 'Анализируем…' : 'Распознать и заполнить'}
        </button>

        <button
          id="lfw-manual-btn"
          type="button"
          className="lf-btn lf-btn--subtle lfw-cta-secondary"
          disabled={analyzing}
          onClick={onContinueManual}
        >
          Заполнить вручную
        </button>
      </div>

      <div className="lfw-subtle-footer">
        Нужен эталонный пример для проверки?{' '}
        <button
          id="lfw-load-myline-btn"
          type="button"
          className="lfw-subtle-link"
          onClick={onLoadMylinePreset}
        >
          Загрузить тестовый проект MYLINE (4 дуги)
        </button>
      </div>
    </section>
  );
}
