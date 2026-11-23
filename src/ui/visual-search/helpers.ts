import { productTypes, type ProductType } from '../../domain/project.ts';
import {
  canonicalSource,
  reviewSchema,
  sourceUrlSchema,
  type ReviewLink,
  type SearchResult,
} from '../../visual-search/catalogue.ts';

export type CropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export const FULL_CROP: CropRect = { x: 0, y: 0, width: 100, height: 100 };
export const MIN_CROP_SIZE = 10;

export function clampCrop(input: CropRect): CropRect {
  const safeNum = (value: number, fallback: number) => (Number.isFinite(value) ? value : fallback);
  const width = Math.round(Math.max(MIN_CROP_SIZE, Math.min(100, safeNum(input.width, 100))));
  const height = Math.round(Math.max(MIN_CROP_SIZE, Math.min(100, safeNum(input.height, 100))));
  const x = Math.round(Math.max(0, Math.min(100 - width, safeNum(input.x, 0))));
  const y = Math.round(Math.max(0, Math.min(100 - height, safeNum(input.y, 0))));
  return { x, y, width, height };
}

export function isFullCrop(crop: CropRect): boolean {
  return crop.x === 0 && crop.y === 0 && crop.width === 100 && crop.height === 100;
}

export function formatCropSummary(crop: CropRect): string {
  if (isFullCrop(crop)) return 'Всё фото (100%)';
  return `Область ${crop.width}% × ${crop.height}%`;
}

export type CategoryTone = 'doc' | 'accent' | 'est' | 'neutral';

export type CategoryMeta = {
  badge: string;
  shortLabel: string;
  tone: CategoryTone;
  explanation: string;
};

export function categoryMeta(category: SearchResult['category']): CategoryMeta {
  switch (category) {
    case 'verified_original':
      return {
        badge: 'Оригинал · каталог производителя',
        shortLabel: 'Запись производителя',
        tone: 'doc',
        explanation: 'Официальная модель и техпаспорт производителя. Совпадение с вашим фото требует проверки.',
      };
    case 'exact_match':
      return {
        badge: 'Точное совпадение',
        shortLabel: 'Точное совпадение',
        tone: 'accent',
        explanation: 'Та же модель на стороннем сайте.',
      };
    case 'visual_alternative':
      return {
        badge: 'Похожая модель',
        shortLabel: 'Визуальный аналог',
        tone: 'est',
        explanation: 'Близкая форма или признаки по стартовому каталогу.',
      };
    case 'technical_alternative':
      return {
        badge: 'Технический аналог',
        shortLabel: 'Технический аналог',
        tone: 'est',
        explanation: 'Аналог по конструктивным или светотехническим параметрам.',
      };
    case 'unverified':
    default:
      return {
        badge: 'Ссылка на проверку',
        shortLabel: 'Не подтверждена',
        tone: 'neutral',
        explanation: 'Добавленная ссылка требует проверки по официальному источнику.',
      };
  }
}

export function productKindLabel(kind?: ProductType): string | undefined {
  if (!kind) return undefined;
  return productTypes[kind]?.[0] ?? kind;
}

const categoryPriority: Record<SearchResult['category'], number> = {
  verified_original: 5,
  exact_match: 4,
  visual_alternative: 3,
  technical_alternative: 2,
  unverified: 1,
};

export function mergeSearchResults(
  apiResults: SearchResult[],
  importedResults: SearchResult[],
): SearchResult[] {
  const bySource = new Map<string, SearchResult>();
  for (const item of [...apiResults, ...importedResults]) {
    let key: string;
    try {
      key = canonicalSource(item.source);
    } catch {
      key = item.source;
    }
    const existing = bySource.get(key);
    if (!existing || categoryPriority[item.category] > categoryPriority[existing.category]) {
      bySource.set(key, item);
    }
  }
  return [...bySource.values()];
}

export type ResultSections = {
  originals: SearchResult[];
  exactMatches: SearchResult[];
  similarModels: SearchResult[];
  documentation: SearchResult[];
};

export type DocumentedLightingConfig = {
  ringWidthMm: number;
  direction: 'up' | 'down';
  powerW: number;
  netWeightKg: number;
  outputs: { cctK: number; lumens: number }[];
};

