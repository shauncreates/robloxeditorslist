export function tiktokLink(editor = {}) {
  const username = String(editor.tiktok || "")
    .trim()
    .replace(/^@/, "");
  if (/^[A-Za-z0-9._]{1,40}$/.test(username))
    return "https://www.tiktok.com/@" + username;
  try {
    const url = new URL(editor.links?.tiktok);
    if (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      /^(?:www\.)?tiktok\.com$/.test(url.hostname) &&
      /^\/@[A-Za-z0-9._]{1,40}\/?$/.test(url.pathname)
    ) {
      return "https://www.tiktok.com/" + url.pathname.split("/")[1];
    }
  } catch {}
  return "";
}

export function youtubeChannel(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !/^(?:(?:www|m)\.)?youtube\.com$/.test(url.hostname)
    )
      return null;
    const path = decodeURIComponent(url.pathname).replace(/\/$/, "");
    let match = path.match(/^\/channel\/(UC[A-Za-z0-9_-]{22})$/);
    if (match)
      return {
        parameter: "id",
        value: match[1],
        url: "https://www.youtube.com/channel/" + match[1],
        handle: "",
      };
    match = path.match(/^\/@([\p{L}\p{M}\p{N}._·-]{1,100})$/u);
    if (match)
      return {
        parameter: "forHandle",
        value: "@" + match[1],
        url: "https://www.youtube.com/@" + encodeURIComponent(match[1]),
        handle: "@" + match[1],
      };
    match = path.match(/^\/(user|c)\/([A-Za-z0-9._-]{1,100})$/);
    if (match)
      return {
        parameter: match[1] === "user" ? "forUsername" : null,
        value: match[2],
        url: "https://www.youtube.com/" + match[1] + "/" + match[2],
        handle: match[2],
      };
  } catch {}
  return null;
}

export function mainPlatform(editor = {}) {
  if (["TikTok", "YouTube"].includes(editor.main_platform))
    return editor.main_platform;
  return !tiktokLink(editor) && youtubeChannel(editor.links?.youtube)
    ? "YouTube"
    : "TikTok";
}

export function primaryLink(editor = {}) {
  const platform = mainPlatform(editor);
  const channel =
    platform === "YouTube" ? youtubeChannel(editor.links?.youtube) : null;
  const url = platform === "YouTube" ? channel?.url || "" : tiktokLink(editor);
  const handle =
    editor.handle ||
    (platform === "YouTube"
      ? channel?.handle || "YouTube channel"
      : url.split("/").pop() || "");
  return { platform, url, handle };
}

export function avatarRequest(editor) {
  const platform = mainPlatform(editor);
  return {
    editorId: editor.id,
    platform,
    ...(platform === "YouTube"
      ? { channelUrl: editor.links?.youtube || "" }
      : { username: tiktokLink(editor).split("/@")[1] || "" }),
  };
}
