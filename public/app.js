import {
  encodeWav,
  exportFileName,
  formatAxisTime,
  formatBytes,
  formatChannels,
  formatDuration,
  formatPreciseTime,
  formatPreviewTimestamp,
  formatSemitone,
  normalizeChannels,
  ratioFor,
  resampleLinear,
} from "./audio-utils.mjs?v=20260728-1";

const state = {
  audioContext: null,
  audioBuffer: null,
  sourceBlob: null,
  sourceName: "",
  sourceSize: 0,
  sourceUrl: "",
  exports: [],
  activeNode: null,
  activeGain: null,
  activeMode: "",
  previewStartedAt: 0,
  previewDuration: 0,
  previewRegionStart: 0,
  playheadSeconds: 0,
  animationFrame: 0,
  isPlaying: false,
  isLoading: false,
  isRendering: false,
  cancelRender: false,
  loadToken: 0,
  loadAbortController: null,
  mobileSheetOpen: false,
  waveformPeaks: null,
  waveformPeaksKey: "",
  bpm: null,
  bpmStatus: "idle",
  bpmAnalysisId: 0,
  volume: 0.72,
  zoomLevel: 1,
  viewStart: 0,
  viewEnd: 0,
  dragHandle: "",
};

const els = {
  form: document.querySelector("#url-form"),
  url: document.querySelector("#source-url"),
  loadButton: document.querySelector("#load-button"),
  loadButtonLabel: document.querySelector("#load-button-label"),
  urlStatus: document.querySelector("#url-status"),
  file: document.querySelector("#file-input"),
  replaceSource: document.querySelector("#replace-source"),
  sourceActions: document.querySelector(".source-actions"),
  dropZone: document.querySelector("#drop-zone"),
  workspace: document.querySelector(".workspace-main"),
  topbar: document.querySelector(".topbar"),
  message: document.querySelector("#message"),
  toastRegion: document.querySelector("#toast-region"),
  metaName: document.querySelector("#meta-name"),
  metaDuration: document.querySelector("#meta-duration"),
  metaRate: document.querySelector("#meta-rate"),
  metaChannels: document.querySelector("#meta-channels"),
  metaBpm: document.querySelector("#meta-bpm"),
  metaSize: document.querySelector("#meta-size"),
  sourceReady: document.querySelector("#source-ready"),
  transportDuration: document.querySelector("#transport-duration"),
  waveTimeAxis: document.querySelector("#wave-time-axis"),
  canvas: document.querySelector("#waveform"),
  emptyWaveform: document.querySelector("#empty-waveform"),
  semitoneRange: document.querySelector("#semitones"),
  semitoneNumber: document.querySelector("#semitone-number"),
  semitoneReadout: document.querySelector("#semitone-readout"),
  previewOriginal: document.querySelector("#preview-original"),
  previewTransposed: document.querySelector("#preview-transposed"),
  stopPreview: document.querySelector("#stop-preview"),
  originalProgress: document.querySelector("#original-progress"),
  transposedProgress: document.querySelector("#transposed-progress"),
  playheadTime: document.querySelector("#playhead-time"),
  abOriginalTime: document.querySelector("#ab-original-time"),
  abTransposedTime: document.querySelector("#ab-transposed-time"),
  skipBack: document.querySelector("#skip-back"),
  skipForward: document.querySelector("#skip-forward"),
  volume: document.querySelector("#volume"),
  zoomOut: document.querySelector("#zoom-out"),
  zoomIn: document.querySelector("#zoom-in"),
  zoomFit: document.querySelector("#zoom-fit"),
  swapPreview: document.querySelector("#swap-preview"),
  stepDown: document.querySelector("#step-down"),
  stepUp: document.querySelector("#step-up"),
  trimStart: document.querySelector("#trim-start"),
  trimEnd: document.querySelector("#trim-end"),
  trimToggle: document.querySelector("#trim-toggle"),
  loopEnabled: document.querySelector("#loop-enabled"),
  loopStart: document.querySelector("#loop-start"),
  loopEnd: document.querySelector("#loop-end"),
  trimStartLabel: document.querySelector("#trim-start-label"),
  trimEndLabel: document.querySelector("#trim-end-label"),
  loopStartLabel: document.querySelector("#loop-start-label"),
  loopEndLabel: document.querySelector("#loop-end-label"),
  normalize: document.querySelector("#normalize"),
  batchGrid: document.querySelector("#batch-grid"),
  estimateCount: document.querySelector("#estimate-count"),
  estimateDuration: document.querySelector("#estimate-duration"),
  estimateSize: document.querySelector("#estimate-size"),
  downloadOriginal: document.querySelector("#download-original"),
  renderCurrent: document.querySelector("#render-current"),
  currentExportLabel: document.querySelector("#current-export-label"),
  renderBatch: document.querySelector("#render-batch"),
  batchExportLabel: document.querySelector("#batch-export-label"),
  cancelRender: document.querySelector("#cancel-render"),
  clearBatchSelection: document.querySelector("#clear-batch-selection"),
  clearExports: document.querySelector("#clear-exports"),
  versionList: document.querySelector("#version-list"),
  estimateWarning: document.querySelector("#estimate-warning"),
  exportPanel: document.querySelector("#export-panel"),
  openExportPanel: document.querySelector("#open-export-panel"),
  closeExportPanel: document.querySelector("#close-export-panel"),
  mobileExportBackdrop: document.querySelector("#mobile-export-backdrop"),
  mobileActionBar: document.querySelector("#mobile-action-bar"),
  mobileExportSummary: document.querySelector("#mobile-export-summary"),
  mobileSheetSummary: document.querySelector("#mobile-sheet-summary"),
  mobileRenderCurrent: document.querySelector("#mobile-render-current"),
  mobileCurrentExportLabel: document.querySelector("#mobile-current-export-label"),
};

const youtubeHosts = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
]);

const previewLimitSeconds = 30;
const maxRecommendedSeconds = 30 * 60;
const maxSourceBytes = 500 * 1024 * 1024;
const maxMobileRenderBytes = 1.25 * 1024 * 1024 * 1024;
const maxDesktopRenderBytes = 3 * 1024 * 1024 * 1024;
const bpmAnalysisSeconds = 180;
const bpmMin = 55;
const bpmMax = 210;
const analyticsKey = "audio-transposer-events-v1";

function getAudioContext() {
  if (!state.audioContext) {
    state.audioContext = new AudioContext();
  }
  return state.audioContext;
}

function semitones() {
  return Number(els.semitoneRange.value);
}

function formatBpm() {
  if (state.bpmStatus === "analyzing") return "Analyzing BPM...";
  if (!Number.isFinite(state.bpm)) return "BPM --";
  return `~${Math.round(state.bpm)} BPM`;
}

function fileNameFor(semitoneValue) {
  return exportFileName(state.sourceName || "audio", semitoneValue);
}

function yieldToUI() {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function trackEvent(name, detail = {}) {
  const allowed = {
    page_view: true,
    file_loaded: true,
    url_load_error: true,
    file_load_error: true,
    render_started: true,
    render_complete: true,
    render_error: true,
    render_cancelled: true,
  };
  if (!allowed[name]) return;
  try {
    const current = JSON.parse(localStorage.getItem(analyticsKey) || "{}");
    current[name] = (current[name] || 0) + 1;
    current.lastEvent = name;
    current.lastAt = new Date().toISOString();
    if (detail.reason) current.lastReason = String(detail.reason).slice(0, 80);
    localStorage.setItem(analyticsKey, JSON.stringify(current));
  } catch {
    // Analytics are best-effort and never required for app behavior.
  }
}

function setMessage(text, tone = "") {
  els.message.textContent = text;
  els.message.className = `message ${tone}`.trim();
}

function setUrlStatus(text = "", tone = "") {
  if (!els.urlStatus) return;
  els.urlStatus.textContent = text;
  els.urlStatus.className = `url-status ${tone}`.trim();
}

function showToast(text, tone = "") {
  setMessage(text, tone);
  const toast = document.createElement("div");
  toast.className = `toast ${tone}`.trim();
  toast.textContent = text;
  els.toastRegion.replaceChildren(toast);
  window.setTimeout(() => {
    toast.remove();
  }, 5200);
}

function isMobileLayout() {
  return window.matchMedia("(max-width: 760px)").matches;
}

function beginSourceLoad(message) {
  stopPreviewAt(state.playheadSeconds);
  state.loadToken += 1;
  state.loadAbortController?.abort();
  state.loadAbortController = new AbortController();
  state.isLoading = true;
  showToast(message);
  updateControls();
  return {
    id: state.loadToken,
    signal: state.loadAbortController.signal,
  };
}

function finishSourceLoad(loadId) {
  if (loadId !== state.loadToken) return;
  state.isLoading = false;
  state.loadAbortController = null;
  if (els.file) els.file.value = "";
  updateControls();
}

function assertSourceSize(size) {
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error("That source file is empty.");
  }
  if (size > maxSourceBytes) {
    throw new Error("That file is larger than the 500 MB browser limit.");
  }
}

