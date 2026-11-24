import {
  dimensions,
  directions,
  finishes,
  materials,
  productTypes,
  sources,
  type Component,
  type DimensionKey,
  type Material,
  type Measurement,
  type Photo,
  type ProductType,
  type Project,
  type Unit,
} from '../../domain/project.ts';
import { PhotoAnalysisError } from '../../photo-analysis/client.ts';
import type { PhotoAnalysisResponse } from '../../photo-analysis/contract.ts';
import type { ProjectSnapshot } from '../../storage/projects.ts';
import { mmToDisplay, unitLabels } from './helpers.ts';

export type { PhotoAnalysisResponse };
export type PhotoAnalysisMode = PhotoAnalysisResponse['mode'];
export type AnalyzedPhoto = PhotoAnalysisResponse['photos'][number];

export type PhotoSuggestionConfidence = 'high' | 'medium' | 'low';
export type PhotoSuggestionStatus = 'pending' | 'accepted' | 'edited' | 'skipped';
export type LightMetricKey = 'cct' | 'cri' | 'watts' | 'lumens';
export type MountingFieldKey = 'ceilingFromFloorMm' | 'tabletopFromFloorMm';

export type PhotoSuggestionPayload =
  | {
      kind: 'productKind';
      value: ProductType;
    }
  | {
      kind: 'dimension';
      componentId?: string;
      dimensionKey: DimensionKey;
      valueMm: number;
    }
  | {
      kind: 'material';
      componentId?: string;
      part: string;
      material: Material['material'];
      materialDetail?: string;
      finish?: Material['finish'];
      finishDetail?: string;
      color?: string;
    }
  | {
      kind: 'lightDirection';
      componentId?: string;
      directionId: NonNullable<Component['light']['directionId']>;
    }
  | {
      kind: 'lightMetric';
      componentId?: string;
      metric: LightMetricKey;
      value: number;
    }
  | {
      kind: 'mounting';
      field: MountingFieldKey;
      valueMm: number;
    };

export type PhotoSuggestion = {
  id: string;
  photoId?: string;
  confidence: PhotoSuggestionConfidence;
  confidenceScore?: number;
  note?: string;
  source?: 'estimated';
  payload: PhotoSuggestionPayload;
  status: PhotoSuggestionStatus;
  appliedSummary?: string;
};

export type PhotoSuggestionEditOverride =
  | { kind: 'productKind'; value: ProductType }
  | { kind: 'dimension'; valueMm: number; source: Measurement['source'] }
  | {
      kind: 'material';
      part: string;
      material: Material['material'];
      materialDetail?: string;
      finish?: Material['finish'];
      finishDetail?: string;
      color?: string;
    }
  | { kind: 'lightDirection'; directionId: NonNullable<Component['light']['directionId']> }
  | { kind: 'lightMetric'; value: number; source: Measurement['source'] }
  | { kind: 'mounting'; valueMm: number; source: Measurement['source'] };

/**
 * Adapter seam matching the Codex photo-analysis API contract v1.
 */
export type PhotoAnalysisRequest = {
  snapshot: ProjectSnapshot;
  photoIds: string[];
  signal?: AbortSignal;
};

export type PhotoAnalysisProvider = {
  label: string;
  analyze: (request: PhotoAnalysisRequest) => Promise<PhotoAnalysisResponse>;
};

export type PhotoAnalysisUiError = {
  status: number;
  code: string;
  message: string;
  retryable: boolean;
};

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return 'name' in error && (error as { name?: unknown }).name === 'AbortError';
}

