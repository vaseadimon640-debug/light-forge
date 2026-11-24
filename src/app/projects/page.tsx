'use client';

import { useEffect, useRef, useState } from 'react';
import { productTypes, type Project } from '@/domain/project';
import { openProjectStore } from '@/storage/projects';
import { ProjectCover } from '@/ui/projects/ProjectCover';
import { projectHref, useProjects } from '@/ui/projects/useProjects';
import { StarIcon } from '@/ui/icons';

const favoritesKey = 'light-forge-favorite-projects';
const pageSize = 9;

export default function Projects() {
  const { projects, error, refresh } = useProjects();
  const [favorites, setFavorites] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [sort, setSort] = useState('recent');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [limit, setLimit] = useState(pageSize);
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>();
  const duplicating = useRef(false);
  const [pendingId, setPendingId] = useState('');

  useEffect(() => {
    function loadFavorites() {
      try {
        const data: unknown = JSON.parse(localStorage.getItem(favoritesKey) ?? '[]');
        setFavorites(Array.isArray(data) ? data.filter((id): id is string => typeof id === 'string') : []);
      } catch { setFavorites([]); }
    }
    loadFavorites();
    window.addEventListener('storage', loadFavorites);
    return () => window.removeEventListener('storage', loadFavorites);
  }, []);

  function favorite(id: string) {
    const next = favorites.includes(id) ? favorites.filter(key => key !== id) : [...favorites, id];
    try {
      localStorage.setItem(favoritesKey, JSON.stringify(next));
      setFavorites(next);
      setNotice(undefined);
    } catch { setNotice({ text: 'Не удалось сохранить избранное в браузере.', error: true }); }
  }

  async function duplicate(project: Project) {
    if (duplicating.current) return;
    duplicating.current = true;
    setPendingId(project.id);
    try {
      const store = await openProjectStore();
      try {
        const copy = await store.duplicate(project.id);
        if (!copy) throw new Error('Исходный проект уже удалён.');
        setNotice({ text: 'Создан проект «' + copy.project.name + '».' });
        await refresh();
      } finally { store.close(); }
    } catch (err) {
      setNotice({ text: err instanceof Error ? err.message : 'Не удалось создать копию.', error: true });
    } finally {
      duplicating.current = false;
      setPendingId('');
    }
  }

  const term = query.trim().toLocaleLowerCase();
  const visible = projects?.filter(project =>
    (!kind || project.kind === kind) &&
    (!favoritesOnly || favorites.includes(project.id)) &&
    [project.name, project.code].some(value => value.toLocaleLowerCase().includes(term)),
  );
  if (sort === 'title') visible?.sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  return <main className="atelier-page">
    <header className="atelier-heading"><div><h1>Проекты и библиотека</h1><p>Проекты, сохранённые в этом браузере.</p></div>
      <a className="lf-btn lf-btn--primary" href="/?new=1">Новый проект</a></header>

    <div className="atelier-project-controls atelier-panel">
      <label className="atelier-field">Поиск по проектам<input className="lf-input" type="search" value={query}
        onChange={event => { setQuery(event.target.value); setLimit(pageSize); }} placeholder="Название или артикул" /></label>
      <label className="atelier-field">Тип светильника<select className="lf-input" value={kind} onChange={event => { setKind(event.target.value); setLimit(pageSize); }}>
        <option value="">Все типы</option>{Object.entries(productTypes).map(([id, [title]]) => <option key={id} value={id}>{title}</option>)}
      </select></label>
      <label className="atelier-field">Сортировка<select className="lf-input" value={sort} onChange={event => setSort(event.target.value)}>
        <option value="recent">По дате</option><option value="title">По названию</option>
      </select></label>
      <label className="atelier-check"><input type="checkbox" checked={favoritesOnly} onChange={event => { setFavoritesOnly(event.target.checked); setLimit(pageSize); }} /> Избранные</label>
      <div className="lf-segment" role="group" aria-label="Вид библиотеки">
        <button type="button" className="lf-segment-btn" aria-pressed={view === 'grid'} onClick={() => setView('grid')}>Сетка</button>
        <button type="button" className="lf-segment-btn" aria-pressed={view === 'list'} onClick={() => setView('list')}>Список</button>
      </div>
    </div>

    {error && <p role="alert">Не удалось открыть хранилище проектов этого браузера.</p>}
    {notice && <p className="atelier-panel atelier-library-notice" role={notice.error ? 'alert' : 'status'}>{notice.text}</p>}
    {!error && !projects && <p role="status">Загружаем проекты…</p>}
    {visible?.length === 0 && <section className="atelier-panel"><h2>{projects?.length ? 'Проекты не найдены' : 'Начните первый проект'}</h2>
      <p>{projects?.length ? 'Попробуйте другой запрос или снимите фильтры.' : 'Сохраните проект в редакторе RFQ, чтобы открыть его здесь.'}</p>
      {!projects?.length && <a className="lf-btn" href="/">Открыть пример MYLINE</a>}</section>}
    {visible && visible.length > 0 && <ul className="atelier-library" data-view={view}>
      {visible.slice(0, limit).map(project => {
        const selected = favorites.includes(project.id);
        return <li key={project.id} className="atelier-library-card">
          <ProjectCover project={project} />
          <div className="atelier-library-details"><div className="atelier-library-title"><h2>{project.name}</h2>
            <button type="button" className="lf-btn lf-btn--icon" aria-pressed={selected} aria-label={'Избранное: ' + project.name} onClick={() => favorite(project.id)}>
              <StarIcon size={17} filled={selected} />
            </button></div>
            <span>{[project.code, productTypes[project.kind][0]].filter(Boolean).join(' · ')}</span>
            <time dateTime={project.updatedAt}>{new Date(project.updatedAt).toLocaleDateString('ru-RU')}</time>
            <div className="atelier-inline"><a className="lf-btn" href={projectHref(project)}>Открыть</a>
              <button type="button" className="lf-btn lf-btn--subtle" disabled={Boolean(pendingId)} onClick={() => void duplicate(project)}>
                {pendingId === project.id ? 'Копируем…' : 'Дублировать'}
              </button></div>
          </div>
        </li>;
      })}
    </ul>}
    {visible && visible.length > limit && <button type="button" className="lf-btn atelier-show-more" onClick={() => setLimit(limit + pageSize)}>Показать ещё</button>}
  </main>;
}
