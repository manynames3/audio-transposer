const state = {
  audioContext: null,
  audioBuffer: null,
  sourceBlob: null,
  sourceName: "",
  sourceSize: 0,
  sourceUrl: "",
  exports: [],
  activeNode: null,
  activeMode: "",
  previewStartedAt: 0,
  previewDuration: 0,
  previewRegionStart: 0,
  animationFrame: 0,
  isPlaying: false,
  isRendering: false,
  cancelRender: false,
  waveformPeaks: null,
  bpm: null,
  bpmStatus: "idle",
  bpmAnalysisId: 0,
};

const els = {
  form: document.querySelector("#url-form"),
  url: document.querySelector("#source-url"),
  urlStatus: document.querySelector("#url-status"),
  file: document.querySelector("#file-input"),
  dropZone: document.querySelector("#drop-zone"),
  message: document.querySelector("#message"),
  toastRegion: document.querySelector("#toast-region"),
  metaName: document.querySelector("#meta-name"),
  metaDuration: document.querySelector("#meta-duration"),
  metaRate: document.querySelector("#meta-rate"),
  metaBpm: document.querySelector("#meta-bpm"),
  metaSize: document.querySelector("#meta-size"),
  transportDuration: document.querySelector("#transport-duration"),
  canvas: document.querySelector("#waveform"),
  emptyWaveform: document.querySelector("#empty-waveform"),
  semitoneRange: document.querySelector("#semitones"),
  semitoneNumber: document.querySelector("#semitone-number"),
  semitoneReadout: document.querySelector("#semitone-readout"),
  previewOriginal: document.querySelector("#preview-original"),
  previewTransposed: document.querySelector("#preview-transposed"),
  stopPreview: document.querySelector("#stop-preview"),
  progress: document.querySelector("#progress"),
  playheadTime: document.querySelector("#playhead-time"),
  stepDown: document.querySelector("#step-down"),
  stepUp: document.querySelector("#step-up"),
  trimStart: document.querySelector("#trim-start"),
  trimEnd: document.querySelector("#trim-end"),
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
  renderBatch: document.querySelector("#render-batch"),
  cancelRender: document.querySelector("#cancel-render"),
  clearExports: document.querySelector("#clear-exports"),
  versionList: document.querySelector("#version-list"),
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

function ratioFor(semitoneValue) {
  return Math.pow(2, semitoneValue / 12);
}

function formatSemitone(value) {
  const numeric = Number(value);
  return `${numeric > 0 ? "+" : ""}${numeric}`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "--";
  const total = Math.max(0, Math.round(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function formatPreciseTime(seconds) {
  if (!Number.isFinite(seconds)) return "--";
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return formatDuration(seconds);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "--";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatBpm() {
  if (state.bpmStatus === "analyzing") return "Analyzing BPM...";
  if (!Number.isFinite(state.bpm)) return "BPM --";
  return `~${Math.round(state.bpm)} BPM`;
}

function cleanName(name) {
  const base = name.replace(/\.[^/.]+$/, "");
  return base.replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "audio";
}

function fileNameFor(semitoneValue) {
  const base = cleanName(state.sourceName || "audio");
  const suffix =
    semitoneValue === 0
      ? "original"
      : `${semitoneValue > 0 ? "plus" : "minus"}-${Math.abs(semitoneValue)}st`;
  return `${base}_${suffix}.wav`;
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

async function fetchDirectMediaUrl(value) {
  const response = await fetch(value, { mode: "cors" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();
  if (!blobLooksLikeMedia(blob, response)) throw new Error("URL did not return media");
  return {
    blob,
    name: mediaNameFromUrl(value),
  };
}

async function fetchProxiedMediaUrl(value) {
  const response = await fetch(`/api/fetch-media?url=${encodeURIComponent(value)}`);
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
  const blob = await response.blob();
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

function updateMeta() {
  if (!state.audioBuffer) {
    els.metaName.textContent = "No source loaded";
    els.metaDuration.textContent = "--";
    els.metaRate.textContent = "--";
    els.metaBpm.textContent = "BPM --";
    els.metaSize.textContent = "--";
    if (els.transportDuration) els.transportDuration.textContent = "--";
    return;
  }

  els.metaName.textContent = state.sourceName;
  els.metaDuration.textContent = formatDuration(state.audioBuffer.duration);
  els.metaRate.textContent = `${state.audioBuffer.sampleRate.toLocaleString()} Hz`;
  els.metaBpm.textContent = formatBpm();
  els.metaSize.textContent = formatBytes(state.sourceSize);
  if (els.transportDuration) els.transportDuration.textContent = formatDuration(state.audioBuffer.duration);
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

function updateControls() {
  const loaded = Boolean(state.audioBuffer);
  const rendering = state.isRendering;
  const selected = selectedBatchSemitones();
  const canExport = loaded && selected.length > 0 && !rendering;

  els.previewOriginal.disabled = !loaded || rendering;
  els.previewTransposed.disabled = !loaded || rendering;
  els.stopPreview.disabled = !state.isPlaying;
  els.downloadOriginal.disabled = !loaded || !state.sourceBlob || rendering;
  els.renderBatch.disabled = !canExport;
  els.cancelRender.hidden = !rendering;
  els.clearExports.disabled = state.exports.length === 0 || rendering;

  [els.trimStart, els.trimEnd, els.loopEnabled, els.loopStart, els.loopEnd].forEach((control) => {
    control.disabled = !loaded || rendering;
  });

  els.previewOriginal.title = loaded ? "Preview original audio" : "Upload audio first";
  els.previewTransposed.title = loaded ? "Preview selected transposition" : "Upload audio first";
  els.downloadOriginal.title = loaded ? "Download the source file" : "Upload audio first";
  els.renderBatch.title = canExport
    ? "Export selected semitone WAV files"
    : loaded
      ? "Select at least one batch semitone"
      : "Upload audio first";

  document.querySelectorAll("[data-proxy]").forEach((button) => {
    const target = document.querySelector(`#${button.dataset.proxy}`);
    button.disabled = target ? target.disabled : true;
  });
}

function updateSemitone(value, checkBatch = true) {
  const bounded = Math.max(-12, Math.min(12, Math.round(Number(value))));
  els.semitoneRange.value = String(bounded);
  els.semitoneNumber.value = String(bounded);
  els.semitoneReadout.textContent = `${formatSemitone(bounded)} st`;
  document.querySelectorAll("[data-preset]").forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.preset) === bounded);
  });
  if (checkBatch) {
    const checkbox = els.batchGrid.querySelector(`input[value="${bounded}"]`);
    if (checkbox) checkbox.checked = true;
  }
  stopPreview();
  updateEstimate();
}

function updateRegionBounds() {
  if (!state.audioBuffer) {
    updateRegionLabels();
    updateEstimate();
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
}

function enforceRegions(changedControl = null) {
  if (!state.audioBuffer) return;
  const duration = state.audioBuffer.duration;
  const step = Number(els.trimStart.step) || 0.1;

  let trimStart = Math.max(0, Math.min(Number(els.trimStart.value), duration - step));
  let trimEnd = Math.max(step, Math.min(Number(els.trimEnd.value), duration));
  if (trimStart >= trimEnd) {
    if (changedControl === els.trimStart) trimEnd = Math.min(duration, trimStart + step);
    else trimStart = Math.max(0, trimEnd - step);
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

function updateEstimate() {
  const selected = selectedBatchSemitones();
  const count = Math.max(1, selected.length);
  els.estimateCount.textContent = `${count} ${count === 1 ? "file" : "files"}`;

  if (!state.audioBuffer) {
    els.estimateDuration.textContent = "--";
    els.estimateSize.textContent = "--";
    updateControls();
    return;
  }

  const trim = getTrimRegion();
  const bytes = trim.duration * state.audioBuffer.sampleRate * state.audioBuffer.numberOfChannels * 2 * count + 44 * count;
  els.estimateDuration.textContent = formatDuration(trim.duration);
  els.estimateSize.textContent = formatBytes(bytes);
  updateControls();
}

function buildPeaks(buffer) {
  const width = els.canvas.width;
  const channel = buffer.getChannelData(0);
  const samplesPerPixel = Math.max(1, Math.floor(channel.length / width));
  const peaks = new Array(width);
  for (let x = 0; x < width; x += 1) {
    let min = 1;
    let max = -1;
    const start = x * samplesPerPixel;
    for (let i = 0; i < samplesPerPixel && start + i < channel.length; i += 1) {
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
  if (!state.waveformPeaks) state.waveformPeaks = buildPeaks(state.audioBuffer);

  const trim = getTrimRegion();
  const loop = getPreviewRegion();
  const duration = state.audioBuffer.duration;
  const center = height / 2;
  const xForTime = (time) => (time / duration) * width;

  ctx.fillStyle = "rgba(20, 33, 31, 0.05)";
  ctx.fillRect(0, 0, xForTime(trim.start), height);
  ctx.fillRect(xForTime(trim.end), 0, width - xForTime(trim.end), height);

  if (els.loopEnabled.checked) {
    ctx.fillStyle = "rgba(8, 127, 121, 0.08)";
    ctx.fillRect(xForTime(loop.start), 0, Math.max(2, xForTime(loop.end) - xForTime(loop.start)), height);
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

  const markers = [
    { x: xForTime(trim.start), color: "#14211f" },
    { x: xForTime(trim.end), color: "#14211f" },
  ];
  if (els.loopEnabled.checked) {
    markers.push({ x: xForTime(loop.start), color: "#087f79" }, { x: xForTime(loop.end), color: "#087f79" });
  }
  markers.forEach((marker) => {
    ctx.strokeStyle = marker.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(marker.x, 8);
    ctx.lineTo(marker.x, height - 8);
    ctx.stroke();
  });

  if (Number.isFinite(playhead)) {
    const x = xForTime(playhead);
    ctx.strokeStyle = "#e45f4f";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
}

async function decodeBlob(blob, name, sourceUrl = "") {
  stopPreview();
  showToast("Decoding audio...");
  const context = getAudioContext();
  const arrayBuffer = await blob.arrayBuffer();
  const decoded = await context.decodeAudioData(arrayBuffer.slice(0));

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

  els.trimStart.value = "0";
  els.trimEnd.value = String(decoded.duration);
  els.loopStart.value = "0";
  els.loopEnd.value = String(Math.min(decoded.duration, Math.max(4, decoded.duration / 4)));
  els.loopEnabled.checked = false;

  updateMeta();
  updateRegionBounds();
  renderExportList();
  drawWaveform();
  updateControls();
  analyzeBpm(decoded, bpmAnalysisId);

  const lengthNote =
    decoded.duration > maxRecommendedSeconds
      ? " This is longer than the 30 minute recommendation, so export may take a while."
      : "";
  showToast(`Audio loaded. Choose semitones, set trim if needed, then export WAV.${lengthNote}`, "success");
  trackEvent("file_loaded");
}

async function loadFile(file) {
  setUrlStatus();
  if (!file) return;
  if (!file.type.startsWith("audio/") && !file.type.startsWith("video/") && file.type !== "") {
    showToast("Choose an audio file, or a video file with an audio track.", "error");
    trackEvent("file_load_error", { reason: "unsupported_type" });
    return;
  }

  try {
    await decodeBlob(file, file.name);
  } catch (error) {
    console.error(error);
    showToast("This browser could not decode that file. Try MP3, WAV, M4A, AAC, OGG, WebM, or MP4.", "error");
    trackEvent("file_load_error", { reason: "decode_failed" });
  }
}

async function loadUrl(value) {
  if (!value) {
    setUrlStatus("Paste a direct audio or video file URL, or upload a file.", "error");
    return;
  }

  if (isYouTubeUrl(value)) {
    setUrlStatus("YouTube links need the live-capture/extension workflow. This web app accepts uploads and direct audio/video file links.", "error");
    trackEvent("url_load_error", { reason: "youtube_watch_url" });
    return;
  }

  try {
    setUrlStatus("Loading media link...");
    let media;
    try {
      media = await fetchDirectMediaUrl(value);
    } catch {
      setUrlStatus("Loading media link through secure importer...");
      media = await fetchProxiedMediaUrl(value);
    }
    await decodeBlob(media.blob, media.name, value);
    setUrlStatus();
  } catch (error) {
    console.error(error);
    setUrlStatus(error.message || "That link could not be loaded as an audio/video file.", "error");
    trackEvent("url_load_error", { reason: "fetch_or_decode_failed" });
  }
}

function stopPreview() {
  if (state.activeNode) {
    try {
      state.activeNode.stop();
    } catch {
      // The node may already have ended.
    }
    state.activeNode.disconnect();
  }
  state.activeNode = null;
  state.activeMode = "";
  state.isPlaying = false;
  cancelAnimationFrame(state.animationFrame);
  els.progress.value = 0;
  els.playheadTime.textContent = "0:00";
  updateControls();
  drawWaveform();
}

async function playBuffer(buffer, mode, regionStart, loop) {
  const context = getAudioContext();
  await context.resume();
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.loop = loop;
  source.onended = () => {
    if (state.activeNode === source && !source.loop) stopPreview();
  };
  source.start();

  state.activeNode = source;
  state.activeMode = mode;
  state.isPlaying = true;
  state.previewStartedAt = context.currentTime;
  state.previewDuration = buffer.duration;
  state.previewRegionStart = regionStart;
  updateControls();
  tickProgress();
}

async function previewOriginal() {
  if (!state.audioBuffer) return;
  stopPreview();
  const region = getPreviewRegion();
  const buffer = copySegment(state.audioBuffer, region.start, region.end);
  await playBuffer(buffer, "original", region.start, els.loopEnabled.checked);
  setMessage("Playing original preview.", "success");
}

async function previewTransposed() {
  if (!state.audioBuffer) return;
  stopPreview();
  const fullRegion = getPreviewRegion();
  const cappedEnd = Math.min(fullRegion.end, fullRegion.start + previewLimitSeconds);
  const region = { start: fullRegion.start, end: cappedEnd, duration: cappedEnd - fullRegion.start };
  const capped = fullRegion.duration > previewLimitSeconds;
  showToast(capped ? "Rendering first 30 seconds for fast transposed preview..." : "Rendering fast transposed preview...");
  const rendered = await pitchShiftRegion(state.audioBuffer, semitones(), region, {
    normalize: els.normalize.checked,
    quality: "preview",
    onProgress: () => {},
    shouldCancel: () => false,
  });
  const buffer = renderedToAudioBuffer(rendered);
  await playBuffer(buffer, "transposed", region.start, els.loopEnabled.checked);
  setMessage("Playing transposed preview.", "success");
}

function tickProgress() {
  if (!state.isPlaying || !state.audioContext) return;
  const elapsed = state.audioContext.currentTime - state.previewStartedAt;
  const loopElapsed = state.previewDuration > 0 ? elapsed % state.previewDuration : 0;
  const visibleElapsed = state.activeNode?.loop ? loopElapsed : Math.min(elapsed, state.previewDuration);
  const playhead = state.previewRegionStart + visibleElapsed;
  els.progress.value = state.previewDuration > 0 ? Math.min(100, (visibleElapsed / state.previewDuration) * 100) : 0;
  els.playheadTime.textContent = formatDuration(playhead);
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

function resampleLinear(input, ratio) {
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i += 1) {
    const sourceIndex = i * ratio;
    const left = Math.floor(sourceIndex);
    const right = Math.min(input.length - 1, left + 1);
    const fraction = sourceIndex - left;
    output[i] = input[left] * (1 - fraction) + input[right] * fraction;
  }
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

function normalizeChannels(channels) {
  let peak = 0;
  channels.forEach((channel) => {
    for (let i = 0; i < channel.length; i += 1) {
      peak = Math.max(peak, Math.abs(channel[i]));
    }
  });
  if (peak < 0.000001) return;
  const target = Math.pow(10, -0.5 / 20);
  const gain = target / peak;
  channels.forEach((channel) => {
    for (let i = 0; i < channel.length; i += 1) {
      channel[i] = Math.max(-1, Math.min(1, channel[i] * gain));
    }
  });
}

function floatTo16Bit(value) {
  const sample = Math.max(-1, Math.min(1, value));
  return sample < 0 ? sample * 0x8000 : sample * 0x7fff;
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i += 1) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

function encodeWav(rendered) {
  const bytesPerSample = 2;
  const blockAlign = rendered.numberOfChannels * bytesPerSample;
  const dataSize = rendered.length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, rendered.numberOfChannels, true);
  view.setUint32(24, rendered.sampleRate, true);
  view.setUint32(28, rendered.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < rendered.length; i += 1) {
    for (let channelIndex = 0; channelIndex < rendered.numberOfChannels; channelIndex += 1) {
      view.setInt16(offset, floatTo16Bit(rendered.channels[channelIndex][i]), true);
      offset += bytesPerSample;
    }
  }

  return new Blob([view], { type: "audio/wav" });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadOriginal() {
  if (!state.sourceBlob) return;
  downloadBlob(state.sourceBlob, state.sourceName || "original-audio");
}

function queueEntry(semitoneValue) {
  const entry = {
    id: crypto.randomUUID(),
    semitones: semitoneValue,
    fileName: fileNameFor(semitoneValue),
    status: "queued",
    progress: 0,
    url: "",
    size: 0,
    duration: 0,
  };
  state.exports.unshift(entry);
  renderExportList();
  return entry;
}

async function renderBatch() {
  if (!state.audioBuffer || state.isRendering) return;
  const selected = selectedBatchSemitones();
  if (!selected.length) {
    showToast("Select at least one semitone for batch export.", "error");
    return;
  }

  stopPreview();
  state.isRendering = true;
  state.cancelRender = false;
  updateControls();
  trackEvent("render_started");

  const region = getTrimRegion();
  const entries = selected.map(queueEntry);
  showToast(`Rendering ${entries.length} WAV ${entries.length === 1 ? "file" : "files"}...`);

  try {
    for (const entry of entries) {
      if (state.cancelRender) throw new Error("Render cancelled");
      entry.status = "rendering";
      entry.progress = 0.02;
      renderExportList();

      const rendered = await pitchShiftRegion(state.audioBuffer, entry.semitones, region, {
        normalize: els.normalize.checked,
        quality: "export",
        onProgress: (value) => {
          entry.progress = Math.max(entry.progress, value);
          renderExportList();
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

    showToast("Batch export complete. Re-download files from the queue any time during this session.", "success");
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
            : entry.status;
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

  els.normalize.addEventListener("change", updateEstimate);
  els.batchGrid.addEventListener("change", updateEstimate);
  els.previewOriginal.addEventListener("click", previewOriginal);
  els.previewTransposed.addEventListener("click", previewTransposed);
  els.stopPreview.addEventListener("click", stopPreview);
  els.downloadOriginal.addEventListener("click", downloadOriginal);
  els.renderBatch.addEventListener("click", renderBatch);
  els.cancelRender.addEventListener("click", () => {
    state.cancelRender = true;
    showToast("Cancelling after the current render step...");
  });
  els.clearExports.addEventListener("click", clearExports);
  document.querySelectorAll("[data-proxy]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = document.querySelector(`#${button.dataset.proxy}`);
      if (target && !target.disabled) target.click();
    });
  });
  window.addEventListener("resize", () => drawWaveform());
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
  updateSemitone(0, false);
  updateMeta();
  updateRegionLabels();
  updateEstimate();
  drawWaveform();
  setMessage("Drop audio here to transpose. Audio stays in your browser.", "success");
  trackEvent("page_view");
}

init();
