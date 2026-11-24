import { z } from 'zod';
import { newComponent, newProject, photoSchema, productTypes, type ProductType } from '../domain/project.ts';
import type { ProjectSnapshot } from '../storage/projects.ts';
import { mylineSpecifications, specificationsSchema } from './specifications.ts';

export const sourceUrlSchema = z.url({ protocol: /^https?$/ }).max(2048).refine(value => {
  const url = new URL(value);
  return !url.username && !url.password;
}, 'Remove credentials from the URL.');

const linkSchema = z.strictObject({ url: sourceUrlSchema, title: z.string().trim().min(1).max(180) });
export const reviewSchema = z.strictObject({ results: z.array(linkSchema).max(30) });
export const searchInputSchema = z.strictObject({
  query: z.string().trim().max(240),
  mode: z.enum(['standard', 'deep']),
  photo: photoSchema.optional(),
  runGemini: z.boolean().optional(),
});

export type SearchInput = z.infer<typeof searchInputSchema>;
export type ReviewLink = z.infer<typeof linkSchema>;
const categorySchema = z.enum(['verified_original', 'exact_match', 'visual_alternative', 'technical_alternative', 'unverified']);
const variantSchema = z.strictObject({
  sku: z.string(), widthMm: z.number().positive(), depthMm: z.number().positive(), heightMm: z.number().positive(),
});
const searchResultSchema = z.strictObject({
  id: z.string(), name: z.string(), brand: z.string().optional(),
  kind: z.enum(Object.keys(productTypes) as ProductType[]).optional(),
  category: categorySchema,
  evidence: z.enum(['manufacturer_catalogue', 'catalogue_similarity', 'user_link']),
  source: sourceUrlSchema, documentUrl: sourceUrlSchema.optional(), details: z.string().optional(),
  variants: z.array(variantSchema).optional(), confirmedDimming: z.literal('DALI').optional(),
  specifications: specificationsSchema.optional(),
});
export const searchUsageSchema = z.strictObject({
  enabled: z.boolean(), requestsToday: z.number().int().min(0), appDailyLimit: z.number().int().positive(), providerRemaining: z.null(),
});
export const searchResponseSchema = z.strictObject({
  results: z.array(searchResultSchema),
  links: z.array(z.strictObject({ language: z.string(), url: sourceUrlSchema })),
  traits: z.array(z.string()), warning: z.string().optional(), gemini: searchUsageSchema,
  originalVerified: z.literal(false), paidEnabled: z.literal(false),
});
export const searchCapabilitiesSchema = z.strictObject({
  gemini: searchUsageSchema, serpApi: z.strictObject({ enabled: z.literal(false) }),
  manualLens: z.literal(true), paidEnabled: z.literal(false),
});
export type SearchResult = z.infer<typeof searchResultSchema>;
export type SearchUsage = z.infer<typeof searchUsageSchema>;
export type SearchResponse = z.infer<typeof searchResponseSchema>;
type Variant = z.infer<typeof variantSchema>;
type CatalogueEntry = Omit<SearchResult, 'category' | 'evidence'> & { keywords: string[]; sourceAliases?: string[] };

const catalogue: CatalogueEntry[] = [
  {
    id: 'emmemobili-myline', name: 'MYLINE', brand: 'Emmemobili', kind: 'chandelier',
    source: 'https://www.emmemobili.it/en/prodotti/illuminazione/myline',
    sourceAliases: ['https://www.emmemobili.it/prodotti/illuminazione/myline'],
    documentUrl: 'https://www.emmemobili.it/_files/ugd/a74d91_0efaff6445f04844abdd37aafa04494e.pdf',
    confirmedDimming: 'DALI',
    specifications: mylineSpecifications,
    details: 'Дизайн Adele Martelli. Латунные кольца, коричневые кожаные ремни, LED и DALI по техпаспорту.',
    variants: [
      { sku: 'ICBA02', widthMm: 900, depthMm: 60, heightMm: 700 },
      { sku: 'ICBB02', widthMm: 900, depthMm: 60, heightMm: 700 },
      { sku: 'ICBA01', widthMm: 700, depthMm: 60, heightMm: 550 },
      { sku: 'ICBB01', widthMm: 700, depthMm: 60, heightMm: 550 },
    ],
    keywords: ['ring', 'brass', 'leather', 'pendant', 'chandelier', 'anello', 'anelli', 'кольцо', 'латунь', 'кожа', 'люстра', '环形', '黄铜', 'ringpendelleuchte'],
  },
  {
    id: 'emmemobili-myring-table', name: 'Myring Table', brand: 'Emmemobili', kind: 'table',
    source: 'https://www.emmemobili.it/prodotti/illuminazione/myring-table',
    sourceAliases: ['https://www.emmemobili.it/en/prodotti/illuminazione/myring-table'],
    details: 'Кольцевая форма. Настольный светильник с другим способом установки.',
    keywords: ['ring', 'brass', 'table', 'кольцо', 'настольный', 'anelli', '环形'],
  },
];

