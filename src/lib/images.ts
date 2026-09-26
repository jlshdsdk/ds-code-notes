import { getImage, putImage } from './db';

const MAX_DIM = 1600;
const MAX_BYTES = 1024 * 1024;

const urlCache = new Map<string, string>();

export async function resolveImageUrl(imgId: string): Promise<string | null> {
  const hit = urlCache.get(imgId);
  if (hit) return hit;
  const row = await getImage(imgId);
  if (!row) return null;
  const url = URL.createObjectURL(row.blob);
  urlCache.set(imgId, url);
  return url;
}

export function revokeImageUrl(imgId: string): void {
  const url = urlCache.get(imgId);
  if (url) {
    URL.revokeObjectURL(url);
    urlCache.delete(imgId);
  }
}

/** 客户端压缩：最长边 1600px，JPEG 循环降质直到 ≤1MB；小 PNG/动图原样保留 */
export async function compressImage(file: File): Promise<Blob> {
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return file;
  if (file.type === 'image/png' && file.size < 300 * 1024) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  let { width, height } = bitmap;
  const longest = Math.max(width, height);
  if (longest > MAX_DIM) {
    const k = MAX_DIM / longest;
    width = Math.max(1, Math.round(width * k));
    height = Math.max(1, Math.round(height * k));
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const encode = (q: number) =>
    new Promise<Blob>((res, rej) =>
      canvas.toBlob(b => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/jpeg', q)
    );
  let quality = 0.85;
  let blob = await encode(quality);
  while (blob.size > MAX_BYTES && quality > 0.4) {
    quality -= 0.15;
    blob = await encode(quality);
  }
  return blob.size < file.size ? blob : file;
}

/** 存图并返回 imgId（笔记 HTML 里通过 data-img-id 引用） */
export async function storeImageFile(file: File, docId: string): Promise<string> {
  const blob = await compressImage(file);
  const id = crypto.randomUUID();
  await putImage({ id, docId, blob, updatedAt: Date.now() });
  return id;
}
