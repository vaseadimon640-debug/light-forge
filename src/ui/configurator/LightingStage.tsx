'use client';

import { useMemo, useState } from 'react';
import {
  APPLICATION_PRESETS,
  calculateLightingTiers,
  DIFFUSER_PRESETS,
  validateElectricalCompatibility,
  type DiffuserKind,
  type LightingApplication,
  type LightingTierRecommendation,
} from '@/domain/lighting-calculator';
import {
  dimmingModes,
  directions,
  driverTypes,
  inputVoltages,
  ipRatings,
  ledTypes,
  productTypes,
  sources,
  type Component,
  type Project,
} from '@/domain/project';
import { AlertIcon, CheckIcon, SparkIcon } from '../icons';
import { orderedPhotos } from '../quick-rfq/helpers';

type LightingStageProps = {
  project: Project;
  photoUrls: Record<string, string>;
  onUpdateProject: (mutator: (p: Project) => Project, touchedKey?: string) => void;
  onBack: () => void;
  onNext: () => void;
};

const directionKeys = Object.keys(directions) as NonNullable<Component['light']['directionId']>[];
const ledTypeKeys = Object.keys(ledTypes) as NonNullable<Component['light']['ledType']>[];
const driverTypeKeys = Object.keys(driverTypes) as NonNullable<Component['light']['driver']>[];
const diffuserKeys = Object.keys(DIFFUSER_PRESETS) as DiffuserKind[];
const applicationKeys = Object.keys(APPLICATION_PRESETS) as LightingApplication[];

const CCT_PRESETS = [
  { value: 2700, label: '2700 K · Тёплый' },
  { value: 3000, label: '3000 K · Тёплый белый' },
  { value: 3500, label: '3500 K · Мягкий нейтральный' },
  { value: 4000, label: '4000 K · Нейтральный' },
] as const;

const CRI_PRESETS = [80, 90, 95, 97] as const;
const BEAM_PRESETS = [36, 60, 110, 120, 180, 360] as const;

const DIRECTION_GLYPHS: Record<NonNullable<Component['light']['directionId']>, string> = {
  up: '↑',
  down: '↓',
  both: '↕',
  diffuse: '◎',
  adjustable: '↻',
};

