import { runSpritesheetPipeline, removalNote } from './core/pipeline';
import { formatFrameDetection } from './core/frameExtract';
import { analyzeBackgroundFromRgba } from './core/analyzeBackground';
import { normalizeFrames } from './core/normalizeFrames';
import type { CoreRemovalEngine, BackgroundAnalysis, NormalizeOptions, SpriteFrame } from './core/types';
import { dataUrlToRgba, rgbaToDataUrl } from './rgbaAdapter';

export type { BackgroundAnalysis, CoreRemovalEngine };
export { removalNote, formatFrameDetection };

export type ProgressFn = (message: string, percent: number) => void;

export interface BrowserPipelineOptions {
  engine?: CoreRemovalEngine;
  onProgress?: ProgressFn;
}

export interface BrowserFrame {
  id: string;
  index: number;
  dataUrl: string;
  x: number;
  y: number;
  sourceX: number;
  sourceY: number;
  width: number;
  height: number;
  trimmedWidth: number;
  trimmedHeight: number;
  originalWidth?: number;
  originalHeight?: number;
  pivot: {
    x: number;
    y: number;
    mode: 'center' | 'bottom-center' | 'top-left' | 'custom';
  };
  boxes: {
    id: string;
    type: 'collision' | 'hurtbox' | 'hitbox' | 'pickup';
    x: number;
    y: number;
    width: number;
    height: number;
  }[];
}

export interface BrowserPipelineResult {
  keyed: string;
  frames: BrowserFrame[];
  analysis: BackgroundAnalysis;
  applied: BackgroundAnalysis;
}

/**
 * Spritesheet pipeline for the Slice tab — 100% local pixel processing.
 * Auto routes by detected backdrop; Fast uses color rules only.
 */
export async function runSpritesheetPipelineBrowser(
  dataUrl: string,
  opts: Pick<BrowserPipelineOptions, 'engine'> = {},
): Promise<BrowserPipelineResult> {
  const engine: CoreRemovalEngine = opts.engine === 'fast' ? 'fast' : 'auto';

  const source = await dataUrlToRgba(dataUrl);
  const result = runSpritesheetPipeline(source, { engine, frames: true });

  return {
    keyed: rgbaToDataUrl(result.keyed),
    frames: result.frames.map((f) => ({
      id: f.id,
      index: f.index,
      dataUrl: rgbaToDataUrl(f.image),
      x: f.x,
      y: f.y,
      sourceX: f.sourceX,
      sourceY: f.sourceY,
      width: f.width,
      height: f.height,
      trimmedWidth: f.trimmedWidth,
      trimmedHeight: f.trimmedHeight,
      originalWidth: f.originalWidth,
      originalHeight: f.originalHeight,
      pivot: f.pivot,
      boxes: f.boxes,
    })),
    analysis: result.analysis,
    applied: result.analysis,
  };
}

/** Single-image background removal for the Remove tab — local pixel pipeline. */
export async function removeBackgroundSmartBrowser(
  dataUrl: string,
  opts: BrowserPipelineOptions = {},
): Promise<{ result: string; applied: BackgroundAnalysis }> {
  const engine: CoreRemovalEngine = opts.engine === 'fast' ? 'fast' : 'auto';
  const source = await dataUrlToRgba(dataUrl);
  const analysis = analyzeBackgroundFromRgba(source);

  if (analysis.kind === 'transparent') {
    return { result: dataUrl, applied: analysis };
  }

  const { keyed } = runSpritesheetPipeline(source, { engine, frames: false });
  return { result: rgbaToDataUrl(keyed), applied: analysis };
}

export async function normalizeBrowserFrames(
  frames: BrowserFrame[],
  options: NormalizeOptions,
): Promise<BrowserFrame[]> {
  const spriteFrames: SpriteFrame[] = await Promise.all(
    frames.map(async (frame, index) => ({
      id: frame.id,
      index: frame.index ?? index,
      image: await dataUrlToRgba(frame.dataUrl),
      sourceX: frame.sourceX ?? frame.x,
      sourceY: frame.sourceY ?? frame.y,
      width: frame.width,
      height: frame.height,
      trimmedWidth: frame.trimmedWidth ?? frame.width,
      trimmedHeight: frame.trimmedHeight ?? frame.height,
      originalWidth: frame.originalWidth,
      originalHeight: frame.originalHeight,
      pivot: frame.pivot,
      boxes: frame.boxes,
    })),
  );

  return normalizeFrames(spriteFrames, options).map((frame) => ({
    id: frame.id,
    index: frame.index,
    dataUrl: rgbaToDataUrl(frame.image),
    x: frame.sourceX,
    y: frame.sourceY,
    sourceX: frame.sourceX,
    sourceY: frame.sourceY,
    width: frame.width,
    height: frame.height,
    trimmedWidth: frame.trimmedWidth,
    trimmedHeight: frame.trimmedHeight,
    originalWidth: frame.originalWidth,
    originalHeight: frame.originalHeight,
    pivot: frame.pivot,
    boxes: frame.boxes,
  }));
}
