import { imageSize } from 'image-size';
import type { Photo } from '../domain/project.ts';

export const maxPhotoPixels = 60_000_000;
export const maxTotalPhotoPixels = 120_000_000;
const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;

export class InvalidPhoto extends Error {}

export type OriginalPhoto = {
  metadata: Photo;
  bytes: Uint8Array;
  widthPx: number;
  heightPx: number;
};

export async function readProjectPhotos(form: FormData, metadataList: Photo[]): Promise<OriginalPhoto[]> {
  const expected = new Set(metadataList.map(photo => `photo:${photo.id}`));
  for (const key of form.keys()) {
    if (key !== 'input' && !expected.has(key))
      throw new InvalidPhoto('The upload contains a file outside the supplied photo list.');
  }
  const photos: OriginalPhoto[] = [];
  let pixels = 0;
  for (const metadata of metadataList) {
    const [image, duplicate] = form.getAll(`photo:${metadata.id}`);
    if (!image || duplicate !== undefined || typeof image === 'string' || image.type !== metadata.type || image.size !== metadata.size)
      throw new InvalidPhoto(`Provide the original photo matching metadata for ${metadata.name}.`);
    const bytes = new Uint8Array(await image.arrayBuffer());
    let info: ReturnType<typeof imageSize>;
    try { info = imageSize(bytes); } catch { throw new InvalidPhoto(`Invalid image data for ${metadata.name}.`); }
    const { width, height, type } = info;
    if (type !== extensions[metadata.type] || !width || !height || width * height > maxPhotoPixels)
      throw new InvalidPhoto(`Unsupported image type or pixel count for ${metadata.name}.`);
    pixels += width * height;
    if (pixels > maxTotalPhotoPixels) throw new InvalidPhoto('The combined photo pixel count exceeds 120 megapixels.');
    photos.push({ metadata, bytes, widthPx: width, heightPx: height });
  }
  return photos;
}
