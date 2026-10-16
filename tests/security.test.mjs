import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fixture, ids } from "./auth-fixture.mjs";
import { mockService, env } from "./mock-service.mjs";
import { boundedBytes, rasterMime, tiktokPage } from "../functions/_remote-image.js";
import { inlineScriptHashes, secureResponse } from "../functions/_security.js";
import { enforceRateLimit } from "../functions/_rate-limit.js";

const application = { displayName:"Test applicant", platform:"YouTube", profileUrl:"https://youtube.com/@fixture",
  software:"Blender", styles:["Test style"], examplesUrl:"https://example.test/showreel" };
const request = (service, path, body, headers = {}) => service.handle(new Request("https://rel.example.test" + path, {
  method:"POST", headers:{ origin:"https://rel.example.test", "Content-Type":"application/json", ...headers },
  body:JSON.stringify(body),
}));

test("persistent limits enforce concurrent budgets, isolate subjects and keep existing data unchanged", async () => {
  const { db, rpc, asUser } = await fixture();
  try {
    const before = await rpc(ids.owner, "rel_site");
    const take = (action, hash) => db.transaction(async tx => {
      await tx.exec("set local role service_role");
      return (await tx.query("select public.rel_take_rate_limit($1,$2) as result", [action,hash])).rows[0].result;
    });
    const hash = "a".repeat(64);
    const results = await Promise.all(Array.from({length:8}, () => take("signup", hash)));
    assert.equal(results.filter(result => result.allowed).length, 5);
    assert.ok(results.every(result => result.retry_after >= 1 && result.retry_after <= 600));
    assert.equal((await take("signup", "b".repeat(64))).allowed, true);
    assert.equal((await take("recover", hash)).allowed, true);
    await db.query("update rel_private.request_limits set expires_at=now()-interval '1 second' where subject_hash=$1", [hash]);
    assert.equal((await take("signup", hash)).allowed, true);
    assert.equal((await db.query("select hits from rel_private.request_limits where action='signup' and subject_hash=$1", [hash])).rows[0].hits, 1);
    await assert.rejects(take("unknown", hash), /REL_INVALID/);
    await assert.rejects(take("signup", "not-a-hash"), /REL_INVALID/);
    await assert.rejects(asUser(ids.member, "select public.rel_take_rate_limit('signup',$1)", [hash]), /permission denied/);
    await assert.rejects(db.transaction(async tx => {
      await tx.exec("set local role anon");
      await tx.query("select public.rel_take_rate_limit('signup',$1)", [hash]);
    }), /permission denied/);
    await db.exec("grant select on rel_private.request_limits to authenticated");
    assert.equal((await asUser(ids.member, "select * from rel_private.request_limits")).rows.length, 0);
    assert.deepEqual(await rpc(ids.owner, "rel_site"), before);
    assert.equal((await db.query("select count(*)::int as n from rel_private.audit")).rows[0].n, 0);
  } finally { await db.close(); }
});

test("submission and login abuse stop before further writes or Auth calls; failures do not bypass limits", async () => {
  const service = await mockService();
  try {
    const headers={cookie:"__Host-rel_access=member"};
    assert.equal((await request(service,"/api/applications",application)).status,401);
    for (let i=0; i<10; i++) {
      const submitted=await request(service,"/api/applications",{...application,requestId:crypto.randomUUID()},headers);
      assert.equal(submitted.status,201);
      await service.rpc(ids.owner,"rel_applications",{p_action:"archive",p_id:(await submitted.json()).id});
    }
    const denied = await request(service, "/api/applications", {...application,requestId:crypto.randomUUID()}, {...headers,"X-Forwarded-For":"198.51.100.9"});
    assert.equal(denied.status, 429);
    assert.ok(Number(denied.headers.get("Retry-After")) > 0);
    assert.equal((await service.db.query("select count(*)::int as n from public.editor_applications")).rows[0].n, 10);
    assert.equal((await request(service, "/api/applications", {...application,requestId:crypto.randomUUID()}, {...headers,"CF-Connecting-IP":"192.0.2.2"})).status, 201);
    const credentials = { email:"owner@example.test", password:"wrong-password" };
    for (let i=0; i<30; i++) assert.equal((await request(service, "/api/auth/signin", credentials)).status, 401);
    service.clearLog();
    assert.equal((await request(service, "/api/auth/signin", credentials)).status, 429);
    assert.equal(service.log().some(entry => entry.path === "/auth/v1/token"), false);
    const counter = service.log().find(entry => entry.path.endsWith("/rel_take_rate_limit"));
    assert.match(counter.body.p_subject_hash, /^[0-9a-f]{64}$/);
    assert.equal(JSON.stringify(counter.body).includes("192.0.2.1"), false);
    service.failures.rateLimit = 500;
    service.clearLog();
    assert.equal((await request(service, "/api/auth/forgot-password", { email:"owner@example.test" })).status, 503);
    assert.equal(service.log().some(entry => entry.path === "/auth/v1/recover"), false);
    assert.equal((await request(service, "/api/applications", application, {origin:"https://elsewhere.test"})).status, 403);
  } finally { await service.close(); }
});