function setMobileSheet(open, restoreFocus = false) {
  const mobile = isMobileLayout();
  if (!mobile) open = false;
  state.mobileSheetOpen = open;
  els.exportPanel.classList.toggle("is-mobile-open", open);
  els.exportPanel.setAttribute("aria-hidden", String(mobile && !open));
  if (mobile && !open) els.exportPanel.setAttribute("inert", "");
  else els.exportPanel.removeAttribute("inert");
  [els.topbar, els.workspace, els.mobileActionBar].forEach((element) => {
    if (mobile && open) element.setAttribute("inert", "");
    else element.removeAttribute("inert");
  });
  if (mobile) {
    els.exportPanel.setAttribute("role", "dialog");
    els.exportPanel.setAttribute("aria-modal", String(open));
  } else {
    els.exportPanel.removeAttribute("role");
    els.exportPanel.removeAttribute("aria-modal");
  }
  els.openExportPanel.setAttribute("aria-expanded", String(open));
  els.mobileExportBackdrop.hidden = !open;
  document.body.classList.toggle("mobile-sheet-open", open);

  if (open) {
    window.setTimeout(() => els.closeExportPanel.focus(), 200);
  } else if (restoreFocus && isMobileLayout()) {
    window.requestAnimationFrame(() => els.openExportPanel.focus());
  }
}

