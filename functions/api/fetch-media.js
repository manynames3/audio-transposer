const maxBytes = 500 * 1024 * 1024;

const blockedHosts = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
]);

function jsonError(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    },
  });
}

function isPrivateLiteralHost(hostname) {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "0.0.0.0" || host === "127.0.0.1" || host === "::1") return true;

  const match = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return false;

  const [, a, b] = match.map(Number);
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

function fileNameFromUrl(url) {
  const fallback = "linked-media";
  const name = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || fallback);
  return name.replace(/[^\w.\-() ]+/g, "_").slice(0, 120) || fallback;
}

export function onRequestHead() {
  return new Response(null, {
    status: 405,
    headers: {
      "allow": "GET",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    },
  });
}

export async function onRequestGet({ request }) {
  const requestUrl = new URL(request.url);
  const rawUrl = requestUrl.searchParams.get("url") || "";

  let sourceUrl;
  try {
    sourceUrl = new URL(rawUrl);
  } catch {
    return jsonError("Provide a valid audio or video file URL.");
  }

  if (!["http:", "https:"].includes(sourceUrl.protocol)) {
    return jsonError("Only HTTP and HTTPS media URLs are supported.");
  }

  if (blockedHosts.has(sourceUrl.hostname.toLowerCase())) {
    return jsonError("YouTube watch links are not direct media files.", 422);
  }

  if (isPrivateLiteralHost(sourceUrl.hostname)) {
    return jsonError("Local or private-network URLs are not supported.");
  }

  let response;
  try {
    response = await fetch(sourceUrl.toString(), {
      headers: {
        "accept": "audio/*, video/*, application/octet-stream;q=0.8, */*;q=0.5",
        "user-agent": "AudioTransposer/1.0",
      },
      redirect: "follow",
      cf: { cacheTtl: 0 },
    });
  } catch {
    return jsonError("The media URL could not be reached.", 502);
  }

  if (!response.ok || !response.body) {
    return jsonError("The media URL did not return a downloadable file.", 502);
  }

  const contentLength = Number(response.headers.get("content-length") || "0");
  if (contentLength > maxBytes) {
    return jsonError("That media file is too large for browser processing.", 413);
  }

  const contentType = response.headers.get("content-type") || "application/octet-stream";
  const lowerType = contentType.toLowerCase();
  const looksLikeMedia =
    lowerType.startsWith("audio/") ||
    lowerType.startsWith("video/") ||
    lowerType.includes("octet-stream");

  if (!looksLikeMedia) {
    return jsonError("That link returned a web page, not an audio or video file.", 415);
  }

  const headers = new Headers({
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
    "content-type": contentType,
    "x-source-filename": fileNameFromUrl(sourceUrl),
  });

  const length = response.headers.get("content-length");
  if (length) headers.set("content-length", length);

  return new Response(response.body, { status: 200, headers });
}
