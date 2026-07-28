import test from "node:test";
import assert from "node:assert/strict";

import {
  encodeWav,
  exportFileName,
  formatBytes,
  formatChannels,
  formatDuration,
  formatPreviewTimestamp,
  normalizeChannels,
  ratioFor,
  resampleLinear,
} from "../public/audio-utils.mjs";

test("formats end-user metadata and filenames", () => {
  assert.equal(formatDuration(263.4), "4:23");
  assert.equal(formatPreviewTimestamp(88.45), "1:28.450");
  assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
  assert.equal(formatChannels(2), "Stereo");
  assert.equal(exportFileName("Song Title.mp3", -2), "Song-Title_minus-2st.wav");
  assert.equal(exportFileName("Song Title.mp3", 0), "Song-Title_0st.wav");
  assert.equal(exportFileName("Song Title.mp3", 2), "Song-Title_plus-2st.wav");
});

test("resampling follows semitone ratios", () => {
  assert.equal(ratioFor(12), 2);
  assert.equal(ratioFor(-12), 0.5);

  const input = Float32Array.from([0, 0.25, 0.5, 0.75, 1]);
  const octaveUp = resampleLinear(input, ratioFor(12));
  assert.equal(octaveUp.length, 3);
  assert.deepEqual(Array.from(octaveUp), [0, 0.5, 1]);
});

test("normalization preserves channel balance and targets a safe peak", () => {
  const left = Float32Array.from([0.1, -0.25, 0.5]);
  const right = Float32Array.from([0.05, -0.125, 0.25]);
  normalizeChannels([left, right]);

  const target = Math.pow(10, -0.5 / 20);
  assert.ok(Math.abs(left[2] - target) < 0.00001);
  assert.ok(Math.abs(right[2] - target / 2) < 0.00001);
});

test("WAV encoding writes a valid PCM header and payload size", async () => {
  const rendered = {
    sampleRate: 44100,
    numberOfChannels: 2,
    length: 4,
    duration: 4 / 44100,
    channels: [
      Float32Array.from([0, 0.5, -0.5, 1]),
      Float32Array.from([0, -0.5, 0.5, -1]),
    ],
  };

  const wav = encodeWav(rendered);
  const view = new DataView(await wav.arrayBuffer());
  const text = (offset, length) =>
    String.fromCharCode(...Array.from({ length }, (_, index) => view.getUint8(offset + index)));

  assert.equal(wav.type, "audio/wav");
  assert.equal(wav.size, 44 + rendered.length * rendered.numberOfChannels * 2);
  assert.equal(text(0, 4), "RIFF");
  assert.equal(text(8, 4), "WAVE");
  assert.equal(view.getUint16(20, true), 1);
  assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint32(24, true), 44100);
  assert.equal(view.getUint16(34, true), 16);
});