export function formatPhotoAnalysisError(error: unknown): PhotoAnalysisUiError {
  if (error instanceof PhotoAnalysisError) {
    switch (error.code) {
      case 'invalid_photo':
        return {
          status: error.status,
          code: error.code,
          message:
            'Один из выбранных файлов повреждён, не соответствует формату/размеру или превышает лимит пикселей (до 60 Мп на фото, до 120 Мп суммарно). Проверьте файлы или продолжите ручной ввод.',
          retryable: false,
        };
      case 'invalid_photo_list':
        return {
          status: error.status,
          code: error.code,
          message:
            'Некорректный список выбранных фотографий (нужно от 1 до 8 уникальных фото, суммарно до 32 МиБ).',
          retryable: false,
        };
      case 'request_too_large':
        return {
          status: error.status,
          code: error.code,
          message:
            'Выбранные фотографии превышают допустимый объём запроса (32 МиБ). Снимите часть фотографий и повторите попытку.',
          retryable: false,
        };
      case 'unsupported_media_type':
        return {
          status: error.status,
          code: error.code,
          message: 'Сервер отклонил формат запроса анализа фото (ожидается multipart/form-data).',
          retryable: false,
        };
      case 'cross_site_request':
        return {
          status: error.status,
          code: error.code,
          message: 'Запрос анализа фото с внешнего источника запрещён политикой безопасности.',
          retryable: false,
        };
      case 'invalid_body':
        return {
          status: error.status,
          code: error.code,
          message: 'Сервер не смог прочитать список выбранных фото в запросе.',
          retryable: true,
        };
      case 'engine_error':
      case 'invalid_engine_response':
      case 'invalid_response':
        return {
          status: error.status,
          code: error.code,
          message:
            'Сервис анализа фото вернул некорректный ответ или временно недоступен. Повторите попытку или заполните форму вручную.',
          retryable: true,
        };
      default:
        return {
          status: error.status,
          code: error.code,
          message: `Ошибка сервиса анализа фото (${error.status}: ${error.code}). Повторите попытку или продолжите ручной ввод.`,
          retryable: error.status >= 500 || error.status === 0,
        };
    }
  }

  return {
    status: 0,
    code: 'network_error',
    message:
      'Не удалось связаться с сервисом анализа фото. Проверьте подключение и повторите попытку — ручной ввод остаётся доступным.',
    retryable: true,
  };
}

export function syncSelectedPhotoIds(
  currentSelected: string[],
  projectPhotos: Photo[],
  newlyAddedIds: string[] = [],
): string[] {
  const existingIds = new Set(projectPhotos.map(photo => photo.id));
  const selectedSet = new Set(currentSelected.filter(id => existingIds.has(id)));
  for (const id of newlyAddedIds) {
    if (existingIds.has(id)) selectedSet.add(id);
  }
  return projectPhotos.filter(photo => selectedSet.has(photo.id)).map(photo => photo.id);
}

export function formatMimeLabel(type: Photo['type']): string {
  if (type === 'image/jpeg') return 'JPEG';
  if (type === 'image/png') return 'PNG';
  return 'WebP';
}

export function formatMegapixels(widthPx: number, heightPx: number): string {
  const mp = (widthPx * heightPx) / 1_000_000;
  if (mp < 0.1) return `${(widthPx * heightPx).toLocaleString('ru-RU')} пикс.`;
  return `${mp.toFixed(mp >= 10 ? 1 : 2)} Мп`;
}

export type CurrentFieldSummary = {
  categoryLabel: string;
  targetLabel: string;
  componentName?: string;
  isEmpty: boolean;
  matchesProposal: boolean;
  hasManualValue: boolean;
  currentLabel: string;
  currentSource?: Measurement['source'];
};

export type ApplySuggestionResult =
  | { ok: true; project: Project; appliedSummary: string }
  | { ok: false; error: string };

export const confidenceLabels: Record<PhotoSuggestionConfidence, string> = {
  high: 'Высокая уверенность',
  medium: 'Средняя уверенность',
  low: 'Низкая уверенность',
};

export const lightMetricLabels: Record<LightMetricKey, { label: string; unit: string }> = {
  cct: { label: 'Цветовая температура (CCT)', unit: 'K' },
  cri: { label: 'Индекс цветопередачи (CRI)', unit: 'Ra' },
  watts: { label: 'Мощность', unit: 'Вт' },
  lumens: { label: 'Световой поток', unit: 'лм' },
};

export const mountingFieldLabels: Record<MountingFieldKey, string> = {
  ceilingFromFloorMm: 'Высота потолка от пола',
  tabletopFromFloorMm: 'Высота столешницы от пола',
};

function resolveTargetComponent(project: Project, componentId?: string): Component {
  if (componentId) {
    const found = project.components.find(item => item.id === componentId);
    if (found) return found;
  }
  return project.components[0];
}

function normalizePartName(value: string): string {
  return value.trim().toLowerCase();
}

export function formatLengthForUnit(valueMm: number, unit: Unit): string {
  return `${mmToDisplay(valueMm, unit)} ${unitLabels[unit]}`;
}

