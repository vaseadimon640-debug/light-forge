import { randomUUID } from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { fingerprintPhoto, localIndexSchema, maxIndexBytes, readLocalFile } from '../src/server/visual-catalogue-index.ts';
import { maxLocalPhotoBytes, maxReferences, referenceSchema } from '../src/visual-search/local-contract.ts';

const [, , listPath, outputPath] = process.argv;
if (!listPath || !outputPath) throw new Error('Usage: npm run visual:index -- <manifest.json> <index.json>');

const manifestPath = resolve(listPath);
const indexPath = resolve(outputPath);
if (manifestPath === indexPath) throw new Error('Use a separate output path.');
const manifestSchema = z.array(referenceSchema.extend({ file: z.string().trim().min(1).max(1024) }))
  .min(1).max(maxReferences)
  .refine(items => new Set(items.map(item => item.id)).size === items.length, 'Reference IDs must be unique.');
const manifest = manifestSchema.parse(JSON.parse((await readLocalFile(manifestPath, maxIndexBytes)).toString('utf8')));
const references = [];
for (const { file, ...reference } of manifest) {
  const imagePath = resolve(dirname(manifestPath), file);
  if (imagePath === indexPath) throw new Error('Use a separate output path.');
  const bytes = await readLocalFile(imagePath, maxLocalPhotoBytes);
  references.push({ ...reference, fingerprint: await fingerprintPhoto(bytes) });
}

const index = localIndexSchema.parse({ version: 1, references });
const temporary = `${indexPath}.${randomUUID()}.tmp`;
try {
  await writeFile(temporary, JSON.stringify(index), { mode: 0o600, flag: 'wx' });
  await rename(temporary, indexPath);
} finally {
  await rm(temporary, { force: true });
}
console.log(`Indexed ${index.references.length} references.`);
