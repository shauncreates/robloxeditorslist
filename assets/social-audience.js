export function countText(count, platform) {
  if (!Number.isSafeInteger(count) || count < 0)
    return (
      "No public " +
      (platform === "youtube" ? "subscriber" : "follower") +
      " count is available. Your account can still be connected."
    );
  return (
    new Intl.NumberFormat("en-GB").format(count) +
    (platform === "youtube"
      ? " subscribers (rounded by YouTube)."
      : " TikTok followers.")
  );
}
export const publicationNotice =
  "Confirming publishes this count and its update date in Popularity if your REL account is linked to an editor in the overall rankings. Reconnect to update it; counts expire after 29 days.";
