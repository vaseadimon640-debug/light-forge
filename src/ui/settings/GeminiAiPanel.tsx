'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  geminiStatusResponseSchema,
  geminiTestResponseSchema,
  type GeminiStatusResponse,
} from '@/ai/gemini-contract';
import {
  defaultStudioPreferences,
  loadStudioPreferences,
  saveStudioPreferences,
  type StudioPreferences,
} from '@/storage/preferences';
import { formatTimestampRu } from './helpers';

export function GeminiAiPanel() {
  const [status, setStatus] = useState<GeminiStatusResponse | null>(null);
  const [prefs, setPrefs] = useState<StudioPreferences>(defaultStudioPreferences);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [testing, setTesting] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [prefMessage, setPrefMessage] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setLoadingStatus(true);
    setFetchError(null);
    try {
      const res = await fetch('/api/ai/gemini/status', { method: 'GET', cache: 'no-store' });
      if (!res.ok) {
        setFetchError(`Сервер вернул HTTP ${res.status} при чтении статуса Gemini AI.`);
        return;
      }
      const parsed = geminiStatusResponseSchema.safeParse(await res.json());
      if (!parsed.success) {
        setFetchError('Некорректный формат ответа /api/ai/gemini/status.');
        return;
      }
      setStatus(parsed.data);
    } catch {
      setFetchError('Не удалось связаться с сервером LIGHT FORGE для проверки Gemini AI.');
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    setPrefs(loadStudioPreferences());
    void loadStatus();
  }, [loadStatus]);

  const selectableModels = useMemo(() => {
    const set = new Set<string>([
      ...(status?.allowedModels ?? []),
      ...(status?.availableFlashModels ?? []),
    ]);
    return [...set];
  }, [status]);

  function updateAiPref(
    patch: Partial<
      Pick<
        StudioPreferences,
        'preferredGeminiModel' | 'deepAiAnalysisEnabled' | 'requireExternalAiConsent'
      >
    >,
  ) {
    const res = saveStudioPreferences(patch);
    setPrefs(res.preferences);
    setPrefMessage(
      res.persisted
        ? 'Настройки AI сохранены и будут применяться при следующем анализе.'
        : 'Настройки применены в текущей сессии.',
    );
  }

  async function handleTestConnection() {
    setTesting(true);
    setFetchError(null);
    try {
      const res = await fetch('/api/ai/gemini/test', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: prefs.preferredGeminiModel || undefined }),
      });
      const raw = await res.json();
      const parsed = geminiTestResponseSchema.safeParse(raw);
      if (parsed.success) {
        setStatus(parsed.data.status);
      } else {
        setFetchError('Некорректный ответ проверки подключения Gemini AI.');
      }
    } catch {
      setFetchError('Сетевая ошибка при запуске проверки подключения Gemini AI.');
    } finally {
      setTesting(false);
    }
  }

  function connectionBadge(): { label: string; tone: 'good' | 'warn' | 'danger' | 'neutral' } {
    if (!status) return { label: 'Загрузка…', tone: 'neutral' };
    if (!status.configured) return { label: 'Ключ не задан', tone: 'warn' };
    if (status.lastTest) {
      return status.lastTest.ok
        ? { label: 'Подключено', tone: 'good' }
        : { label: 'Ошибка подключения', tone: 'danger' };
    }
    return { label: 'Ключ задан · не проверен', tone: 'neutral' };
  }

  function modelAvailabilityLabel(): { label: string; tone: 'good' | 'warn' | 'danger' | 'neutral' } {
    if (!status || !status.configured) return { label: 'Нет ключа', tone: 'neutral' };
    if (status.modelAvailable === true) return { label: 'Доступна', tone: 'good' };
    if (status.modelAvailable === false) return { label: 'Недоступна', tone: 'danger' };
    return { label: 'Не проверена', tone: 'warn' };
  }

  const conn = connectionBadge();
  const avail = modelAvailabilityLabel();

  return (
    <section
      id="lf-gemini-ai-section"
      className="atelier-panel"
      aria-labelledby="lf-gemini-ai-heading"
    >
      <div className="lf-providers-head">
        <div>
          <h2 id="lf-gemini-ai-heading">AI Settings · Gemini Vision &amp; PDF</h2>
          <p className="lf-settings-pref-hint">
            Серверное подключение <code>GEMINI_API_KEY</code> через <code>@google/genai</code>,
            выбор бесплатной Flash-модели, контроль расхода и кеш результатов.
          </p>
        </div>
        <div className="atelier-inline">
          <button
            id="lf-gemini-refresh-btn"
            type="button"
            className="lf-btn lf-btn--subtle"
            disabled={loadingStatus || testing}
            onClick={() => void loadStatus()}
          >
            Обновить
          </button>
          <button
            id="lf-gemini-test-btn"
            type="button"
            className="lf-btn lf-btn--primary"
            disabled={testing}
            onClick={() => void handleTestConnection()}
          >
            {testing ? 'Проверяем подключение…' : 'Проверить подключение'}
          </button>
        </div>
      </div>

      {fetchError && (
        <p id="lf-gemini-fetch-error" role="alert" className="lf-suppliers-alert" style={{ marginBottom: 12 }}>
          {fetchError}
        </p>
      )}

      <div className="lf-storage-kpis" style={{ marginBottom: 12 }}>
        <div className="lf-storage-kpi">
          <span className="lf-settings-pref-hint">Состояние подключения</span>
          <div>
            <span id="lf-gemini-conn-badge" className={`lf-st-pill lf-st-pill--${conn.tone}`}>
              {conn.label}
            </span>
          </div>
        </div>
        <div className="lf-storage-kpi">
          <span className="lf-settings-pref-hint">Активная модель</span>
          <strong id="lf-gemini-model-value" style={{ fontSize: 13.5 }} className="mono">
            {prefs.preferredGeminiModel || status?.selectedModel || 'Авто (Flash)'}
          </strong>
        </div>
        <div className="lf-storage-kpi">
          <span className="lf-settings-pref-hint">Дневной / месячный расход</span>
          <strong style={{ fontSize: 15 }}>
            {status
              ? `${status.requestsToday}/${status.dailyLimit} · ${status.requestsThisMonth}/${status.monthlyLimit}`
              : '—'}
          </strong>
        </div>
        <div className="lf-storage-kpi">
          <span className="lf-settings-pref-hint">Лимит стоимости (Cost Limit)</span>
          <div>
            <span className="lf-st-pill lf-st-pill--good">$0 · Free Tier Only</span>
          </div>
        </div>
      </div>

      {/* Configurable AI Controls */}
      <div className="lf-settings-policy-box" style={{ marginBottom: 12 }}>
        <div className="lf-settings-policy-row">
          <label htmlFor="lf-gemini-model-select" style={{ fontWeight: 600 }}>
            Active Vision Model (Free Tier Flash)
          </label>
          <select
            id="lf-gemini-model-select"
            value={prefs.preferredGeminiModel}
            style={{
              minHeight: 34,
              padding: '4px 10px',
              borderRadius: 'var(--radius-xs)',
              border: '1px solid var(--border)',
              background: 'var(--bg-surface)',
              maxWidth: '100%',
            }}
            onChange={(e) => updateAiPref({ preferredGeminiModel: e.target.value })}
          >
            <option value="">Автовыбор (приоритет: gemini-3.8-flash)</option>
            {selectableModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>

        <div className="lf-settings-policy-row">
          <span>Доступность модели</span>
          <span id="lf-gemini-avail-badge" className={`lf-st-pill lf-st-pill--${avail.tone}`}>
            {avail.label}
          </span>
        </div>

        <div className="lf-settings-policy-row">
          <span>Search Provider</span>
          <span style={{ fontSize: 12 }}>
            {status?.searchProviderLabel ?? 'Каталог LIGHT FORGE + ручной Google Lens'}
          </span>
        </div>

        <div className="lf-settings-policy-row">
          <span>Кеш результатов анализа (экономия токенов)</span>
          <span className="mono" style={{ fontSize: 12 }}>
            Активен ({status?.cacheEntries ?? 0} записей в памяти сервера)
          </span>
        </div>

        <label className="lf-settings-policy-row" style={{ cursor: 'pointer' }}>
          <span>
            <strong>Deep Analysis Enabled</strong> (детальный разбор узлов, стыков и таблиц чертежа)
          </span>
          <input
            id="lf-gemini-deep-toggle"
            type="checkbox"
            checked={prefs.deepAiAnalysisEnabled}
            onChange={(e) => updateAiPref({ deepAiAnalysisEnabled: e.target.checked })}
          />
        </label>

        <label className="lf-settings-policy-row" style={{ cursor: 'pointer' }}>
          <span>
            <strong>Конфиденциальность чертежей</strong> (подтверждать отправку во внешний AI перед анализом)
          </span>
          <input
            id="lf-gemini-consent-toggle"
            type="checkbox"
            checked={prefs.requireExternalAiConsent}
            onChange={(e) => updateAiPref({ requireExternalAiConsent: e.target.checked })}
          />
        </label>

        {prefMessage && (
          <span className="lf-settings-pref-hint" role="status">
            {prefMessage}
          </span>
        )}
      </div>

      {status?.lastTest && (
        <div
          id="lf-gemini-test-result"
          role="status"
          className={status.lastTest.ok ? 'lf-settings-policy-box' : 'lf-suppliers-alert'}
          style={{ marginBottom: 12 }}
        >
          <div className="lf-settings-policy-row">
            <strong>
              Последний тест ({formatTimestampRu(status.lastTest.at)} · {status.lastTest.latencyMs} мс)
            </strong>
            <span
              className={`lf-st-pill lf-st-pill--${status.lastTest.ok ? 'good' : 'danger'}`}
            >
              {status.lastTest.ok ? 'Успешно' : `Ошибка: ${status.lastTest.code ?? 'error'}`}
            </span>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 12.5 }}>{status.lastTest.message}</p>
        </div>
      )}

      {!status?.configured && (
        <div className="lf-settings-policy-box">
          <strong>Как подключить ключ локально:</strong>
          <p className="lf-settings-pref-hint" style={{ margin: 0 }}>
            Скопируйте <code>.env.example</code> в <code>.env.local</code> в корне проекта, вставьте
            свой ключ в <code>GEMINI_API_KEY=...</code> и перезапустите сервер. Файл{' '}
            <code>.env.local</code> защищён в <code>.gitignore</code> и никогда не попадает в Git.
          </p>
        </div>
      )}
    </section>
  );
}