const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().trim();
function containsToken(haystack: string, needle: string) {
  if (/\p{Script=Han}/u.test(needle)) return haystack.includes(needle);
  return new RegExp(`(^|[^\\p{L}\\p{N}])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'u').test(haystack);
}

export function canonicalSource(value: string): string {
  const url = new URL(sourceUrlSchema.parse(value));
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key) || ['gclid', 'fbclid'].includes(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString();
}

export function catalogueSearch(value: string, mode: SearchInput['mode']): SearchResult[] {
  const query = normalize(value);
  if (!query) return [];
  const ranked = catalogue.map(entry => {
    const names = [normalize(entry.name), ...(entry.variants ?? []).map(item => normalize(item.sku))];
    const exact = names.some(name => containsToken(query, name));
    const keywords = entry.keywords.filter(word => containsToken(query, word)).length;
    const brand = entry.brand && containsToken(query, normalize(entry.brand)) ? 1 : 0;
    const { keywords: _keywords, sourceAliases: _aliases, ...item } = entry;
    const result: SearchResult = exact
      ? { ...item, category: 'verified_original', evidence: 'manufacturer_catalogue' }
      : { ...item, category: 'visual_alternative', evidence: 'catalogue_similarity' };
    return { result, rank: exact ? 100 + brand : keywords + brand };
  });
  const direct = ranked.some(item => item.rank >= 100);
  return ranked.filter(item => direct && mode === 'standard' ? item.rank >= 100 : item.rank > 0)
    .sort((a,b) => b.rank - a.rank)
    .map(item => item.result);
}

export function importReviewLinks(links: ReviewLink[]): SearchResult[] {
  const unique = new Map<string, SearchResult>();
  for (const item of reviewSchema.parse({ results: links }).results) {
    const source = canonicalSource(item.url);
    const official = catalogue.find(entry =>
      [entry.source, ...(entry.sourceAliases ?? [])].some(url => canonicalSource(url) === source),
    );
    if (official) {
      const { keywords: _keywords, sourceAliases: _aliases, ...entry } = official;
      unique.set(canonicalSource(entry.source), { ...entry, category: 'verified_original', evidence: 'manufacturer_catalogue' });
      continue;
    }
    if (!unique.has(source)) unique.set(source, { id: source, name: item.title, category: 'unverified', evidence: 'user_link', source });
  }
  return [...unique.values()];
}

export function searchLinks(query: string, mode: SearchInput['mode']) {
  const suffixes = [['en','lighting manufacturer technical sheet'], ['zh-CN','灯具 制造商 型号 技术规格'], ['it','lampada produttore scheda tecnica'], ['de','Leuchte Hersteller technische Daten']] as const;
  return suffixes.slice(0, mode === 'deep' ? 4 : 1).map(([language,suffix]) => ({
    language, url: `https://www.google.com/search?${new URLSearchParams({q:`${query} ${suffix}`.trim(),hl:language})}`,
  }));
}

export function projectFromSearch(result: SearchResult, variant?: Variant, image?: File): ProjectSnapshot {
  const project = newProject();
  project.name = [result.brand, result.name].filter(Boolean).join(' ').slice(0,120);
  project.notes = [`Reference: ${result.source}`, result.documentUrl ? `Technical sheet: ${result.documentUrl}` : '',
    result.details ?? 'Manufacturer and product details to be confirmed.'].filter(Boolean).join('\n').slice(0,1000);
  // A result can be an approximate match to the input and still have documented product specifications.
  const documented = result.evidence !== 'user_link' && result.category !== 'unverified'
    ? catalogue.find(entry => entry.id === result.id && entry.source === result.source)
    : undefined;
  if (documented?.kind) {
    project.kind = documented.kind;
    const component = newComponent(documented.kind);
    component.name = documented.name;
    const verifiedVariant = documented.variants?.find(item => item.sku === variant?.sku);
    if (verifiedVariant) {
      project.code = verifiedVariant.sku;
      for (const [key, value] of [['width', verifiedVariant.widthMm], ['depth', verifiedVariant.depthMm], ['height', verifiedVariant.heightMm]] as const) {
        component.dimensions[key] = { value, source: 'documentation' };
      }
    }
    if (documented.confirmedDimming) component.light.dimming = documented.confirmedDimming;
    project.components = [component];
  }
  if (!image) return { project, originals: {} };
  const photo = photoSchema.parse({ id: crypto.randomUUID(), name: image.name, type: image.type, size: image.size });
  project.photos = [photo];
  project.primaryPhotoId = photo.id;
  return { project, originals: { [photo.id]: image } };
}
