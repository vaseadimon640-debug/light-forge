import {
  dimensions,
  imageTypes,
  maxPhotoBytes,
  maxPhotos,
  maxTotalPhotoBytes,
  newComponent,
  projectSchema,
  unitFactors,
  type Component,
  type Material,
  type Photo,
  type Placement,
  type ProductType,
  type Project,
  type Unit,
} from '../../domain/project.ts';
import type { Composition } from '../../geometry/schema.ts';
import { quickRfqTextSchema, type RfqLanguage } from '../../rfq/quick.ts';
import { quickRfqForm, type ProjectSnapshot } from '../../storage/projects.ts';

export type FieldIssue = {
  path: (string | number)[];
  message: string;
};

export type RfqApiError = {
  status: number;
  code: string;
  message: string;
  issues?: FieldIssue[];
  retryable: boolean;
};

export const unitLabels: Record<Unit, string> = {
  mm: 'мм',
  cm: 'см',
  m: 'м',
};

export const languageOptions: { id: RfqLanguage; label: string; hint: string }[] = [
  { id: 'en-zh', label: 'EN + 中文', hint: 'Двуязычный' },
  { id: 'en', label: 'EN', hint: 'Английский' },
  { id: 'zh', label: '中文', hint: 'Китайский' },
];

export function cleanFloat(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function mmToDisplay(valueMm: number, unit: Unit): string {
  const scaled = cleanFloat(valueMm / unitFactors[unit]);
  return Number.isFinite(scaled) ? String(scaled) : '';
}

export function displayToMm(raw: string, unit: Unit): number | null {
  const normalized = raw.trim().replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return cleanFloat(parsed * unitFactors[unit]);
}

export function parsePlainNumber(raw: string): number | null {
  const normalized = raw.trim().replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} МБ`;
}

export function totalPhotoBytes(photos: Photo[]): number {
  return photos.reduce((sum, photo) => sum + photo.size, 0);
}

export function orderedPhotos(project: Project): Photo[] {
  if (!project.primaryPhotoId) return project.photos;
  const index = project.photos.findIndex(photo => photo.id === project.primaryPhotoId);
  if (index <= 0) return project.photos;
  const copy = [...project.photos];
  const [primary] = copy.splice(index, 1);
  copy.unshift(primary);
  return copy;
}

function sanitizePhotoName(name: string, type: Photo['type']): string {
  const trimmed = name.trim();
  if (!trimmed) {
    const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
    return `photo.${ext}`;
  }
  if (trimmed.length <= 255) return trimmed;
  const dot = trimmed.lastIndexOf('.');
  if (dot > 0 && trimmed.length - dot <= 10) {
    const ext = trimmed.slice(dot);
    return `${trimmed.slice(0, 255 - ext.length)}${ext}`;
  }
  return trimmed.slice(0, 255);
}

export function addPhotosToSnapshot(
  snapshot: ProjectSnapshot,
  files: File[],
): { snapshot: ProjectSnapshot; errors: string[] } {
  const errors: string[] = [];
  const nextPhotos = [...snapshot.project.photos];
  const nextOriginals: Record<string, Blob> = { ...snapshot.originals };
  let runningBytes = totalPhotoBytes(nextPhotos);
  let primaryPhotoId = snapshot.project.primaryPhotoId;

  for (const file of files) {
    if (nextPhotos.length >= maxPhotos) {
      errors.push(`Достигнут лимит ${maxPhotos} фото — файл «${file.name}» не добавлен.`);
      continue;
    }
    if (!imageTypes.includes(file.type as Photo['type'])) {
      errors.push(`Файл «${file.name}» не поддерживается. Допустимы JPEG, PNG и WebP.`);
      continue;
    }
    if (file.size <= 0) {
      errors.push(`Файл «${file.name}» пуст.`);
      continue;
    }
    if (file.size > maxPhotoBytes) {
      errors.push(`Файл «${file.name}» превышает лимит 12 МиБ (${formatBytes(file.size)}).`);
      continue;
    }
    if (runningBytes + file.size > maxTotalPhotoBytes) {
      errors.push(`Добавление «${file.name}» превысит суммарный лимит 32 МиБ.`);
      continue;
    }
    const id = crypto.randomUUID();
    const type = file.type as Photo['type'];
    const meta: Photo = {
      id,
      name: sanitizePhotoName(file.name, type),
      type,
      size: file.size,
    };
    nextPhotos.push(meta);
    nextOriginals[id] = file;
    runningBytes += file.size;
    if (!primaryPhotoId) primaryPhotoId = id;
  }

  return {
    snapshot: {
      project: {
        ...snapshot.project,
        photos: nextPhotos,
        ...(primaryPhotoId ? { primaryPhotoId } : {}),
      },
      originals: nextOriginals,
    },
    errors,
  };
}

export function removePhotoFromSnapshot(snapshot: ProjectSnapshot, photoId: string): ProjectSnapshot {
  const nextPhotos = snapshot.project.photos.filter(photo => photo.id !== photoId);
  const nextOriginals: Record<string, Blob> = {};
  for (const photo of nextPhotos) {
    if (Object.hasOwn(snapshot.originals, photo.id)) {
      nextOriginals[photo.id] = snapshot.originals[photo.id];
    }
  }
  const nextPrimary =
    nextPhotos.length === 0
      ? undefined
      : snapshot.project.primaryPhotoId === photoId
        ? nextPhotos[0].id
        : snapshot.project.primaryPhotoId;

  const nextProject: Project = { ...snapshot.project, photos: nextPhotos };
  if (nextPrimary) {
    nextProject.primaryPhotoId = nextPrimary;
  } else {
    delete nextProject.primaryPhotoId;
  }
  return { project: nextProject, originals: nextOriginals };
}

export function setPrimaryPhoto(snapshot: ProjectSnapshot, photoId: string): ProjectSnapshot {
  if (!snapshot.project.photos.some(photo => photo.id === photoId)) return snapshot;
  return {
    ...snapshot,
    project: { ...snapshot.project, primaryPhotoId: photoId },
  };
}

export function addComponentToProject(project: Project, kind?: ProductType): { project: Project; componentId: string } {
  const created = newComponent(kind ?? (project.kind === 'chandelier' ? 'pendant' : project.kind));
  created.name = `Компонент ${project.components.length + 1}`;
  return {
    project: { ...project, components: [...project.components, created] },
    componentId: created.id,
  };
}

export function removeComponentFromProject(project: Project, componentId: string): Project {
  if (project.components.length <= 1) return project;
  return {
    ...project,
    components: project.components.filter(component => component.id !== componentId),
    mounting: {
      ...project.mounting,
      placements: project.mounting.placements.filter(placement => placement.componentId !== componentId),
    },
  };
}

export function updateComponentInProject(
  project: Project,
  componentId: string,
  updater: (component: Component) => Component,
): Project {
  return {
    ...project,
    components: project.components.map(component =>
      component.id === componentId ? updater(component) : component,
    ),
  };
}

export function createMaterialRow(part = ''): Material {
  return {
    id: crypto.randomUUID(),
    part: part || 'Корпус',
    material: 'solidBrass',
  };
}

export function remainingPlacementCapacity(project: Project, componentId: string): number {
  const component = project.components.find(item => item.id === componentId);
  if (!component) return 0;
  const used = project.mounting.placements.filter(item => item.componentId === componentId).length;
  return Math.max(0, component.quantity - used);
}

export function firstAvailableComponentForPlacement(project: Project): Component | undefined {
  return project.components.find(component => remainingPlacementCapacity(project, component.id) > 0);
}

export function addPlacementToProject(project: Project, preferredComponentId?: string): Project {
  const target =
    (preferredComponentId && remainingPlacementCapacity(project, preferredComponentId) > 0
      ? project.components.find(item => item.id === preferredComponentId)
      : undefined) ?? firstAvailableComponentForPlacement(project);
  if (!target) return project;
  const placement: Placement = {
    id: `mount-${crypto.randomUUID().slice(0, 8)}`,
    componentId: target.id,
  };
  return {
    ...project,
    mounting: {
      ...project.mounting,
      placements: [...project.mounting.placements, placement],
    },
  };
}

export function pruneExcessPlacements(project: Project): Project {
  const counts = new Map<string, number>();
  const validIds = new Map(project.components.map(component => [component.id, component.quantity]));
  const kept: Placement[] = [];
  for (const placement of project.mounting.placements) {
    const maxQty = validIds.get(placement.componentId) ?? 0;
    const next = (counts.get(placement.componentId) ?? 0) + 1;
    if (next <= maxQty) {
      counts.set(placement.componentId, next);
      kept.push(placement);
    }
  }
  return {
    ...project,
    mounting: { ...project.mounting, placements: kept },
  };
}

export function validateProject(project: Project): FieldIssue[] {
  const parsed = projectSchema.safeParse(project);
  if (parsed.success) return [];
  return parsed.error.issues.map(issue => ({
    path: issue.path.filter((segment): segment is string | number => typeof segment === 'string' || typeof segment === 'number'),
    message: translateIssueMessage(issue.message),
  }));
}

export function translateIssueMessage(message: string): string {
  if (message === 'Inner diameter must be less than outer diameter') {
    return 'Внутренний диаметр должен быть меньше внешнего диаметра.';
  }
  if (message === 'Placement requires an unused component unit') {
    return 'Число размещений превышает количество единиц компонента.';
  }
  if (message === 'Select an attached photo') {
    return 'Выберите главное фото из загруженных изображений.';
  }
  if (message === 'Total photo size exceeds 32 MiB') {
    return 'Суммарный размер фотографий превышает 32 МиБ.';
  }
  if (message === 'Duplicate IDs' || message === 'Duplicate placement IDs') {
    return 'Обнаружены повторяющиеся идентификаторы.';
  }
  if (/Too small: expected string to have >=1/.test(message) || /String must contain at least 1/.test(message)) {
    return 'Поле не может быть пустым.';
  }
  if (/expected number to be >0/.test(message) || /Number must be greater than 0/.test(message)) {
    return 'Значение должно быть больше 0.';
  }
  if (/expected number to be >=1000/.test(message)) {
    return 'Значение должно быть не меньше 1000 K.';
  }
  if (/expected number to be <=20000/.test(message)) {
    return 'Значение должно быть не больше 20000 K.';
  }
  if (/expected number to be <=100/.test(message)) {
    return 'Значение должно быть не больше 100.';
  }
  if (/expected int/.test(message)) {
    return 'Укажите целое число.';
  }
  return message;
}

export function formatIssuePath(path: (string | number)[], project: Project): string {
  const clean = path[0] === 'project' ? path.slice(1) : path;
  if (clean.length === 0) return 'Проект';
  if (clean[0] === 'name') return 'Название проекта';
  if (clean[0] === 'code') return 'Код проекта';
  if (clean[0] === 'orderQuantity') return 'Количество заказа';
  if (clean[0] === 'photos' || clean[0] === 'primaryPhotoId') return 'Фотографии';
  if (clean[0] === 'notes') return 'Примечания';
  if (clean[0] === 'components' && typeof clean[1] === 'number') {
    const comp = project.components[clean[1]];
    const label = comp?.name?.trim() ? `Компонент «${comp.name}»` : `Компонент #${clean[1] + 1}`;
    const field = clean[2];
    if (field === 'name') return `${label} → Название`;
    if (field === 'quantity') return `${label} → Количество`;
    if (field === 'dimensions' && typeof clean[3] === 'string' && clean[3] in dimensions) {
      return `${label} → ${dimensions[clean[3] as keyof typeof dimensions][0]}`;
    }
    if (field === 'materials' && typeof clean[3] === 'number') {
      const matField = clean[4] === 'part' ? 'Деталь' : 'Материал';
      return `${label} → Материал #${clean[3] + 1} (${matField})`;
    }
    if (field === 'light') {
      const lightMap: Record<string, string> = {
        cct: 'Цветовая температура (CCT)',
        cri: 'CRI',
        watts: 'Мощность (W)',
        lumens: 'Световой поток (lm)',
      };
      return `${label} → ${lightMap[String(clean[3])] ?? 'Свет'}`;
    }
    return label;
  }
  if (clean[0] === 'mounting') {
    if (clean[1] === 'ceilingFromFloorMm') return 'Монтаж → Высота потолка';
    if (clean[1] === 'tabletopFromFloorMm') return 'Монтаж → Высота столешницы';
    if (clean[1] === 'placements' && typeof clean[2] === 'number') {
      return `Монтаж → Размещение #${clean[2] + 1}`;
    }
    return 'Монтажные уровни';
  }
  return clean.join(' → ');
}

