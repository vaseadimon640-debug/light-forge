import type { Metadata } from 'next';
import { QuickRfqWorkspace } from '@/ui/quick-rfq/QuickRfqWorkspace';

export const metadata: Metadata = { title: 'Конфигуратор светильника' };

export default function ConfigurePage() {
  return <QuickRfqWorkspace guided />;
}
