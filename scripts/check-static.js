const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const html = read("public/index.html");
const app = read("public/app.js");
const manifest = JSON.parse(read("public/manifest.webmanifest"));

const requiredHtml = [
  'id="wave-time-axis"',
  'id="meta-channels"',
  'id="original-progress"',
  'id="transposed-progress"',
  'id="swap-preview"',
  'id="volume"',
  'rel="manifest"',
];

const forbiddenHtml = ["01:28.450", "<span>Stereo</span>", "4:30</span>", "data-proxy", "#settings-panel", "Pro features"];
const requiredApp = ["updateTimeAxis", "formatChannels", "attachWaveformPointerEvents", "zoomWaveform", "switchPreviewMode"];

function assert(condition, message) {
  if (!condition) {
    console.error(message);
    process.exitCode = 1;
  }
}

requiredHtml.forEach((needle) => assert(html.includes(needle), `Missing expected HTML: ${needle}`));
forbiddenHtml.forEach((needle) => assert(!html.includes(needle), `Found stale placeholder HTML: ${needle}`));
requiredApp.forEach((needle) => assert(app.includes(needle), `Missing expected app behavior hook: ${needle}`));

assert(manifest.name === "Audio Transposer", "Manifest name mismatch");
assert(Array.isArray(manifest.icons) && manifest.icons.length > 0, "Manifest must include an icon");

if (process.exitCode) process.exit(process.exitCode);
console.log("Static checks passed");
