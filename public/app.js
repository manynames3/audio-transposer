const state = {
  audioContext: null,
  audioBuffer: null,
  sourceBlob: null,
  sourceName: "",
  sourceUrl: "",
  exports: [],
  activeNode: null,
  playStartedAt: 0,
  renderedDuration: 0,
  animationFrame: 0,
  isPlaying: false,
};

const els = {
  form: document.querySelector("#url-form"),
  url: document.querySelector("#source-url"),
  file: document.querySelector("#file-input"),
  dropZone: document.querySelector("#drop-zone"),
  message: document.querySelector("#message"),
  metaName: document.querySelector("#meta-name"),
  metaDuration: document.querySelector("#meta-duration"),
  metaRate: document.querySelector("#meta-rate"),
  canvas: document.querySelector("#waveform"),
  emptyWaveform: document.querySelector("#empty-waveform"),
  semitoneRange: document.querySelector("#semitones"),
  semitoneNumber: document.querySelector("#semitone-number"),
  semitoneReadout: document.querySelector("#semitone-readout"),
  previewButton: document.querySelector("#preview-button"),
  previewIcon: document.querySelector("#preview-icon"),
  progress: document.querySelector("#progress"),
  stepDown: document.querySelector("#step-down"),
  stepUp: document.querySelector("#step-up"),
  downloadOriginal: document.querySelector("#download-original"),
  renderCurrent: document.querySelector("#render-current"),
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

function setMessage(text, tone = "") {
  els.message.textContent = text;
  els.message.className = `message ${tone}`.trim();
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "--";
  const total = Math.round(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
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

function cleanName(name) {
  const base = name.replace(/\.[^/.]+$/, "");
  return base.replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "audio";
}

function setControlsEnabled(enabled) {
  els.previewButton.disabled = !enabled;
  els.downloadOriginal.disabled = !enabled || !state.sourceBlob;
  els.renderCurrent.disabled = !enabled;
}

function updateMeta() {
  if (!state.audioBuffer) {
    els.metaName.textContent = "No source loaded";
    els.metaDuration.textContent = "--";
    els.metaRate.textContent = "--";
    return;
  }

  els.metaName.textContent = state.sourceName;
  els.metaDuration.textContent = formatDuration(state.audioBuffer.duration);
  els.metaRate.textContent = `${state.audioBuffer.sampleRate.toLocaleString()} Hz`;
}

function updateSemitone(value) {
  const bounded = Math.max(-12, Math.min(12, Math.round(Number(value))));
  els.semitoneRange.value = String(bounded);
  els.semitoneNumber.value = String(bounded);
  els.semitoneReadout.textContent = `${bounded > 0 ? "+" : ""}${bounded} st`;
  document.querySelectorAll("[data-preset]").forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.preset) === bounded);
  });
}

function isYouTubeUrl(value) {
  try {
    const url = new URL(value);
    return youtubeHosts.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

async function decodeBlob(blob, name, sourceUrl = "") {
  stopPreview();
  setMessage("Decoding audio...");
  const context = getAudioContext();
  const arrayBuffer = await blob.arrayBuffer();
  const decoded = await context.decodeAudioData(arrayBuffer.slice(0));

  state.audioBuffer = decoded;
  state.sourceBlob = blob;
  state.sourceName = name;
  state.sourceUrl = sourceUrl;
  state.exports = [];

  updateMeta();
  setControlsEnabled(true);
  drawWaveform(decoded);
  renderExportList();
  setMessage("Audio loaded. Choose a semitone shift, preview it, then download a WAV.", "success");
}

async function loadFile(file) {
  if (!file) return;
  if (!file.type.startsWith("audio/") && !file.type.startsWith("video/")) {
    setMessage("Choose an audio file, or a video file with an audio track.", "error");
    return;
  }

  try {
    await decodeBlob(file, file.name);
  } catch (error) {
    console.error(error);
    setMessage("This browser could not decode that file. Try MP3, WAV, M4A, WebM, or MP4.", "error");
  }
}

async function loadUrl(value) {
  if (!value) {
    setMessage("Paste a direct audio URL or upload a file.", "error");
    return;
  }

  if (isYouTubeUrl(value)) {
    setMessage(
      "Upload an exported YouTube audio or video file instead. Use YouTube Studio or Google Takeout for media from your own account.",
      "error",
    );
    return;
  }

  try {
    setMessage("Fetching direct audio URL...");
    const response = await fetch(value, { mode: "cors" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const contentType = blob.type || response.headers.get("content-type") || "";
    if (!contentType.includes("audio") && !contentType.includes("video") && blob.size === 0) {
      throw new Error("URL did not return media");
    }
    const url = new URL(value);
    const name = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "direct-audio");
    await decodeBlob(blob, name, value);
  } catch (error) {
    console.error(error);
    setMessage(
      "Could not load that URL. The server must provide a direct audio file and allow browser CORS access.",
      "error",
    );
  }
}

function drawWaveform(buffer) {
  const canvas = els.canvas;
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);

  if (!buffer) {
    els.emptyWaveform.hidden = false;
    return;
  }

  els.emptyWaveform.hidden = true;
  const channel = buffer.getChannelData(0);
  const samplesPerPixel = Math.max(1, Math.floor(channel.length / width));
  const center = height / 2;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(20, 33, 31, 0.08)";
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 48; y < height; y += 48) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  const gradient = ctx.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, "#087f79");
  gradient.addColorStop(0.58, "#0d9b8f");
  gradient.addColorStop(1, "#e45f4f");

  ctx.strokeStyle = gradient;
  ctx.lineWidth = 2;
  ctx.beginPath();

  for (let x = 0; x < width; x += 1) {
    let min = 1;
    let max = -1;
    const start = x * samplesPerPixel;
    for (let i = 0; i < samplesPerPixel && start + i < channel.length; i += 1) {
      const value = channel[start + i];
      if (value < min) min = value;
      if (value > max) max = value;
    }
    ctx.moveTo(x, center + min * center * 0.82);
    ctx.lineTo(x, center + max * center * 0.82);
  }

  ctx.stroke();
}

