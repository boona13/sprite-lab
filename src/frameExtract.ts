import { loadImage } from './imageProcessor';
import { defringeImage } from './edgeCleanup';

export interface ExtractedFrame {
  id?: string;
  index?: number;
  dataUrl: string;
  x: number;
  y: number;
  sourceX?: number;
  sourceY?: number;
  width: number;
  height: number;
  trimmedWidth?: number;
  trimmedHeight?: number;
  originalWidth?: number;
  originalHeight?: number;
  pivot?: {
    x: number;
    y: number;
    mode: 'center' | 'bottom-center' | 'top-left' | 'custom';
  };
  boxes?: {
    id: string;
    type: 'collision' | 'hurtbox' | 'hitbox' | 'pickup';
    x: number;
    y: number;
    width: number;
    height: number;
  }[];
}

/** Raw sheet: transparent or strong magenta only — matches Echo Jump `extractMagentaSections`. */
function isRawBackground(r: number, g: number, b: number, a: number, alphaThreshold: number): boolean {
  if (a < alphaThreshold) return true;
  if (r > 195 && g < 110 && b > 195) return true;
  const magentaCast = Math.max(0, Math.min(r, b) - g);
  if (magentaCast > 80) return true;
  return false;
}

function dilateMask(mask: Uint8Array, w: number, h: number, radius = 1): Uint8Array {
  const out = new Uint8Array(mask);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) out[ny * w + nx] = 1;
        }
      }
    }
  }
  return out;
}

function findComponents(
  mask: Uint8Array,
  w: number,
  h: number,
  minArea: number,
): { minX: number; minY: number; maxX: number; maxY: number }[] {
  const total = w * h;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  const boxes: { minX: number; minY: number; maxX: number; maxY: number }[] = [];

  for (let start = 0; start < total; start++) {
    if (!mask[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    let minX = w;
    let minY = h;
    let maxX = -1;
    let maxY = -1;
    let area = 0;

    while (head < tail) {
      const p = queue[head++];
      const x = p % w;
      const y = (p / w) | 0;
      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      const neigh = [p - 1, p + 1, p - w, p + w];
      const ok = [x > 0, x < w - 1, y > 0, y < h - 1];
      for (let n = 0; n < 4; n++) {
        const q = neigh[n];
        if (!ok[n] || q < 0 || q >= total) continue;
        if (mask[q] && !visited[q]) {
          visited[q] = 1;
          queue[tail++] = q;
        }
      }
    }

    if (area >= minArea) boxes.push({ minX, minY, maxX, maxY });
  }

  return boxes;
}

function sortBoxes(boxes: { minX: number; minY: number; maxX: number; maxY: number }[], h: number) {
  const rowTol = Math.max(24, Math.round(h * 0.04));
  boxes.sort((a, b) =>
    Math.abs(a.minY - b.minY) <= rowTol ? a.minX - b.minX : a.minY - b.minY,
  );
}

function cropFrames(
  source: HTMLCanvasElement,
  boxes: { minX: number; minY: number; maxX: number; maxY: number }[],
  w: number,
  h: number,
  pad: number,
): ExtractedFrame[] {
  return boxes.map((bx) => {
    const x = Math.max(0, bx.minX - pad);
    const y = Math.max(0, bx.minY - pad);
    const right = Math.min(w - 1, bx.maxX + pad);
    const bottom = Math.min(h - 1, bx.maxY + pad);
    const cw = Math.max(1, right - x + 1);
    const ch = Math.max(1, bottom - y + 1);
    const out = document.createElement('canvas');
    out.width = cw;
    out.height = ch;
    const octx = out.getContext('2d');
    if (octx) octx.drawImage(source, x, y, cw, ch, 0, 0, cw, ch);
    return { dataUrl: out.toDataURL('image/png'), x, y, width: cw, height: ch };
  });
}

/**
 * Extract frames from an already-keyed transparent PNG.
 * Uses alpha only — never re-classifies white/grey sprite pixels as background.
 */
export async function extractFramesFromAlpha(
  imageDataUrl: string,
  opts: { minAreaFrac?: number; pad?: number; alphaThreshold?: number } = {},
): Promise<ExtractedFrame[]> {
  const { minAreaFrac = 0.0008, pad = 4, alphaThreshold = 32 } = opts;

  const img = await loadImage(imageDataUrl);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const total = w * h;

  const mask = new Uint8Array(total);
  for (let p = 0; p < total; p++) {
    if (data[p * 4 + 3] >= alphaThreshold) mask[p] = 1;
  }

  const merged = dilateMask(mask, w, h, 1);
  const minArea = Math.max(96, Math.round(total * minAreaFrac));
  const boxes = findComponents(merged, w, h, minArea);
  sortBoxes(boxes, h);
  const frames = cropFrames(canvas, boxes, w, h, pad);
  return Promise.all(frames.map(async (f) => ({ ...f, dataUrl: await defringeImage(f.dataUrl, 2) })));
}

/**
 * Extract frames from a raw sheet (magenta backdrop).
 * Matches Echo Jump UI Kit `extractMagentaSections` — keyed + defringed + CC.
 */
export async function extractFramesFromSheet(
  imageDataUrl: string,
  opts: { minAreaFrac?: number; pad?: number; alphaThreshold?: number } = {},
): Promise<ExtractedFrame[]> {
  const { minAreaFrac = 0.0008, pad = 4, alphaThreshold = 40 } = opts;

  const img = await loadImage(imageDataUrl);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');
  ctx.drawImage(img, 0, 0, w, h);
  const image = ctx.getImageData(0, 0, w, h);
  const data = image.data;
  const total = w * h;

  const keyed = document.createElement('canvas');
  keyed.width = w;
  keyed.height = h;
  const kctx = keyed.getContext('2d');
  if (!kctx) throw new Error('Failed to get keyed canvas context');
  const keyedImage = kctx.createImageData(w, h);
  const kd = keyedImage.data;
  const mask = new Uint8Array(total);

  for (let p = 0; p < total; p++) {
    const i = p * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    let a = data[i + 3];

    if (isRawBackground(r, g, b, a, alphaThreshold)) {
      kd[i + 3] = 0;
      continue;
    }

    mask[p] = 1;
    let rr = r;
    let bb = b;
    const cast = Math.min(rr, bb) - g;
    if (cast > 18) {
      const limit = g + 18;
      if (rr > limit) rr = limit;
      if (bb > limit) bb = limit;
      if (cast > 70) a = Math.round(a * Math.max(0, 1 - (cast - 70) / 90));
    }
    kd[i] = rr;
    kd[i + 1] = g;
    kd[i + 2] = bb;
    kd[i + 3] = a;
    if (a < alphaThreshold) mask[p] = 0;
  }
  kctx.putImageData(keyedImage, 0, 0);

  const merged = dilateMask(mask, w, h, 1);
  const minArea = Math.max(96, Math.round(total * minAreaFrac));
  const boxes = findComponents(merged, w, h, minArea);
  sortBoxes(boxes, h);
  const frames = cropFrames(keyed, boxes, w, h, pad);
  return Promise.all(frames.map(async (f) => ({ ...f, dataUrl: await defringeImage(f.dataUrl, 2) })));
}

export function formatFrameDetection(count: number): string {
  if (count === 0) return 'No frames found';
  if (count === 1) return '1 frame detected';
  return `${count} frames detected`;
}
