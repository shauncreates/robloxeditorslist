import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  mainPlatform,
  primaryLink,
  youtubeChannel,
  avatarRequest,
} from "../assets/editor-platform.js";
import { fixture, ids } from "./auth-fixture.mjs";
import { mockService, env } from "./mock-service.mjs";
import { lookupChannel, channelPicture } from "../functions/_youtube-avatar.js";

const channelId = "UC" + "f".repeat(22);
const youtube = "https://www.youtube.com/@fixture_editor";
const thumb =
  "https://rel.example.test/api/youtube-avatar?channel=" + channelId;
const migration = new URL(
  "../supabase/migrations/20261016160000_rel_editor_main_platform.sql",
  import.meta.url,
);

test("platform defaults preserve TikTok links, recognise YouTube-only editors and obey explicit choices", () => {
  const both = { id: "editor1", tiktok: "@fixture_editor", links: { youtube } };
  assert.equal(mainPlatform(both), "TikTok");
  assert.equal(primaryLink(both).url, "https://www.tiktok.com/@fixture_editor");
  assert.equal(mainPlatform({ links: { youtube } }), "YouTube");
  const chosen = { ...both, main_platform: "YouTube" };
  assert.deepEqual(primaryLink(chosen), {
    platform: "YouTube",
    url: youtube,
    handle: "@fixture_editor",
  });
  assert.deepEqual(avatarRequest(chosen), {
    editorId: "editor1",
    platform: "YouTube",
    channelUrl: youtube,
  });
  assert.equal(primaryLink({ ...chosen, links: {} }).url, "");
  assert.equal(
    primaryLink({
      ...both,
      tiktok: "",
      links: { tiktok: "https://www.tiktok.com/@secondary" },
    }).url,
    "https://www.tiktok.com/@secondary",
  );
  assert.equal(
    primaryLink({ ...both, main_platform: "TikTok" }).platform,
    "TikTok",
  );
  assert.equal(
    primaryLink({ ...chosen, handle: "Custom display" }).handle,
    "Custom display",
  );
});

test("channel URLs reject videos and lookalikes, support handles, IDs and legacy usernames", () => {
  for (const url of [
    "https://evil.test/@fixture_editor",
    "https://youtube.com.evil.test/@fixture_editor",
    "https://youtube.com/watch?v=abcdefghijk",
    "https://youtu.be/abcdefghijk",
    "javascript:alert(1)",
    "https://youtube.com:123/@fixture",
    "https://user:pass@youtube.com/@fixture",
    "http://youtube.com/@fixture",
    "https://youtube.com/@fixture%2Fvideos",
  ]) {
    assert.equal(youtubeChannel(url), null, url);
  }
  assert.equal(youtubeChannel(youtube + "?si=tracking").url, youtube);
  assert.equal(
    youtubeChannel("https://m.youtube.com/channel/" + channelId).parameter,
    "id",
  );
  assert.equal(
    youtubeChannel("https://youtube.com/user/fixture_editor").parameter,
    "forUsername",
  );
  assert.equal(
    youtubeChannel("https://youtube.com/c/fixture_editor").parameter,
    null,
  );
  assert.equal(
    youtubeChannel("https://youtube.com/@%E5%8B%95%E7%94%BB").value,
    "@動画",
  );
});