export type DocumentedSpecifications = {
  designer?: string;
  form?: string;
  materials?: { part: string; material: string }[];
  finishes?: { part: string; code: string; name: string }[];
  dimensionsReferTo?: string;
  standardMaxBandLengthMm?: number;
  lighting?: {
    sourceType: string;
    sourceVoltageV: number;
    supplyVoltageV: { min: number; max: number }[];
    configurations: DocumentedLightingConfig[];
  };
};

export function readResultSpecifications(result: SearchResult): DocumentedSpecifications | undefined {
  const candidate = (result as SearchResult & { specifications?: DocumentedSpecifications }).specifications;
  return candidate && typeof candidate === 'object' ? candidate : undefined;
}

export function filterLightingConfigurations(
  specs: DocumentedSpecifications | undefined,
  variantWidthMm?: number,
): DocumentedLightingConfig[] {
  const configs = specs?.lighting?.configurations ?? [];
  if (!variantWidthMm) return configs;
  const matching = configs.filter(item => item.ringWidthMm === variantWidthMm);
  return matching.length > 0 ? matching : configs;
}

export function formatLightDirection(direction: 'up' | 'down'): string {
  return direction === 'up' ? 'вверх' : 'вниз';
}

export function groupSearchResults(results: SearchResult[]): ResultSections {
  const originals: SearchResult[] = [];
  const exactMatches: SearchResult[] = [];
  const similarModels: SearchResult[] = [];
  const documentation: SearchResult[] = [];

  for (const item of results) {
    if (item.category === 'verified_original') {
      originals.push(item);
    } else if (item.category === 'exact_match' || item.category === 'unverified') {
      exactMatches.push(item);
    } else {
      similarModels.push(item);
    }

    if (
      item.documentUrl ||
      (item.variants && item.variants.length > 0) ||
      item.confirmedDimming ||
      readResultSpecifications(item)
    ) {
      documentation.push(item);
    }
  }

  return { originals, exactMatches, similarModels, documentation };
}

export type ComparisonField = {
  value: string;
  confirmed: boolean;
  hint?: string;
};

export type ComparisonSpec = {
  design: ComparisonField;
  dimensions: ComparisonField;
  materials: ComparisonField;
  finish: ComparisonField;
  lighting: ComparisonField;
  documentation: ComparisonField;
};

const materialPattern =
  /(латун[\p{L}]*|кож[\p{L}]*|стекл[\p{L}]*|стал[\p{L}]*|алюмин[\p{L}]*|мрамор[\p{L}]*|дерев[\p{L}]*|бронз[\p{L}]*|хрустал[\p{L}]*|brass|leather|glass|steel|aluminum|marble|wood)/iu;

const finishPattern =
  /(браширован[\p{L}]*|матов[\p{L}]*|полирован[\p{L}]*|сатин[\p{L}]*|патин[\p{L}]*|анодир[\p{L}]*|хромир[\p{L}]*|лакирован[\p{L}]*|brushed|satin|polished|matte|patinated|anodized|lacquered)/iu;

function splitClauses(text?: string): string[] {
  if (!text) return [];
  return text
    .split(/[.!?;]+/g)
    .map(part => part.trim())
    .filter(Boolean);
}

function formatFinishesByPart(finishes: { part: string; code: string; name: string }[]): string {
  const grouped = new Map<string, string[]>();
  for (const item of finishes) {
    const list = grouped.get(item.part) ?? [];
    list.push(`${item.code} (${item.name})`);
    grouped.set(item.part, list);
  }
  return [...grouped.entries()].map(([part, items]) => `${part}: ${items.join(', ')}`).join(' · ');
}

function formatLightingConfigsSummary(configs: DocumentedLightingConfig[]): string {
  return configs
    .map(cfg => {
      const lumens = cfg.outputs.map(o => o.lumens);
      const minLm = Math.min(...lumens);
      const maxLm = Math.max(...lumens);
      const ccts = cfg.outputs.map(o => `${o.cctK}K`).join('/');
      const fluxText = minLm === maxLm ? `${minLm} Лм` : `${minLm}–${maxLm} Лм`;
      return `${cfg.ringWidthMm} мм ${formatLightDirection(cfg.direction)}: ${cfg.powerW} Вт, ${fluxText} (${ccts}), ${cfg.netWeightKg} кг`;
    })
    .join('; ');
}

