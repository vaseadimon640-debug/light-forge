'use client';

import type { Project } from '@/domain/project';
import type { ResolvedComposition } from '@/geometry/result';
import type { Composition, Shape } from '@/geometry/schema';
import {
  buildCompositionOutline,
  type OutlineQuality,
} from './helpers';
import type { SelectionTarget } from './Scene3D';

type SceneOutlinerProps = {
  composition: Composition;
  resolved: ResolvedComposition | null;
  selection: SelectionTarget;
  activeTab: 'elements' | 'canopies' | 'suspensions' | 'levels';
  projects: Project[];
  onLinkProject: (projectId: string) => void;
  onSaveAndOpenDocuments: () => void;
  onSelectElement: (id: string) => void;
  onSelectCanopy: (id: string) => void;
  onSelectSuspension: (id: string) => void;
  onSelectLevels: () => void;
  onAddElement: (shapeType: Shape['type']) => void;
  onAddCanopy: () => void;
  onAddSuspension: (type: 'loadBearingCable' | 'decorativeStrap') => void;
};

const qualityLabels: Record<OutlineQuality, string> = {
  specified: 'Задано',
  estimated: 'Оценка',
  envelope: 'Габарит',
  unknown: 'Неизвестно',
  invalid: 'Ошибка',
};