test("platform migration preserves editor data, revisions and permissions, including on a second run", async () => {
  const { db, rpc } = await fixture({ profiles: true, platforms: false });
  try {
    const before = await rpc(ids.owner, "rel_site");
    const sql = await readFile(migration, "utf8");
    await db.exec(sql);
    await db.exec(sql);
    assert.deepEqual(await rpc(ids.owner, "rel_site"), before);
    assert.equal(
      (await db.query("select count(*)::int n from rel_private.data_history"))
        .rows[0].n,
      0,
    );
    const profile = { main_platform: "YouTube", links: { youtube }, thumb };
    const saved = await rpc(ids.member, "rel_save_site", {
      p_revision: before.revision,
      p_data: null,
      p_profile: profile,
    });
    const after = await rpc(ids.owner, "rel_site");
    const expected = structuredClone(before.data);
    Object.assign(expected.editors[0], profile);
    assert.deepEqual(after.data, expected);
    assert.notEqual(saved.revision, before.revision);
    assert.deepEqual(
      (
        await db.query(
          "select data from rel_private.data_history where revision=$1",
          [before.revision],
        )
      ).rows[0].data,
      before.data,
    );
    for (const field of [
      { main_platform: "Other" },
      { main_platform: null },
      { main_platform: {} },
      { id: "editor2" },
      { lists: { main: ["editor1"] } },
      { roles: ["owner"] },
      { flares: [] },
    ]) {
      await assert.rejects(
        rpc(ids.member, "rel_save_site", {
          p_revision: after.revision,
          p_data: null,
          p_profile: field,
        }),
        /REL_FORBIDDEN/,
      );
    }
    await assert.rejects(
      rpc(ids.stranger, "rel_save_site", {
        p_revision: after.revision,
        p_data: null,
        p_profile: profile,
      }),
      /REL_FORBIDDEN/,
    );
    await assert.rejects(
      rpc(ids.member, "rel_save_site", {
        p_revision: before.revision,
        p_data: null,
        p_profile: profile,
      }),
      /REL_CONFLICT/,
    );
    const invalid = structuredClone(after.data);
    invalid.editors[1].main_platform = "Other";
    await assert.rejects(
      rpc(ids.contributor, "rel_save_site", {
        p_revision: after.revision,
        p_data: invalid,
        p_profile: null,
      }),
      /REL_INVALID/,
    );
    assert.deepEqual(await rpc(ids.owner, "rel_site"), after);
    const publicProfile = await db.transaction(async (tx) => {
      await tx.exec("set local role service_role");
      return (
        await tx.query(
          "select public.rel_public_profile(null,'editor1',null) as profile",
        )
      ).rows[0].profile;
    });
    assert.equal(publicProfile.editor.main_platform, "YouTube");
  } finally {
    await db.close();
  }
});

test("application conversion records either main platform and appends without reordering existing editors", async () => {
  const { db, rpc } = await fixture();
  try {
    for (const platform of ["TikTok", "YouTube"]) {
      const before = await rpc(ids.owner, "rel_site");
      const { id } = (
        await db.query(
          "insert into public.editor_applications(display_name,platform,profile_url,software,styles,examples_url) values ('Fixture',$1,$2,'CapCut',array['Test style'],'https://example.test/showcase') returning id",
          [
            platform,
            platform === "YouTube"
              ? youtube
              : "https://www.tiktok.com/@fixture_editor",
          ],
        )
      ).rows[0];
      await rpc(ids.reviewer, "rel_applications", {
        p_action: "update",
        p_id: id,
        p_status: "approved",
        p_offset: 0,
        p_reason: "Fixture approval",
      });
      await rpc(ids.contributor, "rel_pending_editors", {
        p_action: "convert",
        p_id: id,
        p_revision: before.revision,
      });
      const after = await rpc(ids.owner, "rel_site");
      assert.equal(after.data.editors.at(-1).main_platform, platform);
      assert.deepEqual(after.data.editors.slice(0, -1), before.data.editors);
      for (const key of Object.keys(before.data.lists))
        assert.deepEqual(
          after.data.lists[key].slice(0, -1),
          before.data.lists[key],
        );
    }
  } finally {
    await db.close();
  }
});