export function extractComparisonSpec(
  result: SearchResult,
  selectedSku?: string,
): ComparisonSpec {
  const kindLabel = productKindLabel(result.kind);
  const specs = readResultSpecifications(result);
  const clauses = splitClauses(result.details);

  // Design: structured specifications (form + designer) first, then honest fallback from kind/details
  let design: ComparisonField;
  if (specs && (specs.form || specs.designer)) {
    const parts = [
      kindLabel,
      specs.form,
      specs.designer ? `Дизайн ${specs.designer}` : undefined,
    ].filter(Boolean);
    design = {
      value: parts.join(' · '),
      confirmed: true,
      hint: categoryMeta(result.category).shortLabel,
    };
  } else {
    const designClauses = clauses.filter(
      clause =>
        /дизайн|design|форм|кольц|настольн|подвес|люстр|установ/iu.test(clause) &&
        !materialPattern.test(clause),
    );
    const designParts = [kindLabel, ...designClauses].filter(Boolean);
    design = designParts.length
      ? {
          value: designParts.join(' · '),
          confirmed: result.category === 'verified_original' || Boolean(kindLabel),
          hint: categoryMeta(result.category).shortLabel,
        }
      : {
          value: 'Тип и дизайн не подтверждены',
          confirmed: false,
          hint: 'Проверить по официальной карточке',
        };
  }

  // Dimensions: strictly from confirmed variants in mm + optional reference & standard band length
  const variants = result.variants ?? [];
  const chosenVariant = selectedSku
    ? variants.find(item => item.sku === selectedSku)
    : undefined;
  const dimMetaParts = [
    specs?.dimensionsReferTo ? `Размеры относятся к: ${specs.dimensionsReferTo}` : undefined,
    specs?.standardMaxBandLengthMm
      ? `макс. стандартная длина ремня ${specs.standardMaxBandLengthMm} мм`
      : undefined,
  ].filter(Boolean);

  let dimensions: ComparisonField;
  if (chosenVariant) {
    dimensions = {
      value: `${chosenVariant.sku} · ${chosenVariant.widthMm} × ${chosenVariant.depthMm} × ${chosenVariant.heightMm} мм`,
      confirmed: true,
      hint: dimMetaParts.length ? dimMetaParts.join(' · ') : 'Ш × Г × В по техпаспорту',
    };
  } else if (variants.length > 0) {
    const widths = variants.map(item => item.widthMm);
    const heights = variants.map(item => item.heightMm);
    const minW = Math.min(...widths);
    const maxW = Math.max(...widths);
    const minH = Math.min(...heights);
    const maxH = Math.max(...heights);
    const rangeW = minW === maxW ? `${minW}` : `${minW}–${maxW}`;
    const rangeH = minH === maxH ? `${minH}` : `${minH}–${maxH}`;
    dimensions = {
      value: `${variants.length} вар. (${variants.map(v => v.sku).join(', ')}) · Ш ${rangeW} × В ${rangeH} мм`,
      confirmed: true,
      hint: dimMetaParts.length
        ? dimMetaParts.join(' · ')
        : 'Выберите артикул для точных размеров',
    };
  } else {
    dimensions = {
      value: 'Не подтверждены в каталоге',
      confirmed: false,
      hint: 'Запросить чертёж / техпаспорт',
    };
  }

  // Materials: structured per-part materials from specifications first, then explicit details fallback
  let materials: ComparisonField;
  if (specs?.materials && specs.materials.length > 0) {
    materials = {
      value: specs.materials.map(item => `${item.part}: ${item.material}`).join(' · '),
      confirmed: true,
      hint: 'По техпаспорту производителя · сплав и сорт фиксируются в RFQ',
    };
  } else {
    const materialClauses = clauses
      .filter(clause => materialPattern.test(clause))
      .map(clause => clause.replace(/,\s*LED\b.*$/iu, '').trim())
      .filter(Boolean);
    materials = materialClauses.length
      ? {
          value: materialClauses.join('; '),
          confirmed: result.category === 'verified_original',
          hint: 'Сплав и сорт материала фиксируются отдельно в RFQ',
        }
      : {
          value: 'Не указаны в записи каталога',
          confirmed: false,
          hint: 'Уточнить основу материала у производителя',
        };
  }

  // Finish: kept strictly separate from base Material (per AGENTS.md)
  let finish: ComparisonField;
  if (specs?.finishes && specs.finishes.length > 0) {
    finish = {
      value: formatFinishesByPart(specs.finishes),
      confirmed: true,
      hint: 'Варианты по техпаспорту · конкретную отделку и цвет выбрать в RFQ',
    };
  } else {
    const finishClauses = clauses.filter(clause => finishPattern.test(clause));
    finish = finishClauses.length
      ? {
          value: finishClauses.join('; '),
          confirmed: result.category === 'verified_original',
          hint: 'Подтвердить образец отделки перед производством',
        }
      : {
          value: 'Отделка не указана в записи',
          confirmed: false,
          hint: 'Материал, отделка и цвет задаются отдельно — уточнить по техпаспорту',
        };
  }

  // Lighting characteristics: structured lighting configurations (filtered by ringWidthMm when variant chosen, preserving both up/down)
  let lighting: ComparisonField;
  if (specs?.lighting) {
    const { sourceType, sourceVoltageV, supplyVoltageV } = specs.lighting;
    const matchingConfigs = filterLightingConfigurations(specs, chosenVariant?.widthMm);
    const supplyText = supplyVoltageV.map(v => `${v.min}–${v.max} В`).join(' / ');
    const headerParts = [
      `${sourceType} ${sourceVoltageV} В`,
      result.confirmedDimming ? `Диммирование ${result.confirmedDimming}` : undefined,
      supplyText ? `Сеть ${supplyText}` : undefined,
    ].filter(Boolean);
    const configSummary = matchingConfigs.length
      ? formatLightingConfigsSummary(matchingConfigs)
      : undefined;
    lighting = {
      value: [headerParts.join(' · '), configSummary].filter(Boolean).join(' — '),
      confirmed: true,
      hint: 'Направление света, мощность и поток в техпаспорте не привязаны к конкретному артикулу — уточнить при заказе',
    };
  } else {
    const mentionsLed = Boolean(result.details && /\bLED\b/iu.test(result.details));
    const lightParts: string[] = [];
    if (mentionsLed) lightParts.push('LED');
    if (result.confirmedDimming) lightParts.push(`Диммирование ${result.confirmedDimming}`);
    lighting = lightParts.length
      ? {
          value: lightParts.join(' · '),
          confirmed: true,
          hint: 'Вт, Лм, CCT и CRI уточнить по техпаспорту',
        }
      : {
          value: 'Не подтверждены в каталоге',
          confirmed: false,
          hint: 'Уточнить Вт, Лм, CCT, CRI и диммирование',
        };
  }

  // Documentation
  const documentation: ComparisonField = result.documentUrl
    ? {
        value: 'Официальный PDF техпаспорт',
        confirmed: true,
        hint: extractDisplayHost(result.documentUrl),
      }
    : {
        value: 'PDF техпаспорт не приложен',
        confirmed: false,
        hint: `Источник: ${extractDisplayHost(result.source)}`,
      };

  return { design, dimensions, materials, finish, lighting, documentation };
}

