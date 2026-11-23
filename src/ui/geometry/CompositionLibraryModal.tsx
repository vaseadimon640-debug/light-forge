'use client';

import { useRef, type ChangeEvent } from 'react';
import type { SavedComposition } from '@/storage/compositions';

type CompositionLibraryModalProps = {
  open: boolean;
  onClose: () => void;
  currentId: string;
  items: SavedComposition[];
  loading: boolean;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onExportJson: () => void;
  onImportJson: (file: File) => void;
};

function fmtDate(iso: string): string {
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

export function CompositionLibraryModal({
  open,
  onClose,
  currentId,
  items,
  loading,
  onOpen,
  onDelete,
  onExportJson,
  onImportJson,
}: CompositionLibraryModalProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  if (!open) return null;

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) onImportJson(file);
    event.target.value = '';
  }

  return (
    <div
      className="lfg-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="comp-lib-title"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="lfg-modal">
        <div className="lfg-modal-head">
          <h2 id="comp-lib-title" style={{ margin: 0, fontSize: 15.5, fontWeight: 650 }}>
            Сохранённые 3D-композиции (IndexedDB)
          </h2>
          <button type="button" className="lfg-btn lfg-btn--sm" onClick={onClose}>
            Закрыть
          </button>
        </div>

        <div className="lfg-modal-body">
          <div className="lfg-saved-row">
            <div>
              <strong style={{ fontSize: 13 }}>Перенос JSON-файлом</strong>
              <div className="lfg-hint">
                Хранение в браузере привязано к origin. Выгрузите JSON для переноса на другой домен.
              </div>
            </div>
            <div style={{ display: 'inline-flex', gap: 6 }}>
              <button id="lfg-export-json-btn" type="button" className="lfg-btn lfg-btn--sm" onClick={onExportJson}>
                Экспорт JSON
              </button>
              <button
                id="lfg-import-json-btn"
                type="button"
                className="lfg-btn lfg-btn--sm"
                onClick={() => fileRef.current?.click()}
              >
                Импорт JSON
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="lfg-sr-only"
                onChange={handleFile}
              />
            </div>
          </div>

          {loading ? (
            <div className="lfg-hint">Загрузка композиций...</div>
          ) : items.length === 0 ? (
            <div className="lfg-alert">
              Нет сохранённых композиций. Нажмите «Сохранить» в верхней панели, чтобы записать текущую сцену в IndexedDB.
            </div>
          ) : (
            items.map(({ composition, updatedAt }) => (
              <div key={composition.id} className="lfg-saved-row">
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                    <strong>{composition.name}</strong>
                    <span className="lfg-badge lfg-badge--unknown lfg-mono">{composition.id}</span>
                    {composition.id === currentId && <span className="lfg-badge lfg-badge--accent">Открыта</span>}
                  </div>
                  <div className="lfg-hint">
                    Элементов: {composition.elements.length} · Оснований: {composition.canopies.length} · Подвесов:{' '}
                    {composition.suspensions.length} · {fmtDate(updatedAt)}
                  </div>
                </div>
                <div style={{ display: 'inline-flex', gap: 6 }}>
                  <button
                    type="button"
                    className="lfg-btn lfg-btn--sm"
                    onClick={() => {
                      onOpen(composition.id);
                      onClose();
                    }}
                  >
                    Открыть
                  </button>
                  <button
                    type="button"
                    className="lfg-btn lfg-btn--danger lfg-btn--sm"
                    onClick={() => onDelete(composition.id)}
                  >
                    Удалить
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
