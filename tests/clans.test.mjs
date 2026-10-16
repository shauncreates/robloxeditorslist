import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mockService } from "./mock-service.mjs";
import { fixture, ids } from "./auth-fixture.mjs";
import { hash } from "../functions/_tiktok.js";

const base = "https://rel.example.test";
const call = (s, path, user, body) =>
  s.handle(
    new Request(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        origin: base,
        "Content-Type": "application/json",
        ...(user ? { cookie: "__Host-rel_access=" + user } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
async function action(s, user, body, status = 200) {
  const r = await call(s, "/api/account/clans", user, body);
  assert.equal(r.status, status, await r.clone().text());
  return r.json();
}
async function create(
  s,
  user = "owner",
  prefix = "RELS",
  name = "Fixture clan",
) {
  return (await action(s, user, { action: "create", name, prefix })).clan_id;
}
async function invite(s, id, user = "owner") {
  const result = await action(s, user, { action: "invite", clanId: id });
  return new URL(result.inviteUrl).hash.slice("#invite=".length);
}
async function publicClan(s, id) {
  const response = await call(s, "/api/clans?id=" + id);
  assert.equal(response.status, 200);
  return (await response.json()).clans[0];
}
const prefixes = async (s) =>
  (await (await call(s, "/api/clans?prefixes=1")).json()).prefixes;

test("clans need a confirmed account, enforce four-character unique prefixes and never change account roles or rankings", async () => {
  const s = await mockService();
  try {
    const before = await s.rpc(ids.owner, "rel_site"),
      accounts = (
        await s.db.query("select * from rel_private.accounts order by id")
      ).rows;
    await action(
      s,
      null,
      { action: "create", name: "Example", prefix: "RELS" },
      401,
    );
    for (const prefix of ["A", "ABCDE", "A BC", "🟢ABC", "äBCD", "AB-D"])
      await action(
        s,
        "owner",
        { action: "create", name: "Example", prefix },
        400,
      );
    const id = await create(s, "owner", "rels");
    assert.equal((await publicClan(s, id)).prefix, "RELS");
    assert.equal((await publicClan(s, id)).members[0].account_id, ids.owner);
    await action(
      s,
      "member",
      { action: "create", name: "Other clan", prefix: "RELS" },
      409,
    );
    await action(
      s,
      "member",
      { action: "create", name: "fixture CLAN", prefix: "ABCD" },
      409,
    );
    await action(
      s,
      "owner",
      { action: "create", name: "Another", prefix: "MORE" },
      409,
    );
    assert.deepEqual(await s.rpc(ids.owner, "rel_site"), before);
    assert.deepEqual(
      (await s.db.query("select * from rel_private.accounts order by id")).rows,
      accounts,
    );
    await s.db.query(
      "update auth.users set email_confirmed_at=null where id=$1",
      [ids.member],
    );
    await action(
      s,
      "member",
      { action: "create", name: "Unconfirmed", prefix: "TEST" },
      401,
    );
  } finally {
    await s.close();
  }
});

test("invite previews never join; explicit joining publishes membership and a prefix; replacing/revoking/expiry stop old links", async () => {
  const s = await mockService();
  try {
    const id = await create(s),
      token = await invite(s, id);
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    const stored = (
      await s.db.query(
        "select token_hash,expires_at from rel_private.clan_invites",
      )
    ).rows[0];
    assert.equal(stored.token_hash, await hash(token));
    assert.ok(!stored.token_hash.includes(token));
    const preview = await call(s, "/api/clans/invite", null, { invite: token });
    assert.equal(preview.status, 200);
    assert.equal((await preview.json()).id, id);
    assert.equal((await publicClan(s, id)).members.length, 1);
    await action(s, null, { action: "join", invite: token }, 401);
    await action(s, "member", {
      action: "join",
      invite: token,
      clanId: "00000000-0000-4000-8000-000000000099",
      user_id: ids.stranger,
    });
    assert.equal((await publicClan(s, id)).members.length, 2);
    assert.equal((await prefixes(s)).editor1.prefix, "RELS");
    assert.equal(
      (await (await call(s, "/api/profiles?account=" + ids.member)).json()).clan
        .id,
      id,
    );
    await action(s, "member", { action: "join", invite: token }, 409);
    const second = await invite(s, id);
    assert.notEqual(second, token);
    assert.equal(
      (await call(s, "/api/clans/invite", null, { invite: token })).status,
      404,
    );
    await action(s, "stranger", { action: "join", invite: token }, 404);
    await action(s, "owner", { action: "revoke_invite", clanId: id });
    await action(s, "stranger", { action: "join", invite: second }, 404);
    const third = await invite(s, id);
    await s.db.exec(
      "update rel_private.clan_invites set expires_at=now()-interval '1 second'",
    );
    await action(s, "stranger", { action: "join", invite: third }, 404);
    const audit = JSON.stringify(
      (await s.db.query("select * from rel_private.audit")).rows,
    );
    for (const secret of [token, second, third, stored.token_hash])
      assert.ok(!audit.includes(secret));
  } finally {
    await s.close();
  }
});

test("only the creator manages a clan; prefix updates affect all members; removal and leaving clear prefixes", async () => {
  const s = await mockService();
  try {
    const id = await create(s),
      token = await invite(s, id);
    await action(s, "member", { action: "join", invite: token });
    const other = await create(s, "stranger", "OTHR", "Other clan");
    for (const user of ["member", "stranger"]) {
      for (const body of [
        { action: "update", name: "Stolen", prefix: "HACK" },
        { action: "invite" },
        { action: "revoke_invite" },
        { action: "remove", memberId: ids.owner },
        { action: "disband" },
      ])
        await action(s, user, { ...body, clanId: id }, 403);
    }
    await action(
      s,
      "owner",
      { action: "remove", clanId: other, memberId: ids.stranger },
      403,
    );
    await action(s, "owner", { action: "leave" }, 409);
    await action(
      s,
      "owner",
      { action: "remove", clanId: id, memberId: ids.owner },
      409,
    );
    await action(s, "owner", {
      action: "update",
      clanId: id,
      name: "Updated fixture",
      prefix: "NEW1",
    });
    assert.equal((await prefixes(s)).editor1.prefix, "NEW1");
    await action(s, "owner", {
      action: "remove",
      clanId: id,
      memberId: ids.member,
    });
    assert.equal((await prefixes(s)).editor1, undefined);
    await action(s, "member", { action: "join", invite: token });
    await action(s, "member", { action: "leave" });
    assert.equal((await publicClan(s, id)).members.length, 1);
    const audit = (
      await s.db.query(
        "select actor_id,action,target from rel_private.audit where action like '%_clan' order by created_at",
      )
    ).rows;
    assert.ok(
      audit.some(
        (row) =>
          row.action === "join_clan" &&
          row.actor_id === ids.member &&
          row.target === id,
      ),
    );
    assert.ok(
      audit.some(
        (row) => row.action === "update_clan" && row.actor_id === ids.owner,
      ),
    );
  } finally {
    await s.close();
  }
});

test("disbanding removes memberships/invites/prefixes and permits joining another clan without touching ranks", async () => {
  const s = await mockService();
  try {
    const before = await s.rpc(ids.owner, "rel_site"),
      id = await create(s),
      token = await invite(s, id);
    await action(s, "member", { action: "join", invite: token });
    await action(s, "owner", { action: "disband", clanId: id });
    assert.equal((await call(s, "/api/clans?id=" + id)).status, 404);
    for (const table of ["clans", "clan_members", "clan_invites"])
      assert.equal(
        (await s.db.query("select * from rel_private." + table)).rows.length,
        0,
      );
    assert.deepEqual(await prefixes(s), {});
    await create(s, "member", "NEXT", "Next clan");
    assert.deepEqual(await s.rpc(ids.owner, "rel_site"), before);
  } finally {
    await s.close();
  }
});

test("inactive accounts have no public membership/prefix; revoked sessions, CSRF and direct private access fail", async () => {
  const s = await mockService();
  try {
    const id = await create(s),
      token = await invite(s, id);
    await action(s, "member", { action: "join", invite: token });
    await s.db.query(
      "update rel_private.accounts set disabled=true where id=$1",
      [ids.member],
    );
    assert.equal((await publicClan(s, id)).members.length, 1);
    assert.deepEqual(await prefixes(s), {});
    await action(s, "member", { action: "leave" }, 403);
    await s.db.query(
      "update rel_private.accounts set disabled=false where id=$1",
      [ids.member],
    );
    await s.db.query("delete from auth.sessions where user_id=$1", [
      ids.member,
    ]);
    await action(s, "member", { action: "leave" }, 401);
    assert.equal(
      (
        await s.handle(
          new Request(base + "/api/account/clans", {
            method: "POST",
            headers: {
              origin: "https://evil.test",
              cookie: "__Host-rel_access=owner",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ action: "disband", clanId: id }),
          }),
        )
      ).status,
      403,
    );
    for (const [name, args] of [
      ["rel_public_clans", {}],
      ["rel_clan_prefixes", {}],
      ["rel_clan_invitation", { p_hash: await hash(token) }],
    ])
      await assert.rejects(s.rpc(ids.owner, name, args), /permission denied/);
    await s.db.exec(
      "grant select on rel_private.clans,rel_private.clan_members,rel_private.clan_invites to authenticated",
    );
    await s.db.transaction(async (tx) => {
      await tx.exec("set local role authenticated");
      for (const table of ["clans", "clan_members", "clan_invites"])
        assert.equal(
          (await tx.query("select * from rel_private." + table)).rows.length,
          0,
        );
    });
    assert.equal((await call(s, "/api/clans?id=bad")).status, 400);
    assert.equal(
      (await call(s, "/api/clans/invite", null, { invite: "bad" })).status,
      400,
    );
  } finally {
    await s.close();
  }
});

test("the clan migration preserves existing account/ranking/audit data", async () => {
  const s = await fixture({ profiles: true });
  try {
    const rankings = await s.rpc(ids.owner, "rel_site"),
      accounts = await s.db.query(
        "select * from rel_private.accounts order by id",
      ),
      audit = await s.db.query("select * from rel_private.audit order by id");
    await s.db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/20261016200000_rel_clans.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    assert.deepEqual(await s.rpc(ids.owner, "rel_site"), rankings);
    assert.deepEqual(
      await s.db.query("select * from rel_private.accounts order by id"),
      accounts,
    );
    assert.deepEqual(
      await s.db.query("select * from rel_private.audit order by id"),
      audit,
    );
  } finally {
    await s.db.close();
  }
});