export function buildSimilarQuery(result: SearchResult): string {
  const parts: string[] = [];
  if (result.brand) parts.push(result.brand);
  if (result.name) parts.push(result.name);

  // Extract genuine structural tokens present in result.details so deep search surfaces related catalogue items
  if (result.details) {
    const cues: [RegExp, string][] = [
      [/кольц|ring/iu, 'кольцо'],
      [/латун|brass/iu, 'латунь'],
      [/кож|leather/iu, 'кожа'],
      [/настольн|table/iu, 'настольный'],
    ];
    for (const [pattern, token] of cues) {
      if (pattern.test(result.details) && !parts.some(p => p.toLowerCase().includes(token))) {
        parts.push(token);
      }
    }
  }

  return parts.join(' ').trim().slice(0, 240);
}

export function buildReviewPrompt(
  query: string,
  results: SearchResult[],
  focusedResult?: SearchResult,
): string {
  const lines: string[] = [
    'Проверь фото светильника и найденные ссылки. Опирайся на подтверждённый производителем артикул и официальный первичный источник.',
    'Если оригинал установить нельзя, явно напиши Original not verified. Отличай совпадение фотографии от совпадения изделия.',
    `Исходное описание: ${query.trim() || 'прилагаемое фото'}`,
  ];

  if (focusedResult) {
    const title = [focusedResult.brand, focusedResult.name].filter(Boolean).join(' ');
    lines.push(
      `Приоритетный кандидат для проверки: ${title} (${categoryMeta(focusedResult.category).shortLabel}) — ${focusedResult.source}`,
    );
    if (focusedResult.documentUrl) {
      lines.push(`Техпаспорт кандидата: ${focusedResult.documentUrl}`);
    }
  }

  const others = focusedResult
    ? results.filter(item => item.id !== focusedResult.id)
    : results;

  if (others.length > 0) {
    lines.push(focusedResult ? 'Дополнительные найденные кандидаты:' : 'Найденные кандидаты:');
    for (const item of others) {
      const title = [item.brand, item.name].filter(Boolean).join(' ');
      lines.push(`- ${title} (${categoryMeta(item.category).shortLabel}) — ${item.source}`);
    }
  }

  lines.push(
    'Верни только ссылки, которые можно открыть, в JSON формата {"results":[{"title":"Название","url":"https://…"}]}.',
  );
  return lines.join('\n');
}

