import { HttpError } from "./_lib.js";
import { boundedBytes, rasterMime } from "./_remote-image.js";

const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
export const validChannelId = (value) => CHANNEL_ID.test(value || "");

export async function lookupChannel(env, channel) {
  if (!env.REL_YOUTUBE_API_KEY)
    throw new HttpError(
      503,
      "YouTube picture fetching is not configured yet. Paste a profile picture URL instead.",
    );
  if (!channel?.parameter)
    throw new HttpError(
      400,
      "Use a YouTube @handle, /channel/ID or /user/name channel URL, rather than a video or /c/ link.",
    );
  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.search = new URLSearchParams({
    part: "snippet",
    fields: "items(id,snippet/thumbnails)",
    [channel.parameter]: channel.value,
    key: env.REL_YOUTUBE_API_KEY,
  }).toString();
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new HttpError(
      502,
      "YouTube could not provide the channel picture. Check the channel link or try again later.",
    );
  }
  const data = JSON.parse(
    new TextDecoder().decode(await boundedBytes(response, 64000)),
  );
  const item = data.items?.[0];
  if (!validChannelId(item?.id))
    throw new HttpError(404, "That YouTube channel was not found.");
  const thumbnails = item.snippet?.thumbnails;
  const source = new URL(
    thumbnails?.high?.url ||
      thumbnails?.medium?.url ||
      thumbnails?.default?.url,
  );
  if (
    source.protocol !== "https:" ||
    source.username ||
    source.password ||
    source.port ||
    !["yt3.ggpht.com", "yt3.googleusercontent.com"].includes(source.hostname)
  ) {
    throw new HttpError(
      502,
      "YouTube returned an unsupported picture address.",
    );
  }
  return { id: item.id, source };
}

export function youtubeAvatarUrl(request, id) {
  return new URL(
    "/api/youtube-avatar?channel=" + encodeURIComponent(id),
    request.url,
  ).href;
}

export async function channelPicture(
  env,
  request,
  channel,
  resolved = null,
  beforeLookup = null,
) {
  const cache = globalThis.caches?.default;
  const cacheKey = new Request(youtubeAvatarUrl(request, channel.value));
  const hit = cache && (await cache.match(cacheKey));
  if (hit) return hit;
  if (beforeLookup) await beforeLookup();
  const { source } = resolved || (await lookupChannel(env, channel));
  const image = await fetch(source, {
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (!image.ok)
    throw new HttpError(502, "The YouTube picture could not be downloaded.");
  const bytes = await boundedBytes(image, 5 * 1024 * 1024);
  const mime = rasterMime(bytes, image.headers.get("Content-Type") || "");
  // Daily refresh avoids keeping a permanent copy of YouTube API data in Storage.
  const response = new Response(bytes, {
    headers: {
      "Content-Type": mime,
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
  if (cache) await cache.put(cacheKey, response.clone());
  return response;
}
