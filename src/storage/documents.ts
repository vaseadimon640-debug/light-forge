import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { z } from 'zod';
import type { Project } from '../domain/project.ts';
import type { Composition } from '../geometry/schema.ts';
import { rfqTierSchema, type RfqTier } from '../rfq/detailed.ts';
import { languageSchema, type RfqLanguage } from '../rfq/quick.ts';

export const documentStatusSchema = z.enum(['draft', 'ready', 'sent']);
export type DocumentStatus = z.infer<typeof documentStatusSchema>;

export const documentRevisionMetaSchema = z.strictObject({
  id: z.string().uuid(),
  projectId: z.string().min(1).max(128),
  projectName: z.string().min(1).max(160),
  projectCode: z.string().max(80),
  revision: z.number().int().min(1).max(999),
  tier: rfqTierSchema,
  language: languageSchema,
  status: documentStatusSchema,
  fingerprint: z.string().min(1).max(200_000),
  compositionId: z.string().max(128).optional(),
  compositionName: z.string().max(160).optional(),
  photoCount: z.number().int().min(0).max(8),
  unknownCount: z.number().int().min(0).max(500),
  pdfFilename: z.string().min(1).max(255),
  pdfSizeBytes: z.number().int().positive(),
  note: z.string().max(400),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type DocumentRevisionMeta = z.infer<typeof documentRevisionMetaSchema>;
export type DocumentRevision = DocumentRevisionMeta & { pdfBlob: Blob };

type StoredDocumentRecord = {
  meta: DocumentRevisionMeta;
  pdfBlob: Blob;
};

interface DocumentDatabase extends DBSchema {
  revisions: {
    key: string;
    value: StoredDocumentRecord;
    indexes: {
      'by-project-id': string;
      'by-created-at': string;
    };
  };
}

const storeName = 'revisions';

export function computeDocumentFingerprint(
  project: Project,
  composition: Composition | undefined,
  tier: RfqTier,
  language: RfqLanguage,
): string {
  const { createdAt: _c, updatedAt: _u, ...stableProject } = project;
  return JSON.stringify({
    tier,
    language,
    project: stableProject,
    composition: composition ?? null,
  });
}

function validateRecord(record: StoredDocumentRecord): DocumentRevision {
  const meta = documentRevisionMetaSchema.parse(record.meta);
  if (!(record.pdfBlob instanceof Blob) || record.pdfBlob.size !== meta.pdfSizeBytes) {
    throw new Error(`Stored PDF blob does not match metadata for ${meta.pdfFilename}.`);
  }
  return { ...meta, pdfBlob: record.pdfBlob };
}

export type SaveRevisionInput = {
  projectId: string;
  projectName: string;
  projectCode: string;
  tier: RfqTier;
  language: RfqLanguage;
  status?: DocumentStatus;
  fingerprint: string;
  compositionId?: string;
  compositionName?: string;
  photoCount: number;
  unknownCount: number;
  pdfFilename: string;
  pdfBlob: Blob;
  note?: string;
  revision?: number;
};

export interface DocumentStore {
  nextRevisionNumber(projectId: string): Promise<number>;
  saveRevision(input: SaveRevisionInput): Promise<DocumentRevision>;
  get(id: string): Promise<DocumentRevision | undefined>;
  list(projectId?: string): Promise<DocumentRevisionMeta[]>;
  updateMeta(
    id: string,
    patch: { status?: DocumentStatus; note?: string },
  ): Promise<DocumentRevisionMeta | undefined>;
  remove(id: string): Promise<void>;
  close(): void;
}

export async function openDocumentStore(
  database = 'light-forge-documents',
): Promise<DocumentStore> {
  let active: IDBPDatabase<DocumentDatabase> | undefined;
  const db = await openDB<DocumentDatabase>(database, 1, {
    upgrade(dbInstance) {
      const store = dbInstance.createObjectStore(storeName, { keyPath: 'meta.id' });
      store.createIndex('by-project-id', 'meta.projectId');
      store.createIndex('by-created-at', 'meta.createdAt');
    },
    blocking() {
      active?.close();
    },
  });
  active = db;

  async function nextRevisionNumber(projectId: string): Promise<number> {
    const existing = await db.getAllFromIndex(storeName, 'by-project-id', projectId);
    let maxRev = 0;
    for (const item of existing) {
      if (item.meta.revision > maxRev) maxRev = item.meta.revision;
    }
    return Math.min(999, maxRev + 1);
  }

  return {
    nextRevisionNumber,
    async saveRevision(input) {
      if (!(input.pdfBlob instanceof Blob) || input.pdfBlob.size <= 0) {
        throw new Error('Document revision requires a non-empty PDF file.');
      }
      const now = new Date().toISOString();
      const revision = input.revision ?? (await nextRevisionNumber(input.projectId));
      const meta = documentRevisionMetaSchema.parse({
        id: crypto.randomUUID(),
        projectId: input.projectId,
        projectName: input.projectName.trim() || 'Проект без названия',
        projectCode: input.projectCode.trim(),
        revision,
        tier: input.tier,
        language: input.language,
        status: input.status ?? 'draft',
        fingerprint: input.fingerprint,
        compositionId: input.compositionId,
        compositionName: input.compositionName,
        photoCount: input.photoCount,
        unknownCount: input.unknownCount,
        pdfFilename: input.pdfFilename,
        pdfSizeBytes: input.pdfBlob.size,
        note: (input.note ?? '').trim().slice(0, 400),
        createdAt: now,
        updatedAt: now,
      });
      const record: StoredDocumentRecord = { meta, pdfBlob: input.pdfBlob };
      await db.put(storeName, record);
      return validateRecord(record);
    },
    async get(id) {
      const found = await db.get(storeName, id);
      return found ? validateRecord(found) : undefined;
    },
    async list(projectId) {
      const records = projectId
        ? await db.getAllFromIndex(storeName, 'by-project-id', projectId)
        : await db.getAllFromIndex(storeName, 'by-created-at');
      return records
        .map(record => documentRevisionMetaSchema.parse(record.meta))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.revision - a.revision);
    },
    async updateMeta(id, patch) {
      const found = await db.get(storeName, id);
      if (!found) return undefined;
      const updatedMeta = documentRevisionMetaSchema.parse({
        ...found.meta,
        status: patch.status ?? found.meta.status,
        note: patch.note !== undefined ? patch.note.trim().slice(0, 400) : found.meta.note,
        updatedAt: new Date().toISOString(),
      });
      await db.put(storeName, { meta: updatedMeta, pdfBlob: found.pdfBlob });
      return updatedMeta;
    },
    async remove(id) {
      await db.delete(storeName, id);
    },
    close() {
      db.close();
    },
  };
}
