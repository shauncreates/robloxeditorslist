import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fixture, ids } from "./auth-fixture.mjs";
import { mockService, env } from "./mock-service.mjs";
import { deliverApplicationEmails } from "../functions/_application-email.js";
import retryWorker from "../workers/application-email-retry.js";

const submission = () => ({ requestId: randomUUID(), displayName: "Test applicant", platform: "YouTube", profileUrl: "https://youtube.com/@fixture", software: "Blender", styles: ["Test style"], examplesUrl: "https://example.test/reel", notes: "Private notes" });
const request = (service, path, token, body) => service.handle(new Request("https://rel.example.test" + path, {
  method: body === undefined ? "GET" : "POST", headers: { origin: "https://rel.example.test", "Content-Type": "application/json", ...(token ? { cookie: "__Host-rel_access=" + token } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
}));
const review = (id, status = "approved") => ({ action: "update", id, status, reason: "Private staff assessment", message: "Examples meet the criteria. <Keep this as text>" });

test("applications require verified accounts, use the account email and replay safely", async () => {
  const service = await mockService();
  try {
    const body = { ...submission(), email: "forged@example.test", userId: ids.owner, status: "approved" };
    const before = await service.rpc(ids.owner, "rel_site");
    assert.equal((await request(service, "/api/applications", null, body)).status, 401);
    service.sessions.set("unconfirmed", { id: ids.stranger, email: "stranger@example.test", email_confirmed_at: null });
    assert.equal((await request(service, "/api/applications", "unconfirmed", body)).status, 401);
    const response = await request(service, "/api/applications", "stranger", body);
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.notification.sent, 1);
    assert.equal(service.emails[0].to[0], "stranger@example.test");
    assert.equal(service.emails[0].text, "Your application to the Roblox Editors list has been sent. Your request will be reviewed shortly.");
    assert.equal((await service.db.query("select status from public.editor_applications where id=$1", [result.id])).rows[0].status, "pending");
    assert.equal((await request(service, "/api/applications", "stranger", body)).status, 200);
    assert.equal(service.emails.length, 1);
    assert.equal((await request(service, "/api/applications", "stranger", submission())).status, 409);
    assert.equal((await service.db.query("select count(*)::int as n from public.editor_applications")).rows[0].n, 1);
    assert.deepEqual(await service.rpc(ids.owner, "rel_site"), before);
    assert.equal((await request(service, "/api/applications", "member", submission())).status, 201);
    const pending = await (await request(service, "/api/applications/admin", "reviewer", { action: "list" })).json();
    assert.equal(pending.total, 2);
    assert.ok(!JSON.stringify(pending).includes("@example.test"));
  } finally { await service.close(); }
});

test("applicants see only their own safe projection and new messages, including after private archiving",async()=>{
  const service=await mockService();try{
    const {id}=await(await request(service,"/api/applications","member",submission())).json();
    assert.equal((await request(service,"/api/account/applications",null)).status,401);
    assert.equal((await(await request(service,"/api/account/applications","stranger")).json()).total,0);
    assert.equal((await request(service,"/api/applications/admin","reviewer",{...review(id),message:undefined})).status,400);
    await request(service,"/api/applications/admin","reviewer",review(id));
    const data=await(await request(service,"/api/account/applications","member")).json();
    assert.equal(data.total,1);assert.equal(data.applications[0].applicant_message,review(id).message);
    assert.ok(!JSON.stringify(data).includes(review(id).reason));
    for(const field of ["review_reason","reviewed_by","reviewer_username","email","notes"])assert.equal(Object.hasOwn(data.applications[0],field),false);
    await request(service,"/api/applications/admin","owner",{action:"archive",id});
    assert.equal((await(await request(service,"/api/account/applications","member")).json()).applications[0].archived,true);
    assert.equal((await request(service,"/api/account/applications?offset=-1","member")).status,400);
  }finally{await service.close()}
});

test("both decision emails include the reason and remove the application from the pending queue", async () => {
  const service = await mockService();
  try {
    const before = await service.rpc(ids.owner, "rel_site");
    for (const [token, status] of [["stranger", "approved"], ["member", "rejected"]]) {
      const { id } = await (await request(service, "/api/applications", token, submission())).json();
      const decided = await request(service, "/api/applications/admin", "reviewer", review(id, status));
      assert.equal(decided.status, 200);
      assert.equal((await decided.json()).notification.sent, 1);
      const message = service.emails.at(-1);
      assert.equal(message.to[0], token + "@example.test");
      assert.match(message.subject, status === "approved" ? /approved/ : /denied/);
      assert.ok(message.text.includes(review(id).message));
      assert.ok(!message.text.includes(review(id).reason));
      assert.ok(message.html.includes("&lt;Keep this as text&gt;"));
      assert.ok(!message.html.includes("<Keep this as text>")&&!message.html.includes(review(id).reason));
      const pending = await service.rpc(ids.reviewer, "rel_applications", { p_action: "list" });
      assert.equal(pending.total, 0);
      assert.equal((await request(service, "/api/applications/admin", "owner", review(id, status))).status, 409);
    }
    assert.equal((await service.rpc(ids.owner, "rel_applications", { p_action: "list_reviewed" })).total, 2);
    await assert.rejects(service.rpc(ids.reviewer, "rel_applications", { p_action: "list_reviewed" }), /REL_FORBIDDEN/);
    const approved = await service.rpc(ids.contributor, "rel_pending_editors", { p_action: "list", p_id: null, p_revision: null });
    assert.equal(approved.total, 1);
    assert.deepEqual(await service.rpc(ids.owner, "rel_site"), before);
    assert.equal(service.emails.length, 4);
  } finally { await service.close(); }
});

test("Owner archiving preserves decisions, prevents conversion and leaves rankings unchanged", async () => {
  const service = await mockService();
  try {
    const before = await service.rpc(ids.owner, "rel_site");
    const { id } = await (await request(service, "/api/applications", "stranger", submission())).json();
    await request(service, "/api/applications/admin", "reviewer", review(id));
    const decided = (await service.db.query("select * from public.editor_applications where id=$1", [id])).rows[0];
    for (const role of ["member", "reviewer", "contributor"]) {
      assert.equal((await request(service, "/api/applications/admin", role, { action: "archive", id })).status, 403);
    }
    assert.equal((await request(service, "/api/applications/admin", "owner", { action: "archive", id })).status, 200);
    assert.equal((await request(service, "/api/applications/admin", "owner", { action: "archive", id })).status, 200);
    assert.equal((await service.rpc(ids.owner, "rel_applications", { p_action: "list_reviewed" })).total, 0);
    const archived = await service.rpc(ids.owner, "rel_applications", { p_action: "list_archived" });
    assert.equal(archived.total, 1); assert.equal(archived.applications[0].archived_username, "owner");
    assert.deepEqual((await service.db.query("select * from public.editor_applications where id=$1", [id])).rows[0], decided);
    assert.equal((await service.rpc(ids.contributor, "rel_pending_editors", { p_action: "list", p_id: null, p_revision: null })).total, 0);
    await assert.rejects(service.rpc(ids.contributor, "rel_pending_editors", { p_action: "convert", p_id: id, p_revision: before.revision }), /REL_APPLICATION_ARCHIVED/);
    assert.equal((await service.db.query("select count(*)::int as n from rel_private.application_decisions")).rows[0].n, 1);
    assert.equal((await service.db.query("select count(*)::int as n from rel_private.audit where action='archive_application'")).rows[0].n, 1);
    assert.deepEqual(await service.rpc(ids.owner, "rel_site"), before);
  } finally { await service.close(); }
});

test("pending archives allow a replacement submission; direct RPCs cannot forge roles or bypass validation", async () => {
  const { db, rpc, asUser } = await fixture({ notifications: true });
  try {
    const data = { display_name: "Applicant", platform: "YouTube", profile_url: "https://youtube.com/@fixture", software: "Blender", styles: ["Test style"], examples_url: "https://example.test", notes: null };
    const submit = p_data => rpc(ids.stranger, "rel_submit_application", { p_request_id: randomUUID(), p_data });
    for (const invalid of [{ ...data, display_name: null }, { ...data, platform: "Other" }, { ...data, profile_url: "https://youtube.com.evil.test" }, { ...data, styles: ["Forged"] }, { ...data, styles: [7] }, { ...data, styles: {} }, { ...data, examples_url: "javascript:alert(1)" }, { ...data, extra: "x".repeat(17000) }]) await assert.rejects(submit(invalid), /REL_INVALID/);
    const { id } = await submit(data);
    await rpc(ids.owner, "rel_applications", { p_action: "archive", p_id: id });
    await assert.rejects(rpc(ids.reviewer, "rel_applications", { p_action: "update", p_id: id, p_status: "approved", p_offset: 0, p_reason: "Reason" }), /REL_APPLICATION_ARCHIVED/);
    assert.ok((await submit(data)).id);
    for (const table of ["application_contacts", "application_archives", "application_email_outbox", "audit"]) await assert.rejects(asUser(ids.owner, "select * from rel_private." + table), /permission denied/);
    await assert.rejects(asUser(ids.owner, "select public.rel_email_work('claim')"), /permission denied/);
    await assert.rejects(asUser(ids.owner, "select rel_private.applications_before_archives('list',null,null,0,null)"), /permission denied/);
    await assert.rejects(asUser(ids.owner, "select rel_private.pending_editors_before_archives('list',null,null)"), /permission denied/);
    assert.equal((await db.query("select count(*)::int as n from rel_private.application_contacts")).rows[0].n, 2);
  } finally { await db.close(); }
});

test("provider failure retains ordered emails; Owner retries cannot change the saved decision", async () => {
  const service = await mockService();
  try {
    service.failures.email = 503;
    const { id } = await (await request(service, "/api/applications", "stranger", submission())).json();
    const decision = await request(service, "/api/applications/admin", "reviewer", review(id, "rejected"));
    assert.equal(decision.status, 200);
    assert.equal((await decision.json()).notification.sent, 0);
    assert.equal((await service.db.query("select count(*)::int as n from rel_private.application_email_outbox where delivered_at is null")).rows[0].n, 2);
    for (const role of [null, "member", "reviewer", "contributor"]) assert.equal((await request(service, "/api/applications/notifications", role, {})).status, role ? 403 : 401);
    delete service.failures.email;
    await service.db.exec("update rel_private.application_email_outbox set next_attempt_at=now()");
    const delivered = await request(service, "/api/applications/notifications", "owner", {});
    assert.equal((await delivered.json()).sent, 2);
    assert.match(service.emails[0].subject, /received/); assert.match(service.emails[1].subject, /denied/);
    assert.equal((await (await request(service, "/api/applications/notifications", "owner", {})).json()).sent, 0);
    assert.equal(service.emails.length, 2);
    assert.equal((await service.db.query("select status from public.editor_applications where id=$1", [id])).rows[0].status, "rejected");
    const skipped = await deliverApplicationEmails({ ...env, RESEND_API_KEY: "" });
    assert.equal(skipped.status, "unconfigured");
  } finally { await service.close(); }
});

test("ranking and review activity records stable actor identities, exact movements and no failed changes", async () => {
  const service = await mockService();
  try {
    const before = await service.rpc(ids.owner, "rel_site"), changed = structuredClone(before.data);
    changed.lists.main.reverse();
    const saved = await service.rpc(ids.contributor, "rel_save_site", { p_revision: before.revision, p_data: changed });
    await assert.rejects(service.rpc(ids.contributor, "rel_save_site", { p_revision: before.revision, p_data: before.data }), /REL_CONFLICT/);
    await service.rpc(ids.contributor, "rel_username", { p_username: "new_contributor" });
    const { id } = await (await request(service, "/api/applications", "stranger", submission())).json();
    await request(service, "/api/applications/admin", "reviewer", review(id));
    await service.rpc(ids.reviewer, "rel_username", { p_username: "new_reviewer" });
    for (const role of [null, "member", "contributor", "reviewer"]) assert.equal((await request(service, "/api/account/activity", role)).status, role ? 403 : 401);
    const events = (await (await request(service, "/api/account/activity", "owner")).json()).events;
    const ranking = events.filter(event => event.action === "rank_change");
    assert.equal(ranking.length, 1); assert.equal(ranking[0].actor_username, "contributor"); assert.equal(ranking[0].actor_id, ids.contributor);
    assert.equal(ranking[0].details.previous_revision, before.revision); assert.equal(ranking[0].details.revision, saved.revision);
    assert.deepEqual(ranking[0].details.changes.map(({ editor_id, from_rank, to_rank }) => ({ editor_id, from_rank, to_rank })), [
      { editor_id: "editor1", from_rank: 2, to_rank: 1 }, { editor_id: "editor2", from_rank: 1, to_rank: 2 },
    ]);
    const reviewed = events.find(event => event.action === "review_application");
    assert.equal(reviewed.actor_username, "reviewer"); assert.equal(reviewed.details.reason, review(id).reason);
    assert.ok(!JSON.stringify(events).includes("@example.test"));
    await service.db.query("delete from auth.sessions where user_id=$1", [ids.reviewer]);
    await service.db.query("delete from auth.users where id=$1", [ids.reviewer]);
    const deleted = (await service.rpc(ids.owner, "rel_activity", { p_kind: "applications", p_offset: 0 })).events.find(event => event.action === "review_application");
    assert.equal(deleted.actor_username, "reviewer"); assert.equal(deleted.actor_id, null);
  } finally { await service.close(); }
});

test("new migration preserves existing decisions, rankings and history without inventing recipients", async () => {
  const f = await fixture();
  try {
    const id = (await f.db.query("insert into public.editor_applications(display_name,platform,profile_url,software,styles,examples_url) values ('Legacy','YouTube','https://youtube.com/@legacy','Blender',array['Test style'],'https://example.test') returning id")).rows[0].id;
    await f.rpc(ids.reviewer, "rel_applications", { p_action: "update", p_id: id, p_status: "approved", p_offset: 0, p_reason: "Existing reason" });
    const before = await f.rpc(ids.owner, "rel_site"), application = (await f.db.query("select * from public.editor_applications")).rows;
    const history = (await f.db.query("select * from rel_private.data_history")).rows;
    await f.db.exec(await readFile(new URL("../supabase/migrations/20261016120000_rel_application_tracking.sql", import.meta.url), "utf8"));
    assert.deepEqual(await f.rpc(ids.owner, "rel_site"), before);
    const migrated=(await f.db.query("select * from public.editor_applications")).rows;
    assert.ok(migrated.every(row=>row.applicant_message===null));
    assert.deepEqual(migrated.map(({applicant_message,...existing})=>existing), application);
    assert.deepEqual((await f.db.query("select * from rel_private.data_history")).rows, history);
    assert.equal((await f.db.query("select count(*)::int as n from rel_private.application_email_outbox")).rows[0].n, 0);
    assert.equal((await f.rpc(ids.reviewer, "rel_applications", { p_action: "list" })).total, 0);
    assert.equal((await f.rpc(ids.owner, "rel_applications", { p_action: "list_reviewed" })).total, 1);
  } finally { await f.db.close(); }
});

test("email leases prevent parallel sends and a lost acknowledgement reuses provider idempotency", async () => {
  const service = await mockService();
  try {
    service.failures.emailAck = true;
    const { id } = await (await request(service, "/api/applications", "stranger", submission())).json();
    assert.equal(service.emails.length, 1);
    const work = (await service.db.query("select * from rel_private.application_email_outbox")).rows[0];
    assert.equal(work.delivered_at, null); assert.ok(work.lease);
    assert.equal((await deliverApplicationEmails(env, id)).sent, 0);
    delete service.failures.emailAck;
    await service.db.exec("update rel_private.application_email_outbox set locked_until=now()-interval '1 second'");
    const attempts = await Promise.all([deliverApplicationEmails(env, id), deliverApplicationEmails(env, id)]);
    assert.equal(attempts.reduce((n, result) => n + result.sent, 0), 1);
    assert.equal(service.emails.length, 1);
    assert.ok((await service.db.query("select delivered_at from rel_private.application_email_outbox")).rows[0].delivered_at);
  } finally { await service.close(); }
});

test("the scheduled Worker drains queued messages and never exposes a public send endpoint", async () => {
  const service = await mockService();
  try {
    const data = { display_name: "Queued applicant", platform: "YouTube", profile_url: "https://youtube.com/@fixture", software: "Blender", styles: ["Test style"], examples_url: "https://example.test" };
    await service.rpc(ids.stranger, "rel_submit_application", { p_request_id: randomUUID(), p_data: data });
    const tasks = [];
    retryWorker.scheduled({}, env, { waitUntil: task => tasks.push(task) });
    await Promise.all(tasks);
    assert.equal(service.emails.length, 1);
    assert.equal(retryWorker.fetch().status, 404);
  } finally { await service.close(); }
});

test("outbox failure rolls back submission and competing requests create one application", async () => {
  const service = await mockService();
  try {
    await service.db.exec("alter table rel_private.application_email_outbox add constraint fixture_queue_failure check(false)");
    assert.equal((await request(service, "/api/applications", "stranger", submission())).status, 400);
    assert.equal((await service.db.query("select count(*)::int as n from public.editor_applications")).rows[0].n, 0);
    await service.db.exec("alter table rel_private.application_email_outbox drop constraint fixture_queue_failure");
    const body = submission();
    const responses = await Promise.all([request(service, "/api/applications", "stranger", body), request(service, "/api/applications", "stranger", body)]);
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 201]);
    assert.equal((await service.db.query("select count(*)::int as n from public.editor_applications")).rows[0].n, 1);
    assert.equal((await service.db.query("select count(*)::int as n from rel_private.application_email_outbox")).rows[0].n, 1);
  } finally { await service.close(); }
});
