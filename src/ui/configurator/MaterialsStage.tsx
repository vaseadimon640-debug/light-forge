'use client';

import { useMemo, useState } from 'react';
import type { GeminiPhotoAnalysis } from '@/ai/gemini-contract';
import {
  FINISH_VISUALS,
  MATERIAL_VISUALS,
  RAL_QUICK_CHIPS,
  suggestMaterialsFromAiPhoto,
  type MaterialCategory,
} from '@/domain/material-library';
import {
  finishes,
  materials,
  productTypes,
  type Material,
  type Project,
} from '@/domain/project';
import { CheckIcon, PlusIcon, ShieldIcon, SparkIcon, TrashIcon } from '../icons';
import { orderedPhotos } from '../quick-rfq/helpers';

type MaterialsStageProps = {
  project: Project;
  photoUrls: Record<string, string>;
  aiPhoto: GeminiPhotoAnalysis | null;
  onUpdateProject: (mutator: (p: Project) => Project, touchedKey?: string) => void;
  onBack: () => void;
  onNext: () => void;
};

const STANDARD_PARTS = [
  { id: 'Корпус / Body', shortRu: 'Корпус', role: 'body' as const },
  { id: 'Подвесы / Suspension', shortRu: 'Подвесы', role: 'suspension' as const },
  { id: 'Декоративные элементы / Trim', shortRu: 'Декор', role: 'trim' as const },
  { id: 'Рассеиватель / Diffuser', shortRu: 'Рассеиватель', role: 'diffuser' as const },
  { id: 'Потолочное основание / Canopy', shortRu: 'Основание', role: 'canopy' as const },
];

const CATEGORY_TABS: Array<{ id: 'all' | MaterialCategory; labelRu: string }> = [
  { id: 'all', labelRu: 'Все материалы' },
  { id: 'metals', labelRu: 'Металлы' },
  { id: 'optics', labelRu: 'Стекло и оптика' },
  { id: 'natural', labelRu: 'Кожа и натуральные' },
  { id: 'other', labelRu: 'Прочее' },
];

