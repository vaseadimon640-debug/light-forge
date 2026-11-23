'use client';

import type { ResolvedComposition } from '@/geometry/result';
import type { Canopy, Composition } from '@/geometry/schema';
import { AxisInput } from './AxisInput';
import {
  formatMm,
  formatSuspensionFormula,
  qualityLabels,
  removeSuspensionGuidePoint,
  suspensionTypeLabels,
  switchCanopyFootprint,
  translateMissingKey,
  type GeometryFieldIssue,
} from './helpers';

type CanopiesTabProps = {
  composition: Composition;
  resolved: ResolvedComposition | null;
  selectedCanopyId: string | null;
  onSelectCanopy: (id: string) => void;
  onAddCanopy: (type: Canopy['footprint']['type']) => void;
  onRemoveCanopy: (id: string) => void;
  onRemoveExit: (canopyId: string, exitId: string) => void;
  onUpdateCanopy: (id: string, updater: (canopy: Canopy) => Canopy) => void;
  issues: GeometryFieldIssue[];
};

export function CanopiesTab({
  composition,
  resolved,
  selectedCanopyId,
  onSelectCanopy,
  onAddCanopy,
  onRemoveCanopy,
  onRemoveExit,
  onUpdateCanopy,
  issues,
}: CanopiesTabProps) {
  const index = composition.canopies.findIndex(c => c.id === selectedCanopyId);
  const canopy = composition.canopies[index >= 0 ? index : 0];
  const activeIdx = index >= 0 ? index : 0;
  const resolvedCanopy = canopy ? resolved?.canopies.find(c => c.id === canopy.id) : undefined;

  const issueFor = (...sub: (string | number)[]) =>
    issues.find(
      issue =>
        issue.path[0] === 'canopies' &&
        issue.path[1] === activeIdx &&
        sub.every((seg, i) => issue.path[2 + i] === seg),
    )?.message;

  const canopyNameErr = issueFor('name');

  return (
    <>
      <div className="lfg-section">
        <div className="lfg-section-head">
          <h3 className="lfg-section-title">Потолочные основания ({composition.canopies.length})</h3>
          <div style={{ display: 'inline-flex', gap: 5 }}>
            <button id="lfg-add-round-canopy" type="button" className="lfg-btn lfg-btn--sm" onClick={() => onAddCanopy('round')}>
              + Круглое
            </button>
            <button id="lfg-add-rect-canopy" type="button" className="lfg-btn lfg-btn--sm" onClick={() => onAddCanopy('rectangular')}>
              + Линейное
            </button>
          </div>
        </div>

        {composition.canopies.length === 0 ? (
          <div className="lfg-alert lfg-alert--info">
            Потолочные основания пока не заданы. Для MYLINE основания неизвестны по умолчанию — добавьте основание,
            чтобы задать точки выхода тросов или ремней.
          </div>
        ) : (
          <div className="lfg-chip-list">
            {composition.canopies.map(c => (
              <button
                key={c.id}
                type="button"
                className={`lfg-chip${canopy && c.id === canopy.id ? ' lfg-chip--active' : ''}`}
                onClick={() => onSelectCanopy(c.id)}
              >
                {c.name || '(без названия)'}
              </button>
            ))}
          </div>
        )}
      </div>

      {canopy && (
        <>
          <div className="lfg-section">
            <div className="lfg-section-head">
              <h3 className="lfg-section-title">Геометрия и позиция основания</h3>
              <button type="button" className="lfg-btn lfg-btn--danger lfg-btn--sm" onClick={() => onRemoveCanopy(canopy.id)}>
                Удалить
              </button>
            </div>

            <div className="lfg-grid-2">
              <div className="lfg-field">
                <label className="lfg-label" htmlFor={`canopy-name-${canopy.id}`}>Название</label>
                <input
                  id={`canopy-name-${canopy.id}`}
                  type="text"
                  className={`lfg-input${canopyNameErr ? ' lfg-input--err' : ''}`}
                  value={canopy.name}
                  onChange={e => onUpdateCanopy(canopy.id, cur => ({ ...cur, name: e.target.value }))}
                />
                {canopyNameErr && <span className="lfg-err-text">{canopyNameErr}</span>}
              </div>

              <div className="lfg-field">
                <label className="lfg-label" htmlFor={`canopy-footprint-${canopy.id}`}>Форма основания</label>
                <select
                  id={`canopy-footprint-${canopy.id}`}
                  className="lfg-select"
                  value={canopy.footprint.type}
                  onChange={e =>
                    onUpdateCanopy(canopy.id, cur =>
                      switchCanopyFootprint(cur, e.target.value as Canopy['footprint']['type']),
                    )
                  }
                >
                  <option value="round">Круглое (round)</option>
                  <option value="rectangular">Прямоугольное / линейное (rectangular)</option>
                </select>
              </div>
            </div>

            <div className="lfg-grid-2">
              <AxisInput
                id={`canopy-drop-${canopy.id}`}
                label="Высота основания (drop)"
                min={0.001}
                value={canopy.dropMm}
                error={issueFor('dropMm')}
                onChange={next =>
                  next &&
                  onUpdateCanopy(canopy.id, cur => ({
                    ...cur,
                    dropMm: next,
                    // Keep ceilingFixings on the upper canopy face (z === dropMm)
                    ceilingFixings: cur.ceilingFixings.map(fix => ({
                      ...fix,
                      point: { ...fix.point, z: { ...fix.point.z, value: next.value } },
                    })),
                  }))
                }
              />

              {canopy.footprint.type === 'round' ? (
                <AxisInput
                  id={`canopy-diam-${canopy.id}`}
                  label="Диаметр основания"
                  min={0.001}
                  value={canopy.footprint.diameterMm}
                  onChange={next =>
                    next &&
                    onUpdateCanopy(canopy.id, cur =>
                      cur.footprint.type === 'round'
                        ? { ...cur, footprint: { ...cur.footprint, diameterMm: next } }
                        : cur,
                    )
                  }
                />
              ) : (
                <AxisInput
                  id={`canopy-w-${canopy.id}`}
                  label="Ширина основания (X)"
                  min={0.001}
                  value={canopy.footprint.widthMm}
                  onChange={next =>
                    next &&
                    onUpdateCanopy(canopy.id, cur =>
                      cur.footprint.type === 'rectangular'
                        ? { ...cur, footprint: { ...cur.footprint, widthMm: next } }
                        : cur,
                    )
                  }
                />
              )}
            </div>

            {canopy.footprint.type === 'rectangular' && (
              <AxisInput
                id={`canopy-d-${canopy.id}`}
                label="Глубина основания (Y)"
                min={0.001}
                value={canopy.footprint.depthMm}
                onChange={next =>
                  next &&
                  onUpdateCanopy(canopy.id, cur =>
                    cur.footprint.type === 'rectangular'
                      ? { ...cur, footprint: { ...cur.footprint, depthMm: next } }
                      : cur,
                  )
                }
              />
            )}

            <div className="lfg-grid-2">
              <AxisInput
                id={`canopy-x-${canopy.id}`}
                label="X (ширина)"
                optional
                value={canopy.position.x}
                onChange={next =>
                  onUpdateCanopy(canopy.id, cur => {
                    const pos = { ...cur.position };
                    if (next) pos.x = next;
                    else delete pos.x;
                    return { ...cur, position: pos };
                  })
                }
              />
              <AxisInput
                id={`canopy-y-${canopy.id}`}
                label="Y (глубина)"
                optional
                value={canopy.position.y}
                onChange={next =>
                  onUpdateCanopy(canopy.id, cur => {
                    const pos = { ...cur.position };
                    if (next) pos.y = next;
                    else delete pos.y;
                    return { ...cur, position: pos };
                  })
                }
              />
              <AxisInput
                id={`canopy-yaw-${canopy.id}`}
                label="Поворот yaw"
                unit="°"
                optional
                min={-360}
                max={360}
                value={canopy.yawDeg}
                onChange={next =>
                  onUpdateCanopy(canopy.id, cur => {
                    const nextC = { ...cur };
                    if (next) nextC.yawDeg = next;
                    else delete nextC.yawDeg;
                    return nextC;
                  })
                }
              />
            </div>

            {resolvedCanopy && (
              <div className="lfg-hint lfg-mono">
                Нижняя грань основания Z: {formatMm(resolvedCanopy.origin.z)}
              </div>
            )}
          </div>

          {/* Canopy Exits */}
          <div className="lfg-section">
            <div className="lfg-section-head">
              <h3 className="lfg-section-title">Точки выхода подвесов ({canopy.exits.length})</h3>
              <button
                id={`lfg-add-exit-${canopy.id}`}
                type="button"
                className="lfg-btn lfg-btn--sm"
                onClick={() =>
                  onUpdateCanopy(canopy.id, cur => ({
                    ...cur,
                    exits: [
                      ...cur.exits,
                      {
                        id: `exit-${crypto.randomUUID().slice(0, 5)}`,
                        label: `Выход ${cur.exits.length + 1}`,
                        point: {
                          x: { value: 0, source: 'user' },
                          y: { value: 0, source: 'user' },
                          z: { value: 0, source: 'user' },
                        },
                      },
                    ],
                  }))
                }
              >
                + Выход
              </button>
            </div>

            {canopy.exits.map((exit, exitIdx) => {
              const err = issueFor('exits', exitIdx, 'point');
              const linkedCount = composition.suspensions.filter(
                s => s.from.canopyId === canopy.id && s.from.exitId === exit.id,
              ).length;
              return (
                <div
                  key={exit.id}
                  style={{
                    padding: 9,
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border)',
                    background: 'var(--bg-surface)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 7,
                  }}
                >
                  <div className="lfg-section-head">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                      <input
                        type="text"
                        className="lfg-input"
                        style={{ maxWidth: 180, minHeight: 28, fontSize: 12 }}
                        value={exit.label}
                        onChange={e =>
                          onUpdateCanopy(canopy.id, cur => ({
                            ...cur,
                            exits: cur.exits.map(ex => (ex.id === exit.id ? { ...ex, label: e.target.value } : ex)),
                          }))
                        }
                      />
                      {linkedCount > 0 && (
                        <span className="lfg-badge lfg-badge--accent" title="При удалении выхода связанные подвесы также будут удалены">
                          Подвесов: {linkedCount}
                        </span>
                      )}
                    </div>
                    <button
                      id={`remove-exit-${canopy.id}-${exit.id}`}
                      type="button"
                      className="lfg-btn lfg-btn--danger lfg-btn--sm"
                      onClick={() => onRemoveExit(canopy.id, exit.id)}
                    >
                      Удалить
                    </button>
                  </div>
                  <div className="lfg-grid-3">
                    {(['x', 'y', 'z'] as const).map(coord => (
                      <AxisInput
                        key={coord}
                        id={`exit-${exit.id}-${coord}`}
                        label={coord.toUpperCase()}
                        value={exit.point[coord]}
                        onChange={next =>
                          next &&
                          onUpdateCanopy(canopy.id, cur => ({
                            ...cur,
                            exits: cur.exits.map((ex, i) =>
                              i === exitIdx ? { ...ex, point: { ...ex.point, [coord]: next } } : ex,
                            ),
                          }))
                        }
                      />
                    ))}
                  </div>
                  {err && <span className="lfg-err-text">{err}</span>}
                </div>
              );
            })}
          </div>

          {/* Ceiling Fixings (upper canopy face, z === dropMm) */}
          <div className="lfg-section">
            <div className="lfg-section-head">
              <h3 className="lfg-section-title">Крепления к потолку ({canopy.ceilingFixings.length})</h3>
              <button
                id={`lfg-add-fixing-${canopy.id}`}
                type="button"
                className="lfg-btn lfg-btn--sm"
                onClick={() =>
                  onUpdateCanopy(canopy.id, cur => ({
                    ...cur,
                    ceilingFixings: [
                      ...cur.ceilingFixings,
                      {
                        id: `fix-${crypto.randomUUID().slice(0, 5)}`,
                        label: `Крепление ${cur.ceilingFixings.length + 1}`,
                        point: {
                          x: { value: 0, source: 'user' },
                          y: { value: 0, source: 'user' },
                          z: { value: cur.dropMm.value, source: cur.dropMm.source },
                        },
                      },
                    ],
                  }))
                }
              >
                + Крепление
              </button>
            </div>

            {canopy.ceilingFixings.length === 0 ? (
              <div className="lfg-hint">
                Точки крепления основания к потолку не заданы. По умолчанию лежат на верхней грани (Z = {canopy.dropMm.value} мм).
              </div>
            ) : (
              canopy.ceilingFixings.map((fix, fixIdx) => {
                const err = issueFor('ceilingFixings', fixIdx, 'point');
                const resolvedFix = resolvedCanopy?.ceilingFixings.find(item => item.id === fix.id);
                const worldKnown =
                  resolvedFix &&
                  resolvedFix.world.x.valueMm !== null &&
                  resolvedFix.world.y.valueMm !== null &&
                  resolvedFix.world.z.valueMm !== null;
                return (
                  <div
                    key={fix.id}
                    style={{
                      padding: 9,
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border)',
                      background: 'var(--bg-surface)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 7,
                    }}
                  >
                    <div className="lfg-section-head">
                      <input
                        type="text"
                        className="lfg-input"
                        style={{ maxWidth: 195, minHeight: 28, fontSize: 12 }}
                        value={fix.label}
                        onChange={e =>
                          onUpdateCanopy(canopy.id, cur => ({
                            ...cur,
                            ceilingFixings: cur.ceilingFixings.map(item =>
                              item.id === fix.id ? { ...item, label: e.target.value } : item,
                            ),
                          }))
                        }
                      />
                      <button
                        id={`remove-fixing-${canopy.id}-${fix.id}`}
                        type="button"
                        className="lfg-btn lfg-btn--danger lfg-btn--sm"
                        onClick={() =>
                          onUpdateCanopy(canopy.id, cur => ({
                            ...cur,
                            ceilingFixings: cur.ceilingFixings.filter(item => item.id !== fix.id),
                          }))
                        }
                      >
                        Удалить
                      </button>
                    </div>
                    <div className="lfg-grid-2">
                      {(['x', 'y'] as const).map(coord => (
                        <AxisInput
                          key={coord}
                          id={`fix-${fix.id}-${coord}`}
                          label={`Лок. ${coord.toUpperCase()}`}
                          value={fix.point[coord]}
                          onChange={next =>
                            next &&
                            onUpdateCanopy(canopy.id, cur => ({
                              ...cur,
                              ceilingFixings: cur.ceilingFixings.map((item, i) =>
                                i === fixIdx
                                  ? {
                                      ...item,
                                      point: {
                                        ...item.point,
                                        [coord]: next,
                                        z: { ...item.point.z, value: cur.dropMm.value },
                                      },
                                    }
                                  : item,
                              ),
                            }))
                          }
                        />
                      ))}
                    </div>
                    <div className="lfg-hint lfg-mono">
                      Верхняя грань Z = {canopy.dropMm.value} мм
                      {worldKnown
                        ? ` · Мир: (${Math.round(resolvedFix.world.x.valueMm!)}, ${Math.round(resolvedFix.world.y.valueMm!)}, ${Math.round(resolvedFix.world.z.valueMm!)}) мм`
                        : ''}
                    </div>
                    {err && <span className="lfg-err-text">{err}</span>}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </>
  );
}

type SuspensionsTabProps = {
  composition: Composition;
  resolved: ResolvedComposition | null;
  selectedSuspensionId: string | null;
  onSelectSuspension: (id: string) => void;
  onAddSuspension: (type: Composition['suspensions'][number]['type']) => void;
  onRemoveSuspension: (id: string) => void;
  onUpdateSuspension: (
    id: string,
    updater: (s: Composition['suspensions'][number]) => Composition['suspensions'][number],
  ) => void;
};

export function SuspensionsTab({
  composition,
  resolved,
  selectedSuspensionId,
  onSelectSuspension,
  onAddSuspension,
  onRemoveSuspension,
  onUpdateSuspension,
}: SuspensionsTabProps) {
  const canCreate =
    composition.canopies.some(c => c.exits.length > 0) &&
    composition.elements.some(el => el.attachments.length > 0);
  const selected =
    composition.suspensions.find(s => s.id === selectedSuspensionId) ?? composition.suspensions[0];
  const resolvedSusp = selected ? resolved?.suspensions.find(s => s.id === selected.id) : undefined;

  const fromOptions = composition.canopies.flatMap(canopy =>
    canopy.exits.map(exit => ({
      value: `${canopy.id}::${exit.id}`,
      label: `${canopy.name} → ${exit.label}`,
    })),
  );
  const toOptions = composition.elements.flatMap(el =>
    el.attachments.map(att => ({
      value: `${el.id}::${att.id}`,
      label: `${el.name} → ${att.label}`,
    })),
  );
  const selectedFromVal = selected ? `${selected.from.canopyId}::${selected.from.exitId}` : '';
  const selectedToVal = selected ? `${selected.to.elementId}::${selected.to.attachmentId}` : '';
  const fromMissing = Boolean(selected && !fromOptions.some(o => o.value === selectedFromVal));
  const toMissing = Boolean(selected && !toOptions.some(o => o.value === selectedToVal));

  return (
    <>
      <div className="lfg-section">
        <div className="lfg-section-head">
          <h3 className="lfg-section-title">Тросы и ремни ({composition.suspensions.length})</h3>
          <div style={{ display: 'inline-flex', gap: 5 }}>
            <button
              id="lfg-add-cable-btn"
              type="button"
              className="lfg-btn lfg-btn--sm"
              disabled={!canCreate}
              onClick={() => onAddSuspension('loadBearingCable')}
            >
              + Трос
            </button>
            <button
              id="lfg-add-strap-btn"
              type="button"
              className="lfg-btn lfg-btn--brass lfg-btn--sm"
              disabled={!canCreate}
              onClick={() => onAddSuspension('decorativeStrap')}
            >
              + Ремень
            </button>
          </div>
        </div>

        {!canCreate && (
          <div className="lfg-alert lfg-alert--info">
            Чтобы добавить трос или ремень, сначала задайте потолочное основание с точкой выхода и точку крепления на элементе.
          </div>
        )}

        {composition.suspensions.length === 0 ? (
          <div className="lfg-hint">
            Подвесы не заданы. Окончательная длина заготовки не вычисляется и не подставляется автоматически.
          </div>
        ) : (
          <div className="lfg-chip-list">
            {composition.suspensions.map(s => {
              const rs = resolved?.suspensions.find(item => item.id === s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`lfg-chip${selected && s.id === selected.id ? ' lfg-chip--active' : ''}`}
                  onClick={() => onSelectSuspension(s.id)}
                >
                  <span>{s.type === 'loadBearingCable' ? 'Трос' : 'Ремень'} · {s.id}</span>
                  {rs?.status === 'invalid' && <span className="lfg-badge lfg-badge--danger">!</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {selected && (
        <div className="lfg-section">
          <div className="lfg-section-head">
            <h3 className="lfg-section-title">{suspensionTypeLabels[selected.type]}</h3>
            <button
              type="button"
              className="lfg-btn lfg-btn--danger lfg-btn--sm"
              onClick={() => onRemoveSuspension(selected.id)}
            >
              Удалить
            </button>
          </div>

          <div className="lfg-grid-2">
            <div className="lfg-field">
              <label className="lfg-label" htmlFor={`susp-type-${selected.id}`}>Тип подвеса</label>
              <select
                id={`susp-type-${selected.id}`}
                className="lfg-select"
                value={selected.type}
                onChange={e =>
                  onUpdateSuspension(selected.id, cur => ({
                    ...cur,
                    type: e.target.value as Composition['suspensions'][number]['type'],
                  }))
                }
              >
                <option value="loadBearingCable">Несущий трос (loadBearingCable)</option>
                <option value="decorativeStrap">Декоративный ремень (decorativeStrap)</option>
              </select>
            </div>

            <AxisInput
              id={`susp-allow-${selected.id}`}
              label="Припуск на заготовку"
              optional
              min={0}
              placeholder="Не указан"
              value={selected.allowanceMm}
              onChange={next =>
                onUpdateSuspension(selected.id, cur => {
                  const updated = { ...cur };
                  if (next) updated.allowanceMm = next;
                  else delete updated.allowanceMm;
                  return updated;
                })
              }
            />
          </div>

          {/* From canopy exit & To element attachment */}
          <div className="lfg-grid-2">
            <div className="lfg-field">
              <label className="lfg-label" htmlFor={`susp-from-${selected.id}`}>Выход основания</label>
              <select
                id={`susp-from-${selected.id}`}
                className={`lfg-select${fromMissing ? ' lfg-input--err' : ''}`}
                value={selectedFromVal}
                onChange={e => {
                  const [canopyId, exitId] = e.target.value.split('::');
                  onUpdateSuspension(selected.id, cur => ({ ...cur, from: { canopyId, exitId } }));
                }}
              >
                {fromMissing && (
                  <option value={selectedFromVal}>[Отсутствующий выход: {selected.from.exitId}]</option>
                )}
                {fromOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="lfg-field">
              <label className="lfg-label" htmlFor={`susp-to-${selected.id}`}>Крепление элемента</label>
              <select
                id={`susp-to-${selected.id}`}
                className={`lfg-select${toMissing ? ' lfg-input--err' : ''}`}
                value={selectedToVal}
                onChange={e => {
                  const [elementId, attachmentId] = e.target.value.split('::');
                  onUpdateSuspension(selected.id, cur => ({ ...cur, to: { elementId, attachmentId } }));
                }}
              >
                {toMissing && (
                  <option value={selectedToVal}>[Отсутствующее крепление: {selected.to.attachmentId}]</option>
                )}
                {toOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Routing: straight vs guided */}
          <div className="lfg-field">
            <label className="lfg-label" htmlFor={`susp-route-${selected.id}`}>Маршрут прокладки</label>
            <select
              id={`susp-route-${selected.id}`}
              className="lfg-select"
              value={selected.routing.type}
              onChange={e => {
                const mode = e.target.value as 'straight' | 'guided';
                onUpdateSuspension(selected.id, cur => ({
                  ...cur,
                  routing:
                    mode === 'straight'
                      ? { type: 'straight' }
                      : {
                          type: 'guided',
                          guides: [
                            {
                              x: { value: 200, source: 'user' },
                              y: { value: 0, source: 'user' },
                              z: { value: 2200, source: 'user' },
                            },
                          ],
                        },
                }));
              }}
            >
              <option value="straight">Прямая (1 отрезок)</option>
              <option value="guided">Через мировые направляющие (guided)</option>
            </select>
          </div>

          {selected.routing.type === 'guided' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="lfg-section-head">
                <span className="lfg-label">Точки направляющих ({selected.routing.guides.length})</span>
                <button
                  id={`add-guide-${selected.id}`}
                  type="button"
                  className="lfg-btn lfg-btn--sm"
                  disabled={selected.routing.guides.length >= 16}
                  onClick={() =>
                    onUpdateSuspension(selected.id, cur =>
                      cur.routing.type === 'guided'
                        ? {
                            ...cur,
                            routing: {
                              type: 'guided',
                              guides: [
                                ...cur.routing.guides,
                                {
                                  x: { value: 0, source: 'user' },
                                  y: { value: 0, source: 'user' },
                                  z: { value: 2000, source: 'user' },
                                },
                              ],
                            },
                          }
                        : cur,
                    )
                  }
                >
                  + Направляющая
                </button>
              </div>
              {selected.routing.guides.map((guide, gIdx) => (
                <div
                  key={gIdx}
                  style={{
                    padding: 9,
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border)',
                    background: 'var(--bg-surface)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 7,
                  }}
                >
                  <div className="lfg-section-head">
                    <span className="lfg-hint" style={{ fontWeight: 600 }}>
                      Направляющая #{gIdx + 1} (мировые мм)
                    </span>
                    <button
                      id={`remove-guide-${selected.id}-${gIdx}`}
                      type="button"
                      className="lfg-btn lfg-btn--danger lfg-btn--sm"
                      onClick={() =>
                        onUpdateSuspension(selected.id, cur => removeSuspensionGuidePoint(cur, gIdx))
                      }
                    >
                      Удалить
                    </button>
                  </div>
                  <div className="lfg-grid-3">
                    {(['x', 'y', 'z'] as const).map(coord => (
                      <AxisInput
                        key={coord}
                        id={`guide-${selected.id}-${gIdx}-${coord}`}
                        label={coord.toUpperCase()}
                        value={guide[coord]}
                        onChange={next =>
                          next &&
                          onUpdateSuspension(selected.id, cur =>
                            cur.routing.type === 'guided'
                              ? {
                                  ...cur,
                                  routing: {
                                    type: 'guided',
                                    guides: cur.routing.guides.map((pt, i) =>
                                      i === gIdx ? { ...pt, [coord]: next } : pt,
                                    ),
                                  },
                                }
                              : cur,
                          )
                        }
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Resolved engineering readout from Codex resolveComposition() */}
          {resolvedSusp && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="lfg-section-head">
                <span className="lfg-label">Результат расчёта (Codex Geometry)</span>
                <span
                  className={`lfg-badge ${
                    resolvedSusp.status === 'calculated'
                      ? 'lfg-badge--specified'
                      : resolvedSusp.status === 'invalid'
                        ? 'lfg-badge--danger'
                        : 'lfg-badge--unknown'
                  }`}
                >
                  {resolvedSusp.status === 'calculated'
                    ? 'Рассчитано'
                    : resolvedSusp.status === 'invalid'
                      ? 'Ошибка высоты'
                      : 'Неполные данные'}
                </span>
              </div>

              <table className="lfg-table">
                <tbody className="lfg-mono">
                  <tr>
                    <th>Вертикальный перепад</th>
                    <td>{formatMm(resolvedSusp.verticalDrop)} ({qualityLabels[resolvedSusp.verticalDrop.quality]})</td>
                  </tr>
                  <tr>
                    <th>Длина пути (pathLength)</th>
                    <td>{formatMm(resolvedSusp.pathLength)} ({qualityLabels[resolvedSusp.pathLength.quality]})</td>
                  </tr>
                  <tr>
                    <th>Длина заготовки (cutLength)</th>
                    <td>
                      <strong>{formatMm(resolvedSusp.cutLength)}</strong> ({qualityLabels[resolvedSusp.cutLength.quality]})
                    </td>
                  </tr>
                </tbody>
              </table>

              <div className="lfg-formula" title="Символьная формула зависимости от переменных уровней">
                {formatSuspensionFormula(resolvedSusp)}
              </div>

              {resolvedSusp.cutLength.quality === 'unknown' && (
                <div className="lfg-alert lfg-alert--warning">
                  <strong>Недостающий ввод для cutLength:</strong>
                  {resolvedSusp.cutLength.missing.map((m, i) => (
                    <span key={i}>• {translateMissingKey(m)}</span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
