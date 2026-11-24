'use client';

import { useState } from 'react';
import {
  dimmingModes,
  directions,
  finishes,
  ipRatings,
  materials,
  productTypes,
  type Component,
  type Material,
  type Project,
} from '@/domain/project';
import { CheckIcon, ExternalLinkIcon, FilePdfIcon, LayersIcon, ShieldIcon } from '../icons';
import { orderedPhotos } from '../quick-rfq/helpers';
import type { WizardStepId } from './wizardState';

const materialKeys = Object.keys(materials) as Material['material'][];
const finishKeys = Object.keys(finishes) as NonNullable<Material['finish']>[];
const directionKeys = Object.keys(directions) as NonNullable<Component['light']['directionId']>[];

const finishSwatches: Record<NonNullable<Material['finish']>, string> = {
  naturalSatinBrass: '#c7a45d',
  brushedBrass: '#b89143',
  polishedBrass: '#dfbe70',
  antiqueBrass: '#8a6b35',
  burnishedBrass: '#5c4627',
  brushedBronze: '#6f533b',
  polishedChrome: '#d7dde0',
  satinNickel: '#b7bdc0',
  matteBlack: '#27292b',
  glossyBlack: '#121315',
  white: '#f4f3ef',
  custom: '#9d9589',
};

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
// STAGE 3 — MATERIALS & FINISHES
// =============================================================================

type MaterialsStageProps = {
  project: Project;
  photoUrls: Record<string, string>;
  onUpdateProject: (mutator: (p: Project) => Project, touchedKey?: string) => void;
  onBack: () => void;
  onNext: () => void;
};

const STANDARD_PARTS = [
  'Корпус / Body',
  'Подвесы / Suspension',
  'Декоративные элементы / Trim',
  'Рассеиватель / Diffuser',
  'Потолочное основание / Canopy',
];