function partMatches(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function MaterialsStage({
  project,
  photoUrls,
  aiPhoto,
  onUpdateProject,
  onBack,
  onNext,
}: MaterialsStageProps) {
  const [activeCompIdx, setActiveCompIdx] = useState(0);
  const [applyToAllComponents, setApplyToAllComponents] = useState(
    project.components.length > 1,
  );
  const [categoryFilter, setCategoryFilter] = useState<'all' | MaterialCategory>('all');
  const [customPartDraft, setCustomPartDraft] = useState('');

  const safeIdx = Math.min(activeCompIdx, Math.max(0, project.components.length - 1));
  const comp = project.components[safeIdx];

  // Combine standard parts with any existing custom parts on the active component (e.g. MYLINE Arc body / Suspension strap)
  const partList = useMemo(() => {
    const existing = comp.materials.map((m) => m.part);
    const list: Array<{ id: string; shortRu: string }> = [];
    for (const ex of existing) {
      list.push({ id: ex, shortRu: ex.split(' / ')[0] });
    }
    for (const sp of STANDARD_PARTS) {
      if (!list.some((item) => partMatches(item.id, sp.id))) {
        list.push({ id: sp.id, shortRu: sp.shortRu });
      }
    }
    return list;
  }, [comp.materials]);

  const [selectedPart, setSelectedPart] = useState<string>(
    comp.materials[0]?.part ?? STANDARD_PARTS[0].id,
  );

  // Ensure selectedPart stays valid when switching components
  const effectiveSelectedPart = partList.some((p) => partMatches(p.id, selectedPart))
    ? selectedPart
    : partList[0]?.id ?? STANDARD_PARTS[0].id;

  const activeEntry = comp.materials.find((m) => partMatches(m.part, effectiveSelectedPart));

  const aiSuggestion = useMemo(() => suggestMaterialsFromAiPhoto(aiPhoto), [aiPhoto]);

  const visibleMaterials = useMemo(() => {
    if (categoryFilter === 'all') return MATERIAL_VISUALS;
    return MATERIAL_VISUALS.filter((item) => item.category === categoryFilter);
  }, [categoryFilter]);

  const orderedFinishes = useMemo(() => {
    if (!aiSuggestion || aiSuggestion.suggestedFinishes.length === 0) return FINISH_VISUALS;
    const suggestedSet = new Set(aiSuggestion.suggestedFinishes);
    return [
      ...FINISH_VISUALS.filter((f) => suggestedSet.has(f.key)),
      ...FINISH_VISUALS.filter((f) => !suggestedSet.has(f.key)),
    ];
  }, [aiSuggestion]);

  function upsertMaterialForTarget(
    partName: string,
    patch: Partial<Material>,
    forceAll = applyToAllComponents,
  ) {
    onUpdateProject((p) => ({
      ...p,
      components: p.components.map((item, idx) => {
        if (!forceAll && idx !== safeIdx) return item;
        const foundIdx = item.materials.findIndex((m) => partMatches(m.part, partName));
        const base: Material =
          foundIdx >= 0
            ? item.materials[foundIdx]
            : { id: crypto.randomUUID(), part: partName, material: 'solidBrass' };
        const nextEntry: Material = { ...base, ...patch };
        const nextList =
          foundIdx >= 0
            ? item.materials.map((m, i) => (i === foundIdx ? nextEntry : m))
            : [...item.materials, nextEntry];
        return { ...item, materials: nextList };
      }),
    }), `mat:${partName}`);
  }

  function removeMaterialPart(partName: string) {
    onUpdateProject((p) => ({
      ...p,
      components: p.components.map((item, idx) => {
        if (!applyToAllComponents && idx !== safeIdx) return item;
        return {
          ...item,
          materials: item.materials.filter((m) => !partMatches(m.part, partName)),
        };
      }),
    }), `mat:remove:${partName}`);
  }

  function handleApplyAiPalette() {
    if (!aiSuggestion) return;
    onUpdateProject((p) => ({
      ...p,
      components: p.components.map((item, idx) => {
        if (!applyToAllComponents && idx !== safeIdx) return item;
        let nextMaterials = [...item.materials];

        const upsert = (partLabel: string, patch: Partial<Material> & { material: Material['material'] }) => {
          const i = nextMaterials.findIndex((m) => partMatches(m.part, partLabel));
          if (i >= 0) {
            nextMaterials[i] = { ...nextMaterials[i], ...patch };
          } else {
            nextMaterials = [
              ...nextMaterials,
              { id: crypto.randomUUID(), part: partLabel, ...patch },
            ];
          }
        };

        if (aiSuggestion.bodyMaterial) {
          const bodyPart =
            nextMaterials.find((m) => /корпус|body|arc/i.test(m.part))?.part ?? STANDARD_PARTS[0].id;
          upsert(bodyPart, {
            material: aiSuggestion.bodyMaterial,
            finish: aiSuggestion.suggestedFinishes[0],
            color: aiSuggestion.colorHint,
          });
        }
        if (aiSuggestion.suspensionMaterial) {
          const suspPart =
            nextMaterials.find((m) => /подвес|strap|susp/i.test(m.part))?.part ?? STANDARD_PARTS[1].id;
          upsert(suspPart, { material: aiSuggestion.suspensionMaterial });
        }
        if (aiSuggestion.diffuserMaterial) {
          const diffPart =
            nextMaterials.find((m) => /рассеив|diffus/i.test(m.part))?.part ?? STANDARD_PARTS[3].id;
          upsert(diffPart, { material: aiSuggestion.diffuserMaterial });
        }

        return { ...item, materials: nextMaterials };
      }),
    }), 'mat:ai-palette');
  }

  function handleAddCustomPart() {
    const clean = customPartDraft.trim();
    if (!clean) return;
    upsertMaterialForTarget(clean, { material: 'solidBrass' });
    setSelectedPart(clean);
    setCustomPartDraft('');
  }

  const photos = orderedPhotos(project);
  const primary = photos.find((p) => p.id === project.primaryPhotoId) ?? photos[0];
  const primaryUrl = primary ? photoUrls[primary.id] : undefined;

  const activeMaterialSpec = MATERIAL_VISUALS.find(
    (m) => m.key === (activeEntry?.material ?? 'solidBrass'),
  );
  const activeFinishSpec = FINISH_VISUALS.find((f) => f.key === activeEntry?.finish);

  return (
    <section aria-labelledby="lfw-stage3-title">
      <div className="lfw-stage-head" style={{ marginBottom: 18 }}>
        <div>
          <h1 id="lfw-stage3-title">Материалы и отделка</h1>
          <p>
            Материал детали, отделка (Finish) и цвет/RAL хранятся раздельными полями для каждой части конструкции.
          </p>
        </div>
      </div>

      <div className="lfw-split">
        <aside className="lfw-visual-aside">
          <div className="lfw-visual-aside-img">
            {primaryUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={primaryUrl} alt={primary?.name ?? project.name} />
            ) : (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--atelier-muted)', fontSize: 13 }}>
                Фотография не загружена — можно выбрать материалы вручную по библиотеке образцов.
              </div>
            )}
          </div>
          <div className="lfw-visual-aside-meta">
            <strong>{project.name}</strong>
            <span className="lf-field-hint">
              {productTypes[project.kind][0]} · Компонентов: {project.components.length}
            </span>

            {/* Live Assigned Parts Material Summary */}
            <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
              <span style={{ fontSize: 11.5, fontWeight: 650, color: 'var(--ink-secondary)' }}>
                Назначенные материалы ({comp.name}):
              </span>
              {comp.materials.length === 0 ? (
                <span className="lf-field-hint">
                  Пока не назначены — выберите деталь справа или примените палитру AI.
                </span>
              ) : (
                comp.materials.map((entry) => {
                  const matVis = MATERIAL_VISUALS.find((m) => m.key === entry.material);
                  const finVis = FINISH_VISUALS.find((f) => f.key === entry.finish);
                  return (
                    <div
                      key={entry.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '6px 8px',
                        borderRadius: 8,
                        border: partMatches(entry.part, effectiveSelectedPart)
                          ? '1px solid var(--brass)'
                          : '1px solid var(--atelier-edge)',
                        background: 'var(--bg-subtle)',
                      }}
                    >
                      <span
                        className="lfw-swatch-dot"
                        style={{ background: finVis?.swatchCss ?? matVis?.swatchCss ?? '#b89143' }}
                        aria-hidden="true"
                      />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {entry.part.split(' / ')[0]}
                        </div>
                        <div className="lf-field-hint" style={{ fontSize: 11 }}>
                          {materials[entry.material][0]}
                          {entry.finish ? ` · ${finishes[entry.finish][0]}` : ''}
                          {entry.color ? ` · ${entry.color}` : ''}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="lf-btn lf-btn--sm lf-btn--subtle"
                        aria-label={`Удалить материал для ${entry.part}`}
                        onClick={() => removeMaterialPart(entry.part)}
                        style={{ padding: '4px 6px' }}
                      >
                        <TrashIcon size={12} />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </aside>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* AI Visual Palette Pre-Selection Banner */}
          {aiSuggestion && (
            <div id="lfw-ai-palette-banner" className="lfw-panel" style={{ borderColor: 'var(--brass-border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <SparkIcon size={16} />
                  <strong>{aiSuggestion.headlineRu}</strong>
                  <span className="lf-badge lf-badge--estimated">ESTIMATED · НЕ ПОДТВЕРЖДЕНО</span>
                </div>
                <button
                  id="lfw-apply-ai-palette-btn"
                  type="button"
                  className="lf-btn lf-btn--sm lf-btn--primary"
                  onClick={handleApplyAiPalette}
                >
                  Применить палитру AI
                </button>
              </div>
              <p className="lf-field-hint" style={{ margin: 0 }}>{aiSuggestion.detailRu}</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {aiSuggestion.bodyMaterial && (
                  <span className="lf-badge">
                    Корпус (оценка): {materials[aiSuggestion.bodyMaterial][0]}
                  </span>
                )}
                {aiSuggestion.suggestedFinishes.slice(0, 3).map((fk) => (
                  <span key={fk} className="lf-badge">
                    Отделка: {finishes[fk][0]}
                  </span>
                ))}
                {aiSuggestion.suspensionMaterial && (
                  <span className="lf-badge">
                    Подвесы (оценка): {materials[aiSuggestion.suspensionMaterial][0]}
                  </span>
                )}
                {aiSuggestion.diffuserMaterial && (
                  <span className="lf-badge">
                    Рассеиватель: {materials[aiSuggestion.diffuserMaterial][0]}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Component switcher for multi-component assemblies (e.g. MYLINE Large + Small arc) */}
          {project.components.length > 1 && (
            <div className="lfw-panel" style={{ padding: '14px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-secondary)' }}>
                    Компонент:
                  </span>
                  {project.components.map((c, idx) => (
                    <button
                      key={c.id}
                      type="button"
                      className={`lf-btn lf-btn--sm${idx === safeIdx ? ' lf-btn--primary' : ' lf-btn--subtle'}`}
                      onClick={() => setActiveCompIdx(idx)}
                    >
                      {c.name} ×{c.quantity}
                    </button>
                  ))}
                </div>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, cursor: 'pointer' }}>
                  <input
                    id="lfw-apply-all-components"
                    type="checkbox"
                    checked={applyToAllComponents}
                    onChange={(e) => setApplyToAllComponents(e.target.checked)}
                  />
                  Применять правки ко всем компонентам
                </label>
              </div>
            </div>
          )}

          {/* Part Selection & Material Cards */}
          <div className="lfw-panel">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <h2>1. Деталь конструкции</h2>
              <span className="lf-field-hint">
                Активна: <strong>{effectiveSelectedPart.split(' / ')[0]}</strong>
              </span>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {partList.map((part) => {
                const assigned = comp.materials.find((m) => partMatches(m.part, part.id));
                const isSelected = partMatches(part.id, effectiveSelectedPart);
                return (
                  <button
                    key={part.id}
                    type="button"
                    data-part-id={part.id}
                    className={`lf-btn lf-btn--sm${isSelected ? ' lf-btn--primary' : ' lf-btn--subtle'}`}
                    onClick={() => setSelectedPart(part.id)}
                  >
                    {part.shortRu}
                    {assigned ? ' ✓' : ''}
                  </button>
                );
              })}
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input
                type="text"
                placeholder="Добавить свою деталь (например, Крепёжная обойма)"
                value={customPartDraft}
                onChange={(e) => setCustomPartDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddCustomPart();
                  }
                }}
                style={{
                  flex: '1 1 220px',
                  minHeight: 34,
                  padding: '6px 10px',
                  borderRadius: 'var(--radius-xs)',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-surface)',
                  color: 'var(--ink-primary)',
                  fontSize: 13,
                }}
              />
              <button
                type="button"
                className="lf-btn lf-btn--sm lf-btn--subtle"
                onClick={handleAddCustomPart}
                disabled={!customPartDraft.trim()}
              >
                <PlusIcon size={12} /> Добавить деталь
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
              <h2>2. Основной материал ({effectiveSelectedPart.split(' / ')[0]})</h2>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {CATEGORY_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    className={`lf-btn lf-btn--sm${categoryFilter === tab.id ? ' lf-btn--primary' : ' lf-btn--subtle'}`}
                    onClick={() => setCategoryFilter(tab.id)}
                  >
                    {tab.labelRu}
                  </button>
                ))}
              </div>
            </div>

            <div className="lfw-material-grid" role="group" aria-label="Выбор материала детали">
              {visibleMaterials.map((item) => {
                const isSelected = activeEntry?.material === item.key;
                const isAiMatch =
                  aiSuggestion?.bodyMaterial === item.key ||
                  aiSuggestion?.suspensionMaterial === item.key ||
                  aiSuggestion?.diffuserMaterial === item.key;
                return (
                  <button
                    key={item.key}
                    id={`lfw-mat-card-${item.key}`}
                    type="button"
                    className="lfw-material-card"
                    aria-pressed={isSelected}
                    onClick={() => upsertMaterialForTarget(effectiveSelectedPart, { material: item.key })}
                  >
                    <span
                      className="lfw-material-swatch"
                      style={{ background: item.swatchCss }}
                      aria-hidden="true"
                    />
                    <span className="lfw-material-body">
                      <strong>{materials[item.key][0]}</strong>
                      <small>{materials[item.key][1]} · {item.tagRu}</small>
                    </span>
                    {isAiMatch && (
                      <span className="lfw-ai-mini-pill" title="Предположение AI по фото (Estimated)">
                        AI
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {activeMaterialSpec?.strictNoteRu && (
              <div className="lfw-status-row" style={{ borderColor: 'var(--brass-border)', background: 'var(--brass-soft)' }}>
                <span style={{ fontSize: 12.5 }}>{activeMaterialSpec.strictNoteRu}</span>
                <span className="lf-badge">Самостоятельный материал</span>
              </div>
            )}

            <div className="lfw-field">
              <label htmlFor="lfw-material-detail">
                Уточнение материала (сплав, марка стали, толщина, сорт кожи — опционально)
              </label>
              <input
                id="lfw-material-detail"
                type="text"
                placeholder="Например, Solid brass C36000 толщина 3 мм / Full-grain vegetable-tanned leather"
                value={activeEntry?.materialDetail ?? ''}
                onChange={(e) =>
                  upsertMaterialForTarget(effectiveSelectedPart, {
                    materialDetail: e.target.value || undefined,
                  })
                }
              />
            </div>

            <h2>3. Визуальная отделка (Finish)</h2>
            <div className="lfw-finish-grid" role="group" aria-label="Выбор отделки поверхности">
              {orderedFinishes.map((fin) => {
                const isSelected = activeEntry?.finish === fin.key;
                const isAiSuggested = aiSuggestion?.suggestedFinishes.includes(fin.key) ?? false;
                return (
                  <button
                    key={fin.key}
                    id={`lfw-finish-card-${fin.key}`}
                    type="button"
                    className="lfw-finish-card"
                    aria-pressed={isSelected}
                    onClick={() => upsertMaterialForTarget(effectiveSelectedPart, { finish: fin.key })}
                  >
                    <span
                      className="lfw-finish-chip"
                      style={{ background: fin.swatchCss }}
                      aria-hidden="true"
                    />
                    <span className="lfw-material-body">
                      <strong>{finishes[fin.key][0]}</strong>
                      <small>{fin.shortHintRu}</small>
                    </span>
                    {isAiSuggested && (
                      <span className="lfw-ai-mini-pill" title="Палитра предложена AI по фото (Estimated)">
                        AI
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="lfw-grid-2">
              <div className="lfw-field">
                <label htmlFor="lfw-finish-detail">Уточнение отделки / защита (лак, патина, фактура)</label>
                <input
                  id="lfw-finish-detail"
                  type="text"
                  placeholder={activeFinishSpec ? `Например, ${activeFinishSpec.shortHintRu}, матовый защитный лак` : 'Опционально'}
                  value={activeEntry?.finishDetail ?? ''}
                  onChange={(e) =>
                    upsertMaterialForTarget(effectiveSelectedPart, {
                      finishDetail: e.target.value || undefined,
                    })
                  }
                />
              </div>
              <div className="lfw-field">
                <label htmlFor="lfw-material-color">Цвет / RAL / физический образец (отдельное поле)</label>
                <input
                  id="lfw-material-color"
                  type="text"
                  placeholder="Например, RAL 9005 / Тёплая латунь / Custom Sample"
                  value={activeEntry?.color ?? ''}
                  onChange={(e) =>
                    upsertMaterialForTarget(effectiveSelectedPart, {
                      color: e.target.value || undefined,
                    })
                  }
                />
              </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {RAL_QUICK_CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  className="lf-btn lf-btn--sm lf-btn--subtle"
                  onClick={() => upsertMaterialForTarget(effectiveSelectedPart, { color: chip })}
                >
                  {chip}
                </button>
              ))}
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
                  Обязательное условие в RFQ и PDF (EN + ZH): натуральную кожу не заменять на PU/PVC, настоящую латунь (Solid Brass) не заменять на сталь или алюминий с покрытием без письменного согласия.
                </span>
              </div>
            </label>
          </div>

          <div className="lfw-footer-nav">
            <button type="button" className="lf-btn lf-btn--subtle" onClick={onBack}>
              ← Назад к размерам
            </button>
            <button id="lfw-to-lighting-btn" type="button" className="lf-btn lf-btn--primary" onClick={onNext}>
              <CheckIcon size={15} /> Продолжить к светотехнике →
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
