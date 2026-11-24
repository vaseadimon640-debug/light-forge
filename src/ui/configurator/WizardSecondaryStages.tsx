'use client';

import { productTypes, type Project } from '@/domain/project';
import { CheckIcon, ExternalLinkIcon, FilePdfIcon, LayersIcon } from '../icons';
import { orderedPhotos } from '../quick-rfq/helpers';
import type { WizardStepId } from './wizardState';

type StageVisualAsideProps = {
  project: Project;
  photoUrls: Record<string, string>;
  extraNote?: string;
};

function StageVisualAside({ project, photoUrls, extraNote }: StageVisualAsideProps) {
  const photos = orderedPhotos(project);
  const primary = photos.find((p) => p.id === project.primaryPhotoId) ?? photos[0];
  const url = primary ? photoUrls[primary.id] : undefined;

  return (
    <aside className="lfw-visual-aside">
      <div className="lfw-visual-aside-img">
        {url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={url} alt={primary?.name ?? project.name} />
        ) : (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--atelier-muted)', fontSize: 13 }}>
            Фотография светильника не загружена — можно вернуться на шаг 1 в любой момент.
          </div>
        )}
      </div>
      <div className="lfw-visual-aside-meta">
        <strong>{project.name}</strong>
        <span className="lf-field-hint">
          {productTypes[project.kind][0]} · Элементов: {project.components.length} · Заказ:{' '}
          {project.orderQuantity} шт.
        </span>
        {extraNote && <span className="lf-field-hint">{extraNote}</span>}
      </div>
    </aside>
  );
}

// =============================================================================
// STAGE 5 — QUANTITY & INSTALLATION (Standard / Advanced Project)
// =============================================================================

type InstallationStageProps = {
  project: Project;
  photoUrls: Record<string, string>;
  mode: 'standard' | 'advanced';
  onModeChange: (next: 'standard' | 'advanced') => void;
  onUpdateProject: (mutator: (p: Project) => Project, touchedKey?: string) => void;
  onBack: () => void;
  onNext: () => void;
};

