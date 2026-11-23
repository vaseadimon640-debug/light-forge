'use client';

import { useEffect, useState } from 'react';
import type { Axis } from '@/geometry/schema';

type SourceType = Axis['source'];

const srcLabels: Record<SourceType, string> = {
  user: 'Польз.',
  documentation: 'Докум.',
  estimated: 'Оценка',
};

type AxisInputProps = {
  id: string;
  label: string;
  value: Axis | undefined;
  onChange: (next: Axis | undefined) => void;
  unit?: string;
  optional?: boolean;
  min?: number;
  max?: number;
  placeholder?: string;
  error?: string;
};

export function AxisInput({
  id,
  label,
  value,
  onChange,
  unit = 'мм',
  optional = false,
  min,
  max,
  placeholder = 'Не задано',
  error,
}: AxisInputProps) {
  const [draft, setDraft] = useState<string>(() => (value !== undefined ? String(value.value) : ''));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) {
      setDraft(value !== undefined ? String(value.value) : '');
    }
  }, [focused, value]);

  function handleChange(raw: string) {
    setDraft(raw);
    const trimmed = raw.trim().replace(',', '.');
    if (!trimmed) {
      if (optional) onChange(undefined);
      return;
    }
    const num = Number(trimmed);
    if (!Number.isFinite(num)) return;
    if (min !== undefined && num < min) return;
    if (max !== undefined && num > max) return;
    onChange({ value: num, source: value?.source ?? 'user' });
  }

  return (
    <div className="lfg-field">
      <label className="lfg-label" htmlFor={id}>
        <span>{label}</span>
        {optional && value !== undefined && (
          <button
            type="button"
            className="lfg-btn lfg-btn--subtle"
            style={{ minHeight: 18, padding: '0 5px', fontSize: 10.5 }}
            title="Сбросить в «Неизвестно»"
            onClick={() => onChange(undefined)}
          >
            Сбросить
          </button>
        )}
      </label>

      <div className={`lfg-axis-box${error ? ' lfg-axis-box--err' : ''}`}>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          className="lfg-axis-input"
          value={draft}
          placeholder={placeholder}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setDraft(value !== undefined ? String(value.value) : '');
          }}
          onChange={e => handleChange(e.target.value)}
        />
        {unit && <span className="lfg-axis-unit">{unit}</span>}
        {value !== undefined ? (
          <select
            aria-label={`Источник: ${label}`}
            className={`lfg-axis-src lfg-axis-src--${value.source}`}
            value={value.source}
            onChange={e => onChange({ ...value, source: e.target.value as SourceType })}
          >
            {(Object.keys(srcLabels) as SourceType[]).map(k => (
              <option key={k} value={k}>
                {srcLabels[k]}
              </option>
            ))}
          </select>
        ) : (
          <span className="lfg-axis-empty">Неизв.</span>
        )}
      </div>

      {error && <span className="lfg-err-text">{error}</span>}
    </div>
  );
}
