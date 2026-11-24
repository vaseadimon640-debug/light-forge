import type {
  GeminiDrawingAnalysis,
  GeminiPhotoAnalysis,
} from '../../ai/gemini-contract.ts';
import { maxDrawingBytes } from '../../ai/gemini-contract.ts';
import {
  imageTypes,
  maxPhotoBytes,
  maxPhotos,
  maxTotalPhotoBytes,
  type Project,
} from '../../domain/project.ts';
import type { ProjectSnapshot } from '../../storage/projects.ts';
import { addPhotosToSnapshot } from '../quick-rfq/helpers.ts';

export const WIZARD_STEPS = [
  {
    id: 'upload',
    index: 1,
    shortTitle: 'Загрузка',
    title: 'Начните с фотографии светильника',
    subtitle: 'Загрузите фото или чертёж — LIGHT FORGE поможет определить конструкцию и характеристики',
  },
  {
    id: 'dimensions',
    index: 2,
    shortTitle: 'Анализ и размеры',
    title: 'Результаты анализа и размеры',
    subtitle: 'Проверьте распознанные параметры, подтвердите размеры в миллиметрах или отредактируйте конструкцию',
  },
  {
    id: 'materials',
    index: 3,
    shortTitle: 'Материалы',
    title: 'Материалы и отделка',
    subtitle: 'Задайте основной материал, отделку и цвет отдельно для каждой детали конструкции',
  },
  {
    id: 'lighting',
    index: 4,
    shortTitle: 'Светотехника',
    title: 'Свет и электрические характеристики',
    subtitle: 'Настройте параметры свечения, мощность, драйвер, диммирование и степень защиты IP',
  },
  {
    id: 'installation',
    index: 5,
    shortTitle: 'Монтаж',
    title: 'Количество и монтаж',
    subtitle: 'Укажите количество изделий и выберите стандартный или расширенный инженерный режим монтажа',
  },
  {
    id: 'studio3d',
    index: 6,
    shortTitle: '3D и RFQ',
    title: 'Проверка, 3D и запрос фабрике',
    subtitle: 'Сверьте единую спецификацию, перейдите в 3D Studio или выпустите двуязычный PDF для фабрики',
  },
] as const;

export type WizardStepId = (typeof WIZARD_STEPS)[number]['id'];

export type WizardHistory = {
  past: Project[];
  present: Project;
  future: Project[];
};

const MAX_HISTORY = 40;

export function createWizardHistory(initial: Project): WizardHistory {
  return { past: [], present: initial, future: [] };
}

export function commitWizardProject(
  history: WizardHistory,
  nextProject: Project,
): WizardHistory {
  if (history.present === nextProject) return history;
  const nextPast = [...history.past, history.present].slice(-MAX_HISTORY);
  return {
    past: nextPast,
    present: nextProject,
    future: [],
  };
}

export function undoWizardHistory(history: WizardHistory): WizardHistory {
  if (history.past.length === 0) return history;
  const previous = history.past[history.past.length - 1];
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future].slice(0, MAX_HISTORY),
  };
}

export function redoWizardHistory(history: WizardHistory): WizardHistory {
  if (history.future.length === 0) return history;
  const next = history.future[0];
  return {
    past: [...history.past, history.present].slice(-MAX_HISTORY),
    present: next,
    future: history.future.slice(1),
  };
}

export type AttachedDrawing = {
  id: string;
  file: File;
  name: string;
  size: number;
  type: 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp';
};

export type IncomingUploadResult = {
  snapshot: ProjectSnapshot;
  addedDrawings: AttachedDrawing[];
  errors: string[];
  addedPhotoCount: number;
};

function isHeicFile(file: File): boolean {
  const lowerName = file.name.toLowerCase();
  const lowerType = file.type.toLowerCase();
  return (
    lowerType === 'image/heic' ||
    lowerType === 'image/heif' ||
    lowerName.endsWith('.heic') ||
    lowerName.endsWith('.heif')
  );
}

/**
 * Separates uploaded files cleanly into:
 * - Untouched luminaire photographs (stored in canonical ProjectSnapshot)
 * - Technical PDF drawings (stored in AttachedDrawing list for Gemini PDF analysis)
 * - Honest errors for unsupported/oversized or unconvertible HEIC files
 */
