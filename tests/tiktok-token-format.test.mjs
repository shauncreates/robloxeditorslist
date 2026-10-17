import { test } from "node:test";
import assert from "node:assert/strict";
import { proveAccount } from "../functions/_tiktok.js";

test("TikTok tokens remain opaque while whitespace, control characters and unbounded values are rejected", async () => {
  const originalFetch = globalThis.fetch;
  const config = {clientKey: "fixture", clientSecret: "fixture", callback: "https://rel.example.test/api/account/tiktok/callback"};
  try {
    for (const accessToken of ["act.fixture!*%:=", "act.fixture+slash/with=padding", "act.fixture", undefined, null, 42, "", "a".repeat(4097), "token\r\nInjected: value", "token\n", "token\r", "token\t", "token value", " token", "token ", "token\0", "token\x7f", "token\u00e9"]) {
      const calls = [];
      globalThis.fetch = async (input, options) => {
        const path = new URL(input).pathname;
        calls.push(path);
        if (path === "/v2/oauth/token/") return Response.json({
          access_token: accessToken, token_type: "Bearer", scope: "user.info.basic,user.info.profile", open_id: "fixture-id",
        });
        if (path === "/v2/user/info/") {
          assert.equal(new Headers(options.headers).get("Authorization"), "Bearer " + accessToken);
          return Response.json({data: {user: {open_id: "fixture-id", username: "fixture", display_name: "Fixture"}}, error: {code: "ok"}});
        }
        assert.equal(path, "/v2/oauth/revoke/");
        assert.equal(new URLSearchParams(options.body).get("token"), accessToken);
        return new Response(null, {status: 204});
      };
      if (typeof accessToken === "string" && accessToken.startsWith("act.")) {
        assert.deepEqual(await proveAccount(config, "fixture-code"), {
          open_id: "fixture-id", username: "fixture", display_name: "Fixture", followers: null,
        });
        assert.deepEqual(calls, ["/v2/oauth/token/", "/v2/user/info/", "/v2/oauth/revoke/"]);
      } else {
        await assert.rejects(proveAccount(config, "fixture-code"), error => {
          assert.equal(error.callbackStage, "token_response");
          assert.equal(error.callbackReason, "invalid_token_response");
          return true;
        });
        assert.deepEqual(calls, ["/v2/oauth/token/"]);
      }
    }
  } finally { globalThis.fetch = originalFetch; }
});
