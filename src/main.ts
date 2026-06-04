import './style.css';
import {
  fileToDataUrl,
  getImageDimensions,
  downloadDataUrl,
  formatBytes,
} from './imageProcessor';
import { downloadFramesZip } from './spriteUtils';
import { removeBackgroundSmart } from './backgroundDetect';
import {
  fetchGenerateMetadata,
  fetchSpritePresets,
  generateSprite,
  type SpritePreset,
} from './generateSprites';
import {
  runSpritesheetPipelineBrowser,
  formatFrameDetection,
  normalizeBrowserFrames,
  type BrowserFrame,
} from './pipelineBrowser';
import type { NormalizeAlign, NormalizeMode } from './core/types';

type Tab = 'remove' | 'slice' | 'generate';

// ── Tabs ──
const tabs = document.querySelectorAll<HTMLButtonElement>('.tab');
const panelRemove = document.getElementById('panel-remove')!;
const panelSlice = document.getElementById('panel-slice')!;
const panelGenerate = document.getElementById('panel-generate')!;

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const id = tab.dataset.tab as Tab;
    tabs.forEach((t) => {
      t.classList.toggle('active', t === tab);
      t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
    });
    panelRemove.classList.toggle('hidden', id !== 'remove');
    panelSlice.classList.toggle('hidden', id !== 'slice');
    panelGenerate.classList.toggle('hidden', id !== 'generate');
  });
});

function setupDropzone(zone: HTMLElement, input: HTMLInputElement, onFile: (f: File) => void) {
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      input.click();
    }
  });
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (f) onFile(f);
  });
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('dragover');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    const f = e.dataTransfer?.files[0];
    if (f) onFile(f);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// BACKGROUND REMOVE
// ═══════════════════════════════════════════════════════════════════════════

const removeDropzone = document.getElementById('remove-dropzone')!;
const removeFileInput = document.getElementById('remove-file') as HTMLInputElement;
const removeFileChip = document.getElementById('remove-file-chip')!;
const removeProgress = document.getElementById('remove-progress')!;
const removeRun = document.getElementById('remove-run') as HTMLButtonElement;
const removeDownload = document.getElementById('remove-download') as HTMLButtonElement;
const removeBefore = document.getElementById('remove-before') as HTMLImageElement;
const removeAfter = document.getElementById('remove-after') as HTMLImageElement;
const removeBeforeEmpty = document.getElementById('remove-before-empty')!;
const removeAfterEmpty = document.getElementById('remove-after-empty')!;

let removeSourceUrl: string | null = null;
let removeResultUrl: string | null = null;
let removeFileName = 'image.png';

function setProgress(el: HTMLElement, message: string, show: boolean) {
  el.textContent = message;
  el.classList.toggle('hidden', !show);
}

// GENERATE SPRITES
const generatePreset = document.getElementById('generate-preset') as HTMLSelectElement;
const generatePrompt = document.getElementById('generate-prompt') as HTMLTextAreaElement;
const generateNegative = document.getElementById('generate-negative') as HTMLTextAreaElement;
const generateModel = document.getElementById('generate-model') as HTMLSelectElement;
const generateAspect = document.getElementById('generate-aspect') as HTMLSelectElement;
const generateSize = document.getElementById('generate-size') as HTMLSelectElement;
const generateRun = document.getElementById('generate-run') as HTMLButtonElement;
const generateProgress = document.getElementById('generate-progress')!;
const generateImg = document.getElementById('generate-img') as HTMLImageElement;
const generateEmpty = document.getElementById('generate-empty')!;
const generateActions = document.getElementById('generate-actions')!;
const generateUseRemove = document.getElementById('generate-use-remove') as HTMLButtonElement;
const generateUseSlice = document.getElementById('generate-use-slice') as HTMLButtonElement;
const generateDownload = document.getElementById('generate-download') as HTMLButtonElement;
const generateClear = document.getElementById('generate-clear') as HTMLButtonElement;
const generateHistory = document.getElementById('generate-history')!;
const generateHistoryCount = document.getElementById('generate-history-count')!;
const generateClearHistory = document.getElementById('generate-clear-history') as HTMLButtonElement;
const presetEditLabel = document.getElementById('preset-edit-label') as HTMLInputElement;
const presetEditPrompt = document.getElementById('preset-edit-prompt') as HTMLTextAreaElement;
const presetEditAspect = document.getElementById('preset-edit-aspect') as HTMLSelectElement;
const presetEditSize = document.getElementById('preset-edit-size') as HTMLSelectElement;
const presetSave = document.getElementById('preset-save') as HTMLButtonElement;
const presetNew = document.getElementById('preset-new') as HTMLButtonElement;
const presetDelete = document.getElementById('preset-delete') as HTMLButtonElement;