export function formatMaterialSummary(item: {
  part: string;
  material: Material['material'];
  materialDetail?: string;
  finish?: Material['finish'];
  finishDetail?: string;
  color?: string;
}): string {
  const parts: string[] = [
    `${item.part}: ${materials[item.material][0]}${item.materialDetail ? ` (${item.materialDetail})` : ''}`,
  ];
  if (item.finish) {
    parts.push(`отделка — ${finishes[item.finish][0]}${item.finishDetail ? ` (${item.finishDetail})` : ''}`);
  }
  if (item.color?.trim()) {
    parts.push(`цвет — ${item.color.trim()}`);
  }
  return parts.join(' · ');
}

export function formatSuggestionProposal(
  payload: PhotoSuggestionPayload,
  unit: Unit,
): string {
  switch (payload.kind) {
    case 'productKind':
      return `${productTypes[payload.value][0]} (${productTypes[payload.value][1]})`;
    case 'dimension':
      return formatLengthForUnit(payload.valueMm, unit);
    case 'material':
      return formatMaterialSummary(payload);
    case 'lightDirection':
      return `${directions[payload.directionId][0]} (${directions[payload.directionId][1]})`;
    case 'lightMetric':
      return `${payload.value} ${lightMetricLabels[payload.metric].unit}`;
    case 'mounting':
      return formatLengthForUnit(payload.valueMm, unit);
  }
}

export function getCurrentFieldSummary(
  project: Project,
  suggestion: PhotoSuggestion,
  unit: Unit,
): CurrentFieldSummary {
  const { payload } = suggestion;

  if (payload.kind === 'productKind') {
    const matches = project.kind === payload.value;
    return {
      categoryLabel: 'Тип изделия',
      targetLabel: 'Тип светильника',
      isEmpty: false,
      matchesProposal: matches,
      hasManualValue: !matches,
      currentLabel: `${productTypes[project.kind][0]} (${productTypes[project.kind][1]})`,
    };
  }

  if (payload.kind === 'dimension') {
    const comp = resolveTargetComponent(project, payload.componentId);
    const existing = comp.dimensions[payload.dimensionKey];
    if (!existing) {
      return {
        categoryLabel: 'Габариты (оценка по фото)',
        targetLabel: dimensions[payload.dimensionKey][0],
        componentName: comp.name,
        isEmpty: true,
        matchesProposal: false,
        hasManualValue: false,
        currentLabel: 'Не заполнено',
      };
    }
    const matches = Math.abs(existing.value - payload.valueMm) < 0.001;
    return {
      categoryLabel: 'Габариты (оценка по фото)',
      targetLabel: dimensions[payload.dimensionKey][0],
      componentName: comp.name,
      isEmpty: false,
      matchesProposal: matches,
      hasManualValue: existing.source !== 'estimated',
      currentLabel: `${formatLengthForUnit(existing.value, unit)} (${sources[existing.source][0]})`,
      currentSource: existing.source,
    };
  }

  if (payload.kind === 'material') {
    const comp = resolveTargetComponent(project, payload.componentId);
    const targetPart = normalizePartName(payload.part);
    const existing = comp.materials.find(item => normalizePartName(item.part) === targetPart);
    if (!existing) {
      return {
        categoryLabel: 'Материал · Отделка · Цвет',
        targetLabel: `Деталь «${payload.part}»`,
        componentName: comp.name,
        isEmpty: true,
        matchesProposal: false,
        hasManualValue: false,
        currentLabel: 'Не заполнено',
      };
    }
    const matches =
      existing.material === payload.material &&
      (existing.finish ?? undefined) === (payload.finish ?? undefined) &&
      (existing.color ?? '').trim().toLowerCase() === (payload.color ?? '').trim().toLowerCase();
    return {
      categoryLabel: 'Материал · Отделка · Цвет',
      targetLabel: `Деталь «${payload.part}»`,
      componentName: comp.name,
      isEmpty: false,
      matchesProposal: matches,
      hasManualValue: true,
      currentLabel: formatMaterialSummary(existing),
    };
  }

  if (payload.kind === 'lightDirection') {
    const comp = resolveTargetComponent(project, payload.componentId);
    const existing = comp.light.directionId;
    if (!existing) {
      return {
        categoryLabel: 'Свет',
        targetLabel: 'Направление света',
        componentName: comp.name,
        isEmpty: true,
        matchesProposal: false,
        hasManualValue: false,
        currentLabel: 'Не заполнено',
      };
    }
    return {
      categoryLabel: 'Свет',
      targetLabel: 'Направление света',
      componentName: comp.name,
      isEmpty: false,
      matchesProposal: existing === payload.directionId,
      hasManualValue: existing !== payload.directionId,
      currentLabel: `${directions[existing][0]} (${directions[existing][1]})`,
    };
  }

  if (payload.kind === 'lightMetric') {
    const comp = resolveTargetComponent(project, payload.componentId);
    const existing = comp.light[payload.metric];
    const meta = lightMetricLabels[payload.metric];
    if (!existing) {
      return {
        categoryLabel: 'Свет',
        targetLabel: meta.label,
        componentName: comp.name,
        isEmpty: true,
        matchesProposal: false,
        hasManualValue: false,
        currentLabel: 'Не заполнено',
      };
    }
    return {
      categoryLabel: 'Свет',
      targetLabel: meta.label,
      componentName: comp.name,
      isEmpty: false,
      matchesProposal: Math.abs(existing.value - payload.value) < 0.001,
      hasManualValue: existing.source !== 'estimated',
      currentLabel: `${existing.value} ${meta.unit} (${sources[existing.source][0]})`,
      currentSource: existing.source,
    };
  }

  // mounting
  const existing = project.mounting[payload.field];
  if (!existing) {
    return {
      categoryLabel: 'Монтаж',
      targetLabel: mountingFieldLabels[payload.field],
      isEmpty: true,
      matchesProposal: false,
      hasManualValue: false,
      currentLabel: 'Неизвестно (на подтверждение)',
    };
  }
  return {
    categoryLabel: 'Монтаж',
    targetLabel: mountingFieldLabels[payload.field],
    isEmpty: false,
    matchesProposal: Math.abs(existing.value - payload.valueMm) < 0.001,
    hasManualValue: existing.source !== 'estimated',
    currentLabel: `${formatLengthForUnit(existing.value, unit)} (${sources[existing.source][0]})`,
    currentSource: existing.source,
  };
}

