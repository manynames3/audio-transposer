# Audio Transposer

A static browser app for transposing authorized audio and downloading original or transposed versions.

## What it does

- Upload an audio file, or load a CORS-enabled direct audio URL.
- Recognize YouTube URLs without bypassing YouTube download restrictions.
- Preview semitone changes from `-12` to `+12`.
- Download the original source file.
- Render and download transposed `WAV` versions in the browser.

All decoding and rendering happens locally in the browser. No source audio is uploaded to a server.

## Important media note

This project is intentionally limited to media you own or have permission to process. YouTube watch URLs do not expose downloadable audio to browser JavaScript, and this app does not circumvent that. For authorized YouTube content, export your own media from YouTube Studio or Google Takeout, then upload the file here.

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

The static app uses browser-native resampling. That changes pitch and duration together: higher semitone values create shorter files, lower semitone values create longer files. For production-grade tempo-preserving pitch shifting, connect this UI to a licensed DSP backend or WebAssembly audio engine.
