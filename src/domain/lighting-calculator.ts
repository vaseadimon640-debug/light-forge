import type { Component, Project } from './project.ts';

export type DiffuserKind =
  | 'opalPolycarbonate'
  | 'frostedGlass'
  | 'microprismatic'
  | 'clearOpen';

export type LightingApplication =
  | 'ambient'
  | 'dining'
  | 'workspace'
  | 'architectural';

export type LightingTierId = 'economy' | 'standard' | 'highOutput';

export type LightingTierRecommendation = {
  id: LightingTierId;
  labelRu: string;
  labelEn: string;
  recommended: boolean;
  wattsW: number;
  lumensLm: number;
  wattsPerMeter: number;
  systemEfficacyLmPerW: number;
  formulaRu: string;
};

export type LightingCalculationResult = {
  canCalculate: boolean;
  luminousLengthMm: number | null;
  luminousLengthSource: 'dimensions' | 'manual_override' | 'unknown';
  lengthExplanationRu: string;
  ledBaseEfficacyLmPerW: number;
  criFactor: number;
  cctFactor: number;
  diffuserTransmittance: number;
  diffuserLossPct: number;
  effectiveSystemEfficacyLmPerW: number;
  directionFactor: number;
  applicationFactor: number;
  tiers: LightingTierRecommendation[];
};

export type ElectricalDiagnostic = {
  id: string;
  severity: 'ok' | 'warning' | 'error';
  title: string;
  detail: string;
};

export const DIFFUSER_PRESETS: Record<
  DiffuserKind,
  { labelRu: string; transmittance: number; lossPct: number }
> = {
  opalPolycarbonate: {
    labelRu: 'Опаловый ПК / акрил (мягкий свет, −24%)',
    transmittance: 0.76,
    lossPct: 24,
  },
  frostedGlass: {
    labelRu: 'Матовое стекло (−18%)',
    transmittance: 0.82,
    lossPct: 18,
  },
  microprismatic: {
    labelRu: 'Микропризма (−14%)',
    transmittance: 0.86,
    lossPct: 14,
  },
  clearOpen: {
    labelRu: 'Прозрачный / открытый (−6%)',
    transmittance: 0.94,
    lossPct: 6,
  },
};

export const APPLICATION_PRESETS: Record<
  LightingApplication,
  { labelRu: string; factor: number; hintRu: string }
> = {
  ambient: {
    labelRu: 'Атмосферный / декоративный',
    factor: 0.78,
    hintRu: 'Лаунж, спальня, мягкий акцент',
  },
  dining: {
    labelRu: 'Над столом / переговорная',
    factor: 1.0,
    hintRu: 'Комфортная освещённость столешницы',
  },
  workspace: {
    labelRu: 'Рабочая зона / офис',
    factor: 1.22,
    hintRu: 'Повышенная яркость для работы',
  },
  architectural: {
    labelRu: 'Архитектурный / высокий потолок > 4 м',
    factor: 1.3,
    hintRu: 'Атриум, второй свет, высокие потолки',
  },
};

const LED_RAW_EFFICACY_LM_W: Record<NonNullable<Component['light']['ledType']> | 'default', number> = {
  smdStrip: 115,
  cobLinear: 108,
  cobModule: 120,
  ledBoard: 126,
  replaceableBulb: 95,
  custom: 110,
  default: 115,
};

const TIER_BASE_W_PER_M: Record<LightingTierId, { wPerM: number; labelRu: string; labelEn: string }> = {
  economy: { wPerM: 14, labelRu: 'Economy · Мягкий', labelEn: 'Economy' },
  standard: { wPerM: 24, labelRu: 'Standard · Сбалансированный', labelEn: 'Standard' },
  highOutput: { wPerM: 36, labelRu: 'High Output · Максимальный', labelEn: 'High Output' },
};

/**
 * Computes luminous path length in millimetres strictly from known component dimensions.
 * Never invents missing geometry; returns null when no usable dimension exists.
 */
