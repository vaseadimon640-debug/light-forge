import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import './studio.css';
import './atelier.css';
import { StudioNavigation } from '@/ui/StudioNavigation';

export const metadata: Metadata = {
  title: { default: 'LIGHT FORGE — Quick RFQ и 3D', template: '%s | LIGHT FORGE' },
  description:
    'Профессиональное рабочее пространство для подготовки производственных запросов (Quick RFQ) фабрикам освещения: референсные фотографии, габариты в мм, материалы, свет, двуязычный текст и PDF EN/ZH.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#201c19',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: "try{if(localStorage.getItem('light-forge-theme')==='dark')document.documentElement.dataset.theme='dark'}catch{}" }} />
        <StudioNavigation>{children}</StudioNavigation>
      </body>
    </html>
  );
}
