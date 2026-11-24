'use client';

import { useMemo, useState } from 'react';
import { productTypes, type Placement, type Project } from '@/domain/project';
import { AlertIcon, CheckIcon, ChevronIcon, PlusIcon, TrashIcon } from '../icons';
import {
  addPlacementToProject,
  firstAvailableComponentForPlacement,
  orderedPhotos,
  parsePlainNumber,
  pruneExcessPlacements,
  remainingPlacementCapacity,
  validateProject,
} from '../quick-rfq/helpers';
import { MeasurementInput } from '../quick-rfq/MeasurementInput';
import {
  analyzeProjectMounting,
  appendNotePreset,
  INSTALLATION_NOTE_PRESETS,
  populateMissingPlacements,
  type MountingSummary,
} from './installationAnd3d';

type InstallationStageProps = {
  project: Project;
  photoUrls: Record<string, string>;
  mode: 'standard' | 'advanced';
  onModeChange: (next: 'standard' | 'advanced') => void;
  onUpdateProject: (mutator: (p: Project) => Project, touchedKey?: string) => void;
  onBack: () => void;
  onNext: () => void;
};

function ElevationDiagram({
  project,
  summary,
}: {
  project: Project;
  summary: MountingSummary;
}) {
  const ceiling = project.mounting.ceilingFromFloorMm?.value;
  const tabletop = project.mounting.tabletopFromFloorMm?.value;
  const maxPlacementTop = Math.max(
    1800,
    ...summary.placements.map((p) => (p.bottomFromFloorMm ?? (p.lowestAboveTabletopMm?.value ?? 900) + 750) + 600),
  );
  const scaleTop = Math.max(ceiling ?? 3200, maxPlacementTop, 2600);
  const viewH = 226;
  const padTop = 24;
  const padBottom = 28;
  const usable = viewH - padTop - padBottom;
  const yForMm = (mm: number) => padTop + usable * (1 - Math.max(0, Math.min(scaleTop, mm)) / scaleTop);

  const ceilingY = yForMm(ceiling ?? scaleTop);
  const floorY = yForMm(0);
  const visualTableMm = tabletop ?? Math.min(750, scaleTop * 0.22);
  const tableY = Math.min(floorY - 22, yForMm(visualTableMm));

  return (
    <div className="lfw-elev-box" aria-label="Схема монтажных уровней помещения">
      <div className="lfw-elev-head">
        <strong>Схема высот (мм)</strong>
        <span className="lf-field-hint">
          {tabletop !== undefined
            ? 'Уровни от чистового пола'
            : 'Столешница не задана — длины подвесов условны'}
        </span>
      </div>
      <svg viewBox="0 0 320 226" className="lfw-elev-svg" role="img" aria-label="Вертикальная схема уровней потолка, светильника и столешницы">
        {/* Ceiling */}
        <line x1="16" y1={ceilingY} x2="304" y2={ceilingY} stroke="var(--accent)" strokeWidth="2" />
        <text x="20" y={Math.max(14, ceilingY - 6)} className="lfw-elev-label">
          {ceiling !== undefined ? `Потолок · ${ceiling} мм` : 'Потолок · не задан'}
        </text>

        {/* Tabletop */}
        <line
          x1="44"
          y1={tableY}
          x2="276"
          y2={tableY}
          stroke={tabletop !== undefined ? 'var(--brass)' : 'var(--atelier-muted)'}
          strokeWidth="1.6"
          strokeDasharray={tabletop !== undefined ? undefined : '4 4'}
        />
        <text x="276" y={tableY + 12} textAnchor="end" className="lfw-elev-label lfw-elev-label--muted">
          {tabletop !== undefined ? `Стол · ${tabletop} мм` : 'Столешница · не задана'}
        </text>

        {/* Placements */}
        {summary.placements.slice(0, 6).map((item, idx, arr) => {
          const x = arr.length === 1 ? 160 : 62 + (idx / Math.max(1, arr.length - 1)) * 196;
          const approxBottom =
            item.bottomFromFloorMm ??
            (item.lowestAboveTabletopMm ? visualTableMm + item.lowestAboveTabletopMm.value : scaleTop * 0.55);
          const maxAllowedY =
            item.lowestAboveTabletopMm && item.lowestAboveTabletopMm.value > 0
              ? tableY - 24
              : floorY - 22;
          const py = Math.max(ceilingY + 16, Math.min(maxAllowedY, yForMm(approxBottom)));
          const color = item.conflict ? 'var(--danger)' : 'var(--brass)';
          return (
            <g key={item.placementId}>
              <line
                x1={x}
                y1={ceilingY}
                x2={x}
                y2={py - 6.5}
                stroke={color}
                strokeWidth="1.2"
                strokeDasharray={item.suspensionVerticalMm === undefined ? '3 3' : undefined}
              />
              <circle cx={x} cy={py} r="6.5" fill="var(--bg-surface)" stroke={color} strokeWidth="2" />
              <text x={x} y={py + 16} textAnchor="middle" className="lfw-elev-tag">
                #{idx + 1}
                {item.lowestAboveTabletopMm ? ` · ${item.lowestAboveTabletopMm.value}` : ''}
              </text>
            </g>
          );
        })}

        {/* Floor */}
        <line x1="16" y1={floorY} x2="304" y2={floorY} stroke="var(--border-strong)" strokeWidth="1.5" />
        <text x="20" y={floorY + 14} className="lfw-elev-label lfw-elev-label--muted">
          Чистовой пол · 0 мм
        </text>
      </svg>
    </div>
  );
}

