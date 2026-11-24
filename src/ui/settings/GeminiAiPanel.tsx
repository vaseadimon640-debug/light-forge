'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  geminiStatusResponseSchema,
  geminiTestResponseSchema,
  type GeminiStatusResponse,
} from '@/ai/gemini-contract';
import { formatTimestampRu } from './helpers';

export function GeminiAiPanel() {
  const [status, setStatus] = useState<GeminiStatusResponse | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [testing, setTesting] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

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
    void loadStatus();
  }, [loadStatus]);

  async function handleTestConnection() {
    setTesting(true);
    setFetchError(null);
    try {
      const res = await fetch('/api/ai/gemini/test', { method: 'POST', cache: 'no-store' });
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
          <h2 id="lf-gemini-ai-heading">Gemini AI (анализ фото и чертежей / PDF)</h2>
          <p className="lf-settings-pref-hint">
            Безопасное серверное подключение через <code>@google/genai</code> и переменную{' '}
            <code>GEMINI_API_KEY</code>. Секретный ключ не передаётся в браузер и не выводится в логах.
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
          <span className="lf-settings-pref-hint">Выбранная модель</span>
          <strong id="lf-gemini-model-value" style={{ fontSize: 14 }} className="mono">
            {status?.selectedModel ?? 'Не выбрана'}
          </strong>
        </div>
        <div className="lf-storage-kpi">
          <span className="lf-settings-pref-hint">Доступность модели</span>
          <div>
            <span id="lf-gemini-avail-badge" className={`lf-st-pill lf-st-pill--${avail.tone}`}>
              {avail.label}
            </span>
          </div>
        </div>
        <div className="lf-storage-kpi">
          <span className="lf-settings-pref-hint">Лимит приложения (Free Tier)</span>
          <strong style={{ fontSize: 16 }}>
            {status ? `${status.requestsToday} / ${status.dailyLimit}` : '—'}
          </strong>
        </div>
      </div>

      {status && (
        <div className="lf-settings-policy-box" style={{ marginBottom: 12 }}>
          <div className="lf-settings-policy-row">
            <span>Тарифная политика</span>
            <span className="lf-st-pill lf-st-pill--good">
              Free Tier Flash · без авто-биллинга
            </span>
          </div>
          <div className="lf-settings-policy-row">
            <span>Явный выбор (<code>GEMINI_MODEL</code>)</span>
            <span className="mono" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>
              {status.configuredModel ?? 'Автовыбор из разрешённого списка Flash'}
            </span>
          </div>
          <div className="lf-settings-policy-row">
            <span>Разрешённые Flash-модели</span>
            <span className="mono" style={{ fontSize: 11.5, overflowWrap: 'anywhere' }}>
              {status.allowedModels.join(', ')}
            </span>
          </div>
          {status.availableFlashModels.length > 0 && (
            <div className="lf-settings-policy-row">
              <span>Обнаружены в вашем аккаунте</span>
              <span className="mono" style={{ fontSize: 11.5, overflowWrap: 'anywhere' }}>
                {status.availableFlashModels.slice(0, 6).join(', ')}
              </span>
            </div>
          )}
        </div>
      )}

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