export function issuesMatching(issues: FieldIssue[], prefix: (string | number)[]): FieldIssue[] {
  return issues.filter(issue => {
    const clean = issue.path[0] === 'project' ? issue.path.slice(1) : issue.path;
    if (clean.length < prefix.length) return false;
    return prefix.every((segment, index) => clean[index] === segment);
  });
}

export function snapshotFingerprint(
  snapshot: ProjectSnapshot,
  language: RfqLanguage,
  composition?: Composition,
): string {
  const { updatedAt: _ignored, ...stableProject } = snapshot.project;
  return JSON.stringify({
    language,
    project: stableProject,
    photoSizes: snapshot.project.photos.map(photo => [photo.id, photo.size, photo.type]),
    composition: composition ?? null,
  });
}

function defaultPdfFilename(project: Project, language: RfqLanguage): string {
  const code = (project.code || 'light-forge').replace(/[^A-Za-z0-9_-]/g, '-');
  return `${code}-quick-rfq-${language}.pdf`;
}

function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const match = header.match(/filename="([^"]+)"/);
  return match?.[1] || fallback;
}

export async function parseRfqError(response: Response): Promise<RfqApiError> {
  let code = `http_${response.status}`;
  let message = `Ошибка сервера (${response.status}).`;
  let issues: FieldIssue[] | undefined;

  try {
    const body = (await response.json()) as {
      error?: string;
      message?: string;
      issues?: { path?: (string | number)[]; message?: string }[];
    };
    if (typeof body.error === 'string') code = body.error;
    if (typeof body.message === 'string') message = body.message;
    if (Array.isArray(body.issues)) {
      issues = body.issues.map(item => ({
        path: Array.isArray(item.path) ? item.path : [],
        message: translateIssueMessage(typeof item.message === 'string' ? item.message : 'Некорректное значение'),
      }));
    }
  } catch {
    // Non-JSON error body
  }

  if (response.status === 503) {
    message =
      code === 'pdf_busy'
        ? 'PDF-движок сейчас занят другим документом. Повторите запрос через пару секунд.'
        : 'PDF-движок временно недоступен или превысил время ожидания. Повторите запрос.';
  } else if (code === 'invalid_photo') {
    message = `Ошибка проверки фотографии: ${message}`;
  } else if (code === 'project_geometry_conflict') {
    message = `Расхождение между проектом и связанной 3D-композицией: ${message}`;
  } else if (code === 'invalid_snapshot') {
    message = 'Проверьте заполнение отмеченных полей перед формированием документа.';
  } else if (response.status === 413) {
    message = 'Размер запроса или фотографий превышает допустимый лимит сервера.';
  }

  return {
    status: response.status,
    code,
    message,
    issues,
    retryable: response.status === 503 || response.status >= 500,
  };
}

