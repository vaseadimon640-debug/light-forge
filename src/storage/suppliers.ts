import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { z } from 'zod';

export const factoryResponseStatusSchema = z.enum([
  'requested',
  'clarification',
  'quoted',
  'sampling',
  'approved',
  'declined',
]);
export type FactoryResponseStatus = z.infer<typeof factoryResponseStatusSchema>;

export const quoteCurrencySchema = z.enum(['USD', 'EUR', 'CNY']);
export type QuoteCurrency = z.infer<typeof quoteCurrencySchema>;

export const incotermsSchema = z.enum(['EXW', 'FOB', 'CIF', 'DDP', 'DAP']);
export type Incoterms = z.infer<typeof incotermsSchema>;

export const materialConfirmationSchema = z.enum([
  'unconfirmed',
  'confirmed',
  'substitution_proposed',
]);
export type MaterialConfirmation = z.infer<typeof materialConfirmationSchema>;

export const factoryHistoryEventSchema = z.strictObject({
  id: z.string().min(1).max(64),
  at: z.iso.datetime(),
  status: factoryResponseStatusSchema,
  note: z.string().min(1).max(600),
});
export type FactoryHistoryEvent = z.infer<typeof factoryHistoryEventSchema>;

export const factoryResponseSchema = z.strictObject({
  id: z.string().uuid(),
  supplierName: z.string().trim().min(1).max(160),
  supplierRegion: z.string().trim().max(120).optional(),
  contactInfo: z.string().trim().max(200).optional(),
  projectId: z.string().trim().min(1).max(128).optional(),
  projectName: z.string().trim().max(160).optional(),
  documentRevisionId: z.string().trim().max(128).optional(),
  documentRevisionLabel: z.string().trim().max(80).optional(),
  status: factoryResponseStatusSchema,
  currency: quoteCurrencySchema.optional(),
  unitPrice: z.number().finite().positive().max(10_000_000).optional(),
  moq: z.number().int().positive().max(100_000).optional(),
  sampleLeadDays: z.number().int().positive().max(365).optional(),
  productionLeadDays: z.number().int().positive().max(365).optional(),
  incoterms: incotermsSchema.optional(),
  materialConfirmation: materialConfirmationSchema,
  substitutionNote: z.string().trim().max(400).optional(),
  certificationsConfirmed: z.string().trim().max(240).optional(),
  engineeringNotes: z.string().trim().max(1200).optional(),
  history: z.array(factoryHistoryEventSchema).max(60),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type FactoryResponse = z.infer<typeof factoryResponseSchema>;

export type SaveFactoryResponseInput = {
  id?: string;
  supplierName: string;
  supplierRegion?: string;
  contactInfo?: string;
  projectId?: string;
  projectName?: string;
  documentRevisionId?: string;
  documentRevisionLabel?: string;
  status: FactoryResponseStatus;
  currency?: QuoteCurrency;
  unitPrice?: number;
  moq?: number;
  sampleLeadDays?: number;
  productionLeadDays?: number;
  incoterms?: Incoterms;
  materialConfirmation?: MaterialConfirmation;
  substitutionNote?: string;
  certificationsConfirmed?: string;
  engineeringNotes?: string;
  eventNote?: string;
};

interface SupplierDatabase extends DBSchema {
  responses: {
    key: string;
    value: FactoryResponse;
    indexes: {
      'by-project-id': string;
      'by-updated-at': string;
    };
  };
}

const storeName = 'responses';

function cleanOptionalText(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export interface SupplierStore {
  save(input: SaveFactoryResponseInput): Promise<FactoryResponse>;
  appendEvent(
    id: string,
    event: { status: FactoryResponseStatus; note: string },
  ): Promise<FactoryResponse | undefined>;
  get(id: string): Promise<FactoryResponse | undefined>;
  list(projectId?: string): Promise<FactoryResponse[]>;
  remove(id: string): Promise<void>;
  close(): void;
}

export async function openSupplierStore(
  database = 'light-forge-suppliers',
): Promise<SupplierStore> {
  let active: IDBPDatabase<SupplierDatabase> | undefined;
  const db = await openDB<SupplierDatabase>(database, 1, {
    upgrade(dbInstance) {
      const store = dbInstance.createObjectStore(storeName, { keyPath: 'id' });
      store.createIndex('by-project-id', 'projectId');
      store.createIndex('by-updated-at', 'updatedAt');
    },
    blocking() {
      active?.close();
    },
  });
  active = db;

  return {
    async save(input) {
      const now = new Date().toISOString();
      const existing = input.id ? await db.get(storeName, input.id) : undefined;
      const id = existing?.id ?? input.id ?? crypto.randomUUID();
      const previousHistory = existing ? factoryResponseSchema.parse(existing).history : [];

      const eventMessage = cleanOptionalText(input.eventNote)
        ?? (existing
          ? existing.status !== input.status
            ? `Статус изменён: ${existing.status} → ${input.status}`
            : 'Запись предложения обновлена'
          : 'Создана запись взаимодействия с фабрикой');

      const nextHistory: FactoryHistoryEvent[] = [
        {
          id: crypto.randomUUID().slice(0, 12),
          at: now,
          status: input.status,
          note: eventMessage,
        },
        ...previousHistory,
      ].slice(0, 60);

      const unitPrice = typeof input.unitPrice === 'number' && Number.isFinite(input.unitPrice) && input.unitPrice > 0
        ? input.unitPrice
        : undefined;

      const record = factoryResponseSchema.parse({
        id,
        supplierName: input.supplierName.trim(),
        supplierRegion: cleanOptionalText(input.supplierRegion),
        contactInfo: cleanOptionalText(input.contactInfo),
        projectId: cleanOptionalText(input.projectId),
        projectName: cleanOptionalText(input.projectName),
        documentRevisionId: cleanOptionalText(input.documentRevisionId),
        documentRevisionLabel: cleanOptionalText(input.documentRevisionLabel),
        status: input.status,
        currency: unitPrice !== undefined ? (input.currency ?? 'USD') : input.currency,
        unitPrice,
        moq: typeof input.moq === 'number' && Number.isFinite(input.moq) && input.moq > 0
          ? Math.round(input.moq)
          : undefined,
        sampleLeadDays: typeof input.sampleLeadDays === 'number' && Number.isFinite(input.sampleLeadDays) && input.sampleLeadDays > 0
          ? Math.round(input.sampleLeadDays)
          : undefined,
        productionLeadDays: typeof input.productionLeadDays === 'number' && Number.isFinite(input.productionLeadDays) && input.productionLeadDays > 0
          ? Math.round(input.productionLeadDays)
          : undefined,
        incoterms: input.incoterms,
        materialConfirmation: input.materialConfirmation ?? 'unconfirmed',
        substitutionNote: cleanOptionalText(input.substitutionNote),
        certificationsConfirmed: cleanOptionalText(input.certificationsConfirmed),
        engineeringNotes: cleanOptionalText(input.engineeringNotes),
        history: nextHistory,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });

      await db.put(storeName, record);
      return record;
    },

    async appendEvent(id, event) {
      const existing = await db.get(storeName, id);
      if (!existing) return undefined;
      const parsed = factoryResponseSchema.parse(existing);
      const now = new Date().toISOString();
      const note = event.note.trim();
      if (!note) throw new Error('Event note is required.');
      const updated = factoryResponseSchema.parse({
        ...parsed,
        status: event.status,
        history: [
          {
            id: crypto.randomUUID().slice(0, 12),
            at: now,
            status: event.status,
            note,
          },
          ...parsed.history,
        ].slice(0, 60),
        updatedAt: now,
      });
      await db.put(storeName, updated);
      return updated;
    },

    async get(id) {
      const record = await db.get(storeName, id);
      return record ? factoryResponseSchema.parse(record) : undefined;
    },

    async list(projectId) {
      const all = projectId
        ? await db.getAllFromIndex(storeName, 'by-project-id', projectId)
        : await db.getAll(storeName);
      return all
        .map((item) => factoryResponseSchema.parse(item))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    async remove(id) {
      await db.delete(storeName, id);
    },

    close() {
      db.close();
    },
  };
}

export type SupplierComparisonSummary = {
  totalResponses: number;
  quotedCount: number;
  approvedCount: number;
  substitutionAlerts: number;
  missingPriceCount: number;
  missingLeadTimeCount: number;
  missingCertificationsCount: number;
  lowestQuotedByCurrency: Record<string, { supplierName: string; unitPrice: number }>;
};

export function summarizeSupplierQuotes(responses: readonly FactoryResponse[]): SupplierComparisonSummary {
  const lowestQuotedByCurrency: Record<string, { supplierName: string; unitPrice: number }> = {};
  let quotedCount = 0;
  let approvedCount = 0;
  let substitutionAlerts = 0;
  let missingPriceCount = 0;
  let missingLeadTimeCount = 0;
  let missingCertificationsCount = 0;

  for (const item of responses) {
    if (item.status === 'quoted' || item.status === 'sampling' || item.status === 'approved') {
      quotedCount += 1;
    }
    if (item.status === 'approved') approvedCount += 1;
    if (item.materialConfirmation === 'substitution_proposed') substitutionAlerts += 1;

    if (item.unitPrice !== undefined) {
      const curr = item.currency ?? 'USD';
      const existing = lowestQuotedByCurrency[curr];
      if (!existing || item.unitPrice < existing.unitPrice) {
        lowestQuotedByCurrency[curr] = { supplierName: item.supplierName, unitPrice: item.unitPrice };
      }
    } else {
      missingPriceCount += 1;
    }

    if (item.productionLeadDays === undefined) missingLeadTimeCount += 1;
    if (!item.certificationsConfirmed) missingCertificationsCount += 1;
  }

  return {
    totalResponses: responses.length,
    quotedCount,
    approvedCount,
    substitutionAlerts,
    missingPriceCount,
    missingLeadTimeCount,
    missingCertificationsCount,
    lowestQuotedByCurrency,
  };
}

export function exportSupplierJournalJson(
  responses: readonly FactoryResponse[],
  filterProjectId?: string,
): string {
  return JSON.stringify(
    {
      schema: 'light-forge-supplier-journal/v1',
      exportedAt: new Date().toISOString(),
      filterProjectId: filterProjectId ?? null,
      note: 'User-entered factory quotes and engineering responses. Missing commercial or certification fields remain explicitly absent until confirmed by the factory.',
      summary: summarizeSupplierQuotes(responses),
      responses,
    },
    null,
    2,
  );
}
