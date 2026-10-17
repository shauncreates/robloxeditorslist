import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

test("TikTok verifies and revokes access in Cloudflare without following redirects", async () => {
  const accessToken = "act.fixture+token/with=padding!*%:";
  const bundle = await build({
    stdin: {
      resolveDir: fileURLToPath(new URL("../", import.meta.url)),
      contents: `
        import { proveAccount } from './functions/_tiktok.js';
        export default { async fetch() {
          try {
            const proof = await proveAccount({
              clientKey: 'fixture-key', clientSecret: 'fixture-secret',
              callback: 'https://rel.example.test/api/account/tiktok/callback',
            }, 'fixture-code');
            return Response.json({ok: true, proof});
          } catch (error) { return Response.json({ok: false, status: error.status}); }
        }};
      `,
    },
    bundle: true, format: "esm", platform: "browser", write: false,
  });
  let scenario = "success";
  const paths = [];
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, compatibilityDate: "2026-10-13", script: bundle.outputFiles[0].text,
    outboundService: async request => {
      const url = new URL(request.url);
      assert.equal(url.origin, "https://open.tiktokapis.com");
      paths.push(url.pathname);
      if (url.pathname.includes(scenario + "/")) return new Response(null, {
        status: 302, headers: {Location: "https://unexpected.invalid/collect"},
      });
      if (url.pathname === "/v2/oauth/token/") {
        const body = new URLSearchParams(await request.text());
        assert.equal(body.get("code"), "fixture-code");
        assert.equal(body.get("client_secret"), "fixture-secret");
        return Response.json({
          access_token: accessToken, open_id: "fixture-open-id", token_type: "Bearer",
          scope: "user.info.basic,user.info.profile,user.info.stats",
        });
      }
      if (url.pathname === "/v2/user/info/") {
        assert.equal(request.headers.get("Authorization"), "Bearer " + accessToken);
        return Response.json({data: {user: {
          open_id: "fixture-open-id", username: "fixture_editor", display_name: "Fixture editor", follower_count: 12500,
        }}, error: {code: "ok"}});
      }
      assert.equal(url.pathname, "/v2/oauth/revoke/");
      assert.equal(new URLSearchParams(await request.text()).get("token"), accessToken);
      return new Response(null, {status: 204});
    },
  }));
  try {
    const expected = ["/v2/oauth/token/", "/v2/user/info/", "/v2/oauth/revoke/"];
    assert.deepEqual(await (await mf.dispatchFetch("http://localhost/")).json(), {
      ok: true, proof: {open_id: "fixture-open-id", username: "fixture_editor", display_name: "Fixture editor", followers: 12500},
    });
    assert.deepEqual(paths, expected);
    for (scenario of ["token", "info", "revoke"]) {
      paths.length = 0;
      assert.deepEqual(await (await mf.dispatchFetch("http://localhost/")).json(), {ok: false, status: 502});
      assert.deepEqual(paths, scenario === "token" ? expected.slice(0, 1) : expected);
    }
  } finally { await mf.dispose(); }
});
