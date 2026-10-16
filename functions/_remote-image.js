import { HttpError } from "./_lib.js";

export async function boundedBytes(response, limit) {
  if (Number(response.headers.get("Content-Length")) > limit) {
    await response.body?.cancel();
    throw new HttpError(502, "The remote file is too large.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new HttpError(502, "The remote file is empty.");
  let length = 0;
  const chunks = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new HttpError(502, "The remote file is too large.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!length) throw new HttpError(502, "The remote file is empty.");
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export function rasterMime(bytes, declared) {
  const starts = signature => signature.every((byte, index) => bytes[index] === byte);
  const mime = starts([137,80,78,71,13,10,26,10]) ? "image/png"
    : starts([255,216,255]) ? "image/jpeg"
    : starts([82,73,70,70]) && [87,69,66,80].every((byte, index) => bytes[index + 8] === byte) ? "image/webp" : null;
  if (!mime || mime !== declared.split(";")[0].trim().toLowerCase()) {
    throw new HttpError(502, "Use a PNG, JPEG or WebP profile picture.");
  }
  return mime;
}

export async function tiktokPage(username, headers) {
  let url = new URL("https://www.tiktok.com/@" + username);
  const signal = AbortSignal.timeout(10000);
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(url, { headers, redirect:"manual", signal });
    if (![301,302,303,307,308].includes(response.status)) {
      if (!response.ok) throw new HttpError(502, "TikTok could not provide this profile.");
      return new TextDecoder().decode(await boundedBytes(response, 2 * 1024 * 1024));
    }
    const location = response.headers.get("Location");
    await response.body?.cancel();
    if (!location) break;
    url = new URL(location, url);
    if (url.protocol !== "https:" || !/(^|\.)tiktok\.com$/i.test(url.hostname) ||
        url.username || url.password || (url.port && url.port !== "443")) break;
  }
  throw new HttpError(502, "TikTok redirected to an unsupported profile location.");
}