export function computeLuminousLengthMm(component: Component): {
  lengthMm: number | null;
  explanationRu: string;
} {
  const d = component.dimensions;
  const width = d.width?.value;
  const height = d.height?.value;
  const depth = d.depth?.value;
  const length = d.length?.value;
  const outerD = d.outerDiameter?.value;
  const innerD = d.innerDiameter?.value;
  const radius = d.radius?.value;

  if (component.kind === 'arc') {
    if (width && width > 0) {
      const r = radius && radius > 0 ? Math.min(radius, width / 2) : width / 2;
      const semiArc = Math.PI * r;
      if (height && height > r) {
        const legs = 2 * (height - r);
        const total = Math.round(semiArc + legs);
        return {
          lengthMm: total,
          explanationRu: `U-дуга: полуокружность π×${Math.round(r)} мм + 2 плеча по ${Math.round(height - r)} мм = ${total} мм`,
        };
      }
      const total = Math.round(semiArc);
      return {
        lengthMm: total,
        explanationRu: `Дуга: полуокружность π×${Math.round(r)} мм = ${total} мм`,
      };
    }
    if (radius && radius > 0) {
      const total = Math.round(Math.PI * radius);
      return {
        lengthMm: total,
        explanationRu: `Дуга по радиусу R=${Math.round(radius)} мм: π×R = ${total} мм`,
      };
    }
  }

  if (component.kind === 'ring') {
    const meanD =
      outerD && outerD > 0 && innerD && innerD > 0
        ? (outerD + innerD) / 2
        : outerD && outerD > 0
          ? outerD
          : width && width > 0
            ? width
            : null;
    if (meanD) {
      const total = Math.round(Math.PI * meanD);
      return {
        lengthMm: total,
        explanationRu: `Кольцо (средний Ø ${Math.round(meanD)} мм): длина окружности π×D = ${total} мм`,
      };
    }
  }

  if (component.kind === 'linear') {
    const span = length && length > 0 ? length : width && width > 0 ? width : null;
    if (span) {
      return {
        lengthMm: Math.round(span),
        explanationRu: `Линейный корпус: светящаяся длина ${Math.round(span)} мм`,
      };
    }
  }

  // Generic fixtures: circular diameter -> linear span -> rectangular contour -> height
  if (outerD && outerD > 0) {
    const total = Math.round(Math.PI * outerD);
    return {
      lengthMm: total,
      explanationRu: `Круглый контур Ø ${Math.round(outerD)} мм: π×D = ${total} мм`,
    };
  }
  if (length && length > 0) {
    return {
      lengthMm: Math.round(length),
      explanationRu: `По длине корпуса: ${Math.round(length)} мм`,
    };
  }
  if (width && width > 0 && depth && depth > 0) {
    if (width / depth >= 2.2) {
      return {
        lengthMm: Math.round(width),
        explanationRu: `Вытянутый корпус (${Math.round(width)}×${Math.round(depth)} мм): светящийся пролёт ${Math.round(width)} мм`,
      };
    }
    if (width <= 350 && depth <= 350) {
      const base = Math.round(Math.max(width, depth));
      return {
        lengthMm: base,
        explanationRu: `Компактный модуль (${Math.round(width)}×${Math.round(depth)} мм): эквивалент ${base} мм`,
      };
    }
    const contour = Math.round(2 * (width + depth) * 0.65);
    return {
      lengthMm: contour,
      explanationRu: `Контур светильника (${Math.round(width)}×${Math.round(depth)} мм): расчётная линия ${contour} мм`,
    };
  }
  if (width && width > 0) {
    return {
      lengthMm: Math.round(width),
      explanationRu: `По ширине корпуса: ${Math.round(width)} мм`,
    };
  }
  if (height && height > 0) {
    return {
      lengthMm: Math.round(height),
      explanationRu: `По вертикальной высоте корпуса: ${Math.round(height)} мм`,
    };
  }

  return {
    lengthMm: null,
    explanationRu: 'Размеры корпуса (мм) ещё не указаны — введите габариты на шаге 2 или укажите временную длину свечения.',
  };
}

/**
 * Pure deterministic mathematical lighting power & luminous flux calculator.
 * Never guesses via AI; computes Economy / Standard / High Output tiers from geometry, LED efficacy,
 * CRI/CCT derating, diffuser optical loss, emission faces, and application factor.
 */
