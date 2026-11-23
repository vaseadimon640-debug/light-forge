import type { Metadata } from 'next';
import { GeometryWorkspace } from '@/ui/geometry/GeometryWorkspace';

export const metadata: Metadata = {
  title: '3D-конструктор',
  description: 'Параметрическая геометрия светильников, монтажные уровни, тросы и ремни.',
};

export default function GeometryPage() {
  return <GeometryWorkspace />;
}
