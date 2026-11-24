import { reviewSchema, type ReviewLink } from '@/visual-search/catalogue';

export const HISTORY_KEY = 'light-forge-visual-search-history';
export const SAVED_KEY = 'light-forge-visual-search-links';
export function readHistory(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
    return Array.isArray(raw)
      ? raw.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 10)
      : [];
  } catch {
    return [];
  }
}

export function readSavedLinks(): ReviewLink[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]');
    return reviewSchema.parse({ results: raw }).results;
  } catch {
    return [];
  }
}
