# Audio Transposer

A static browser app for transposing authorized audio and downloading original or transposed versions.

## What it does

- Upload an audio/video file, or load a direct audio/video file link.
- Give a clear upload path for authorized YouTube media exported from your own account.
- Preview original vs transposed audio.
- Trim the export region and optionally loop a preview region.
- Render batch semitone exports from `-12` to `+12`.
- Normalize exported WAV files.
- Download the original source file.
- Re-download rendered `WAV` versions during the same browser session.

Uploaded files are decoded and rendered locally in the browser. Pasted media file links may be fetched through the included Cloudflare Pages Function when the remote server does not allow browser CORS.

## Important media note

This project is intentionally limited to media you own or have permission to process. YouTube watch URLs do not expose downloadable audio to browser JavaScript, and this app does not circumvent that. For authorized YouTube content, export media from your own account with YouTube Studio or Google Takeout, then upload the file here.

## Run locally

```bash
npm run dev
```

Open the URL printed by Wrangler.

For a simple static preview without Cloudflare tooling:

```bash
python3 -m http.server 8788
```

## Deploy with Cloudflare Pages

### Git integration

1. Push this folder to GitHub.
2. In Cloudflare, open Workers & Pages.
3. Create a Pages application and connect the GitHub repository.
4. Use production branch `main`.
5. Use build command `exit 0`.
6. Use build output directory `public`.

### Direct upload

```bash
npm run deploy
```

The included GitHub Actions workflow can also deploy by direct upload when manually run after adding these repository secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

## Audio behavior

The static app uses browser-side pitch shifting with overlap-add time scaling so exported WAV files keep the selected trim duration. It does not add a production DSP dependency yet. For studio-grade commercial quality, replace the browser-only engine with a licensed WebAssembly DSP package or backend audio processor.

MP3 export is intentionally disabled until a licensed encoder is added.
