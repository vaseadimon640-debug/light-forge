import { Suspense } from 'react';
import { SettingsWorkspace } from '@/ui/settings/SettingsWorkspace';

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <main className="atelier-page">
          <header className="atelier-heading">
            <h1>Настройки и поставщики</h1>
          </header>
          <section className="atelier-panel">
            <p>Загружаем настройки и статусы провайдеров…</p>
          </section>
        </main>
      }
    >
      <SettingsWorkspace />
    </Suspense>
  );
}