test("avatar routes enforce ownership, fetch either platform and leave rankings untouched", async () => {
  const service = await mockService();
  const request = (path, token, body) =>
    service.handle(
      new Request("https://rel.example.test" + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          origin: "https://rel.example.test",
          "Content-Type": "application/json",
          ...(token ? { cookie: "__Host-rel_access=" + token } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  try {
    const before = await service.rpc(ids.owner, "rel_site");
    const body = {
      editorId: "editor1",
      platform: "YouTube",
      channelUrl: youtube,
    };
    assert.equal((await request("/api/avatar", null, body)).status, 401);
    assert.equal((await request("/api/avatar", "stranger", body)).status, 403);
    assert.equal(
      (await request("/api/avatar", "member", { ...body, editorId: "editor2" }))
        .status,
      403,
    );
    assert.equal(
      (await request("/api/avatar", "owner", { ...body, platform: "Other" }))
        .status,
      400,
    );
    assert.equal(
      (
        await request("/api/avatar", "owner", {
          ...body,
          channelUrl: "https://youtube.com/watch?v=abcdefghijk",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request("/api/avatar", "member", {
          ...body,
          channelUrl: "https://youtube.com/c/fixture_editor",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request("/api/avatar", "member", {
          ...body,
          channelUrl: "https://youtube.com/@missing",
        })
      ).status,
      404,
    );
    service.failures.youtube = 403;
    assert.equal((await request("/api/avatar", "member", body)).status, 502);
    delete service.failures.youtube;
    const fetched = await request("/api/avatar", "member", body);
    assert.equal(fetched.status, 200);
    assert.deepEqual(await fetched.json(), { ok: true, url: thumb });
    assert.deepEqual(await service.rpc(ids.owner, "rel_site"), before);
    assert.ok(
      !service.log().some((entry) => entry.path.startsWith("/storage/")),
    );
    assert.equal(
      (await request("/api/youtube-avatar?channel=invalid")).status,
      400,
    );
    assert.equal(
      (await request("/api/youtube-avatar?channel=" + channelId)).status,
      404,
    );
    await service.rpc(ids.member, "rel_save_site", {
      p_revision: before.revision,
      p_data: null,
      p_profile: { main_platform: "YouTube", links: { youtube }, thumb },
    });
    const picture = await request("/api/youtube-avatar?channel=" + channelId);
    assert.equal(picture.status, 200);
    assert.equal(picture.headers.get("Content-Type"), "image/png");
    assert.match(picture.headers.get("Cache-Control"), /s-maxage=86400/);
    assert.equal((await picture.arrayBuffer()).byteLength, 68);
    const tiktok = await request("/api/avatar", "member", {
      editorId: "editor1",
      platform: "TikTok",
      username: "fixture_editor",
    });
    assert.equal(tiktok.status, 200);
    assert.match(
      (await tiktok.json()).url,
      /editor-avatars\/avatars\/editor1\//,
    );
    assert.deepEqual(
      (await service.rpc(ids.owner, "rel_site")).data.lists,
      before.data.lists,
    );
  } finally {
    await service.close();
  }
});

test("YouTube lookup and image download reject missing configuration, hostile thumbnails and oversized responses", async () => {
  const originalFetch = globalThis.fetch;
  try {
    await assert.rejects(
      lookupChannel({}, youtubeChannel(youtube)),
      (error) => error.status === 503,
    );
    let calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({ url: new URL(url), options });
      return new Response(
        JSON.stringify({
          items: [
            {
              id: channelId,
              snippet: {
                thumbnails: { high: { url: "https://evil.test/picture.png" } },
              },
            },
          ],
        }),
      );
    };
    await assert.rejects(
      lookupChannel(env, youtubeChannel(youtube)),
      /unsupported picture/,
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url.origin, "https://www.googleapis.com");
    assert.equal(calls[0].options.redirect, "error");
    globalThis.fetch = async () =>
      new Response("x", { headers: { "Content-Length": "64001" } });
    await assert.rejects(
      lookupChannel(env, youtubeChannel(youtube)),
      /too large/,
    );
    for (const response of [
      new Response("<svg/>", { headers: { "Content-Type": "image/svg+xml" } }),
      new Response("x", {
        headers: { "Content-Type": "image/png", "Content-Length": "5242881" },
      }),
    ]) {
      globalThis.fetch = async (_, options) => {
        assert.equal(options.redirect, "error");
        assert.ok(options.signal);
        return response;
      };
      await assert.rejects(
        channelPicture(
          env,
          new Request(thumb),
          { value: channelId },
          { source: new URL("https://yt3.googleusercontent.com/picture") },
        ),
        /PNG|too large/,
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("cached YouTube pictures avoid another provider request and refresh after cache expiry", async () => {
  const originalCache = globalThis.caches,
    originalFetch = globalThis.fetch;
  let cached,
    fetches = 0,
    checks = 0;
  try {
    globalThis.caches = {
      default: {
        match: async () => cached?.clone(),
        put: async (_, response) => {
          cached = response;
        },
      },
    };
    globalThis.fetch = async () => {
      fetches++;
      return new Response(new Uint8Array([255, 216, 255, 0]), {
        headers: { "Content-Type": "image/jpeg" },
      });
    };
    const run = () =>
      channelPicture(
        env,
        new Request(thumb),
        { value: channelId },
        { source: new URL("https://yt3.ggpht.com/picture") },
        async () => {
          checks++;
        },
      );
    await run();
    await run();
    assert.equal(fetches, 1);
    assert.equal(checks, 1);
    cached = undefined;
    await run();
    assert.equal(fetches, 2);
    assert.equal(checks, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCache === undefined) delete globalThis.caches;
    else globalThis.caches = originalCache;
  }
});