function validateLightMetricValue(metric: LightMetricKey, value: number): string | null {
  if (!Number.isFinite(value)) return 'Укажите корректное числовое значение.';
  if (metric === 'cct' && (!Number.isInteger(value) || value < 1000 || value > 20000)) {
    return 'CCT должен быть целым числом от 1000 до 20000 K.';
  }
  if (metric === 'cri' && (value < 0 || value > 100)) {
    return 'CRI должен быть в диапазоне от 0 до 100.';
  }
  if (metric === 'watts' && (value <= 0 || value > 100000)) {
    return 'Мощность должна быть больше 0 и не выше 100000 Вт.';
  }
  if (metric === 'lumens' && (value <= 0 || value > 10_000_000)) {
    return 'Световой поток должен быть больше 0 и не выше 10 000 000 лм.';
  }
  return null;
}

/**
 * Applies an accepted or inline-edited photo suggestion to the canonical Project.
 * Direct acceptance of numeric photo hints ALWAYS preserves source = 'estimated'.
 * Lengths are strictly stored in millimetres.
 */
export function applyPhotoSuggestion(
  project: Project,
  suggestion: PhotoSuggestion,
  override?: PhotoSuggestionEditOverride,
  displayUnit: Unit = 'mm',
): ApplySuggestionResult {
  const { payload } = suggestion;

  if (payload.kind === 'productKind') {
    const nextKind = override?.kind === 'productKind' ? override.value : payload.value;
    return {
      ok: true,
      project: { ...project, kind: nextKind },
      appliedSummary: `${productTypes[nextKind][0]} (${productTypes[nextKind][1]})`,
    };
  }

  if (payload.kind === 'dimension') {
    const valueMm = override?.kind === 'dimension' ? override.valueMm : payload.valueMm;
    const source: Measurement['source'] = override?.kind === 'dimension' ? override.source : 'estimated';
    if (!Number.isFinite(valueMm) || valueMm < 0 || valueMm > 1_000_000) {
      return { ok: false, error: 'Размер должен быть от 0 до 1 000 000 мм.' };
    }
    const target = resolveTargetComponent(project, payload.componentId);
    const nextDims = { ...target.dimensions, [payload.dimensionKey]: { value: valueMm, source } };
    if (
      nextDims.innerDiameter &&
      nextDims.outerDiameter &&
      nextDims.innerDiameter.value >= nextDims.outerDiameter.value
    ) {
      return { ok: false, error: 'Внутренний диаметр должен быть меньше внешнего.' };
    }
    return {
      ok: true,
      project: {
        ...project,
        components: project.components.map(comp =>
          comp.id === target.id ? { ...comp, dimensions: nextDims } : comp,
        ),
      },
      appliedSummary: `${formatLengthForUnit(valueMm, displayUnit)} · ${sources[source][0]}`,
    };
  }

  if (payload.kind === 'material') {
    const nextPart = (override?.kind === 'material' ? override.part : payload.part).trim();
    if (!nextPart || nextPart.length > 120) {
      return { ok: false, error: 'Укажите название детали (1–120 символов).' };
    }
    const nextMat = override?.kind === 'material' ? override.material : payload.material;
    const nextMatDetail = (override?.kind === 'material' ? override.materialDetail : payload.materialDetail)?.trim();
    const nextFinish = override?.kind === 'material' ? override.finish : payload.finish;
    const nextFinishDetail = (
      override?.kind === 'material' ? override.finishDetail : payload.finishDetail
    )?.trim();
    const nextColor = (override?.kind === 'material' ? override.color : payload.color)?.trim();

    const target = resolveTargetComponent(project, payload.componentId);
    const normalized = normalizePartName(nextPart);
    const matchIndex = target.materials.findIndex(item => normalizePartName(item.part) === normalized);

    const entry: Material = {
      id: matchIndex >= 0 ? target.materials[matchIndex].id : crypto.randomUUID(),
      part: nextPart,
      material: nextMat,
      ...(nextMatDetail ? { materialDetail: nextMatDetail } : {}),
      ...(nextFinish ? { finish: nextFinish } : {}),
      ...(nextFinishDetail ? { finishDetail: nextFinishDetail } : {}),
      ...(nextColor ? { color: nextColor } : {}),
    };

    if (matchIndex < 0 && target.materials.length >= 16) {
      return { ok: false, error: 'Достигнут лимит 16 материалов в одном компоненте.' };
    }

    const nextMaterials =
      matchIndex >= 0
        ? target.materials.map((item, idx) => (idx === matchIndex ? entry : item))
        : [...target.materials, entry];

    return {
      ok: true,
      project: {
        ...project,
        components: project.components.map(comp =>
          comp.id === target.id ? { ...comp, materials: nextMaterials } : comp,
        ),
      },
      appliedSummary: formatMaterialSummary(entry),
    };
  }

  if (payload.kind === 'lightDirection') {
    const directionId = override?.kind === 'lightDirection' ? override.directionId : payload.directionId;
    const target = resolveTargetComponent(project, payload.componentId);
    return {
      ok: true,
      project: {
        ...project,
        components: project.components.map(comp =>
          comp.id === target.id ? { ...comp, light: { ...comp.light, directionId } } : comp,
        ),
      },
      appliedSummary: `${directions[directionId][0]} (${directions[directionId][1]})`,
    };
  }

  if (payload.kind === 'lightMetric') {
    const rawValue = override?.kind === 'lightMetric' ? override.value : payload.value;
    const value = payload.metric === 'cct' ? Math.round(rawValue) : rawValue;
    const source: Measurement['source'] = override?.kind === 'lightMetric' ? override.source : 'estimated';
    const err = validateLightMetricValue(payload.metric, value);
    if (err) return { ok: false, error: err };
    const target = resolveTargetComponent(project, payload.componentId);
    return {
      ok: true,
      project: {
        ...project,
        components: project.components.map(comp =>
          comp.id === target.id
            ? { ...comp, light: { ...comp.light, [payload.metric]: { value, source } } }
            : comp,
        ),
      },
      appliedSummary: `${value} ${lightMetricLabels[payload.metric].unit} · ${sources[source][0]}`,
    };
  }

  // mounting
  const valueMm = override?.kind === 'mounting' ? override.valueMm : payload.valueMm;
  const source: Measurement['source'] = override?.kind === 'mounting' ? override.source : 'estimated';
  if (!Number.isFinite(valueMm) || valueMm < 0 || valueMm > 1_000_000) {
    return { ok: false, error: 'Высота монтажа должна быть от 0 до 1 000 000 мм.' };
  }
  return {
    ok: true,
    project: {
      ...project,
      mounting: {
        ...project.mounting,
        [payload.field]: { value: valueMm, source },
      },
    },
    appliedSummary: `${formatLengthForUnit(valueMm, displayUnit)} · ${sources[source][0]}`,
  };
}

