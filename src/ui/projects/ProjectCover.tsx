'use client';

import { useEffect, useRef, useState } from 'react';
import type { Project } from '@/domain/project';
import { openProjectStore } from '@/storage/projects';
import { LayersIcon } from '../icons';

export function ProjectCover({ project }: { project: Project }) {
  const element = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState('');
  const photo = project.primaryPhotoId ?? project.photos[0]?.id;
  useEffect(() => {
    if (!photo || !element.current) return;
    let active = true;
    let objectUrl = '';
    setUrl('');
    const load = async () => {
      const store = await openProjectStore();
      try {
        const blob = (await store.get(project.id))?.originals[photo];
        if (active && blob) {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        }
      } finally { store.close(); }
    };
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      void load().catch(() => undefined);
    });
    observer.observe(element.current);
    return () => {
      active = false;
      observer.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photo, project.id, project.updatedAt]);
  return <div ref={element} className="atelier-project-cover">
    {photo && url ? <img src={url} alt="" /> : <LayersIcon size={32} />}
  </div>;
}
