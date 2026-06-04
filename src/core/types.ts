export interface RgbaImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export type PivotMode = 'center' | 'bottom-center' | 'top-left' | 'custom';

export interface Pivot {
  /** Normalized local X coordinate, from 0 to 1. */
  x: number;
  /** Normalized local Y coordinate, from 0 to 1. */
  y: number;
  mode: PivotMode;
}

export type FrameBoxType = 'collision' | 'hurtbox' | 'hitbox' | 'pickup';

export interface FrameBox {
  id: string;
  type: FrameBoxType;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SpriteFrame {
  id: string;
  index: number;
  image: RgbaImage;
  sourceX: number;
  sourceY: number;
  width: number;
  height: number;
  trimmedWidth: number;
  trimmedHeight: number;
  originalWidth?: number;
  originalHeight?: number;
  pivot: Pivot;
  boxes: FrameBox[];
}

export interface ExtractedFrame extends SpriteFrame {
  /** Legacy aliases kept while the browser UI migrates to SpriteFrame. */
  x: number;
  y: number;
}

export interface SpriteAnimation {
  id: string;
  name: string;
  frameIds: string[];
  fps: number;
  loop: boolean;
}

export type ExportTarget =
  | 'generic-json'
  | 'phaser'
  | 'pixi'
  | 'godot'
  | 'unity'
  | 'aseprite';

export interface ExportSettings {
  target: ExportTarget;
  fps: number;
  loop: boolean;
}

export interface SpriteProject {
  version: 1;
  name: string;
  frames: SpriteFrame[];
  animations: SpriteAnimation[];
  exportSettings: ExportSettings;
}

export type NormalizeMode = 'max-size' | 'custom-size';
export type NormalizeAlign = 'center' | 'bottom-center' | 'top-left' | 'pivot';

export interface NormalizeOptions {
  mode: NormalizeMode;
  width?: number;
  height?: number;
  align: NormalizeAlign;
  padding: number;
}

export type BackgroundKind =
  | 'transparent'
  | 'magenta'
  | 'green'
  | 'checkerboard'
  | 'solid'
  | 'none';

export interface BackgroundAnalysis {
  kind: BackgroundKind;
  label: string;
}

/** Non-AI engines — safe for full spritesheets in CLI and browser. */
export type CoreRemovalEngine = 'auto' | 'fast';

export interface PipelineOptions {
  engine?: CoreRemovalEngine;
  /** Skip frame extraction (background remove only). */
  frames?: boolean;
}

export interface PipelineResult {
  analysis: BackgroundAnalysis;
  keyed: RgbaImage;
  frames: ExtractedFrame[];
  opaqueFraction: number;
}
