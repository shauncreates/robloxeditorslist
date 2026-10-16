import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { mockService } from "./mock-service.mjs";
import { fixture, ids } from "./auth-fixture.mjs";
import { audienceCount } from "../functions/_audience.js";
import { maintainYoutube } from "../functions/_youtube.js";
import maintenance from "../workers/social-maintenance.js";

const base = "https://rel.example.test",
  channel = "UC" + "a".repeat(22);
const call = (service, path, user, body, cookies = "") =>
  service.handle(
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
const list = async (service, platform = "tiktok") => {
  const response = await call(service, "/api/popularity?platform=" + platform);
  assert.equal(response.status, 200, await response.clone().text());
  assert.match(response.headers.get("Cache-Control"), /no-store/);
  return (await response.json()).editors;
};
async function authorise(service, platform, user = "member") {
  const start = await call(
    service,
    "/api/account/" + platform + "/start",
    user,
    {},
  );
  assert.equal(start.status, 200, await start.clone().text());
  const url = new URL((await start.json()).url),
    state = url.searchParams.get("state");
  const callback = await call(
    service,
    "/api/account/" +
      platform +
      "/callback?" +
      new URLSearchParams({
        state,
        code:
          platform === "tiktok"
            ? "fixture-tiktok-code-" + randomUUID()
            : "fixture-youtube-code",
      }),
    null,
    undefined,
    "__Host-rel_" + platform + "_state=" + state,
  );
  assert.match(
    callback.headers.get("Location"),
    new RegExp(platform + "=ready$"),
  );
  const finish = callback.headers
    .getSetCookie()
    .find((value) => value.startsWith("__Host-rel_" + platform + "_finish="))
    ?.split(";")[0];
  assert.ok(finish);
  return async (extra = {}) => {
    const response = await call(
      service,
      "/api/account/" + platform,
      user,
      {
        action: "finish",
        ...(platform === "youtube" ? { channelId: channel } : {}),
        ...extra,
      },
      finish,
    );
    assert.equal(response.status, 200, await response.clone().text());
  };
}

test("provider count parsing distinguishes zero, hidden values and unsafe or malformed numbers", () => {
  for (const value of [
    undefined,
    null,
    "",
    true,
    {},
    [],
    "-1",
    "1.5",
    "1e6",
    " 12 ",
    "012",
    -1,
    1.5,
    NaN,
    Infinity,
    "9007199254740992",
    9007199254740992,
  ])
    assert.equal(audienceCount(value), null, String(value));
  for (const value of [
    0,
    "0",
    12000,
    "12000",
    9007199254740991,
    "9007199254740991",
  ])
    assert.equal(audienceCount(value), Number(value));
});

test("TikTok counts publish only after confirmation and cannot be changed by browser input", async () => {
  const service = await mockService({ tiktok: true });
  try {
    const before = await service.rpc(ids.owner, "rel_site");
    const finish = await authorise(service, "tiktok");
    assert.deepEqual(await list(service), []);
    const pending = await (
      await call(service, "/api/account/tiktok", "member")
    ).json();
    assert.equal(pending.audience.pending.followers, 42000);
    await finish({
      followers: 999999999,
      audience_count: 999999999,
      user_id: ids.owner,
    });
    const rows = await list(service);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].audience_count, 42000);
    assert.equal(rows[0].editor_id, "editor1");
    assert.equal(rows[0].channel_url, "https://www.tiktok.com/@fixture_editor");
    assert.equal(rows[0].place, 1);
    assert.ok(Date.now() - new Date(rows[0].observed_at) < 60000);
    assert.deepEqual(
      Object.keys(rows[0]).sort(),
      [
        "audience_count",
        "avatar",
        "channel_url",
        "clan",
        "editor_id",
        "name",
        "observed_at",
        "place",
      ].sort(),
    );
    assert.deepEqual(await service.rpc(ids.owner, "rel_site"), before);
    assert.equal(
      (
        await call(service, "/api/account/tiktok", "member", {
          action: "disconnect",
        })
      ).status,
      200,
    );
    assert.deepEqual(await list(service), []);
  } finally {
    await service.close();
  }
});