function isYouTubeUrl(value) {
  try {
    const url = new URL(value);
    return youtubeHosts.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function mediaNameFromUrl(value) {
  try {
    const url = new URL(value);
    return decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "linked-media");
  } catch {
    return "linked-media";
  }
}

function blobLooksLikeMedia(blob, response) {
  const contentType = (blob.type || response.headers.get("content-type") || "").toLowerCase();
  if (!contentType) return blob.size > 0;
  return (
    contentType.startsWith("audio/") ||
    contentType.startsWith("video/") ||
    contentType.includes("octet-stream")
  );
}

async function fetchDirectMediaUrl(value, signal) {
  const response = await fetch(value, { mode: "cors", signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentLength = Number(response.headers.get("content-length") || "0");
  if (contentLength) assertSourceSize(contentLength);
  const blob = await response.blob();
  assertSourceSize(blob.size);
  if (!blobLooksLikeMedia(blob, response)) throw new Error("URL did not return media");
  return {
    blob,
    name: mediaNameFromUrl(value),
  };
}

async function fetchProxiedMediaUrl(value, signal) {
  const response = await fetch(`/api/fetch-media?url=${encodeURIComponent(value)}`, { signal });
  if (!response.ok) {
    let message = "That link could not be loaded as media.";
    try {
      const payload = await response.json();
      if (payload?.error) message = payload.error;
    } catch {
      // Keep the generic message when the proxy cannot return JSON.
    }
    throw new Error(message);
  }
  const contentLength = Number(response.headers.get("content-length") || "0");
  if (contentLength) assertSourceSize(contentLength);
  const blob = await response.blob();
  assertSourceSize(blob.size);
  if (!blobLooksLikeMedia(blob, response)) throw new Error("That link did not return audio or video.");
  return {
    blob,
    name: response.headers.get("x-source-filename") || mediaNameFromUrl(value),
  };
}

function selectedBatchSemitones() {
  return [...els.batchGrid.querySelectorAll("input:checked")]
    .map((input) => Number(input.value))
    .sort((a, b) => a - b);
}

function getTrimRegion() {
  if (!state.audioBuffer) return { start: 0, end: 0, duration: 0 };
  if (els.trimToggle && !els.trimToggle.checked) {
    return {
      start: 0,
      end: state.audioBuffer.duration,
      duration: state.audioBuffer.duration,
    };
  }
  const start = Number(els.trimStart.value);
  const end = Number(els.trimEnd.value);
  return {
    start,
    end,
    duration: Math.max(0.1, end - start),
  };
}

function getPreviewRegion() {
  const trim = getTrimRegion();
  if (!els.loopEnabled.checked) return trim;
  const start = Number(els.loopStart.value);
  const end = Number(els.loopEnd.value);
  return {
    start,
    end,
    duration: Math.max(0.1, end - start),
  };
}

function clampTime(time, region = getPreviewRegion()) {
  if (!state.audioBuffer) return 0;
  return Math.max(region.start, Math.min(Number(time) || region.start, region.end));
}

function getVisibleRegion() {
  if (!state.audioBuffer) return { start: 0, end: 0, duration: 0 };
  const duration = state.audioBuffer.duration;
  if (state.zoomLevel <= 1 || state.viewEnd <= state.viewStart) {
    return { start: 0, end: duration, duration };
  }
  const visibleDuration = duration / state.zoomLevel;
  let start = state.viewStart;
  let end = state.viewEnd;
  if (end - start !== visibleDuration) {
    const center = clampTime(state.playheadSeconds, { start: 0, end: duration });
    start = center - visibleDuration / 2;
    end = center + visibleDuration / 2;
  }
  if (start < 0) {
    end += -start;
    start = 0;
  }
  if (end > duration) {
    start = Math.max(0, start - (end - duration));
    end = duration;
  }
  state.viewStart = start;
  state.viewEnd = end;
  return { start, end, duration: end - start };
}

function updateTimeAxis() {
  if (!els.waveTimeAxis) return;
  const labels = [];
  const region = getVisibleRegion();
  const count = window.matchMedia("(max-width: 760px)").matches ? 5 : 10;

  if (!state.audioBuffer) {
    labels.push("0:00", ...Array.from({ length: count - 1 }, () => "--"));
  } else {
    for (let index = 0; index < count; index += 1) {
      const fraction = count === 1 ? 0 : index / (count - 1);
      labels.push(formatAxisTime(region.start + region.duration * fraction));
    }
  }

  els.waveTimeAxis.replaceChildren(
    ...labels.map((label) => {
      const span = document.createElement("span");
      span.textContent = label;
      return span;
    }),
  );
}

function updateMeta() {
  if (!state.audioBuffer) {
    els.metaName.textContent = "No source loaded";
    els.metaName.removeAttribute("title");
    els.metaDuration.textContent = "--";
    els.metaRate.textContent = "--";
    els.metaChannels.textContent = "--";
    els.metaBpm.textContent = "BPM --";
    els.metaSize.textContent = "--";
    els.sourceReady.hidden = true;
    if (els.transportDuration) els.transportDuration.textContent = "--";
    updatePreviewTimes();
    updateWaveformAria();
    return;
  }

  els.metaName.textContent = state.sourceName;
  els.metaName.title = state.sourceName;
  els.metaDuration.textContent = formatDuration(state.audioBuffer.duration);
  els.metaRate.textContent = `${state.audioBuffer.sampleRate.toLocaleString()} Hz`;
  els.metaChannels.textContent = formatChannels(state.audioBuffer.numberOfChannels);
  els.metaBpm.textContent = formatBpm();
  els.metaSize.textContent = formatBytes(state.sourceSize);
  els.sourceReady.hidden = false;
  if (els.transportDuration) els.transportDuration.textContent = formatDuration(state.audioBuffer.duration);
  updateWaveformAria();
}

function updatePreviewTimes(seconds = 0) {
  if (!els.abOriginalTime || !els.abTransposedTime) return;
  const text = state.audioBuffer ? formatPreviewTimestamp(seconds) : "--";
  els.abOriginalTime.textContent = text;
  els.abTransposedTime.textContent = text;
}

function updateProgressDisplay(seconds = state.playheadSeconds) {
  const region = getPreviewRegion();
  const duration = Math.max(0.1, region.duration);
  const percent = state.audioBuffer ? Math.max(0, Math.min(100, ((seconds - region.start) / duration) * 100)) : 0;
  [els.originalProgress, els.transposedProgress].forEach((progress) => {
    if (progress) progress.value = percent;
  });
  if (els.playheadTime) els.playheadTime.textContent = state.audioBuffer ? formatDuration(seconds) : "0:00";
  updatePreviewTimes(seconds);
  updateWaveformAria();
}

function updateWaveformAria() {
  if (!state.audioBuffer) {
    els.canvas.setAttribute("aria-valuemax", "0");
    els.canvas.setAttribute("aria-valuenow", "0");
    els.canvas.setAttribute("aria-valuetext", "No audio loaded");
    els.canvas.setAttribute("aria-disabled", "true");
    return;
  }

  els.canvas.setAttribute("aria-valuemax", String(state.audioBuffer.duration));
  els.canvas.setAttribute("aria-valuenow", String(state.playheadSeconds));
  els.canvas.setAttribute(
    "aria-valuetext",
    `${formatPreviewTimestamp(state.playheadSeconds)} of ${formatPreviewTimestamp(state.audioBuffer.duration)}`,
  );
  els.canvas.setAttribute("aria-disabled", String(state.isLoading || state.isRendering));
}

function setPlayhead(seconds, redraw = true) {
  state.playheadSeconds = clampTime(seconds);
  updateProgressDisplay(state.playheadSeconds);
  if (redraw) drawWaveform(state.playheadSeconds);
}

async function buildOnsetEnvelope(buffer) {
  const sampleRate = buffer.sampleRate;
  const frameSize = Math.max(1024, Math.round(sampleRate * 0.046));
  const hopSize = Math.max(256, Math.round(sampleRate * 0.012));
  const endFrame = Math.min(buffer.length, Math.floor(sampleRate * bpmAnalysisSeconds));
  const channels = [buffer.getChannelData(0)];
  if (buffer.numberOfChannels > 1) channels.push(buffer.getChannelData(1));
  const energy = [];

  for (let frameStart = 0; frameStart + frameSize < endFrame; frameStart += hopSize) {
    let sum = 0;
    let count = 0;
    for (let offset = 0; offset < frameSize; offset += 2) {
      let sample = 0;
      channels.forEach((channel) => {
        sample += channel[frameStart + offset] || 0;
      });
      sample /= channels.length;
      sum += sample * sample;
      count += 1;
    }
    energy.push(Math.sqrt(sum / Math.max(1, count)));
    if (energy.length % 512 === 0) await yieldToUI();
  }

  if (energy.length < 32) return null;

  const envelope = new Float32Array(energy.length);
  let noveltyTotal = 0;
  for (let i = 1; i < energy.length; i += 1) {
    const novelty = Math.max(0, energy[i] - energy[i - 1]);
    envelope[i] = novelty;
    noveltyTotal += novelty;
  }

  const mean = noveltyTotal / envelope.length;
  if (mean <= 0.000001) return null;

  for (let i = 0; i < envelope.length; i += 1) {
    envelope[i] = Math.max(0, envelope[i] - mean * 1.2);
  }

  return {
    envelope,
    frameRate: sampleRate / hopSize,
  };
}

function correlationForLag(envelope, lag) {
  let score = 0;
  let weight = 0;
  for (let i = lag; i < envelope.length; i += 1) {
    score += envelope[i] * envelope[i - lag];
    weight += envelope[i] + envelope[i - lag];
  }
  return weight > 0 ? score / weight : 0;
}

async function estimateBpm(buffer) {
  await yieldToUI();
  const analysis = await buildOnsetEnvelope(buffer);
  if (!analysis) return null;

  const { envelope, frameRate } = analysis;
  const minLag = Math.max(1, Math.floor((60 / bpmMax) * frameRate));
  const maxLag = Math.min(envelope.length - 1, Math.ceil((60 / bpmMin) * frameRate));
  let bestLag = 0;
  let bestScore = 0;
  let scoreTotal = 0;
  let scoreCount = 0;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    const score =
      correlationForLag(envelope, lag) +
      correlationForLag(envelope, lag * 2) * 0.45 +
      correlationForLag(envelope, Math.max(1, Math.round(lag / 2))) * 0.25;

    scoreTotal += score;
    scoreCount += 1;

    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }

    if (lag % 20 === 0) await yieldToUI();
  }

  if (!bestLag) return null;
  const averageScore = scoreTotal / Math.max(1, scoreCount);
  if (bestScore < averageScore * 1.12) return null;

  let bpm = (60 * frameRate) / bestLag;
  while (bpm < 70) bpm *= 2;
  while (bpm > 190) bpm /= 2;
  return bpm;
}

async function analyzeBpm(buffer, analysisId) {
  try {
    const bpm = await estimateBpm(buffer);
    if (analysisId !== state.bpmAnalysisId) return;
    state.bpm = bpm;
    state.bpmStatus = "complete";
    updateMeta();
  } catch (error) {
    console.error(error);
    if (analysisId !== state.bpmAnalysisId) return;
    state.bpm = null;
    state.bpmStatus = "complete";
    updateMeta();
  }
}

function setPlayIcon(button, playing) {
  if (!button) return;
  const path = button.querySelector("path");
  if (!path) return;
  path.setAttribute("d", playing ? "M8 5h3v14H8zM13 5h3v14h-3z" : "M8 5v14l11-7-11-7Z");
}

function updatePlayButtons() {
  document.querySelectorAll("[data-play-mode]").forEach((button) => {
    const mode = button.dataset.playMode;
    const isActive = state.isPlaying && state.activeMode === mode;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-label", isActive ? `Pause ${mode} preview` : `Play ${mode} preview`);
    setPlayIcon(button, isActive);
  });
  document.querySelectorAll(".ab-side").forEach((side) => {
    const isOriginal = side.classList.contains("original");
    side.classList.toggle("is-playing", state.isPlaying && state.activeMode === (isOriginal ? "original" : "transposed"));
  });
}

function updateControls() {
  const loaded = Boolean(state.audioBuffer);
  const loading = state.isLoading;
  const rendering = state.isRendering;
  const busy = loading || rendering;
  const selected = selectedBatchSemitones();
  const canBatchExport = loaded && selected.length > 0 && !busy;
  const canTransport = loaded && !busy;
  const trimEnabled = Boolean(els.trimToggle?.checked);
  const semitoneLabel = `${formatSemitone(semitones())} st`;
  const selectedLabel = `${selected.length} selected`;

  els.workspace.setAttribute("aria-busy", String(busy));
  els.form.setAttribute("aria-busy", String(loading));
  els.dropZone.classList.toggle("is-loading", loading);
  els.loadButton.classList.toggle("is-loading", loading);
  els.loadButtonLabel.textContent = loading ? "Loading..." : "Load";
  els.file.disabled = busy;
  els.url.disabled = busy;
  els.loadButton.disabled = busy;
  els.replaceSource.disabled = busy;
  els.sourceActions.hidden = !loaded;

  els.previewOriginal.disabled = !canTransport;
  els.previewTransposed.disabled = !canTransport;
  els.stopPreview.disabled = !state.isPlaying;
  els.downloadOriginal.disabled = !loaded || !state.sourceBlob || busy;
  els.renderCurrent.disabled = !loaded || busy;
  els.mobileRenderCurrent.disabled = !loaded || busy;
  els.renderBatch.disabled = !canBatchExport;
  els.cancelRender.hidden = !rendering;
  els.cancelRender.disabled = !rendering || state.cancelRender;
  els.clearExports.disabled = state.exports.length === 0 || busy;
  els.clearBatchSelection.disabled = selected.length === 0 || busy;
  els.skipBack.disabled = !canTransport;
  els.skipForward.disabled = !canTransport;
  els.zoomOut.disabled = !canTransport || state.zoomLevel <= 1;
  els.zoomIn.disabled = !canTransport || state.zoomLevel >= 8;
  els.zoomFit.disabled = !canTransport || state.zoomLevel <= 1;
  els.swapPreview.disabled = !canTransport;
  els.trimToggle.disabled = !canTransport;
  els.volume.disabled = !canTransport;
  els.normalize.disabled = busy;
  els.semitoneRange.disabled = busy;
  els.semitoneNumber.disabled = busy;
  els.stepDown.disabled = busy;
  els.stepUp.disabled = busy;

  document.querySelectorAll("[data-preset]").forEach((button) => {
    button.disabled = busy;
  });
  els.batchGrid.querySelectorAll("input").forEach((input) => {
    input.disabled = busy;
  });

  [els.trimStart, els.trimEnd].forEach((control) => {
    control.disabled = !canTransport || !trimEnabled;
  });
  [els.loopEnabled, els.loopStart, els.loopEnd].forEach((control) => {
    control.disabled = !loaded || busy;
  });
  [els.loopStart, els.loopEnd].forEach((control) => {
    control.disabled = !canTransport || !els.loopEnabled.checked;
  });

  els.previewOriginal.title = loaded ? "Preview original audio" : "Upload audio first";
  els.previewTransposed.title = loaded ? "Preview selected transposition" : "Upload audio first";
  els.downloadOriginal.title = loaded ? "Download the source file" : "Upload audio first";
  els.renderCurrent.title = loaded ? `Export the current ${semitoneLabel} setting as WAV` : "Upload audio first";
  els.renderBatch.title = canBatchExport
    ? "Export selected semitone WAV files"
    : loaded
      ? "Select at least one batch semitone"
      : "Upload audio first";

  els.currentExportLabel.textContent = `Export ${semitoneLabel} WAV`;
  els.mobileCurrentExportLabel.textContent = `Export ${semitoneLabel}`;
  els.batchExportLabel.textContent = rendering
    ? "Rendering..."
    : selected.length === 0
      ? "Select versions"
      : selected.length === 1
      ? "Export 1 WAV"
      : `Export ${selected.length} WAVs`;
  els.mobileExportSummary.textContent = selectedLabel;
  els.mobileSheetSummary.textContent = selectedLabel;
  els.mobileActionBar.hidden = !loaded;
  document.body.classList.toggle("has-mobile-actions", loaded);

  document.querySelectorAll("[data-play-mode]").forEach((button) => {
    button.disabled = !canTransport;
  });
  document.querySelectorAll("[data-skip]").forEach((button) => {
    button.disabled = !canTransport;
  });
  updateWaveformAria();
  updatePlayButtons();
}

function updateSemitone(value) {
  const bounded = Math.max(-12, Math.min(12, Math.round(Number(value))));
  els.semitoneRange.value = String(bounded);
  els.semitoneNumber.value = String(bounded);
  els.semitoneReadout.textContent = `${formatSemitone(bounded)} st`;
  document.querySelectorAll("[data-preset]").forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.preset) === bounded);
  });
  stopPreview();
  updateEstimate();
}