export function parseLensUrlsInput(raw: string): ReviewLink[] {
  const lines = raw
    .split(/\r?\n/g)
    .map(line => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    throw new Error('Вставьте хотя бы одну ссылку HTTP или HTTPS.');
  }

  return lines.map(line => {
    const valid = sourceUrlSchema.safeParse(line);
    if (!valid.success) {
      throw new Error('Проверьте формат ссылок: допускаются только корректные HTTP/HTTPS URL без логина и пароля.');
    }
    const parsedUrl = new URL(valid.data);
    return {
      url: valid.data,
      title: parsedUrl.hostname.replace(/^www\./i, '') || 'Ссылка',
    };
  });
}

export function parseChatGptJsonInput(raw: string): ReviewLink[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Вставьте JSON-ответ от ChatGPT.');
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new Error('Не удалось прочитать JSON. Ожидается формат {"results":[{"title":"…","url":"https://…"}]}.');
  }
  const validated = reviewSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error('Проверьте структуру JSON: {"results":[{"title":"Название","url":"https://…"}]}.');
  }
  if (validated.data.results.length === 0) {
    throw new Error('В списке results нет ни одной ссылки.');
  }
  return validated.data.results;
}

export function extractDisplayHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return url;
  }
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 Б';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${bytes} Б`;
}

export function formatLanguageLabel(language: string): string {
  switch (language.toLowerCase()) {
    case 'en':
      return 'English';
    case 'zh-cn':
      return '中文';
    case 'it':
      return 'Italiano';
    case 'de':
      return 'Deutsch';
    default:
      return language.toUpperCase();
  }
}

export function formatGeminiWarning(code?: string): string | null {
  if (!code) return null;
  switch (code) {
    case 'gemini_disabled':
      return 'Визуальный анализ по фото сейчас отключён. Поиск выполнен по каталогу — вы также можете открыть Google Lens или проверить через ChatGPT.';
    case 'gemini_quota':
    case 'gemini_daily_limit':
      return 'Дневной лимит распознавания исчерпан. Можно продолжить поиск по описанию, через Google Lens или проверку в ChatGPT.';
    case 'gemini_busy':
      return 'Сервис распознавания временно занят. Попробуйте повторить через минуту или используйте Google Lens.';
    case 'gemini_model_unavailable':
      return 'Модель распознавания сейчас недоступна. Поиск по каталогу, Google Lens и ChatGPT работают в обычном режиме.';
    default:
      return 'Не удалось автоматически проанализировать фото. Можно продолжить через Google Lens, ChatGPT или текстовое описание.';
  }
}
