# Audio Transposer

Browser-based audio transposition for authorized audio and video files.

Live app: https://audio-transposer.pages.dev

## What It Does

- Upload an audio or video file from your device.
- Paste a direct audio/video file link, with a Cloudflare Pages Function fallback for links blocked by browser CORS.
- Estimate BPM after decoding supported audio, including MP3 files.
- Preview original vs transposed audio.
- Seek, skip by 10 seconds, switch A/B preview, zoom/Fit the waveform, and adjust preview volume.
- Choose semitone changes from `-12` to `+12`.
- Export the current pitch in one action or download the original source unchanged.
- Export multiple semitone versions as WAV files.
- Trim the export region and loop a preview region with visible range controls and waveform handles.
- Normalize exported audio.
- Re-download completed exports during the same browser session.
- Use a mobile export action bar and bottom sheet without scrolling past the full editor.
- Install as a standalone PWA with an offline-cached app shell in supported browsers.

Uploaded files are decoded and rendered locally in the browser. Pasted media links may be fetched through the included Cloudflare Pages Function so the browser can decode them.

## Supported Inputs

Works well with:

- Local audio/video files such as MP3, WAV, M4A, AAC, OGG, WebM, and MP4.
- Direct media file URLs such as `https://example.com/song.mp3`.
- Direct media links that return `audio/*`, `video/*`, or file-like binary responses.

Not supported as direct inputs:

- YouTube watch links such as `https://youtube.com/watch?...`.
- `youtu.be` share links.
- Generic web pages that contain a player but are not themselves media files.
- Private-network or localhost URLs.

YouTube-style real-time playback transposition requires a different architecture, such as a browser extension or explicit live-capture workflow.

## Run Locally

```bash
npm run dev
```

Open the URL printed by Wrangler.

For a static-only preview without the link importer function:

```bash
python3 -m http.server 8788
```

## Verify

```bash
npm test
```

The test command runs JavaScript syntax and static UI/PWA checks plus dependency-free unit tests for semitone ratios, metadata formatting, normalization, export filenames, and WAV encoding.

## Deploy

Direct upload to Cloudflare Pages:

```bash
npm run deploy
```

Cloudflare Pages settings for Git integration:

- Production branch: `main`
- Build command: `exit 0`
- Build output directory: `public`
- Functions directory: `functions`

The included GitHub Actions workflow can deploy by direct upload when manually run after adding these repository secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

## Project Notes

The current audio engine uses browser-side Web Audio rendering with overlap-add time scaling so exported WAV files keep the selected trim duration. BPM detection is an onset-based estimate from the decoded audio buffer.

MP3 export, ZIP download-all, and WASM-grade time stretching are intentionally left out until the project chooses and reviews production dependencies and licensing.

This project is intended for media you own or have permission to process.
