'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { openProjectStore } from '@/storage/projects';
import { BrandMarkIcon, ColumnsIcon, EditIcon, FilePdfIcon, FolderIcon, LayersIcon, PlusIcon, SearchIcon, SlidersIcon, SparkIcon } from './icons';

const sections = [
  { label: 'Рабочий стол', href: '/dashboard', Icon: SparkIcon },
  { label: 'AI Visual Search', href: '/search', Icon: SearchIcon },
  { label: 'Конфигурация', href: '/#project-heading', Icon: EditIcon },
  { label: '3D Studio', href: '/geometry', Icon: LayersIcon },
  { label: 'Manufacturing RFQ', href: '/', Icon: FilePdfIcon },
  { label: 'Проекты и библиотека', href: '/projects', Icon: FolderIcon },
  { label: 'Настройки', href: '/settings', Icon: SlidersIcon },
];

export const themeKey = 'light-forge-theme';

export function StudioNavigation({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const dialog = useRef<HTMLDialogElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [recent, setRecent] = useState<{ id: string; name: string }>();
  const editor = pathname === '/' || pathname === '/geometry' || pathname === '/search';
  const target = editor ? '_blank' : undefined;

  useEffect(() => {
    try { setCollapsed(localStorage.getItem('light-forge-sidebar') === 'collapsed'); } catch {}
    function refresh() {
      void openProjectStore().then(async store => {
        try { setRecent((await store.list())[0]); } finally { store.close(); }
      }).catch(() => setRecent(undefined));
    }
    refresh();
    window.addEventListener('light-forge-project-saved', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('light-forge-project-saved', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  function toggleSidebar() {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem('light-forge-sidebar', next ? 'collapsed' : 'expanded'); } catch {}
  }

  function links(mobile: boolean) {
    return (
      <nav className="atelier-nav" aria-label="Разделы LIGHT FORGE">
        {sections.map(({ label, href, Icon }) => (
          <a key={href} href={href} aria-current={href === pathname ? 'page' : undefined}
            target={target} rel={editor ? 'noopener' : undefined}
            aria-label={label} title={label} onClick={mobile ? () => dialog.current?.close() : undefined}>
            <Icon size={19} /><span>{label}</span>
          </a>
        ))}
        <a href="/?new=1" target={target} rel={editor ? 'noopener' : undefined}
          aria-label="Новый проект" title="Новый проект" onClick={mobile ? () => dialog.current?.close() : undefined}>
          <PlusIcon size={19} /><span>Новый проект</span>
        </a>
        {recent && (
          <a className="atelier-recent" href={'/?rfqProject=' + encodeURIComponent(recent.id)}
            target={target} rel={editor ? 'noopener' : undefined} title="Последний проект"
            aria-label={'Последний проект: ' + recent.name} onClick={mobile ? () => dialog.current?.close() : undefined}>
            <FolderIcon size={19} /><span><small>Последний проект</small>{recent.name}</span>
          </a>
        )}
      </nav>
    );
  }

  return (
    <div className="atelier" data-collapsed={collapsed}>
      <a className="atelier-skip" href="#atelier-content">К содержимому</a>
      <aside className="atelier-side">
        <div className="atelier-brand"><BrandMarkIcon size={25} /><span>LIGHT FORGE</span></div>
        {links(false)}
        <button type="button" className="atelier-toggle" onClick={toggleSidebar}
          aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'} aria-expanded={!collapsed}>
          <ColumnsIcon size={19} /><span>Свернуть меню</span>
        </button>
      </aside>
      <div className="atelier-mobile-bar">
        <span>LIGHT FORGE</span>
        <button type="button" className="lf-btn" aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}>Меню</button>
      </div>
      <dialog ref={dialog} className="atelier-menu" aria-label="Меню LIGHT FORGE">
        <div className="atelier-menu-head"><strong>LIGHT FORGE</strong><button type="button"
          className="lf-btn" onClick={() => dialog.current?.close()}>Закрыть</button></div>
        {links(true)}
      </dialog>
      <div id="atelier-content" className="atelier-content" tabIndex={-1}>{children}</div>
    </div>
  );
}
