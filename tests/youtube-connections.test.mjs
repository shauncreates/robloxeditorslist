import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mockService } from "./mock-service.mjs";
import { ids } from "./auth-fixture.mjs";
import { maintainYoutube, decryptToken } from "../functions/_youtube.js";
const base = "https://rel.example.test",
  channel = "UC" + "a".repeat(22);
const call = (s, path, user, body, cookies = "") =>
  s.handle(
    new Request(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        origin: base,
        "Content-Type": "application/json",
        cookie: (user ? "__Host-rel_access=" + user + "; " : "") + cookies,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
const cookie = (response, kind) =>
  response.headers
    .getSetCookie()
    .find((value) => value.startsWith("__Host-rel_youtube_" + kind + "="))
    ?.split(";")[0] || "";
async function begin(s, user = "member") {
  const response = await call(s, "/api/account/youtube/start", user, {});
  assert.equal(response.status, 200);
  return {
    url: new URL((await response.json()).url),
    cookie: cookie(response, "state"),
    response,
  };
}
async function authorise(s, user = "member") {
  const start = await begin(s, user),
    response = await call(
      s,
      "/api/account/youtube/callback?state=" +
        start.url.searchParams.get("state") +
        "&code=fixture-youtube-code",
      null,
      undefined,
      start.cookie,
    );
  assert.equal(
    new URL(response.headers.get("Location")).searchParams.get("youtube"),
    "ready",
  );
  return { start, response, finish: cookie(response, "finish") };
}
test("YouTube OAuth binds state, PKCE, channel confirmation and the original REL session without changing rankings", async () => {
  const s = await mockService({ google: true });
  try {
    const before = await s.rpc(ids.owner, "rel_site"),
      flow = await authorise(s);
    assert.equal(flow.start.url.origin, "https://accounts.google.com");
    assert.equal(
      flow.start.url.searchParams.get("scope"),
      "https://www.googleapis.com/auth/youtube.readonly",
    );
    assert.equal(flow.start.url.searchParams.get("access_type"), "offline");
    assert.equal(
      flow.start.url.searchParams.get("code_challenge_method"),
      "S256",
    );
    assert.match(
      flow.start.response.headers
        .getSetCookie()
        .find((c) => c.includes("_state=")),
      /HttpOnly; SameSite=Lax; Max-Age=600; Secure/,
    );
    const exchange = new URLSearchParams(s.googleLog[0].body);
    assert.equal(
      createHash("sha256")
        .update(exchange.get("code_verifier"))
        .digest("base64url"),
      flow.start.url.searchParams.get("code_challenge"),
    );
    assert.equal(
      exchange.get("redirect_uri"),
      base + "/api/account/youtube/callback",
    );
    assert.ok(
      !flow.response.headers.get("Location").includes("fixture-youtube-code"),
    );
    assert.equal(
      (await s.db.query("select * from rel_private.youtube_connections")).rows
        .length,
      0,
    );
    assert.equal(
      (
        await call(
          s,
          "/api/account/youtube",
          "stranger",
          { action: "finish", channelId: channel },
          flow.finish,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await call(
          s,
          "/api/account/youtube",
          "member",
          { action: "finish", channelId: "UC" + "b".repeat(22) },
          flow.finish,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await call(
          s,
          "/api/account/youtube",
          "member",
          { action: "finish", channelId: channel },
          flow.finish,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await call(
          s,
          "/api/account/youtube",
          "member",
          { action: "finish", channelId: channel },
          flow.finish,
        )
      ).status,
      409,
    );
    const publicProfile = await (
      await call(s, "/api/profiles?account=" + ids.member)
    ).json();
    assert.equal(publicProfile.youtube.channel_id, channel);
    assert.equal(Object.hasOwn(publicProfile.youtube, "user_id"), false);
    const status = await (
      await call(s, "/api/account/youtube", "member")
    ).json();
    assert.equal(status.connection.channel_id, channel);
    assert.deepEqual(status.channels, []);
    const storedConnection = (
      await s.db.query("select * from rel_private.youtube_connections")
    ).rows[0];
    assert.ok(
      !storedConnection.token_ciphertext.includes("fixture-refresh-token"),
    );
    assert.equal(
      await decryptToken(s.env, storedConnection.token_ciphertext),
      "fixture-refresh-token",
    );
    assert.equal(Object.hasOwn(status.connection, "token_ciphertext"), false);
    const stored = JSON.stringify(
      (await s.db.query("select details from rel_private.audit")).rows,
    );
    assert.ok(
      !stored.includes("fixture-google-token") &&
        !stored.includes("fixture-google-secret"),
    );
    assert.equal(
      (await s.db.query("select * from rel_private.youtube_challenges")).rows
        .length,
      0,
    );
    assert.deepEqual(await s.rpc(ids.owner, "rel_site"), before);
    assert.equal(
      (
        await call(s, "/api/account/youtube", "member", {
          action: "disconnect",
        })
      ).status,
      200,
    );
    assert.ok(s.googleLog.some((item) => item.path === "/revoke"));
    assert.equal(
      (await (await call(s, "/api/profiles?account=" + ids.member)).json())
        .youtube,
      null,
    );
  } finally {
    await s.close();
  }
});

test("maintenance refreshes channel metadata, hides stale proofs, deletes revoked/old data and disconnect failures are retryable", async () => {
  const s = await mockService({ google: true });
  try {
    const flow = await authorise(s);
    await call(
      s,
      "/api/account/youtube",
      "member",
      { action: "finish", channelId: channel },
      flow.finish,
    );
    s.googleState.channels[0].snippet.title = "Updated fixture channel";
    await s.db.exec(
      "update rel_private.youtube_connections set checked_at=now()-interval '3 days'",
    );
    assert.equal(
      (await (await call(s, "/api/profiles?account=" + ids.member)).json())
        .youtube,
      null,
    );
    await maintainYoutube(s.env);
    assert.equal(
      (await (await call(s, "/api/profiles?account=" + ids.member)).json())
        .youtube.title,
      "Updated fixture channel",
    );
    s.failures.googleRevoke = true;
    assert.equal(
      (
        await call(s, "/api/account/youtube", "member", {
          action: "disconnect",
        })
      ).status,
      503,
    );
    assert.equal(
      (await s.db.query("select * from rel_private.youtube_connections")).rows
        .length,
      1,
    );
    delete s.failures.googleRevoke;
    s.failures.googleToken = true;
    await s.db.exec(
      "update rel_private.youtube_connections set checked_at=now()-interval '2 days',attempted_at=null",
    );
    await maintainYoutube(s.env);
    assert.equal(
      (await s.db.query("select * from rel_private.youtube_connections")).rows
        .length,
      0,
    );
    delete s.failures.googleToken;
    const again = await authorise(s, "stranger");
    await call(
      s,
      "/api/account/youtube",
      "stranger",
      { action: "finish", channelId: channel },
      again.finish,
    );
    await s.db.exec(
      "update rel_private.youtube_connections set checked_at=now()-interval '30 days'",
    );
    await maintainYoutube(s.env);
    assert.equal(
      (await s.db.query("select * from rel_private.youtube_connections")).rows
        .length,
      0,
    );
  } finally {
    await s.close();
  }
});
test("missing or forged OAuth state cannot make a provider request; cancellation and expiry do not connect accounts", async () => {
  const s = await mockService({ google: true });
  try {
    const start = await begin(s),
      state = start.url.searchParams.get("state");
    for (const [value, cookies] of [
      [state, ""],
      ["b".repeat(43), start.cookie],
    ]) {
      const response = await call(
        s,
        "/api/account/youtube/callback?state=" +
          value +
          "&code=fixture-youtube-code",
        null,
        undefined,
        cookies,
      );
      assert.equal(
        new URL(response.headers.get("Location")).searchParams.get("youtube"),
        "failed",
      );
    }
    assert.equal(s.googleLog.length, 0);
    const denied = await call(
      s,
      "/api/account/youtube/callback?state=" + state + "&error=access_denied",
      null,
      undefined,
      start.cookie,
    );
    assert.equal(
      new URL(denied.headers.get("Location")).searchParams.get("youtube"),
      "cancelled",
    );
    assert.equal(s.googleLog.length, 0);
    assert.equal(
      (await call(s, "/api/account/youtube/start", "member", {})).status,
      429,
    );
    const other = await begin(s, "stranger");
    await s.db.query(
      "update rel_private.youtube_challenges set expires_at=now()-interval '1 second' where user_id=$1",
      [ids.stranger],
    );
    const expired = await call(
      s,
      "/api/account/youtube/callback?state=" +
        other.url.searchParams.get("state") +
        "&code=fixture-youtube-code",
      null,
      undefined,
      other.cookie,
    );
    assert.equal(
      new URL(expired.headers.get("Location")).searchParams.get("youtube"),
      "failed",
    );
    assert.equal(s.googleLog.length, 0);
  } finally {
    await s.close();
  }
});
test("provider failures, missing scopes and accounts without channels never create a verified connection", async () => {
  for (const failure of [
    "googleToken",
    "googleScope",
    "googleChannels",
    "noChannels",
  ]) {
    const s = await mockService({ google: true });
    try {
      if (failure === "noChannels") s.googleState.channels = [];
      else s.failures[failure] = true;
      const start = await begin(s),
        response = await call(
          s,
          "/api/account/youtube/callback?state=" +
            start.url.searchParams.get("state") +
            "&code=fixture-youtube-code",
          null,
          undefined,
          start.cookie,
        );
      assert.equal(
        new URL(response.headers.get("Location")).searchParams.get("youtube"),
        "failed",
      );
      assert.equal(
        (await s.db.query("select * from rel_private.youtube_connections")).rows
          .length,
        0,
      );
      assert.ok(!cookie(response, "finish").split("=")[1]);
    } finally {
      await s.close();
    }
  }
});
test("existing channel links cannot be stolen; revoked sessions cannot finalise; private proof routines reject clients", async () => {
  const s = await mockService({ google: true });
  try {
    const first = await authorise(s);
    assert.equal(
      (
        await call(
          s,
          "/api/account/youtube",
          "member",
          { action: "finish", channelId: channel },
          first.finish,
        )
      ).status,
      200,
    );
    const second = await authorise(s, "stranger");
    assert.equal(
      (
        await call(
          s,
          "/api/account/youtube",
          "stranger",
          { action: "finish", channelId: channel },
          second.finish,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await s.db.query(
          "select user_id from rel_private.youtube_connections where channel_id=$1",
          [channel],
        )
      ).rows[0].user_id,
      ids.member,
    );
    const third = await authorise(s, "contributor");
    await s.db.query("delete from auth.sessions where user_id=$1", [
      ids.contributor,
    ]);
    assert.equal(
      (
        await call(
          s,
          "/api/account/youtube",
          "contributor",
          { action: "finish", channelId: channel },
          third.finish,
        )
      ).status,
      401,
    );
    await assert.rejects(
      s.rpc(ids.member, "rel_youtube_exchange", {
        p_action: "claim",
        p_state_hash: "a".repeat(64),
      }),
      /permission denied/,
    );
    assert.equal(
      (await call(s, "/api/account/youtube/start", null, {})).status,
      401,
    );
    assert.equal(
      (await call(s, "/api/account/youtube", "member", { action: "begin" }))
        .status,
      400,
    );
    assert.equal(
      (
        await s.db.query(
          "select count(*)::int as n from rel_private.youtube_connections",
        )
      ).rows[0].n,
      1,
    );
    await s.db.exec(
      "grant select on rel_private.youtube_connections,rel_private.youtube_challenges to authenticated",
    );
    assert.equal(
      (await s.rpc(ids.member, "rel_youtube", { p_action: "status" }))
        .connection.channel_id,
      channel,
    );
    await s.db.transaction(async (tx) => {
      await tx.exec("set local role authenticated");
      assert.equal(
        (await tx.query("select * from rel_private.youtube_connections")).rows
          .length,
        0,
      );
    });
  } finally {
    await s.close();
  }
});
test("an unconfigured integration exposes a real unavailable state and cannot start Google authorisation", async () => {
  const s = await mockService();
  try {
    assert.equal(
      (await (await call(s, "/api/account/youtube", "member")).json())
        .available,
      false,
    );
    assert.equal(
      (await call(s, "/api/account/youtube/start", "member", {})).status,
      503,
    );
    assert.equal(
      (await s.db.query("select * from rel_private.youtube_challenges")).rows
        .length,
      0,
    );
  } finally {
    await s.close();
  }
});
