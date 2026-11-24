import { EditIcon, FilePdfIcon, LayersIcon, SearchIcon } from '@/ui/icons';
import { RecentWork } from "@/ui/projects/RecentWork";

export default function Dashboard() {
  return <main className="atelier-page">
    <header className="lf-studio-banner">
      <h1>Рабочий стол</h1>
      <p>Найдите светильник, соберите композицию или подготовьте запрос фабрике.</p>
      <div className="lf-studio-banner-actions"><a className="lf-btn lf-studio-banner-primary" href="/?new=1">Новый проект</a></div>
    </header>
    <section className="atelier-actions" aria-label="Основные действия">
      <a href="/search"><SearchIcon size={24} /><strong>Поиск по фото</strong><span>Найти модель и похожие светильники</span></a>
      <a href="/configure"><EditIcon size={24} /><strong>Настроить светильник</strong><span>Пройти от референса до спецификации</span></a>
      <a href="/"><FilePdfIcon size={24} /><strong>Запрос фабрике</strong><span>Подготовить спецификацию и PDF</span></a>
      <a href="/documents"><FilePdfIcon size={24} /><strong>Документы и версии</strong><span>Detailed RFQ, BOM и архив PDF EN/ZH</span></a>
      <a href="/geometry"><LayersIcon size={24} /><strong>3D Studio</strong><span>Проверить форму, уровни и подвесы</span></a>
    </section>
    <RecentWork />
  </main>;
}
