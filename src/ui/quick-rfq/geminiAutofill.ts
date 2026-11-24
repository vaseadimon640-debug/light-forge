import {
  geminiDrawingAnalysisSchema,
  geminiErrorResponseSchema,
  geminiPhotoAnalysisSchema,
  type CertaintyStatus,
  type GeminiDrawingAnalysis,
  type GeminiErrorCode,
  type GeminiPhotoAnalysis,
} from '../../ai/gemini-contract.ts';
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
  type ProductType,
  type Project,
} from '../../domain/project.ts';
import { loadStudioPreferences } from '../../storage/preferences.ts';

export class GeminiClientError extends Error {
  readonly code: GeminiErrorCode;
  readonly status: number;

  constructor(code: GeminiErrorCode, message: string, status: number) {
    super(message);
    this.name = 'GeminiClientError';
    this.code = code;
    this.status = status;
  }
}

export type GeminiRequestOptions = {
  signal?: AbortSignal;
  modelOverride?: string;
  deepAnalysis?: boolean;
};

export function formatProvenance(
  provenance?: {
    fileName: string;
    page?: number;
    snippet?: string;
    dimensionLabel?: string;
    confidence: 'high' | 'medium' | 'low';
  },
): string | undefined {
  if (!provenance) return undefined;
  const parts: string[] = [provenance.fileName];
  if (provenance.page) parts.push(`стр. ${provenance.page}`);
  if (provenance.dimensionLabel) parts.push(provenance.dimensionLabel);
  if (provenance.snippet) parts.push(`«${provenance.snippet}»`);
  return `Источник: ${parts.join(', ')}`;
}

