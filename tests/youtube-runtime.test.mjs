import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

test("YouTube requests work in Cloudflare and never follow provider redirects", async () => {
  const requests = [];
  const bundle = await build({
    stdin: {
      resolveDir: fileURLToPath(new URL("../", import.meta.url)),
      contents: `
        import { providerJson, encryptToken, revokeToken } from './functions/_youtube.js';
        export default { async fetch(request) {
          const action = new URL(request.url).pathname;
          try {
            if (action.startsWith('/revoke')) {
              const env = {REL_GOOGLE_TOKEN_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'};
              await revokeToken(env, await encryptToken(env, 'fixture-refresh-token'));
            } else {
              await providerJson('https://oauth2.googleapis.com/token', {
                method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                body: 'code=fixture-code',
              });
            }
            return Response.json({ok: true});
          } catch (error) {
            return Response.json({ok: false, status: error.status, provider_status: error.providerStatus});
          }
        }};
      `,
    },
    bundle: true, format: "esm", platform: "browser", write: false,
  });
  let scenario = "success";
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    compatibilityDate: "2026-10-13",
    script: bundle.outputFiles[0].text,
    outboundService: async request => {
      requests.push({url: request.url, method: request.method, body: await request.text()});
      assert.equal(new URL(request.url).origin, "https://oauth2.googleapis.com");
      if (scenario === "redirect") return new Response(null, {
        status: 302, headers: {Location: "https://unexpected.invalid/collect"},
      });
      if (scenario === "denied") return Response.json({error: "invalid_grant"}, {status: 400});
      return Response.json({access_token: "fixture-access-token"});
    },
  }));
  try {
    for (const path of ["/token", "/revoke"]) {
      scenario = "success";
      const before = requests.length;
      assert.deepEqual(await (await mf.dispatchFetch("http://localhost" + path)).json(), {ok: true});
      assert.equal(requests.length, before + 1);
      assert.equal(requests.at(-1).method, "POST");
      assert.equal(requests.at(-1).body, path === "/token" ? "code=fixture-code" : "token=fixture-refresh-token");

      scenario = "redirect";
      const redirectBefore = requests.length;
      const redirect = await (await mf.dispatchFetch("http://localhost" + path)).json();
      assert.equal(redirect.ok, false);
      assert.equal(redirect.status, path === "/token" ? 502 : 503);
      if (path === "/token") assert.equal(redirect.provider_status, 302);
      assert.equal(requests.length, redirectBefore + 1);
    }
    scenario = "denied";
    assert.deepEqual(await (await mf.dispatchFetch("http://localhost/token")).json(), {
      ok: false, status: 502, provider_status: 400,
    });
  } finally {
    await mf.dispose();
  }
});
