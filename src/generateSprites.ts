export interface SpritePreset {
  id: string;
  label: string;
  description: string;
  prompt: string;
  aspectRatio: string;
  imageSize: string;
}

export interface GenerateOptions {
  prompt: string;
  presetId: string;
  model: string;
  aspectRatio: string;
  imageSize: string;
  negativeHint: string;
}

export interface GenerateResult {
  imageUrl: string;
  model: string;
  prompt: string;
  content?: string;
}

export interface GenerateMetadata {
  models: string[];
  aspectRatios: string[];
  imageSizes: string[];
}

async function readJSON<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as { error?: unknown };
  if (!response.ok) {
    const message = typeof data.error === 'string' ? data.error : 'Request failed';
    throw new Error(message);
  }
  return data as T;
}

export async function fetchSpritePresets(): Promise<SpritePreset[]> {
  const data = await readJSON<{ presets: SpritePreset[] }>(await fetch('/api/generate/presets'));
  return data.presets;
}

export async function fetchGenerateMetadata(): Promise<GenerateMetadata> {
  return readJSON<GenerateMetadata>(await fetch('/api/generate/models'));
}

export async function generateSprite(options: GenerateOptions): Promise<GenerateResult> {
  return readJSON<GenerateResult>(
    await fetch('/api/generate-sprite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    }),
  );
}
