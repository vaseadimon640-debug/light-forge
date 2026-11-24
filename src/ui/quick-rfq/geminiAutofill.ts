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

export async function requestGeminiPhotoAnalysis(
  file: Blob,
  fileName: string,
  signal?: AbortSignal,
): Promise<GeminiPhotoAnalysis> {
  const form = new FormData();
  form.set('file', file, fileName);
  let res: Response;
  try {
    res = await fetch('/api/ai/gemini/analyze-photo', {
      method: 'POST',
      body: form,
      signal,
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
  signal?: AbortSignal,
): Promise<GeminiDrawingAnalysis> {
  const form = new FormData();
  form.set('file', file, file.name);
  let res: Response;
  try {
    res = await fetch('/api/ai/gemini/analyze-drawing', {
      method: 'POST',
      body: form,
      signal,
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
  if (analysis.suspensionType.value) {
    observationParts.push(`Подвес (визуально): ${analysis.suspensionType.value}`);
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
): GeminiAutofillProposal[] {
  const comp = primaryComponent(project);
  const proposals: GeminiAutofillProposal[] = [];

  const dimMap: Array<{
    key: DimensionKey;
    field: GeminiDrawingAnalysis['dimensionsMm'][keyof GeminiDrawingAnalysis['dimensionsMm']];
  }> = [
    { key: 'width', field: analysis.dimensionsMm.width },
    { key: 'height', field: analysis.dimensionsMm.height },
    { key: 'depth', field: analysis.dimensionsMm.depth },
    { key: 'outerDiameter', field: analysis.dimensionsMm.diameter },
    { key: 'innerDiameter', field: analysis.dimensionsMm.innerDiameter },
    { key: 'profileHeight', field: analysis.dimensionsMm.profileHeight },
    { key: 'profileThickness', field: analysis.dimensionsMm.profileThickness },
  ];

  for (const { key, field } of dimMap) {
    if (field.value === null || field.status === 'unknown') continue;
    const existing = comp.dimensions[key];
    const hasManual = Boolean(existing && existing.source !== 'estimated');
    const source: Measurement['source'] = field.status === 'confirmed' ? 'documentation' : 'estimated';
    const unitNote =
      field.originalUnit && field.originalUnit.toLowerCase() !== 'mm'
        ? `Переведено из ${field.originalText ?? field.originalUnit}`
        : field.originalText
          ? `Из документа: ${field.originalText}`
          : undefined;

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
      note: unitNote,
      payload: { kind: 'dimension', key, valueMm: field.value, source },
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
    const hasManual = Boolean(existing && existing.source !== 'estimated');
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
      note: item.field.originalText ? `Из документа: ${item.field.originalText}` : undefined,
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
      payload: { kind: 'dimming', value: analysis.electrical.dimming.value },
    });
  }

  if (analysis.electrical.voltage.value && analysis.electrical.voltage.status !== 'unknown') {
    const source = analysis.electrical.voltage.status === 'confirmed' ? 'documentation' : 'estimated';
    const line = `[Чертёж · ${analysis.electrical.voltage.status === 'confirmed' ? 'Confirmed' : 'Estimated'}] Напряжение (Voltage): ${analysis.electrical.voltage.value}`;
    proposals.push({
      id: 'drawing-voltage',
      category: 'Электрика / свет',
      label: 'Напряжение (Voltage → примечания)',
      proposedDisplay: analysis.electrical.voltage.value,
      currentDisplay: project.notes.includes(analysis.electrical.voltage.value) ? 'Уже в примечаниях' : 'Не указано',
      status: analysis.electrical.voltage.status,
      source,
      hasManualValue: false,
      defaultChecked: !project.notes.includes(analysis.electrical.voltage.value),
      payload: { kind: 'noteLine', line },
    });
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

    if (payload.kind === 'productKind') {
      nextProject = { ...nextProject, kind: payload.value };
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
