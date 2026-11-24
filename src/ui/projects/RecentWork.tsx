'use client';

import { useEffect, useState } from 'react';
import type { ReviewLink } from '@/visual-search/catalogue';
import { readHistory, readSavedLinks } from '../visual-search/local-history';
import { ProjectCover } from './ProjectCover';
import { projectHref, useProjects } from './useProjects';

export function RecentWork() {
  const { projects, error } = useProjects();
  const [saved, setSaved] = useState<ReviewLink[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  useEffect(() => {
    setSaved(readSavedLinks());
    setHistory(readHistory());
  }, []);
  return <>
    <section aria-labelledby="atelier-recent-title" className="atelier-panel">
      <div className="atelier-heading"><h2 id="atelier-recent-title">Последние проекты</h2><a className="lf-btn" href="/projects">Все проекты</a></div>
      {error ? <p role="alert">Не удалось открыть проекты этого браузера.</p>
        : !projects ? <p role="status">Загружаем проекты…</p>
        : projects.length === 0 ? <p>Сохраните проект в Quick RFQ, и он появится здесь.</p>
        : <ul className="atelier-library" data-view="grid">{projects.slice(0, 3).map(project => <li className="atelier-library-card" key={project.id}>
          <ProjectCover project={project} /><div className="atelier-library-details"><h3><a href={projectHref(project)}>{project.name}</a></h3>
            <time dateTime={project.updatedAt}>{new Date(project.updatedAt).toLocaleDateString('ru-RU')}</time></div>
        </li>)}</ul>}
    </section>
    <div className="atelier-activity">
      <section className="atelier-panel"><h2>Шаблоны</h2><a href="/">MYLINE · пример запроса</a></section>
      <section className="atelier-panel"><h2>Недавние поиски</h2>{history.length ? <ul>{history.slice(0, 5).map(query =>
        <li key={query}><a href={'/search?q=' + encodeURIComponent(query)}>{query}</a></li>)}</ul> : <p>Здесь появятся ваши запросы из AI Visual Search.</p>}</section>
      <section className="atelier-panel"><h2>Сохранённые светильники</h2>{saved.length ? <ul>{saved.slice(-5).reverse().map(item =>
        <li key={item.url}><a href={item.url} target="_blank" rel="noreferrer">{item.title}</a></li>)}</ul> : <p>Сохраните модель в AI Visual Search, чтобы вернуться к источнику.</p>}</section>
    </div>
  </>;
}
