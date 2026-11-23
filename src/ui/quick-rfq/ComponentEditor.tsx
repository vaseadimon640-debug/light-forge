'use client';

import { useState } from 'react';
import {
  dimensionKeys,
  dimensions,
  dimmingModes,
  directions,
  finishes,
  ipRatings,
  materials,
  productTypes,
  type Component,
  type DimensionKey,
  type Material,
  type ProductType,
  type Project,
  type Unit,
} from '@/domain/project';
import { ChevronIcon, PlusIcon, ShieldIcon, TrashIcon } from '../icons';
import { MeasurementInput } from './MeasurementInput';
import { createMaterialRow, issuesMatching, type FieldIssue } from './helpers';

type ComponentEditorProps = {
  project: Project;
  activeComponentId: string;
  onSelectComponent: (componentId: string) => void;
  onAddComponent: () => void;
  onRemoveComponent: (componentId: string) => void;
  onUpdateComponent: (componentId: string, updater: (component: Component) => Component) => void;
  unit: Unit;
  issues: FieldIssue[];
};

const allDimensionKeys = Object.keys(dimensions) as DimensionKey[];
const productTypeKeys = Object.keys(productTypes) as ProductType[];
const materialKeys = Object.keys(materials) as Material['material'][];
const finishKeys = Object.keys(finishes) as NonNullable<Material['finish']>[];
const directionKeys = Object.keys(directions) as NonNullable<Component['light']['directionId']>[];