export function calculateLightingTiers(params: {
  component: Component;
  diffuser: DiffuserKind;
  application: LightingApplication;
  manualLengthOverrideMm?: number | null;
}): LightingCalculationResult {
  const { component, diffuser, application, manualLengthOverrideMm } = params;
  const fromDims = computeLuminousLengthMm(component);

  const hasValidOverride =
    typeof manualLengthOverrideMm === 'number' &&
    Number.isFinite(manualLengthOverrideMm) &&
    manualLengthOverrideMm >= 50 &&
    manualLengthOverrideMm <= 50_000;

  const luminousLengthMm = fromDims.lengthMm ?? (hasValidOverride ? Math.round(manualLengthOverrideMm) : null);
  const luminousLengthSource: LightingCalculationResult['luminousLengthSource'] = fromDims.lengthMm
    ? 'dimensions'
    : hasValidOverride
      ? 'manual_override'
      : 'unknown';

  const lengthExplanationRu = fromDims.lengthMm
    ? fromDims.explanationRu
    : hasValidOverride
      ? `Временное допущение длины свечения: ${Math.round(manualLengthOverrideMm)} мм (требует подтверждения габаритов)`
      : fromDims.explanationRu;

  const ledBase = LED_RAW_EFFICACY_LM_W[component.light.ledType ?? 'default'];
  const criVal = component.light.cri?.value ?? 90;
  const criFactor = criVal >= 95 ? 0.88 : criVal >= 90 ? 0.94 : 1.0;

  const cctVal = component.light.cct?.value ?? 3000;
  const cctFactor = cctVal <= 2700 ? 0.94 : cctVal <= 3200 ? 0.97 : 1.0;

  const diffPreset = DIFFUSER_PRESETS[diffuser];
  const appPreset = APPLICATION_PRESETS[application];
  const directionFactor = component.light.directionId === 'both' ? 1.35 : 1.0;

  const effectiveSystemEfficacy = Math.round(
    ledBase * criFactor * cctFactor * diffPreset.transmittance * 10,
  ) / 10;

  if (!luminousLengthMm) {
    return {
      canCalculate: false,
      luminousLengthMm: null,
      luminousLengthSource,
      lengthExplanationRu,
      ledBaseEfficacyLmPerW: ledBase,
      criFactor,
      cctFactor,
      diffuserTransmittance: diffPreset.transmittance,
      diffuserLossPct: diffPreset.lossPct,
      effectiveSystemEfficacyLmPerW: effectiveSystemEfficacy,
      directionFactor,
      applicationFactor: appPreset.factor,
      tiers: [],
    };
  }

  const lengthMeters = Math.max(0.12, luminousLengthMm / 1000);
  const tiers: LightingTierRecommendation[] = (['economy', 'standard', 'highOutput'] as const).map(
    (tierId) => {
      const cfg = TIER_BASE_W_PER_M[tierId];
      const wattsPerMeter =
        Math.round(cfg.wPerM * appPreset.factor * directionFactor * 10) / 10;
      const wattsW = Math.max(3, Math.round(lengthMeters * wattsPerMeter));
      const lumensLm = Math.round(wattsW * effectiveSystemEfficacy);

      const formulaRu = `${lengthMeters.toFixed(2)} м × ${wattsPerMeter.toFixed(1)} Вт/м = ${wattsW} Вт · ${wattsW} Вт × ${effectiveSystemEfficacy.toFixed(1)} лм/Вт (с потерями −${diffPreset.lossPct}%) = ${lumensLm} лм`;

      return {
        id: tierId,
        labelRu: cfg.labelRu,
        labelEn: cfg.labelEn,
        recommended: tierId === 'standard',
        wattsW,
        lumensLm,
        wattsPerMeter,
        systemEfficacyLmPerW: effectiveSystemEfficacy,
        formulaRu,
      };
    },
  );

  return {
    canCalculate: true,
    luminousLengthMm,
    luminousLengthSource,
    lengthExplanationRu,
    ledBaseEfficacyLmPerW: ledBase,
    criFactor,
    cctFactor,
    diffuserTransmittance: diffPreset.transmittance,
    diffuserLossPct: diffPreset.lossPct,
    effectiveSystemEfficacyLmPerW: effectiveSystemEfficacy,
    directionFactor,
    applicationFactor: appPreset.factor,
    tiers,
  };
}

/**
 * Deterministic electrical compatibility checker for dimming, driver type, input voltage, IP, and efficacy.
 */
