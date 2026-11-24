import type { Metadata } from 'next';
import { DocumentsWorkspace } from '@/ui/documents/DocumentsWorkspace';

export const metadata: Metadata = {
  title: 'Документы и Detailed RFQ — LIGHT FORGE',
  description:
    'Выпуск двуязычных PDF (EN / 中文), пакет Detailed RFQ с BOM и чек-листом подтверждений, история версий документов.',
};

export default function DocumentsPage() {
  return <DocumentsWorkspace />;
}
