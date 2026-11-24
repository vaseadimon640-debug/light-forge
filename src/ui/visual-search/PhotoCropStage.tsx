'use client';

import { useRef, useState, type DragEvent, type PointerEvent } from 'react';
import { imageTypes } from '@/domain/project';
import {
  CropIcon,
  DownloadIcon,
  LensIcon,
  RefreshIcon,
  TrashIcon,
  UploadIcon,
} from '../icons';
import {
  clampCrop,
  formatCropSummary,
  formatFileSize,
  FULL_CROP,
  isFullCrop,
  MIN_CROP_SIZE,
  type CropRect,
} from './helpers';

type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se';

type DragSession = {
  mode: DragMode;
  startX: number;
  startY: number;
  startCrop: CropRect;
  rect: DOMRect;
};

type PhotoCropStageProps = {
  photo?: File;
  photoUrl: string;
  crop: CropRect;
  cropActive: boolean;
  onChoosePhoto: (files: FileList | null) => void;
  onClearPhoto: () => void;
  onCropChange: (next: CropRect) => void;
  onToggleCrop: () => void;
  onDownloadLensCopy: () => void;
  onDownloadOriginal: () => void;
};

export function PhotoCropStage({
  photo,
  photoUrl,
  crop,
  cropActive,
  onChoosePhoto,
  onClearPhoto,
  onCropChange,
  onToggleCrop,
  onDownloadLensCopy,
  onDownloadOriginal,
}: PhotoCropStageProps) {
  const [draggingFile, setDraggingFile] = useState(false);
  const [showSliders, setShowSliders] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragSession | null>(null);

  function handleDragOver(event: DragEvent) {
    event.preventDefault();
    if (!draggingFile) setDraggingFile(true);
  }

  function handleDragLeave(event: DragEvent) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDraggingFile(false);
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    setDraggingFile(false);
    onChoosePhoto(event.dataTransfer.files);
  }

  function startCropDrag(mode: DragMode, event: PointerEvent<HTMLElement>) {
    if (!frameRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = frameRef.current.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;
    dragRef.current = {
      mode,
      startX: event.clientX,
      startY: event.clientY,
      startCrop: crop,
      rect,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveCropDrag(event: PointerEvent<HTMLElement>) {
    const session = dragRef.current;
    if (!session) return;
    event.preventDefault();
    const dx = ((event.clientX - session.startX) / session.rect.width) * 100;
    const dy = ((event.clientY - session.startY) / session.rect.height) * 100;
    const s = session.startCrop;
    const right = s.x + s.width;
    const bottom = s.y + s.height;

    if (session.mode === 'move') {
      const nextX = Math.max(0, Math.min(100 - s.width, s.x + dx));
      const nextY = Math.max(0, Math.min(100 - s.height, s.y + dy));
      onCropChange(clampCrop({ x: nextX, y: nextY, width: s.width, height: s.height }));
      return;
    }

    let nextX = s.x;
    let nextY = s.y;
    let nextW = s.width;
    let nextH = s.height;

    if (session.mode === 'nw' || session.mode === 'sw') {
      nextX = Math.max(0, Math.min(right - MIN_CROP_SIZE, s.x + dx));
      nextW = right - nextX;
    }
    if (session.mode === 'ne' || session.mode === 'se') {
      nextW = Math.max(MIN_CROP_SIZE, Math.min(100 - s.x, s.width + dx));
    }
    if (session.mode === 'nw' || session.mode === 'ne') {
      nextY = Math.max(0, Math.min(bottom - MIN_CROP_SIZE, s.y + dy));
      nextH = bottom - nextY;
    }
    if (session.mode === 'sw' || session.mode === 'se') {
      nextH = Math.max(MIN_CROP_SIZE, Math.min(100 - s.y, s.height + dy));
    }

    onCropChange(clampCrop({ x: nextX, y: nextY, width: nextW, height: nextH }));
  }

  function endCropDrag(event: PointerEvent<HTMLElement>) {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleSliderChange(key: keyof CropRect, rawValue: number) {
    const next = { ...crop, [key]: rawValue };
    if (key === 'x') {
      next.width = Math.min(next.width, 100 - next.x);
    } else if (key === 'y') {
      next.height = Math.min(next.height, 100 - next.y);
    } else if (key === 'width') {
      next.x = Math.min(next.x, 100 - next.width);
    } else if (key === 'height') {
      next.y = Math.min(next.y, 100 - next.height);
    }
    onCropChange(clampCrop(next));
  }

  return (
    <div className="vs-photo-stage">
      <input
        ref={fileInputRef}
        id="vs-photo-input"
        type="file"
        className="sr-only"
        aria-label="Фото для поиска"
        accept={imageTypes.join(',')}
        onChange={event => {
          onChoosePhoto(event.target.files);
          event.target.value = '';
        }}
      />

      {!photo || !photoUrl ? (
        <div
          id="vs-dropzone"
          role="button"
          tabIndex={0}
          className={`vs-dropzone ${draggingFile ? 'vs-dropzone--dragging' : ''}`}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="vs-dropzone-icon" aria-hidden="true">
            <UploadIcon size={26} />
          </div>
          <div className="vs-dropzone-copy">
            <strong className="vs-dropzone-title">
              Загрузите фотографию светильника
            </strong>
            <span className="vs-dropzone-sub">
              Перетащите изображение сюда или выберите файл с устройства
            </span>
          </div>
          <span className="vs-dropzone-cta">Выбрать фотографию</span>
          <span className="vs-dropzone-meta">
            JPEG, PNG или WebP до 12 МБ · Оригинал сохраняется без изменений
          </span>
        </div>
      ) : (
        <div
          className={`vs-canvas-shell ${draggingFile ? 'vs-canvas-shell--dragging' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="vs-canvas-mat">
            <div ref={frameRef} className="vs-image-frame">
              <img
                src={photoUrl}
                alt="Загруженная фотография светильника"
                className="vs-image-el"
                draggable={false}
              />

              {cropActive && (
                <div
                  className="vs-crop-box"
                  style={{
                    left: `${crop.x}%`,
                    top: `${crop.y}%`,
                    width: `${crop.width}%`,
                    height: `${crop.height}%`,
                  }}
                  onPointerDown={event => startCropDrag('move', event)}
                  onPointerMove={moveCropDrag}
                  onPointerUp={endCropDrag}
                  onPointerCancel={endCropDrag}
                  role="application"
                  aria-label="Рамка выделения светильника"
                >
                  <span className="vs-crop-badge mono">
                    {crop.width}% × {crop.height}%
                  </span>
                  {(['nw', 'ne', 'sw', 'se'] as const).map(corner => (
                    <span
                      key={corner}
                      className={`vs-crop-handle vs-crop-handle--${corner}`}
                      onPointerDown={event => startCropDrag(corner, event)}
                      onPointerMove={moveCropDrag}
                      onPointerUp={endCropDrag}
                      onPointerCancel={endCropDrag}
                      aria-hidden="true"
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="vs-canvas-toolbar">
            <div className="vs-file-pill">
              <span className="vs-file-name" title={photo.name}>
                {photo.name}
              </span>
              <span className="vs-file-size mono">{formatFileSize(photo.size)}</span>
              {!isFullCrop(crop) && (
                <span className="lf-badge lf-badge--accent mono">
                  {formatCropSummary(crop)}
                </span>
              )}
            </div>

            <div className="vs-canvas-actions">
              <button
                id="vs-crop-toggle"
                type="button"
                className={`lf-btn lf-btn--sm ${cropActive ? 'lf-btn--primary' : ''}`}
                aria-pressed={cropActive}
                onClick={onToggleCrop}
              >
                <CropIcon size={14} />
                <span>{cropActive ? 'Готово' : 'Выделить светильник'}</span>
              </button>

              {cropActive && (
                <>
                  <button
                    type="button"
                    className="lf-btn lf-btn--sm lf-btn--subtle"
                    onClick={() => setShowSliders(prev => !prev)}
                  >
                    <span>{showSliders ? 'Скрыть ползунки' : 'Точная настройка'}</span>
                  </button>
                  {!isFullCrop(crop) && (
                    <button
                      id="vs-crop-reset"
                      type="button"
                      className="lf-btn lf-btn--sm"
                      onClick={() => onCropChange(FULL_CROP)}
                    >
                      <RefreshIcon size={13} />
                      <span>Всё фото</span>
                    </button>
                  )}
                </>
              )}

              <button
                id="vs-download-lens-copy"
                type="button"
                className="lf-btn lf-btn--sm"
                title="Скачать оптимизированную копию выделенной области для Google Lens"
                onClick={onDownloadLensCopy}
              >
                <LensIcon size={14} />
                <span>Копия для Lens</span>
              </button>

              <button
                type="button"
                className="lf-btn lf-btn--sm lf-btn--subtle"
                title="Скачать исходный оригинал без изменений"
                onClick={onDownloadOriginal}
              >
                <DownloadIcon size={14} />
                <span>Оригинал</span>
              </button>

              <button
                type="button"
                className="lf-btn lf-btn--sm lf-btn--subtle"
                onClick={() => fileInputRef.current?.click()}
              >
                <span>Заменить</span>
              </button>

              <button
                type="button"
                className="lf-btn lf-btn--sm lf-btn--icon lf-btn--subtle"
                aria-label="Удалить фотографию"
                title="Удалить фотографию"
                onClick={onClearPhoto}
              >
                <TrashIcon size={14} />
              </button>
            </div>
          </div>

          {cropActive && (
            <div className="vs-crop-helper">
              <p className="vs-crop-tip">
                Перетащите рамку или её углы, чтобы выделить нужный светильник. Оригинал файла остаётся без изменений.
              </p>
              {showSliders && (
                <div className="vs-crop-sliders">
                  {(
                    [
                      ['x', 'Слева', 0, 90],
                      ['y', 'Сверху', 0, 90],
                      ['width', 'Ширина', 10, 100],
                      ['height', 'Высота', 10, 100],
                    ] as const
                  ).map(([key, label, min, max]) => (
                    <label key={key} className="vs-slider-field">
                      <span className="vs-slider-label">
                        <span>{label}</span>
                        <span className="mono">{crop[key]}%</span>
                      </span>
                      <input
                        type="range"
                        min={min}
                        max={max}
                        value={crop[key]}
                        onChange={event => handleSliderChange(key, Number(event.target.value))}
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
