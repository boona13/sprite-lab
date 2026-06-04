import type { NormalizeAlign, NormalizeOptions, Pivot, SpriteFrame } from './types';

function clampInt(value: number, min: number): number {
  return Math.max(min, Math.round(Number.isFinite(value) ? value : min));
}

function copyFramePixels(
  source: SpriteFrame,
  targetWidth: number,
  targetHeight: number,
  offsetX: number,
  offsetY: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(targetWidth * targetHeight * 4);

  for (let y = 0; y < source.height; y++) {
    const targetY = y + offsetY;
    if (targetY < 0 || targetY >= targetHeight) continue;

    const srcStart = y * source.width * 4;
    const srcEnd = srcStart + source.width * 4;
    const dstStart = (targetY * targetWidth + offsetX) * 4;

    if (offsetX >= 0 && offsetX + source.width <= targetWidth) {
      out.set(source.image.data.subarray(srcStart, srcEnd), dstStart);
      continue;
    }

    for (let x = 0; x < source.width; x++) {
      const targetX = x + offsetX;
      if (targetX < 0 || targetX >= targetWidth) continue;
      const si = (y * source.width + x) * 4;
      const di = (targetY * targetWidth + targetX) * 4;
      out[di] = source.image.data[si];
      out[di + 1] = source.image.data[si + 1];
      out[di + 2] = source.image.data[si + 2];
      out[di + 3] = source.image.data[si + 3];
    }
  }

  return out;
}

function targetPivotForAlign(
  align: NormalizeAlign,
  width: number,
  height: number,
  padding: number,
): { x: number; y: number } {
  switch (align) {
    case 'top-left':
      return { x: padding, y: padding };
    case 'center':
      return { x: width / 2, y: height / 2 };
    case 'pivot':
    case 'bottom-center':
    default:
      return { x: width / 2, y: height - padding };
  }
}

function offsetForAlign(
  frame: SpriteFrame,
  align: NormalizeAlign,
  width: number,
  height: number,
  padding: number,
): { x: number; y: number } {
  switch (align) {
    case 'top-left':
      return { x: padding, y: padding };
    case 'center':
      return {
        x: Math.round((width - frame.width) / 2),
        y: Math.round((height - frame.height) / 2),
      };
    case 'pivot': {
      const target = targetPivotForAlign(align, width, height, padding);
      return {
        x: Math.round(target.x - frame.pivot.x * frame.width),
        y: Math.round(target.y - frame.pivot.y * frame.height),
      };
    }
    case 'bottom-center':
    default:
      return {
        x: Math.round((width - frame.width) / 2),
        y: Math.round(height - frame.height - padding),
      };
  }
}

function pivotAfterNormalize(
  frame: SpriteFrame,
  offsetX: number,
  offsetY: number,
  width: number,
  height: number,
  align: NormalizeAlign,
): Pivot {
  return {
    x: (offsetX + frame.pivot.x * frame.width) / width,
    y: (offsetY + frame.pivot.y * frame.height) / height,
    mode: align === 'pivot' ? frame.pivot.mode : align,
  };
}

export function getNormalizeSize(
  frames: SpriteFrame[],
  options: NormalizeOptions,
): { width: number; height: number } {
  const padding = clampInt(options.padding, 0);
  const maxWidth = frames.length ? Math.max(...frames.map((frame) => frame.width)) : 1;
  const maxHeight = frames.length ? Math.max(...frames.map((frame) => frame.height)) : 1;
  const fitWidth = maxWidth + padding * 2;
  const fitHeight = maxHeight + padding * 2;

  if (options.mode === 'custom-size') {
    return {
      width: Math.max(fitWidth, clampInt(options.width ?? fitWidth, fitWidth)),
      height: Math.max(fitHeight, clampInt(options.height ?? fitHeight, fitHeight)),
    };
  }

  return { width: fitWidth, height: fitHeight };
}

export function normalizeFrames(
  frames: SpriteFrame[],
  options: NormalizeOptions,
): SpriteFrame[] {
  const size = getNormalizeSize(frames, options);
  const padding = clampInt(options.padding, 0);

  return frames.map((frame) => {
    const offset = offsetForAlign(frame, options.align, size.width, size.height, padding);
    const data = copyFramePixels(frame, size.width, size.height, offset.x, offset.y);

    return {
      ...frame,
      image: { data, width: size.width, height: size.height },
      width: size.width,
      height: size.height,
      originalWidth: frame.originalWidth ?? frame.width,
      originalHeight: frame.originalHeight ?? frame.height,
      pivot: pivotAfterNormalize(frame, offset.x, offset.y, size.width, size.height, options.align),
      boxes: frame.boxes.map((box) => ({
        ...box,
        x: box.x + offset.x,
        y: box.y + offset.y,
      })),
    };
  });
}