/**
 * Bulk-applies ONLY pending suggestions whose target fields are currently empty.
 * Never overwrites manually entered or documentation values.
 */
export function applyEmptySuggestions(
  project: Project,
  suggestions: PhotoSuggestion[],
  unit: Unit = 'mm',
): {
  project: Project;
  suggestions: PhotoSuggestion[];
  appliedCount: number;
  protectedCount: number;
} {
  let nextProject = project;
  let appliedCount = 0;
  let protectedCount = 0;

  const nextSuggestions = suggestions.map(suggestion => {
    if (suggestion.status !== 'pending') return suggestion;
    const summary = getCurrentFieldSummary(nextProject, suggestion, unit);
    if (!summary.isEmpty) {
      if (summary.hasManualValue && !summary.matchesProposal) {
        protectedCount += 1;
      }
      return suggestion;
    }
    const result = applyPhotoSuggestion(nextProject, suggestion, undefined, unit);
    if (!result.ok) return suggestion;
    nextProject = result.project;
    appliedCount += 1;
    return {
      ...suggestion,
      status: 'accepted' as const,
      appliedSummary: result.appliedSummary,
    };
  });

  return { project: nextProject, suggestions: nextSuggestions, appliedCount, protectedCount };
}

/**
 * UI-only preview suggestions so reviewers and lighting designers can exercise the full
 * Accept / Edit / Skip workflow before Codex publishes the live Photo Analysis API contract.
 * Explicitly labelled in the UI as a preview fixture (not a real image inference).
 */