export async function requestQuickRfqText(
  snapshot: ProjectSnapshot,
  language: RfqLanguage,
  composition?: Composition,
  signal?: AbortSignal,
): Promise<{ language: RfqLanguage; text: string }> {
  const payload = composition ? { project: snapshot.project, composition } : { project: snapshot.project };
  const response = await fetch(`/api/rfq/quick?format=text&lang=${encodeURIComponent(language)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok) {
    throw await parseRfqError(response);
  }
  return quickRfqTextSchema.parse(await response.json());
}

export async function requestQuickRfqPdf(
  snapshot: ProjectSnapshot,
  language: RfqLanguage,
  composition?: Composition,
  signal?: AbortSignal,
): Promise<{ blob: Blob; filename: string }> {
  const form = quickRfqForm(snapshot, composition);
  const response = await fetch(`/api/rfq/quick?format=pdf&lang=${encodeURIComponent(language)}`, {
    method: 'POST',
    body: form,
    signal,
  });
  if (!response.ok) {
    throw await parseRfqError(response);
  }
  const blob = await response.blob();
  const filename = filenameFromDisposition(
    response.headers.get('content-disposition'),
    defaultPdfFilename(snapshot.project, language),
  );
  return { blob, filename };
}

export async function requestDetailedRfqText(
  snapshot: ProjectSnapshot,
  language: RfqLanguage,
  options?: { composition?: Composition; revision?: number; releaseNote?: string },
  signal?: AbortSignal,
): Promise<{ language: RfqLanguage; text: string }> {
  const payload = {
    project: snapshot.project,
    ...(options?.composition ? { composition: options.composition } : {}),
    ...(options?.revision ? { revision: options.revision } : {}),
    ...(options?.releaseNote?.trim() ? { releaseNote: options.releaseNote.trim() } : {}),
  };
  const response = await fetch(`/api/rfq/detailed?format=text&lang=${encodeURIComponent(language)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok) {
    throw await parseRfqError(response);
  }
  return quickRfqTextSchema.parse(await response.json());
}

export async function requestDetailedRfqPdf(
  snapshot: ProjectSnapshot,
  language: RfqLanguage,
  options?: { composition?: Composition; revision?: number; releaseNote?: string },
  signal?: AbortSignal,
): Promise<{ blob: Blob; filename: string }> {
  const form = new FormData();
  const payload = {
    project: snapshot.project,
    ...(options?.composition ? { composition: options.composition } : {}),
    ...(options?.revision ? { revision: options.revision } : {}),
    ...(options?.releaseNote?.trim() ? { releaseNote: options.releaseNote.trim() } : {}),
  };
  form.set('input', JSON.stringify(payload));
  for (const photo of snapshot.project.photos) {
    form.set(`photo:${photo.id}`, snapshot.originals[photo.id], photo.name);
  }
  const response = await fetch(`/api/rfq/detailed?format=pdf&lang=${encodeURIComponent(language)}`, {
    method: 'POST',
    body: form,
    signal,
  });
  if (!response.ok) {
    throw await parseRfqError(response);
  }
  const blob = await response.blob();
  const code = (snapshot.project.code || 'light-forge').replace(/[^A-Za-z0-9_-]/g, '-');
  const revSuffix = options?.revision ? `-v${options.revision}` : '';
  const filename = filenameFromDisposition(
    response.headers.get('content-disposition'),
    `${code}-detailed-rfq${revSuffix}-${language}.pdf`,
  );
  return { blob, filename };
}

