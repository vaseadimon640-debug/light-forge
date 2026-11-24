import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import sharp from 'sharp';
import { z } from 'zod';
import { localSearchResponseSchema, maxReferences, referenceSchema } from '../visual-search/local-contract.ts';

const side = 16;
const edgeLength = 2 * side * (side - 1);
const colourLength = 4 * 4 * 3;
export const maxIndexBytes = 2 * 1024 * 1024;

const fingerprintSchema = z.strictObject({
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  edges: z.string().regex(new RegExp(`^[012]{${edgeLength}}$`)),
  colours: z.array(z.number().int().min(0).max(255)).length(colourLength),
});
const indexedReferenceSchema = referenceSchema.extend({ fingerprint: fingerprintSchema });
export const localIndexSchema = z.strictObject({
  version: z.literal(1),
  references: z.array(indexedReferenceSchema).min(1).max(maxReferences)
    .refine(items => new Set(items.map(item => item.id)).size === items.length, 'Reference IDs must be unique.'),
});
type Fingerprint = z.infer<typeof fingerprintSchema>;
type Index = z.infer<typeof localIndexSchema>;

export async function readLocalFile(path: string, limit: number): Promise<Buffer> {
  const file = await open(path, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > limit) throw new Error('File exceeds supported size.');
    const bytes = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset !== stat.size) throw new Error('File changed while being read.');
    return bytes.subarray(0, offset);
  } finally {
    await file.close();
  }
}

export async function openLocalIndex(): Promise<Index | undefined> {
  const path = process.env.LIGHT_FORGE_VISUAL_INDEX_PATH?.trim();
  if (!path) return;
  try {
    const file = await readLocalFile(path, maxIndexBytes);
    return localIndexSchema.parse(JSON.parse(file.toString('utf8')));
  } catch {
    return undefined;
  }
}

export async function fingerprintPhoto(bytes: Uint8Array): Promise<Fingerprint> {
  const image = sharp(bytes, { limitInputPixels: 60_000_000, failOn: 'error' });
  const { format, pages } = await image.metadata();
  if (!format || !['jpeg', 'png', 'webp'].includes(format) || (pages ?? 1) > 1) {
    throw new Error('Use a single JPEG, PNG or WebP image.');
  }
  const rgb = await image.autoOrient().resize(side, side, { fit: 'fill' })
    .toColourspace('srgb').flatten({ background: '#ffffff' }).removeAlpha().raw().toBuffer();
  const luminance = Array.from({ length: side * side }, (_, pixel) => {
    const offset = pixel * 3;
    return (rgb[offset] * 299 + rgb[offset + 1] * 587 + rgb[offset + 2] * 114) / 1000;
  });
  const edges: string[] = [];
  const colours = Array<number>(colourLength).fill(0);
  const edge = (difference: number) => difference > 12 ? '2' : difference < -12 ? '0' : '1';
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const pixel = y * side + x;
      if (x + 1 < side) edges.push(edge(luminance[pixel + 1] - luminance[pixel]));
      if (y + 1 < side) edges.push(edge(luminance[pixel + side] - luminance[pixel]));
      const cell = (Math.floor(y / 4) * 4 + Math.floor(x / 4)) * 3;
      for (let channel = 0; channel < 3; channel++) colours[cell + channel] += rgb[pixel * 3 + channel];
    }
  }
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    edges: edges.join(''),
    colours: colours.map(total => Math.round(total / 16)),
  };
}

type LocalSearchResponse = z.infer<typeof localSearchResponseSchema>;
type RankedMatch = { reference: z.infer<typeof referenceSchema>; match: LocalSearchResponse['matches'][number]['match']; distance: number };

export function matchLocalReferences(index: Index, query: Fingerprint): LocalSearchResponse {
  const ranked = index.references.flatMap<RankedMatch>(({ fingerprint, ...reference }) => {
    if (fingerprint.sha256 === query.sha256) {
      return [{ reference, match: 'same_file' as const, distance: -1 }];
    }
    const edges = Array.from(fingerprint.edges).reduce((difference, value, i) =>
      difference + Number(value !== query.edges[i]), 0) / edgeLength;
    const colour = fingerprint.colours.reduce((difference, value, i) =>
      difference + Math.abs(value - query.colours[i]), 0) / (255 * colourLength);
    if (edges > 0.18 || colour > 0.16) return [];
    return [{ reference, match: 'similar_image' as const, distance: edges + colour }];
  });
  return {
    matches: ranked.sort((a, b) => a.distance - b.distance).slice(0, 5)
      .map(({ reference, match }) => ({ ...reference, match })),
    originalVerified: false,
  };
}