function updateRegionBounds() {
  if (!state.audioBuffer) {
    updateRegionLabels();
    updateEstimate();
    updateTimeAxis();
    return;
  }

  const duration = state.audioBuffer.duration;
  const step = duration > 120 ? 0.5 : 0.1;
  [els.trimStart, els.trimEnd, els.loopStart, els.loopEnd].forEach((control) => {
    control.max = String(duration);
    control.step = String(step);
  });

  let trimStart = Number(els.trimStart.value);
  let trimEnd = Number(els.trimEnd.value);
  if (!Number.isFinite(trimEnd) || trimEnd <= 1) trimEnd = duration;
  trimStart = Math.max(0, Math.min(trimStart, duration - step));
  trimEnd = Math.max(trimStart + step, Math.min(trimEnd, duration));

  els.trimStart.value = String(trimStart);
  els.trimEnd.value = String(trimEnd);
  els.loopStart.value = String(Math.max(trimStart, Number(els.loopStart.value) || trimStart));
  els.loopEnd.value = String(Math.min(trimEnd, Number(els.loopEnd.value) || trimEnd));

  enforceRegions();
  updateTimeAxis();
}

function enforceRegions(changedControl = null) {
  if (!state.audioBuffer) return;
  const duration = state.audioBuffer.duration;
  const step = Number(els.trimStart.step) || 0.1;

  let trimStart = 0;
  let trimEnd = duration;
  if (!els.trimToggle || els.trimToggle.checked) {
    trimStart = Math.max(0, Math.min(Number(els.trimStart.value), duration - step));
    trimEnd = Math.max(step, Math.min(Number(els.trimEnd.value), duration));
    if (trimStart >= trimEnd) {
      if (changedControl === els.trimStart) trimEnd = Math.min(duration, trimStart + step);
      else trimStart = Math.max(0, trimEnd - step);
    }
  }

  let loopStart = Math.max(trimStart, Math.min(Number(els.loopStart.value), trimEnd - step));
  let loopEnd = Math.max(trimStart + step, Math.min(Number(els.loopEnd.value), trimEnd));
  if (loopStart >= loopEnd) {
    if (changedControl === els.loopStart) loopEnd = Math.min(trimEnd, loopStart + step);
    else loopStart = Math.max(trimStart, loopEnd - step);
  }

  els.trimStart.value = String(trimStart);
  els.trimEnd.value = String(trimEnd);
  els.loopStart.value = String(loopStart);
  els.loopEnd.value = String(loopEnd);

  updateRegionLabels();
  updateEstimate();
  setPlayhead(state.playheadSeconds, false);
  drawWaveform();
}

function updateRegionLabels() {
  const trim = getTrimRegion();
  const loop = getPreviewRegion();
  els.trimStartLabel.textContent = formatPreciseTime(trim.start);
  els.trimEndLabel.textContent = formatPreciseTime(trim.end);
  els.loopStartLabel.textContent = formatPreciseTime(loop.start);
  els.loopEndLabel.textContent = formatPreciseTime(loop.end);
}

function estimatedRenderMemory(region, exportCount = 1) {
  if (!state.audioBuffer || exportCount <= 0) return 0;
  const sourceSamples =
    state.audioBuffer.length * state.audioBuffer.numberOfChannels;
  const regionSamples =
    region.duration * state.audioBuffer.sampleRate * state.audioBuffer.numberOfChannels;
  const sourceMemory = sourceSamples * 4;
  const renderWorkingMemory = regionSamples * 22;
  const retainedWavMemory = regionSamples * 2 * exportCount;
  return sourceMemory + renderWorkingMemory + retainedWavMemory;
}

function renderMemoryLimit() {
  return isMobileLayout() ? maxMobileRenderBytes : maxDesktopRenderBytes;
}

function updateEstimate() {
  const selected = selectedBatchSemitones();
  const count = selected.length;
  els.estimateCount.textContent = `${count} ${count === 1 ? "file" : "files"}`;

  if (!state.audioBuffer) {
    els.estimateDuration.textContent = "--";
    els.estimateSize.textContent = "--";
    els.estimateWarning.textContent = "";
    updateControls();
    return;
  }

  const trim = getTrimRegion();
  const bytes = trim.duration * state.audioBuffer.sampleRate * state.audioBuffer.numberOfChannels * 2 * count + 44 * count;
  els.estimateDuration.textContent = formatDuration(trim.duration);
  els.estimateSize.textContent = count ? formatBytes(bytes) : "--";

  const workingMemory = estimatedRenderMemory(trim, count);
  if (count && workingMemory > renderMemoryLimit()) {
    els.estimateWarning.textContent =
      "This batch is likely too large for a stable browser render. Trim the track or export fewer versions.";
  } else {
    els.estimateWarning.textContent = "";
  }
  updateControls();
}

