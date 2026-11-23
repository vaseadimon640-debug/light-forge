import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { z } from 'zod';
import { compositionSchema, type Composition } from '../geometry/schema.ts';

const recordSchema = z.strictObject({ composition: compositionSchema, updatedAt: z.iso.datetime() });
export type SavedComposition = z.infer<typeof recordSchema>;

interface Workspace extends DBSchema {
  compositions: {
    key: string;
    value: SavedComposition;
    indexes: { 'by-updated-at': string };
  };
}

export interface CompositionStore {
  save(data: Composition): Promise<SavedComposition>;
  get(id: string): Promise<SavedComposition | undefined>;
  list(): Promise<SavedComposition[]>;
  remove(id: string): Promise<void>;
  close(): void;
}

const collection = 'compositions';

export async function openCompositionStore(name = 'light-forge-geometry'): Promise<CompositionStore> {
  let active: IDBPDatabase<Workspace> | undefined;
  const db = await openDB<Workspace>(name, 1, {
    upgrade(database) {
      database.createObjectStore(collection, { keyPath: 'composition.id' })
        .createIndex('by-updated-at', 'updatedAt');
    },
    blocking() { active?.close(); },
  });
  active = db;
  return {
    async save(data) {
      const saved = { composition: compositionSchema.parse(data), updatedAt: new Date().toISOString() };
      await db.put(collection, saved);
      return saved;
    },
    async get(id) {
      const found = await db.get(collection, id);
      return found ? recordSchema.parse(found) : undefined;
    },
    async list() {
      const results = await db.getAllFromIndex(collection, 'by-updated-at');
      return results.reverse().map(item => recordSchema.parse(item));
    },
    async remove(id) { await db.delete(collection, id); },
    close() { db.close(); },
  };
}

export function exportComposition(data: Composition): string {
  return JSON.stringify(compositionSchema.parse(data), null, 2);
}

export function importComposition(json: string): Composition {
  if (new TextEncoder().encode(json).length > 1024 * 1024) throw new Error('Composition exceeds 1 MiB');
  return compositionSchema.parse(JSON.parse(json));
}
