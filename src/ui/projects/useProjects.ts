'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project } from '@/domain/project';
import { openProjectStore } from '@/storage/projects';

export function projectHref(project: Project) {
  return '/?rfqProject=' + encodeURIComponent(project.id);
}

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>();
  const [error, setError] = useState(false);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const store = await openProjectStore();
      try {
        const items = await store.list();
        if (request === sequence.current) {
          setProjects(items);
          setError(false);
        }
      } finally { store.close(); }
    } catch { if (request === sequence.current) setError(true); }
  }, []);

  useEffect(() => {
    void refresh();
    window.addEventListener('focus', refresh);
    return () => { sequence.current++; window.removeEventListener('focus', refresh); };
  }, [refresh]);
  return { projects, error, refresh };
}