let spritePresets: SpritePreset[] = [];
let generatedSpriteUrl: string | null = null;
let generatedSpriteName = 'generated-sprite.png';
const localPresetKey = 'sprite-lab.local-presets.v1';
let generatedHistoryItems: { id: string; imageUrl: string; name: string; prompt: string; model: string }[] = [];

function fillSelect(select: HTMLSelectElement, values: string[]) {
  select.innerHTML = '';
  values.forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
}

function loadLocalPresets(): SpritePreset[] {
  try {
    const raw = localStorage.getItem(localPresetKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SpritePreset[];
    return parsed.filter((preset) => preset.id && preset.label && preset.prompt);
  } catch {
    return [];
  }
}

function saveLocalPresets() {
  const localPresets = spritePresets.filter((preset) => preset.id.startsWith('local-'));
  localStorage.setItem(localPresetKey, JSON.stringify(localPresets));
}

function renderPresetSelect(selectedId = generatePreset.value) {
  generatePreset.innerHTML = '';
  spritePresets.forEach((preset) => {
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent = preset.id.startsWith('local-') ? `${preset.label} (local)` : preset.label;
    generatePreset.appendChild(option);
  });
  if (spritePresets.some((preset) => preset.id === selectedId)) {
    generatePreset.value = selectedId;
  }
}

async function initGenerator() {
  try {
    const [presets, metadata] = await Promise.all([fetchSpritePresets(), fetchGenerateMetadata()]);
    spritePresets = [...presets, ...loadLocalPresets()];
    renderPresetSelect(spritePresets[0]?.id);
    fillSelect(generateModel, metadata.models);
    fillSelect(generateAspect, metadata.aspectRatios);
    fillSelect(generateSize, metadata.imageSizes);
    fillSelect(presetEditAspect, metadata.aspectRatios);
    fillSelect(presetEditSize, metadata.imageSizes);
    applyPresetDefaults(true);
  } catch (err) {
    setProgress(
      generateProgress,
      err instanceof Error ? err.message : 'Sprite generator backend is unavailable',
      true,
    );
    generateRun.disabled = true;
  }
}

function applyPresetDefaults(replacePrompt = true) {
  const preset = spritePresets.find((item) => item.id === generatePreset.value);
  if (!preset) return;
  generateAspect.value = preset.aspectRatio;
  generateSize.value = preset.imageSize;
  presetEditLabel.value = preset.label;
  presetEditPrompt.value = preset.prompt;
  presetEditAspect.value = preset.aspectRatio;
  presetEditSize.value = preset.imageSize;
  presetDelete.disabled = !preset.id.startsWith('local-');
  if (replacePrompt) generatePrompt.value = preset.prompt;
}

function saveCurrentPreset() {
  const label = presetEditLabel.value.trim();
  const prompt = presetEditPrompt.value.trim();
  if (!label || !prompt) {
    alert('Preset name and prompt are required.');
    return;
  }

  const current = spritePresets.find((preset) => preset.id === generatePreset.value);
  const isLocal = current?.id.startsWith('local-');
  const id = isLocal ? current.id : `local-${Date.now()}`;
  const next: SpritePreset = {
    id,
    label,
    description: label,
    prompt,
    aspectRatio: presetEditAspect.value,
    imageSize: presetEditSize.value,
  };

  const existing = spritePresets.findIndex((preset) => preset.id === id);
  if (existing >= 0) spritePresets[existing] = next;
  else spritePresets.push(next);

  saveLocalPresets();
  renderPresetSelect(id);
  applyPresetDefaults(true);
}

function createBlankPreset() {
  const id = `local-${Date.now()}`;
  const next: SpritePreset = {
    id,
    label: 'New preset',
    description: 'New preset',
    prompt: 'Create a clean 2D game sprite. Pixel art, clear silhouette, consistent scale, no text, no watermark.',
    aspectRatio: generateAspect.value || '1:1',
    imageSize: generateSize.value || '1K',
  };
  spritePresets.push(next);
  saveLocalPresets();
  renderPresetSelect(id);
  applyPresetDefaults(true);
}

function deleteCurrentPreset() {
  const current = spritePresets.find((preset) => preset.id === generatePreset.value);
  if (!current?.id.startsWith('local-')) return;
  spritePresets = spritePresets.filter((preset) => preset.id !== current.id);
  saveLocalPresets();
  renderPresetSelect(spritePresets[0]?.id);
  applyPresetDefaults(true);
}

function setGeneratedImage(imageUrl: string, name: string) {
  generatedSpriteUrl = imageUrl;
  generatedSpriteName = name;
  generateImg.src = imageUrl;
  generateImg.hidden = false;
  generateEmpty.classList.add('gone');
  generateActions.hidden = false;
}

function clearGeneratedImage() {
  generatedSpriteUrl = null;
  generateImg.removeAttribute('src');
  generateImg.hidden = true;
  generateEmpty.classList.remove('gone');
  generateActions.hidden = true;
}

function addGeneratedHistory(imageUrl: string, name: string, prompt: string, model: string) {
  generatedHistoryItems.unshift({
    id: `generated-${Date.now()}`,
    imageUrl,
    name,
    prompt,
    model,
  });
  generatedHistoryItems = generatedHistoryItems.slice(0, 18);
  renderGeneratedHistory();
}

function renderGeneratedHistory() {
  generateHistory.innerHTML = '';
  generateHistoryCount.textContent = String(generatedHistoryItems.length);
  if (generatedHistoryItems.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'field-hint';
    empty.textContent = 'Generated images appear here.';
    generateHistory.appendChild(empty);
    return;
  }

  generatedHistoryItems.forEach((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'history-item';
    button.innerHTML = `
      <img src="${item.imageUrl}" alt="" />
      <span>
        <strong>${item.name.replace(/\.png$/, '')}</strong>
        <small>${item.model}</small>
      </span>
    `;
    button.addEventListener('click', () => setGeneratedImage(item.imageUrl, item.name));
    generateHistory.appendChild(button);
  });
}

async function runGenerateSprite() {
  generateRun.disabled = true;
  generateRun.textContent = 'Generating...';
  setProgress(generateProgress, 'Calling image model', true);

  try {
    const result = await generateSprite({
      presetId: '',
      prompt: generatePrompt.value,
      negativeHint: generateNegative.value,
      model: generateModel.value,
      aspectRatio: generateAspect.value,
      imageSize: generateSize.value,
    });

    const name = `${generatePreset.value || 'generated-sprite'}.png`;
    setGeneratedImage(result.imageUrl, name);
    addGeneratedHistory(result.imageUrl, name, result.prompt, result.model);
    setProgress(generateProgress, result.content || 'Sprite generated', true);
  } catch (err) {
    setProgress(generateProgress, err instanceof Error ? err.message : 'Image generation failed', true);
  } finally {
    generateRun.disabled = false;
    generateRun.textContent = 'Generate sprite';
  }
}

async function loadRemoveSource(dataUrl: string, fileName: string, fileSize?: number) {
  const file = { name: fileName, size: fileSize ?? 0 };
  removeFileName = fileName.replace(/\.[^.]+$/, '') + '.png';
  removeSourceUrl = dataUrl;
  removeResultUrl = null;
  removeDownload.hidden = true;

  removeBefore.src = removeSourceUrl;
  removeBefore.hidden = false;
  removeBeforeEmpty.classList.add('gone');
  removeAfter.hidden = true;
  removeAfterEmpty.classList.remove('gone');

  const dims = await getImageDimensions(removeSourceUrl);
  removeFileChip.hidden = false;
  removeFileChip.textContent = `${file.name} · ${dims.width}×${dims.height} · ${formatBytes(file.size)}`;
  removeRun.disabled = false;
}

async function loadRemoveFile(file: File) {
  await loadRemoveSource(await fileToDataUrl(file), file.name, file.size);
}

setupDropzone(removeDropzone, removeFileInput, (f) => void loadRemoveFile(f));

removeRun.addEventListener('click', async () => {
  if (!removeSourceUrl) return;
  removeRun.disabled = true;
  removeRun.textContent = 'Processing…';
  setProgress(removeProgress, '', false);

  try {
    const { result } = await removeBackgroundSmart(removeSourceUrl, {
      engine: 'auto',
      onProgress: (msg, pct) => setProgress(removeProgress, `${msg} (${pct}%)`, true),
    });

    removeResultUrl = result;
    removeAfter.src = result;
    removeAfter.hidden = false;
    removeAfterEmpty.classList.add('gone');
    removeDownload.hidden = false;
    setProgress(removeProgress, '', false);
  } catch (err) {
    alert(err instanceof Error ? err.message : 'Background removal failed');
  } finally {
    removeRun.disabled = false;
    removeRun.textContent = 'Remove background';
  }
});

removeDownload.addEventListener('click', () => {
  if (removeResultUrl) downloadDataUrl(removeResultUrl, removeFileName);
});

// ═══════════════════════════════════════════════════════════════════════════
// SPRITESHEET SLICER — pixel-based frame detection (not blind grid)
// ═══════════════════════════════════════════════════════════════════════════

const sliceDropzone = document.getElementById('slice-dropzone')!;
const sliceFileInput = document.getElementById('slice-file') as HTMLInputElement;
const sliceFileChip = document.getElementById('slice-file-chip')!;
const detectCard = document.getElementById('detect-card')!;
const detectLabel = document.getElementById('detect-label')!;
const detectDetail = document.getElementById('detect-detail')!;
const sliceRun = document.getElementById('slice-run') as HTMLButtonElement;
const sliceProgress = document.getElementById('slice-progress')!;
const sliceZip = document.getElementById('slice-zip') as HTMLButtonElement;
const normalizeCard = document.getElementById('normalize-card')!;
const normalizeStatus = document.getElementById('normalize-status')!;
const normalizeMode = document.getElementById('normalize-mode') as HTMLSelectElement;
const normalizeWidth = document.getElementById('normalize-width') as HTMLInputElement;
const normalizeHeight = document.getElementById('normalize-height') as HTMLInputElement;
const normalizeAlign = document.getElementById('normalize-align') as HTMLSelectElement;
const normalizePadding = document.getElementById('normalize-padding') as HTMLInputElement;
const normalizeApply = document.getElementById('normalize-apply') as HTMLButtonElement;
const normalizeReset = document.getElementById('normalize-reset') as HTMLButtonElement;
const sheetImg = document.getElementById('sheet-img') as HTMLImageElement;
const sheetEmpty = document.getElementById('sheet-empty')!;
const framesSection = document.getElementById('frames-section')!;
const framesCount = document.getElementById('frames-count')!;
const frameGrid = document.getElementById('frame-grid')!;
const animPreview = document.getElementById('anim-preview')!;
const animFps = document.getElementById('anim-fps') as HTMLInputElement;
const fpsVal = document.getElementById('fps-val')!;

let sliceSourceUrl: string | null = null;
let sliceBaseName = 'spritesheet';
let sliceCells: string[] = [];
let originalExtractedFrames: BrowserFrame[] = [];
let extractedFrames: BrowserFrame[] = [];
let excludedFrames = new Set<number>();
let animTimer: ReturnType<typeof setInterval> | null = null;
let animFrameIdx = 0;
let draggedFrameIndex: number | null = null;

function setSliceBusy(busy: boolean, label = 'Slice spritesheet') {
  const btnLabel = sliceRun.querySelector('.btn-label')!;
  const spinner = sliceRun.querySelector('.btn-spinner') as HTMLElement;
  sliceRun.disabled = busy;
  btnLabel.textContent = busy ? 'Slicing…' : label;
  spinner.hidden = !busy;
}

function cloneFrame(frame: BrowserFrame): BrowserFrame {
  return {
    ...frame,
    pivot: { ...frame.pivot },
    boxes: frame.boxes.map((box) => ({ ...box })),
  };
}

function setFrameCollection(frames: BrowserFrame[]) {
  extractedFrames = frames.map(cloneFrame);
  sliceCells = extractedFrames.map((frame) => frame.dataUrl);
  renderFrameGrid();
  updateFramesCount();
  startAnim();
}

function refreshFrameCollection() {
  sliceCells = extractedFrames.map((frame) => frame.dataUrl);
  renderFrameGrid();
  updateFramesCount();
  startAnim();
}

function moveFrame(fromIndex: number, toIndex: number) {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
  if (fromIndex >= extractedFrames.length || toIndex >= extractedFrames.length) return;

  const ordered = extractedFrames.map((frame, index) => ({
    frame,
    excluded: excludedFrames.has(index),
  }));
  const [item] = ordered.splice(fromIndex, 1);
  ordered.splice(toIndex, 0, item);

  extractedFrames = ordered.map((item) => item.frame);
  excludedFrames = new Set(ordered.map((item, index) => (item.excluded ? index : -1)).filter((i) => i >= 0));
  refreshFrameCollection();
}

function duplicateFrame(index: number) {
  const frame = extractedFrames[index];
  if (!frame) return;

  const copy = cloneFrame(frame);
  copy.id = `${frame.id || `frame_${index + 1}`}_copy_${Date.now()}`;
  copy.index = extractedFrames.length;

  const ordered = extractedFrames.map((item, itemIndex) => ({
    frame: item,
    excluded: excludedFrames.has(itemIndex),
  }));
  ordered.splice(index + 1, 0, { frame: copy, excluded: false });

  extractedFrames = ordered.map((item, itemIndex) => ({ ...item.frame, index: itemIndex }));
  excludedFrames = new Set(ordered.map((item, itemIndex) => (item.excluded ? itemIndex : -1)).filter((i) => i >= 0));
  refreshFrameCollection();
}

function suggestedNormalizeSize() {
  const padding = Math.max(0, Number(normalizePadding.value) || 0);
  const maxWidth = originalExtractedFrames.length
    ? Math.max(...originalExtractedFrames.map((frame) => frame.width))
    : 1;
  const maxHeight = originalExtractedFrames.length
    ? Math.max(...originalExtractedFrames.map((frame) => frame.height))
    : 1;
  return {
    width: maxWidth + padding * 2,
    height: maxHeight + padding * 2,
  };
}

function refreshNormalizeInputs() {
  const size = suggestedNormalizeSize();
  if (normalizeMode.value === 'max-size') {
    normalizeWidth.value = String(size.width);
    normalizeHeight.value = String(size.height);
    normalizeWidth.disabled = true;
    normalizeHeight.disabled = true;
    return;
  }
  normalizeWidth.disabled = false;
  normalizeHeight.disabled = false;
  if (!normalizeWidth.value) normalizeWidth.value = String(size.width);
  if (!normalizeHeight.value) normalizeHeight.value = String(size.height);
}

function resetNormalizeControls() {
  normalizeMode.value = 'max-size';
  normalizeAlign.value = 'bottom-center';
  normalizePadding.value = '0';
  refreshNormalizeInputs();
  normalizeStatus.textContent = 'Original crop';
}

async function applyNormalization() {
  if (originalExtractedFrames.length === 0) return;

  refreshNormalizeInputs();
  normalizeApply.disabled = true;
  normalizeApply.textContent = 'Normalizing...';

  try {
    const normalized = await normalizeBrowserFrames(originalExtractedFrames, {
      mode: normalizeMode.value as NormalizeMode,
      width: Number(normalizeWidth.value) || undefined,
      height: Number(normalizeHeight.value) || undefined,
      align: normalizeAlign.value as NormalizeAlign,
      padding: Math.max(0, Number(normalizePadding.value) || 0),
    });
    excludedFrames.clear();
    setFrameCollection(normalized);
    normalizeStatus.textContent = `${normalized[0]?.width ?? 0}x${normalized[0]?.height ?? 0}`;
  } catch (err) {
    alert(err instanceof Error ? err.message : 'Normalization failed');
  } finally {
    normalizeApply.disabled = false;
    normalizeApply.textContent = 'Apply normalization';
  }
}

async function runSlice() {
  if (!sliceSourceUrl) return;

  setSliceBusy(true);
  setProgress(sliceProgress, '', false);
  try {
    const { keyed, frames, applied } = await runSpritesheetPipelineBrowser(sliceSourceUrl, {
      engine: 'auto',
      onProgress: (msg, pct) => setProgress(sliceProgress, `${msg} (${pct}%)`, true),
    });
    sheetImg.src = keyed;
    await new Promise<void>((resolve) => {
      if (sheetImg.complete) resolve();
      else sheetImg.onload = () => resolve();
    });

    originalExtractedFrames = frames.map(cloneFrame);
    detectLabel.textContent = formatFrameDetection(frames.length);
    const removed =
      applied.kind !== 'none' && applied.kind !== 'transparent' ? `${applied.label} removed` : '';
    detectDetail.textContent = removed
      ? `${removed} · pixel-based detection`
      : 'Frames found by scanning pixels';

    excludedFrames.clear();
    framesSection.hidden = false;
    normalizeCard.hidden = false;
    resetNormalizeControls();
    setFrameCollection(originalExtractedFrames);
    sliceZip.hidden = false;
    setProgress(sliceProgress, '', false);
    setSliceBusy(false, 'Slice again');
  } catch (err) {
    detectLabel.textContent = 'Could not slice sheet';
    detectDetail.textContent = err instanceof Error ? err.message : 'Try a different image';
    alert(err instanceof Error ? err.message : 'Slicing failed');
    setSliceBusy(false);
  }
}

async function loadSliceSource(dataUrl: string, fileName: string, fileSize?: number) {
  const file = { name: fileName, size: fileSize ?? 0 };
  sliceBaseName = fileName.replace(/\.[^.]+$/, '');
  sliceSourceUrl = dataUrl;
  sliceCells = [];
  originalExtractedFrames = [];
  extractedFrames = [];
  excludedFrames.clear();
  sliceZip.hidden = true;
  framesSection.hidden = true;
  normalizeCard.hidden = true;
  resetNormalizeControls();
  stopAnim();

  sheetImg.src = sliceSourceUrl;
  sheetImg.hidden = false;
  sheetEmpty.classList.add('gone');

  const dims = await getImageDimensions(sliceSourceUrl);
  sliceFileChip.hidden = false;
  sliceFileChip.textContent = `${file.name} · ${dims.width}×${dims.height} · ${formatBytes(file.size)}`;

  detectCard.hidden = false;
  detectLabel.textContent = 'Scanning pixels…';
  detectDetail.textContent = 'Finding individual frames';
  sliceRun.disabled = false;

  await runSlice();
}

async function loadSliceFile(file: File) {
  await loadSliceSource(await fileToDataUrl(file), file.name, file.size);
}

setupDropzone(sliceDropzone, sliceFileInput, (f) => void loadSliceFile(f));
void initGenerator();
renderGeneratedHistory();

function renderFrameGrid() {
  frameGrid.innerHTML = '';
  extractedFrames.forEach((frame, i) => {
    const cell = document.createElement('div');
    cell.className = 'frame-cell checker' + (excludedFrames.has(i) ? ' excluded' : '');
    cell.draggable = true;
    cell.dataset.index = String(i);
    cell.innerHTML = `<span class="frame-num">${i + 1}</span>`;

    const duplicate = document.createElement('button');
    duplicate.type = 'button';
    duplicate.className = 'frame-duplicate';
    duplicate.title = 'Duplicate frame';
    duplicate.textContent = 'Copy';
    duplicate.addEventListener('click', (event) => {
      event.stopPropagation();
      duplicateFrame(i);
    });

    const img = document.createElement('img');
    img.src = frame.dataUrl;
    img.alt = `Frame ${i + 1}`;
    cell.appendChild(duplicate);
    cell.appendChild(img);
    cell.addEventListener('click', () => {
      if (excludedFrames.has(i)) excludedFrames.delete(i);
      else excludedFrames.add(i);
      renderFrameGrid();
      updateFramesCount();
      startAnim();
    });
    cell.addEventListener('dragstart', (event) => {
      draggedFrameIndex = i;
      cell.classList.add('dragging');
      event.dataTransfer?.setData('text/plain', String(i));
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    });
    cell.addEventListener('dragend', () => {
      draggedFrameIndex = null;
      cell.classList.remove('dragging');
      frameGrid.querySelectorAll('.drop-target').forEach((el) => el.classList.remove('drop-target'));
    });
    cell.addEventListener('dragover', (event) => {
      event.preventDefault();
      if (draggedFrameIndex !== null && draggedFrameIndex !== i) {
        cell.classList.add('drop-target');
      }
    });
    cell.addEventListener('dragleave', () => {
      cell.classList.remove('drop-target');
    });
    cell.addEventListener('drop', (event) => {
      event.preventDefault();
      cell.classList.remove('drop-target');
      const from = draggedFrameIndex ?? Number(event.dataTransfer?.getData('text/plain'));
      moveFrame(from, i);
      draggedFrameIndex = null;
    });
    frameGrid.appendChild(cell);
  });
}

function activeFrameIndices(): number[] {
  return extractedFrames.map((_, i) => i).filter((i) => !excludedFrames.has(i));
}

function updateFramesCount() {
  const active = activeFrameIndices().length;
  framesCount.textContent = `(${active} of ${sliceCells.length} kept)`;
}

function stopAnim() {
  if (animTimer) {
    clearInterval(animTimer);
    animTimer = null;
  }
}

function startAnim() {
  stopAnim();
  const active = activeFrameIndices();
  if (active.length === 0) {
    animPreview.innerHTML = '';
    return;
  }
  animFrameIdx = 0;
  const img = document.createElement('img');
  img.alt = 'Animation preview';
  animPreview.innerHTML = '';
  animPreview.appendChild(img);

  const fps = Number(animFps.value) || 12;
  fpsVal.textContent = String(fps);
  img.src = sliceCells[active[animFrameIdx % active.length]];

  animTimer = setInterval(() => {
    animFrameIdx = (animFrameIdx + 1) % active.length;
    img.src = sliceCells[active[animFrameIdx]];
  }, 1000 / fps);
}

animFps.addEventListener('input', () => startAnim());
sliceRun.addEventListener('click', () => void runSlice());
generatePreset.addEventListener('change', () => applyPresetDefaults(true));
generateAspect.addEventListener('change', () => {
  presetEditAspect.value = generateAspect.value;
});
generateSize.addEventListener('change', () => {
  presetEditSize.value = generateSize.value;
});
presetSave.addEventListener('click', saveCurrentPreset);
presetNew.addEventListener('click', createBlankPreset);
presetDelete.addEventListener('click', deleteCurrentPreset);
generateRun.addEventListener('click', () => void runGenerateSprite());
generateUseRemove.addEventListener('click', () => {
  if (generatedSpriteUrl) void loadRemoveSource(generatedSpriteUrl, generatedSpriteName);
});
generateUseSlice.addEventListener('click', () => {
  if (generatedSpriteUrl) void loadSliceSource(generatedSpriteUrl, generatedSpriteName);
});
generateDownload.addEventListener('click', () => {
  if (generatedSpriteUrl) downloadDataUrl(generatedSpriteUrl, generatedSpriteName);
});
generateClear.addEventListener('click', clearGeneratedImage);
generateClearHistory.addEventListener('click', () => {
  generatedHistoryItems = [];
  renderGeneratedHistory();
  clearGeneratedImage();
});
normalizeMode.addEventListener('change', refreshNormalizeInputs);
normalizePadding.addEventListener('input', refreshNormalizeInputs);
normalizeApply.addEventListener('click', () => void applyNormalization());
normalizeReset.addEventListener('click', () => {
  if (originalExtractedFrames.length === 0) return;
  excludedFrames.clear();
  resetNormalizeControls();
  setFrameCollection(originalExtractedFrames);
});

sliceZip.addEventListener('click', async () => {
  const active = activeFrameIndices();
  if (active.length === 0) {
    alert('Keep at least one frame to export.');
    return;
  }
  sliceZip.disabled = true;
  sliceZip.textContent = 'Building ZIP…';
  try {
    await downloadFramesZip(extractedFrames, active, sliceBaseName);
  } catch (err) {
    alert(err instanceof Error ? err.message : 'Export failed');
  } finally {
    sliceZip.disabled = false;
    sliceZip.textContent = 'Download ZIP';
  }
});
