'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { imageTypes, maxPhotoBytes } from '@/domain/project';
import { openProjectStore } from '@/storage/projects';
import { canonicalSource, importReviewLinks, projectFromSearch, reviewSchema, searchResponseSchema, type ReviewLink, type SearchInput, type SearchResult, type SearchResponse, type SearchUsage } from '@/visual-search/catalogue';

const full = { x: 0, y: 0, width: 100, height: 100 };
const historyKey = 'light-forge-visual-search-history';
const savedKey = 'light-forge-visual-search-links';
const labels = {
  verified_original: 'Verified Original · запись производителя',
  exact_match: 'Exact Match', visual_alternative: 'Visual Alternative · по признакам каталога',
  technical_alternative: 'Technical Alternative', unverified: 'Ссылка на проверку',
};

function readHistory(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(historyKey) ?? '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 10) : [];
  } catch { return []; }
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const element = document.createElement('a');
  element.href = url;
  element.download = name;
  element.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function reviewInstructions(query: string, results: SearchResult[]) {
  return [
    'Проверь фото светильника и найденные ссылки. Опирайся на подтверждённый производителем артикул и официальный первичный источник.',
    'Если оригинал установить нельзя, явно напиши Original not verified. Отличай совпадение фотографии от совпадения изделия.',
    `Исходное описание: ${query || 'прилагаемое фото'}`,
    ...results.map(item => `- ${item.brand ?? ''} ${item.name} (${labels[item.category]}) — ${item.source}`),
    'Верни только ссылки, которые можно открыть, в JSON формата {"results":[{"title":"Название","url":"https://…"}]}.',
  ].join('\n');
}

async function optimizedPhoto(file: File, crop: typeof full) {
  const bitmap = await createImageBitmap(file);
  try {
    const x = Math.round(bitmap.width * crop.x / 100);
    const y = Math.round(bitmap.height * crop.y / 100);
    const width = Math.max(1, Math.min(bitmap.width - x, Math.round(bitmap.width * crop.width / 100)));
    const height = Math.max(1, Math.min(bitmap.height - y, Math.round(bitmap.height * crop.height / 100)));
    const scale = Math.min(1, 1280 / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Не удалось обработать выделенную область.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, x, y, width, height, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(value => value ? resolve(value) : reject(new Error('Не удалось создать копию.')), 'image/jpeg', 0.85));
    return new File([blob], 'light-forge-search.jpg', { type: 'image/jpeg' });
  } finally { bitmap.close(); }
}

