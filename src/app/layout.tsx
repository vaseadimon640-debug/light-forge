import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'LIGHT FORGE — 3D-конструктор геометрии и подвесов',
  description:
    'Интерактивный 3D-конструктор освещения LIGHT FORGE на базе React Three Fiber и канонической инженерной схемы геометрии.',
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23244752'/%3E%3Ccircle cx='16' cy='16' r='8' fill='none' stroke='%23ffffff' stroke-width='2'/%3E%3C/svg%3E",
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#f5f4f0',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body style={{ margin: 0, padding: 0 }}>{children}</body>
    </html>
  );
}
