'use client';

import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent,
  type SyntheticEvent,
} from 'react';
import { imageTypes, maxPhotos, maxTotalPhotoBytes } from '@/domain/project';
import {
  ClipboardIcon,
  CloseIcon,
  CropIcon,
  DownloadIcon,
  LensIcon,
  PlusIcon,
  RefreshIcon,
  RotateCcwIcon,
  RotateCwIcon,
  StarIcon,
  TrashIcon,
  UploadIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from '../icons';
import {
  clampCrop,
  clampZoom,
  formatFileSize,
  formatTransformSummary,
  FULL_CROP,
  isFullCrop,
  isTransformDefault,
  MAX_ZOOM,
  MIN_CROP_SIZE,
  MIN_ZOOM,
  ZOOM_STEP,
  type CropRect,
  type SearchPhotoItem,
} from './helpers';
import { renderRotatedPreviewBlob } from './image-processing';

type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se';

type DragSession = {
  mode: DragMode;
  startX: number;
  startY: number;
  startCrop: CropRect;
  rect: DOMRect;
};

type PhotoCropStageProps = {
  photos: SearchPhotoItem[];
  photoUrls: Record<string, string>;
  activePhoto?: SearchPhotoItem;
  primaryPhotoId: string | null;
  onAddPhotos: (files: FileList | File[] | null, source?: 'upload' | 'clipboard') => void;
  onPasteFromClipboard: () => void;
  onSelectActivePhoto: (id: string) => void;
  onSetPrimaryPhoto: (id: string) => void;
  onRemovePhoto: (id: string) => void;
  onCropChange: (id: string, next: CropRect) => void;
  onToggleCrop: (id: string) => void;
  onRotatePhoto: (id: string, delta: 90 | -90) => void;
  onResetTransform: (id: string) => void;
  onZoomChange: (id: string, nextZoom: number) => void;
  onDownloadLensCopy: (id: string) => void;
  onDownloadOriginal: (id: string) => void;
};

export function PhotoCropStage({
  photos,
  photoUrls,
  activePhoto,
  primaryPhotoId,
  onAddPhotos,
  onPasteFromClipboard,
  onSelectActivePhoto,
  onSetPrimaryPhoto,
  onRemovePhoto,
  onCropChange,
  onToggleCrop,
  onRotatePhoto,
  onResetTransform,
  onZoomChange,
  onDownloadLensCopy,
  onDownloadOriginal,
}: PhotoCropStageProps) {
  const [draggingFile, setDraggingFile] = useState(false);
  const [showSliders, setShowSliders] = useState(false);
  const [rotatedUrl, setRotatedUrl] = useState('');
  const [baseSize, setBaseSize] = useState<{ width: number; height: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<DragSession | null>(null);

  const activeOriginalUrl = activePhoto ? (photoUrls[activePhoto.id] ?? '') : '';
  const activeRotation = activePhoto?.rotation ?? 0;
  const activeFile = activePhoto?.file;

  // Render a non-destructive rotated preview URL whenever rotation !== 0
  useEffect(() => {
    if (!activeFile || activeRotation === 0) {
      setRotatedUrl('');
      return;
    }
    let cancelled = false;
    let objectUrl = '';

    void renderRotatedPreviewBlob(activeFile, activeRotation)
      .then(blob => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setRotatedUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setRotatedUrl('');
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [activeFile, activeRotation]);

  // Reset base measured dimensions whenever active photo or rotation changes
  useEffect(() => {
    setBaseSize(null);
  }, [activePhoto?.id, activeRotation]);

  const displayUrl =
    activeRotation !== 0 && rotatedUrl ? rotatedUrl : activeOriginalUrl;

  const totalBytes = photos.reduce((sum, item) => sum + item.file.size, 0);
  const canAddMore = photos.length < maxPhotos && totalBytes < maxTotalPhotoBytes;

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
    onAddPhotos(event.dataTransfer.files, 'upload');
  }

  function handleImageLoad(event: SyntheticEvent<HTMLImageElement>) {
    if (!activePhoto || activePhoto.zoom !== 1) return;
    const el = event.currentTarget;
    if (el.clientWidth > 0 && el.clientHeight > 0) {
      setBaseSize({ width: el.clientWidth, height: el.clientHeight });
    }
  }

  function captureBaseSizeBeforeZoom() {
    if (baseSize || !imageRef.current) return;
    const { clientWidth, clientHeight } = imageRef.current;
    if (clientWidth > 0 && clientHeight > 0) {
      setBaseSize({ width: clientWidth, height: clientHeight });
    }
  }

  function handleZoomStep(nextZoom: number) {
    if (!activePhoto) return;
    if (activePhoto.zoom === 1 && nextZoom > 1) {
      captureBaseSizeBeforeZoom();
    }
    onZoomChange(activePhoto.id, clampZoom(nextZoom));
  }

  function startCropDrag(mode: DragMode, event: PointerEvent<HTMLElement>) {
    if (!frameRef.current || !activePhoto) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = frameRef.current.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;
    dragRef.current = {
      mode,
      startX: event.clientX,
      startY: event.clientY,
      startCrop: activePhoto.crop,
      rect,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveCropDrag(event: PointerEvent<HTMLElement>) {
    const session = dragRef.current;
    if (!session || !activePhoto) return;
    event.preventDefault();
    const dx = ((event.clientX - session.startX) / session.rect.width) * 100;
    const dy = ((event.clientY - session.startY) / session.rect.height) * 100;
    const s = session.startCrop;
    const right = s.x + s.width;
    const bottom = s.y + s.height;

    if (session.mode === 'move') {
      const nextX = Math.max(0, Math.min(100 - s.width, s.x + dx));
      const nextY = Math.max(0, Math.min(100 - s.height, s.y + dy));
      onCropChange(activePhoto.id, clampCrop({ x: nextX, y: nextY, width: s.width, height: s.height }));
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

    onCropChange(activePhoto.id, clampCrop({ x: nextX, y: nextY, width: nextW, height: nextH }));
  }

  function endCropDrag(event: PointerEvent<HTMLElement>) {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleSliderChange(key: keyof CropRect, rawValue: number) {
    if (!activePhoto) return;
    const next = { ...activePhoto.crop, [key]: rawValue };
    if (key === 'x') {
      next.width = Math.min(next.width, 100 - next.x);
    } else if (key === 'y') {
      next.height = Math.min(next.height, 100 - next.y);
    } else if (key === 'width') {
      next.x = Math.min(next.x, 100 - next.width);
    } else if (key === 'height') {
      next.y = Math.min(next.y, 100 - next.height);
    }
    onCropChange(activePhoto.id, clampCrop(next));
  }

  const activeIsPrimary = Boolean(activePhoto && activePhoto.id === primaryPhotoId);
  const activeZoom = activePhoto?.zoom ?? 1;
  const activeZoomPercent = Math.round(activeZoom * 100);
  const zoomedFrameStyle =
    activeZoom > 1 && baseSize
      ? {
          width: `${Math.round(baseSize.width * activeZoom)}px`,
          height: `${Math.round(baseSize.height * activeZoom)}px`,
        }
      : undefined;

  return (
    <div className="vs-photo-stage">
      <input
        ref={fileInputRef}
        id="vs-photo-input"
        type="file"
        multiple
        className="sr-only"
        aria-label="Фото для поиска"
        accept={imageTypes.join(',')}
        onChange={event => {
          onAddPhotos(event.target.files, 'upload');
          event.target.value = '';
        }}
      />

      {!activePhoto || !displayUrl ? (
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
              Загрузите фотографии светильника
            </strong>
            <span className="vs-dropzone-sub">
              Перетащите одно или несколько фото, выберите файлы с устройства или нажмите Ctrl+V / ⌘V
            </span>
          </div>
          <div className="vs-dropzone-actions">
            <span className="vs-dropzone-cta">Выбрать фотографии</span>
            <button
              id="vs-paste-photo-btn"
              type="button"
              className="lf-btn lf-btn--sm"
              onClick={event => {
                event.stopPropagation();
                onPasteFromClipboard();
              }}
            >
              <ClipboardIcon size={14} />
              <span>Вставить из буфера</span>
            </button>
          </div>
          <span className="vs-dropzone-meta">
            JPEG, PNG или WebP · до {maxPhotos} фото (до 12 МБ/файл, 32 МБ всего) · Оригиналы сохраняются без изменений
          </span>
        </div>
      ) : (
        <div
          className={`vs-canvas-shell ${draggingFile ? 'vs-canvas-shell--dragging' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Stage Top Control Bar: Primary badge + Rotate + Zoom */}
          <div className="vs-stage-topbar">
            <div className="vs-stage-role">
              {activeIsPrimary ? (
                <span className="vs-primary-badge" data-testid="vs-active-primary-badge">
                  <StarIcon size={12} filled />
                  <span>Основное фото для поиска</span>
                </span>
              ) : (
                <div className="vs-secondary-role">
                  <span className="lf-badge lf-badge--unknown">Дополнительное фото</span>
                  <button
                    id="vs-make-primary-btn"
                    type="button"
                    className="lf-btn lf-btn--sm lf-btn--brass"
                    onClick={() => onSetPrimaryPhoto(activePhoto.id)}
                  >
                    <StarIcon size={13} />
                    <span>Сделать основным</span>
                  </button>
                </div>
              )}
            </div>

            <div className="vs-transform-controls" role="group" aria-label="Поворот и масштаб фото">
              <button
                id="vs-rotate-ccw"
                type="button"
                className="lf-btn lf-btn--sm lf-btn--icon"
                title="Повернуть на 90° влево"
                aria-label="Повернуть на 90° влево"
                onClick={() => onRotatePhoto(activePhoto.id, -90)}
              >
                <RotateCcwIcon size={14} />
              </button>
              <button
                id="vs-rotate-cw"
                type="button"
                className="lf-btn lf-btn--sm lf-btn--icon"
                title="Повернуть на 90° вправо"
                aria-label="Повернуть на 90° вправо"
                onClick={() => onRotatePhoto(activePhoto.id, 90)}
              >
                <RotateCwIcon size={14} />
              </button>
              {activePhoto.rotation !== 0 && (
                <span className="vs-transform-pill mono" data-testid="vs-rotation-value">
                  {activePhoto.rotation}°
                </span>
              )}

              <span className="vs-ctrl-sep" aria-hidden="true" />

              <button
                id="vs-zoom-out"
                type="button"
                className="lf-btn lf-btn--sm lf-btn--icon"
                title="Уменьшить масштаб"
                aria-label="Уменьшить масштаб"
                disabled={activeZoom <= MIN_ZOOM}
                onClick={() => handleZoomStep(activeZoom - ZOOM_STEP)}
              >
                <ZoomOutIcon size={14} />
              </button>
              <button
                id="vs-zoom-reset"
                type="button"
                className="lf-btn lf-btn--sm mono vs-zoom-readout"
                title="Сбросить масштаб к 100%"
                aria-label={`Масштаб ${activeZoomPercent}%, нажмите для сброса к 100%`}
                onClick={() => handleZoomStep(1)}
              >
                {activeZoomPercent}%
              </button>
              <button
                id="vs-zoom-in"
                type="button"
                className="lf-btn lf-btn--sm lf-btn--icon"
                title="Увеличить масштаб"
                aria-label="Увеличить масштаб"
                disabled={activeZoom >= MAX_ZOOM}
                onClick={() => handleZoomStep(activeZoom + ZOOM_STEP)}
              >
                <ZoomInIcon size={14} />
              </button>
              <input
                id="vs-zoom-slider"
                type="range"
                className="vs-zoom-slider"
                aria-label="Масштаб просмотра фото"
                min={MIN_ZOOM}
                max={MAX_ZOOM}
                step={ZOOM_STEP}
                value={activeZoom}
                onChange={event => handleZoomStep(Number(event.target.value))}
              />
            </div>
          </div>

          <div
            className={`vs-canvas-mat ${activeZoom > 1 ? 'vs-canvas-mat--zoomed' : ''}`}
            data-zoom={activeZoomPercent}
            data-rotation={activePhoto.rotation}
          >
            <div
              ref={frameRef}
              className={`vs-image-frame ${activeZoom > 1 ? 'vs-image-frame--zoomed' : ''}`}
              style={zoomedFrameStyle}
            >
              <img
                ref={imageRef}
                src={displayUrl}
                alt={`Загруженная фотография светильника: ${activePhoto.file.name}`}
                className="vs-image-el"
                draggable={false}
                onLoad={handleImageLoad}
              />

              {activePhoto.cropActive && (
                <div
                  className="vs-crop-box"
                  style={{
                    left: `${activePhoto.crop.x}%`,
                    top: `${activePhoto.crop.y}%`,
                    width: `${activePhoto.crop.width}%`,
                    height: `${activePhoto.crop.height}%`,
                  }}
                  onPointerDown={event => startCropDrag('move', event)}
                  onPointerMove={moveCropDrag}
                  onPointerUp={endCropDrag}
                  onPointerCancel={endCropDrag}
                  role="application"
                  aria-label="Рамка выделения светильника"
                >
                  <span className="vs-crop-badge mono">
                    {activePhoto.crop.width}% × {activePhoto.crop.height}%
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
              <span className="vs-file-name" title={activePhoto.file.name}>
                {activePhoto.file.name}
              </span>
              <span className="vs-file-size mono">{formatFileSize(activePhoto.file.size)}</span>
              {!isTransformDefault(activePhoto.crop, activePhoto.rotation) && (
                <span className="lf-badge lf-badge--accent mono">
                  {formatTransformSummary(activePhoto.crop, activePhoto.rotation)}
                </span>
              )}
            </div>

            <div className="vs-canvas-actions">
              <button
                id="vs-crop-toggle"
                type="button"
                className={`lf-btn lf-btn--sm ${activePhoto.cropActive ? 'lf-btn--primary' : ''}`}
                aria-pressed={activePhoto.cropActive}
                onClick={() => onToggleCrop(activePhoto.id)}
              >
                <CropIcon size={14} />
                <span>{activePhoto.cropActive ? 'Готово' : 'Выделить светильник'}</span>
              </button>

              {activePhoto.cropActive && (
                <>
                  <button
                    type="button"
                    className="lf-btn lf-btn--sm lf-btn--subtle"
                    onClick={() => setShowSliders(prev => !prev)}
                  >
                    <span>{showSliders ? 'Скрыть ползунки' : 'Точная настройка'}</span>
                  </button>
                  {!isFullCrop(activePhoto.crop) && (
                    <button
                      id="vs-crop-reset"
                      type="button"
                      className="lf-btn lf-btn--sm"
                      onClick={() => onCropChange(activePhoto.id, FULL_CROP)}
                    >
                      <RefreshIcon size={13} />
                      <span>Всё фото</span>
                    </button>
                  )}
                </>
              )}

              {(!isTransformDefault(activePhoto.crop, activePhoto.rotation) || activeZoom > 1) && (
                <button
                  id="vs-transform-reset"
                  type="button"
                  className="lf-btn lf-btn--sm lf-btn--subtle"
                  onClick={() => onResetTransform(activePhoto.id)}
                >
                  <RefreshIcon size={13} />
                  <span>Сбросить правки</span>
                </button>
              )}

              <button
                id="vs-download-lens-copy"
                type="button"
                className="lf-btn lf-btn--sm"
                title="Скачать рабочую копию (с учётом поворота и выделения) для Google Lens"
                onClick={() => onDownloadLensCopy(activePhoto.id)}
              >
                <LensIcon size={14} />
                <span>Копия для Lens</span>
              </button>

              <button
                id="vs-download-original"
                type="button"
                className="lf-btn lf-btn--sm lf-btn--subtle"
                title="Скачать исходный оригинал без изменений"
                onClick={() => onDownloadOriginal(activePhoto.id)}
              >
                <DownloadIcon size={14} />
                <span>Оригинал</span>
              </button>

              <button
                id="vs-paste-more-btn"
                type="button"
                className="lf-btn lf-btn--sm lf-btn--subtle"
                title="Вставить ещё фото из буфера обмена (Ctrl+V / ⌘V)"
                disabled={!canAddMore}
                onClick={onPasteFromClipboard}
              >
                <ClipboardIcon size={14} />
                <span>Из буфера</span>
              </button>

              <button
                id="vs-add-more-photos-btn"
                type="button"
                className="lf-btn lf-btn--sm lf-btn--subtle"
                disabled={!canAddMore}
                onClick={() => fileInputRef.current?.click()}
              >
                <PlusIcon size={13} />
                <span>Добавить фото</span>
              </button>

              <button
                id="vs-remove-active-photo"
                type="button"
                className="lf-btn lf-btn--sm lf-btn--icon lf-btn--subtle"
                aria-label={`Удалить ${activePhoto.file.name}`}
                title="Удалить это фото"
                onClick={() => onRemovePhoto(activePhoto.id)}
              >
                <TrashIcon size={14} />
              </button>
            </div>
          </div>

          {activePhoto.cropActive && (
            <div className="vs-crop-helper">
              <p className="vs-crop-tip">
                Перетащите рамку или её углы, чтобы выделить нужный светильник. Поворот, масштаб и выделение создают рабочую копию — исходный оригинал файла не меняется.
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
                        <span className="mono">{activePhoto.crop[key]}%</span>
                      </span>
                      <input
                        type="range"
                        min={min}
                        max={max}
                        value={activePhoto.crop[key]}
                        onChange={event => handleSliderChange(key, Number(event.target.value))}
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Multi-photo Gallery Filmstrip */}
          <div className="vs-filmstrip-wrap" aria-label="Загруженные фотографии">
            <div className="vs-filmstrip-head">
              <span className="vs-filmstrip-count">
                Фотографии: <strong className="mono">{photos.length} / {maxPhotos}</strong>{' '}
                <span className="vs-filmstrip-bytes mono">
                  ({formatFileSize(totalBytes)} / 32 МБ)
                </span>
              </span>
              <span className="vs-filmstrip-note">
                Поиск выполняется по основному фото · все оригиналы переносятся в Quick RFQ
              </span>
            </div>

            <div className="vs-filmstrip" role="list">
              {photos.map((item, idx) => {
                const isSelected = item.id === activePhoto.id;
                const isPrimary = item.id === primaryPhotoId;
                const thumbUrl = photoUrls[item.id] ?? '';
                const hasEdit = !isTransformDefault(item.crop, item.rotation);
                return (
                  <div
                    key={item.id}
                    role="listitem"
                    className={`vs-thumb-card ${isSelected ? 'vs-thumb-card--active' : ''} ${isPrimary ? 'vs-thumb-card--primary' : ''}`}
                    data-photo-id={item.id}
                    data-primary={isPrimary ? 'true' : 'false'}
                  >
                    <button
                      type="button"
                      className="vs-thumb-select"
                      aria-current={isSelected ? 'true' : undefined}
                      aria-label={`Просмотреть фото ${idx + 1}: ${item.file.name}${isPrimary ? ' (основное)' : ''}`}
                      onClick={() => onSelectActivePhoto(item.id)}
                    >
                      {thumbUrl && (
                        <img
                          src={thumbUrl}
                          alt={item.file.name}
                          className="vs-thumb-img"
                          style={
                            item.rotation !== 0
                              ? { transform: `rotate(${item.rotation}deg)` }
                              : undefined
                          }
                        />
                      )}
                      {isPrimary && (
                        <span className="vs-thumb-badge">
                          <StarIcon size={10} filled />
                          <span>Основное</span>
                        </span>
                      )}
                      {hasEdit && (
                        <span className="vs-thumb-edit-dot mono" title={formatTransformSummary(item.crop, item.rotation)}>
                          {item.rotation !== 0 ? `${item.rotation}°` : '✂'}
                        </span>
                      )}
                    </button>

                    <div className="vs-thumb-bar">
                      <span className="vs-thumb-name" title={item.file.name}>
                        {item.file.name}
                      </span>
                      <div className="vs-thumb-actions">
                        <button
                          type="button"
                          className={`vs-thumb-icon-btn ${isPrimary ? 'vs-thumb-icon-btn--primary' : ''}`}
                          aria-pressed={isPrimary}
                          aria-label={isPrimary ? `Основное фото: ${item.file.name}` : `Сделать основным: ${item.file.name}`}
                          title={isPrimary ? 'Основное фото' : 'Сделать основным'}
                          onClick={() => onSetPrimaryPhoto(item.id)}
                        >
                          <StarIcon size={12} filled={isPrimary} />
                        </button>
                        <button
                          type="button"
                          className="vs-thumb-icon-btn"
                          aria-label={`Удалить фото ${item.file.name}`}
                          title="Удалить фото"
                          onClick={() => onRemovePhoto(item.id)}
                        >
                          <CloseIcon size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {canAddMore && (
                <button
                  type="button"
                  className="vs-thumb-add"
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Добавить ещё фотографию"
                >
                  <PlusIcon size={18} />
                  <span>Ещё фото</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
