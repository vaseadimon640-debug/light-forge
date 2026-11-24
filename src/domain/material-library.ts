import type { GeminiPhotoAnalysis } from '@/ai/gemini-contract';
import type { Material } from './project.ts';

export type MaterialCategory = 'metals' | 'optics' | 'natural' | 'other';

export type MaterialVisualSpec = {
  key: Material['material'];
  category: MaterialCategory;
  swatchCss: string;
  tagRu: string;
  strictNoteRu?: string;
};

export type FinishVisualSpec = {
  key: NonNullable<Material['finish']>;
  swatchCss: string;
  family: 'brass' | 'bronze' | 'silver' | 'dark' | 'light' | 'custom';
  shortHintRu: string;
};

export const MATERIAL_VISUALS: MaterialVisualSpec[] = [
  {
    key: 'solidBrass',
    category: 'metals',
    swatchCss: 'linear-gradient(135deg, #e7ca78 0%, #bd9342 52%, #7f5d20 100%)',
    tagRu: 'Массив · премиум',
    strictNoteRu: 'Не путать со сталью под латунь — самостоятельный сплав.',
  },
  {
    key: 'aluminium',
    category: 'metals',
    swatchCss: 'linear-gradient(135deg, #eef1f4 0%, #c3c9d0 55%, #8c939c 100%)',
    tagRu: 'Лёгкий теплоотвод',
  },
  {
    key: 'stainlessSteel',
    category: 'metals',
    swatchCss: 'linear-gradient(135deg, #f3f5f7 0%, #b5bcc4 50%, #6f7780 100%)',
    tagRu: 'Коррозионностойкий',
  },
  {
    key: 'steel',
    category: 'metals',
    swatchCss: 'linear-gradient(135deg, #b8bec6 0%, #7d858f 55%, #495058 100%)',
    tagRu: 'Конструкционный',
  },
  {
    key: 'copper',
    category: 'metals',
    swatchCss: 'linear-gradient(135deg, #eab08c 0%, #b86c43 52%, #743a1f 100%)',
    tagRu: 'Тёплый металл',
  },
  {
    key: 'glass',
    category: 'optics',
    swatchCss: 'linear-gradient(135deg, #f4f9fb 0%, #d4e5ec 55%, #b1cbd6 100%)',
    tagRu: 'Оптика / плафон',
  },
  {
    key: 'crystal',
    category: 'optics',
    swatchCss: 'linear-gradient(135deg, #ffffff 0%, #e1eef7 45%, #c5d6e8 100%)',
    tagRu: 'Преломление света',
  },
  {
    key: 'acrylic',
    category: 'optics',
    swatchCss: 'linear-gradient(135deg, #fcfcfa 0%, #ecebe4 55%, #d4d3ca 100%)',
    tagRu: 'PMMA рассеиватель',
  },
  {
    key: 'polycarbonate',
    category: 'optics',
    swatchCss: 'linear-gradient(135deg, #f7f7f5 0%, #e1e2dd 55%, #c6c8c1 100%)',
    tagRu: 'Ударопрочный ПК',
  },
  {
    key: 'genuineLeather',
    category: 'natural',
    swatchCss: 'linear-gradient(135deg, #7e5638 0%, #563621 55%, #341e11 100%)',
    tagRu: 'Натуральная кожа',
    strictNoteRu: 'Самостоятельный материал — не заменять на PU/PVC.',
  },
  {
    key: 'artificialLeather',
    category: 'natural',
    swatchCss: 'linear-gradient(135deg, #8b6a52 0%, #644a38 55%, #402e23 100%)',
    tagRu: 'PU / экокожа',
  },
  {
    key: 'wood',
    category: 'natural',
    swatchCss: 'linear-gradient(135deg, #b88a5c 0%, #875c37 55%, #56371d 100%)',
    tagRu: 'Массив / шпон',
  },
  {
    key: 'stone',
    category: 'natural',
    swatchCss: 'linear-gradient(135deg, #e5e1d8 0%, #bfb8aa 55%, #8d867a 100%)',
    tagRu: 'Мрамор / алебастр',
  },
  {
    key: 'ceramic',
    category: 'natural',
    swatchCss: 'linear-gradient(135deg, #f2ede6 0%, #d8cfc3 55%, #b2a799 100%)',
    tagRu: 'Керамика / фарфор',
  },
  {
    key: 'textile',
    category: 'other',
    swatchCss: 'linear-gradient(135deg, #ece6dc 0%, #cfc6b8 55%, #a89f90 100%)',
    tagRu: 'Абажурная ткань',
  },
  {
    key: 'custom',
    category: 'other',
    swatchCss: 'linear-gradient(135deg, #d7d2c9 0%, #a59d91 55%, #6e675d 100%)',
    tagRu: 'По спецификации',
  },
];

