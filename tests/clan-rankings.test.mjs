import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

test("clan positions are consecutive while preserving the source list order and saved rankings", async () => {
  const source = await readFile(new URL("../assets/clans.js", import.meta.url), "utf8");
  const render = source.slice(source.indexOf("function renderRankings("), source.indexOf("function renderClan("));
  const site = {
    editors: ["outside-a", "outside-b", "outside-c", "member-a", "member-b", "member-c"].map(id => ({id, name: id})),
    lists: {
      main: ["outside-a", "member-c", "outside-b", "outside-c", "member-a", "member-b"],
      style: ["outside-c", "member-b", "outside-a", "member-a"],
      empty: ["outside-a"],
    },
  };
  const current = {members: [
    {editor_id: "member-a"}, {editor_id: null}, {editor_id: "member-b"}, {editor_id: "member-c"},
  ]};
  const original = structuredClone({site, current});
  const target = {innerHTML: ""};
  const context = vm.createContext({site, current, root: {querySelector: () => target}, esc: String, tag: () => "[TEST]", icon: () => ""});
  vm.runInContext(render, context);
  for (const [call, expected] of [
    ["renderRankings()", [["member-c", 1], ["member-a", 2], ["member-b", 3]]],
    ["renderRankings('style')", [["member-b", 1], ["member-a", 2]]],
  ]) {
    vm.runInContext(call, context);
    const rows = [...target.innerHTML.matchAll(/href="\/profile\/\?editor=([^"]+)"[^>]*><span class="clan-(?:global-)?rank"[^>]*>#(\d+)/g)]
      .map(([, id, rank]) => [decodeURIComponent(id), Number(rank)]);
    assert.deepEqual(rows, expected, call);
    assert.deepEqual({site, current}, original);
  }
  vm.runInContext("renderRankings('empty')", context);
  assert.equal(target.innerHTML, "<p>No clan members are ranked on this list yet.</p>");
  assert.deepEqual({site, current}, original);
});
