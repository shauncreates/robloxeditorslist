import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

test("TikTok pictures download and upload in Cloudflare without following image or storage redirects", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: fileURLToPath(new URL("../", import.meta.url)),
      contents: `
        import { onRequestPost } from './functions/api/avatar.js';
        import { onRequest } from './functions/api/_middleware.js';
        export default { fetch(request, env) {
          return onRequest({request, next: () => onRequestPost({request, env})});
        }};
      `,
    },
    bundle: true, format: "esm", platform: "browser", write: false,
  });
  const png = Uint8Array.from(Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
    "base64",
  ));
  const accountId = "00000000-0000-4000-8000-000000000001";
  const requests = [];
  let scenario = "success";
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, compatibilityDate: "2026-10-13", script: bundle.outputFiles[0].text,
    bindings: {
      SUPABASE_URL: "https://supabase.fixture.invalid",
      SUPABASE_PUBLISHABLE_KEY: "fixture-public",
      SUPABASE_SERVICE_ROLE_KEY: "fixture-server",
    },
    outboundService: async request => {
      const url = new URL(request.url);
      requests.push({origin: url.origin, path: url.pathname, method: request.method});
      if (url.origin === "https://supabase.fixture.invalid") {
        if (url.pathname === "/auth/v1/user") {
          assert.equal(request.headers.get("Authorization"), "Bearer fixture-session");
          return Response.json({id: accountId, email: "member@example.test", email_confirmed_at: "2026-10-01T00:00:00Z"});
        }
        if (url.pathname === "/rest/v1/rpc/rel_context")
          return Response.json({id: accountId, roles: ["member"], editor_id: "fixture-editor"});
        if (url.pathname === "/rest/v1/rpc/rel_take_rate_limit") {
          assert.equal(request.headers.get("Authorization"), "Bearer fixture-server");
          const body = await request.json();
          assert.equal(body.p_action, "avatar");
          assert.match(body.p_subject_hash, /^[a-f0-9]{64}$/);
          return Response.json({allowed: scenario !== "limited", retry_after: 60});
        }
        assert.match(url.pathname, /^\/storage\/v1\/object\/editor-avatars\/avatars\/fixture-editor\/[a-f0-9-]+$/);
        assert.equal(request.method, "POST");
        assert.equal(request.headers.get("Authorization"), "Bearer fixture-server");
        assert.equal(request.headers.get("apikey"), "fixture-server");
        assert.equal(request.headers.get("Content-Type"), "image/png");
        assert.deepEqual(new Uint8Array(await request.arrayBuffer()), png);
        return scenario === "storage-redirect"
          ? new Response(null, {status: 307, headers: {Location: "https://unexpected.invalid/collect"}})
          : Response.json({ok: true}, {status: 201});
      }
      assert.equal(request.headers.has("Authorization"), false);
      assert.equal(request.headers.has("apikey"), false);
      if (url.origin === "https://www.tiktok.com") {
        assert.equal(url.pathname, "/@fixture_editor");
        if (scenario === "profile-redirect" && !url.search)
          return new Response(null, {status: 302, headers: {Location: "/@fixture_editor?lang=en"}});
        if (scenario === "blocked-profile") return new Response("Unavailable", {status: 403});
        if (scenario === "no-picture") return new Response("Profile unavailable");
        return new Response(JSON.stringify({avatarLarger: scenario === "hostile-picture"
          ? "https://p16.tiktokcdn.com.unexpected.invalid/image.png"
          : "https://p16.tiktokcdn.com/fixture-avatar.png"}));
      }
      assert.equal(url.href, "https://p16.tiktokcdn.com/fixture-avatar.png");
      if (scenario === "image-redirect")
        return new Response(null, {status: 302, headers: {Location: "https://unexpected.invalid/collect"}});
      if (scenario === "wrong-type") return new Response("<svg/>", {headers: {"Content-Type": "image/svg+xml"}});
      if (scenario === "oversized") return new Response(png, {headers: {"Content-Type": "image/png", "Content-Length": String(5 * 1024 * 1024 + 1)}});
      return new Response(png, {headers: {"Content-Type": "image/png"}});
    },
  }));
  const fetchPicture = (body = {}, headers = {}) => mf.dispatchFetch("http://localhost/api/avatar", {
    method: "POST",
    headers: {origin: "http://localhost", "Content-Type": "application/json", cookie: "rel_access=fixture-session", ...headers},
    body: JSON.stringify({editorId: "fixture-editor", platform: "TikTok", username: "fixture_editor", ...body}),
  });
  try {
    for (scenario of ["success", "profile-redirect"]) {
      requests.length = 0;
      const response = await fetchPicture();
      const result = await response.json();
      assert.equal(response.status, 200, JSON.stringify(result));
      assert.equal(result.ok, true);
      assert.match(result.url, /^https:\/\/supabase\.fixture\.invalid\/storage\/v1\/object\/public\/editor-avatars\/avatars\/fixture-editor\/[a-f0-9-]+\?v=\d+$/);
      assert.equal(requests.filter(r => r.origin === "https://www.tiktok.com").length, scenario === "success" ? 1 : 2);
      assert.equal(requests.filter(r => r.path.startsWith("/storage/")).length, 1);
      assert.ok(requests.every(r => r.method === "GET" || r.path === "/rest/v1/rpc/rel_context" || r.path === "/rest/v1/rpc/rel_take_rate_limit" || r.path.startsWith("/storage/")));
    }
    for (const [name, status, storageCalls] of [
      ["image-redirect", 502, 0], ["storage-redirect", 502, 1],
      ["blocked-profile", 502, 0], ["no-picture", 404, 0],
      ["hostile-picture", 502, 0], ["wrong-type", 502, 0],
      ["oversized", 502, 0], ["limited", 429, 0],
    ]) {
      scenario = name;
      requests.length = 0;
      assert.equal((await fetchPicture()).status, status, scenario);
      assert.equal(requests.filter(r => r.path.startsWith("/storage/")).length, storageCalls, scenario);
      assert.ok(!requests.some(r => r.origin === "https://unexpected.invalid"));
      if (scenario === "limited") assert.ok(requests.every(r => r.origin === "https://supabase.fixture.invalid"));
    }
    scenario = "success";
    requests.length = 0;
    assert.equal((await fetchPicture({}, {cookie: ""})).status, 401);
    assert.equal(requests.length, 0);
    assert.equal((await fetchPicture({}, {origin: "https://elsewhere.invalid"})).status, 403);
    assert.equal(requests.length, 0);
    assert.equal((await fetchPicture({editorId: "someone-else"})).status, 403);
    assert.ok(requests.every(r => r.origin === "https://supabase.fixture.invalid"));
  } finally {
    await mf.dispose();
  }
});