export function InstallationStage({
  project,
  photoUrls,
  mode,
  onModeChange,
  onUpdateProject,
  onBack,
  onNext,
}: InstallationStageProps) {
  const [expandedCoords, setExpandedCoords] = useState<Record<string, boolean>>({});

  const summary = useMemo(() => analyzeProjectMounting(project), [project]);
  const issues = useMemo(() => validateProject(project), [project]);
  const photos = orderedPhotos(project);
  const primary = photos.find((p) => p.id === project.primaryPhotoId) ?? photos[0];
  const primaryUrl = primary ? photoUrls[primary.id] : undefined;

  const canAddPlacement = Boolean(firstAvailableComponentForPlacement(project));
  const totalOrderUnits = project.orderQuantity * summary.totalComponentUnits;

  function updateMounting(updater: (mounting: Project['mounting']) => Project['mounting'], key?: string) {
    onUpdateProject((p) => ({ ...p, mounting: updater(p.mounting) }), key);
  }

  function updatePlacement(id: string, updater: (placement: Placement) => Placement) {
    updateMounting(
      (current) => ({
        ...current,
        placements: current.placements.map((item) => (item.id === id ? updater(item) : item)),
      }),
      `placement:${id}`,
    );
  }

  function removePlacement(id: string) {
    updateMounting(
      (current) => ({
        ...current,
        placements: current.placements.filter((item) => item.id !== id),
      }),
      `placement:remove:${id}`,
    );
  }

  return (
    <section aria-labelledby="lfw-stage5-title">
      <div className="lfw-stage-head" style={{ marginBottom: 18 }}>
        <div>
          <h1 id="lfw-stage5-title">Количество и монтаж</h1>
          <p>
            Для типовой люстры достаточно стандартного режима; для многоуровневых композиций (как MYLINE) включите Advanced Project.
          </p>
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
        <aside className="lfw-visual-aside">
          <div className="lfw-visual-aside-img">
            {primaryUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={primaryUrl} alt={primary?.name ?? project.name} />
            ) : (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--atelier-muted)', fontSize: 13 }}>
                Фотография светильника не загружена — можно вернуться на шаг 1 в любой момент.
              </div>
            )}
          </div>
          <div className="lfw-visual-aside-meta">
            <strong>{project.name}</strong>
            <span className="lf-field-hint">
              {productTypes[project.kind][0]} · Компонентов: {project.components.length} · Заказ: {project.orderQuantity} шт.
            </span>
          </div>

          {(mode === 'advanced' || project.mounting.placements.length > 0 || project.mounting.ceilingFromFloorMm) && (
            <ElevationDiagram project={project} summary={summary} />
          )}
        </aside>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          {/* Order & Volume Card */}
          <div className="lfw-panel">
            <h2>Заказ и коммерческие параметры</h2>
            <div className="lfw-grid-2">
              <div className="lfw-field">
                <label htmlFor="lfw-order-qty">Количество светильников (шт.)</label>
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
                <label htmlFor="lfw-currency">Валюта коммерческого запроса</label>
                <select
                  id="lfw-currency"
                  value={project.currency}
                  onChange={(e) =>
                    onUpdateProject(
                      (p) => ({
                        ...p,
                        currency: e.target.value as Project['currency'],
                      }),
                      'currency',
                    )
                  }
                >
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                  <option value="CNY">CNY (¥)</option>
                </select>
              </div>
            </div>

            <div className="lfw-install-kpis">
              <div className="lfw-kpi">
                <strong>{project.orderQuantity}</strong>
                <span>Изделий в заказе</span>
              </div>
              <div className="lfw-kpi">
                <strong>{summary.totalComponentUnits}</strong>
                <span>Единиц в 1 изделии</span>
              </div>
              <div className="lfw-kpi">
                <strong>{totalOrderUnits}</strong>
                <span>Всего узлов к выпуску</span>
              </div>
              <div className="lfw-kpi">
                <strong>
                  {summary.placedUnits}/{summary.totalComponentUnits}
                </strong>
                <span>Отметок в схеме</span>
              </div>
            </div>
          </div>

          {/* Advanced Project: Room Levels & Placements */}
          {mode === 'advanced' && (
            <div className="lfw-panel">
              <div className="lfw-stage-head">
                <div>
                  <h2 style={{ margin: 0 }}>Инженерные уровни помещения (мм)</h2>
                  <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--atelier-muted)' }}>
                    Все расчёты ведутся в миллиметрах от чистового пола с сохранением источника каждого числа.
                  </p>
                </div>
              </div>

              <div className="lfw-grid-2">
                <MeasurementInput
                  id="lfw-ceiling-mm"
                  label="Высота потолка от пола"
                  value={project.mounting.ceilingFromFloorMm}
                  lengthUnit="mm"
                  min={0}
                  max={1_000_000}
                  placeholder="Например: 5750"
                  onChange={(next) =>
                    updateMounting((current) => {
                      const updated = { ...current };
                      if (next) updated.ceilingFromFloorMm = next;
                      else delete updated.ceilingFromFloorMm;
                      return updated;
                    }, 'mount:ceilingFromFloorMm')
                  }
                />
                <MeasurementInput
                  id="lfw-tabletop-mm"
                  label="Высота столешницы от пола"
                  value={project.mounting.tabletopFromFloorMm}
                  lengthUnit="mm"
                  min={0}
                  max={1_000_000}
                  placeholder="Оставьте пустым, если неизвестно"
                  onChange={(next) =>
                    updateMounting((current) => {
                      const updated = { ...current };
                      if (next) updated.tabletopFromFloorMm = next;
                      else delete updated.tabletopFromFloorMm;
                      return updated;
                    }, 'mount:tabletopFromFloorMm')
                  }
                />
              </div>

              {summary.missingTabletop && (
                <div className="lfw-diag-row lfw-diag-row--warning" role="status">
                  <AlertIcon size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                  <div>
                    <strong>Высота столешницы не задана</strong>
                    <p>
                      Система не подставляет фиктивную высоту стола. Итоговые длины тросов и ремней остаются
                      неопределёнными и в RFQ уходят на подтверждение фабрике после замера площадки.
                    </p>
                  </div>
                </div>
              )}

              {summary.hasExcessPlacements && (
                <div className="lfw-diag-row lfw-diag-row--error" role="alert">
                  <AlertIcon size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                  <div style={{ flex: 1 }}>
                    <strong>Лишние отметки размещения</strong>
                    <p>
                      Количество размещений превышает количество единиц компонента. Удалите лишние отметки или увеличьте количество элементов на шаге 2.
                    </p>
                  </div>
                  <button
                    id="lfw-prune-placements-btn"
                    type="button"
                    className="lf-btn lf-btn--sm"
                    onClick={() => onUpdateProject((p) => pruneExcessPlacements(p), 'mounting:prune')}
                  >
                    Удалить лишние
                  </button>
                </div>
              )}

              <div className="lfw-placements-block">
                <div className="lfw-placements-head">
                  <div>
                    <h3 style={{ margin: 0, fontSize: 14.5 }}>
                      Отметки элементов над столом ({project.mounting.placements.length})
                    </h3>
                    <span className="lf-field-hint">
                      Фиксируйте нижнюю точку каждого элемента отдельно (как MYLINE: 900 / 950 / 1250 / 1500 мм).
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {summary.unplacedUnits > 1 && (
                      <button
                        id="lfw-populate-placements-btn"
                        type="button"
                        className="lf-btn lf-btn--sm lf-btn--subtle"
                        onClick={() => onUpdateProject((p) => populateMissingPlacements(p), 'mounting:populate')}
                      >
                        Расставить все (+{summary.unplacedUnits})
                      </button>
                    )}
                    <button
                      id="lfw-add-placement-btn"
                      type="button"
                      className="lf-btn lf-btn--sm"
                      disabled={!canAddPlacement || project.mounting.placements.length >= 96}
                      onClick={() => onUpdateProject((p) => addPlacementToProject(p), 'mounting:add')}
                    >
                      <PlusIcon size={14} /> Добавить отметку
                    </button>
                  </div>
                </div>

                {project.mounting.placements.length === 0 ? (
                  <p className="lf-field-hint" style={{ margin: 0 }}>
                    Пока нет отметок размещения. Нажмите «Добавить отметку», чтобы задать высоту подвеса каждого элемента.
                  </p>
                ) : (
                  <div className="lfw-placement-list">
                    {project.mounting.placements.map((placement, index) => {
                      const analysis = summary.placements[index];
                      const coordsOpen = Boolean(
                        expandedCoords[placement.id] ||
                          placement.xMm !== undefined ||
                          placement.yMm !== undefined ||
                          placement.canopyDropMm !== undefined ||
                          placement.attachmentAboveLowestMm !== undefined,
                      );

                      return (
                        <div
                          key={placement.id}
                          className={`lfw-placement-card${analysis?.conflict ? ' lfw-placement-card--conflict' : ''}`}
                        >
                          <div className="lfw-placement-top">
                            <span className="lfw-placement-index mono">#{index + 1}</span>
                            <select
                              aria-label={`Компонент для отметки ${index + 1}`}
                              className="lf-select"
                              style={{ maxWidth: 260, minHeight: 34 }}
                              value={placement.componentId}
                              onChange={(e) =>
                                updatePlacement(placement.id, (cur) => ({
                                  ...cur,
                                  componentId: e.target.value,
                                }))
                              }
                            >
                              {project.components.map((comp) => {
                                const free = remainingPlacementCapacity(project, comp.id);
                                const isCurrent = comp.id === placement.componentId;
                                return (
                                  <option key={comp.id} value={comp.id} disabled={free <= 0 && !isCurrent}>
                                    {comp.name} (свободно {Math.max(0, free)} из {comp.quantity})
                                  </option>
                                );
                              })}
                            </select>

                            <button
                              type="button"
                              className="lf-btn lf-btn--subtle lf-btn--sm"
                              onClick={() =>
                                setExpandedCoords((prev) => ({ ...prev, [placement.id]: !coordsOpen }))
                              }
                            >
                              Координаты X/Y
                              <ChevronIcon size={13} open={coordsOpen} />
                            </button>

                            <button
                              type="button"
                              className="lf-btn lf-btn--icon lf-btn--subtle"
                              aria-label={`Удалить отметку ${index + 1}`}
                              onClick={() => removePlacement(placement.id)}
                            >
                              <TrashIcon size={14} />
                            </button>
                          </div>

                          <MeasurementInput
                            id={`lfw-pl-low-${placement.id}`}
                            label="Нижняя точка элемента над столешницей"
                            value={placement.lowestAboveTabletopMm}
                            lengthUnit="mm"
                            min={0}
                            max={1_000_000}
                            placeholder="Например: 900"
                            onChange={(next) =>
                              updatePlacement(placement.id, (cur) => {
                                const updated = { ...cur };
                                if (next) updated.lowestAboveTabletopMm = next;
                                else delete updated.lowestAboveTabletopMm;
                                return updated;
                              })
                            }
                          />

                          {coordsOpen && (
                            <div className="lfw-placement-coords">
                              <div className="lfw-grid-2">
                                <div className="lfw-field">
                                  <label htmlFor={`lfw-pl-x-${placement.id}`}>Смещение X (мм)</label>
                                  <input
                                    id={`lfw-pl-x-${placement.id}`}
                                    type="text"
                                    inputMode="decimal"
                                    className="mono"
                                    placeholder="Не задано"
                                    value={placement.xMm !== undefined ? String(placement.xMm) : ''}
                                    onChange={(e) => {
                                      const parsed = parsePlainNumber(e.target.value);
                                      updatePlacement(placement.id, (cur) => {
                                        const updated = { ...cur };
                                        if (parsed !== null && parsed >= -1_000_000 && parsed <= 1_000_000) {
                                          updated.xMm = parsed;
                                        } else {
                                          delete updated.xMm;
                                        }
                                        return updated;
                                      });
                                    }}
                                  />
                                </div>
                                <div className="lfw-field">
                                  <label htmlFor={`lfw-pl-y-${placement.id}`}>Смещение Y (мм)</label>
                                  <input
                                    id={`lfw-pl-y-${placement.id}`}
                                    type="text"
                                    inputMode="decimal"
                                    className="mono"
                                    placeholder="Не задано"
                                    value={placement.yMm !== undefined ? String(placement.yMm) : ''}
                                    onChange={(e) => {
                                      const parsed = parsePlainNumber(e.target.value);
                                      updatePlacement(placement.id, (cur) => {
                                        const updated = { ...cur };
                                        if (parsed !== null && parsed >= -1_000_000 && parsed <= 1_000_000) {
                                          updated.yMm = parsed;
                                        } else {
                                          delete updated.yMm;
                                        }
                                        return updated;
                                      });
                                    }}
                                  />
                                </div>
                              </div>

                              <div className="lfw-grid-2">
                                <MeasurementInput
                                  id={`lfw-pl-drop-${placement.id}`}
                                  label="Опуск потолочной чаши"
                                  value={placement.canopyDropMm}
                                  lengthUnit="mm"
                                  min={0}
                                  max={1_000_000}
                                  placeholder="Не задано"
                                  onChange={(next) =>
                                    updatePlacement(placement.id, (cur) => {
                                      const updated = { ...cur };
                                      if (next) updated.canopyDropMm = next;
                                      else delete updated.canopyDropMm;
                                      return updated;
                                    })
                                  }
                                />
                                <MeasurementInput
                                  id={`lfw-pl-att-${placement.id}`}
                                  label="Точка подвеса над нижней точкой"
                                  value={placement.attachmentAboveLowestMm}
                                  lengthUnit="mm"
                                  min={0}
                                  max={1_000_000}
                                  placeholder="По высоте корпуса"
                                  onChange={(next) =>
                                    updatePlacement(placement.id, (cur) => {
                                      const updated = { ...cur };
                                      if (next) updated.attachmentAboveLowestMm = next;
                                      else delete updated.attachmentAboveLowestMm;
                                      return updated;
                                    })
                                  }
                                />
                              </div>
                            </div>
                          )}

                          {/* Live Suspension Calculation Strip */}
                          {analysis && (
                            <div
                              className={`lfw-placement-calc${
                                analysis.conflict
                                  ? ' lfw-placement-calc--error'
                                  : analysis.suspensionVerticalMm !== undefined
                                    ? ' lfw-placement-calc--ok'
                                    : ''
                              }`}
                            >
                              {analysis.conflict ? (
                                <>
                                  <AlertIcon size={14} />
                                  <span>{analysis.conflict}</span>
                                </>
                              ) : analysis.suspensionVerticalMm !== undefined ? (
                                <>
                                  <CheckIcon size={14} />
                                  <span className="mono">
                                    От пола: {Math.round(analysis.bottomFromFloorMm!)} мм · Вертикальный подвес:{' '}
                                    {Math.round(analysis.suspensionVerticalMm)} мм
                                  </span>
                                  <span
                                    className={`lf-badge ${
                                      analysis.quality === 'estimated'
                                        ? 'lf-badge--estimated'
                                        : 'lf-badge--documentation'
                                    }`}
                                  >
                                    {analysis.quality === 'estimated' ? 'Оценка' : 'По данным'}
                                  </span>
                                </>
                              ) : (
                                <span>
                                  Длина подвеса не зафиксирована — не хватает: {analysis.missing.join(', ')}.
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Mounting & Packaging Notes Card */}
          <div className="lfw-panel">
            <h2>Требования к монтажу, подвесу и упаковке</h2>
            <div className="lfw-preset-chips" aria-label="Быстрые требования для фабрики">
              {INSTALLATION_NOTE_PRESETS.map((preset) => {
                const active = project.notes.includes(preset);
                return (
                  <button
                    key={preset}
                    type="button"
                    className={`lfw-chip-btn${active ? ' lfw-chip-btn--active' : ''}`}
                    onClick={() =>
                      onUpdateProject((p) => ({ ...p, notes: appendNotePreset(p.notes, preset) }), 'notes')
                    }
                  >
                    {active ? <CheckIcon size={12} /> : <PlusIcon size={12} />}
                    <span>{preset}</span>
                  </button>
                );
              })}
            </div>

            <div className="lfw-field">
              <label htmlFor="lfw-notes">Примечания для фабрики (передаются в RFQ и PDF)</label>
              <textarea
                id="lfw-notes"
                rows={4}
                placeholder="Например: тип подвеса, потолочное основание, ориентировочная длина подвеса, упаковка для авиадоставки…"
                value={project.notes}
                onChange={(e) => onUpdateProject((p) => ({ ...p, notes: e.target.value }), 'notes')}
              />
            </div>

            {issues.filter((i) => i.path[0] === 'mounting').length > 0 && (
              <p className="lf-field-error" style={{ margin: 0 }}>
                Есть предупреждения по схеме монтажа — проверьте отметки перед выпуском PDF.
              </p>
            )}
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