export function SceneOutliner({
  composition,
  resolved,
  selection,
  activeTab,
  projects,
  onLinkProject,
  onSaveAndOpenDocuments,
  onSelectElement,
  onSelectCanopy,
  onSelectSuspension,
  onSelectLevels,
  onAddElement,
  onAddCanopy,
  onAddSuspension,
}: SceneOutlinerProps) {
  const outline = buildCompositionOutline(composition, resolved);
  const canAddSuspension =
    composition.canopies.some(c => c.exits.length > 0) &&
    composition.elements.some(el => el.attachments.length > 0);
  const linkedProject = projects.find(p => p.id === composition.projectId);

  return (
    <aside id="lfg-outliner" className="lfg-outliner" aria-label="Структура 3D-композиции">
      {/* Linked RFQ Project Card */}
      <div className="lfg-outliner-section lfg-outliner-project">
        <div className="lfg-outliner-head">
          <span className="lfg-outliner-title">Связь с проектом RFQ</span>
          {linkedProject && (
            <span className="lfg-badge lfg-badge--spec">Связано</span>
          )}
        </div>
        <select
          id="lfg-linked-project-select"
          className="lfg-select lfg-outliner-select"
          aria-label="Связанный проект RFQ"
          value={composition.projectId ?? ''}
          onChange={event => onLinkProject(event.target.value)}
        >
          <option value="">Без привязки к проекту</option>
          {projects.map(project => (
            <option key={project.id} value={project.id}>
              {project.name}
              {project.code ? ` (${project.code})` : ''}
            </option>
          ))}
        </select>
        {linkedProject ? (
          <div className="lfg-outliner-project-actions">
            <button
              id="lfg-open-in-documents-btn"
              type="button"
              className="lfg-btn lfg-btn--primary lfg-btn--sm"
              onClick={onSaveAndOpenDocuments}
            >
              Сохранить → Документы
            </button>
            <a
              className="lfg-btn lfg-btn--sm"
              href={`/?rfqProject=${encodeURIComponent(linkedProject.id)}`}
            >
              Quick RFQ
            </a>
          </div>
        ) : (
          <span className="lfg-hint">
            Привяжите проект, чтобы передать уровни и подвесы в Detailed RFQ и PDF.
          </span>
        )}
      </div>

      {/* Site Datums / Levels */}
      <div className="lfg-outliner-section">
        <div className="lfg-outliner-head">
          <span className="lfg-outliner-title">Площадка и уровни</span>
          {outline.site.missingCount > 0 && (
            <span className="lfg-badge lfg-badge--est" data-testid="lfg-outliner-missing-badge">
              Не задано: {outline.site.missingCount}
            </span>
          )}
        </div>
        <button
          id="lfg-outliner-site-btn"
          type="button"
          className={`lfg-tree-item${activeTab === 'levels' ? ' lfg-tree-item--active' : ''}`}
          onClick={onSelectLevels}
        >
          <div className="lfg-tree-main">
            <strong>Отметки (мм)</strong>
            <span className="lfg-tree-sub">
              Потолок: {outline.site.ceilingMm != null ? `${Math.round(outline.site.ceilingMm)} мм` : 'не задан'}
              {' · '}
              Стол: {outline.site.tabletopMm != null ? `${Math.round(outline.site.tabletopMm)} мм` : 'не задан'}
            </span>
          </div>
          <span
            className={`lfg-tree-dot lfg-tree-dot--${
              outline.site.tabletopMm != null && outline.site.ceilingMm != null ? 'specified' : 'unknown'
            }`}
            title={outline.site.tabletopMm != null ? 'Уровни заданы' : 'Есть неизвестные уровни'}
          />
        </button>
      </div>

      {/* Luminaire Elements */}
      <div className="lfg-outliner-section">
        <div className="lfg-outliner-head">
          <span className="lfg-outliner-title">Элементы ({outline.elements.length})</span>
          <div className="lfg-outliner-quick">
            <button
              type="button"
              className="lfg-btn lfg-btn--subtle lfg-btn--sm"
              title="Добавить дугу"
              onClick={() => onAddElement('arc')}
            >
              + Дуга
            </button>
            <button
              type="button"
              className="lfg-btn lfg-btn--subtle lfg-btn--sm"
              title="Добавить кольцо"
              onClick={() => onAddElement('ring')}
            >
              + Кольцо
            </button>
          </div>
        </div>
        <ul className="lfg-tree-list" data-testid="lfg-outliner-elements">
          {outline.elements.map(el => {
            const isSelected = selection?.kind === 'element' && selection.id === el.id;
            return (
              <li key={el.id}>
                <button
                  type="button"
                  data-outline-element={el.id}
                  className={`lfg-tree-item${isSelected ? ' lfg-tree-item--active' : ''}`}
                  aria-current={isSelected ? 'true' : undefined}
                  onClick={() => onSelectElement(el.id)}
                >
                  <div className="lfg-tree-main">
                    <strong>{el.name}</strong>
                    <span className="lfg-tree-sub">
                      {el.shapeLabel} · {el.dimsSummary}
                    </span>
                    <span className="lfg-tree-sub">{el.elevationSummary}</span>
                  </div>
                  <span
                    className={`lfg-tree-pill lfg-tree-pill--${el.quality}`}
                    title={qualityLabels[el.quality]}
                  >
                    {qualityLabels[el.quality]}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Canopies */}
      <div className="lfg-outliner-section">
        <div className="lfg-outliner-head">
          <span className="lfg-outliner-title">Основания ({outline.canopies.length})</span>
          <button
            type="button"
            className="lfg-btn lfg-btn--subtle lfg-btn--sm"
            onClick={onAddCanopy}
          >
            + Добавить
          </button>
        </div>
        {outline.canopies.length === 0 ? (
          <p className="lfg-tree-empty">Основания ещё не заданы (подтвердить у фабрики).</p>
        ) : (
          <ul className="lfg-tree-list" data-testid="lfg-outliner-canopies">
            {outline.canopies.map(canopy => {
              const isSelected = selection?.kind === 'canopy' && selection.id === canopy.id;
              return (
                <li key={canopy.id}>
                  <button
                    type="button"
                    data-outline-canopy={canopy.id}
                    className={`lfg-tree-item${isSelected ? ' lfg-tree-item--active' : ''}`}
                    aria-current={isSelected ? 'true' : undefined}
                    onClick={() => onSelectCanopy(canopy.id)}
                  >
                    <div className="lfg-tree-main">
                      <strong>{canopy.name}</strong>
                      <span className="lfg-tree-sub">
                        {canopy.footprintSummary} · выходов: {canopy.exitCount}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Suspensions (Load-bearing cables & Decorative straps) */}
      <div className="lfg-outliner-section">
        <div className="lfg-outliner-head">
          <span className="lfg-outliner-title">Подвесы ({outline.suspensions.length})</span>
          {canAddSuspension && (
            <div className="lfg-outliner-quick">
              <button
                type="button"
                className="lfg-btn lfg-btn--subtle lfg-btn--sm"
                onClick={() => onAddSuspension('loadBearingCable')}
              >
                + Трос
              </button>
              <button
                type="button"
                className="lfg-btn lfg-btn--subtle lfg-btn--sm"
                onClick={() => onAddSuspension('decorativeStrap')}
              >
                + Ремень
              </button>
            </div>
          )}
        </div>
        {outline.suspensions.length === 0 ? (
          <p className="lfg-tree-empty">
            Подвесы не заданы — расчётные длины не придумываются без точек выхода и крепления.
          </p>
        ) : (
          <ul className="lfg-tree-list" data-testid="lfg-outliner-suspensions">
            {outline.suspensions.map(susp => {
              const isSelected = selection?.kind === 'suspension' && selection.id === susp.id;
              return (
                <li key={susp.id}>
                  <button
                    type="button"
                    data-outline-suspension={susp.id}
                    className={`lfg-tree-item${isSelected ? ' lfg-tree-item--active' : ''}`}
                    aria-current={isSelected ? 'true' : undefined}
                    onClick={() => onSelectSuspension(susp.id)}
                  >
                    <div className="lfg-tree-main">
                      <strong>
                        {susp.typeLabel} · {susp.id}
                      </strong>
                      <span className="lfg-tree-sub">
                        {susp.pathSummary} · {susp.cutSummary}
                      </span>
                    </div>
                    <span className={`lfg-tree-pill lfg-tree-pill--${susp.quality}`}>
                      {qualityLabels[susp.quality]}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
