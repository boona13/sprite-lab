import { defringeInPlace } from '../edgeCleanup';
import type { ExtractedFrame, RgbaImage } from './types';
import { cloneRgba } from './chromaKey';

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

function frameId(index: number): string {
  return `frame_${String(index + 1).padStart(3, '0')}`;
}

function cropRgba(
  source: RgbaImage,
  boxes: { minX: number; minY: number; maxX: number; maxY: number }[],
  pad: number,
): ExtractedFrame[] {
  const { width: w, height: h } = source;
  return boxes.map((bx, index) => {
    const x = Math.max(0, bx.minX - pad);
    const y = Math.max(0, bx.minY - pad);
    const right = Math.min(w - 1, bx.maxX + pad);
    const bottom = Math.min(h - 1, bx.maxY + pad);
    const cw = Math.max(1, right - x + 1);
    const ch = Math.max(1, bottom - y + 1);
    const data = new Uint8ClampedArray(cw * ch * 4);

    for (let row = 0; row < ch; row++) {
      const sy = y + row;
      const srcStart = (sy * w + x) * 4;
      const dstStart = row * cw * 4;
      data.set(source.data.subarray(srcStart, srcStart + cw * 4), dstStart);
    }

    const frame: RgbaImage = { data, width: cw, height: ch };
    defringeInPlace(frame.data, cw, ch, 2);
    return {
      id: frameId(index),
      index,
      image: frame,
      x,
      y,
      sourceX: x,
      sourceY: y,
      width: cw,
      height: ch,
      trimmedWidth: cw,
      trimmedHeight: ch,
      originalWidth: cw,
      originalHeight: ch,
      pivot: { x: 0.5, y: 1, mode: 'bottom-center' },
      boxes: [],
    };
  });
}

export interface FrameExtractOptions {
  minAreaFrac?: number;
  pad?: number;
  alphaThreshold?: number;
}

export function extractFramesFromAlphaRgba(
  source: RgbaImage,
  opts: FrameExtractOptions = {},
): ExtractedFrame[] {
  const { minAreaFrac = 0.0008, pad = 4, alphaThreshold = 32 } = opts;
  const { data, width: w, height: h } = source;
  const total = w * h;

  const mask = new Uint8Array(total);
  for (let p = 0; p < total; p++) {
    if (data[p * 4 + 3] >= alphaThreshold) mask[p] = 1;
  }

  const merged = dilateMask(mask, w, h, 1);
  const minArea = Math.max(96, Math.round(total * minAreaFrac));
  const boxes = findComponents(merged, w, h, minArea);
  sortBoxes(boxes, h);
  return cropRgba(source, boxes, pad);
}

export function extractFramesFromRawRgba(
  source: RgbaImage,
  opts: FrameExtractOptions = {},
): ExtractedFrame[] {
  const { minAreaFrac = 0.0008, pad = 4, alphaThreshold = 40 } = opts;
  const { data, width: w, height: h } = source;
  const total = w * h;

  const keyed = cloneRgba(source);
  const kd = keyed.data;
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

  const merged = dilateMask(mask, w, h, 1);
  const minArea = Math.max(96, Math.round(total * minAreaFrac));
  const boxes = findComponents(merged, w, h, minArea);
  sortBoxes(boxes, h);
  return cropRgba(keyed, boxes, pad);
}

export function extractFramesSmart(keyed: RgbaImage, raw: RgbaImage): ExtractedFrame[] {
  let frames = extractFramesFromAlphaRgba(keyed);
  if (frames.length === 0) {
    frames = extractFramesFromRawRgba(raw);
  }
  return frames;
}

export function formatFrameDetection(count: number): string {
  if (count === 0) return 'No frames found';
  if (count === 1) return '1 frame detected';
  return `${count} frames detected`;
}
