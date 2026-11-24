import type { Metadata } from 'next';
import { VisualSearch } from '@/ui/visual-search/VisualSearch';
import '@/ui/visual-search/search.css';

export const metadata: Metadata = {
  title: 'Поиск светильника по фото',
  description:
    'Поиск оригинальных светильников, визуальных аналогов и официальной технической документации по фотографиям с переходом в Quick RFQ.',
};

export default function SearchPage() {
  return <VisualSearch />;
}
