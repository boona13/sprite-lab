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
  runSpritesheetPipelineBrowser,
  formatFrameDetection,
  normalizeBrowserFrames,
  type BrowserFrame,
} from './pipelineBrowser';
import type { NormalizeAlign, NormalizeMode } from './core/types';

type Tab = 'remove' | 'slice';

// ── Tabs ──
const tabs = document.querySelectorAll<HTMLButtonElement>('.tab');
const panelRemove = document.getElementById('panel-remove')!;
const panelSlice = document.getElementById('panel-slice')!;

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const id = tab.dataset.tab as Tab;
    tabs.forEach((t) => {
      t.classList.toggle('active', t === tab);
      t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
    });
    panelRemove.classList.toggle('hidden', id !== 'remove');
    panelSlice.classList.toggle('hidden', id !== 'slice');
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

async function loadRemoveFile(file: File) {
  removeFileName = file.name.replace(/\.[^.]+$/, '') + '.png';
  removeSourceUrl = await fileToDataUrl(file);
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

async function loadSliceFile(file: File) {
  sliceBaseName = file.name.replace(/\.[^.]+$/, '');
  sliceSourceUrl = await fileToDataUrl(file);
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

setupDropzone(sliceDropzone, sliceFileInput, (f) => void loadSliceFile(f));

function renderFrameGrid() {
  frameGrid.innerHTML = '';
  sliceCells.forEach((url, i) => {
    const cell = document.createElement('div');
    cell.className = 'frame-cell checker' + (excludedFrames.has(i) ? ' excluded' : '');
    cell.innerHTML = `<span class="frame-num">${i + 1}</span>`;
    const img = document.createElement('img');
    img.src = url;
    img.alt = `Frame ${i + 1}`;
    cell.appendChild(img);
    cell.addEventListener('click', () => {
      if (excludedFrames.has(i)) excludedFrames.delete(i);
      else excludedFrames.add(i);
      renderFrameGrid();
      updateFramesCount();
      startAnim();
    });
    frameGrid.appendChild(cell);
  });
}

function activeFrameIndices(): number[] {
  return sliceCells.map((_, i) => i).filter((i) => !excludedFrames.has(i));
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