function stopPreview() {
  if (state.activeNode) {
    try {
      state.activeNode.stop();
    } catch {
      // The node may have already ended.
    }
    state.activeNode.disconnect();
  }
  state.activeNode = null;
  state.isPlaying = false;
  cancelAnimationFrame(state.animationFrame);
  els.previewIcon.setAttribute("d", "M8 5v14l11-7-11-7Z");
  els.previewButton.querySelector("span").textContent = "Preview";
  els.progress.value = 0;
}

async function togglePreview() {
  if (!state.audioBuffer) return;
  if (state.isPlaying) {
    stopPreview();
    return;
  }

  const context = getAudioContext();
  await context.resume();
  const source = context.createBufferSource();
  source.buffer = state.audioBuffer;
  source.playbackRate.value = ratioFor(semitones());
  source.connect(context.destination);
  source.onended = stopPreview;
  source.start();

  state.activeNode = source;
  state.isPlaying = true;
  state.playStartedAt = context.currentTime;
  state.renderedDuration = state.audioBuffer.duration / source.playbackRate.value;
  els.previewIcon.setAttribute("d", "M7 5h3v14H7zM14 5h3v14h-3z");
  els.previewButton.querySelector("span").textContent = "Stop";
  tickProgress();
}

function tickProgress() {
  if (!state.isPlaying || !state.audioContext) return;
  const elapsed = state.audioContext.currentTime - state.playStartedAt;
  els.progress.value = Math.min(100, (elapsed / state.renderedDuration) * 100);
  state.animationFrame = requestAnimationFrame(tickProgress);
}

function resampleBuffer(buffer, semitoneValue) {
  const ratio = ratioFor(semitoneValue);
  const outputLength = Math.max(1, Math.floor(buffer.length / ratio));
  const output = {
    sampleRate: buffer.sampleRate,
    numberOfChannels: buffer.numberOfChannels,
    length: outputLength,
    duration: outputLength / buffer.sampleRate,
    channels: [],
  };

  for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex += 1) {
    const input = buffer.getChannelData(channelIndex);
    const channel = new Float32Array(outputLength);
    for (let i = 0; i < outputLength; i += 1) {
      const sourceIndex = i * ratio;
      const left = Math.floor(sourceIndex);
      const right = Math.min(input.length - 1, left + 1);
      const fraction = sourceIndex - left;
      channel[i] = input[left] * (1 - fraction) + input[right] * fraction;
    }
    output.channels.push(channel);
  }

  return output;
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

function renderCurrent() {
  if (!state.audioBuffer) return;
  stopPreview();
  const value = semitones();
  setMessage(`Rendering ${value > 0 ? "+" : ""}${value} semitone WAV...`);

  window.setTimeout(() => {
    try {
      const rendered = resampleBuffer(state.audioBuffer, value);
      const blob = encodeWav(rendered);
      const fileName = `${cleanName(state.sourceName)}_${value > 0 ? "+" : ""}${value}st.wav`;
      const url = URL.createObjectURL(blob);
      const entry = {
        id: crypto.randomUUID(),
        semitones: value,
        fileName,
        size: blob.size,
        duration: rendered.duration,
        url,
      };
      state.exports.unshift(entry);
      renderExportList();
      downloadBlob(blob, fileName);
      setMessage("Rendered and downloaded the selected transposed WAV.", "success");
    } catch (error) {
      console.error(error);
      setMessage("Rendering failed. Try a shorter audio file or a smaller source file.", "error");
    }
  }, 40);
}

function renderExportList() {
  if (!state.exports.length) {
    els.versionList.innerHTML = `
      <div class="empty-list">
        <span>No exports yet</span>
        <small>Choose a semitone shift and render a WAV.</small>
      </div>
    `;
    return;
  }

  els.versionList.replaceChildren(
    ...state.exports.map((entry) => {
      const item = document.createElement("article");
      item.className = "version-item";
      item.innerHTML = `
        <header>
          <div>
            <strong>${entry.fileName}</strong>
            <small>${formatDuration(entry.duration)} · ${formatBytes(entry.size)}</small>
          </div>
          <span class="version-badge">${entry.semitones > 0 ? "+" : ""}${entry.semitones}</span>
        </header>
        <a href="${entry.url}" download="${entry.fileName}">Download WAV</a>
      `;
      return item;
    }),
  );
}

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  loadUrl(els.url.value.trim());
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

els.semitoneRange.addEventListener("input", () => {
  updateSemitone(els.semitoneRange.value);
  stopPreview();
});

els.semitoneNumber.addEventListener("input", () => {
  updateSemitone(els.semitoneNumber.value);
  stopPreview();
});

els.stepDown.addEventListener("click", () => {
  updateSemitone(semitones() - 1);
  stopPreview();
});

els.stepUp.addEventListener("click", () => {
  updateSemitone(semitones() + 1);
  stopPreview();
});

document.querySelectorAll("[data-preset]").forEach((button) => {
  button.addEventListener("click", () => {
    updateSemitone(button.dataset.preset);
    stopPreview();
  });
});

els.previewButton.addEventListener("click", togglePreview);
els.downloadOriginal.addEventListener("click", downloadOriginal);
els.renderCurrent.addEventListener("click", renderCurrent);

window.addEventListener("resize", () => drawWaveform(state.audioBuffer));

updateSemitone(0);
setControlsEnabled(false);
drawWaveform(null);
