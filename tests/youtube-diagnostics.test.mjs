import { test } from "node:test";
import assert from "node:assert/strict";
import { mockService } from "./mock-service.mjs";
import { providerJson, youtubeCallbackDiagnostic } from "../functions/_youtube.js";

const base = "https://rel.example.test";
const cookie = (response, kind) => response.headers.getSetCookie()
  .find(value => value.startsWith("__Host-rel_youtube_" + kind + "="))?.split(";")[0] || "";
async function start(service) {
  const response = await service.handle(new Request(base + "/api/account/youtube/start", {
    method: "POST", headers: { origin: base, cookie: "__Host-rel_access=member", "Content-Type": "application/json" }, body: "{}",
  }));
  assert.equal(response.status, 200);
  const url = new URL((await response.json()).url);
  return { state: url.searchParams.get("state"), cookie: cookie(response, "state") };
}
const callback = (service, flow) => service.handle(new Request(base + "/api/account/youtube/callback?state=" + flow.state + "&code=fixture-youtube-code", {
  headers: { cookie: flow.cookie },
}));

test("provider diagnostics allow only recognised error codes and HTTP statuses", async () => {
  const original = globalThis.fetch;
  try {
    for (const body of [
      { error: "invalid_client", error_description: "private-description", client_secret: "private-client-secret", refresh_token: "private-refresh-token" },
      { error: { code: 403, message: "private-description", errors: [{ reason: "accessNotConfigured" }] } },
      { error: "private-refresh-token", error_description: "private-description" },
    ]) {
      globalThis.fetch = async () => new Response(JSON.stringify(body), { status: 403 });
      await assert.rejects(providerJson("https://oauth2.googleapis.com/token", {}), error => {
        const diagnostic = youtubeCallbackDiagnostic("token_exchange", error), encoded = JSON.stringify(diagnostic);
        assert.equal(diagnostic.provider_status, 403);
        assert.equal(diagnostic.provider_code, typeof body.error === "object" ? "accessNotConfigured" : body.error === "invalid_client" ? "invalid_client" : undefined);
        for (const secret of ["private-description", "private-client-secret", "private-refresh-token"]) assert.equal(encoded.includes(secret), false);
        return true;
      });
    }
    globalThis.fetch = async () => new Response("x".repeat(70000), { status: 502 });
    await assert.rejects(providerJson("https://oauth2.googleapis.com/token", {}), error => {
      assert.equal(error.providerStatus, 502);
      assert.equal(error.providerCode, undefined);
      return true;
    });
    assert.deepEqual(youtubeCallbackDiagnostic("claim", { message: "private-description", stack: "private-stack", providerCode: "private-secret", providerStatus: "private-status", serviceStatus: 503, callbackReason: "private-reason" }), {
      event: "rel_youtube_callback_failed", stage: "claim", reason: "unexpected_failure", service_status: 503,
    });
  } finally { globalThis.fetch = original; }
});

test("failed callbacks identify the stage without logging credentials or request material", async () => {
  for (const scenario of ["invalid_client", "missing_scope", "no_channels", "claim_unavailable"]) {
    const service = await mockService({ google: true }), logs = [], originalError = console.error;
    try {
      const flow = await start(service), fetchFixture = globalThis.fetch;
      if (scenario === "missing_scope") service.failures.googleScope = true;
      if (scenario === "no_channels") service.googleState.channels = [];
      globalThis.fetch = async (input, options) => {
        if (scenario === "invalid_client" && String(input) === "https://oauth2.googleapis.com/token")
          return new Response(JSON.stringify({ error: "invalid_client", error_description: "private-provider-description", client_secret: "private-provider-secret" }), { status: 401 });
        if (scenario === "claim_unavailable" && String(input).endsWith("/rpc/rel_youtube_exchange"))
          return new Response(JSON.stringify({ message: "private-database-description" }), { status: 503 });
        return fetchFixture(input, options);
      };
      console.error = (...args) => logs.push(args);
      const response = await callback(service, flow);
      assert.equal(new URL(response.headers.get("Location")).search, "?youtube=failed");
      assert.equal(logs.length, 1);
      assert.equal(logs[0].length, 1);
      const diagnostic = JSON.parse(logs[0][0]);
      assert.equal(diagnostic.event, "rel_youtube_callback_failed");
      assert.equal(diagnostic.stage, { invalid_client: "token_exchange", missing_scope: "token_response", no_channels: "channel_response", claim_unavailable: "claim" }[scenario]);
      if (scenario === "invalid_client") {
        assert.equal(diagnostic.provider_status, 401);
        assert.equal(diagnostic.provider_code, "invalid_client");
      } else if (scenario === "claim_unavailable") assert.equal(diagnostic.service_status, 503);
      else assert.equal(diagnostic.reason, scenario);
      const encoded = JSON.stringify(logs);
      for (const secret of [flow.state, flow.cookie, "fixture-youtube-code", "fixture-google-secret", "fixture-google-token", "fixture-refresh-token", "private-provider-description", "private-provider-secret", "private-database-description"])
        assert.equal(encoded.includes(secret), false);
      assert.equal((await service.db.query("select count(*)::int as n from rel_private.youtube_connections")).rows[0].n, 0);
      assert.equal(cookie(response, "finish"), "__Host-rel_youtube_finish=");
    } finally { console.error = originalError; await service.close(); }
  }
});

test("successful authorisation and intentional cancellation produce no failure diagnostic", async () => {
  for (const cancelled of [false, true]) {
    const service = await mockService({ google: true }), logs = [], originalError = console.error;
    try {
      const flow = await start(service);
      console.error = (...args) => logs.push(args);
      const response = cancelled
        ? await service.handle(new Request(base + "/api/account/youtube/callback?state=" + flow.state + "&error=access_denied", { headers: { cookie: flow.cookie } }))
        : await callback(service, flow);
      assert.equal(new URL(response.headers.get("Location")).searchParams.get("youtube"), cancelled ? "cancelled" : "ready");
      assert.deepEqual(logs, []);
    } finally { console.error = originalError; await service.close(); }
  }
});