export async function requestGeminiPhotoAnalysis(
  file: Blob,
  fileName: string,
  options?: AbortSignal | GeminiRequestOptions,
): Promise<GeminiPhotoAnalysis> {
  const opts: GeminiRequestOptions =
    options instanceof AbortSignal ? { signal: options } : (options ?? {});
  const prefs = loadStudioPreferences();
  const model = opts.modelOverride ?? prefs.preferredGeminiModel;
  const deep = opts.deepAnalysis ?? prefs.deepAiAnalysisEnabled;

  const form = new FormData();
  form.set('file', file, fileName);
  if (model) form.set('model', model);
  if (deep) form.set('deepAnalysis', '1');

  let res: Response;
  try {
    res = await fetch('/api/ai/gemini/analyze-photo', {
      method: 'POST',
      body: form,
      signal: opts.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new GeminiClientError(
      'network_error',
      'Не удалось связаться с сервером анализа Gemini. Проверьте подключение и повторите попытку.',
      0,
    );
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new GeminiClientError(
      'invalid_response',
      `Сервер вернул некорректный ответ (HTTP ${res.status}).`,
      res.status,
    );
  }

  if (!res.ok) {
    const parsedErr = geminiErrorResponseSchema.safeParse(body);
    if (parsedErr.success) {
      throw new GeminiClientError(parsedErr.data.error, parsedErr.data.message, res.status);
    }
    throw new GeminiClientError(
      'invalid_response',
      `Ошибка анализа фотографии (HTTP ${res.status}).`,
      res.status,
    );
  }

  const parsed = geminiPhotoAnalysisSchema.safeParse(body);
  if (!parsed.success) {
    throw new GeminiClientError(
      'invalid_response',
      'Ответ анализа фотографии не прошёл проверку схемы данных.',
      res.status,
    );
  }
  return parsed.data;
}

export async function requestGeminiDrawingAnalysis(
  file: File,
  options?: AbortSignal | GeminiRequestOptions,
): Promise<GeminiDrawingAnalysis> {
  const opts: GeminiRequestOptions =
    options instanceof AbortSignal ? { signal: options } : (options ?? {});
  const prefs = loadStudioPreferences();
  const model = opts.modelOverride ?? prefs.preferredGeminiModel;
  const deep = opts.deepAnalysis ?? prefs.deepAiAnalysisEnabled;

  const form = new FormData();
  form.set('file', file, file.name);
  if (model) form.set('model', model);
  if (deep) form.set('deepAnalysis', '1');

  let res: Response;
  try {
    res = await fetch('/api/ai/gemini/analyze-drawing', {
      method: 'POST',
      body: form,
      signal: opts.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new GeminiClientError(
      'network_error',
      'Не удалось связаться с сервером чтения чертежей Gemini. Проверьте подключение и повторите попытку.',
      0,
    );
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new GeminiClientError(
      'invalid_response',
      `Сервер вернул некорректный ответ (HTTP ${res.status}).`,
      res.status,
    );
  }

  if (!res.ok) {
    const parsedErr = geminiErrorResponseSchema.safeParse(body);
    if (parsedErr.success) {
      throw new GeminiClientError(parsedErr.data.error, parsedErr.data.message, res.status);
    }
    throw new GeminiClientError(
      'invalid_response',
      `Ошибка чтения чертежа/PDF (HTTP ${res.status}).`,
      res.status,
    );
  }

  const parsed = geminiDrawingAnalysisSchema.safeParse(body);
  if (!parsed.success) {
    throw new GeminiClientError(
      'invalid_response',
      'Ответ чтения чертежа/PDF не прошёл проверку схемы данных.',
      res.status,
    );
  }
  return parsed.data;
}

export type GeminiProposalPayload =
  | { kind: 'projectName'; value: string }
  | { kind: 'projectCode'; value: string }
  | { kind: 'productKind'; value: ProductType }
  | { kind: 'dimension'; key: DimensionKey; valueMm: number; source: Measurement['source'] }
  | {
      kind: 'lightMetric';
      metric: 'watts' | 'lumens' | 'cct' | 'cri';
      value: number;
      source: Measurement['source'];
    }
  | { kind: 'lightDirection'; directionId: NonNullable<Component['light']['directionId']> }
  | { kind: 'ipRating'; value: NonNullable<Component['light']['ip']> }
  | { kind: 'dimming'; value: NonNullable<Component['light']['dimming']> }
  | { kind: 'voltage'; value: NonNullable<Component['light']['voltage']> }
  | {
      kind: 'material';
      part: string;
      material: Material['material'];
      materialDetail?: string;
      finish?: Material['finish'];
      finishDetail?: string;
      color?: string;
    }
  | { kind: 'noteLine'; line: string };

export type GeminiAutofillProposal = {
  id: string;
  category: string;
  label: string;
  proposedDisplay: string;
  currentDisplay: string;
  status: CertaintyStatus;
  source: 'documentation' | 'estimated';
  hasManualValue: boolean;
  defaultChecked: boolean;
  note?: string;
  payload: GeminiProposalPayload;
};

function primaryComponent(project: Project): Component {
  return project.components[0];
}

function normalizePart(part: string): string {
  return part.trim().toLowerCase();
}

export function buildPhotoProposals(
  project: Project,
  analysis: GeminiPhotoAnalysis,
  manualTouchedFields: ReadonlySet<string> = new Set(),
): GeminiAutofillProposal[] {
  const comp = primaryComponent(project);
  const proposals: GeminiAutofillProposal[] = [];

  if (analysis.fixtureType.value) {
    const val = analysis.fixtureType.value;
    const isModifiedFromDefault =
      manualTouchedFields.has('kind') || (project.kind !== 'pendant' && project.kind !== val);
    proposals.push({
      id: 'photo-fixture-type',
      category: 'Тип светильника',
      label: 'Тип изделия',
      proposedDisplay: `${productTypes[val][0]} (${productTypes[val][1]})`,
      currentDisplay: `${productTypes[project.kind][0]}`,
      status: 'estimated',
      source: 'estimated',
      hasManualValue: isModifiedFromDefault,
      defaultChecked: !isModifiedFromDefault,
      note: analysis.fixtureType.note,
      payload: { kind: 'productKind', value: val },
    });
  }

  if (analysis.lightDirection.value) {
    const dir = analysis.lightDirection.value;
    const existing = comp.light.directionId;
    const hasManual = Boolean(existing && existing !== dir);
    proposals.push({
      id: 'photo-light-direction',
      category: 'Свет',
      label: 'Направление света',
      proposedDisplay: `${directions[dir][0]} (${directions[dir][1]})`,
      currentDisplay: existing ? directions[existing][0] : 'Не задано',
      status: 'estimated',
      source: 'estimated',
      hasManualValue: hasManual,
      defaultChecked: !hasManual,
      payload: { kind: 'lightDirection', directionId: dir },
    });
  }

  if (analysis.suspectedMaterial.key || analysis.suspectedFinish.key) {
    const partName = 'Корпус / Body';
    const existingMat = comp.materials.find((m) => normalizePart(m.part) === normalizePart(partName));
    const matKey = analysis.suspectedMaterial.key ?? 'custom';
    const finishKey = analysis.suspectedFinish.key ?? undefined;
    const color = analysis.primaryColors.slice(0, 2).join(', ') || undefined;
    const hasManual = Boolean(existingMat);
    const partsLabel = [
      materials[matKey][0],
      finishKey ? finishes[finishKey][0] : analysis.suspectedFinish.label,
      color ? `цвет: ${color}` : null,
    ]
      .filter(Boolean)
      .join(' · ');

    proposals.push({
      id: 'photo-material-body',
      category: 'Материалы (оценка)',
      label: `${partName} — материал / отделка / цвет`,
      proposedDisplay: partsLabel,
      currentDisplay: existingMat
        ? `${materials[existingMat.material][0]}${existingMat.finish ? ` · ${finishes[existingMat.finish][0]}` : ''}`
        : 'Не задано',
      status: 'estimated',
      source: 'estimated',
      hasManualValue: hasManual,
      defaultChecked: !hasManual,
      note: analysis.suspectedMaterial.uncertaintyReason,
      payload: {
        kind: 'material',
        part: partName,
        material: matKey,
        ...(matKey === 'custom' && analysis.suspectedMaterial.label
          ? { materialDetail: analysis.suspectedMaterial.label }
          : {}),
        ...(finishKey ? { finish: finishKey } : {}),
        ...(finishKey === 'custom' && analysis.suspectedFinish.label
          ? { finishDetail: analysis.suspectedFinish.label }
          : {}),
        ...(color ? { color } : {}),
      },
    });
  }

  const observationParts: string[] = [];
  if (analysis.shape.value) observationParts.push(`Форма: ${analysis.shape.value}`);
  if (analysis.elementCount.value !== null) {
    observationParts.push(`Элементов (визуально): ${analysis.elementCount.value}`);
  }
  if (analysis.hasDiffuser.value !== null) {
    observationParts.push(
      `Рассеиватель: ${analysis.hasDiffuser.value ? (analysis.hasDiffuser.description ?? 'виден') : 'не виден'}`,
    );
  }
  if (analysis.suspensionType.value) {
    observationParts.push(`Подвес (визуально): ${analysis.suspensionType.value}`);
  }
  if (analysis.ceilingMountVisible.value) {
    observationParts.push(`Крепление: ${analysis.ceilingMountVisible.value}`);
  }
  if (analysis.structuralDetails.length > 0) {
    observationParts.push(`Детали: ${analysis.structuralDetails.slice(0, 4).join('; ')}`);
  }

  if (observationParts.length > 0) {
    const line = `[AI фото · оценка] ${observationParts.join(' | ')}`;
    const alreadyPresent = project.notes.includes(line);
    proposals.push({
      id: 'photo-notes',
      category: 'Конструкция',
      label: 'Визуальные наблюдения (в примечания проекта)',
      proposedDisplay: observationParts.join(' · '),
      currentDisplay: project.notes.trim() ? 'Есть заметки (допишется ниже)' : 'Пусто',
      status: 'estimated',
      source: 'estimated',
      hasManualValue: false,
      defaultChecked: !alreadyPresent,
      note: 'Не перезаписывает существующие примечания — добавляется новой строкой.',
      payload: { kind: 'noteLine', line },
    });
  }

  return proposals;
}

export function buildDrawingProposals(
  project: Project,
  analysis: GeminiDrawingAnalysis,
  manualTouchedFields: ReadonlySet<string> = new Set(),
): GeminiAutofillProposal[] {
  const comp = primaryComponent(project);
  const proposals: GeminiAutofillProposal[] = [];

  if (analysis.identity.modelName.value && analysis.identity.modelName.status !== 'unknown') {
    const hasManual =
      manualTouchedFields.has('name') ||
      (project.name !== 'Новый светильник' && project.name !== analysis.identity.modelName.value);
    const source = analysis.identity.modelName.status === 'confirmed' ? 'documentation' : 'estimated';
    proposals.push({
      id: 'drawing-model-name',
      category: 'Идентификация',
      label: 'Название модели',
      proposedDisplay: analysis.identity.modelName.value,
      currentDisplay: project.name,
      status: analysis.identity.modelName.status,
      source,
      hasManualValue: hasManual,
      defaultChecked: !hasManual,
      note: formatProvenance(analysis.identity.modelName.provenance),
      payload: { kind: 'projectName', value: analysis.identity.modelName.value },
    });
  }

  if (analysis.identity.sku.value && analysis.identity.sku.status !== 'unknown') {
    const hasManual =
      manualTouchedFields.has('code') ||
      (Boolean(project.code.trim()) && project.code !== analysis.identity.sku.value);
    const source = analysis.identity.sku.status === 'confirmed' ? 'documentation' : 'estimated';
    proposals.push({
      id: 'drawing-sku',
      category: 'Идентификация',
      label: 'Артикул / SKU',
      proposedDisplay: analysis.identity.sku.value,
      currentDisplay: project.code || 'Не задано',
      status: analysis.identity.sku.status,
      source,
      hasManualValue: hasManual,
      defaultChecked: !hasManual,
      note: formatProvenance(analysis.identity.sku.provenance),
      payload: { kind: 'projectCode', value: analysis.identity.sku.value },
    });
  }

  const dimMap: Array<{
    key: DimensionKey;
    field: GeminiDrawingAnalysis['dimensionsMm']['width'];
  }> = [
    { key: 'width', field: analysis.dimensionsMm.width },
    { key: 'height', field: analysis.dimensionsMm.height },
    { key: 'depth', field: analysis.dimensionsMm.depth },
    { key: 'outerDiameter', field: analysis.dimensionsMm.diameter },
    { key: 'innerDiameter', field: analysis.dimensionsMm.innerDiameter },
    { key: 'profileHeight', field: analysis.dimensionsMm.profileHeight },
    { key: 'profileThickness', field: analysis.dimensionsMm.profileThickness },
    { key: 'radius', field: analysis.dimensionsMm.radius },
  ];

  for (const { key, field } of dimMap) {
    if (field.value === null || field.status === 'unknown') continue;
    const existing = comp.dimensions[key];
    const hasManual =
      manualTouchedFields.has(`dim:${key}`) || Boolean(existing && existing.source !== 'estimated');
    const source: Measurement['source'] = field.status === 'confirmed' ? 'documentation' : 'estimated';
    const prov = formatProvenance(field.provenance);
    const unitNote =
      field.originalUnit && field.originalUnit.toLowerCase() !== 'mm'
        ? `Переведено из ${field.originalText ?? field.originalUnit}`
        : undefined;
    const note = [unitNote, prov].filter(Boolean).join(' · ') || undefined;

    proposals.push({
      id: `drawing-dim-${key}`,
      category: 'Размеры (мм)',
      label: `${dimensions[key][0]} (${dimensions[key][1]})`,
      proposedDisplay: `${field.value} мм`,
      currentDisplay: existing
        ? `${existing.value} мм (${sources[existing.source][0]})`
        : 'Не задано',
      status: field.status,
      source,
      hasManualValue: hasManual,
      defaultChecked: !hasManual && !existing,
      note,
      payload: { kind: 'dimension', key, valueMm: field.value, source },
    });
  }

  // Suspension drop is strictly separate from luminaire body height!
  if (
    analysis.dimensionsMm.suspensionDrop.value !== null &&
    analysis.dimensionsMm.suspensionDrop.status !== 'unknown'
  ) {
    const drop = analysis.dimensionsMm.suspensionDrop;
    const source = drop.status === 'confirmed' ? 'documentation' : 'estimated';
    const line = `[Чертёж · ${drop.status === 'confirmed' ? 'Confirmed' : 'Estimated'}] Монтажная высота подвеса: ${drop.value} мм${drop.provenance?.page ? ` (${drop.provenance.fileName}, стр. ${drop.provenance.page})` : ''}`;
    proposals.push({
      id: 'drawing-suspension-drop',
      category: 'Подвес (отдельно от корпуса)',
      label: 'Монтажная высота подвеса (мм)',
      proposedDisplay: `${drop.value} мм`,
      currentDisplay: project.notes.includes(`${drop.value} мм`) ? 'В примечаниях' : 'Не указано',
      status: drop.status,
      source,
      hasManualValue: false,
      defaultChecked: !project.notes.includes(line),
      note: formatProvenance(drop.provenance),
      payload: { kind: 'noteLine', line },
    });
  }

  const lightMetrics: Array<{
    metric: 'watts' | 'lumens' | 'cct' | 'cri';
    label: string;
    unit: string;
    field: GeminiDrawingAnalysis['electrical']['wattageW'];
  }> = [
    { metric: 'watts', label: 'Мощность (Wattage)', unit: 'Вт', field: analysis.electrical.wattageW },
    { metric: 'lumens', label: 'Световой поток (Lumens)', unit: 'лм', field: analysis.electrical.lumensLm },
    { metric: 'cct', label: 'Цветовая температура (CCT)', unit: 'K', field: analysis.electrical.cctK },
    { metric: 'cri', label: 'Индекс цветопередачи (CRI)', unit: 'Ra', field: analysis.electrical.cri },
  ];

  for (const item of lightMetrics) {
    if (item.field.value === null || item.field.status === 'unknown') continue;
    const existing = comp.light[item.metric];
    const hasManual =
      manualTouchedFields.has(`light:${item.metric}`) ||
      Boolean(existing && existing.source !== 'estimated');
    const source: Measurement['source'] =
      item.field.status === 'confirmed' ? 'documentation' : 'estimated';
    const val = item.metric === 'cct' ? Math.round(item.field.value) : item.field.value;
    proposals.push({
      id: `drawing-light-${item.metric}`,
      category: 'Электрика / свет',
      label: item.label,
      proposedDisplay: `${val} ${item.unit}`,
      currentDisplay: existing
        ? `${existing.value} ${item.unit} (${sources[existing.source][0]})`
        : 'Не задано',
      status: item.field.status,
      source,
      hasManualValue: hasManual,
      defaultChecked: !hasManual && !existing,
      note: formatProvenance(item.field.provenance),
      payload: { kind: 'lightMetric', metric: item.metric, value: val, source },
    });
  }

  if (analysis.electrical.ipRating.value && analysis.electrical.ipRating.status !== 'unknown') {
    const existing = comp.light.ip;
    const hasManual = Boolean(existing && existing !== analysis.electrical.ipRating.value);
    const source = analysis.electrical.ipRating.status === 'confirmed' ? 'documentation' : 'estimated';
    proposals.push({
      id: 'drawing-ip',
      category: 'Электрика / свет',
      label: 'Степень защиты (IP Rating)',
      proposedDisplay: analysis.electrical.ipRating.value,
      currentDisplay: existing ?? 'Не задано',
      status: analysis.electrical.ipRating.status,
      source,
      hasManualValue: hasManual,
      defaultChecked: !hasManual && !existing,
      note: formatProvenance(analysis.electrical.ipRating.provenance),
      payload: { kind: 'ipRating', value: analysis.electrical.ipRating.value },
    });
  }

  if (analysis.electrical.dimming.value && analysis.electrical.dimming.status !== 'unknown') {
    const existing = comp.light.dimming;
    const hasManual = Boolean(existing && existing !== analysis.electrical.dimming.value);
    const source = analysis.electrical.dimming.status === 'confirmed' ? 'documentation' : 'estimated';
    proposals.push({
      id: 'drawing-dimming',
      category: 'Электрика / свет',
      label: 'Диммирование (Dimming)',
      proposedDisplay: analysis.electrical.dimming.value,
      currentDisplay: existing ?? 'Не задано',
      status: analysis.electrical.dimming.status,
      source,
      hasManualValue: hasManual,
      defaultChecked: !hasManual && !existing,
      note: formatProvenance(analysis.electrical.dimming.provenance),
      payload: { kind: 'dimming', value: analysis.electrical.dimming.value },
    });
  }

  if (analysis.electrical.voltage.value && analysis.electrical.voltage.status !== 'unknown') {
    const rawV = analysis.electrical.voltage.value;
    const normalizedVoltage: NonNullable<Component['light']['voltage']> | null =
      /220|230|240/i.test(rawV) && !/110|100/i.test(rawV)
        ? '220–240 V AC'
        : /100.*277|100.*240|universal/i.test(rawV)
          ? '100–277 V AC'
          : /110|120/i.test(rawV)
            ? '110–120 V AC'
            : /48\s*v/i.test(rawV)
              ? '48 V DC'
              : /24\s*v/i.test(rawV)
                ? '24 V DC'
                : null;
    const source = analysis.electrical.voltage.status === 'confirmed' ? 'documentation' : 'estimated';
    if (normalizedVoltage) {
      const existing = comp.light.voltage;
      const hasManual = manualTouchedFields.has('light:0:voltage') || Boolean(existing);
      proposals.push({
        id: 'drawing-voltage',
        category: 'Электрика / свет',
        label: 'Входное напряжение (Voltage)',
        proposedDisplay: normalizedVoltage,
        currentDisplay: existing ?? 'Не задано',
        status: analysis.electrical.voltage.status,
        source,
        hasManualValue: hasManual,
        defaultChecked: !hasManual && !existing,
        note: formatProvenance(analysis.electrical.voltage.provenance),
        payload: { kind: 'voltage', value: normalizedVoltage },
      });
    } else {
      const line = `[Чертёж · ${analysis.electrical.voltage.status === 'confirmed' ? 'Confirmed' : 'Estimated'}] Напряжение (Voltage): ${rawV}`;
      proposals.push({
        id: 'drawing-voltage',
        category: 'Электрика / свет',
        label: 'Напряжение (Voltage → примечания)',
        proposedDisplay: rawV,
        currentDisplay: project.notes.includes(rawV) ? 'Уже в примечаниях' : 'Не указано',
        status: analysis.electrical.voltage.status,
        source,
        hasManualValue: false,
        defaultChecked: !project.notes.includes(rawV),
        note: formatProvenance(analysis.electrical.voltage.provenance),
        payload: { kind: 'noteLine', line },
      });
    }
  }

  for (const [index, mat] of analysis.materials.entries()) {
    if (mat.status === 'unknown') continue;
    const matchingFinish = analysis.finishes.find(
      (f) => normalizePart(f.part) === normalizePart(mat.part) && f.status !== 'unknown',
    );
    const existingMat = comp.materials.find((m) => normalizePart(m.part) === normalizePart(mat.part));
    const matKey = mat.materialKey ?? 'custom';
    const finishKey = matchingFinish?.finishKey ?? undefined;
    const hasManual = Boolean(existingMat);
    const source = mat.status === 'confirmed' ? 'documentation' : 'estimated';
    proposals.push({
      id: `drawing-mat-${index}`,
      category: 'Материалы и отделка',
      label: mat.part,
      proposedDisplay: [
        mat.label,
        matchingFinish ? `отделка: ${matchingFinish.label}` : null,
        matchingFinish?.color ? `цвет: ${matchingFinish.color}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      currentDisplay: existingMat ? materials[existingMat.material][0] : 'Не задано',
      status: mat.status,
      source,
      hasManualValue: hasManual,
      defaultChecked: !hasManual,
      note: formatProvenance(mat.provenance),
      payload: {
        kind: 'material',
        part: mat.part,
        material: matKey,
        ...(matKey === 'custom' ? { materialDetail: mat.label } : {}),
        ...(finishKey ? { finish: finishKey } : {}),
        ...(matchingFinish && (!finishKey || finishKey === 'custom')
          ? { finishDetail: matchingFinish.label }
          : {}),
        ...(matchingFinish?.color ? { color: matchingFinish.color } : {}),
      },
    });
  }

  return proposals;
}

export function applyGeminiProposals(
  project: Project,
  proposals: readonly GeminiAutofillProposal[],
  selectedIds: ReadonlySet<string>,
): { project: Project; appliedCount: number; skippedInvalid: string[] } {
  let nextProject: Project = {
    ...project,
    components: project.components.map((c) => ({
      ...c,
      dimensions: { ...c.dimensions },
      materials: [...c.materials],
      light: { ...c.light },
    })),
  };
  let appliedCount = 0;
  const skippedInvalid: string[] = [];

  for (const proposal of proposals) {
    if (!selectedIds.has(proposal.id)) continue;
    const { payload } = proposal;
    const target = nextProject.components[0];

    if (payload.kind === 'projectName') {
      nextProject = { ...nextProject, name: payload.value.slice(0, 120) };
      appliedCount += 1;
      continue;
    }

    if (payload.kind === 'projectCode') {
      nextProject = { ...nextProject, code: payload.value.slice(0, 80) };
      appliedCount += 1;
      continue;
    }

    if (payload.kind === 'productKind') {
      const prevKind = nextProject.kind;
      nextProject = { ...nextProject, kind: payload.value };
      if (nextProject.components.length === 1 && target.kind === prevKind) {
        target.kind = payload.value;
      }
      appliedCount += 1;
      continue;
    }

    if (payload.kind === 'dimension') {
      const candidateDims = {
        ...target.dimensions,
        [payload.key]: { value: payload.valueMm, source: payload.source },
      };
      if (
        candidateDims.innerDiameter &&
        candidateDims.outerDiameter &&
        candidateDims.innerDiameter.value >= candidateDims.outerDiameter.value
      ) {
        skippedInvalid.push(
          `${proposal.label}: внутренний диаметр должен быть меньше внешнего.`,
        );
        continue;
      }
      target.dimensions = candidateDims;
      appliedCount += 1;
      continue;
    }

    if (payload.kind === 'lightDirection') {
      target.light = { ...target.light, directionId: payload.directionId };
      appliedCount += 1;
      continue;
    }

    if (payload.kind === 'lightMetric') {
      target.light = {
        ...target.light,
        [payload.metric]: { value: payload.value, source: payload.source },
      };
      appliedCount += 1;
      continue;
    }

    if (payload.kind === 'ipRating') {
      target.light = { ...target.light, ip: payload.value };
      appliedCount += 1;
      continue;
    }

    if (payload.kind === 'dimming') {
      target.light = { ...target.light, dimming: payload.value };
      appliedCount += 1;
      continue;
    }

    if (payload.kind === 'voltage') {
      target.light = { ...target.light, voltage: payload.value };
      appliedCount += 1;
      continue;
    }

    if (payload.kind === 'material') {
      const idx = target.materials.findIndex(
        (m) => normalizePart(m.part) === normalizePart(payload.part),
      );
      if (idx < 0 && target.materials.length >= 16) {
        skippedInvalid.push(`${proposal.label}: достигнут лимит 16 материалов.`);
        continue;
      }
      const entry: Material = {
        id: idx >= 0 ? target.materials[idx].id : crypto.randomUUID(),
        part: payload.part,
        material: payload.material,
        ...(payload.materialDetail ? { materialDetail: payload.materialDetail } : {}),
        ...(payload.finish ? { finish: payload.finish } : {}),
        ...(payload.finishDetail ? { finishDetail: payload.finishDetail } : {}),
        ...(payload.color ? { color: payload.color } : {}),
      };
      target.materials =
        idx >= 0
          ? target.materials.map((m, i) => (i === idx ? entry : m))
          : [...target.materials, entry];
      appliedCount += 1;
      continue;
    }

    if (payload.kind === 'noteLine') {
      if (!nextProject.notes.includes(payload.line)) {
        const joined = nextProject.notes.trim()
          ? `${nextProject.notes.trim()}\n${payload.line}`
          : payload.line;
        nextProject = { ...nextProject, notes: joined.slice(0, 1000) };
      }
      appliedCount += 1;
    }
  }

  return { project: nextProject, appliedCount, skippedInvalid };
}