function buildPeaks(buffer, startTime = 0, endTime = buffer.duration) {
  const width = els.canvas.width;
  const channel = buffer.getChannelData(0);
  const startSample = Math.max(0, Math.floor(startTime * buffer.sampleRate));
  const endSample = Math.min(channel.length, Math.ceil(endTime * buffer.sampleRate));
  const samplesPerPixel = Math.max(1, Math.floor((endSample - startSample) / width));
  const peaks = new Array(width);
  for (let x = 0; x < width; x += 1) {
    let min = 1;
    let max = -1;
    const start = startSample + x * samplesPerPixel;
    for (let i = 0; i < samplesPerPixel && start + i < endSample; i += 1) {
      const value = channel[start + i];
      if (value < min) min = value;
      if (value > max) max = value;
    }
    peaks[x] = { min, max };
  }
  return peaks;
}

function drawWaveform(playhead = null) {
  const canvas = els.canvas;
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  updateTimeAxis();
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(20, 33, 31, 0.08)";
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 56) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 52; y < height; y += 52) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  if (!state.audioBuffer) {
    els.emptyWaveform.hidden = false;
    return;
  }

  els.emptyWaveform.hidden = true;
  const visible = getVisibleRegion();
  const peaksKey = `${Math.round(visible.start * state.audioBuffer.sampleRate)}:${Math.round(visible.end * state.audioBuffer.sampleRate)}:${width}`;
  if (!state.waveformPeaks || state.waveformPeaksKey !== peaksKey) {
    state.waveformPeaks = buildPeaks(state.audioBuffer, visible.start, visible.end);
    state.waveformPeaksKey = peaksKey;
  }

  const trim = getTrimRegion();
  const loop = getPreviewRegion();
  const center = height / 2;
  const xForTime = (time) => ((time - visible.start) / visible.duration) * width;
  const fillTimeRange = (start, end, color) => {
    const left = Math.max(0, Math.min(width, xForTime(start)));
    const right = Math.max(0, Math.min(width, xForTime(end)));
    if (right <= 0 || left >= width || right <= left) return;
    ctx.fillStyle = color;
    ctx.fillRect(left, 0, right - left, height);
  };

  if (!els.trimToggle || els.trimToggle.checked) {
    fillTimeRange(visible.start, trim.start, "rgba(20, 33, 31, 0.05)");
    fillTimeRange(trim.end, visible.end, "rgba(20, 33, 31, 0.05)");
  }

  if (els.loopEnabled.checked) {
    fillTimeRange(loop.start, loop.end, "rgba(8, 127, 121, 0.08)");
  }

  const gradient = ctx.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, "#087f79");
  gradient.addColorStop(0.62, "#0d9b8f");
  gradient.addColorStop(1, "#e45f4f");

  ctx.strokeStyle = gradient;
  ctx.lineWidth = 1.7;
  ctx.beginPath();
  for (let x = 0; x < width; x += 1) {
    const peak = state.waveformPeaks[x] || { min: 0, max: 0 };
    ctx.moveTo(x, center + peak.min * center * 0.78);
    ctx.lineTo(x, center + peak.max * center * 0.78);
  }
  ctx.stroke();

  const markers = [];
  if (!els.trimToggle || els.trimToggle.checked) {
    markers.push({ x: xForTime(trim.start), color: "#14211f" }, { x: xForTime(trim.end), color: "#14211f" });
  }
  if (els.loopEnabled.checked) {
    markers.push({ x: xForTime(loop.start), color: "#087f79" }, { x: xForTime(loop.end), color: "#087f79" });
  }
  markers.forEach((marker) => {
    if (marker.x < 0 || marker.x > width) return;
    ctx.strokeStyle = marker.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(marker.x, 8);
    ctx.lineTo(marker.x, height - 8);
    ctx.stroke();
  });

  if (Number.isFinite(playhead)) {
    const x = xForTime(playhead);
    if (x >= 0 && x <= width) {
      ctx.strokeStyle = "#e45f4f";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
  }
}

async function decodeBlob(blob, name, sourceUrl = "", loadId = state.loadToken) {
  assertSourceSize(blob.size);
  stopPreview();
  const context = getAudioContext();
  const arrayBuffer = await blob.arrayBuffer();
  const decoded = await context.decodeAudioData(arrayBuffer.slice(0));
  if (loadId !== state.loadToken) return false;

  state.audioBuffer = decoded;
  state.sourceBlob = blob;
  state.sourceName = name;
  state.sourceSize = blob.size;
  state.sourceUrl = sourceUrl;
  state.bpm = null;
  state.bpmStatus = "analyzing";
  state.bpmAnalysisId += 1;
  const bpmAnalysisId = state.bpmAnalysisId;
  state.exports.forEach((entry) => {
    if (entry.url) URL.revokeObjectURL(entry.url);
  });
  state.exports = [];
  state.waveformPeaks = null;
  state.waveformPeaksKey = "";
  state.zoomLevel = 1;
  state.viewStart = 0;
  state.viewEnd = decoded.duration;
  state.playheadSeconds = 0;

  els.trimStart.value = "0";
  els.trimEnd.value = String(decoded.duration);
  els.loopStart.value = "0";
  els.loopEnd.value = String(Math.min(decoded.duration, Math.max(4, decoded.duration / 4)));
  els.loopEnabled.checked = false;
  if (els.trimToggle) els.trimToggle.checked = true;

  updateMeta();
  updateRegionBounds();
  renderExportList();
  drawWaveform();
  updateControls();
  setPlayhead(0, false);
  analyzeBpm(decoded, bpmAnalysisId);

  const lengthNote =
    decoded.duration > maxRecommendedSeconds
      ? " This is longer than the 30 minute recommendation, so export may take a while."
      : "";
  showToast(`Audio loaded. Choose semitones, set trim if needed, then export WAV.${lengthNote}`, "success");
  trackEvent("file_loaded");
  return true;
}

async function loadFile(file) {
  setUrlStatus();
  if (!file || state.isLoading || state.isRendering) return;
  if (!file.type.startsWith("audio/") && !file.type.startsWith("video/") && file.type !== "") {
    showToast("Choose an audio file, or a video file with an audio track.", "error");
    trackEvent("file_load_error", { reason: "unsupported_type" });
    els.file.value = "";
    return;
  }

  let load;
  try {
    assertSourceSize(file.size);
    load = beginSourceLoad("Decoding audio...");
    await decodeBlob(file, file.name, "", load.id);
  } catch (error) {
    if (load?.id !== state.loadToken) return;
    const message =
      error.message?.includes("500 MB") || error.message?.includes("empty")
        ? error.message
        : "This browser could not decode that file. Try MP3, WAV, M4A, AAC, OGG, WebM, or MP4.";
    showToast(message, "error");
    trackEvent("file_load_error", { reason: "decode_failed" });
  } finally {
    if (load) finishSourceLoad(load.id);
    else els.file.value = "";
  }
}

async function loadUrl(value) {
  if (state.isLoading || state.isRendering) return;
  if (!value) {
    setUrlStatus("Paste a direct audio or video file URL, or upload a file.", "error");
    return;
  }

  if (isYouTubeUrl(value)) {
    setUrlStatus("YouTube watch pages are not direct media files. Use a direct .mp3, .m4a, .wav, .webm, or .mp4 file link.", "error");
    trackEvent("url_load_error", { reason: "youtube_watch_url" });
    return;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(value);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error();
  } catch {
    setUrlStatus("Enter a valid HTTP or HTTPS media file link.", "error");
    return;
  }

  const load = beginSourceLoad("Loading media link...");
  let usedProxy = false;
  try {
    setUrlStatus("Loading media link...");
    let media;
    try {
      media = await fetchDirectMediaUrl(parsedUrl.toString(), load.signal);
    } catch {
      if (load.signal.aborted) return;
      usedProxy = true;
      setUrlStatus("Loading media link through secure importer...");
      media = await fetchProxiedMediaUrl(parsedUrl.toString(), load.signal);
    }
    const loaded = await decodeBlob(media.blob, media.name, parsedUrl.toString(), load.id);
    if (loaded) {
      setUrlStatus(
        usedProxy ? "Imported through the secure relay. Audio processing now happens in this browser." : "",
        usedProxy ? "success" : "",
      );
    }
  } catch (error) {
    if (load.signal.aborted || load.id !== state.loadToken) return;
    setUrlStatus(error.message || "That link could not be loaded as an audio/video file.", "error");
    trackEvent("url_load_error", { reason: "fetch_or_decode_failed" });
  } finally {
    finishSourceLoad(load.id);
  }
}

