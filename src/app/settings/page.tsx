'use client';

import { useEffect, useState } from 'react';
import { themeKey } from '@/ui/StudioNavigation';

export default function Settings() {
  const [theme, setTheme] = useState('light');
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  }, []);

  function selectTheme(next: 'light' | 'dark') {
    document.documentElement.dataset.theme = next;
    setTheme(next);
    try { localStorage.setItem(themeKey, next); setSaveError(false); }
    catch { setSaveError(true); }
  }

  return <main className="atelier-page">
    <header className="atelier-heading"><h1>Настройки</h1></header>
    <section className="atelier-panel">
      <h2>Оформление</h2>
      <div role="group" aria-label="Тема интерфейса" className="lf-segment">
        <button type="button" className="lf-segment-btn" aria-pressed={theme === 'light'} onClick={() => selectTheme('light')}>Светлая</button>
        <button type="button" className="lf-segment-btn" aria-pressed={theme === 'dark'} onClick={() => selectTheme('dark')}>Тёмная</button>
      </div>
      {saveError && <p role="alert">Браузер не сохранил тему для следующих сеансов.</p>}
    </section>
    <section className="atelier-panel"><h2>Источники поиска</h2><p>Доступность источников и параметры поиска можно проверить в рабочем разделе.</p>
      <a href="/search" className="lf-btn">Открыть AI Visual Search</a></section>
  </main>;
}