export function VisualSearch() {
  const [photo, setPhoto] = useState<File>();
  const [photoUrl, setPhotoUrl] = useState('');
  const [crop, setCrop] = useState(full);
  const [showCrop, setShowCrop] = useState(false);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchInput['mode']>('standard');
  const [gemini, setGemini] = useState<SearchUsage>();
  const [allowGemini, setAllowGemini] = useState(false);
  const [last, setLast] = useState<SearchResponse>();
  const [imported, setImported] = useState<SearchResult[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [saved, setSaved] = useState<ReviewLink[]>([]);
  const [linkInput, setLinkInput] = useState('');
  const [reviewInput, setReviewInput] = useState('');
  const [variant, setVariant] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setHistory(readHistory());
    try { setSaved(reviewSchema.parse({ results: JSON.parse(localStorage.getItem(savedKey) ?? '[]') }).results); } catch { /* Empty library. */ }
    const controller = new AbortController();
    fetch('/api/visual-search', { signal: controller.signal }).then(response => response.json())
      .then(value => { if (!controller.signal.aborted) setGemini(value.gemini); }).catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!photo) { setPhotoUrl(''); return; }
    const url = URL.createObjectURL(photo);
    setPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const results = [...new Map([...(last?.results ?? []), ...imported].map(item => [canonicalSource(item.source), item])).values()];
  const review = reviewInstructions(query, results);

  function choosePhoto(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (!imageTypes.some(type => type === file.type) || file.size > maxPhotoBytes || !file.size) {
      setNotice('Выбери JPEG, PNG или WebP до 12 МиБ.');
      return;
    }
    setPhoto(file);
    setCrop(full);
    setShowCrop(false);
    setNotice('');
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setNotice('');
    try {
      const input: SearchInput = { query, mode, runGemini: Boolean(gemini?.enabled && allowGemini && photo) };
      let request: RequestInit;
      if (input.runGemini && photo) {
        const copy = await optimizedPhoto(photo, crop);
        input.photo = { id: 'selected-photo', name: copy.name, type: 'image/jpeg', size: copy.size };
        const form = new FormData();
        form.set('input', JSON.stringify(input));
        form.set('photo:selected-photo', copy, copy.name);
        request = { method: 'POST', body: form };
      } else {
        request = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) };
      }
      const response = await fetch('/api/visual-search', request);
      if (!response.ok) throw new Error('Поиск не завершился. Проверь данные и попробуй ещё раз.');
      const data = searchResponseSchema.parse(await response.json());
      setLast(data);
      setGemini(data.gemini);
      const current = query.trim();
      if (current) {
        const updated = [current, ...history.filter(item => item !== current)].slice(0,10);
        setHistory(updated);
        localStorage.setItem(historyKey, JSON.stringify(updated));
      }
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Поиск недоступен.'); }
    finally { setLoading(false); }
  }

  function addLinks(links: ReviewLink[]) {
    const next = importReviewLinks(links);
    setImported(previous => [...new Map([...previous,...next].map(item => [item.source,item])).values()]);
    setNotice(`Добавлено ссылок: ${next.length}.`);
  }

  async function createRfq(result: SearchResult) {
    try {
      const snapshot = projectFromSearch(result, result.variants?.find(item => item.sku === variant[result.id]), photo);
      const store = await openProjectStore();
      try { await store.save(snapshot); } finally { store.close(); }
      window.location.assign(`/?rfqProject=${encodeURIComponent(snapshot.project.id)}`);
    } catch { setNotice('Не удалось сохранить проект Quick RFQ.'); }
  }

  return <main className="lfs">
    <header className="lfs-header">
      <div><span className="lfs-brand">LIGHT FORGE</span><h1>AI Search — Поиск светильника</h1></div>
      <nav aria-label="Разделы LIGHT FORGE"><a href="/">Quick RFQ</a><a href="/geometry">3D-конструктор</a></nav>
    </header>
    {notice && <p role="status" className="lfs-message">{notice}</p>}
    <div className="lfs-layout">
      <div className="lfs-controls">
        <form className="lfs-panel" onSubmit={search}>
          <h2>Фото и описание</h2>
          <label className="lfs-upload" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); choosePhoto(e.dataTransfer.files); }}>
            <span>{photo?.name ?? 'Загрузи или перетащи фото светильника'}</span>
            <input type="file" aria-label="Фото для поиска" accept={imageTypes.join(',')} onChange={event => choosePhoto(event.target.files)} />
          </label>
          {photoUrl && <div className="lfs-image">
            <img src={photoUrl} alt="Фотография для поиска" />
            {showCrop && <span className="lfs-crop" style={{ left: crop.x+'%', top: crop.y+'%', width: crop.width+'%', height: crop.height+'%' }} />}
          </div>}
          {photo && <button type="button" className="lfs-button" onClick={() => setShowCrop(!showCrop)}>Выделить объект</button>}
          {showCrop && <div className="lfs-crop-inputs">
            {(['x','y','width','height'] as const).map((key, index) => <label key={key}>{['Слева','Сверху','Ширина','Высота'][index]}, %
              <input type="range" min={index < 2 ? 0 : 10} max={index < 2 ? 90 : 100} value={crop[key]} onChange={e => {
                const value = Number(e.target.value);
                setCrop(current => {
                  const next = { ...current, [key]: value };
                  next.width = Math.min(next.width, 100 - next.x);
                  next.height = Math.min(next.height, 100 - next.y);
                  return next;
                });
              }} />
            </label>)}
            <button type="button" className="lfs-button" onClick={() => setCrop(full)}>Всё фото</button>
          </div>}
          <label className="lfs-label">Название, артикул или видимые признаки
            <input placeholder="Например, MYLINE или brass ring pendant" value={query} maxLength={240} onChange={event => setQuery(event.target.value)} />
          </label>
          <label className="lfs-label">Глубина поиска<select value={mode} onChange={event => setMode(event.target.value as SearchInput['mode'])}>
            <option value="standard">Обычный</option><option value="deep">Глубокий · запросы на 4 языках</option>
          </select></label>
          {gemini?.enabled && <label className="lfs-checkbox"><input type="checkbox" checked={allowGemini} onChange={event => setAllowGemini(event.target.checked)} />Отправить оптимизированную копию в Gemini</label>}
          <button className="lfs-button lfs-primary" disabled={loading || (!query.trim() && !photo)}>{loading ? 'Поиск…' : 'Найти'}</button>
        </form>
        <section className="lfs-panel">
          <h2>Google Lens и ссылки</h2>
          <div className="lfs-actions">
            <a className="lfs-button" href="https://lens.google.com/" target="_blank" rel="noreferrer">Открыть Google Lens</a>
            {photo && <button className="lfs-button" onClick={() => void optimizedPhoto(photo, crop).then(file => download(file,file.name)).catch(() => setNotice('Не удалось создать копию.'))}>Скачать копию для Lens</button>}
            {photo && <button className="lfs-button" onClick={() => download(photo,photo.name)}>Скачать оригинал</button>}
          </div>
          <p>В Lens выбери файл вручную. Ссылки из результатов вставь ниже, по одной на строку.</p>
          <textarea aria-label="Ссылки из Lens" value={linkInput} onChange={event => setLinkInput(event.target.value)} rows={3} />
          <button className="lfs-button" onClick={() => {
            try { addLinks(linkInput.split(/\r?\n/).map(url => url.trim()).filter(Boolean).map(url => ({url,title:new URL(url).hostname}))); setLinkInput(''); }
            catch { setNotice('Проверь формат ссылок HTTP или HTTPS.'); }
          }}>Добавить ссылки</button>
        </section>
      </div>
      <div className="lfs-controls">
        <section className="lfs-panel">
          <h2>Совпадения и аналоги</h2>
          <p><strong>Original not verified</strong> · совпадение с фото требует проверки. Поиск без Gemini работает по стартовому каталогу и вручную добавленным ссылкам.</p>
          {last?.traits.length ? <p>Видимые признаки · {last.traits.join(', ')}</p> : null}
          {last?.warning && <p role="status" className="lfs-message">Gemini недоступен ({last.warning}). Можно продолжить через Lens или поиск по описанию.</p>}
          {last?.links.length ? <div className="lfs-actions">{last.links.map(link =>
            <a className="lfs-button" href={link.url} key={link.language} target="_blank" rel="noreferrer">Искать в Google · {link.language}</a>)}</div> : null}
          {!results.length && <p>{last ? 'В стартовом каталоге совпадений нет. Проверь фото через Lens или уточни описание.' : 'Введи название или признаки. Результаты появятся здесь.'}</p>}
          {results.map(result => <article className="lfs-result" key={result.id}>
            <small>{labels[result.category]}</small>
            <h3>{[result.brand,result.name].filter(Boolean).join(' · ')}</h3>
            {result.details && <p>{result.details}</p>}
            {result.variants?.length ? <label className="lfs-label">Артикул и размеры из техпаспорта<select value={variant[result.id] ?? ''} onChange={e=>setVariant(previous=>({...previous,[result.id]:e.target.value}))}>
              <option value="">Выбрать вариант</option>
              {result.variants.map(item=><option key={item.sku} value={item.sku}>{item.sku} · {item.widthMm} × {item.depthMm} × {item.heightMm} мм</option>)}
            </select></label> : null}
            <div className="lfs-actions">
              <a className="lfs-button" href={result.source} target="_blank" rel="noreferrer">{result.brand ? 'Карточка и фото производителя' : 'Открыть источник'}</a>
              {result.documentUrl && <a className="lfs-button" href={result.documentUrl} target="_blank" rel="noreferrer">Техпаспорт PDF</a>}
              <button className="lfs-button" type="button" onClick={() => {
                const next = [...new Map([...saved,{ url:result.source,title:result.name }].map(item=>[item.url,item])).values()].slice(-30);
                localStorage.setItem(savedKey,JSON.stringify(next));
                setSaved(next);
                setNotice('Ссылка сохранена в каталоге браузера.');
              }}>Сохранить ссылку</button>
              <button className="lfs-button lfs-primary" type="button" onClick={() => void createRfq(result)}>Create Manufacturing RFQ</button>
            </div>
          </article>)}
          {saved.length > 0 && <button className="lfs-button" onClick={() => addLinks(saved)}>Мои сохранённые ссылки ({saved.length})</button>}
        </section>
        <section className="lfs-panel">
          <h2>Проверить через ChatGPT</h2>
          <div className="lfs-actions">
            <button className="lfs-button" onClick={() => void navigator.clipboard.writeText(review).then(() => setNotice('Задание скопировано.')).catch(() => download(new Blob([review]),'light-forge-review.txt'))}>Скопировать задание</button>
            <button className="lfs-button" onClick={() => download(new Blob([review],{type:'text/plain'}),'light-forge-review.txt')}>Экспорт задания</button>
            <a className="lfs-button" href="https://chatgpt.com/" target="_blank" rel="noreferrer">Открыть ChatGPT</a>
          </div>
          <p>Прикрепи исходное фото вручную, вставь задание, затем импортируй JSON со ссылками.</p>
          <textarea aria-label="Результат проверки JSON" value={reviewInput} onChange={event => setReviewInput(event.target.value)} rows={2} />
          <button className="lfs-button" onClick={() => {
            try { addLinks(reviewSchema.parse(JSON.parse(reviewInput)).results); setReviewInput(''); }
            catch { setNotice('Ожидается JSON: {"results":[{"title":"…","url":"https://…"}]}.'); }
          }}>Импортировать JSON</button>
        </section>
        <section className="lfs-panel">
          <h2>AI &amp; Search Usage</h2>
          <p>Google Lens и ChatGPT · ручной режим. SerpApi · автоматический поиск выключен.</p>
          <p>Gemini · {gemini?.enabled ? `запросов сегодня ${gemini.requestsToday} из ${gemini.appDailyLimit} по лимиту приложения` : 'выключен'}. Квоту аккаунта смотри в AI Studio. Платный поиск выключен.</p>
          {history.length > 0 && <div className="lfs-actions">{history.map(item => <button key={item} className="lfs-button" onClick={() => setQuery(item)}>{item}</button>)}</div>}
        </section>
      </div>
    </div>
  </main>;
}