function stopPreview() {
  stopPreviewAt(0);
}

function stopPreviewAt(nextPlayhead = state.playheadSeconds) {
  if (state.activeNode) {
    try {
      state.activeNode.stop();
    } catch {
      // The node may already have ended.
    }
    state.activeNode.disconnect();
  }
  state.activeNode = null;
  state.activeGain = null;
  state.activeMode = "";
  state.isPlaying = false;
  cancelAnimationFrame(state.animationFrame);
  setPlayhead(nextPlayhead);
  updateControls();
}

async function playBuffer(buffer, mode, regionStart, loop, offsetSeconds = 0) {
  const context = getAudioContext();
  await context.resume();
  const source = context.createBufferSource();
  const gain = context.createGain();
  source.buffer = buffer;
  gain.gain.value = state.volume;
  source.connect(gain);
  gain.connect(context.destination);
  source.loop = loop;
  source.onended = () => {
    if (state.activeNode === source && !source.loop) stopPreviewAt(regionStart + buffer.duration);
  };
  source.start(0, Math.max(0, Math.min(offsetSeconds, buffer.duration - 0.01)));

  state.activeNode = source;
  state.activeGain = gain;
  state.activeMode = mode;
  state.isPlaying = true;
  state.previewStartedAt = context.currentTime - offsetSeconds;
  state.previewDuration = buffer.duration;
  state.previewRegionStart = regionStart;
  updateControls();
  tickProgress();
}

async function previewOriginal(startAt = state.playheadSeconds) {
  if (!state.audioBuffer) return;
  const wasPlayingSameMode = state.isPlaying && state.activeMode === "original";
  if (wasPlayingSameMode) {
    stopPreviewAt(state.playheadSeconds);
    setMessage("Original preview paused.", "success");
    return;
  }
  stopPreviewAt(startAt);
  const region = getPreviewRegion();
  const start = els.loopEnabled.checked ? region.start : clampTime(startAt, region);
  const buffer = copySegment(state.audioBuffer, region.start, region.end);
  await playBuffer(buffer, "original", region.start, els.loopEnabled.checked, start - region.start);
  setMessage("Playing original preview.", "success");
}

async function previewTransposed(startAt = state.playheadSeconds) {
  if (!state.audioBuffer) return;
  const wasPlayingSameMode = state.isPlaying && state.activeMode === "transposed";
  if (wasPlayingSameMode) {
    stopPreviewAt(state.playheadSeconds);
    setMessage("Transposed preview paused.", "success");
    return;
  }
  stopPreviewAt(startAt);
  const fullRegion = getPreviewRegion();
  const start = els.loopEnabled.checked ? fullRegion.start : clampTime(startAt, fullRegion);
  const cappedEnd = Math.min(fullRegion.end, start + previewLimitSeconds);
  const region = { start, end: cappedEnd, duration: cappedEnd - start };
  const capped = fullRegion.end - start > previewLimitSeconds;
  showToast(capped ? "Rendering first 30 seconds for fast transposed preview..." : "Rendering fast transposed preview...");
  const rendered = await pitchShiftRegion(state.audioBuffer, semitones(), region, {
    normalize: els.normalize.checked,
    quality: "preview",
    onProgress: () => {},
    shouldCancel: () => false,
  });
  const buffer = renderedToAudioBuffer(rendered);
  await playBuffer(buffer, "transposed", region.start, els.loopEnabled.checked, 0);
  setMessage("Playing transposed preview.", "success");
}

function playMode(mode) {
  if (mode === "transposed") previewTransposed(state.playheadSeconds);
  else previewOriginal(state.playheadSeconds);
}

function switchPreviewMode() {
  if (!state.audioBuffer) return;
  const nextMode = state.activeMode === "transposed" ? "original" : "transposed";
  playMode(nextMode);
}

function skipPreview(seconds) {
  if (!state.audioBuffer) return;
  const next = clampTime(state.playheadSeconds + seconds);
  const mode = state.activeMode;
  const wasPlaying = state.isPlaying;
  stopPreviewAt(next);
  if (wasPlaying && mode) playMode(mode);
}

function zoomWaveform(direction) {
  if (!state.audioBuffer) return;
  const oldLevel = state.zoomLevel;
  if (direction === "fit") state.zoomLevel = 1;
  else state.zoomLevel = Math.max(1, Math.min(8, state.zoomLevel * (direction === "in" ? 2 : 0.5)));
  if (state.zoomLevel === 1) {
    state.viewStart = 0;
    state.viewEnd = state.audioBuffer.duration;
  } else if (state.zoomLevel !== oldLevel) {
    const visibleDuration = state.audioBuffer.duration / state.zoomLevel;
    const center = clampTime(state.playheadSeconds, { start: 0, end: state.audioBuffer.duration });
    state.viewStart = Math.max(0, center - visibleDuration / 2);
    state.viewEnd = Math.min(state.audioBuffer.duration, state.viewStart + visibleDuration);
    if (state.viewEnd - state.viewStart < visibleDuration) {
      state.viewStart = Math.max(0, state.viewEnd - visibleDuration);
    }
  }
  state.waveformPeaks = null;
  updateControls();
  drawWaveform(state.playheadSeconds);
}

function tickProgress() {
  if (!state.isPlaying || !state.audioContext) return;
  const elapsed = state.audioContext.currentTime - state.previewStartedAt;
  const loopElapsed = state.previewDuration > 0 ? elapsed % state.previewDuration : 0;
  const visibleElapsed = state.activeNode?.loop ? loopElapsed : Math.min(elapsed, state.previewDuration);
  const playhead = state.previewRegionStart + visibleElapsed;
  state.playheadSeconds = clampTime(playhead);
  updateProgressDisplay(state.playheadSeconds);
  drawWaveform(playhead);
  state.animationFrame = requestAnimationFrame(tickProgress);
}

function copySegment(buffer, start, end) {
  const sampleRate = buffer.sampleRate;
  const startFrame = Math.max(0, Math.floor(start * sampleRate));
  const endFrame = Math.min(buffer.length, Math.ceil(end * sampleRate));
  const length = Math.max(1, endFrame - startFrame);
  const context = getAudioContext();
  const output = context.createBuffer(buffer.numberOfChannels, length, sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    output.copyToChannel(buffer.getChannelData(channel).slice(startFrame, endFrame), channel);
  }
  return output;
}

function renderedToAudioBuffer(rendered) {
  const context = getAudioContext();
  const output = context.createBuffer(rendered.numberOfChannels, rendered.length, rendered.sampleRate);
  rendered.channels.forEach((channel, index) => output.copyToChannel(channel, index));
  return output;
}

function hann(index, length) {
  return 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / Math.max(1, length - 1));
}

async function timeStretchOLA(input, outputLength, quality, onStep, shouldCancel) {
  if (Math.abs(input.length - outputLength) <= 1) return input.slice(0, outputLength);

  const windowSize = quality === "export" ? 4096 : 2048;
  const hopOut = Math.max(128, Math.floor(windowSize / 4));
  const stretch = outputLength / input.length;
  const output = new Float32Array(outputLength);
  const weights = new Float32Array(outputLength);

  for (let outStart = 0; outStart < outputLength; outStart += hopOut) {
    if (shouldCancel()) throw new Error("Render cancelled");
    const inStart = outStart / stretch;

    for (let i = 0; i < windowSize; i += 1) {
      const outIndex = outStart + i;
      if (outIndex >= outputLength) break;
      const sourceIndex = inStart + i;
      if (sourceIndex >= input.length - 1) break;
      const left = Math.floor(sourceIndex);
      const right = Math.min(input.length - 1, left + 1);
      const fraction = sourceIndex - left;
      const sample = input[left] * (1 - fraction) + input[right] * fraction;
      const weight = hann(i, windowSize);
      output[outIndex] += sample * weight;
      weights[outIndex] += weight;
    }

    onStep();
    if (outStart % (hopOut * 24) === 0) await yieldToUI();
  }

  for (let i = 0; i < outputLength; i += 1) {
    if (weights[i] > 0.0001) output[i] /= weights[i];
  }
  return output;
}

