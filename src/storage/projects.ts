import { openDB, type DBSchema } from 'idb';
import { z } from 'zod';
import { maxTotalPhotoBytes, projectSchema, type Project } from '../domain/project.ts';

export type ProjectSnapshot = { project: Project; originals: Record<string, Blob> };

interface ProjectDatabase extends DBSchema {
  projects: {
    key: string;
    value: ProjectSnapshot;
    indexes: { 'by-updated-at': string };
  };
}

const name = 'projects';

function validateSnapshot(snapshot: ProjectSnapshot): ProjectSnapshot {
  const project = projectSchema.parse(snapshot.project);
  if (Object.keys(snapshot.originals).length !== project.photos.length)
    throw new Error('The set of original photos does not match the project.');
  for (const photo of project.photos) {
    const original = Object.hasOwn(snapshot.originals, photo.id) ? snapshot.originals[photo.id] : undefined;
    if (!(original instanceof Blob) || original.type !== photo.type || original.size !== photo.size)
      throw new Error(`Original photo and metadata do not match for ${photo.name}.`);
  }
  return { project, originals: snapshot.originals };
}

export async function openProjectStore(database = 'light-forge-projects') {
  const store = await openDB<ProjectDatabase>(database, 1, {
    upgrade(db) {
      db.createObjectStore(name, { keyPath: 'project.id' }).createIndex('by-updated-at', 'project.updatedAt');
    },
  });
  async function save(snapshot: ProjectSnapshot): Promise<ProjectSnapshot> {
    const validated = validateSnapshot({
      ...snapshot, project: { ...snapshot.project, updatedAt: new Date().toISOString() },
    });
    await store.put(name, validated);
    return validated;
  }

  return {
    save,
    async duplicate(id: string): Promise<ProjectSnapshot | undefined> {
      const snapshot = await store.get(name, id);
      if (!snapshot) return undefined;
      return save({
        ...snapshot,
        project: {
          ...snapshot.project,
          id: crypto.randomUUID(),
          name: `${snapshot.project.name.slice(0, 111)} — копия`,
          createdAt: new Date().toISOString(),
        },
      });
    },
    async get(id: string): Promise<ProjectSnapshot | undefined> {
      const snapshot = await store.get(name, id);
      return snapshot && validateSnapshot(snapshot);
    },
    async list(): Promise<Project[]> {
      const index = (await store.getAllFromIndex(name, 'by-updated-at')).reverse();
      return index.map(item => projectSchema.parse(item.project));
    },
    async remove(id: string): Promise<void> { await store.delete(name, id); },
    close(): void { store.close(); },
  };
}

const portableSchema = z.strictObject({
  format: z.literal('light-forge-project'),
  version: z.literal(1),
  project: projectSchema,
  originals: z.record(z.string(), z.string()),
});
const maxArchiveBytes = Math.ceil(maxTotalPhotoBytes / 3) * 4 + 2 * 1024 * 1024;

function encode(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 16384) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 16384)));
  return btoa(chunks.join(''));
}

export async function exportProject(snapshot: ProjectSnapshot): Promise<Blob> {
  const { project, originals } = validateSnapshot(snapshot);
  const encoded = await Promise.all(project.photos.map(async photo =>
    [photo.id, encode(new Uint8Array(await originals[photo.id].arrayBuffer()))] as const));
  const serialized = JSON.stringify({ format: 'light-forge-project', version: 1, project, originals: Object.fromEntries(encoded) });
  return new Blob([serialized], { type: 'application/json' });
}

export async function importProject(archive: Blob): Promise<ProjectSnapshot> {
  if (archive.size > maxArchiveBytes) throw new Error('This project archive is larger than the supported limit.');
  const { project, originals } = portableSchema.parse(JSON.parse(await archive.text()));
  const files: [string, Blob][] = [];
  if (Object.keys(originals).length !== project.photos.length)
    throw new Error('The set of original photos does not match the archived project.');
  for (const photo of project.photos) {
    const encoded = Object.hasOwn(originals, photo.id) ? originals[photo.id] : undefined;
    if (typeof encoded !== 'string' || encoded.length !== Math.ceil(photo.size / 3) * 4)
      throw new Error(`Original photo is missing or incomplete for ${photo.name}.`);
    const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
    files.push([photo.id, new Blob([bytes], { type: photo.type })]);
  }
  return validateSnapshot({ project, originals: Object.fromEntries(files) });
}

export function quickRfqForm(snapshot: ProjectSnapshot, composition?: unknown): FormData {
  const { project, originals } = validateSnapshot(snapshot);
  const form = new FormData();
  form.set('input', JSON.stringify({ project, composition }));
  for (const photo of project.photos) form.set(`photo:${photo.id}`, originals[photo.id], photo.name);
  return form;
}
