'use client';

import { useEffect, useState } from 'react';
import { productTypes, type Project } from '@/domain/project';
import { openProjectStore } from '@/storage/projects';

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>();
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const store = await openProjectStore();
        try {
          const items = await store.list();
          if (active) setProjects(items);
        } finally { store.close(); }
      } catch { if (active) setError(true); }
    }
    void load();
    window.addEventListener('focus', load);
    return () => { active = false; window.removeEventListener('focus', load); };
  }, []);

  const visible = projects?.filter(project =>
    [project.name, project.code].some(value => value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())),
  );
  return <main className="atelier-page">
    <header className="atelier-heading"><div><h1>Проекты и библиотека</h1><p>Сохранённые проекты этого браузера.</p></div>
      <a className="lf-btn lf-btn--primary" href="/?new=1">Новый проект</a></header>
    <section className="atelier-panel">
      <label className="atelier-field">Поиск по проектам
        <input className="lf-input" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Название или артикул" />
      </label>
      {error && <p role="alert">Не удалось открыть хранилище проектов этого браузера.</p>}
      {!error && !projects && <p role="status">Загружаем проекты…</p>}
      {visible?.length === 0 && <p>{projects?.length ? 'Проекты не найдены.' : 'Сохраните первый проект в редакторе RFQ, чтобы открыть его здесь.'}</p>}
      {visible && visible.length > 0 && <ul className="atelier-project-list">
        {visible.map(project => <li key={project.id}><div><strong>{project.name}</strong>
          <span>{[project.code, productTypes[project.kind][0]].filter(Boolean).join(' · ')}</span></div>
          <a className="lf-btn" href={'/?rfqProject=' + encodeURIComponent(project.id)}>Открыть</a></li>)}
      </ul>}
    </section>
  </main>;
}
