'use client';

import type { ResolvedComposition } from '@/geometry/result';
import type { Composition } from '@/geometry/schema';
import { AxisInput } from './AxisInput';
import {
  collectMissingInputs,
  computeElementDistances,
  formatGeometryIssuePath,
  formatMm,
  qualityLabels,
  type GeometryFieldIssue,
} from './helpers';

type LevelsSummaryTabProps = {
  composition: Composition;
  resolved: ResolvedComposition | null;
  issues: GeometryFieldIssue[];
  onChangeSite: (updater: (site: Composition['site']) => Composition['site']) => void;
  apiStatus: { state: 'idle' | 'checking' | 'ok' | 'error'; message: string };
  onVerifyApi: () => void;
};

export function LevelsSummaryTab({
  composition,
  resolved,
  issues,
  onChangeSite,
  apiStatus,
  onVerifyApi,
}: LevelsSummaryTabProps) {
  const missing = resolved ? collectMissingInputs(resolved) : [];
  const distances = resolved ? computeElementDistances(resolved) : [];
  const tabletopIssue = issues.find(
    i => i.path[0] === 'site' && i.path[1] === 'tabletopFromFloorMm',
  )?.message;

  return (
    <>
      {/* Site Datums */}
      <div className="lfg-section">
        <h3 className="lfg-section-title">Уровни помещения (от чистового пола Z = 0)</h3>
        <div className="lfg-grid-2">
          <AxisInput
            id="site-ceiling"
            label="Высота потолка"
            optional
            min={0.001}
            value={composition.site.ceilingFromFloorMm}
            onChange={next =>
              onChangeSite(site => {
                const updated = { ...site };
                if (next) updated.ceilingFromFloorMm = next;
                else delete updated.ceilingFromFloorMm;
                return updated;
              })
            }
          />
          <AxisInput
            id="site-tabletop"
            label="Высота столешницы"
            optional
            min={0}
            placeholder="Не указана"
            error={tabletopIssue}
            value={composition.site.tabletopFromFloorMm}
            onChange={next =>
              onChangeSite(site => {
                const updated = { ...site };
                if (next) updated.tabletopFromFloorMm = next;
                else delete updated.tabletopFromFloorMm;
                return updated;
              })
            }
          />
        </div>

        {!composition.site.tabletopFromFloorMm && (
          <div className="lfg-alert lfg-alert--warning" role="status">
            <strong>Высота стола не задана:</strong> система сохраняет известные отметки над столом и потолок,
            но не вычисляет и не выдумывает абсолютные высоты от пола и окончательные длины ремней/подвесов.
          </div>
        )}
      </div>

      {/* Schema / API Validation Status */}
      <div className="lfg-section">
        <div className="lfg-section-head">
          <h3 className="lfg-section-title">Сверка через POST /api/geometry/resolve</h3>
          <button
            id="lfg-verify-api-btn"
            type="button"
            className="lfg-btn lfg-btn--primary lfg-btn--sm"
            disabled={apiStatus.state === 'checking'}
            onClick={onVerifyApi}
          >
            {apiStatus.state === 'checking' ? 'Проверка...' : 'Проверить API'}
          </button>
        </div>

        {apiStatus.message && (
          <div
            className={`lfg-alert ${
              apiStatus.state === 'error'
                ? 'lfg-alert--danger'
                : apiStatus.state === 'ok'
                  ? 'lfg-alert--info'
                  : ''
            }`}
          >
            {apiStatus.message}
          </div>
        )}

        {issues.length > 0 && (
          <div className="lfg-alert lfg-alert--danger" role="alert">
            <strong>Ошибки схемы ({issues.length}):</strong>
            {issues.map((issue, idx) => (
              <span key={idx}>
                • {formatGeometryIssuePath(issue.path)}: {issue.message}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* All Elements Levels Matrix */}
      {resolved && (
        <div className="lfg-section">
          <h3 className="lfg-section-title">Сводка отметок элементов</h3>
          <table className="lfg-table">
            <thead>
              <tr>
                <th>Элемент</th>
                <th>Габарит</th>
                <th>Низ над столом</th>
                <th>Низ от пола</th>
              </tr>
            </thead>
            <tbody className="lfg-mono">
              {resolved.elements.map(el => (
                <tr key={el.id}>
                  <td style={{ fontFamily: 'var(--font-sans)', fontWeight: 550 }}>
                    {el.name}
                    <div className="lfg-hint">
                      {el.geometry.representation === 'envelope' ? 'Оболочка' : el.shape.type} ·{' '}
                      {qualityLabels[el.geometry.quality]}
                    </div>
                  </td>
                  <td>
                    {Math.round(el.geometry.widthMm)}×{Math.round(el.geometry.depthMm)}×{Math.round(el.geometry.heightMm)}
                  </td>
                  <td>{formatMm(el.lowest.aboveTabletop)}</td>
                  <td>{formatMm(el.lowest.fromFloor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Element Pair Distances */}
      {distances.length > 0 && (
        <div className="lfg-section">
          <h3 className="lfg-section-title">Расстояния между элементами</h3>
          <table className="lfg-table">
            <thead>
              <tr>
                <th>Пара</th>
                <th>Центры XY</th>
                <th>ΔZ низа</th>
              </tr>
            </thead>
            <tbody className="lfg-mono">
              {distances.slice(0, 8).map(pair => (
                <tr key={`${pair.fromId}-${pair.toId}`}>
                  <td style={{ fontFamily: 'var(--font-sans)' }}>
                    {pair.fromName} ↔ {pair.toName}
                  </td>
                  <td>{pair.centerDistanceMm !== null ? `${pair.centerDistanceMm} мм` : 'Неизв. (нет X/Y)'}</td>
                  <td>{pair.deltaZLowestMm !== null ? `${pair.deltaZLowestMm} мм` : 'Неизв.'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Explicit Missing Inputs Checklist */}
      {missing.length > 0 && (
        <div className="lfg-section">
          <h3 className="lfg-section-title">Недостающий ввод ({missing.length})</h3>
          <div className="lfg-alert lfg-alert--warning">
            {missing.map((item, idx) => (
              <span key={idx}>• {item}</span>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