export function InstallationStage({
  project,
  photoUrls,
  mode,
  onModeChange,
  onUpdateProject,
  onBack,
  onNext,
}: InstallationStageProps) {
  function updateSiteMm(field: 'ceilingFromFloorMm' | 'tabletopFromFloorMm', raw: string) {
    const trimmed = raw.trim().replace(',', '.');
    onUpdateProject((p) => {
      const nextMounting = { ...p.mounting };
      if (!trimmed) {
        delete nextMounting[field];
      } else {
        const val = Number(trimmed);
        if (Number.isFinite(val) && val >= 0 && val <= 1_000_000) {
          nextMounting[field] = { value: val, source: 'user' };
        }
      }
      return { ...p, mounting: nextMounting };
    }, `mount:${field}`);
  }

  return (
    <section aria-labelledby="lfw-stage5-title">
      <div className="lfw-stage-head" style={{ marginBottom: 18 }}>
        <div>
          <h1 id="lfw-stage5-title">Количество и монтаж</h1>
          <p>Для обычной люстры достаточно стандартного режима; для сложных композиций включите Advanced Project.</p>
        </div>
        <div role="group" aria-label="Режим монтажа" className="lf-segment">
          <button
            id="lfw-install-standard"
            type="button"
            className="lf-segment-btn"
            aria-pressed={mode === 'standard'}
            onClick={() => onModeChange('standard')}
          >
            Standard
          </button>
          <button
            id="lfw-install-advanced"
            type="button"
            className="lf-segment-btn"
            aria-pressed={mode === 'advanced'}
            onClick={() => onModeChange('advanced')}
          >
            Advanced Project
          </button>
        </div>
      </div>

      <div className="lfw-split">
        <StageVisualAside project={project} photoUrls={photoUrls} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="lfw-panel">
            <h2>Заказ и требования</h2>
            <div className="lfw-grid-2">
              <div className="lfw-field">
                <label htmlFor="lfw-order-qty">Количество изделий (шт.)</label>
                <input
                  id="lfw-order-qty"
                  type="number"
                  min={1}
                  max={1000000}
                  value={project.orderQuantity}
                  onChange={(e) => {
                    const qty = Math.max(1, Number.parseInt(e.target.value, 10) || 1);
                    onUpdateProject((p) => ({ ...p, orderQuantity: qty }), 'orderQuantity');
                  }}
                />
              </div>
              <div className="lfw-field">
                <label htmlFor="lfw-currency">Валюта запроса</label>
                <select
                  id="lfw-currency"
                  value={project.currency}
                  onChange={(e) =>
                    onUpdateProject((p) => ({
                      ...p,
                      currency: e.target.value as Project['currency'],
                    }))
                  }
                >
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="CNY">CNY</option>
                </select>
              </div>
            </div>

            {mode === 'advanced' && (
              <>
                <h2>Инженерные уровни помещения (мм)</h2>
                <div className="lfw-grid-2">
                  <div className="lfw-field">
                    <label htmlFor="lfw-ceiling-mm">Высота потолка от пола (мм)</label>
                    <input
                      id="lfw-ceiling-mm"
                      type="number"
                      min={0}
                      placeholder="Неизвестно"
                      value={
                        project.mounting.ceilingFromFloorMm
                          ? String(project.mounting.ceilingFromFloorMm.value)
                          : ''
                      }
                      onChange={(e) => updateSiteMm('ceilingFromFloorMm', e.target.value)}
                    />
                  </div>
                  <div className="lfw-field">
                    <label htmlFor="lfw-tabletop-mm">Высота столешницы от пола (мм)</label>
                    <input
                      id="lfw-tabletop-mm"
                      type="number"
                      min={0}
                      placeholder="Неизвестно (длина ремней не фиксируется)"
                      value={
                        project.mounting.tabletopFromFloorMm
                          ? String(project.mounting.tabletopFromFloorMm.value)
                          : ''
                      }
                      onChange={(e) => updateSiteMm('tabletopFromFloorMm', e.target.value)}
                    />
                  </div>
                </div>
                {!project.mounting.tabletopFromFloorMm && (
                  <p className="lf-field-hint" style={{ margin: 0 }}>
                    Высота стола не задана — итоговая длина тросов и ремней останется неопределённой до замера площадки.
                  </p>
                )}
              </>
            )}

            <div className="lfw-field">
              <label htmlFor="lfw-notes">Дополнительные требования к монтажу, подвесу и упаковке</label>
              <textarea
                id="lfw-notes"
                placeholder="Например: тип подвеса, потолочное основание, ориентировочная длина подвеса, упаковка для авиадоставки…"
                value={project.notes}
                onChange={(e) => onUpdateProject((p) => ({ ...p, notes: e.target.value }))}
              />
            </div>
          </div>

          <div className="lfw-footer-nav">
            <button type="button" className="lf-btn lf-btn--subtle" onClick={onBack}>
              ← Назад к светотехнике
            </button>
            <button id="lfw-to-review-btn" type="button" className="lf-btn lf-btn--primary" onClick={onNext}>
              Перейти к 3D и запросу фабрике →
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

// =============================================================================
// STAGE 6 — 3D & MANUFACTURING RFQ HANDOFF
// =============================================================================

type ReviewStageProps = {
  project: Project;
  photoUrls: Record<string, string>;
  saving: boolean;
  onSaveProject: () => Promise<void>;
  onJumpStep: (step: WizardStepId) => void;
  onBack: () => void;
};

export function Review3DStage({
  project,
  photoUrls,
  saving,
  onSaveProject,
  onJumpStep,
  onBack,
}: ReviewStageProps) {
  const totalDims = project.components.reduce((acc, c) => acc + Object.keys(c.dimensions).length, 0);
  const totalMats = project.components.reduce((acc, c) => acc + c.materials.length, 0);
  const linkSuffix = `?rfqProject=${encodeURIComponent(project.id)}`;

  return (
    <section aria-labelledby="lfw-stage6-title">
      <div className="lfw-stage-head" style={{ marginBottom: 18 }}>
        <div>
          <h1 id="lfw-stage6-title">Проверка, 3D и запрос фабрике</h1>
          <p>
            Все разделы LIGHT FORGE используют единый канонический проект — данные синхронизированы с 3D Studio, Документами и PDF.
          </p>
        </div>
        <button
          id="lfw-final-save-btn"
          type="button"
          className="lf-btn lf-btn--primary"
          disabled={saving}
          onClick={() => void onSaveProject()}
        >
          <CheckIcon size={15} /> {saving ? 'Сохраняем…' : 'Сохранить проект'}
        </button>
      </div>

      <div className="lfw-split">
        <StageVisualAside project={project} photoUrls={photoUrls} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="lfw-panel">
            <h2>Сводка единого проекта</h2>
            <div className="lfw-summary-kpis">
              <div className="lfw-kpi">
                <strong>{project.components.length}</strong>
                <span>Компонентов</span>
              </div>
              <div className="lfw-kpi">
                <strong>{totalDims}</strong>
                <span>Размеров (мм)</span>
              </div>
              <div className="lfw-kpi">
                <strong>{totalMats}</strong>
                <span>Материалов</span>
              </div>
              <div className="lfw-kpi">
                <strong>{project.photos.length}</strong>
                <span>Оригиналов фото</span>
              </div>
            </div>

            <div className="lfw-status-row">
              <span>Strict Materials (без замен без письменного согласия)</span>
              <span className={`lf-badge ${project.strictMaterials ? 'lf-badge--documentation' : 'lf-badge--unknown'}`}>
                {project.strictMaterials ? 'ВКЛ' : 'ВЫКЛ'}
              </span>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 4 }}>
              <a
                id="lfw-open-documents-link"
                href={`/documents${linkSuffix}`}
                className="lf-btn lf-btn--primary"
              >
                <FilePdfIcon size={15} /> Выпустить Detailed RFQ PDF (EN / 中文)
              </a>
              <a
                id="lfw-open-3d-link"
                href={`/geometry${linkSuffix}`}
                className="lf-btn lf-btn--subtle"
              >
                <LayersIcon size={15} /> Открыть в 3D Studio
              </a>
              <a
                id="lfw-open-quick-rfq-link"
                href={`/${linkSuffix}`}
                className="lf-btn lf-btn--subtle"
              >
                <ExternalLinkIcon size={15} /> Открыть таблицу Quick RFQ
              </a>
            </div>
          </div>

          <div className="lfw-footer-nav">
            <button type="button" className="lf-btn lf-btn--subtle" onClick={onBack}>
              ← Назад к монтажу
            </button>
            <button
              type="button"
              className="lf-btn lf-btn--subtle"
              onClick={() => onJumpStep('upload')}
            >
              Вернуться к загрузке
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
