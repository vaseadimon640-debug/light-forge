import type { Metadata } from 'next';
import { VisualSearch } from '@/ui/visual-search/VisualSearch';
import '@/ui/visual-search/search.css';

export const metadata: Metadata = { title: 'AI Search — Поиск светильника' };

export default function SearchPage() {
  return <VisualSearch />;
}
