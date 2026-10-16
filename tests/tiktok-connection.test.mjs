import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { mockService } from "./mock-service.mjs";
import { fixture, ids, sessionId } from "./auth-fixture.mjs";
import {
  hash,
  randomToken,
  tiktokConfig,
  proveAccount,
  providerJson,
  revokeAccess,
} from "../functions/_tiktok.js";
import cleanupWorker from "../workers/tiktok-cleanup.js";

const origin = "https://rel.example.test";
const cookie = (response) =>
  response.headers
    .getSetCookie()
    .find(
      (value) =>
        value.startsWith("__Host-rel_tiktok_finish=") &&
        !value.startsWith("__Host-rel_tiktok_finish=;"),
    )
    ?.split(";")[0];
function client(service) {
  return (path, user, body, extraCookie = "") =>
    service.handle(
      new Request(origin + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          origin,
          "Content-Type": "application/json",
          ...(user || extraCookie
            ? {
                cookie: [user ? "__Host-rel_access=" + user : "", extraCookie]
                  .filter(Boolean)
                  .join("; "),
              }
            : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
}
async function begin(request, user = "member") {
  const response = await request("/api/account/tiktok/start", user, {});
  assert.equal(response.status, 200);
  const { url } = await response.json(),
    parsed = new URL(url),
    state = parsed.searchParams.get("state");
  assert.equal(parsed.origin, "https://www.tiktok.com");
  assert.equal(parsed.pathname, "/v2/auth/authorize/");
  assert.equal(
    parsed.searchParams.get("scope"),
    "user.info.basic,user.info.profile",
  );
  assert.equal(parsed.searchParams.get("disable_auto_auth"), "1");
  assert.ok(!url.includes("fixture-client-secret"));
  assert.match(state, /^[A-Za-z0-9_-]{43}$/);
  for (const item of response.headers.getSetCookie())
    assert.match(
      item,
      /HttpOnly; SameSite=(?:Lax|Strict); Max-Age=\d+; Secure/,
    );
  return { state, cookie: "__Host-rel_tiktok_state=" + state };
}
async function callback(request, flow, extra = "") {
  return request(
    "/api/account/tiktok/callback?state=" +
      flow.state +
      (extra || "&code=fixture-tiktok-code-" + randomUUID()),
    null,
    undefined,
    flow.cookie,
  );
}
async function ready(request, user = "member") {
  const flow = await begin(request, user),
    response = await callback(request, flow);
  assert.equal(response.status, 303);
  assert.equal(
    new URL(response.headers.get("Location")).search,
    "?tiktok=ready",
  );
  return { flow, response, finish: cookie(response) };
}
const count = async (service, table) =>
  (await service.db.query(`select count(*)::int n from rel_private.${table}`))
    .rows[0].n;

test("TikTok is optional, authenticated and same-origin; configuration cannot redirect authorisation elsewhere", async () => {
  const service = await mockService();
  try {
    const request = client(service);
    assert.equal((await request("/api/account/tiktok")).status, 401);
    assert.equal(
      (await request("/api/account/tiktok/start", null, {})).status,
      401,
    );
    assert.deepEqual(
      await (await request("/api/account/tiktok", "member")).json(),
      { available: false },
    );
    assert.equal(
      (await request("/api/account/tiktok/start", "member", {})).status,
      503,
    );
    assert.equal((await request("/api/auth/tiktok", null, {})).status, 404);
    assert.equal(
      (
        await service.handle(
          new Request(origin + "/api/account/tiktok/start", {
            method: "POST",
            headers: {
              origin: "https://evil.test",
              "Content-Type": "application/json",
              cookie: "__Host-rel_access=member",
            },
            body: "{}",
          }),
        )
      ).status,
      403,
    );
    for (const uri of [
      "https://evil.test/api/account/tiktok/callback",
      origin + "/elsewhere",
      origin + "/api/account/tiktok/callback?next=evil",
      origin + "/api/account/tiktok/callback#fragment",
      "http://rel.example.test/api/account/tiktok/callback",
    ]) {
      assert.throws(
        () =>
          tiktokConfig(
            {
              ...service.env,
              REL_TIKTOK_CLIENT_KEY: "fixture",
              REL_TIKTOK_CLIENT_SECRET: "fixture",
              REL_TIKTOK_REDIRECT_URI: uri,
            },
            new Request(origin),
          ),
        (error) => error.status === 503,
      );
    }
  } finally {
    await service.close();
  }
});

test("TikTok verification revokes temporary access before same-session confirmation and exposes only public proof", async () => {
  const service = await mockService({ tiktok: true });
  try {
    const request = client(service),
      before = await service.rpc(ids.owner, "rel_site");
    const context = await service.rpc(ids.member, "rel_context");
    const { flow, response, finish } = await ready(request);
    assert.ok(finish);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
    assert.equal(await count(service, "tiktok_connections"), 0);
    assert.deepEqual(
      service.providerRequests.map((item) => item.path),
      ["/v2/oauth/token/", "/v2/user/info/", "/v2/oauth/revoke/"],
    );
    const privateChallenge = (
      await service.db.query("select * from rel_private.tiktok_challenges")
    ).rows[0];
    assert.equal(privateChallenge.state_hash, await hash(flow.state));
    assert.equal(privateChallenge.consumed, true);
    const status = await (
      await request("/api/account/tiktok", "member")
    ).json();
    assert.equal(status.pending.username, "fixture_editor");
    assert.equal(status.pending.open_id, undefined);
    assert.equal(status.connection, null);
    assert.equal(
      (await request("/api/account/tiktok", "member", { action: "finish" }))
        .status,
      400,
    );
    const publicBefore = await (
      await request("/api/profiles?account=" + ids.member)
    ).json();
    assert.equal(publicBefore.tiktok, null);
    assert.equal(
      (
        await request(
          "/api/account/tiktok",
          "member",
          {
            action: "finish",
            userId: ids.stranger,
            username: "forged_editor",
            open_id: "forged-id",
          },
          finish,
        )
      ).status,
      200,
    );
    assert.equal(await count(service, "tiktok_connections"), 1);
    assert.equal(await count(service, "tiktok_challenges"), 0);
    const publicProfile = await (
      await request("/api/profiles?account=" + ids.member)
    ).json();
    assert.deepEqual(Object.keys(publicProfile.tiktok).sort(), [
      "display_name",
      "expires_at",
      "username",
      "verified_at",
    ]);
    assert.equal(publicProfile.tiktok.username, "fixture_editor");
    assert.equal(
      new Date(publicProfile.tiktok.expires_at) -
        new Date(publicProfile.tiktok.verified_at),
      29 * 86400000,
    );
    const records = (
      await service.db.query("select * from rel_private.tiktok_connections")
    ).rows;
    assert.ok(!JSON.stringify(records).includes("act.fixture-token"));
    assert.ok(!JSON.stringify(service.log()).includes("rft.fixture-token"));
    assert.deepEqual(await service.rpc(ids.owner, "rel_site"), before);
    assert.deepEqual(await service.rpc(ids.member, "rel_context"), context);
    const audit = (
      await service.db.query(
        "select details from rel_private.audit where action='connect_tiktok'",
      )
    ).rows[0].details;
    assert.equal(audit.actor_username, "member");
    assert.ok(!JSON.stringify(audit).includes("fixture-open-id"));
    assert.equal(
      (await request("/api/account/tiktok", "member", { action: "disconnect" }))
        .status,
      200,
    );
    assert.equal(await count(service, "tiktok_connections"), 0);
    assert.equal(
      (await (await request("/api/profiles?account=" + ids.member)).json())
        .tiktok,
      null,
    );
    assert.equal(service.providerRequests.length, 3);
    assert.deepEqual(await service.rpc(ids.owner, "rel_site"), before);
  } finally {
    await service.close();
  }
});

test("cancel keeps the existing TikTok link and a TikTok ID cannot be silently transferred", async () => {
  const service = await mockService({ tiktok: true });
  try {
    const request = client(service),
      first = await ready(request);
    await request(
      "/api/account/tiktok",
      "member",
      { action: "finish" },
      first.finish,
    );
    service.failures.tiktokOpenId = "different-open-id";
    service.failures.tiktokUsername = "different_editor";
    const next = await ready(request);
    assert.equal(
      (
        await request(
          "/api/account/tiktok",
          "member",
          { action: "cancel" },
          next.finish,
        )
      ).status,
      200,
    );
    assert.equal(
      (await (await request("/api/account/tiktok", "member")).json()).connection
        .username,
      "fixture_editor",
    );
    assert.equal(await count(service, "tiktok_challenges"), 0);
    const stranger = await ready(request, "stranger");
    await request(
      "/api/account/tiktok",
      "stranger",
      { action: "finish" },
      stranger.finish,
    );
    service.failures.tiktokOpenId = "fixture-open-id";
    service.failures.tiktokUsername = "fixture_editor";
    const conflict = await ready(request, "stranger");
    assert.equal(
      (
        await request(
          "/api/account/tiktok",
          "stranger",
          { action: "finish" },
          conflict.finish,
        )
      ).status,
      409,
    );
    assert.equal(
      (await (await request("/api/account/tiktok", "stranger")).json())
        .connection.username,
      "different_editor",
    );
    assert.equal(
      (await service.rpc(ids.stranger, "rel_context")).editor_id,
      null,
    );
    assert.equal(await count(service, "tiktok_connections"), 2);
  } finally {
    await service.close();
  }
});

test("state, replay, expiry, active sessions and confirmation cookies protect the TikTok callback", async () => {
  const service = await mockService({ tiktok: true });
  try {
    const request = client(service),
      flow = await begin(request);
    const wrong = await request(
      "/api/account/tiktok/callback?state=" +
        randomToken() +
        "&code=fixture-tiktok-code-wrong",
      null,
      undefined,
      flow.cookie,
    );
    assert.match(wrong.headers.get("Location"), /tiktok=failed$/);
    assert.equal(wrong.headers.getSetCookie().length, 0);
    assert.equal(service.providerRequests.length, 0);
    const response = await callback(request, flow),
      finish = cookie(response);
    const replay = await callback(request, flow);
    assert.match(replay.headers.get("Location"), /tiktok=failed$/);
    assert.equal(service.providerRequests.length, 3);
    assert.equal(
      (
        await request(
          "/api/account/tiktok",
          "stranger",
          { action: "finish" },
          finish,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await request(
          "/api/account/tiktok",
          "member",
          { action: "finish" },
          "__Host-rel_tiktok_finish=" + randomToken(),
        )
      ).status,
      400,
    );
    const anotherSession = randomUUID();
    await service.db.query(
      "insert into auth.sessions(id,user_id) values ($1,$2)",
      [anotherSession, ids.member],
    );
    await assert.rejects(
      service.db.transaction(async (tx) => {
        await tx.exec("set local role authenticated");
        await tx.query("select set_config('request.jwt.claims',$1,true)", [
          JSON.stringify({
            sub: ids.member,
            session_id: anotherSession,
            role: "authenticated",
          }),
        ]);
        return tx.query("select public.rel_tiktok('finish',null,$1)", [
          await hash(finish.split("=")[1]),
        ]);
      }),
      /REL_TIKTOK_EXPIRED/,
    );
    assert.equal(
      (
        await request(
          "/api/account/tiktok",
          "member",
          { action: "finish" },
          finish,
        )
      ).status,
      200,
    );
    const expired = await begin(request, "stranger");
    await service.db.query(
      "update rel_private.tiktok_challenges set expires_at=now()-interval '1 second' where user_id=$1",
      [ids.stranger],
    );
    assert.match(
      (await callback(request, expired)).headers.get("Location"),
      /tiktok=failed$/,
    );
    assert.equal(service.providerRequests.length, 3);
    const revoked = await begin(request, "contributor");
    await service.db.query("delete from auth.sessions where id=$1", [
      sessionId(ids.contributor),
    ]);
    assert.match(
      (await callback(request, revoked)).headers.get("Location"),
      /tiktok=failed$/,
    );
    assert.equal(service.providerRequests.length, 3);
  } finally {
    await service.close();
  }
});

test("provider failures, missing scopes and mismatched identity never produce a verified TikTok connection", async () => {
  const service = await mockService({ tiktok: true });
  try {
    const request = client(service);
    for (const failure of [
      { tiktokToken: 400 },
      { tiktokScopes: "user.info.basic" },
      { tiktokInfo: 503 },
      { tiktokUserMismatch: true },
      { tiktokRevoke: 503 },
    ]) {
      Object.assign(service.failures, failure);
      const flow = await begin(request),
        before = service.providerRequests.length;
      const result = await callback(request, flow);
      assert.match(result.headers.get("Location"), /tiktok=failed$/);
      assert.equal(await count(service, "tiktok_connections"), 0);
      assert.equal(await count(service, "tiktok_challenges"), 0);
      if (!failure.tiktokToken)
        assert.equal(service.providerRequests.at(-1).path, "/v2/oauth/revoke/");
      assert.ok(service.providerRequests.length > before);
      for (const key of Object.keys(failure)) delete service.failures[key];
    }
    assert.equal(
      (await request("/api/account/tiktok/start", "member", {})).status,
      429,
    );
    const cancelled = await begin(request, "stranger"),
      before = service.providerRequests.length;
    const result = await callback(
      request,
      cancelled,
      "&error=access_denied&error_description=untrusted-provider-text",
    );
    assert.match(result.headers.get("Location"), /tiktok=cancelled$/);
    assert.ok(!result.headers.get("Location").includes("untrusted"));
    assert.equal(service.providerRequests.length, before);
  } finally {
    await service.close();
  }
});

test("expired proofs are hidden and cleaned, and private storage/service RPCs stay inaccessible to Members", async () => {
  const service = await mockService({ tiktok: true });
  try {
    const request = client(service),
      connected = await ready(request);
    await request(
      "/api/account/tiktok",
      "member",
      { action: "finish" },
      connected.finish,
    );
    const pending = await begin(request, "stranger");
    assert.ok(pending.state);
    await service.db.exec(
      "update rel_private.tiktok_connections set expires_at=now()-interval '1 second';update rel_private.tiktok_challenges set expires_at=now()-interval '1 second'",
    );
    assert.equal(
      (await (await request("/api/profiles?account=" + ids.member)).json())
        .tiktok,
      null,
    );
    assert.equal(await count(service, "tiktok_connections"), 1);
    await cleanupWorker.scheduled({}, service.env);
    assert.equal(await count(service, "tiktok_connections"), 0);
    assert.equal(await count(service, "tiktok_challenges"), 0);
    assert.equal((await cleanupWorker.fetch()).status, 404);
    await assert.rejects(
      service.rpc(ids.member, "rel_tiktok_exchange", { p_action: "cleanup" }),
      /permission denied/,
    );
    for (const table of ["tiktok_connections", "tiktok_challenges"])
      await assert.rejects(
        service.db.transaction(async (tx) => {
          await tx.exec("set local role authenticated");
          return tx.query(`select * from rel_private.${table}`);
        }),
        /permission denied/,
      );
    await assert.rejects(
      service.db.transaction(async (tx) => {
        await tx.exec("set local role anon");
        return tx.query("select public.rel_tiktok('status')");
      }),
      /permission denied/,
    );
  } finally {
    await service.close();
  }
});

test("TikTok migration adds private structures without modifying existing rankings, accounts or applications", async () => {
  const { db, rpc } = await fixture({ profiles: true });
  try {
    const before = await rpc(ids.owner, "rel_site"),
      accounts = (
        await db.query("select * from rel_private.accounts order by id")
      ).rows;
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/20261016180000_rel_tiktok_connections.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    assert.deepEqual(await rpc(ids.owner, "rel_site"), before);
    assert.deepEqual(
      (await db.query("select * from rel_private.accounts order by id")).rows,
      accounts,
    );
    assert.equal(
      (await db.query("select count(*)::int n from rel_private.data_history"))
        .rows[0].n,
      0,
    );
    assert.equal(
      (await db.query("select count(*)::int n from public.editor_applications"))
        .rows[0].n,
      0,
    );
    const columns = (
      await db.query(
        "select column_name from information_schema.columns where table_schema='rel_private' and table_name in ('tiktok_connections','tiktok_challenges')",
      )
    ).rows;
    assert.ok(!JSON.stringify(columns).includes("token"));
  } finally {
    await db.close();
  }
});

test("bounded TikTok responses and immediate revocation do not retain provider tokens", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("x".repeat(65537));
    await assert.rejects(
      providerJson("https://open.tiktokapis.com/fixture"),
      /unexpected response/,
    );
    let calls = 0;
    globalThis.fetch = async (url, options) => {
      calls++;
      assert.equal(options.redirect, "error");
      assert.ok(options.signal);
      if (String(url).includes("/oauth/token/"))
        return new Response(
          JSON.stringify({
            access_token: "act.fixture",
            token_type: "Bearer",
            scope: "user.info.basic,user.info.profile",
            open_id: "id",
          }),
        );
      if (String(url).includes("/user/info/"))
        return new Response(
          JSON.stringify({
            data: {
              user: {
                open_id: "id",
                username: "fixture",
                display_name: "Fixture",
              },
            },
            error: { code: "ok" },
          }),
        );
      return new Response("{}");
    };
    assert.deepEqual(
      await proveAccount(
        {
          clientKey: "fixture",
          clientSecret: "fixture",
          callback: origin + "/api/account/tiktok/callback",
        },
        "code",
      ),
      { open_id: "id", username: "fixture", display_name: "Fixture" },
    );
    assert.equal(calls, 3);
    globalThis.fetch = async () => new Response(null, { status: 204 });
    await revokeAccess(
      { clientKey: "fixture", clientSecret: "fixture" },
      "act.fixture",
    );
    await assert.rejects(
      providerJson("https://open.tiktokapis.com/fixture"),
      /empty response/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