export function LightingStage({
  project,
  photoUrls,
  onUpdateProject,
  onBack,
  onNext,
}: LightingStageProps) {
  const [activeCompIdx, setActiveCompIdx] = useState(0);
  const [diffuser, setDiffuser] = useState<DiffuserKind>('opalPolycarbonate');
  const [application, setApplication] = useState<LightingApplication>(
    project.mounting.ceilingFromFloorMm && project.mounting.ceilingFromFloorMm.value >= 4000
      ? 'architectural'
      : 'dining',
  );
  const [manualLengthMmInput, setManualLengthMmInput] = useState('');

  const safeIdx = Math.min(activeCompIdx, Math.max(0, project.components.length - 1));
  const comp = project.components[safeIdx];

  const parsedManualLength = Number(manualLengthMmInput.trim().replace(',', '.'));
  const manualLengthOverrideMm =
    manualLengthMmInput.trim() && Number.isFinite(parsedManualLength) ? parsedManualLength : null;

  const calc = useMemo(
    () =>
      calculateLightingTiers({
        component: comp,
        diffuser,
        application,
        manualLengthOverrideMm,
      }),
    [comp, diffuser, application, manualLengthOverrideMm],
  );

  const diagnostics = useMemo(
    () => validateElectricalCompatibility(comp, project),
    [comp, project],
  );

  const totalWatts = project.components.reduce(
    (sum, item) => sum + (item.light.watts?.value ?? 0) * item.quantity,
    0,
  );
  const totalLumens = project.components.reduce(
    (sum, item) => sum + (item.light.lumens?.value ?? 0) * item.quantity,
    0,
  );

  function updateMetric(
    key: 'cct' | 'cri' | 'watts' | 'lumens' | 'beamAngleDeg',
    raw: string,
    source: 'user' | 'estimated' = 'user',
  ) {
    const trimmed = raw.trim().replace(',', '.');
    onUpdateProject((p) => ({
      ...p,
      components: p.components.map((item, idx) => {
        if (idx !== safeIdx) return item;
        const nextLight = { ...item.light };
        if (!trimmed) {
          delete nextLight[key];
        } else {
          const val = Number(trimmed);
          if (Number.isFinite(val) && val > 0) {
            nextLight[key] = {
              value: key === 'cct' ? Math.round(val) : val,
              source,
            };
          }
        }
        return { ...item, light: nextLight };
      }),
    }), `light:${safeIdx}:${key}`);
  }

  function updateLightField<K extends 'ledType' | 'directionId' | 'voltage' | 'driver' | 'dimming' | 'ip'>(
    key: K,
    value: Component['light'][K] | '',
  ) {
    onUpdateProject((p) => ({
      ...p,
      components: p.components.map((item, idx) => {
        if (idx !== safeIdx) return item;
        const nextLight = { ...item.light };
        if (!value) {
          delete nextLight[key];
        } else {
          nextLight[key] = value as Component['light'][K];
        }
        return { ...item, light: nextLight };
      }),
    }), `light:${safeIdx}:${key}`);
  }

  function applyTier(tier: LightingTierRecommendation) {
    onUpdateProject((p) => ({
      ...p,
      components: p.components.map((item, idx) => {
        if (idx !== safeIdx) return item;
        return {
          ...item,
          light: {
            ...item.light,
            watts: { value: tier.wattsW, source: 'estimated' },
            lumens: { value: tier.lumensLm, source: 'estimated' },
          },
        };
      }),
    }), `light:${safeIdx}:calc-${tier.id}`);
  }

  const photos = orderedPhotos(project);
  const primary = photos.find((p) => p.id === project.primaryPhotoId) ?? photos[0];
  const primaryUrl = primary ? photoUrls[primary.id] : undefined;

  return (
    <section aria-labelledby="lfw-stage4-title">
      <div className="lfw-stage-head" style={{ marginBottom: 18 }}>
        <div>
          <h1 id="lfw-stage4-title">Свет и электрические характеристики</h1>
          <p>
            Мощность и световой поток рассчитываются математической формулой по размерам и потерям рассеивателя — без угадывания AI.
          </p>
        </div>
      </div>

      <div className="lfw-split">
        <aside className="lfw-visual-aside">
          <div className="lfw-visual-aside-img">
            {primaryUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={primaryUrl} alt={primary?.name ?? project.name} />
            ) : (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--atelier-muted)', fontSize: 13 }}>
                Сводка светотехники по элементам светильника.
              </div>
            )}
          </div>
          <div className="lfw-visual-aside-meta">
            <strong>{project.name}</strong>
            <span className="lf-field-hint">
              {productTypes[project.kind][0]} · Заказ: {project.orderQuantity} шт.
            </span>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: 8,
                marginTop: 6,
              }}
            >
              <div className="lfw-kpi" style={{ padding: '8px 10px' }}>
                <strong style={{ fontSize: 16 }}>
                  {totalWatts > 0 ? `${Math.round(totalWatts)} Вт` : '—'}
                </strong>
                <span>Суммарно / комплект</span>
              </div>
              <div className="lfw-kpi" style={{ padding: '8px 10px' }}>
                <strong style={{ fontSize: 16 }}>
                  {totalLumens > 0 ? `${Math.round(totalLumens)} лм` : '—'}
                </strong>
                <span>Световой поток</span>
              </div>
            </div>
            {project.components.length > 1 && (
              <div style={{ display: 'grid', gap: 4, marginTop: 4 }}>
                {project.components.map((c) => (
                  <div key={c.id} className="lf-field-hint" style={{ fontSize: 11.5 }}>
                    {c.name} ×{c.quantity}: {c.light.watts ? `${c.light.watts.value} Вт` : 'Вт?'} ·{' '}
                    {c.light.lumens ? `${c.light.lumens.value} лм` : 'лм?'} ·{' '}
                    {c.light.directionId ? directions[c.light.directionId][0] : 'напр.?'}
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Multi-component selector */}
          {project.components.length > 1 && (
            <div className="lfw-panel" style={{ padding: '14px 18px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-secondary)' }}>
                  Настройка элемента:
                </span>
                {project.components.map((c, idx) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`lf-btn lf-btn--sm${idx === safeIdx ? ' lf-btn--primary' : ' lf-btn--subtle'}`}
                    onClick={() => setActiveCompIdx(idx)}
                  >
                    {c.name} ×{c.quantity}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 1. Light Parameters */}
          <div className="lfw-panel">
            <h2>1. Свет (Light) · {comp.name}</h2>

            {/* CCT Quick Presets + Numeric */}
            <div className="lfw-grid-2">
              <div className="lfw-field">
                <label htmlFor="lfw-light-cct">
                  CCT (цветовая температура, K)
                  {comp.light.cct && (
                    <span style={{ marginLeft: 6, fontWeight: 400, opacity: 0.75 }}>
                      · {sources[comp.light.cct.source][0]}
                    </span>
                  )}
                </label>
                <input
                  id="lfw-light-cct"
                  type="number"
                  min={1800}
                  max={10000}
                  step={100}
                  placeholder="На подтверждение фабрике"
                  value={comp.light.cct ? String(comp.light.cct.value) : ''}
                  onChange={(e) => updateMetric('cct', e.target.value)}
                />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 4 }}>
                  {CCT_PRESETS.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      className={`lf-btn lf-btn--sm${comp.light.cct?.value === p.value ? ' lf-btn--primary' : ' lf-btn--subtle'}`}
                      onClick={() => updateMetric('cct', String(p.value))}
                    >
                      {p.value}K
                    </button>
                  ))}
                </div>
              </div>

              <div className="lfw-field">
                <label htmlFor="lfw-light-cri">
                  CRI (индекс цветопередачи, Ra)
                  {comp.light.cri && (
                    <span style={{ marginLeft: 6, fontWeight: 400, opacity: 0.75 }}>
                      · {sources[comp.light.cri.source][0]}
                    </span>
                  )}
                </label>
                <input
                  id="lfw-light-cri"
                  type="number"
                  min={60}
                  max={100}
                  step={1}
                  placeholder="Например, 90"
                  value={comp.light.cri ? String(comp.light.cri.value) : ''}
                  onChange={(e) => updateMetric('cri', e.target.value)}
                />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 4 }}>
                  {CRI_PRESETS.map((cri) => (
                    <button
                      key={cri}
                      type="button"
                      className={`lf-btn lf-btn--sm${comp.light.cri?.value === cri ? ' lf-btn--primary' : ' lf-btn--subtle'}`}
                      onClick={() => updateMetric('cri', String(cri))}
                    >
                      CRI {cri}+
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="lfw-grid-2">
              <div className="lfw-field">
                <label htmlFor="lfw-light-led-type">Тип источника LED (LED Type)</label>
                <select
                  id="lfw-light-led-type"
                  value={comp.light.ledType ?? ''}
                  onChange={(e) =>
                    updateLightField(
                      'ledType',
                      e.target.value as NonNullable<Component['light']['ledType']> | '',
                    )
                  }
                >
                  <option value="">На подтверждение фабрике</option>
                  {ledTypeKeys.map((key) => (
                    <option key={key} value={key}>
                      {ledTypes[key][0]} ({ledTypes[key][1]})
                    </option>
                  ))}
                </select>
              </div>

              <div className="lfw-field">
                <label htmlFor="lfw-light-beam">
                  Угол рассеивания (Beam Angle, °)
                  {comp.light.beamAngleDeg && (
                    <span style={{ marginLeft: 6, fontWeight: 400, opacity: 0.75 }}>
                      · {sources[comp.light.beamAngleDeg.source][0]}
                    </span>
                  )}
                </label>
                <input
                  id="lfw-light-beam"
                  type="number"
                  min={5}
                  max={360}
                  step={5}
                  placeholder="Например, 120"
                  value={comp.light.beamAngleDeg ? String(comp.light.beamAngleDeg.value) : ''}
                  onChange={(e) => updateMetric('beamAngleDeg', e.target.value)}
                />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 4 }}>
                  {BEAM_PRESETS.map((deg) => (
                    <button
                      key={deg}
                      type="button"
                      className={`lf-btn lf-btn--sm${comp.light.beamAngleDeg?.value === deg ? ' lf-btn--primary' : ' lf-btn--subtle'}`}
                      onClick={() => updateMetric('beamAngleDeg', String(deg))}
                    >
                      {deg}°
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Visual Light Direction Picker */}
            <div className="lfw-field">
              <label>Направление света (Light Direction)</label>
              <div className="lfw-direction-grid" role="group" aria-label="Направление света">
                {directionKeys.map((dk) => (
                  <button
                    key={dk}
                    id={`lfw-dir-${dk}`}
                    type="button"
                    className="lfw-direction-btn"
                    aria-pressed={comp.light.directionId === dk}
                    onClick={() => updateLightField('directionId', dk)}
                  >
                    <span className="lfw-direction-glyph" aria-hidden="true">
                      {DIRECTION_GLYPHS[dk]}
                    </span>
                    <span>{directions[dk][0]}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Manual Wattage & Lumens */}
            <div className="lfw-grid-2">
              <div className="lfw-field">
                <label htmlFor="lfw-light-watts">
                  Мощность на элемент (Wattage, Вт)
                  {comp.light.watts && (
                    <span style={{ marginLeft: 6, fontWeight: 400, opacity: 0.75 }}>
                      · {sources[comp.light.watts.source][0]}
                    </span>
                  )}
                </label>
                <input
                  id="lfw-light-watts"
                  type="number"
                  min={0.5}
                  step="0.5"
                  placeholder="Unknown"
                  value={comp.light.watts ? String(comp.light.watts.value) : ''}
                  onChange={(e) => updateMetric('watts', e.target.value)}
                />
              </div>
              <div className="lfw-field">
                <label htmlFor="lfw-light-lumens">
                  Световой поток на элемент (Lumens, лм)
                  {comp.light.lumens && (
                    <span style={{ marginLeft: 6, fontWeight: 400, opacity: 0.75 }}>
                      · {sources[comp.light.lumens.source][0]}
                    </span>
                  )}
                </label>
                <input
                  id="lfw-light-lumens"
                  type="number"
                  min={1}
                  step="10"
                  placeholder="Unknown"
                  value={comp.light.lumens ? String(comp.light.lumens.value) : ''}
                  onChange={(e) => updateMetric('lumens', e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* 2. Deterministic Mathematical Wattage & Lumen Calculator */}
          <div id="lfw-math-lighting-calc" className="lfw-panel" style={{ borderColor: 'var(--brass-border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <h2 style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <SparkIcon size={16} /> Математический расчёт мощности и потока
              </h2>
              <span className="lf-badge lf-badge--estimated">Формула · Статус Estimated</span>
            </div>

            <div className="lfw-status-row">
              <span>{calc.lengthExplanationRu}</span>
              <strong>
                Эффективность системы: {calc.effectiveSystemEfficacyLmPerW.toFixed(1)} лм/Вт
              </strong>
            </div>

            <div className="lfw-grid-2">
              <div className="lfw-field">
                <label htmlFor="lfw-calc-diffuser">Тип рассеивателя (оптические потери)</label>
                <select
                  id="lfw-calc-diffuser"
                  value={diffuser}
                  onChange={(e) => setDiffuser(e.target.value as DiffuserKind)}
                >
                  {diffuserKeys.map((dk) => (
                    <option key={dk} value={dk}>
                      {DIFFUSER_PRESETS[dk].labelRu}
                    </option>
                  ))}
                </select>
              </div>
              <div className="lfw-field">
                <label htmlFor="lfw-calc-application">Сценарий применения</label>
                <select
                  id="lfw-calc-application"
                  value={application}
                  onChange={(e) => setApplication(e.target.value as LightingApplication)}
                >
                  {applicationKeys.map((ak) => (
                    <option key={ak} value={ak}>
                      {APPLICATION_PRESETS[ak].labelRu}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {calc.luminousLengthSource !== 'dimensions' && (
              <div className="lfw-field">
                <label htmlFor="lfw-calc-manual-len">
                  Временная длина светящейся части для расчёта (мм) — если размеры на шаге 2 ещё не заполнены
                </label>
                <input
                  id="lfw-calc-manual-len"
                  type="number"
                  min={50}
                  max={50000}
                  step={50}
                  placeholder="Например, 1500"
                  value={manualLengthMmInput}
                  onChange={(e) => setManualLengthMmInput(e.target.value)}
                />
              </div>
            )}

            {calc.canCalculate ? (
              <div className="lfw-tier-grid">
                {calc.tiers.map((tier) => (
                  <div
                    key={tier.id}
                    id={`lfw-tier-${tier.id}`}
                    className={`lfw-tier-card${tier.recommended ? ' lfw-tier-card--recommended' : ''}`}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 13 }}>{tier.labelRu}</strong>
                      {tier.recommended && <span className="lf-badge lf-badge--documentation">Оптимально</span>}
                    </div>
                    <div className="lfw-tier-metrics">
                      <span>{tier.wattsW} Вт</span>
                      <span>·</span>
                      <span>{tier.lumensLm} лм</span>
                    </div>
                    <div className="lf-field-hint" style={{ fontSize: 11.5, flex: 1 }}>
                      {tier.formulaRu}
                    </div>
                    <button
                      id={`lfw-apply-tier-${tier.id}`}
                      type="button"
                      className={`lf-btn lf-btn--sm${tier.recommended ? ' lf-btn--primary' : ' lf-btn--subtle'}`}
                      onClick={() => applyTier(tier)}
                    >
                      Применить расчёт
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="lf-field-hint" style={{ margin: 0 }}>
                Укажите габариты элемента в миллиметрах на шаге 2 (или временную длину выше), чтобы выполнить математический расчёт Economy / Standard / High Output.
              </p>
            )}
          </div>

          {/* 3. Electrical Parameters */}
          <div className="lfw-panel">
            <h2>2. Электрика (Electrical)</h2>
            <div className="lfw-grid-2">
              <div className="lfw-field">
                <label htmlFor="lfw-elec-voltage">Входное напряжение (Input Voltage)</label>
                <select
                  id="lfw-elec-voltage"
                  value={comp.light.voltage ?? ''}
                  onChange={(e) =>
                    updateLightField(
                      'voltage',
                      e.target.value as NonNullable<Component['light']['voltage']> | '',
                    )
                  }
                >
                  <option value="">На подтверждение фабрике</option>
                  {inputVoltages.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>

              <div className="lfw-field">
                <label htmlFor="lfw-elec-driver">Драйвер / блок питания (Driver)</label>
                <select
                  id="lfw-elec-driver"
                  value={comp.light.driver ?? ''}
                  onChange={(e) =>
                    updateLightField(
                      'driver',
                      e.target.value as NonNullable<Component['light']['driver']> | '',
                    )
                  }
                >
                  <option value="">На подтверждение фабрике</option>
                  {driverTypeKeys.map((dk) => (
                    <option key={dk} value={dk}>
                      {driverTypes[dk][0]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="lfw-field">
                <label htmlFor="lfw-elec-dimming">Диммирование (Dimming)</label>
                <select
                  id="lfw-elec-dimming"
                  value={comp.light.dimming ?? ''}
                  onChange={(e) =>
                    updateLightField(
                      'dimming',
                      e.target.value as NonNullable<Component['light']['dimming']> | '',
                    )
                  }
                >
                  <option value="">На подтверждение фабрике</option>
                  {dimmingModes.map((dm) => (
                    <option key={dm} value={dm}>
                      {dm === 'none' ? 'Без диммирования (On/Off)' : dm}
                    </option>
                  ))}
                </select>
              </div>

              <div className="lfw-field">
                <label htmlFor="lfw-elec-ip">Степень защиты (IP Rating)</label>
                <select
                  id="lfw-elec-ip"
                  value={comp.light.ip ?? ''}
                  onChange={(e) =>
                    updateLightField(
                      'ip',
                      e.target.value as NonNullable<Component['light']['ip']> | '',
                    )
                  }
                >
                  <option value="">На подтверждение фабрике</option>
                  {ipRatings.map((ip) => (
                    <option key={ip} value={ip}>
                      {ip}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Electrical Compatibility Diagnostics */}
            {diagnostics.length > 0 && (
              <div id="lfw-electrical-diagnostics" style={{ display: 'grid', gap: 8 }}>
                {diagnostics.map((item) => (
                  <div
                    key={item.id}
                    className={`lfw-diag-row lfw-diag-row--${item.severity}`}
                    role={item.severity === 'error' ? 'alert' : 'status'}
                  >
                    <AlertIcon size={16} />
                    <div>
                      <strong>{item.title}</strong>
                      <p>{item.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="lfw-footer-nav">
            <button type="button" className="lf-btn lf-btn--subtle" onClick={onBack}>
              ← Назад к материалам
            </button>
            <button id="lfw-to-install-btn" type="button" className="lf-btn lf-btn--primary" onClick={onNext}>
              <CheckIcon size={15} /> Продолжить к монтажу →
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