export function validateElectricalCompatibility(
  component: Component,
  project: Project,
): ElectricalDiagnostic[] {
  const diagnostics: ElectricalDiagnostic[] = [];
  const { light } = component;
  const totalFixtureWatts = project.components.reduce(
    (sum, item) => sum + (item.light.watts?.value ?? 0) * item.quantity,
    0,
  );
  const componentWatts = light.watts?.value ?? null;
  const componentLumens = light.lumens?.value ?? null;

  // 1. Dimming vs Driver compatibility
  const smartDimming =
    light.dimming === 'DALI' ||
    light.dimming === 'DALI-2' ||
    light.dimming === '0–10 V' ||
    light.dimming === 'Casambi' ||
    light.dimming === 'KNX';

  if (smartDimming && light.driver === 'none') {
    diagnostics.push({
      id: 'dimming-needs-driver',
      severity: 'error',
      title: `Конфликт: ${light.dimming} несовместим с режимом «Без драйвера»`,
      detail: `Протокол ${light.dimming} требует управляемый LED-драйвер (выносной, в чаше или в корпусе). Выберите тип драйвера или переведите диммирование в «none».`,
    });
  } else if (smartDimming && !light.driver) {
    diagnostics.push({
      id: 'dimming-driver-unconfirmed',
      severity: 'warning',
      title: `Укажите размещение драйвера для ${light.dimming}`,
      detail: `Протокол ${light.dimming} требует согласования места установки драйвера (выносной в запотолочном пространстве или внутри потолочной чаши) и подвода шины управления.`,
    });
  }

  if (light.dimming === 'TRIAC') {
    if (light.voltage === '24 V DC' || light.voltage === '48 V DC') {
      diagnostics.push({
        id: 'triac-dc-warning',
        severity: 'warning',
        title: 'TRIAC с питанием 24V/48V DC требует фазового БП',
        detail:
          'При диммировании TRIAC со стороны сети 220–240V AC необходимо явно запросить у фабрики совместимый TRIAC-диммируемый блок питания 24V/48V DC (leading/trailing edge).',
      });
    }
    if (totalFixtureWatts > 150) {
      diagnostics.push({
        id: 'triac-high-load',
        severity: 'warning',
        title: `Высокая суммарная мощность (${Math.round(totalFixtureWatts)} Вт) для TRIAC`,
        detail:
          'Для композиций мощнее 150 Вт предпочтительнее DALI / DALI-2 или 0–10 V во избежание мерцания и перегрузки фазового диммера.',
      });
    }
  }

  // 2. Low-voltage DC vs driver & voltage drop
  if (light.voltage === '24 V DC' || light.voltage === '48 V DC') {
    if (light.driver === 'none') {
      diagnostics.push({
        id: 'dc-requires-psu',
        severity: 'error',
        title: `Конфликт: ${light.voltage} требует выносной блок питания`,
        detail: `Низковольтное питание ${light.voltage} нельзя подключать напрямую к сети AC без блока питания (CV/Remote).`,
      });
    } else if (totalFixtureWatts > 100) {
      diagnostics.push({
        id: 'dc-voltage-drop',
        severity: 'warning',
        title: `Контроль падения напряжения при ${light.voltage} (${Math.round(totalFixtureWatts)} Вт)`,
        detail:
          'При длинных подвесах и мощности > 100 Вт фабрике нужно подтвердить сечение кабеля и максимальную длину линии от выносного БП.',
      });
    }
  }

  // 3. IP rating vs driver protection
  if (light.ip && light.ip !== 'IP20') {
    diagnostics.push({
      id: 'ip-driver-protection',
      severity: 'warning',
      title: `Требования влагозащиты ${light.ip}`,
      detail:
        light.driver === 'integratedBody' || light.driver === 'integratedCanopy'
          ? `Убедитесь, что встроенный драйвер и кабельные вводы сертифицированы не ниже ${light.ip}.`
          : `Для степени защиты ${light.ip} запросите герметичный драйвер (IP65/IP67) либо подтвердите вынос драйвера в сухую зону.`,
    });
  }

  // 4. Physical efficacy sanity check (lm/W)
  if (componentWatts && componentLumens) {
    const efficacy = componentLumens / componentWatts;
    if (efficacy < 35) {
      diagnostics.push({
        id: 'efficacy-too-low',
        severity: 'warning',
        title: `Низкая световая отдача: ${efficacy.toFixed(1)} лм/Вт`,
        detail:
          'Значение ниже 35 лм/Вт нетипично для современных LED. Проверьте, не указаны ли потери тёмного стекла или суммарная мощность всей композиции вместо одного элемента.',
      });
    } else if (efficacy > 195) {
      diagnostics.push({
        id: 'efficacy-too-high',
        severity: 'warning',
        title: `Сверхвысокая световая отдача: ${efficacy.toFixed(1)} лм/Вт`,
        detail:
          'Значение выше 195 лм/Вт обычно относится к «голому» светодиоду без учёта потерь рассеивателя и драйвера — уточните реальный выходной поток светильника у фабрики.',
      });
    }
  }

  // 5. Recommended driver reserve (+20%)
  if (totalFixtureWatts > 0) {
    const recommendedDriverW = Math.ceil((totalFixtureWatts * 1.2) / 10) * 10;
    const hasErrors = diagnostics.some((d) => d.severity === 'error');
    if (!hasErrors) {
      diagnostics.push({
        id: 'driver-headroom-ok',
        severity: 'ok',
        title: `Расчётный запас драйвера (+20%): ≥ ${recommendedDriverW} Вт`,
        detail: `Суммарная мощность светильника: ${Math.round(totalFixtureWatts)} Вт. Рекомендуемый запас по мощности блока питания для стабильной работы и ресурса LED — не менее ${recommendedDriverW} Вт.`,
      });
    }
  }

  return diagnostics;
}
