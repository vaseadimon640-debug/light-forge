import { notFound } from 'next/navigation';
import { CheckIcon, PlusIcon } from '@/ui/icons';

export const dynamic = 'force-dynamic';

export default function Components() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <main className="atelier-page">
    <header className="atelier-heading"><h1>Компоненты Atelier</h1></header>
    <section className="atelier-panel">
      <h2>Кнопки и состояния</h2>
      <div className="atelier-inline">
        <a className="lf-btn lf-btn--primary" href="/dashboard">Основное действие</a>
        <a className="lf-btn" href="/projects">Дополнительное</a>
        <a className="lf-btn lf-btn--subtle" href="/settings">Настройки</a>
        <a className="lf-btn" href="/" aria-label="Новый проект" title="Новый проект"><PlusIcon size={18} /></a>
        <button type="button" className="lf-btn" disabled>Недоступно</button>
        <button type="button" className="lf-btn" disabled aria-busy="true">Загрузка…</button>
      </div>
    </section>
    <section className="atelier-panel">
      <h2>Поля и выбор</h2>
      <div className="atelier-actions">
        <label className="atelier-field">Название<input className="lf-input" placeholder="Название проекта" /></label>
        <label className="atelier-field">Ширина, мм<input className="lf-input" type="number" min="0" defaultValue="900" /></label>
        <label className="atelier-field">Язык документа<select className="lf-input"><option>EN</option><option>中文</option><option>EN + 中文</option></select></label>
        <label className="atelier-field">Материал<input className="lf-input" list="atelier-materials" /><datalist id="atelier-materials"><option value="Solid brass" /><option value="Genuine leather" /></datalist></label>
        <label className="atelier-field">Яркость<input type="range" /></label>
        <label className="atelier-field">Количество<input className="lf-input" type="number" aria-invalid="true" aria-describedby="quantity-error" defaultValue="0" min="1" /><span id="quantity-error">Укажите хотя бы одно изделие.</span></label>
      </div>
      <fieldset><legend>Единицы</legend><label><input type="radio" name="atelier-unit" defaultChecked /> мм</label> <label><input type="radio" name="atelier-unit" /> см</label></fieldset>
      <label><input type="checkbox" defaultChecked /> Запретить замену материала</label>
      <details><summary>Уровень подтверждения</summary><p><CheckIcon size={14} /> Подтверждено документацией. Оценки помечаются отдельно.</p></details>
      <label className="atelier-field">Ход загрузки<progress value="65" max="100" /></label>
    </section>
    <section className="atelier-panel"><h2>Пустое состояние</h2><p>Здесь появятся сохранённые проекты.</p><a className="lf-btn" href="/">Создать проект</a></section>
  </main>;
}