export function ComponentEditor({
  project,
  activeComponentId,
  onSelectComponent,
  onAddComponent,
  onRemoveComponent,
  onUpdateComponent,
  unit,
  issues,
}: ComponentEditorProps) {
  const [showExtraDims, setShowExtraDims] = useState(false);
  const [expandedMaterialDetails, setExpandedMaterialDetails] = useState<Record<string, boolean>>({});

  const activeIndex = Math.max(
    0,
    project.components.findIndex(component => component.id === activeComponentId),
  );
  const component = project.components[activeIndex] ?? project.components[0];

  const primaryDimKeys = dimensionKeys(component.kind);
  const extraDimKeys = allDimensionKeys.filter(key => !primaryDimKeys.includes(key));
  const hasFilledExtraDims = extraDimKeys.some(key => Boolean(component.dimensions[key]));

  const componentIssues = issuesMatching(issues, ['components', activeIndex]);
  const issueText = (subpath: (string | number)[]) =>
    issuesMatching(issues, ['components', activeIndex, ...subpath])[0]?.message;

  const update = (updater: (current: Component) => Component) =>
    onUpdateComponent(component.id, updater);

  function setDimension(key: DimensionKey, value: Component['dimensions'][DimensionKey]) {
    update(current => {
      const nextDims = { ...current.dimensions };
      if (value === undefined) {
        delete nextDims[key];
      } else {
        nextDims[key] = value;
      }
      return { ...current, dimensions: nextDims };
    });
  }

  function updateMaterial(materialId: string, updater: (item: Material) => Material) {
    update(current => ({
      ...current,
      materials: current.materials.map(item => (item.id === materialId ? updater(item) : item)),
    }));
  }

  const usesSolidBrass = component.materials.some(item => item.material === 'solidBrass');
  const usesGenuineLeather = component.materials.some(item => item.material === 'genuineLeather');

  return (
    <section className="lf-card" aria-labelledby="components-heading">
      <div className="lf-card-header">
        <div className="lf-card-title-wrap">
          <span className="lf-card-eyebrow">Шаг 3 · Изделие и спецификация</span>
          <h2 id="components-heading" className="lf-card-title">
            Корпуса, размеры, свет и материалы
            {componentIssues.length > 0 && (
              <span className="lf-badge lf-badge--danger">Ошибок: {componentIssues.length}</span>
            )}
          </h2>
          <p className="lf-card-desc">
            Пустые поля не подменяются нулями — в RFQ они явно передаются «На подтверждение фабрике».
          </p>
        </div>

        <button
          id="lf-add-component-btn"
          type="button"
          className="lf-btn lf-btn--sm"
          onClick={onAddComponent}
          disabled={project.components.length >= 24}
        >
          <PlusIcon size={14} />
          Добавить компонент
        </button>
      </div>

      <div className="lf-card-body">
        {project.components.length > 1 && (
          <div className="lf-tabs-bar" role="tablist" aria-label="Компоненты светильника">
            {project.components.map((item, idx) => {
              const selected = item.id === component.id;
              const hasErr = issuesMatching(issues, ['components', idx]).length > 0;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className={`lf-comp-tab${selected ? ' lf-comp-tab--active' : ''}`}
                  onClick={() => onSelectComponent(item.id)}
                >
                  <span>{item.name || `Компонент ${idx + 1}`}</span>
                  <span className="lf-comp-tab-qty">×{item.quantity}</span>
                  {hasErr && (
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        background: selected ? '#ffd1cc' : 'var(--danger)',
                      }}
                      aria-label="Есть ошибки"
                    />
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Component Identity Row */}
        <div className="lf-grid-3">
          <div className="lf-field">
            <label className="lf-label" htmlFor={`comp-name-${component.id}`}>
              Название компонента
            </label>
            <input
              id={`comp-name-${component.id}`}
              type="text"
              className={`lf-input${issueText(['name']) ? ' lf-input--error' : ''}`}
              value={component.name}
              maxLength={120}
              placeholder="Например: Основное кольцо"
              onChange={event => update(current => ({ ...current, name: event.target.value }))}
            />
            {issueText(['name']) && <span className="lf-field-error">{issueText(['name'])}</span>}
          </div>

          <div className="lf-field">
            <label className="lf-label" htmlFor={`comp-kind-${component.id}`}>
              Тип корпуса
            </label>
            <select
              id={`comp-kind-${component.id}`}
              className="lf-select"
              value={component.kind}
              onChange={event => update(current => ({ ...current, kind: event.target.value as ProductType }))}
            >
              {productTypeKeys.map(key => (
                <option key={key} value={key}>
                  {productTypes[key][0]} ({productTypes[key][1]})
                </option>
              ))}
            </select>
          </div>

          <div className="lf-field">
            <div className="lf-field-head">
              <label className="lf-label" htmlFor={`comp-qty-${component.id}`}>
                Шт. в комплекте
              </label>
              {project.components.length > 1 && (
                <button
                  type="button"
                  className="lf-btn lf-btn--danger lf-btn--sm"
                  style={{ minHeight: 22, padding: '0 7px', fontSize: 11 }}
                  onClick={() => onRemoveComponent(component.id)}
                >
                  <TrashIcon size={12} /> Удалить
                </button>
              )}
            </div>
            <input
              id={`comp-qty-${component.id}`}
              type="number"
              min={1}
              max={1000000}
              step={1}
              className={`lf-input num${issueText(['quantity']) ? ' lf-input--error' : ''}`}
              value={component.quantity}
              onChange={event => {
                const parsed = Number.parseInt(event.target.value, 10);
                if (Number.isFinite(parsed) && parsed >= 1) {
                  update(current => ({ ...current, quantity: parsed }));
                }
              }}
            />
          </div>
        </div>

        {/* Dimensions */}
        <div className="lf-subblock">
          <div className="lf-subblock-head">
            <h3 className="lf-subblock-title">Габариты и размеры корпуса</h3>
            <button
              type="button"
              className="lf-btn lf-btn--subtle lf-btn--sm"
              onClick={() => setShowExtraDims(prev => !prev)}
            >
              <span>{showExtraDims || hasFilledExtraDims ? 'Скрыть доп. размеры' : 'Доп. размеры'}</span>
              <ChevronIcon size={14} open={showExtraDims || hasFilledExtraDims} />
            </button>
          </div>

          <div className="lf-grid-2">
            {primaryDimKeys.map(key => (
              <MeasurementInput
                key={key}
                id={`dim-${component.id}-${key}`}
                label={dimensions[key][0]}
                value={component.dimensions[key]}
                lengthUnit={unit}
                min={0}
                max={1_000_000}
                error={issueText(['dimensions', key])}
                onChange={next => setDimension(key, next)}
              />
            ))}
          </div>

          {(showExtraDims || hasFilledExtraDims) && (
            <div className="lf-grid-2">
              {extraDimKeys.map(key => (
                <MeasurementInput
                  key={key}
                  id={`dim-extra-${component.id}-${key}`}
                  label={dimensions[key][0]}
                  value={component.dimensions[key]}
                  lengthUnit={unit}
                  min={0}
                  max={1_000_000}
                  error={issueText(['dimensions', key])}
                  onChange={next => setDimension(key, next)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Light & Electrical */}
        <div className="lf-subblock">
          <div className="lf-subblock-head">
            <h3 className="lf-subblock-title">Свет и электрика (на 1 единицу компонента)</h3>
            <span className="lf-field-hint">Драйвер и напряжение → фабрике</span>
          </div>

          <div className="lf-grid-2">
            <MeasurementInput
              id={`light-cct-${component.id}`}
              label="Цветовая температура (CCT)"
              value={component.light.cct}
              fixedUnit="K"
              min={1000}
              max={20000}
              integer
              placeholder="3000"
              error={issueText(['light', 'cct'])}
              onChange={next => update(current => ({ ...current, light: { ...current.light, cct: next } }))}
            />
            <MeasurementInput
              id={`light-cri-${component.id}`}
              label="Индекс цветопередачи (CRI)"
              value={component.light.cri}
              fixedUnit="Ra"
              min={0}
              max={100}
              placeholder="90"
              error={issueText(['light', 'cri'])}
              onChange={next => update(current => ({ ...current, light: { ...current.light, cri: next } }))}
            />
            <MeasurementInput
              id={`light-watts-${component.id}`}
              label="Мощность на компонент"
              value={component.light.watts}
              fixedUnit="W"
              min={0.001}
              max={100000}
              placeholder="На подтверждение"
              error={issueText(['light', 'watts'])}
              onChange={next => update(current => ({ ...current, light: { ...current.light, watts: next } }))}
            />
            <MeasurementInput
              id={`light-lumens-${component.id}`}
              label="Световой поток"
              value={component.light.lumens}
              fixedUnit="lm"
              min={0.001}
              max={10000000}
              placeholder="На подтверждение"
              error={issueText(['light', 'lumens'])}
              onChange={next => update(current => ({ ...current, light: { ...current.light, lumens: next } }))}
            />
          </div>

          <div className="lf-grid-3">
            <div className="lf-field">
              <label className="lf-label" htmlFor={`light-dir-${component.id}`}>
                Направление света
              </label>
              <select
                id={`light-dir-${component.id}`}
                className="lf-select"
                value={component.light.directionId ?? ''}
                onChange={event => {
                  const val = event.target.value as NonNullable<Component['light']['directionId']> | '';
                  update(current => {
                    const nextLight = { ...current.light };
                    if (val) nextLight.directionId = val;
                    else delete nextLight.directionId;
                    return { ...current, light: nextLight };
                  });
                }}
              >
                <option value="">На подтверждение фабрике</option>
                {directionKeys.map(key => (
                  <option key={key} value={key}>
                    {directions[key][0]}
                  </option>
                ))}
              </select>
            </div>

            <div className="lf-field">
              <label className="lf-label" htmlFor={`light-dim-${component.id}`}>
                Диммирование
              </label>
              <select
                id={`light-dim-${component.id}`}
                className="lf-select"
                value={component.light.dimming ?? ''}
                onChange={event => {
                  const val = event.target.value as (typeof dimmingModes)[number] | '';
                  update(current => {
                    const nextLight = { ...current.light };
                    if (val) nextLight.dimming = val;
                    else delete nextLight.dimming;
                    return { ...current, light: nextLight };
                  });
                }}
              >
                <option value="">На подтверждение фабрике</option>
                {dimmingModes.map(mode => (
                  <option key={mode} value={mode}>
                    {mode === 'none' ? 'Без диммирования (None)' : mode}
                  </option>
                ))}
              </select>
            </div>

            <div className="lf-field">
              <label className="lf-label" htmlFor={`light-ip-${component.id}`}>
                Степень защиты (IP)
              </label>
              <select
                id={`light-ip-${component.id}`}
                className="lf-select"
                value={component.light.ip ?? ''}
                onChange={event => {
                  const val = event.target.value as (typeof ipRatings)[number] | '';
                  update(current => {
                    const nextLight = { ...current.light };
                    if (val) nextLight.ip = val;
                    else delete nextLight.ip;
                    return { ...current, light: nextLight };
                  });
                }}
              >
                <option value="">На подтверждение фабрике</option>
                {ipRatings.map(ip => (
                  <option key={ip} value={ip}>
                    {ip}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Materials & Finishes */}
        <div className="lf-subblock">
          <div className="lf-subblock-head">
            <h3 className="lf-subblock-title">Материалы, отделка и цвет</h3>
            <button
              id={`lf-add-material-${component.id}`}
              type="button"
              className="lf-btn lf-btn--sm"
              disabled={component.materials.length >= 16}
              onClick={() =>
                update(current => ({
                  ...current,
                  materials: [
                    ...current.materials,
                    createMaterialRow(current.materials.length === 0 ? 'Корпус' : `Деталь ${current.materials.length + 1}`),
                  ],
                }))
              }
            >
              <PlusIcon size={14} /> Добавить материал
            </button>
          </div>

          {(usesSolidBrass || usesGenuineLeather) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {usesSolidBrass && (
                <span className="lf-badge lf-badge--brass">
                  <ShieldIcon size={12} /> Настоящая латунь · в RFQ запрет подмены на крашеную сталь/алюминий
                </span>
              )}
              {usesGenuineLeather && (
                <span className="lf-badge lf-badge--brass">
                  <ShieldIcon size={12} /> Натуральная кожа · в RFQ запрет подмены на PU/PVC
                </span>
              )}
            </div>
          )}

          {component.materials.length === 0 ? (
            <div className="lf-alert">
              <span>
                Материалы не заданы — в документе будет указано «На подтверждение фабрике». Добавьте корпус, подвес или рассеиватель.
              </span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {component.materials.map((mat, matIndex) => {
                const detailOpen = Boolean(
                  expandedMaterialDetails[mat.id] || mat.materialDetail || mat.finishDetail,
                );
                const partErr = issueText(['materials', matIndex, 'part']);
                return (
                  <div key={mat.id} className="lf-item-row">
                    <div className="lf-item-row-head">
                      <span className="lf-field-hint" style={{ fontWeight: 600 }}>
                        Позиция #{matIndex + 1}
                      </span>
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        <button
                          type="button"
                          className="lf-btn lf-btn--subtle lf-btn--sm"
                          onClick={() =>
                            setExpandedMaterialDetails(prev => ({ ...prev, [mat.id]: !detailOpen }))
                          }
                        >
                          {detailOpen ? 'Скрыть уточнения' : 'Уточнения'}
                        </button>
                        <button
                          type="button"
                          className="lf-btn lf-btn--danger lf-btn--icon"
                          aria-label={`Удалить материал ${mat.part}`}
                          onClick={() =>
                            update(current => ({
                              ...current,
                              materials: current.materials.filter(item => item.id !== mat.id),
                            }))
                          }
                        >
                          <TrashIcon size={14} />
                        </button>
                      </div>
                    </div>

                    <div className="lf-grid-2">
                      <div className="lf-field">
                        <label className="lf-label" htmlFor={`mat-part-${mat.id}`}>
                          Деталь
                        </label>
                        <input
                          id={`mat-part-${mat.id}`}
                          type="text"
                          className={`lf-input${partErr ? ' lf-input--error' : ''}`}
                          value={mat.part}
                          maxLength={120}
                          placeholder="Например: Корпус дуги / Ремень подвеса"
                          onChange={event =>
                            updateMaterial(mat.id, item => ({ ...item, part: event.target.value }))
                          }
                        />
                        {partErr && <span className="lf-field-error">{partErr}</span>}
                      </div>

                      <div className="lf-field">
                        <label className="lf-label" htmlFor={`mat-type-${mat.id}`}>
                          Материал
                        </label>
                        <select
                          id={`mat-type-${mat.id}`}
                          className="lf-select"
                          value={mat.material}
                          onChange={event =>
                            updateMaterial(mat.id, item => ({
                              ...item,
                              material: event.target.value as Material['material'],
                            }))
                          }
                        >
                          {materialKeys.map(key => (
                            <option key={key} value={key}>
                              {materials[key][0]} ({materials[key][1]})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="lf-field">
                        <label className="lf-label" htmlFor={`mat-finish-${mat.id}`}>
                          Отделка (отдельное поле)
                        </label>
                        <select
                          id={`mat-finish-${mat.id}`}
                          className="lf-select"
                          value={mat.finish ?? ''}
                          onChange={event => {
                            const val = event.target.value as NonNullable<Material['finish']> | '';
                            updateMaterial(mat.id, item => {
                              const next = { ...item };
                              if (val) next.finish = val;
                              else delete next.finish;
                              return next;
                            });
                          }}
                        >
                          <option value="">На подтверждение фабрике</option>
                          {finishKeys.map(key => (
                            <option key={key} value={key}>
                              {finishes[key][0]}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="lf-field">
                        <label className="lf-label" htmlFor={`mat-color-${mat.id}`}>
                          Цвет / RAL (отдельное поле)
                        </label>
                        <input
                          id={`mat-color-${mat.id}`}
                          type="text"
                          className="lf-input"
                          value={mat.color ?? ''}
                          maxLength={120}
                          placeholder="Например: RAL 9005 / Cognac brown"
                          onChange={event => {
                            const val = event.target.value;
                            updateMaterial(mat.id, item => {
                              const next = { ...item };
                              if (val.trim()) next.color = val;
                              else delete next.color;
                              return next;
                            });
                          }}
                        />
                      </div>
                    </div>

                    {detailOpen && (
                      <div className="lf-grid-2">
                        <div className="lf-field">
                          <label className="lf-label" htmlFor={`mat-detail-${mat.id}`}>
                            Уточнение материала
                          </label>
                          <input
                            id={`mat-detail-${mat.id}`}
                            type="text"
                            className="lf-input"
                            value={mat.materialDetail ?? ''}
                            maxLength={1000}
                            placeholder="Марка сплава, толщина кожи, требования..."
                            onChange={event => {
                              const val = event.target.value;
                              updateMaterial(mat.id, item => {
                                const next = { ...item };
                                if (val.trim()) next.materialDetail = val;
                                else delete next.materialDetail;
                                return next;
                              });
                            }}
                          />
                        </div>
                        <div className="lf-field">
                          <label className="lf-label" htmlFor={`mat-fdetail-${mat.id}`}>
                            Уточнение отделки
                          </label>
                          <input
                            id={`mat-fdetail-${mat.id}`}
                            type="text"
                            className="lf-input"
                            value={mat.finishDetail ?? ''}
                            maxLength={1000}
                            placeholder="Степень матовости, защитный лак..."
                            onChange={event => {
                              const val = event.target.value;
                              updateMaterial(mat.id, item => {
                                const next = { ...item };
                                if (val.trim()) next.finishDetail = val;
                                else delete next.finishDetail;
                                return next;
                              });
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