test("declining TikTok statistics still verifies identity; malformed counts are excluded; zero is listed", async () => {
  const service = await mockService({ tiktok: true });
  try {
    service.failures.tiktokScopes = "user.info.basic,user.info.profile";
    await (
      await authorise(service, "tiktok")
    )();
    assert.ok(
      (await (await call(service, "/api/account/tiktok", "member")).json())
        .connection,
    );
    assert.deepEqual(await list(service), []);
    const request = service.providerRequests.find(
      (item) => item.path === "/v2/user/info/",
    );
    assert.ok(request);
    delete service.failures.tiktokScopes;
    service.failures.tiktokFollowers = "-10";
    await (
      await authorise(service, "tiktok")
    )();
    assert.deepEqual(await list(service), []);
    service.failures.tiktokFollowers = 0;
    await (
      await authorise(service, "tiktok")
    )();
    assert.equal((await list(service))[0].audience_count, 0);
    const stored = JSON.stringify(
      (await service.db.query("select * from rel_private.tiktok_connections"))
        .rows,
    );
    assert.ok(
      !stored.includes("act.fixture") && !stored.includes("rft.fixture"),
    );
  } finally {
    await service.close();
  }
});

test("YouTube reads statistics for owned channels, preserves rounded values, and excludes hidden counts", async () => {
  const service = await mockService({ google: true });
  try {
    const finish = await authorise(service, "youtube");
    assert.deepEqual(await list(service, "youtube"), []);
    assert.ok(
      service.googleLog.find((item) => item.query?.includes("statistics")),
    );
    await finish({ subscriberCount: 999999 });
    const first = (await list(service, "youtube"))[0];
    assert.equal(first.audience_count, 12500);
    assert.equal(
      first.channel_url,
      "https://www.youtube.com/channel/" + channel,
    );
    assert.deepEqual(await list(service, "tiktok"), []);
    service.googleState.channels[0].statistics = {
      subscriberCount: "90000",
      hiddenSubscriberCount: true,
    };
    await (
      await authorise(service, "youtube")
    )();
    assert.deepEqual(await list(service, "youtube"), []);
    service.googleState.channels[0].statistics = {
      subscriberCount: "0",
      hiddenSubscriberCount: false,
    };
    await (
      await authorise(service, "youtube")
    )();
    assert.equal((await list(service, "youtube"))[0].audience_count, 0);
    assert.equal(
      (
        await call(service, "/api/account/youtube", "member", {
          action: "disconnect",
        })
      ).status,
      200,
    );
    assert.deepEqual(await list(service, "youtube"), []);
  } finally {
    await service.close();
  }
});

test("only active confirmed accounts linked to overall-ranked editors appear; ties share places", async () => {
  const service = await mockService({ tiktok: true });
  try {
    await (
      await authorise(service, "tiktok")
    )();
    service.failures.tiktokOpenId = "second-id";
    service.failures.tiktokUsername = "second";
    await (
      await authorise(service, "tiktok", "contributor")
    )();
    assert.equal(
      (await list(service)).length,
      1,
      "social verification does not claim an editor",
    );
    // A private fixture assignment represents the separate Owner-reviewed editor link.
    await service.db.query(
      "update rel_private.accounts set editor_id='editor2' where id=$1",
      [ids.contributor],
    );
    const ties = await list(service);
    assert.deepEqual(
      ties.map((row) => [row.editor_id, row.place]),
      [
        ["editor1", 1],
        ["editor2", 1],
      ],
    );
    service.failures.tiktokFollowers = 50000;
    await (
      await authorise(service, "tiktok", "contributor")
    )();
    assert.deepEqual(
      (await list(service)).map((row) => [row.editor_id, row.place]),
      [
        ["editor2", 1],
        ["editor1", 2],
      ],
    );
    for (const [sql, restore] of [
      [
        "update rel_private.accounts set disabled=true where id=$1",
        "update rel_private.accounts set disabled=false where id=$1",
      ],
      [
        "update auth.users set email_confirmed_at=null where id=$1",
        "update auth.users set email_confirmed_at=now() where id=$1",
      ],
      [
        "update auth.users set is_anonymous=true where id=$1",
        "update auth.users set is_anonymous=false where id=$1",
      ],
      [
        "update auth.users set banned_until=now()+interval '1 day' where id=$1",
        "update auth.users set banned_until=null where id=$1",
      ],
      [
        "update rel_private.accounts set editor_id=null where id=$1",
        "update rel_private.accounts set editor_id='editor2' where id=$1",
      ],
    ]) {
      await service.db.query(sql, [ids.contributor]);
      assert.deepEqual(
        (await list(service)).map((row) => row.editor_id),
        ["editor1"],
      );
      await service.db.query(restore, [ids.contributor]);
    }
    await service.db.exec(
      "update public.roblox_editor_site_data set data=jsonb_set(data,'{lists,main}','[\"editor1\"]')",
    );
    assert.deepEqual(
      (await list(service)).map((row) => row.editor_id),
      ["editor1"],
    );
  } finally {
    await service.close();
  }
});

