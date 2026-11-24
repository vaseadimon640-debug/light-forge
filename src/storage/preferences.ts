import { z } from 'zod';
import { rfqTierSchema, type RfqTier } from '../rfq/detailed.ts';
import { languageSchema, type RfqLanguage } from '../rfq/quick.ts';

export const preferencesStorageKey = 'light-forge-preferences-v1';

export const studioPreferencesSchema = z.strictObject({
  defaultRfqLanguage: languageSchema,
  defaultRfqTier: rfqTierSchema,
  defaultCurrency: z.enum(['USD', 'EUR', 'CNY']),
  preferredGeminiModel: z.string().max(80),
  deepAiAnalysisEnabled: z.boolean(),
  requireExternalAiConsent: z.boolean(),
  lengthUnit: z.literal('mm'),
  paidAiApisEnabled: z.literal(false),
});

export type StudioPreferences = z.infer<typeof studioPreferencesSchema>;

export const defaultStudioPreferences: StudioPreferences = {
  defaultRfqLanguage: 'en-zh',
  defaultRfqTier: 'detailed',
  defaultCurrency: 'USD',
  preferredGeminiModel: '',
  deepAiAnalysisEnabled: false,
  requireExternalAiConsent: true,
  lengthUnit: 'mm',
  paidAiApisEnabled: false,
};

export function parseStudioPreferences(raw: unknown): StudioPreferences {
  if (!raw || typeof raw !== 'object') return { ...defaultStudioPreferences };
  const record = raw as Record<string, unknown>;
  const merged = {
    defaultRfqLanguage: record.defaultRfqLanguage ?? defaultStudioPreferences.defaultRfqLanguage,
    defaultRfqTier: record.defaultRfqTier ?? defaultStudioPreferences.defaultRfqTier,
    defaultCurrency: record.defaultCurrency ?? defaultStudioPreferences.defaultCurrency,
    preferredGeminiModel:
      typeof record.preferredGeminiModel === 'string'
        ? record.preferredGeminiModel.trim().slice(0, 80)
        : defaultStudioPreferences.preferredGeminiModel,
    deepAiAnalysisEnabled:
      typeof record.deepAiAnalysisEnabled === 'boolean'
        ? record.deepAiAnalysisEnabled
        : defaultStudioPreferences.deepAiAnalysisEnabled,
    requireExternalAiConsent:
      typeof record.requireExternalAiConsent === 'boolean'
        ? record.requireExternalAiConsent
        : defaultStudioPreferences.requireExternalAiConsent,
    lengthUnit: 'mm' as const,
    paidAiApisEnabled: false as const,
  };
  const parsed = studioPreferencesSchema.safeParse(merged);
  return parsed.success ? parsed.data : { ...defaultStudioPreferences };
}

export function loadStudioPreferences(storage?: Pick<Storage, 'getItem'>): StudioPreferences {
  try {
    const target = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
    if (!target) return { ...defaultStudioPreferences };
    const raw = target.getItem(preferencesStorageKey);
    if (!raw) return { ...defaultStudioPreferences };
    return parseStudioPreferences(JSON.parse(raw));
  } catch {
    return { ...defaultStudioPreferences };
  }
}

export function saveStudioPreferences(
  patch: Partial<
    Pick<
      StudioPreferences,
      | 'defaultRfqLanguage'
      | 'defaultRfqTier'
      | 'defaultCurrency'
      | 'preferredGeminiModel'
      | 'deepAiAnalysisEnabled'
      | 'requireExternalAiConsent'
    >
  >,
  storage?: Pick<Storage, 'getItem' | 'setItem'>,
): { preferences: StudioPreferences; persisted: boolean } {
  const current = loadStudioPreferences(storage);
  const next: StudioPreferences = parseStudioPreferences({
    ...current,
    ...patch,
    lengthUnit: 'mm',
    paidAiApisEnabled: false,
  });
  try {
    const target = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
    if (!target) return { preferences: next, persisted: false };
    target.setItem(preferencesStorageKey, JSON.stringify(next));
    return { preferences: next, persisted: true };
  } catch {
    return { preferences: next, persisted: false };
  }
}

export function formatRfqLanguageLabel(lang: RfqLanguage): string {
  if (lang === 'en') return 'English (EN)';
  if (lang === 'zh') return '中文 (ZH)';
  return 'EN + ZH (двуязычный)';
}

export function formatRfqTierLabel(tier: RfqTier): string {
  return tier === 'detailed' ? 'Detailed RFQ (инженерный)' : 'Quick RFQ (быстрый)';
}