test("untrusted connecting-IP headers cannot supply the production limiter identity", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("No network request should occur"); };
  try {
    await assert.rejects(enforceRateLimit(new Request("https://rel.example.test/api/auth/signin", {
      headers:{"CF-Connecting-IP":"192.0.2.1"},
    }), env, "signin"), error => error.status === 503);
  } finally { globalThis.fetch = originalFetch; }
});

test("security policy hashes exact inline code and protects static/dynamic responses without weakening cookies", async () => {
  const source = "\nwindow.relReady = true;\n";
  const html = `<script>${source}</script><script type="module" src="/assets/account.js"></script>`;
  const hash = "'sha256-" + createHash("sha256").update(source).digest("base64") + "'";
  assert.deepEqual(await inlineScriptHashes(html), [hash]);
  assert.notDeepEqual(await inlineScriptHashes(html.replace("true", "false")), [hash]);
  const secured = await secureResponse(new Response(html, {headers:{"Content-Type":"text/html", "Set-Cookie":"test=fixture; HttpOnly; Secure; SameSite=Strict"}}));
  const csp = secured.headers.get("Content-Security-Policy");
  assert.ok(csp.includes(hash));
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'none'/);
  assert.doesNotMatch(csp.split(";").find(part => part.trim().startsWith("script-src ")), /unsafe-inline|unsafe-eval/);
  assert.equal(secured.headers.get("X-Frame-Options"), "DENY");
  assert.match(secured.headers.get("Strict-Transport-Security"), /max-age=/);
  assert.match(secured.headers.get("Set-Cookie"), /HttpOnly; Secure; SameSite=Strict/);
  assert.equal(await secured.text(), html);
  const api = await secureResponse(new Response('{"ok":true}', {headers:{"Content-Type":"application/json", "Cache-Control":"no-store"}}));
  assert.equal(api.headers.get("Cache-Control"), "no-store");
  assert.equal(api.headers.has("Access-Control-Allow-Origin"), false);
});

test("remote downloads cancel oversized streams and refuse active or mislabeled image content", async () => {
  let canceled = false;
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(64)); }, cancel() { canceled=true; } });
  await assert.rejects(boundedBytes(new Response(stream), 100), error => error.status === 502);
  assert.equal(canceled, true);
  canceled = false;
  const declared = new ReadableStream({ cancel() { canceled=true; } });
  await assert.rejects(boundedBytes(new Response(declared, {headers:{"Content-Length":"101"}}), 100), /too large/);
  assert.equal(canceled, true);
  for (const [bytes,mime] of [[new TextEncoder().encode('<svg onload="alert(1)"/>'),"image/svg+xml"],
    [new TextEncoder().encode('<html>not an image</html>'),"image/png"], [new Uint8Array([137,80,78,71]),"image/png"]]) {
    assert.throws(() => rasterMime(bytes, mime), /PNG, JPEG or WebP/);
  }
  assert.equal(rasterMime(new Uint8Array([137,80,78,71,13,10,26,10]), "image/png"), "image/png");
  assert.equal(rasterMime(new Uint8Array([255,216,255,224]), "image/jpeg"), "image/jpeg");
});

test("TikTok redirects stay within the allowlist and avatar downloads never follow image redirects", async () => {
  const service = await mockService(), mockedFetch = globalThis.fetch;
  const visited = [];
  try {
    globalThis.fetch = async (url, options) => {
      visited.push(String(url));
      if(String(url).startsWith("https://www.tiktok.com/@")) return new Response(null, {status:302,headers:{Location:"http://127.0.0.1/private"}});
      return mockedFetch(url, options);
    };
    await assert.rejects(tiktokPage("fixture_editor", {}), /unsupported/);
    assert.equal(visited.length, 1);
    for (const source of ["https://attacker.test/x", "https://user:pass@p16.tiktokcdn.com/x", "https://p16.tiktokcdn.com:8443/x"]) {
      globalThis.fetch = async (url, options) => String(url).startsWith("https://www.tiktok.com/@")
        ? new Response(JSON.stringify({avatarLarger:source})) : mockedFetch(url, options);
      assert.equal((await request(service, "/api/avatar", {editorId:"editor1", username:"fixture_editor"}, {cookie:"__Host-rel_access=member"})).status, 502);
    }
    globalThis.fetch = async (url, options) => {
      if(String(url)==="https://p16.tiktokcdn.com/fixture-avatar.png") {
        assert.equal(options.redirect, "error");
        return new Response(null, {status:302,headers:{Location:"http://127.0.0.1/private"}});
      }
      return mockedFetch(url, options);
    };
    assert.equal((await request(service, "/api/avatar", {editorId:"editor1",username:"fixture_editor"}, {cookie:"__Host-rel_access=member"})).status, 502);
    assert.equal(service.log().some(entry => entry.path.startsWith("/storage/")), false);
  } finally { await service.close(); }
});
