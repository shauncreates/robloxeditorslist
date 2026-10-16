import { HttpError } from "../_lib.js";
import { channelPicture, validChannelId } from "../_youtube-avatar.js";
import { readSite } from "../_site.js";

export async function onRequestGet({ request, env }) {
  const id = new URL(request.url).searchParams.get("channel");
  if (!validChannelId(id))
    throw new HttpError(400, "Invalid YouTube channel ID.");
  return channelPicture(
    env,
    request,
    { parameter: "id", value: id },
    null,
    async () => {
      const site = await readSite(env);
      const listed = site.editors.some((editor) => {
        try {
          const url = new URL(editor.thumb);
          return (
            url.origin === new URL(request.url).origin &&
            url.pathname === "/api/youtube-avatar" &&
            url.searchParams.get("channel") === id
          );
        } catch {
          return false;
        }
      });
      if (!listed)
        throw new HttpError(404, "No editor uses that YouTube picture.");
    },
  );
}
