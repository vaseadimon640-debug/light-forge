'use client';

import { useEffect, useState } from 'react';
import { sources, type Measurement, type Unit } from '@/domain/project';
import { displayToMm, mmToDisplay, parsePlainNumber, unitLabels } from './helpers';

type MeasurementSource = Measurement['source'];

const sourceShortLabels: Record<MeasurementSource, string> = {
  user: 'Пользователь',
  documentation: 'Документация',
  estimated: 'Оценка',
};

type MeasurementInputProps = {
  id: string;
  label: string;
  value: Measurement | undefined;
  onChange: (next: Measurement | undefined) => void;
  /** When set, value is stored in mm and converted to/from this display unit. */
  lengthUnit?: Unit;
  /** Fixed suffix unit for non-length numbers (e.g. 'K', 'W', 'lm'). */
  fixedUnit?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  integer?: boolean;
  error?: string;
  hint?: string;
};

export function MeasurementInput({
  id,
  label,
  value,
  onChange,
  lengthUnit,
  fixedUnit,
  placeholder = 'На подтверждение',
  min = 0,
  max,
  integer = false,
  error,
  hint,
}: MeasurementInputProps) {
  const formatExternal = (measurement: Measurement | undefined) => {
    if (!measurement) return '';
    return lengthUnit ? mmToDisplay(measurement.value, lengthUnit) : String(measurement.value);
  };

  const [draft, setDraft] = useState<string>(() => formatExternal(value));
  const [focused, setFocused] = useState(false);

  // Sync draft when external value or display unit changes while not actively typing
  useEffect(() => {
    if (!focused) {
      setDraft(formatExternal(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.value, lengthUnit, focused]);

  const displayedUnit = lengthUnit ? unitLabels[lengthUnit] : fixedUnit;

  function handleTextChange(raw: string) {
    setDraft(raw);
    const trimmed = raw.trim();
    if (!trimmed) {
      onChange(undefined);
      return;
    }
    const parsed = lengthUnit ? displayToMm(trimmed, lengthUnit) : parsePlainNumber(trimmed);
    if (parsed === null) return;
    const normalized = integer ? Math.round(parsed) : parsed;
    if (normalized < min) return;
    if (max !== undefined && normalized > max) return;
    onChange({
      value: normalized,
      source: value?.source ?? 'user',
    });
  }

  function handleBlur() {
    setFocused(false);
    setDraft(formatExternal(value));
  }

  function handleSourceChange(source: MeasurementSource) {
    if (!value) return;
    onChange({ ...value, source });
  }

  return (
    <div className="lf-field">
      <div className="lf-field-head">
        <label className="lf-label" htmlFor={id}>
          {label}
        </label>
        {lengthUnit && value && lengthUnit !== 'mm' && (
          <span className="lf-label-unit" title="Каноническое значение в миллиметрах">
            {value.value} мм
          </span>
        )}
      </div>

      <div className={`lf-measure-row${error ? ' lf-measure-row--error' : ''}`}>
        <input
          id={id}
          type="text"
          inputMode={integer ? 'numeric' : 'decimal'}
          className="lf-measure-input"
          value={draft}
          placeholder={placeholder}
          onFocus={() => setFocused(true)}
          onBlur={handleBlur}
          onChange={event => handleTextChange(event.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
        />
        {displayedUnit && <span className="lf-measure-unit">{displayedUnit}</span>}
        {value ? (
          <select
            id={`${id}-source`}
            aria-label={`Источник данных: ${label}`}
            title={`Источник данных: ${sources[value.source][0]}`}
            className={`lf-source-select lf-source-select--${value.source}`}
            value={value.source}
            onChange={event => handleSourceChange(event.target.value as MeasurementSource)}
          >
            {(Object.keys(sourceShortLabels) as MeasurementSource[]).map(key => (
              <option key={key} value={key}>
                {sourceShortLabels[key]}
              </option>
            ))}
          </select>
        ) : (
          <span className="lf-source-empty" title="Будет отмечено в RFQ как «На подтверждение фабрике»">
            Не указано
          </span>
        )}
      </div>

      {error && (
        <span id={`${id}-err`} className="lf-field-error">
          {error}
        </span>
      )}
      {!error && hint && (
        <span id={`${id}-hint`} className="lf-field-hint">
          {hint}
        </span>
      )}
    </div>
  );
}