export function processWizardUploads(
  currentSnapshot: ProjectSnapshot,
  existingDrawings: readonly AttachedDrawing[],
  files: readonly File[],
): IncomingUploadResult {
  const photoCandidates: File[] = [];
  const addedDrawings: AttachedDrawing[] = [];
  const errors: string[] = [];

  for (const file of files) {
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      if (file.size === 0 || file.size > maxDrawingBytes) {
        errors.push(`Файл «${file.name}» превышает лимит 15 МиБ для PDF-чертежа или пуст.`);
        continue;
      }
      if (existingDrawings.length + addedDrawings.length >= 6) {
        errors.push('Можно прикрепить не более 6 PDF-документов к одному проекту.');
        continue;
      }
      addedDrawings.push({
        id: crypto.randomUUID(),
        file,
        name: file.name || 'technical-drawing.pdf',
        size: file.size,
        type: 'application/pdf',
      });
      continue;
    }

    if (isHeicFile(file)) {
      errors.push(
        `Файл «${file.name}» в формате HEIC/HEIF: текущий браузер не поддерживает прямое декодирование HEIC. Сохраните или экспортируйте фото как JPG/PNG/WEBP и загрузите снова.`,
      );
      continue;
    }

    if (imageTypes.includes(file.type as (typeof imageTypes)[number])) {
      if (file.size > maxPhotoBytes) {
        errors.push(`Фото «${file.name}» превышает лимит 12 МиБ.`);
        continue;
      }
      photoCandidates.push(file);
      continue;
    }

    errors.push(
      `Файл «${file.name}» имеет неподдерживаемый формат (${file.type || 'неизвестно'}). Поддерживаются JPG, PNG, WEBP и PDF.`,
    );
  }

  let nextSnapshot = currentSnapshot;
  let addedPhotoCount = 0;

  if (photoCandidates.length > 0) {
    const prevCount = currentSnapshot.project.photos.length;
    const currentBytes = currentSnapshot.project.photos.reduce((acc, p) => acc + p.size, 0);
    const incomingBytes = photoCandidates.reduce((acc, f) => acc + f.size, 0);
    if (prevCount + photoCandidates.length > maxPhotos) {
      errors.push(`Максимум ${maxPhotos} фотографий в одном проекте.`);
    } else if (currentBytes + incomingBytes > maxTotalPhotoBytes) {
      errors.push('Суммарный размер фотографий проекта не должен превышать 32 МиБ.');
    }
    const res = addPhotosToSnapshot(currentSnapshot, photoCandidates);
    nextSnapshot = res.snapshot;
    addedPhotoCount = nextSnapshot.project.photos.length - prevCount;
    errors.push(...res.errors);
  }

  return {
    snapshot: nextSnapshot,
    addedDrawings,
    errors,
    addedPhotoCount,
  };
}

export type WizardAiState = {
  photoAnalysis: GeminiPhotoAnalysis | null;
  drawingAnalysis: GeminiDrawingAnalysis | null;
};

export function computeStepBadges(
  project: Project,
  drawingsCount: number,
): Record<WizardStepId, string> {
  const firstComp = project.components[0];
  const dimCount = project.components.reduce(
    (sum, comp) => sum + Object.keys(comp.dimensions).length,
    0,
  );
  const matCount = project.components.reduce((sum, comp) => sum + comp.materials.length, 0);
  const lightCount = [
    firstComp?.light.cct,
    firstComp?.light.cri,
    firstComp?.light.watts,
    firstComp?.light.lumens,
    firstComp?.light.directionId,
    firstComp?.light.dimming,
    firstComp?.light.ip,
  ].filter(Boolean).length;

  const uploadTotal = project.photos.length + drawingsCount;

  return {
    upload: uploadTotal > 0 ? `${uploadTotal}` : '',
    dimensions: dimCount > 0 ? `${dimCount}` : '',
    materials: matCount > 0 ? `${matCount}` : '',
    lighting: lightCount > 0 ? `${lightCount}` : '',
    installation: `${project.orderQuantity} шт.`,
    studio3d: `${project.components.length}`,
  };
}
