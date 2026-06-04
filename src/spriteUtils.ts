import JSZip from 'jszip';
import { loadImage } from './imageProcessor';
import type { ExtractedFrame } from './frameExtract';

export async function composeVariableStrip(frames: ExtractedFrame[]): Promise<string> {
  if (frames.length === 0) throw new Error('No frames to compose');
  const maxH = Math.max(...frames.map((f) => f.height));
  const totalW = frames.reduce((s, f) => s + f.width, 0);
  const canvas = document.createElement('canvas');
  canvas.width = totalW;
  canvas.height = maxH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');

  let x = 0;
  for (const frame of frames) {
    const img = await loadImage(frame.dataUrl);
    const y = Math.round((maxH - frame.height) / 2);
    ctx.drawImage(img, x, y);
    x += frame.width;
  }
  return canvas.toDataURL('image/png');
}

export function buildFrameManifest(frames: ExtractedFrame[], fps = 12) {
  const maxH = frames.length ? Math.max(...frames.map((f) => f.height)) : 0;
  const stripW = frames.reduce((s, f) => s + f.width, 0);
  let stripX = 0;

  return {
    version: 2,
    name: 'spritesheet',
    image: 'strip.png',
    frameCount: frames.length,
    fps,
    loop: true,
    strip: {
      fileName: 'strip.png',
      sheetWidth: stripW,
      sheetHeight: maxH,
    },
    animations: {
      default: {
        frames: frames.map((f, index) => f.id ?? `frame_${String(index + 1).padStart(3, '0')}`),
        fps,
        loop: true,
      },
    },
    frames: frames.map((f, index) => {
      const id = f.id ?? `frame_${String(index + 1).padStart(3, '0')}`;
      const sourceX = f.sourceX ?? f.x;
      const sourceY = f.sourceY ?? f.y;
      const pivot = f.pivot ?? { x: 0.5, y: 1, mode: 'bottom-center' as const };
      const entry = {
        id,
        index,
        fileName: `frame_${String(index + 1).padStart(2, '0')}.png`,
        width: f.width,
        height: f.height,
        trimmedWidth: f.trimmedWidth ?? f.width,
        trimmedHeight: f.trimmedHeight ?? f.height,
        originalWidth: f.originalWidth ?? f.width,
        originalHeight: f.originalHeight ?? f.height,
        sourceX,
        sourceY,
        stripX,
        pivot: {
          ...pivot,
          pixelX: Math.round(pivot.x * f.width),
          pixelY: Math.round(pivot.y * f.height),
        },
        boxes: f.boxes ?? [],
      };
      stripX += f.width;
      return entry;
    }),
    meta: {
      app: 'Sprite Lab',
      format: 'generic-json',
    },
  };
}

export async function downloadFramesZip(
  allFrames: ExtractedFrame[],
  activeIndices: number[],
  baseName: string,
) {
  const zip = new JSZip();
  const active = activeIndices.map((i) => allFrames[i]);

  activeIndices.forEach((srcIdx, outIdx) => {
    const base64 = allFrames[srcIdx].dataUrl.split(',')[1];
    zip.file(`frame_${String(outIdx + 1).padStart(2, '0')}.png`, base64, { base64: true });
  });

  const strip = await composeVariableStrip(active);
  zip.file('strip.png', strip.split(',')[1], { base64: true });

  zip.file('manifest.json', JSON.stringify(buildFrameManifest(active), null, 2));

  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${baseName}-sprites.zip`;
  a.click();
  URL.revokeObjectURL(url);
}

export function removalStrengthToThreshold(strength: number): number {
  return Math.round(120 - strength * 0.8);
}

export function removalStrengthToSoftness(strength: number): number {
  return Math.round(20 + strength * 0.3);
}
