'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { productTypes, type Project } from '@/domain/project';
import type { Composition } from '@/geometry/schema';
import { openCompositionStore, type SavedComposition } from '@/storage/compositions';
import { CloseIcon, DownloadIcon, FolderIcon, LinkIcon, TrashIcon, UploadIcon } from '../icons';

type ProjectLibraryModalProps = {
  open: boolean;
  onClose: () => void;
  currentProjectId: string;
  savedProjects: Project[];
  loading: boolean;
  onOpenProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
  onExportCurrent: () => void;
  onImportArchive: (file: File) => void;
  linkedComposition?: Composition;
  onLinkComposition: (composition: Composition | undefined) => void;
};

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function ProjectLibraryModal({
  open,
  onClose,
  currentProjectId,
  savedProjects,
  loading,
  onOpenProject,
  onDeleteProject,
  onExportCurrent,
  onImportArchive,
  linkedComposition,
  onLinkComposition,
}: ProjectLibraryModalProps) {
  const importRef = useRef<HTMLInputElement | null>(null);
  const [compositions, setCompositions] = useState<SavedComposition[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const store = await openCompositionStore();
        try {
          const items = await store.list();
          if (!cancelled) setCompositions(items);
        } finally {
          store.close();
        }
      } catch {
        if (!cancelled) setCompositions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const matchingCompositions = compositions.filter(
    item => item.composition.projectId === currentProjectId,
  );

  function handleImportChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) onImportArchive(file);
    event.target.value = '';
  }

  return (
    <div
      className="lf-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="library-modal-title"
      onClick={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="lf-modal">
        <div className="lf-modal-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <FolderIcon size={18} style={{ color: 'var(--accent)' }} />
            <h2 id="library-modal-title" className="lf-card-title" style={{ fontSize: 16 }}>
              Проекты и перенос архивов
            </h2>
          </div>
          <button
            type="button"
            className="lf-btn lf-btn--subtle lf-btn--icon"
            aria-label="Закрыть окно проектов"
            onClick={onClose}
          >
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="lf-modal-body">
          {/* Portable JSON export / import with original photos */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              flexWrap: 'wrap',
              padding: '12px 14px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border)',
              background: 'var(--bg-subtle)',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>Переносимый JSON-архив (с оригиналами фото)</div>
              <div className="lf-field-hint">
                Локальное хранилище IndexedDB привязано к домену браузера. Для переноса используйте экспорт/импорт.
              </div>
            </div>
            <div style={{ display: 'inline-flex', gap: 8 }}>
              <button id="lf-export-json-btn" type="button" className="lf-btn lf-btn--sm" onClick={onExportCurrent}>
                <DownloadIcon size={14} /> Экспорт JSON
              </button>
              <button
                id="lf-import-json-btn"
                type="button"
                className="lf-btn lf-btn--sm"
                onClick={() => importRef.current?.click()}
              >
                <UploadIcon size={14} /> Импорт JSON
              </button>
              <input
                ref={importRef}
                type="file"
                accept="application/json,.json"
                className="sr-only"
                onChange={handleImportChange}
              />
            </div>
          </div>

          {/* Saved projects list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h3 className="lf-subblock-title">Сохранённые проекты в IndexedDB ({savedProjects.length})</h3>
            {loading ? (
              <div className="lf-field-hint">Загрузка списка проектов...</div>
            ) : savedProjects.length === 0 ? (
              <div className="lf-alert">
                <span>
                  Пока нет сохранённых проектов. Нажмите «Сохранить» в верхней панели, чтобы сохранить текущий
                  проект вместе с оригиналами фотографий.
                </span>
              </div>
            ) : (
              savedProjects.map(item => {
                const isCurrent = item.id === currentProjectId;
                return (
                  <div
                    key={item.id}
                    className={`lf-saved-item${isCurrent ? ' lf-saved-item--current' : ''}`}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: 14 }}>{item.name}</strong>
                        {item.code && <span className="lf-badge lf-badge--user mono">{item.code}</span>}
                        {isCurrent && <span className="lf-badge lf-badge--accent">Открыт</span>}
                      </div>
                      <div className="lf-field-hint" style={{ marginTop: 3 }}>
                        {productTypes[item.kind][0]} · Компонентов: {item.components.length} · Фото: {item.photos.length} ·
                        Обновлён {formatDate(item.updatedAt)}
                      </div>
                    </div>
                    <div style={{ display: 'inline-flex', gap: 6, flexShrink: 0 }}>
                      <button
                        type="button"
                        className="lf-btn lf-btn--sm"
                        onClick={() => {
                          onOpenProject(item.id);
                          onClose();
                        }}
                      >
                        Открыть
                      </button>
                      <button
                        type="button"
                        className="lf-btn lf-btn--danger lf-btn--icon"
                        style={{ width: 30, minWidth: 30, minHeight: 30 }}
                        aria-label={`Удалить проект ${item.name}`}
                        onClick={() => onDeleteProject(item.id)}
                      >
                        <TrashIcon size={14} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Optional linked 3D composition from CompositionStore */}
          {matchingCompositions.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 6, borderTop: '1px solid var(--border)' }}>
              <h3 className="lf-subblock-title">Связанные 3D-композиции для этого проекта</h3>
              {matchingCompositions.map(({ composition }) => {
                const isLinked = linkedComposition?.id === composition.id;
                return (
                  <div key={composition.id} className="lf-saved-item">
                    <div>
                      <strong style={{ fontSize: 13.5 }}>{composition.name}</strong>
                      <div className="lf-field-hint">
                        Элементов: {composition.elements.length} · Подвесов: {composition.suspensions.length}
                      </div>
                    </div>
                    <button
                      type="button"
                      className={`lf-btn lf-btn--sm${isLinked ? ' lf-btn--primary' : ''}`}
                      onClick={() => onLinkComposition(isLinked ? undefined : composition)}
                    >
                      <LinkIcon size={13} />
                      {isLinked ? 'Отвязать' : 'Подключить к RFQ'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