async function pitchShiftRegion(buffer, semitoneValue, region, options) {
  const ratio = ratioFor(semitoneValue);
  const sampleRate = buffer.sampleRate;
  const startFrame = Math.max(0, Math.floor(region.start * sampleRate));
  const endFrame = Math.min(buffer.length, Math.ceil(region.end * sampleRate));
  const outputLength = Math.max(1, endFrame - startFrame);
  const channels = [];
  const totalChannels = buffer.numberOfChannels;
  let completedSteps = 0;
  const estimatedSteps = totalChannels * 2;

  for (let channelIndex = 0; channelIndex < totalChannels; channelIndex += 1) {
    if (options.shouldCancel()) throw new Error("Render cancelled");
    const input = buffer.getChannelData(channelIndex).slice(startFrame, endFrame);
    const pitchChanged = semitoneValue === 0 ? input : resampleLinear(input, ratio);
    completedSteps += 1;
    options.onProgress(Math.min(0.95, completedSteps / estimatedSteps));
    await yieldToUI();

    const stretched =
      semitoneValue === 0
        ? pitchChanged.slice(0, outputLength)
        : await timeStretchOLA(
            pitchChanged,
            outputLength,
            options.quality,
            () => options.onProgress(Math.min(0.98, (completedSteps + 0.5) / estimatedSteps)),
            options.shouldCancel,
          );
    channels.push(stretched);
    completedSteps += 1;
    options.onProgress(Math.min(0.98, completedSteps / estimatedSteps));
  }

  if (options.normalize) normalizeChannels(channels);
  options.onProgress(1);

  return {
    sampleRate,
    numberOfChannels: totalChannels,
    length: outputLength,
    duration: outputLength / sampleRate,
    channels,
  };
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  triggerDownloadUrl(url, filename);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function triggerDownloadUrl(url, filename) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
}

function downloadOriginal() {
  if (!state.sourceBlob) return;
  downloadBlob(state.sourceBlob, state.sourceName || "original-audio");
  showToast("Original file download started.", "success");
}

function createQueueEntry(semitoneValue) {
  return {
    id: crypto.randomUUID(),
    semitones: semitoneValue,
    fileName: fileNameFor(semitoneValue),
    status: "queued",
    progress: 0,
    url: "",
    size: 0,
    duration: 0,
    lastUiProgress: 0,
  };
}

function replaceExistingExports(semitoneValues) {
  const values = new Set(semitoneValues);
  state.exports = state.exports.filter((entry) => {
    if (!values.has(entry.semitones)) return true;
    if (entry.url) URL.revokeObjectURL(entry.url);
    return false;
  });
}

async function renderVersions(semitoneValues, { autoDownload = false, revealQueue = false } = {}) {
  if (!state.audioBuffer || state.isRendering) return;
  const selected = [...new Set(semitoneValues.map(Number))]
    .filter((value) => Number.isFinite(value) && value >= -12 && value <= 12)
    .sort((a, b) => a - b);
  if (!selected.length) {
    showToast("Select at least one semitone for batch export.", "error");
    return;
  }

  const region = getTrimRegion();
  if (estimatedRenderMemory(region, selected.length) > renderMemoryLimit()) {
    showToast(
      "This render is too large for a stable browser export. Trim the track or export fewer versions.",
      "error",
    );
    if (isMobileLayout()) setMobileSheet(true);
    return;
  }

  stopPreview();
  state.isRendering = true;
  state.cancelRender = false;
  const normalize = els.normalize.checked;
  replaceExistingExports(selected);
  const entries = selected.map(createQueueEntry);
  state.exports.unshift(...entries);
  renderExportList();
  updateControls();
  trackEvent("render_started");

  if (revealQueue && isMobileLayout()) setMobileSheet(true);
  showToast(`Rendering ${entries.length} WAV ${entries.length === 1 ? "file" : "files"}...`);

  try {
    for (const entry of entries) {
      if (state.cancelRender) throw new Error("Render cancelled");
      entry.status = "rendering";
      entry.progress = 0.02;
      renderExportList();

      const rendered = await pitchShiftRegion(state.audioBuffer, entry.semitones, region, {
        normalize,
        quality: "export",
        onProgress: (value) => {
          entry.progress = Math.max(entry.progress, value);
          if (entry.progress - entry.lastUiProgress >= 0.02 || entry.progress >= 1) {
            entry.lastUiProgress = entry.progress;
            renderExportList();
          }
        },
        shouldCancel: () => state.cancelRender,
      });

      const blob = encodeWav(rendered);
      entry.url = URL.createObjectURL(blob);
      entry.size = blob.size;
      entry.duration = rendered.duration;
      entry.status = "complete";
      entry.progress = 1;
      renderExportList();
      await yieldToUI();
    }

    if (autoDownload && entries.length === 1) {
      triggerDownloadUrl(entries[0].url, entries[0].fileName);
      showToast("Export ready. The download has started and remains available in the queue.", "success");
    } else {
      showToast("Batch export complete. Download files from the queue during this session.", "success");
    }
    trackEvent("render_complete");
  } catch (error) {
    const cancelled = String(error.message || "").includes("cancelled");
    entries.forEach((entry) => {
      if (entry.status !== "complete") {
        entry.status = cancelled ? "cancelled" : "failed";
      }
    });
    renderExportList();
    showToast(cancelled ? "Render cancelled." : "Render failed. Try a shorter trim or fewer batch files.", cancelled ? "" : "error");
    trackEvent(cancelled ? "render_cancelled" : "render_error", { reason: error.message });
  } finally {
    state.isRendering = false;
    state.cancelRender = false;
    updateControls();
  }
}

function renderCurrent() {
  return renderVersions([semitones()], { autoDownload: true, revealQueue: true });
}

function renderBatch() {
  return renderVersions(selectedBatchSemitones(), { revealQueue: true });
}

function renderExportList() {
  if (!state.exports.length) {
    els.versionList.innerHTML = `
      <div class="empty-list">
        <span>No exports yet</span>
        <small>Select semitones and export WAV files.</small>
      </div>
    `;
    updateControls();
    return;
  }

  els.versionList.replaceChildren(
    ...state.exports.map((entry) => {
      const item = document.createElement("article");
      item.className = "version-item";
      const statusText =
        entry.status === "complete"
          ? `${formatDuration(entry.duration)} · ${formatBytes(entry.size)}`
          : entry.status === "rendering"
            ? `${Math.round(entry.progress * 100)}% rendered`
            : entry.status === "queued"
              ? "Queued"
              : entry.status === "cancelled"
                ? "Cancelled"
                : "Failed";
      item.innerHTML = `
        <header>
          <div>
            <strong>${entry.fileName}</strong>
            <small>${statusText}</small>
          </div>
          <span class="version-badge ${entry.status === "complete" ? "complete" : ""}">${formatSemitone(entry.semitones)}</span>
        </header>
        <progress value="${Math.round(entry.progress * 100)}" max="100"></progress>
      `;

      if (entry.status === "complete") {
        const link = document.createElement("a");
        link.href = entry.url;
        link.download = entry.fileName;
        link.textContent = "Download WAV";
        item.append(link);
      } else if (entry.status === "failed" || entry.status === "cancelled") {
        const retry = document.createElement("button");
        retry.className = "queue-retry";
        retry.type = "button";
        retry.textContent = "Retry";
        retry.addEventListener("click", () =>
          renderVersions([entry.semitones], { autoDownload: false, revealQueue: true }),
        );
        item.append(retry);
      }

      return item;
    }),
  );
  updateControls();
}

function clearExports() {
  state.exports.forEach((entry) => {
    if (entry.url) URL.revokeObjectURL(entry.url);
  });
  state.exports = [];
  renderExportList();
}

function timeFromCanvasEvent(event) {
  const rect = els.canvas.getBoundingClientRect();
  const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  const visible = getVisibleRegion();
  return visible.start + visible.duration * fraction;
}

