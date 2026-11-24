import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ConfiguratorWizard } from '@/ui/configurator/ConfiguratorWizard';

export const metadata: Metadata = { title: 'Конфигуратор светильника' };

export default function ConfigurePage() {
  return (
    <Suspense
      fallback={
        <main className="atelier-page">
          <header className="atelier-heading">
            <h1>Начните с фотографии светильника</h1>
          </header>
        </main>
      }
    >
      <ConfiguratorWizard />
    </Suspense>
  );
}
