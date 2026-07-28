export function ratioFor(semitoneValue) {
  return Math.pow(2, Number(semitoneValue) / 12);
}

export function formatSemitone(value) {
  const numeric = Number(value);
  return `${numeric > 0 ? "+" : ""}${numeric}`;
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "--";
  const total = Math.max(0, Math.round(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export function formatAxisTime(seconds) {
  if (!Number.isFinite(seconds)) return "--";
  if (seconds < 60) return `0:${String(Math.round(seconds)).padStart(2, "0")}`;
  return formatDuration(seconds);
}

export function formatPreciseTime(seconds) {
  if (!Number.isFinite(seconds)) return "--";
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return formatDuration(seconds);
}

export function formatPreviewTimestamp(seconds) {
  if (!Number.isFinite(seconds)) return "--";
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const mins = Math.floor(totalMs / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${mins}:${String(secs).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "--";
  const units = ["B", "KB", "MB", "GB"];
  let value = Math.max(0, bytes);
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function formatChannels(count) {
  if (!Number.isFinite(count) || count <= 0) return "--";
  if (count === 1) return "Mono";
  if (count === 2) return "Stereo";
  return `${count} channels`;
}

export function cleanName(name) {
  const base = String(name || "").replace(/\.[^/.]+$/, "");
  return base.replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "audio";
}

export function exportFileName(sourceName, semitoneValue) {
  const numeric = Number(semitoneValue);
  const base = cleanName(sourceName || "audio");
  const suffix =
    numeric === 0
      ? "0st"
      : `${numeric > 0 ? "plus" : "minus"}-${Math.abs(numeric)}st`;
  return `${base}_${suffix}.wav`;
}

export function resampleLinear(input, ratio) {
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

export function normalizeChannels(channels) {
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

export function encodeWav(rendered) {
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
