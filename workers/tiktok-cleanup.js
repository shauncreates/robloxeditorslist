import { exchangeRpc } from "../functions/_tiktok.js";

export default {
  async scheduled(_event, env) {
    await exchangeRpc(env, { p_action: "cleanup" });
  },
  async fetch() {
    return new Response("Not found", { status: 404 });
  },
};
