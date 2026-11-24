import type { FactoryResponseStatus, MaterialConfirmation } from '../../storage/suppliers.ts';

export type ProviderHealthState = 'active' | 'standby' | 'disabled' | 'error';

export type ProviderStatusCard = {
  id: 'server' | 'gemini' | 'local-index' | 'photo-analysis' | 'paid-policy';
  title: string;
  endpoint: string;
  state: ProviderHealthState;
  stateLabel: string;
  summary: string;
  details: string[];
  latencyMs?: number;
};

export type LiveProvidersSnapshot = {
  checkedAt: string;
  cards: ProviderStatusCard[];
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

async function probeEndpoint<T>(
  fetcher: FetchLike,
  url: string,
): Promise<{ ok: true; data: T; latencyMs: number } | { ok: false; error: string; latencyMs: number }> {
  const started = Date.now();
  try {
    const res = await fetcher(url, { method: 'GET', cache: 'no-store' });
    const latencyMs = Math.max(0, Date.now() - started);
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}`, latencyMs };
    }
    const data = (await res.json()) as T;
    return { ok: true, data, latencyMs };
  } catch (error) {
    const latencyMs = Math.max(0, Date.now() - started);
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Нет соединения с сервером',
      latencyMs,
    };
  }
}

type HealthPayload = { status?: string; geometryVersion?: number };
type VisualSearchPayload = {
  gemini?: {
    enabled?: boolean;
    requestsToday?: number;
    appDailyLimit?: number;
    providerRemaining?: number | null;
  };
  serpApi?: { enabled?: boolean };
  manualLens?: boolean;
  paidEnabled?: boolean;
};
type LocalIndexPayload = { available?: boolean; referenceCount?: number };
type PhotoAnalysisPayload = {
  apiVersion?: number;
  mode?: string;
  acceptedTypes?: string[];
  maxPhotos?: number;
  maxPhotoBytes?: number;
  maxTotalPhotoBytes?: number;
};

function formatMiB(bytes: number | undefined): string {
  if (!bytes || !Number.isFinite(bytes)) return '—';
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} МиБ`;
}

export async function fetchProviderStatuses(
  fetcher: FetchLike = fetch,
): Promise<LiveProvidersSnapshot> {
  const [health, visual, localIndex, photo] = await Promise.all([
    probeEndpoint<HealthPayload>(fetcher, '/api/health'),
    probeEndpoint<VisualSearchPayload>(fetcher, '/api/visual-search'),
    probeEndpoint<LocalIndexPayload>(fetcher, '/api/visual-search/local'),
    probeEndpoint<PhotoAnalysisPayload>(fetcher, '/api/photo-analysis'),
  ]);

  const cards: ProviderStatusCard[] = [];

  if (health.ok && health.data.status === 'ok') {
    cards.push({
      id: 'server',
      title: 'Сервер LIGHT FORGE и PDF/Geometry API',
      endpoint: 'GET /api/health',
      state: 'active',
      stateLabel: 'Онлайн',
      summary: `Сервер отвечает стабильно (${health.latencyMs} мс). Движок геометрии v${health.data.geometryVersion ?? 1}.`,
      details: [
        'Quick RFQ & Detailed RFQ PDF: доступны автономно',
        'Каноническая единица длины: миллиметры (мм)',
      ],
      latencyMs: health.latencyMs,
    });
  } else {
    cards.push({
      id: 'server',
      title: 'Сервер LIGHT FORGE и PDF/Geometry API',
      endpoint: 'GET /api/health',
      state: 'error',
      stateLabel: 'Ошибка',
      summary: `Не удалось проверить состояние сервера (${health.ok ? 'неожиданный ответ' : health.error}).`,
      details: ['Проверьте, запущен ли Node.js сервер LIGHT FORGE.'],
      latencyMs: health.latencyMs,
    });
  }

  if (visual.ok) {
    const gemini = visual.data.gemini;
    const enabled = Boolean(gemini?.enabled);
    const used = gemini?.requestsToday ?? 0;
    const limit = gemini?.appDailyLimit ?? 20;
    const quotaReached = enabled && used >= limit;
    cards.push({
      id: 'gemini',
      title: 'Gemini Vision (Free Tier)',
      endpoint: 'GET /api/visual-search',
      state: enabled ? (quotaReached ? 'standby' : 'active') : 'standby',
      stateLabel: enabled ? (quotaReached ? 'Дневной лимит' : 'Активен (Free)') : 'Не настроен',
      summary: enabled
        ? quotaReached
          ? `Достигнут дневной защитный лимит приложения (${used}/${limit}). Доступны каталог и ручной Lens.`
          : `Подключён на сервере в режиме Free Tier (${used}/${limit} запросов за сегодня).`
        : 'Ключ GEMINI_API_KEY или список моделей не заданы на сервере. Ручной поиск, каталог и Lens работают автономно.',
      details: [
        `Дневной лимит приложения: ${used} / ${limit}`,
        `Ручной Google Lens: ${visual.data.manualLens ? 'включён' : 'выключен'}`,
        'Ключи хранятся только на сервере; в браузер не передаются',
      ],
      latencyMs: visual.latencyMs,
    });

    const paidEnabled = Boolean(visual.data.paidEnabled) || Boolean(visual.data.serpApi?.enabled);
    cards.push({
      id: 'paid-policy',
      title: 'Платные внешние AI API (SerpApi / Billing)',
      endpoint: 'GET /api/visual-search',
      state: paidEnabled ? 'active' : 'disabled',
      stateLabel: paidEnabled ? 'Включено' : 'Отключено',
      summary: paidEnabled
        ? 'На сервере активированы внешние платные провайдеры.'
        : 'Платные провайдеры и автоматическое переключение на платные тарифы отключены.',
      details: [
        `SerpApi: ${visual.data.serpApi?.enabled ? 'включён' : 'отключён'}`,
        'Политика AGENTS.md: подключение платных API только после явного согласования расходов',
      ],
      latencyMs: visual.latencyMs,
    });
  } else {
    cards.push({
      id: 'gemini',
      title: 'Gemini Vision (Free Tier)',
      endpoint: 'GET /api/visual-search',
      state: 'error',
      stateLabel: 'Недоступен',
      summary: `Не удалось получить статус Visual Search (${visual.error}).`,
      details: ['Повторите проверку после восстановления соединения.'],
      latencyMs: visual.latencyMs,
    });
  }

  if (localIndex.ok) {
    const available = Boolean(localIndex.data.available);
    const count = localIndex.data.referenceCount ?? 0;
    cards.push({
      id: 'local-index',
      title: 'Локальный визуальный индекс каталога',
      endpoint: 'GET /api/visual-search/local',
      state: available ? 'active' : 'standby',
      stateLabel: available ? `Готов (${count})` : 'Не собран',
      summary: available
        ? `Локальный индекс загружен: ${count} эталонных изображений для сравнения без внешних API.`
        : 'Локальный индекс эталонных фото ещё не сформирован на сервере (поиск по каталогу по названию остаётся доступным).',
      details: [
        'Работает полностью локально без отправки фото в интернет',
        'Оригиналы загруженных фото сохраняются без изменений',
      ],
      latencyMs: localIndex.latencyMs,
    });
  } else {
    cards.push({
      id: 'local-index',
      title: 'Локальный визуальный индекс каталога',
      endpoint: 'GET /api/visual-search/local',
      state: 'error',
      stateLabel: 'Ошибка',
      summary: `Не удалось проверить локальный индекс (${localIndex.error}).`,
      details: ['Проверьте доступность /api/visual-search/local.'],
      latencyMs: localIndex.latencyMs,
    });
  }

  if (photo.ok) {
    const isVisual = photo.data.mode === 'visual_analysis';
    cards.push({
      id: 'photo-analysis',
      title: 'Анализ загруженных фото',
      endpoint: 'GET /api/photo-analysis',
      state: isVisual ? 'active' : 'standby',
      stateLabel: isVisual ? 'Ollama Vision' : 'Только метаданные',
      summary: isVisual
        ? 'Подключён локальный движок Ollama Vision для черновых оценок по фото.'
        : 'Режим metadata_only: проверка подлинности, размеров и типов файлов без локального Ollama.',
      details: [
        `Лимит фото на проект: до ${photo.data.maxPhotos ?? 8} шт. (${formatMiB(photo.data.maxTotalPhotoBytes)})`,
        `Макс. размер файла: ${formatMiB(photo.data.maxPhotoBytes)}`,
      ],
      latencyMs: photo.latencyMs,
    });
  } else {
    cards.push({
      id: 'photo-analysis',
      title: 'Анализ загруженных фото',
      endpoint: 'GET /api/photo-analysis',
      state: 'error',
      stateLabel: 'Ошибка',
      summary: `Не удалось проверить API анализа фото (${photo.error}).`,
      details: ['Проверьте доступность /api/photo-analysis.'],
      latencyMs: photo.latencyMs,
    });
  }

  return {
    checkedAt: new Date().toISOString(),
    cards,
  };
}

export function factoryStatusMeta(status: FactoryResponseStatus): {
  label: string;
  tone: 'neutral' | 'info' | 'warn' | 'good' | 'danger';
} {
  switch (status) {
    case 'requested':
      return { label: 'Запрос отправлен', tone: 'neutral' };
    case 'clarification':
      return { label: 'Вопросы фабрики', tone: 'warn' };
    case 'quoted':
      return { label: 'Получено КП', tone: 'info' };
    case 'sampling':
      return { label: 'Образец в работе', tone: 'info' };
    case 'approved':
      return { label: 'Согласовано', tone: 'good' };
    case 'declined':
      return { label: 'Отклонено', tone: 'danger' };
  }
}

export function materialConfirmationMeta(status: MaterialConfirmation): {
  label: string;
  tone: 'neutral' | 'good' | 'danger';
} {
  switch (status) {
    case 'confirmed':
      return { label: 'Подтверждено без замен', tone: 'good' };
    case 'substitution_proposed':
      return { label: 'Предложена замена (нужно согласие)', tone: 'danger' };
    default:
      return { label: 'Не подтверждено фабрикой', tone: 'neutral' };
  }
}

export function formatMoney(price: number | undefined, currency: string | undefined): string {
  if (price === undefined || !Number.isFinite(price)) return 'Не указано';
  const formatted = new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 2,
  }).format(price);
  return `${formatted} ${currency ?? 'USD'}`;
}

export function formatDays(days: number | undefined): string {
  if (days === undefined || !Number.isFinite(days)) return 'Не указано';
  return `${days} дн.`;
}

export function formatTimestampRu(iso: string | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
