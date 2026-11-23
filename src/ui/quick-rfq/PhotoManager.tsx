'use client';

import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { imageTypes, maxPhotos, maxTotalPhotoBytes, type Photo } from '@/domain/project';
import { AlertIcon, StarIcon, TrashIcon, UploadIcon } from '../icons';
import { formatBytes, orderedPhotos, totalPhotoBytes } from './helpers';
import type { ProjectSnapshot } from '@/storage/projects';

type PhotoManagerProps = {
  snapshot: ProjectSnapshot;
  photoUrls: Record<string, string>;
  onAddFiles: (files: File[]) => void;
  onRemovePhoto: (photoId: string) => void;
  onSelectPrimary: (photoId: string) => void;
  uploadErrors: string[];
  onDismissUploadErrors: () => void;
  apiPhotoError?: string;
};

export function PhotoManager({
  snapshot,
  photoUrls,
  onAddFiles,
  onRemovePhoto,
  onSelectPrimary,
  uploadErrors,
  onDismissUploadErrors,
  apiPhotoError,
}: PhotoManagerProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const ordered = orderedPhotos(snapshot.project);
  const primaryPhoto: Photo | undefined = ordered[0];
  const usedBytes = totalPhotoBytes(snapshot.project.photos);
  const budgetPercent = Math.min(100, Math.round((usedBytes / maxTotalPhotoBytes) * 100));
  const atLimit = snapshot.project.photos.length >= maxPhotos;

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files ? Array.from(event.target.files) : [];
    if (files.length) onAddFiles(files);
    event.target.value = '';
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!atLimit) setDragging(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (atLimit) return;
    const files = Array.from(event.dataTransfer.files);
    if (files.length) onAddFiles(files);
  }

  return (
    <section className="lf-card" aria-labelledby="photos-heading">
      <div className="lf-card-header">
        <div className="lf-card-title-wrap">
          <span className="lf-card-eyebrow">Шаг 1 · Визуальный референс</span>
          <h2 id="photos-heading" className="lf-card-title">
            Фотографии светильника
          </h2>
          <p className="lf-card-desc">
            Оригиналы сохраняются без сжатия и передаются в PDF. Главное фото отображается крупно первым.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5, minWidth: 112 }}>
          <span className="lf-badge lf-badge--user num">
            {snapshot.project.photos.length} / {maxPhotos} фото
          </span>
          <span className="lf-field-hint num">{formatBytes(usedBytes)} / 32 МБ</span>
        </div>
      </div>

      <div className="lf-card-body">
        {snapshot.project.photos.length > 0 && (
          <div className="lf-budget-bar" aria-label="Использованный объём фотографий">
            <div className="lf-budget-fill" style={{ width: `${budgetPercent}%` }} />
          </div>
        )}

        {apiPhotoError && (
          <div className="lf-alert lf-alert--danger" role="alert">
            <div className="lf-alert-content">
              <AlertIcon size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{apiPhotoError}</span>
            </div>
          </div>
        )}

        {uploadErrors.length > 0 && (
          <div className="lf-alert lf-alert--warning" role="alert">
            <div className="lf-alert-content">
              <AlertIcon size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {uploadErrors.map((msg, idx) => (
                  <span key={idx}>{msg}</span>
                ))}
              </div>
            </div>
            <button type="button" className="lf-btn lf-btn--sm" onClick={onDismissUploadErrors}>
              Скрыть
            </button>
          </div>
        )}

        {primaryPhoto && photoUrls[primaryPhoto.id] && (
          <div className="lf-photo-stage">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoUrls[primaryPhoto.id]} alt={primaryPhoto.name} />
            <div className="lf-photo-stage-caption">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span className="lf-badge lf-badge--accent">
                  <StarIcon size={12} filled /> Главное фото · №1 в PDF
                </span>
                <span className="lf-photo-name" title={primaryPhoto.name}>
                  {primaryPhoto.name}
                </span>
              </div>
              <span className="lf-field-hint num" style={{ flexShrink: 0 }}>
                {formatBytes(primaryPhoto.size)}
              </span>
            </div>
          </div>
        )}

        {ordered.length > 0 && (
          <div className="lf-photo-grid" aria-label="Загруженные фотографии">
            {ordered.map(photo => {
              const isPrimary = photo.id === snapshot.project.primaryPhotoId;
              const url = photoUrls[photo.id];
              return (
                <div
                  key={photo.id}
                  className={`lf-photo-thumb${isPrimary ? ' lf-photo-thumb--primary' : ''}`}
                >
                  {url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={url}
                      alt={photo.name}
                      className="lf-photo-thumb-img"
                      onClick={() => onSelectPrimary(photo.id)}
                      title={isPrimary ? 'Главное фото для PDF' : 'Сделать главным фото'}
                    />
                  ) : (
                    <div className="lf-photo-thumb-img" />
                  )}
                  <div className="lf-photo-thumb-meta">
                    <span className="lf-photo-name" title={photo.name}>
                      {photo.name}
                    </span>
                    <div style={{ display: 'inline-flex', gap: 2 }}>
                      <button
                        type="button"
                        className="lf-btn lf-btn--subtle lf-btn--icon"
                        style={{
                          width: 24,
                          minWidth: 24,
                          minHeight: 24,
                          color: isPrimary ? 'var(--accent)' : 'var(--ink-muted)',
                        }}
                        title={isPrimary ? 'Главное фото' : 'Сделать главным'}
                        aria-label={isPrimary ? `Главное фото: ${photo.name}` : `Сделать главным: ${photo.name}`}
                        onClick={() => onSelectPrimary(photo.id)}
                      >
                        <StarIcon size={13} filled={isPrimary} />
                      </button>
                      <button
                        type="button"
                        className="lf-btn lf-btn--subtle lf-btn--icon"
                        style={{ width: 24, minWidth: 24, minHeight: 24, color: 'var(--danger)' }}
                        title="Удалить фото"
                        aria-label={`Удалить фото ${photo.name}`}
                        onClick={() => onRemovePhoto(photo.id)}
                      >
                        <TrashIcon size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <input
          ref={inputRef}
          id="lf-photo-input"
          type="file"
          accept={imageTypes.join(',')}
          multiple
          className="sr-only"
          onChange={handleInputChange}
          disabled={atLimit}
        />

        <div
          role="button"
          tabIndex={atLimit ? -1 : 0}
          aria-disabled={atLimit}
          className={`lf-dropzone${dragging ? ' lf-dropzone--drag' : ''}`}
          onClick={() => !atLimit && inputRef.current?.click()}
          onKeyDown={event => {
            if (!atLimit && (event.key === 'Enter' || event.key === ' ')) {
              event.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <span className="lf-dropzone-icon">
            <UploadIcon size={18} />
          </span>
          <div style={{ fontWeight: 600, fontSize: 13.5 }}>
            {atLimit
              ? 'Достигнут лимит 8 фотографий'
              : snapshot.project.photos.length === 0
                ? 'Загрузите фотографии светильника или перетащите их сюда'
                : 'Добавить ещё фотографии'}
          </div>
          <div className="lf-field-hint">
            JPEG, PNG или WebP · до 12 МиБ на файл · до 32 МиБ суммарно · без потери оригинала
          </div>
        </div>
      </div>
    </section>
  );
}
