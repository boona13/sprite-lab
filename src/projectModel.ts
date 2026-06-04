import type {
  ExportSettings,
  ExtractedFrame,
  Pivot,
  PivotMode,
  SpriteAnimation,
  SpriteFrame,
  SpriteProject,
} from './core/types';

export function createPivot(mode: PivotMode = 'bottom-center'): Pivot {
  switch (mode) {
    case 'center':
      return { x: 0.5, y: 0.5, mode };
    case 'top-left':
      return { x: 0, y: 0, mode };
    case 'custom':
      return { x: 0.5, y: 1, mode };
    case 'bottom-center':
    default:
      return { x: 0.5, y: 1, mode: 'bottom-center' };
  }
}

export function createFrameId(index: number): string {
  return `frame_${String(index + 1).padStart(3, '0')}`;
}

export function enrichExtractedFrame(frame: ExtractedFrame, index: number): SpriteFrame {
  return {
    id: frame.id || createFrameId(index),
    index,
    image: frame.image,
    sourceX: frame.sourceX ?? frame.x,
    sourceY: frame.sourceY ?? frame.y,
    width: frame.width,
    height: frame.height,
    trimmedWidth: frame.trimmedWidth ?? frame.width,
    trimmedHeight: frame.trimmedHeight ?? frame.height,
    originalWidth: frame.originalWidth,
    originalHeight: frame.originalHeight,
    pivot: frame.pivot || createPivot(),
    boxes: frame.boxes ? [...frame.boxes] : [],
  };
}

export function createDefaultAnimation(frames: SpriteFrame[], fps = 12): SpriteAnimation {
  return {
    id: 'anim_default',
    name: 'default',
    frameIds: frames.map((frame) => frame.id),
    fps,
    loop: true,
  };
}

export function createDefaultExportSettings(fps = 12): ExportSettings {
  return {
    target: 'generic-json',
    fps,
    loop: true,
  };
}

export function createSpriteProject(name: string, frames: SpriteFrame[], fps = 12): SpriteProject {
  return {
    version: 1,
    name,
    frames,
    animations: frames.length ? [createDefaultAnimation(frames, fps)] : [],
    exportSettings: createDefaultExportSettings(fps),
  };
}
