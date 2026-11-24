'use client';

import { maxLocalPhotoBytes } from '@/visual-search/local-contract';
import type { CropRect, RotationDeg } from './helpers';

async function encodeCanvasJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      value => (value ? resolve(value) : reject(new Error('Не удалось создать копию изображения.'))),
      'image/jpeg',
      quality,
    ),
  );
}

function drawOrientedCanvas(
  bitmap: ImageBitmap,
  rotation: RotationDeg,
  maxPreviewEdge?: number,
): HTMLCanvasElement {
  const swapped = rotation === 90 || rotation === 270;
  const orientedW = swapped ? bitmap.height : bitmap.width;
  const orientedH = swapped ? bitmap.width : bitmap.height;
  const scale = maxPreviewEdge ? Math.min(1, maxPreviewEdge / Math.max(orientedW, orientedH)) : 1;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(orientedW * scale));
  canvas.height = Math.max(1, Math.round(orientedH * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Не удалось подготовить холст для изображения.');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const drawW = Math.max(1, Math.round(bitmap.width * scale));
  const drawH = Math.max(1, Math.round(bitmap.height * scale));

  ctx.save();
  if (rotation === 90) {
    ctx.translate(canvas.width, 0);
    ctx.rotate(Math.PI / 2);
  } else if (rotation === 180) {
    ctx.translate(canvas.width, canvas.height);
    ctx.rotate(Math.PI);
  } else if (rotation === 270) {
    ctx.translate(0, canvas.height);
    ctx.rotate(-Math.PI / 2);
  }
  ctx.drawImage(bitmap, 0, 0, drawW, drawH);
  ctx.restore();

  return canvas;
}

/**
 * Renders a transient rotated preview Blob from the untouched original File.
 * Original File bytes are never modified.
 */
export async function renderRotatedPreviewBlob(file: File, rotation: RotationDeg): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = drawOrientedCanvas(bitmap, rotation, 1440);
    return await encodeCanvasJpeg(canvas, 0.9);
  } finally {
    bitmap.close();
  }
}

/**
 * Produces a rotated + cropped working JPEG copy (max 1280 px, <= 5 MiB)
 * for local visual search, Google Lens download, or consented Gemini requests.
 * The original uploaded File stays untouched.
 */
export async function createWorkingPhotoCopy(
  file: File,
  crop: CropRect,
  rotation: RotationDeg = 0,
  maxEdgePx = 1280,
): Promise<File> {
  const bitmap = await createImageBitmap(file);
  try {
    const oriented = drawOrientedCanvas(bitmap, rotation);
    const sx = Math.round((oriented.width * crop.x) / 100);
    const sy = Math.round((oriented.height * crop.y) / 100);
    const sw = Math.max(
      1,
      Math.min(oriented.width - sx, Math.round((oriented.width * crop.width) / 100)),
    );
    const sh = Math.max(
      1,
      Math.min(oriented.height - sy, Math.round((oriented.height * crop.height) / 100)),
    );
    const scale = Math.min(1, maxEdgePx / Math.max(sw, sh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Не удалось обработать выделенную область.');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(oriented, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

    let blob = await encodeCanvasJpeg(canvas, 0.86);
    if (blob.size > maxLocalPhotoBytes) {
      blob = await encodeCanvasJpeg(canvas, 0.72);
    }
    return new File([blob], 'light-forge-search.jpg', { type: 'image/jpeg' });
  } finally {
    bitmap.close();
  }
}
