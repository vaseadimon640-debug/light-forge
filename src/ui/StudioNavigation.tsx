import { FilePdfIcon, LayersIcon, SearchIcon } from './icons';

const sections = [
  { id: 'rfq', label: 'Quick RFQ', href: '/', Icon: FilePdfIcon },
  { id: 'geometry', label: '3D-конструктор', href: '/geometry', Icon: LayersIcon },
  { id: 'search', label: 'AI Search', href: '/search', Icon: SearchIcon },
] as const;

type Section = (typeof sections)[number]['id'];

export function StudioNavigation({ current, keepWorkspaceOpen = false }: {
  current: Section;
  keepWorkspaceOpen?: boolean;
}) {
  return (
    <nav className="lf-studio-nav" aria-label="Разделы LIGHT FORGE">
      {sections.map(({ id, label, href, Icon }) => id === current ? (
        <span key={id} className="lf-studio-nav-item" aria-current="page">
          <Icon size={15} />
          {label}
        </span>
      ) : (
        <a key={id} className="lf-studio-nav-item" href={href}
          target={keepWorkspaceOpen ? '_blank' : undefined}
          rel={keepWorkspaceOpen ? 'noopener' : undefined}
          title={keepWorkspaceOpen ? `Открыть ${label} в новой вкладке` : undefined}
        >
          <Icon size={15} />
          {label}
        </a>
      ))}
    </nav>
  );
}