export function MaterialsStage({
  project,
  photoUrls,
  onUpdateProject,
  onBack,
  onNext,
}: MaterialsStageProps) {
  const comp = project.components[0];
  const [selectedPart, setSelectedPart] = useState(
    comp.materials[0]?.part ?? STANDARD_PARTS[0],
  );

  const activeEntry = comp.materials.find(
    (m) => m.part.trim().toLowerCase() === selectedPart.trim().toLowerCase(),
  );

  function upsertMaterial(patch: Partial<Material>) {
    onUpdateProject((p) => ({
      ...p,
      components: p.components.map((item, idx) => {
        if (idx !== 0) return item;
        const foundIdx = item.materials.findIndex(
          (m) => m.part.trim().toLowerCase() === selectedPart.trim().toLowerCase(),
        );
        const base: Material =
          foundIdx >= 0
            ? item.materials[foundIdx]
            : { id: crypto.randomUUID(), part: selectedPart, material: 'solidBrass' };
        const nextEntry: Material = { ...base, ...patch };
        const nextList =
          foundIdx >= 0
            ? item.materials.map((m, i) => (i === foundIdx ? nextEntry : m))
            : [...item.materials, nextEntry];
        return { ...item, materials: nextList };
      }),
    }), `mat:${selectedPart}`);
  }

  return (
    <section aria-labelledby="lfw-stage3-title">
      <div className="lfw-stage-head" style={{ marginBottom: 18 }}>
        <div>
          <h1 id="lfw-stage3-title">Материалы и отделка</h1>
          <p>Материал, отделка и цвет задаются раздельными полями для каждой детали конструкции.</p>
        </div>
      </div>

      <div className="lfw-split">
        <StageVisualAside
          project={project}
          photoUrls={photoUrls}
          extraNote={`Назначено материалов: ${comp.materials.length}`}
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="lfw-panel">
            <h2>1. Выберите деталь конструкции</h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {STANDARD_PARTS.map((part) => (
                <button
                  key={part}
                  type="button"
                  className={`lf-btn lf-btn--sm${selectedPart === part ? ' lf-btn--primary' : ' lf-btn--subtle'}`}
                  onClick={() => setSelectedPart(part)}
                >
                  {part.split(' / ')[0]}
                </button>
              ))}
            </div>

            <h2>2. Основной материал ({selectedPart.split(' / ')[0]})</h2>
            <div className="lfw-field">
              <label htmlFor="lfw-material-select">Материал детали</label>
              <select
                id="lfw-material-select"
                value={activeEntry?.material ?? 'solidBrass'}
                onChange={(e) =>
                  upsertMaterial({ material: e.target.value as Material['material'] })
                }
              >
                {materialKeys.map((k) => (
                  <option key={k} value={k}>
                    {materials[k][0]} ({materials[k][1]})
                  </option>
                ))}
              </select>
            </div>

            <h2>3. Визуальная отделка (Finish)</h2>
            <div className="lfw-swatch-grid">
              {finishKeys.map((fk) => (
                <button
                  key={fk}
                  type="button"
                  className="lfw-swatch-btn"
                  aria-pressed={activeEntry?.finish === fk}
                  onClick={() => upsertMaterial({ finish: fk })}
                >
                  <span
                    className="lfw-swatch-dot"
                    style={{ background: finishSwatches[fk] }}
                    aria-hidden="true"
                  />
                  <span>{finishes[fk][0]}</span>
                </button>
              ))}
            </div>

            <div className="lfw-field">
              <label htmlFor="lfw-material-color">Цвет / RAL / образец (отдельное поле)</label>
              <input
                id="lfw-material-color"
                type="text"
                placeholder="Например, Тёплая латунь / RAL 9005 / по образцу"
                value={activeEntry?.color ?? ''}
                onChange={(e) => upsertMaterial({ color: e.target.value || undefined })}
              />
            </div>

            <label className="lfw-strict-box">
              <input
                id="lfw-strict-materials-toggle"
                type="checkbox"
                checked={project.strictMaterials}
                onChange={(e) =>
                  onUpdateProject((p) => ({ ...p, strictMaterials: e.target.checked }))
                }
              />
              <div>
                <strong>
                  <ShieldIcon size={14} /> NO MATERIAL SUBSTITUTIONS (Strict Materials)
                </strong>
                <span>
                  Натуральную кожу не заменять искусственной. Настоящую латунь (Solid Brass) не заменять сталью с покрытием без письменного согласия.
                </span>
              </div>
            </label>
          </div>

          <div className="lfw-footer-nav">
            <button type="button" className="lf-btn lf-btn--subtle" onClick={onBack}>
              ← Назад к размерам
            </button>
            <button id="lfw-to-lighting-btn" type="button" className="lf-btn lf-btn--primary" onClick={onNext}>
              Продолжить к светотехнике →
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

// =============================================================================
// STAGE 4 — LIGHTING & ELECTRICAL
// =============================================================================

type LightingStageProps = {
  project: Project;
  photoUrls: Record<string, string>;
  onUpdateProject: (mutator: (p: Project) => Project, touchedKey?: string) => void;
  onBack: () => void;
  onNext: () => void;
};

export function LightingStage({
  project,
  photoUrls,
  onUpdateProject,
  onBack,
  onNext,
}: LightingStageProps) {
  const comp = project.components[0];

  function updateMetric(key: 'cct' | 'cri' | 'watts' | 'lumens', raw: string) {
    const trimmed = raw.trim().replace(',', '.');
    onUpdateProject((p) => ({
      ...p,
      components: p.components.map((item, idx) => {
        if (idx !== 0) return item;
        const nextLight = { ...item.light };
        if (!trimmed) {
          delete nextLight[key];
        } else {
          const val = Number(trimmed);
          if (Number.isFinite(val)) {
            nextLight[key] = { value: key === 'cct' ? Math.round(val) : val, source: 'user' };
          }
        }
        return { ...item, light: nextLight };
      }),
    }), `light:${key}`);
  }

  return (
    <section aria-labelledby="lfw-stage4-title">
      <div className="lfw-stage-head" style={{ marginBottom: 18 }}>
        <div>
          <h1 id="lfw-stage4-title">Свет и электрические характеристики</h1>
          <p>Неизвестные параметры оставляйте пустыми — фабрика подтвердит их в коммерческом предложении.</p>
        </div>
      </div>

      <div className="lfw-split">
        <StageVisualAside project={project} photoUrls={photoUrls} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="lfw-panel">
            <h2>Свет (Light)</h2>
            <div className="lfw-grid-2">
              <div className="lfw-field">
                <label htmlFor="lfw-light-cct">CCT (цветовая температура, K)</label>
                <input
                  id="lfw-light-cct"
                  type="number"
                  placeholder="Например, 3000"
                  value={comp.light.cct ? String(comp.light.cct.value) : ''}
                  onChange={(e) => updateMetric('cct', e.target.value)}
                />
              </div>
              <div className="lfw-field">
                <label htmlFor="lfw-light-cri">CRI (индекс цветопередачи)</label>
                <input
                  id="lfw-light-cri"
                  type="number"
                  placeholder="Например, 90"
                  value={comp.light.cri ? String(comp.light.cri.value) : ''}
                  onChange={(e) => updateMetric('cri', e.target.value)}
                />
              </div>
              <div className="lfw-field">
                <label htmlFor="lfw-light-watts">Мощность (Wattage, Вт)</label>
                <input
                  id="lfw-light-watts"
                  type="number"
                  placeholder="Unknown"
                  value={comp.light.watts ? String(comp.light.watts.value) : ''}
                  onChange={(e) => updateMetric('watts', e.target.value)}
                />
              </div>
              <div className="lfw-field">
                <label htmlFor="lfw-light-lumens">Световой поток (Lumens, лм)</label>
                <input
                  id="lfw-light-lumens"
                  type="number"
                  placeholder="Unknown"
                  value={comp.light.lumens ? String(comp.light.lumens.value) : ''}
                  onChange={(e) => updateMetric('lumens', e.target.value)}
                />
              </div>
            </div>

            <div className="lfw-field">
              <label htmlFor="lfw-light-dir">Направление света</label>
              <select
                id="lfw-light-dir"
                value={comp.light.directionId ?? ''}
                onChange={(e) =>
                  onUpdateProject((p) => ({
                    ...p,
                    components: p.components.map((item, idx) =>
                      idx === 0
                        ? {
                            ...item,
                            light: {
                              ...item.light,
                              directionId: (e.target.value || undefined) as Component['light']['directionId'],
                            },
                          }
                        : item,
                    ),
                  }), 'light:dir')
                }
              >
                <option value="">На подтверждение фабрике</option>
                {directionKeys.map((dk) => (
                  <option key={dk} value={dk}>
                    {directions[dk][0]} ({directions[dk][1]})
                  </option>
                ))}
              </select>
            </div>

            <h2>Электрика (Electrical)</h2>
            <div className="lfw-grid-2">
              <div className="lfw-field">
                <label htmlFor="lfw-elec-dimming">Диммирование (Dimming)</label>
                <select
                  id="lfw-elec-dimming"
                  value={comp.light.dimming ?? ''}
                  onChange={(e) =>
                    onUpdateProject((p) => ({
                      ...p,
                      components: p.components.map((item, idx) =>
                        idx === 0
                          ? {
                              ...item,
                              light: {
                                ...item.light,
                                dimming: (e.target.value || undefined) as Component['light']['dimming'],
                              },
                            }
                          : item,
                      ),
                    }), 'light:dimming')
                  }
                >
                  <option value="">На подтверждение фабрике</option>
                  {dimmingModes.map((dm) => (
                    <option key={dm} value={dm}>
                      {dm}
                    </option>
                  ))}
                </select>
              </div>
              <div className="lfw-field">
                <label htmlFor="lfw-elec-ip">Степень защиты (IP Rating)</label>
                <select
                  id="lfw-elec-ip"
                  value={comp.light.ip ?? ''}
                  onChange={(e) =>
                    onUpdateProject((p) => ({
                      ...p,
                      components: p.components.map((item, idx) =>
                        idx === 0
                          ? {
                              ...item,
                              light: {
                                ...item.light,
                                ip: (e.target.value || undefined) as Component['light']['ip'],
                              },
                            }
                          : item,
                      ),
                    }), 'light:ip')
                  }
                >
                  <option value="">На подтверждение фабрике</option>
                  {ipRatings.map((ip) => (
                    <option key={ip} value={ip}>
                      {ip}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="lfw-footer-nav">
            <button type="button" className="lf-btn lf-btn--subtle" onClick={onBack}>
              ← Назад к материалам
            </button>
            <button id="lfw-to-install-btn" type="button" className="lf-btn lf-btn--primary" onClick={onNext}>
              Продолжить →
            </button>
          </div>
        </div>
      </div>
    </section>
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
