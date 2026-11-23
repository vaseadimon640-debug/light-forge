'use client';

import { useState } from 'react';
import type { Placement, Project, Unit } from '@/domain/project';
import { AlertIcon, ChevronIcon, PlusIcon, TrashIcon } from '../icons';
import { MeasurementInput } from './MeasurementInput';
import {
  firstAvailableComponentForPlacement,
  issuesMatching,
  parsePlainNumber,
  remainingPlacementCapacity,
  type FieldIssue,
} from './helpers';

type MountingSectionProps = {
  project: Project;
  unit: Unit;
  open: boolean;
  onToggleOpen: () => void;
  onChangeMounting: (updater: (mounting: Project['mounting']) => Project['mounting']) => void;
  onAddPlacement: () => void;
  onPruneExcessPlacements: () => void;
  issues: FieldIssue[];
};

export function MountingSection({
  project,
  unit,
  open,
  onToggleOpen,
  onChangeMounting,
  onAddPlacement,
  onPruneExcessPlacements,
  issues,
}: MountingSectionProps) {
  const [expandedCoords, setExpandedCoords] = useState<Record<string, boolean>>({});
  const { mounting } = project;
  const mountingIssues = issuesMatching(issues, ['mounting']);
  const placementIssues = issuesMatching(issues, ['mounting', 'placements']);
  const canAdd = Boolean(firstAvailableComponentForPlacement(project));

  function updatePlacement(id: string, updater: (placement: Placement) => Placement) {
    onChangeMounting(current => ({
      ...current,
      placements: current.placements.map(item => (item.id === id ? updater(item) : item)),
    }));
  }

  function removePlacement(id: string) {
    onChangeMounting(current => ({
      ...current,
      placements: current.placements.filter(item => item.id !== id),
    }));
  }

  const summaryBits: string[] = [];
  if (mounting.ceilingFromFloorMm) summaryBits.push(`Потолок ${mounting.ceilingFromFloorMm.value} мм`);
  if (mounting.tabletopFromFloorMm) {
    summaryBits.push(`Стол ${mounting.tabletopFromFloorMm.value} мм`);
  } else if (mounting.ceilingFromFloorMm || mounting.placements.length > 0) {
    summaryBits.push('Стол не указан');
  }
  if (mounting.placements.length > 0) summaryBits.push(`Отметок: ${mounting.placements.length}`);

  return (
    <section className="lf-card" aria-labelledby="mounting-heading">
      <button
        id="lf-mounting-toggle"
        type="button"
        className={`lf-card-header lf-card-header--collapsible${open ? ' lf-card-header--open' : ''}`}
        aria-expanded={open}
        onClick={onToggleOpen}
      >
        <div className="lf-card-title-wrap">
          <span className="lf-card-eyebrow">Шаг 5 · Дополнительно</span>
          <h2 id="mounting-heading" className="lf-card-title">
            Монтажные уровни и расстановка
            {mountingIssues.length > 0 && (
              <span className="lf-badge lf-badge--danger">Ошибок: {mountingIssues.length}</span>
            )}
          </h2>
          <p className="lf-card-desc">
            {summaryBits.length > 0
              ? summaryBits.join(' · ')
              : 'Раскройте при необходимости: высота потолка, стола и отметки подвесов'}
          </p>
        </div>
        <ChevronIcon size={18} open={open} style={{ marginTop: 6, flexShrink: 0 }} />
      </button>

      {open && (
        <div className="lf-card-body">
          <div className="lf-grid-2">
            <MeasurementInput
              id="mount-ceiling"
              label="Потолок от чистового пола"
              value={mounting.ceilingFromFloorMm}
              lengthUnit={unit}
              min={0}
              max={1_000_000}
              placeholder="Например: 5750"
              onChange={next =>
                onChangeMounting(current => {
                  const updated = { ...current };
                  if (next) updated.ceilingFromFloorMm = next;
                  else delete updated.ceilingFromFloorMm;
                  return updated;
                })
              }
            />
            <MeasurementInput
              id="mount-tabletop"
              label="Столешница от чистового пола"
              value={mounting.tabletopFromFloorMm}
              lengthUnit={unit}
              min={0}
              max={1_000_000}
              placeholder="Оставьте пустым, если неизвестно"
              onChange={next =>
                onChangeMounting(current => {
                  const updated = { ...current };
                  if (next) updated.tabletopFromFloorMm = next;
                  else delete updated.tabletopFromFloorMm;
                  return updated;
                })
              }
            />
          </div>

          {!mounting.tabletopFromFloorMm && (mounting.ceilingFromFloorMm || mounting.placements.length > 0) && (
            <div className="lf-alert lf-alert--info" role="status">
              <div className="lf-alert-content">
                <AlertIcon size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>
                  Отметка столешницы не задана — система не подставляет фиктивную длину подвесов и ремней. В RFQ
                  строка <strong>Canopy and suspension fabrication lengths</strong> уходит на подтверждение фабрике.
                </span>
              </div>
            </div>
          )}

          {placementIssues.length > 0 && (
            <div className="lf-alert lf-alert--danger" role="alert">
              <div className="lf-alert-content">
                <AlertIcon size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>
                  Количество размещений превышает количество единиц одного из компонентов. Увеличьте количество
                  компонента или удалите лишние размещения.
                </span>
              </div>
              <button type="button" className="lf-btn lf-btn--sm" onClick={onPruneExcessPlacements}>
                Удалить лишние
              </button>
            </div>
          )}

          <div className="lf-subblock">
            <div className="lf-subblock-head">
              <h3 className="lf-subblock-title">Экземпляры и отметки над столом ({mounting.placements.length})</h3>
              <button
                id="lf-add-placement-btn"
                type="button"
                className="lf-btn lf-btn--sm"
                disabled={!canAdd || mounting.placements.length >= 96}
                title={canAdd ? 'Добавить размещение для свободной единицы компонента' : 'Все единицы компонентов уже размещены'}
                onClick={onAddPlacement}
              >
                <PlusIcon size={14} /> Добавить отметку
              </button>
            </div>

            {mounting.placements.length === 0 ? (
              <div className="lf-field-hint">
                Пока не задано ни одной отметки размещения. Добавьте, чтобы зафиксировать высоту нижней точки
                каждого элемента (как в MYLINE: 900 / 950 / 1250 / 1500 мм над столом).
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {mounting.placements.map((placement, index) => {
                  const coordsOpen = Boolean(
                    expandedCoords[placement.id] ||
                      placement.xMm !== undefined ||
                      placement.yMm !== undefined ||
                      placement.canopyDropMm !== undefined ||
                      placement.attachmentAboveLowestMm !== undefined,
                  );
                  const rowError = issuesMatching(issues, ['mounting', 'placements', index])[0]?.message;
                  return (
                    <div key={placement.id} className="lf-item-row">
                      <div className="lf-item-row-head">
                        <span className="lf-field-hint num" style={{ fontWeight: 600 }}>
                          #{index + 1} · {placement.id}
                        </span>
                        <div style={{ display: 'inline-flex', gap: 6 }}>
                          <button
                            type="button"
                            className="lf-btn lf-btn--subtle lf-btn--sm"
                            onClick={() =>
                              setExpandedCoords(prev => ({ ...prev, [placement.id]: !coordsOpen }))
                            }
                          >
                            {coordsOpen ? 'Скрыть координаты' : 'Координаты X/Y'}
                          </button>
                          <button
                            type="button"
                            className="lf-btn lf-btn--danger lf-btn--icon"
                            aria-label={`Удалить размещение ${index + 1}`}
                            onClick={() => removePlacement(placement.id)}
                          >
                            <TrashIcon size={14} />
                          </button>
                        </div>
                      </div>

                      <div className="lf-grid-2">
                        <div className="lf-field">
                          <label className="lf-label" htmlFor={`place-comp-${placement.id}`}>
                            Компонент
                          </label>
                          <select
                            id={`place-comp-${placement.id}`}
                            className={`lf-select${rowError ? ' lf-select--error' : ''}`}
                            value={placement.componentId}
                            onChange={event =>
                              updatePlacement(placement.id, item => ({
                                ...item,
                                componentId: event.target.value,
                              }))
                            }
                          >
                            {project.components.map(comp => {
                              const free = remainingPlacementCapacity(project, comp.id);
                              const isCurrent = comp.id === placement.componentId;
                              return (
                                <option key={comp.id} value={comp.id} disabled={!isCurrent && free <= 0}>
                                  {comp.name} (всего {comp.quantity}
                                  {!isCurrent ? `, свободно ${free}` : ''})
                                </option>
                              );
                            })}
                          </select>
                          {rowError && <span className="lf-field-error">{rowError}</span>}
                        </div>

                        <MeasurementInput
                          id={`place-lowest-${placement.id}`}
                          label="Нижняя точка над столом"
                          value={placement.lowestAboveTabletopMm}
                          lengthUnit={unit}
                          min={0}
                          max={1_000_000}
                          placeholder="На подтверждение"
                          onChange={next =>
                            updatePlacement(placement.id, item => {
                              const updated = { ...item };
                              if (next) updated.lowestAboveTabletopMm = next;
                              else delete updated.lowestAboveTabletopMm;
                              return updated;
                            })
                          }
                        />
                      </div>

                      {coordsOpen && (
                        <div className="lf-grid-2">
                          <div className="lf-field">
                            <label className="lf-label" htmlFor={`place-x-${placement.id}`}>
                              Координата X <span className="lf-label-unit">мм</span>
                            </label>
                            <input
                              id={`place-x-${placement.id}`}
                              type="text"
                              inputMode="decimal"
                              className="lf-input num"
                              value={placement.xMm ?? ''}
                              placeholder="Не указано"
                              onChange={event => {
                                const parsed = parsePlainNumber(event.target.value);
                                updatePlacement(placement.id, item => {
                                  const updated = { ...item };
                                  if (parsed !== null) updated.xMm = parsed;
                                  else delete updated.xMm;
                                  return updated;
                                });
                              }}
                            />
                          </div>
                          <div className="lf-field">
                            <label className="lf-label" htmlFor={`place-y-${placement.id}`}>
                              Координата Y <span className="lf-label-unit">мм</span>
                            </label>
                            <input
                              id={`place-y-${placement.id}`}
                              type="text"
                              inputMode="decimal"
                              className="lf-input num"
                              value={placement.yMm ?? ''}
                              placeholder="Не указано"
                              onChange={event => {
                                const parsed = parsePlainNumber(event.target.value);
                                updatePlacement(placement.id, item => {
                                  const updated = { ...item };
                                  if (parsed !== null) updated.yMm = parsed;
                                  else delete updated.yMm;
                                  return updated;
                                });
                              }}
                            />
                          </div>
                          <MeasurementInput
                            id={`place-canopy-${placement.id}`}
                            label="Выпуск потолочного основания"
                            value={placement.canopyDropMm}
                            lengthUnit={unit}
                            min={0}
                            max={1_000_000}
                            onChange={next =>
                              updatePlacement(placement.id, item => {
                                const updated = { ...item };
                                if (next) updated.canopyDropMm = next;
                                else delete updated.canopyDropMm;
                                return updated;
                              })
                            }
                          />
                          <MeasurementInput
                            id={`place-attach-${placement.id}`}
                            label="Точка крепления от низа корпуса"
                            value={placement.attachmentAboveLowestMm}
                            lengthUnit={unit}
                            min={0}
                            max={1_000_000}
                            onChange={next =>
                              updatePlacement(placement.id, item => {
                                const updated = { ...item };
                                if (next) updated.attachmentAboveLowestMm = next;
                                else delete updated.attachmentAboveLowestMm;
                                return updated;
                              })
                            }
                          />
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
    </section>
  );
}