test("count snapshots expire and channel-access maintenance never pretends to refresh subscriber counts", async () => {
  const service = await mockService({ google: true, tiktok: true });
  try {
    await (
      await authorise(service, "youtube")
    )();
    const original = (await list(service, "youtube"))[0];
    await service.db.exec(
      "update rel_private.youtube_connections set checked_at=now()-interval '3 days'",
    );
    assert.deepEqual(await list(service, "youtube"), []);
    service.googleState.channels[0].statistics.subscriberCount = "99900";
    await maintainYoutube(service.env);
    assert.deepEqual((await list(service, "youtube"))[0], original);
    service.failures.googleToken = true;
    await service.db.exec(
      "update rel_private.youtube_connections set checked_at=now()-interval '2 days',attempted_at=null",
    );
    await maintainYoutube(service.env);
    assert.deepEqual(await list(service, "youtube"), []);
    delete service.failures.googleToken;
    await (
      await authorise(service, "youtube")
    )();
    await (
      await authorise(service, "tiktok")
    )();
    await service.db.exec(
      "update rel_private.youtube_connections set audience_observed_at=now()-interval '30 days'; update rel_private.tiktok_connections set expires_at=now()-interval '1 second'",
    );
    assert.deepEqual(await list(service, "youtube"), []);
    assert.deepEqual(await list(service, "tiktok"), []);
    await maintenance.scheduled({}, service.env);
    assert.equal(
      (
        await service.db.query(
          "select audience_count from rel_private.youtube_connections",
        )
      ).rows[0].audience_count,
      null,
    );
    assert.equal(
      (await service.db.query("select * from rel_private.tiktok_connections"))
        .rows.length,
      0,
    );
    assert.equal((await maintenance.fetch()).status, 404);
  } finally {
    await service.close();
  }
});

test("clients cannot stage counts or run service projections; malformed queries fail and private counts remain private", async () => {
  const service = await mockService({ tiktok: true });
  try {
    for (const [name, args] of [
      [
        "rel_audience_stage",
        {
          p_platform: "tiktok",
          p_state_hash: "a".repeat(64),
          p_counts: { followers: 42 },
        },
      ],
      ["rel_public_popularity", { p_platform: "tiktok" }],
      ["rel_audience_cleanup", {}],
    ])
      await assert.rejects(
        service.rpc(ids.member, name, args),
        /permission denied/,
      );
    await (
      await authorise(service, "tiktok")
    )();
    const stranger = await service.rpc(ids.stranger, "rel_audience_status", {
      p_platform: "tiktok",
    });
    assert.deepEqual(stranger, { connection: null, pending: null });
    for (const query of [
      "platform=other",
      "platform=tiktok&platform=youtube",
      "extra=1",
    ])
      assert.equal(
        (await call(service, "/api/popularity?" + query)).status,
        400,
      );
    await service.db.exec(
      "grant select on rel_private.tiktok_connections,rel_private.youtube_connections to authenticated",
    );
    await service.db.transaction(async (tx) => {
      await tx.exec("set local role authenticated");
      assert.equal(
        (
          await tx.query(
            "select audience_count from rel_private.tiktok_connections",
          )
        ).rows.length,
        0,
      );
    });
  } finally {
    await service.close();
  }
});

test("the popularity migration preserves existing rankings, accounts and audit entries", async () => {
  const service = await fixture({
    profiles: true,
    tiktok: true,
    youtube: true,
  });
  try {
    const before = await service.rpc(ids.owner, "rel_site");
    const accounts = await service.db.query(
      "select * from rel_private.accounts order by id",
    );
    const audit = await service.db.query(
      "select * from rel_private.audit order by id",
    );
    await service.db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/20261016190000_rel_editor_popularity.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    assert.deepEqual(await service.rpc(ids.owner, "rel_site"), before);
    assert.deepEqual(
      await service.db.query("select * from rel_private.accounts order by id"),
      accounts,
    );
    assert.deepEqual(
      await service.db.query("select * from rel_private.audit order by id"),
      audit,
    );
  } finally {
    await service.db.close();
  }
});