function xForTimeInCanvas(time) {
  const visible = getVisibleRegion();
  const rect = els.canvas.getBoundingClientRect();
  return ((time - visible.start) / visible.duration) * rect.width;
}

function nearestWaveformHandle(time, clientX) {
  if (!state.audioBuffer) return "";
  const trim = getTrimRegion();
  const loop = getPreviewRegion();
  const candidates = [];
  if (!els.trimToggle || els.trimToggle.checked) {
    candidates.push(["trimStart", trim.start], ["trimEnd", trim.end]);
  }
  if (els.loopEnabled.checked) {
    candidates.push(["loopStart", loop.start], ["loopEnd", loop.end]);
  }
  let nearest = "";
  let nearestDistance = 14;
  candidates.forEach(([handle, handleTime]) => {
    const distance = Math.abs(clientX - xForTimeInCanvas(handleTime));
    if (distance < nearestDistance) {
      nearest = handle;
      nearestDistance = distance;
    }
  });
  return nearest;
}

function setRegionHandle(handle, time) {
  if (!handle) return;
  if (handle === "trimStart") els.trimStart.value = String(time);
  if (handle === "trimEnd") els.trimEnd.value = String(time);
  if (handle === "loopStart") els.loopStart.value = String(time);
  if (handle === "loopEnd") els.loopEnd.value = String(time);
  enforceRegions(document.querySelector(`#${handle.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`));
}

function attachWaveformPointerEvents() {
  els.canvas.addEventListener("pointerdown", (event) => {
    if (!state.audioBuffer || state.isRendering) return;
    const time = timeFromCanvasEvent(event);
    const rect = els.canvas.getBoundingClientRect();
    const handle = nearestWaveformHandle(time, event.clientX - rect.left);
    if (handle) {
      state.dragHandle = handle;
      stopPreviewAt(state.playheadSeconds);
      els.canvas.setPointerCapture(event.pointerId);
      setRegionHandle(handle, time);
      return;
    }
    const mode = state.activeMode;
    const wasPlaying = state.isPlaying;
    stopPreviewAt(time);
    if (wasPlaying && mode) playMode(mode);
  });

  els.canvas.addEventListener("pointermove", (event) => {
    if (!state.dragHandle) return;
    setRegionHandle(state.dragHandle, timeFromCanvasEvent(event));
  });

  ["pointerup", "pointercancel", "pointerleave"].forEach((eventName) => {
    els.canvas.addEventListener(eventName, (event) => {
      if (!state.dragHandle) return;
      if (eventName !== "pointerleave") {
        try {
          els.canvas.releasePointerCapture(event.pointerId);
        } catch {
          // Pointer capture may already be released.
        }
      }
      state.dragHandle = "";
    });
  });

  els.canvas.addEventListener("keydown", (event) => {
    if (!state.audioBuffer || state.isLoading || state.isRendering) return;
    const region = getPreviewRegion();
    let nextTime = state.playheadSeconds;
    const step = event.shiftKey ? 10 : 1;

    if (event.key === "ArrowLeft") nextTime -= step;
    else if (event.key === "ArrowRight") nextTime += step;
    else if (event.key === "Home") nextTime = region.start;
    else if (event.key === "End") nextTime = region.end;
    else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      playMode(state.activeMode || "original");
      return;
    } else {
      return;
    }

    event.preventDefault();
    stopPreviewAt(clampTime(nextTime, region));
  });
}

function attachEvents() {
  els.form.addEventListener("submit", (event) => {
    event.preventDefault();
    loadUrl(els.url.value.trim());
  });
  els.url.addEventListener("input", () => {
    if (els.urlStatus?.textContent) setUrlStatus();
  });

  els.file.addEventListener("change", () => {
    loadFile(els.file.files?.[0]);
  });
  els.replaceSource.addEventListener("click", () => {
    if (!els.file.disabled) els.file.click();
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    els.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.dropZone.classList.add("is-over");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    els.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.dropZone.classList.remove("is-over");
    });
  });

  els.dropZone.addEventListener("drop", (event) => {
    loadFile(event.dataTransfer?.files?.[0]);
  });

  els.semitoneRange.addEventListener("input", () => updateSemitone(els.semitoneRange.value));
  els.semitoneNumber.addEventListener("input", () => updateSemitone(els.semitoneNumber.value));
  els.stepDown.addEventListener("click", () => updateSemitone(semitones() - 1));
  els.stepUp.addEventListener("click", () => updateSemitone(semitones() + 1));

  document.querySelectorAll("[data-preset]").forEach((button) => {
    button.addEventListener("click", () => updateSemitone(button.dataset.preset));
  });

  [els.trimStart, els.trimEnd, els.loopStart, els.loopEnd].forEach((control) => {
    control.addEventListener("input", () => {
      stopPreview();
      enforceRegions(control);
    });
  });

  els.loopEnabled.addEventListener("change", () => {
    stopPreview();
    enforceRegions();
  });
  els.trimToggle.addEventListener("change", () => {
    stopPreview();
    enforceRegions();
    updateControls();
  });

  els.normalize.addEventListener("change", updateEstimate);
  els.batchGrid.addEventListener("change", updateEstimate);
  els.clearBatchSelection.addEventListener("click", () => {
    els.batchGrid.querySelectorAll("input").forEach((input) => {
      input.checked = false;
    });
    updateEstimate();
  });
  document.querySelectorAll("[data-play-mode]").forEach((button) => {
    button.addEventListener("click", () => playMode(button.dataset.playMode));
  });
  document.querySelectorAll("[data-skip]").forEach((button) => {
    button.addEventListener("click", () => skipPreview(Number(button.dataset.skip)));
  });
  els.skipBack.addEventListener("click", () => skipPreview(-10));
  els.skipForward.addEventListener("click", () => skipPreview(10));
  els.stopPreview.addEventListener("click", () => stopPreview());
  els.swapPreview.addEventListener("click", switchPreviewMode);
  els.zoomIn.addEventListener("click", () => zoomWaveform("in"));
  els.zoomOut.addEventListener("click", () => zoomWaveform("out"));
  els.zoomFit.addEventListener("click", () => zoomWaveform("fit"));
  els.volume.addEventListener("input", () => {
    state.volume = Number(els.volume.value);
    if (state.activeGain) state.activeGain.gain.value = state.volume;
  });
  els.downloadOriginal.addEventListener("click", downloadOriginal);
  els.renderCurrent.addEventListener("click", renderCurrent);
  els.mobileRenderCurrent.addEventListener("click", renderCurrent);
  els.renderBatch.addEventListener("click", renderBatch);
  els.cancelRender.addEventListener("click", () => {
    state.cancelRender = true;
    showToast("Cancelling after the current render step...");
    updateControls();
  });
  els.clearExports.addEventListener("click", clearExports);
  els.openExportPanel.addEventListener("click", () => setMobileSheet(true));
  els.closeExportPanel.addEventListener("click", () => setMobileSheet(false, true));
  els.mobileExportBackdrop.addEventListener("click", () => setMobileSheet(false, true));
  attachWaveformPointerEvents();
  window.addEventListener("resize", () => {
    setMobileSheet(state.mobileSheetOpen);
    updateTimeAxis();
    updateEstimate();
    drawWaveform(state.playheadSeconds);
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.mobileSheetOpen) {
      event.preventDefault();
      setMobileSheet(false, true);
    }
  });
  window.addEventListener("beforeunload", (event) => {
    if (!state.isRendering) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // Offline support is optional; the editor remains fully usable online.
    });
  });
}

function init() {
  const audioSupported = Boolean(window.AudioContext || window.webkitAudioContext);
  if (!audioSupported) {
    showToast("This browser does not support Web Audio decoding. Try a current desktop browser.", "error");
  }
  if (!window.AudioContext && window.webkitAudioContext) {
    window.AudioContext = window.webkitAudioContext;
  }

  attachEvents();
  updateSemitone(0);
  updateMeta();
  updatePreviewTimes();
  updateRegionLabels();
  updateEstimate();
  drawWaveform();
  setMobileSheet(false);
  setMessage("Choose a file or direct media link to begin.", "success");
  trackEvent("page_view");
  registerServiceWorker();
}

init();
