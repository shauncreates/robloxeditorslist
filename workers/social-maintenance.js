import { maintainYoutube } from "../functions/_youtube.js";
import { exchangeRpc } from "../functions/_tiktok.js";
import { audienceRpc } from "../functions/_audience.js";

export default {
  async scheduled(_event, env) {
    const outcomes = await Promise.allSettled([
      maintainYoutube(env),
      exchangeRpc(env, { p_action: "cleanup" }),
      audienceRpc(env, "rel_audience_cleanup"),
    ]);
    if (outcomes.some((outcome) => outcome.status === "rejected"))
      throw new Error("Social connection maintenance needs attention.");
  },
  async fetch() {
    return new Response("Not found", { status: 404 });
  },
};