export const FINISH_VISUALS: FinishVisualSpec[] = [
  {
    key: 'naturalSatinBrass',
    swatchCss: 'linear-gradient(120deg, #dfc27a 0%, #c6a154 48%, #e4ca88 72%, #9e7a34 100%)',
    family: 'brass',
    shortHintRu: 'Мягкий шелковистый блеск',
  },
  {
    key: 'brushedBrass',
    swatchCss: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.12) 0 1px, transparent 1px 3px), linear-gradient(135deg, #d6b262 0%, #b0893c 55%, #8a6825 100%)',
    family: 'brass',
    shortHintRu: 'Направленная шлифовка',
  },
  {
    key: 'polishedBrass',
    swatchCss: 'linear-gradient(135deg, #fff1be 0%, #e1bd62 38%, #9e7624 62%, #f8e296 100%)',
    family: 'brass',
    shortHintRu: 'Зеркальная полировка',
  },
  {
    key: 'antiqueBrass',
    swatchCss: 'linear-gradient(135deg, #b39252 0%, #866833 52%, #59431d 100%)',
    family: 'brass',
    shortHintRu: 'Приглушённый винтаж',
  },
  {
    key: 'burnishedBrass',
    swatchCss: 'linear-gradient(135deg, #8b6d3c 0%, #5c4523 55%, #372812 100%)',
    family: 'brass',
    shortHintRu: 'Глубокая патина',
  },
  {
    key: 'brushedBronze',
    swatchCss: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.08) 0 1px, transparent 1px 3px), linear-gradient(135deg, #987354 0%, #6d4f37 55%, #463120 100%)',
    family: 'bronze',
    shortHintRu: 'Тёплая тёмная бронза',
  },
  {
    key: 'polishedChrome',
    swatchCss: 'linear-gradient(135deg, #ffffff 0%, #cfd6dc 42%, #808991 60%, #edf1f4 100%)',
    family: 'silver',
    shortHintRu: 'Зеркальный хром',
  },
  {
    key: 'satinNickel',
    swatchCss: 'linear-gradient(135deg, #e1e5e8 0%, #b5bcc2 52%, #878f96 100%)',
    family: 'silver',
    shortHintRu: 'Матовый серебристый',
  },
  {
    key: 'matteBlack',
    swatchCss: 'linear-gradient(135deg, #3a3d40 0%, #242628 58%, #151618 100%)',
    family: 'dark',
    shortHintRu: 'Порошковый матовый',
  },
  {
    key: 'glossyBlack',
    swatchCss: 'linear-gradient(135deg, #4b4f54 0%, #16181a 40%, #090a0b 100%)',
    family: 'dark',
    shortHintRu: 'Глубокий глянец',
  },
  {
    key: 'white',
    swatchCss: 'linear-gradient(135deg, #ffffff 0%, #f4f2ec 60%, #e1ded6 100%)',
    family: 'light',
    shortHintRu: 'Белый архитектурный',
  },
  {
    key: 'custom',
    swatchCss: 'conic-gradient(from 45deg, #c9a65d, #7f6040, #3e4246, #d9dfe4, #c9a65d)',
    family: 'custom',
    shortHintRu: 'Custom RAL / по образцу',
  },
];

export const RAL_QUICK_CHIPS = [
  'Тёплая латунь (по образцу)',
  'RAL 9005 Jet Black',
  'RAL 9010 Pure White',
  'RAL 1036 Pearl Gold',
  'RAL 8019 Grey Brown',
  'По физическому образцу / Custom Sample',
] as const;

