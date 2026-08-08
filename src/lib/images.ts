import { platform } from '../platform';
import type { ImageRef } from '../types';
import { clamp } from './util';

/**
 * Importing an image does three things: store the bytes content-addressed, measure the
 * image, and sample a dominant colour out of it.
 *
 * That sampled colour is the whole visual conceit of the app — every card and detail page
 * is lit by its own artwork. It's computed once at import and stored, so rendering never
 * has to touch a canvas.
 */

const MAX_DIMENSION = 1400; // covers never need to be bigger than this on screen

export async function importImageFile(file: File | Blob): Promise<ImageRef> {
  const bitmap = await createImageBitmap(file);
  try {
    const { blob, width, height, ext } = await downscale(bitmap, file);
    const tint = sampleTint(bitmap);
    const bytes = await blob.arrayBuffer();
    const saved = await platform.saveImage(bytes, ext);
    return { hash: saved.hash, file: saved.file, width, height, tint };
  } finally {
    bitmap.close();
  }
}

async function downscale(
  bitmap: ImageBitmap,
  original: File | Blob,
): Promise<{ blob: Blob; width: number; height: number; ext: string }> {
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  // Already small enough and already a format we can store as-is: keep the original bytes,
  // which preserves PNG transparency and avoids a needless re-encode.
  const type = original.type || 'image/jpeg';
  if (scale === 1 && (type === 'image/jpeg' || type === 'image/png' || type === 'image/webp')) {
    return { blob: original, width, height, ext: extFor(type) };
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get a 2D context to resize the image.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);

  const outType = type === 'image/png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, outType, 0.9),
  );
  if (!blob) throw new Error('Could not encode the resized image.');
  return { blob, width, height, ext: extFor(outType) };
}

function extFor(mime: string): string {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'jpg';
}

/**
 * Pick the colour the artwork "feels like".
 *
 * A plain average turns every image into the same muddy brown, so instead: downsample hard,
 * bucket pixels by hue, weight each pixel by how colourful and how mid-toned it is (near-black
 * and near-white pixels say nothing about a cover's character), then take the winning bucket.
 * The result is normalised into a range that always reads well against a near-black room.
 */
export function sampleTint(bitmap: ImageBitmap): string {
  const size = 48;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return '40 30% 60%';
  ctx.drawImage(bitmap, 0, 0, size, size);

  const { data } = ctx.getImageData(0, 0, size, size);
  const BUCKETS = 24;
  const weight = new Float64Array(BUCKETS);
  const satSum = new Float64Array(BUCKETS);
  const lightSum = new Float64Array(BUCKETS);

  let totalWeight = 0;
  let greyLightSum = 0;
  let greyCount = 0;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue; // ignore transparent padding
    const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);

    // Mid-tones carry the character; the extremes are just paper and ink.
    const tonal = 1 - Math.abs(l - 0.5) * 1.7;
    if (tonal <= 0) continue;

    if (s < 0.12) {
      greyLightSum += l;
      greyCount++;
      continue;
    }

    const w = s * s * tonal;
    const bucket = Math.min(BUCKETS - 1, Math.floor((h / 360) * BUCKETS));
    weight[bucket] += w;
    satSum[bucket] += s * w;
    lightSum[bucket] += l * w;
    totalWeight += w;
  }

  // A genuinely monochrome cover (a black-and-white photo, a plain typographic jacket)
  // should stay monochrome rather than being assigned a fictional hue.
  if (totalWeight < 0.6 && greyCount > 0) {
    const l = clamp((greyLightSum / greyCount) * 100, 42, 72);
    return `40 8% ${Math.round(l)}%`;
  }

  let best = 0;
  for (let b = 1; b < BUCKETS; b++) if (weight[b] > weight[best]) best = b;
  if (weight[best] <= 0) return '40 30% 60%';

  const hue = Math.round(((best + 0.5) / BUCKETS) * 360);
  const sat = clamp((satSum[best] / weight[best]) * 100, 32, 78);
  const light = clamp((lightSum[best] / weight[best]) * 100, 46, 70);

  return `${hue} ${Math.round(sat)}% ${Math.round(light)}%`;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h * 360, s, l];
}

/** Pull image files out of a drop event or a paste event. */
export function imagesFromDataTransfer(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const out: File[] = [];
  for (const item of Array.from(dt.files)) {
    if (item.type.startsWith('image/')) out.push(item);
  }
  if (out.length) return out;
  for (const item of Array.from(dt.items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const f = item.getAsFile();
      if (f) out.push(f);
    }
  }
  return out;
}
