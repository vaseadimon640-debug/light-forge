'use client';

import type { ResolvedComposition } from '@/geometry/result';
import type { Composition, Element, Shape } from '@/geometry/schema';
import { AxisInput } from './AxisInput';
import {
  createDefaultShape,
  datumLabels,
  formatMm,
  qualityLabels,
  shapeLabels,
  translateMissingKey,
  type GeometryFieldIssue,
} from './helpers';

type ElementsTabProps = {
  composition: Composition;
  resolved: ResolvedComposition | null;
  selectedElementId: string;
  onSelectElement: (id: string) => void;
  onAddElement: (shapeType: Shape['type']) => void;
  onRemoveElement: (id: string) => void;
  onRemoveAttachment: (elementId: string, attachmentId: string) => void;
  onUpdateElement: (id: string, updater: (el: Element) => Element) => void;
  issues: GeometryFieldIssue[];
};

const shapeTypes: Shape['type'][] = ['ring', 'arc', 'linear', 'envelope'];
const datums: Element['position']['lowest']['datum'][] = ['floor', 'ceiling', 'tabletop'];
const envelopeIntents: Extract<Shape, { type: 'envelope' }>['intendedShape'][] = ['arc', 'ring', 'linear', 'custom'];

export function ElementsTab({
  composition,
  resolved,
  selectedElementId,
  onSelectElement,
  onAddElement,
  onRemoveElement,
  onRemoveAttachment,
  onUpdateElement,
  issues,
}: ElementsTabProps) {
  const index = Math.max(
    0,
    composition.elements.findIndex(item => item.id === selectedElementId),
  );
  const element = composition.elements[index] ?? composition.elements[0];
  const resolvedEl = resolved?.elements.find(item => item.id === element.id);

  const issueFor = (...sub: (string | number)[]) =>
    issues.find(
      issue =>
        issue.path[0] === 'elements' &&
        issue.path[1] === index &&
        sub.every((seg, i) => issue.path[2 + i] === seg),
    )?.message;

  const update = (fn: (el: Element) => Element) => onUpdateElement(element.id, fn);
  const nameErr = issueFor('name');

  return (
    <>
      {/* Element Selector & Add Shape Buttons */}
      <div className="lfg-section">
        <div className="lfg-section-head">
          <h3 className="lfg-section-title">Элементы ({composition.elements.length})</h3>
          {composition.elements.length > 1 && (
            <button
              type="button"
              className="lfg-btn lfg-btn--danger lfg-btn--sm"
              onClick={() => onRemoveElement(element.id)}
            >
              Удалить выбранный
            </button>
          )}
        </div>

        <div className="lfg-chip-list">
          {composition.elements.map(item => (
            <button
              key={item.id}
              type="button"
              className={`lfg-chip${item.id === element.id ? ' lfg-chip--active' : ''}`}
              onClick={() => onSelectElement(item.id)}
            >
              <span>{item.name || '(без названия)'}</span>
              <span className="lfg-mono" style={{ opacity: 0.72, fontSize: 10.5 }}>
                {item.shape.type}
              </span>
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          <button id="lfg-add-ring-btn" type="button" className="lfg-btn lfg-btn--sm" onClick={() => onAddElement('ring')}>
            + Кольцо
          </button>
          <button id="lfg-add-arc-btn" type="button" className="lfg-btn lfg-btn--sm" onClick={() => onAddElement('arc')}>
            + Дуга
          </button>
          <button id="lfg-add-linear-btn" type="button" className="lfg-btn lfg-btn--sm" onClick={() => onAddElement('linear')}>
            + Линейный
          </button>
          <button id="lfg-add-envelope-btn" type="button" className="lfg-btn lfg-btn--sm" onClick={() => onAddElement('envelope')}>
            + Габарит
          </button>
        </div>
      </div>

      {/* Shape Parameters */}
      <div className="lfg-section">
        <div className="lfg-section-head">
          <h3 className="lfg-section-title">Форма и габариты</h3>
          {resolvedEl && (
            <span className={`lfg-badge ${resolvedEl.geometry.representation === 'envelope' ? 'lfg-badge--brass' : 'lfg-badge--specified'}`}>
              {resolvedEl.geometry.representation === 'envelope' ? 'Габаритная оболочка' : 'Параметрическая форма'}
            </span>
          )}
        </div>

        <div className="lfg-grid-2">
          <div className="lfg-field">
            <label className="lfg-label" htmlFor={`el-name-${element.id}`}>Название</label>
            <input
              id={`el-name-${element.id}`}
              type="text"
              className={`lfg-input${nameErr ? ' lfg-input--err' : ''}`}
              value={element.name}
              onChange={e => update(cur => ({ ...cur, name: e.target.value }))}
            />
            {nameErr && <span className="lfg-err-text">{nameErr}</span>}
          </div>

          <div className="lfg-field">
            <label className="lfg-label" htmlFor={`el-shape-${element.id}`}>Тип формы</label>
            <select
              id={`el-shape-${element.id}`}
              className="lfg-select"
              value={element.shape.type}
              onChange={e => update(cur => ({ ...cur, shape: createDefaultShape(e.target.value as Shape['type']) }))}
            >
              {shapeTypes.map(st => (
                <option key={st} value={st}>{shapeLabels[st]}</option>
              ))}
            </select>
          </div>
        </div>

        {element.shape.type === 'ring' && (
          <div className="lfg-grid-2">
            <AxisInput
              id={`ring-od-${element.id}`}
              label="Внешний диаметр"
              min={0.001}
              value={element.shape.outerDiameterMm}
              error={issueFor('shape', 'outerDiameterMm')}
              onChange={next =>
                next && update(c => c.shape.type === 'ring' ? { ...c, shape: { ...c.shape, outerDiameterMm: next } } : c)
              }
            />
            <AxisInput
              id={`ring-id-${element.id}`}
              label="Внутренний диаметр"
              min={0.001}
              value={element.shape.innerDiameterMm}
              error={issueFor('shape', 'innerDiameterMm')}
              onChange={next =>
                next && update(c => c.shape.type === 'ring' ? { ...c, shape: { ...c.shape, innerDiameterMm: next } } : c)
              }
            />
            <AxisInput
              id={`ring-h-${element.id}`}
              label="Высота профиля"
              min={0.001}
              value={element.shape.profileHeightMm}
              error={issueFor('shape', 'profileHeightMm')}
              onChange={next =>
                next && update(c => c.shape.type === 'ring' ? { ...c, shape: { ...c.shape, profileHeightMm: next } } : c)
              }
            />
          </div>
        )}

        {element.shape.type === 'arc' && (
          <>
            <div className="lfg-grid-2">
              <AxisInput
                id={`arc-chord-${element.id}`}
                label="Хорда средней линии"
                min={0.001}
                value={element.shape.chordMm}
                error={issueFor('shape', 'chordMm')}
                onChange={next =>
                  next && update(c => c.shape.type === 'arc' ? { ...c, shape: { ...c.shape, chordMm: next } } : c)
                }
              />
              <AxisInput
                id={`arc-rise-${element.id}`}
                label="Стрела (≤ ½ хорды)"
                min={0.001}
                value={element.shape.riseMm}
                error={issueFor('shape', 'riseMm')}
                onChange={next =>
                  next && update(c => c.shape.type === 'arc' ? { ...c, shape: { ...c.shape, riseMm: next } } : c)
                }
              />
              <AxisInput
                id={`arc-thick-${element.id}`}
                label="Радиальная толщина"
                min={0.001}
                value={element.shape.radialThicknessMm}
                error={issueFor('shape', 'radialThicknessMm')}
                onChange={next =>
                  next && update(c => c.shape.type === 'arc' ? { ...c, shape: { ...c.shape, radialThicknessMm: next } } : c)
                }
              />
              <AxisInput
                id={`arc-depth-${element.id}`}
                label="Глубина по Y"
                min={0.001}
                value={element.shape.depthMm}
                error={issueFor('shape', 'depthMm')}
                onChange={next =>
                  next && update(c => c.shape.type === 'arc' ? { ...c, shape: { ...c.shape, depthMm: next } } : c)
                }
              />
            </div>
            {resolvedEl?.geometry.arc && (
              <div className="lfg-hint lfg-mono">
                Расчёт Codex: R={Math.round(resolvedEl.geometry.arc.centerlineRadiusMm * 10) / 10} мм ·
                габарит {Math.round(resolvedEl.geometry.widthMm * 10) / 10}×{Math.round(resolvedEl.geometry.heightMm * 10) / 10} мм
              </div>
            )}
          </>
        )}

        {element.shape.type === 'linear' && (
          <div className="lfg-grid-2">
            <AxisInput
              id={`lin-len-${element.id}`}
              label="Длина по X"
              min={0.001}
              value={element.shape.lengthMm}
              onChange={next =>
                next && update(c => c.shape.type === 'linear' ? { ...c, shape: { ...c.shape, lengthMm: next } } : c)
              }
            />
            <AxisInput
              id={`lin-w-${element.id}`}
              label="Ширина по Y"
              min={0.001}
              value={element.shape.widthMm}
              onChange={next =>
                next && update(c => c.shape.type === 'linear' ? { ...c, shape: { ...c.shape, widthMm: next } } : c)
              }
            />
            <AxisInput
              id={`lin-h-${element.id}`}
              label="Высота по Z"
              min={0.001}
              value={element.shape.heightMm}
              onChange={next =>
                next && update(c => c.shape.type === 'linear' ? { ...c, shape: { ...c.shape, heightMm: next } } : c)
              }
            />
          </div>
        )}

        {element.shape.type === 'envelope' && (
          <>
            <div className="lfg-alert lfg-alert--warning">
              <strong>Режим габаритной оболочки (envelope):</strong> отображает только подтверждённый габарит без
              вымышленного радиуса и профиля.
            </div>
            <div className="lfg-grid-2">
              <div className="lfg-field">
                <label className="lfg-label" htmlFor={`env-intent-${element.id}`}>Предполагаемый тип</label>
                <select
                  id={`env-intent-${element.id}`}
                  className="lfg-select"
                  value={element.shape.intendedShape}
                  onChange={e =>
                    update(c =>
                      c.shape.type === 'envelope'
                        ? { ...c, shape: { ...c.shape, intendedShape: e.target.value as Extract<Shape, { type: 'envelope' }>['intendedShape'] } }
                        : c,
                    )
                  }
                >
                  {envelopeIntents.map(intent => (
                    <option key={intent} value={intent}>{intent}</option>
                  ))}
                </select>
              </div>
              <AxisInput
                id={`env-w-${element.id}`}
                label="Ширина габарита"
                min={0.001}
                value={element.shape.widthMm}
                onChange={next =>
                  next && update(c => c.shape.type === 'envelope' ? { ...c, shape: { ...c.shape, widthMm: next } } : c)
                }
              />
              <AxisInput
                id={`env-d-${element.id}`}
                label="Глубина габарита"
                min={0.001}
                value={element.shape.depthMm}
                onChange={next =>
                  next && update(c => c.shape.type === 'envelope' ? { ...c, shape: { ...c.shape, depthMm: next } } : c)
                }
              />
              <AxisInput
                id={`env-h-${element.id}`}
                label="Высота габарита"
                min={0.001}
                value={element.shape.heightMm}
                onChange={next =>
                  next && update(c => c.shape.type === 'envelope' ? { ...c, shape: { ...c.shape, heightMm: next } } : c)
                }
              />
            </div>
          </>
        )}
      </div>

      {/* Position, Datum & Elevation */}
      <div className="lfg-section">
        <div className="lfg-section-head">
          <h3 className="lfg-section-title">Положение и отметка низа корпуса</h3>
          {resolvedEl && resolvedEl.issues.length > 0 && (
            <span className="lfg-badge lfg-badge--danger">
              {resolvedEl.issues.includes('bodyAboveCeiling') ? 'Выше потолка!' : 'Ниже пола!'}
            </span>
          )}
        </div>

        <div className="lfg-grid-2">
          <div className="lfg-field">
            <label className="lfg-label" htmlFor={`el-datum-${element.id}`}>База отсчёта (datum)</label>
            <select
              id={`el-datum-${element.id}`}
              className="lfg-select"
              value={element.position.lowest.datum}
              onChange={e => {
                const nextDatum = e.target.value as Element['position']['lowest']['datum'];
                update(cur => {
                  let val = cur.position.lowest.offsetMm.value;
                  if (nextDatum === 'ceiling' && val > 0) val = -Math.abs(val);
                  if (nextDatum === 'floor' && val < 0) val = Math.abs(val);
                  return {
                    ...cur,
                    position: {
                      ...cur.position,
                      lowest: { datum: nextDatum, offsetMm: { ...cur.position.lowest.offsetMm, value: val } },
                    },
                  };
                });
              }}
            >
              {datums.map(d => (
                <option key={d} value={d}>{datumLabels[d]}</option>
              ))}
            </select>
          </div>

          <AxisInput
            id={`el-offset-${element.id}`}
            label={element.position.lowest.datum === 'ceiling' ? 'Отступ (≤ 0)' : 'Отступ от базы'}
            value={element.position.lowest.offsetMm}
            error={issueFor('position', 'lowest')}
            onChange={next =>
              next &&
              update(cur => ({
                ...cur,
                position: { ...cur.position, lowest: { ...cur.position.lowest, offsetMm: next } },
              }))
            }
          />
        </div>

        <div className="lfg-grid-2">
          <AxisInput
            id={`el-x-${element.id}`}
            label="X (ширина)"
            optional
            value={element.position.xy.x}
            onChange={next =>
              update(cur => {
                const xy = { ...cur.position.xy };
                if (next) xy.x = next;
                else delete xy.x;
                return { ...cur, position: { ...cur.position, xy } };
              })
            }
          />
          <AxisInput
            id={`el-y-${element.id}`}
            label="Y (глубина)"
            optional
            value={element.position.xy.y}
            onChange={next =>
              update(cur => {
                const xy = { ...cur.position.xy };
                if (next) xy.y = next;
                else delete xy.y;
                return { ...cur, position: { ...cur.position, xy } };
              })
            }
          />
          <AxisInput
            id={`el-yaw-${element.id}`}
            label="Поворот yaw"
            unit="°"
            optional
            min={-360}
            max={360}
            value={element.position.yawDeg}
            onChange={next =>
              update(cur => {
                const pos = { ...cur.position };
                if (next) pos.yawDeg = next;
                else delete pos.yawDeg;
                return { ...cur, position: pos };
              })
            }
          />
        </div>

        {resolvedEl && (
          <table className="lfg-table">
            <thead>
              <tr>
                <th>Уровень</th>
                <th>Низ корпуса</th>
                <th>Верх корпуса</th>
              </tr>
            </thead>
            <tbody className="lfg-mono">
              <tr>
                <td>От пола</td>
                <td>{formatMm(resolvedEl.lowest.fromFloor)}</td>
                <td>{formatMm(resolvedEl.highest.fromFloor)}</td>
              </tr>
              <tr>
                <td>Под потолком</td>
                <td>{formatMm(resolvedEl.lowest.belowCeiling)}</td>
                <td>{formatMm(resolvedEl.highest.belowCeiling)}</td>
              </tr>
              <tr>
                <td>Над столом</td>
                <td>{formatMm(resolvedEl.lowest.aboveTabletop)}</td>
                <td>{formatMm(resolvedEl.highest.aboveTabletop)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {/* Element Attachment Points */}
      <div className="lfg-section">
        <div className="lfg-section-head">
          <h3 className="lfg-section-title">Точки крепления элемента ({element.attachments.length})</h3>
          <button
            id={`lfg-add-att-${element.id}`}
            type="button"
            className="lfg-btn lfg-btn--sm"
            onClick={() =>
              update(cur => ({
                ...cur,
                attachments: [
                  ...cur.attachments,
                  {
                    id: `att-${crypto.randomUUID().slice(0, 5)}`,
                    label: `Крепление ${cur.attachments.length + 1}`,
                    point: {
                      x: { value: 0, source: 'user' },
                      y: { value: 0, source: 'user' },
                      z: { value: resolvedEl ? Math.round(resolvedEl.geometry.heightMm) : 40, source: 'user' },
                    },
                  },
                ],
              }))
            }
          >
            + Точка
          </button>
        </div>

        {element.attachments.length === 0 ? (
          <div className="lfg-hint">
            Точки крепления не заданы. Добавьте локальные координаты (от центра низа корпуса), чтобы подключить трос или ремень.
          </div>
        ) : (
          element.attachments.map((att, attIdx) => {
            const resolvedAtt = resolvedEl?.attachments.find(a => a.id === att.id);
            const linkedCount = composition.suspensions.filter(
              s => s.to.elementId === element.id && s.to.attachmentId === att.id,
            ).length;
            const worldKnown =
              resolvedAtt &&
              resolvedAtt.world.x.valueMm !== null &&
              resolvedAtt.world.y.valueMm !== null &&
              resolvedAtt.world.z.valueMm !== null;
            return (
              <div
                key={att.id}
                style={{
                  padding: 10,
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-surface)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div className="lfg-section-head">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                    <input
                      type="text"
                      className="lfg-input"
                      style={{ maxWidth: 190, minHeight: 28, fontSize: 12 }}
                      value={att.label}
                      onChange={e =>
                        update(cur => ({
                          ...cur,
                          attachments: cur.attachments.map(a => (a.id === att.id ? { ...a, label: e.target.value } : a)),
                        }))
                      }
                    />
                    {linkedCount > 0 && (
                      <span className="lfg-badge lfg-badge--accent" title="При удалении точки связанные подвесы также будут удалены">
                        Подвесов: {linkedCount}
                      </span>
                    )}
                  </div>
                  <button
                    id={`remove-att-${element.id}-${att.id}`}
                    type="button"
                    className="lfg-btn lfg-btn--danger lfg-btn--sm"
                    onClick={() => onRemoveAttachment(element.id, att.id)}
                  >
                    Удалить
                  </button>
                </div>

                <div className="lfg-grid-3">
                  {(['x', 'y', 'z'] as const).map(coord => (
                    <AxisInput
                      key={coord}
                      id={`att-${att.id}-${coord}`}
                      label={`Лок. ${coord.toUpperCase()}`}
                      value={att.point[coord]}
                      onChange={next =>
                        next &&
                        update(cur => ({
                          ...cur,
                          attachments: cur.attachments.map((a, idx) =>
                            idx === attIdx ? { ...a, point: { ...a.point, [coord]: next } } : a,
                          ),
                        }))
                      }
                    />
                  ))}
                </div>

                {resolvedAtt && (
                  <div className="lfg-hint lfg-mono">
                    Мир XYZ:{' '}
                    {worldKnown
                      ? `(${Math.round(resolvedAtt.world.x.valueMm!)}, ${Math.round(resolvedAtt.world.y.valueMm!)}, ${Math.round(resolvedAtt.world.z.valueMm!)}) мм · ${qualityLabels[resolvedAtt.world.z.quality]}`
                      : `Не определены (${[
                          ...(resolvedAtt.world.x.quality === 'unknown' ? resolvedAtt.world.x.missing : []),
                          ...(resolvedAtt.world.y.quality === 'unknown' ? resolvedAtt.world.y.missing : []),
                          ...(resolvedAtt.world.z.quality === 'unknown' ? resolvedAtt.world.z.missing : []),
                        ]
                          .slice(0, 2)
                          .map(translateMissingKey)
                          .join(', ')})`}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