export type AiMaterialPaletteSuggestion = {
  bodyMaterial?: Material['material'];
  suggestedFinishes: NonNullable<Material['finish']>[];
  suspensionMaterial?: Material['material'];
  diffuserMaterial?: Material['material'];
  colorHint?: string;
  headlineRu: string;
  detailRu: string;
};

/**
 * Translates Gemini Vision photo analysis into honest visual palette pre-selections (always Estimated).
 */
export function suggestMaterialsFromAiPhoto(
  aiPhoto: GeminiPhotoAnalysis | null,
): AiMaterialPaletteSuggestion | null {
  if (!aiPhoto) return null;

  const paletteText = [
    ...aiPhoto.primaryColors,
    aiPhoto.suspectedMaterial.label ?? '',
    aiPhoto.suspectedFinish.label ?? '',
  ]
    .join(' ')
    .toLowerCase();

  const suggestedFinishes: NonNullable<Material['finish']>[] = [];
  const pushFinish = (fk: NonNullable<Material['finish']>) => {
    if (!suggestedFinishes.includes(fk)) suggestedFinishes.push(fk);
  };

  if (aiPhoto.suspectedFinish.key) {
    pushFinish(aiPhoto.suspectedFinish.key);
  }

  let bodyMaterial: Material['material'] | undefined = aiPhoto.suspectedMaterial.key ?? undefined;

  if (/латун|золот|brass|gold|шампан|warm metal/i.test(paletteText)) {
    if (!bodyMaterial) bodyMaterial = 'solidBrass';
    pushFinish('brushedBrass');
    pushFinish('naturalSatinBrass');
    pushFinish('antiqueBrass');
    pushFinish('polishedBrass');
  } else if (/бронз|bronze|коричнев|brown/i.test(paletteText)) {
    if (!bodyMaterial) bodyMaterial = 'solidBrass';
    pushFinish('brushedBronze');
    pushFinish('burnishedBrass');
    pushFinish('antiqueBrass');
  } else if (/чёрн|черн|black|графит|anthracite/i.test(paletteText)) {
    if (!bodyMaterial) bodyMaterial = 'aluminium';
    pushFinish('matteBlack');
    pushFinish('glossyBlack');
  } else if (/хром|никел|серебр|chrome|nickel|silver|steel/i.test(paletteText)) {
    if (!bodyMaterial) bodyMaterial = 'stainlessSteel';
    pushFinish('satinNickel');
    pushFinish('polishedChrome');
  } else if (/бел|white/i.test(paletteText)) {
    if (!bodyMaterial) bodyMaterial = 'aluminium';
    pushFinish('white');
  }

  const suspText = (aiPhoto.suspensionType.value ?? '').toLowerCase();
  const suspensionMaterial: Material['material'] | undefined = /кож|leather|ремен|strap/i.test(suspText)
    ? 'genuineLeather'
    : /трос|сталь|cable|wire/i.test(suspText)
      ? 'stainlessSteel'
      : /латун|brass|стерж|rod/i.test(suspText)
        ? 'solidBrass'
        : undefined;

  const diffuserMaterial: Material['material'] | undefined =
    aiPhoto.hasDiffuser.value === true
      ? /стекл|glass/i.test(aiPhoto.hasDiffuser.description ?? '')
        ? 'glass'
        : 'polycarbonate'
      : undefined;

  const colorHint = aiPhoto.primaryColors.slice(0, 2).join(', ') || undefined;

  if (!bodyMaterial && suggestedFinishes.length === 0 && !suspensionMaterial && !diffuserMaterial) {
    return null;
  }

  return {
    bodyMaterial,
    suggestedFinishes,
    suspensionMaterial,
    diffuserMaterial,
    colorHint,
    headlineRu: `AI-палитра по фото (${aiPhoto.photoName}) — статус Оценка (Estimated)`,
    detailRu:
      aiPhoto.suspectedMaterial.uncertaintyReason ??
      'По фотографии выделена вероятная палитра и отделки. Окончательный сплав и покрытие требуют вашего выбора и подтверждения фабрикой.',
  };
}