export function createPreviewDemoSuggestions(
  project: Project,
  primaryPhotoId?: string,
): PhotoSuggestion[] {
  const firstComp = project.components[0];
  const compId = firstComp?.id;
  const primaryBodyPart = firstComp?.materials[0]?.part ?? 'Корпус / Body';

  return [
    {
      id: 'preview-kind',
      photoId: primaryPhotoId,
      confidence: 'high',
      confidenceScore: 0.92,
      note: 'Демо-подсказка интерфейса: определение типа конструкции по силуэту на главном фото.',
      payload: { kind: 'productKind', value: 'arc' },
      status: 'pending',
    },
    {
      id: 'preview-dim-width',
      photoId: primaryPhotoId,
      confidence: 'medium',
      confidenceScore: 0.74,
      note: 'Демо-подсказка: оценочная ширина корпуса (при принятии сохраняется со статусом «Оценка», не перезаписывает ручной ввод без подтверждения).',
      payload: {
        kind: 'dimension',
        componentId: compId,
        dimensionKey: 'width',
        valueMm: 920,
      },
      status: 'pending',
    },
    {
      id: 'preview-dim-profile',
      photoId: primaryPhotoId,
      confidence: 'low',
      confidenceScore: 0.58,
      note: 'Демо-подсказка для пустого поля: оценочная высота профиля корпуса.',
      payload: {
        kind: 'dimension',
        componentId: compId,
        dimensionKey: 'profileHeight',
        valueMm: 45,
      },
      status: 'pending',
    },
    {
      id: 'preview-material-brass',
      photoId: primaryPhotoId,
      confidence: 'high',
      confidenceScore: 0.88,
      note: 'Демо-подсказка раздельной структуры: материал, отделка и цвет задаются отдельными полями.',
      payload: {
        kind: 'material',
        componentId: compId,
        part: primaryBodyPart,
        material: 'solidBrass',
        finish: 'naturalSatinBrass',
        color: 'Тёплая сатиновая латунь',
      },
      status: 'pending',
    },
    {
      id: 'preview-material-diffuser',
      photoId: primaryPhotoId,
      confidence: 'medium',
      confidenceScore: 0.77,
      note: 'Демо-подсказка для новой детали: материал, отделка и цвет заполняются раздельно.',
      payload: {
        kind: 'material',
        componentId: compId,
        part: 'Рассеиватель / Diffuser',
        material: 'acrylic',
        finish: 'white',
        color: 'Матовый молочный / Frosted opal',
      },
      status: 'pending',
    },
    {
      id: 'preview-light-direction',
      photoId: primaryPhotoId,
      confidence: 'medium',
      confidenceScore: 0.71,
      note: 'Демо-подсказка по направлению свечения.',
      payload: {
        kind: 'lightDirection',
        componentId: compId,
        directionId: 'both',
      },
      status: 'pending',
    },
  ];
}
