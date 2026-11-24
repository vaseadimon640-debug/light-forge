import { useRef } from 'react';

export const configuratorSteps = [
  { id: 'source', title: 'Источник', description: 'Начните с фотографии, образца MYLINE или проекта из библиотеки.' },
  { id: 'product', title: 'Изделие', description: 'Выберите тип светильника, название и количество.' },
  { id: 'geometry', title: 'Геометрия', description: 'Выберите компонент и задайте его габариты.' },
  { id: 'materials', title: 'Материалы', description: 'Выберите основной материал каждой детали.' },
  { id: 'finish', title: 'Отделка', description: 'Задайте покрытие и цвет отдельно от основного материала.' },
  { id: 'lighting', title: 'Свет', description: 'Укажите цветовую температуру, CRI, мощность и световой поток.' },
  { id: 'electrical', title: 'Электрика', description: 'Выберите диммирование и степень защиты.' },
  { id: 'mounting', title: 'Монтаж', description: 'Укажите уровни и способ подвеса. Оставьте неизвестные значения пустыми.' },
  { id: 'notes', title: 'Требования', description: 'Добавьте требования к упаковке, образцам или срокам.' },
  { id: 'review', title: 'Проверка и PDF', description: 'Сверьте спецификацию и подготовьте PDF для фабрики.' },
] as const;

export type ConfiguratorStep = (typeof configuratorSteps)[number]['id'];

export function ConfiguratorSteps({ step, onSelect }: { step: ConfiguratorStep; onSelect: (step: ConfiguratorStep) => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const index = configuratorSteps.findIndex(item => item.id === step);
  const { title, description } = configuratorSteps[index];
  const previous = configuratorSteps[index - 1];
  const next = configuratorSteps[index + 1];

  function select(id: ConfiguratorStep) {
    onSelect(id);
    requestAnimationFrame(() => heading.current?.focus());
  }

  return <section className="lf-config-steps" aria-labelledby="lf-config-step-title">
    <nav aria-label="Шаги конфигуратора">
      <ol>{configuratorSteps.map((item, position) => <li key={item.id}>
        <button type="button" aria-current={item.id === step ? 'step' : undefined} onClick={() => select(item.id)}>
          <span aria-hidden="true">{position + 1}</span>{item.title}
        </button>
      </li>)}</ol>
    </nav>
    <div className="lf-config-step-summary">
      <div><h2 id="lf-config-step-title" tabIndex={-1} ref={heading}>{title}</h2><p>{description}</p></div>
      <div className="lf-config-step-actions">
        {previous && <button type="button" className="lf-btn" onClick={() => select(previous.id)}>Назад</button>}
        {next && <button type="button" className="lf-btn lf-btn--primary" onClick={() => select(next.id)}>Далее</button>}
      </div>
    </div>
  </section>;
}
