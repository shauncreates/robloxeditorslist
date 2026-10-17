import { test } from "node:test";
import assert from "node:assert/strict";
import { mockService } from "./mock-service.mjs";
import { providerJson, tiktokCallbackDiagnostic } from "../functions/_tiktok.js";

test("TikTok diagnostics expose only fixed reasons, recognised codes and HTTP statuses", async () => {
  const original = globalThis.fetch;
  try {
    for (const [body, status, expected] of [
      [{error: "invalid_client", error_description: "private-description", client_secret: "private-secret"}, 401, "invalid_client"],
      [{error: {code: "scope_not_authorized", message: "private-description", log_id: "private-id"}}, 200, "scope_not_authorized"],
      [{error: "private-secret"}, 403, undefined],
    ]) {
      globalThis.fetch = async () => Response.json(body, {status});
      await assert.rejects(providerJson("https://open.tiktokapis.com/v2/oauth/token/"), error => {
        const diagnostic = tiktokCallbackDiagnostic("token_exchange", error);
        assert.equal(diagnostic.provider_code, expected);
        assert.equal(diagnostic.provider_status, status);
        assert.equal(diagnostic.reason, status === 200 ? "provider_api_error" : "provider_http_error");
        assert.doesNotMatch(JSON.stringify(diagnostic), /private-/);
        return true;
      });
    }
    for (const [response, reason] of [
      [new Response("private-invalid-json"), "provider_invalid_json"],
      [new Response("x".repeat(70000)), "provider_response_too_large"],
      [new Response(null), "provider_empty_response"],
    ]) {
      globalThis.fetch = async () => response;
      await assert.rejects(providerJson("https://open.tiktokapis.com/v2/oauth/token/"), error => {
        assert.equal(error.callbackReason, reason);
        assert.equal(error.providerStatus, 200);
        return true;
      });
    }
    for (const [name, reason] of [["TimeoutError", "provider_timeout"], ["TypeError", "provider_request_failed"]]) {
      globalThis.fetch = async () => { throw Object.assign(new Error("private-description"), {name}); };
      await assert.rejects(providerJson("https://open.tiktokapis.com/v2/oauth/token/"), error => {
        assert.equal(error.callbackReason, reason);
        assert.equal(tiktokCallbackDiagnostic("token_exchange", error).error_kind, name);
        return true;
      });
    }
    assert.deepEqual(tiktokCallbackDiagnostic("private-stage", {
      callbackStage: "private-stage", callbackReason: "private-reason", providerCode: "private-secret",
      name: "private-name", providerStatus: "private-status", serviceStatus: 503, message: "private-message",
    }), {event: "rel_tiktok_callback_failed", stage: "unknown", reason: "unexpected_failure", service_status: 503});
  } finally { globalThis.fetch = original; }
});

test("TikTok callback logs the failed boundary without credentials and never saves a failed connection", async () => {
  for (const scenario of ["token_exchange", "token_response", "profile_lookup", "revocation", "claim", "proof_storage", "audience_storage"]) {
    const service = await mockService({tiktok: true}), logs = [], originalError = console.error;
    try {
      const start = await service.handle(new Request("https://rel.example.test/api/account/tiktok/start", {
        method: "POST", headers: {origin: "https://rel.example.test", cookie: "__Host-rel_access=member", "Content-Type": "application/json"}, body: "{}",
      }));
      assert.equal(start.status, 200);
      const state = new URL((await start.json()).url).searchParams.get("state"), fixtureFetch = globalThis.fetch;
      if (scenario === "token_response") service.failures.tiktokScopes = "user.info.basic";
      globalThis.fetch = async (input, options) => {
        const path = new URL(input).pathname;
        if (scenario === "token_exchange" && path === "/v2/oauth/token/")
          return Response.json({error: "invalid_client", error_description: "private-description"}, {status: 401});
        if ((scenario === "profile_lookup" && path === "/v2/user/info/") || (scenario === "revocation" && path === "/v2/oauth/revoke/"))
          return Response.json({error: {code: "internal_error", message: "private-description"}}, {status: 503});
        const action = path.endsWith("/rel_tiktok_exchange") ? JSON.parse(options.body).p_action : "";
        if ((scenario === "claim" && action === "claim") || (scenario === "proof_storage" && action === "proof") || (scenario === "audience_storage" && path.endsWith("/rel_audience_stage")))
          return Response.json({message: "private-database-description"}, {status: 503});
        return fixtureFetch(input, options);
      };
      console.error = (...args) => logs.push(args);
      const response = await service.handle(new Request("https://rel.example.test/api/account/tiktok/callback?state=" + state + "&code=fixture-tiktok-code-private", {
        headers: {cookie: "__Host-rel_tiktok_state=" + state},
      }));
      assert.equal(new URL(response.headers.get("Location")).search, "?tiktok=failed");
      assert.equal(logs.length, 1);
      assert.equal(logs[0].length, 1);
      const diagnostic = JSON.parse(logs[0][0]);
      assert.equal(diagnostic.event, "rel_tiktok_callback_failed");
      assert.equal(diagnostic.stage, scenario);
      if (scenario === "token_exchange") assert.equal(diagnostic.provider_code, "invalid_client");
      if (scenario === "token_response") assert.equal(diagnostic.reason, "missing_permissions");
      if (["claim", "proof_storage"].includes(scenario)) assert.equal(diagnostic.service_status, 503);
      for (const secret of [state, "fixture-tiktok-code-private", "private-description", "private-database-description", "act.fixture-token", "fixture-client-secret", "fixture-open-id"])
        assert.equal(JSON.stringify(logs).includes(secret), false);
      assert.equal((await service.db.query("select count(*)::int n from rel_private.tiktok_connections")).rows[0].n, 0);
    } finally { console.error = originalError; await service.close(); }
  }
});

test("successful TikTok authorisation and intentional cancellation emit no failure diagnostics", async () => {
  for (const cancel of [false, true]) {
    const service = await mockService({tiktok: true}), logs = [], originalError = console.error;
    try {
      const start = await service.handle(new Request("https://rel.example.test/api/account/tiktok/start", {
        method: "POST", headers: {origin: "https://rel.example.test", cookie: "__Host-rel_access=member", "Content-Type": "application/json"}, body: "{}",
      }));
      const state = new URL((await start.json()).url).searchParams.get("state");
      console.error = (...args) => logs.push(args);
      const response = await service.handle(new Request("https://rel.example.test/api/account/tiktok/callback?state=" + state + (cancel ? "&error=access_denied" : "&code=fixture-tiktok-code-success"), {
        headers: {cookie: "__Host-rel_tiktok_state=" + state},
      }));
      assert.equal(new URL(response.headers.get("Location")).search, cancel ? "?tiktok=cancelled" : "?tiktok=ready");
      assert.deepEqual(logs, []);
    } finally { console.error = originalError; await service.close(); }
  }
});
