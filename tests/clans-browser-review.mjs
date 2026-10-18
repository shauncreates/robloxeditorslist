// Uses fictional accounts in the isolated fixture. Run after the popularity browser review.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const base = "http://127.0.0.1:" + Number(process.env.REL_PREVIEW_PORT || 8789);
const version = await (
    await fetch("http://127.0.0.1:9223/json/version")
  ).json(),
  socket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve);
  socket.addEventListener("error", reject);
});
let nextId = 0;
const pending = new Map(),
  contexts = [],
  errors = [],
  requests = [];
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(
      JSON.stringify({
        id,
        method,
        params,
        ...(sessionId ? { sessionId } : {}),
      }),
    );
  });
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.method === "Runtime.exceptionThrown")
    errors.push(message.params.exceptionDetails.text);
  if (message.method === "Network.requestWillBeSent")
    requests.push(message.params.request.url);
  if (message.method === "Page.javascriptDialogOpening")
    void send(
      "Page.handleJavaScriptDialog",
      { accept: true },
      message.sessionId,
    );
  if (!message.id) return;
  const callback = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) callback.reject(new Error(message.error.message));
  else callback.resolve(message.result);
});
async function evaluate(page, expression) {
  const r = await send(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true },
    page.sessionId,
  );
  if (r.exceptionDetails)
    throw new Error(
      r.exceptionDetails.exception?.description || r.exceptionDetails.text,
    );
  return r.result.value;
}
async function wait(page, expression) {
  for (let n = 0; n < 200; n++) {
    if (await evaluate(page, expression)) return;
    await delay(100);
  }
  throw new Error("Timed out: " + expression);
}
async function page() {
  const { browserContextId } = await send("Target.createBrowserContext");
  contexts.push(browserContextId);
  const { targetId } = await send("Target.createTarget", {
    url: "about:blank",
    browserContextId,
  });
  const { sessionId } = await send("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  for (const command of ["Runtime.enable", "Page.enable", "Network.enable"])
    await send(command, {}, sessionId);
  if (process.env.REL_BROWSER_FONT_DIR) {
    const font = (
      await readFile(
        process.env.REL_BROWSER_FONT_DIR +
          "/red-hat-text-latin-wght-normal.woff2",
      )
    ).toString("base64");
    await send(
      "Page.addScriptToEvaluateOnNewDocument",
      {
        source: `{const font=new FontFace('Red Hat Text','url(data:font/woff2;base64,${font})',{weight:'300 700'});document.fonts.add(font);void font.load()}`,
      },
      sessionId,
    );
  }
  return { sessionId };
}
async function navigate(page, path) {
  await send("Page.navigate", { url: base + path }, page.sessionId);
  await wait(
    page,
    `document.readyState==='complete'&&location.pathname===${JSON.stringify(path.split(/[?#]/)[0])}`,
  );
}
const click = (page, selector) =>
  evaluate(page, `document.querySelector(${JSON.stringify(selector)}).click()`);
const fill = (page, selector, value) =>
  evaluate(
    page,
    `{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}))}`,
  );
const ready = (page) =>
  wait(
    page,
    "document.querySelector('#clanResults')?.getAttribute('aria-busy')==='false'",
  );
async function login(page, name) {
  await navigate(page, "/signin/");
  await fill(page, "#email", name + "@example.test");
  await fill(page, "#password", "test-password-123");
  await click(page, "#submit");
  await wait(page, "location.pathname==='/account/'");
  await navigate(page, "/clans/");
  await ready(page);
  await click(page, "[data-clan-view=manage]");
}
async function enter(page, selector) {
  await evaluate(
    page,
    `document.querySelector(${JSON.stringify(selector)}).focus()`,
  );
  assert.notEqual(
    await evaluate(
      page,
      "getComputedStyle(document.activeElement).outlineStyle",
    ),
    "none",
  );
  for (const type of ["keyDown", "keyUp"])
    await send(
      "Input.dispatchKeyEvent",
      {
        type,
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
        ...(type === "keyDown" ? { text: "\r" } : {}),
      },
      page.sessionId,
    );
}
async function layout(page, name) {
  for (const width of [1440, 768, 390, 320]) {
    await send(
      "Emulation.setDeviceMetricsOverride",
      { width, height: 1100, deviceScaleFactor: 1, mobile: width < 500 },
      page.sessionId,
    );
    await evaluate(page, "document.fonts.ready");
    await delay(100);
    assert.equal(
      await evaluate(page, "document.documentElement.scrollWidth<=innerWidth"),
      true,
      name + " overflow at " + width,
    );
    assert.equal(
      await evaluate(
        page,
        "[...document.fonts].some(f=>f.family.includes('Red Hat Text')&&f.status==='loaded')",
      ),
      true,
    );
    assert.equal(
      await evaluate(
        page,
        "[...document.querySelectorAll('#clanResults button,#clanResults input,#clanResults select')].filter(e=>e.getClientRects().length).every(e=>e.getBoundingClientRect().height>=44)",
      ),
      true,
      name + " small target",
    );
    if (width === 1440 || width === 390) {
      await evaluate(page, "scrollTo(0,0)");
      const shot = await send(
        "Page.captureScreenshot",
        { format: "png", captureBeyondViewport: false },
        page.sessionId,
      );
      await writeFile(
        new URL(`../.wrangler/ui-review/${name}-${width}.png`, import.meta.url),
        Buffer.from(shot.data, "base64"),
      );
    }
  }
  console.log("PASS " + name + ": 320/390/768/1440px and 44px controls");
}
const members = async (id) =>
  (await (await fetch(base + "/api/clans?id=" + id)).json()).clans[0].members;
await mkdir(new URL("../.wrangler/ui-review/", import.meta.url), {
  recursive: true,
});
try {
  const creator = await page(),
    guest = await page();
  await navigate(guest, "/clans/");
  await ready(guest);
  assert.match(
    await evaluate(guest, "document.body.textContent"),
    /No clans yet/,
  );
  await layout(guest, "clans-empty");
  await login(creator, "member");
  await layout(creator, "clan-create");
  await fill(creator, "#clanName", "Motion Studio");
  await fill(creator, "#clanPrefix", "abc");
  assert.equal(
    await evaluate(
      creator,
      "document.querySelector('#clanPrefix').checkValidity()",
    ),
    false,
  );
  await fill(creator, "#clanPrefix", "edit");
  assert.equal(
    await evaluate(
      creator,
      "document.querySelector('#prefixPreview').textContent",
    ),
    "[EDIT]",
  );
  await enter(creator, "#createClan button");
  await wait(creator, "document.querySelector('#myClan')");
  await ready(creator);
  const id = await evaluate(
    creator,
    "new URLSearchParams(location.search).get('id')",
  );
  assert.ok(id);
  assert.match(
    await evaluate(
      creator,
      "document.querySelector('#clanRankings').textContent",
    ),
    /#1.*One/s,
  );
  await layout(creator, "clan-created");
  await click(creator, "[data-action=invite]");
  await wait(creator, "document.querySelector('#clanInviteUrl')");
  const inviteUrl = await evaluate(
      creator,
      "document.querySelector('#clanInviteUrl').value",
    ),
    invitePath = inviteUrl.slice(base.length),
    token = new URL(inviteUrl).hash.slice(8);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal((await members(id)).length, 1);
  await click(creator, "[data-action=copy]");
  await wait(
    creator,
    "document.querySelector('#clanNotice').textContent.includes('copied')||document.querySelector('#clanNotice').textContent.includes('copy the invitation')",
  );
  await navigate(guest, invitePath);
  await ready(guest);
  assert.equal((await members(id)).length, 1);
  await layout(guest, "clan-invitation-guest");
  await click(guest, "[data-action=cancel]");
  await ready(guest);
  assert.equal((await members(id)).length, 1);
  await navigate(guest, invitePath);
  await ready(guest);
  await click(guest, ".clan-invitation a");
  await wait(
    guest,
    "location.pathname==='/signin/'&&document.querySelector('#authForm')",
  );
  await fill(guest, "#email", "stranger@example.test");
  await fill(guest, "#password", "test-password-123");
  await click(guest, "#submit");
  await wait(
    guest,
    "location.pathname==='/clans/'&&document.querySelector('[data-action=join]')",
  );
  await ready(guest);
  assert.equal((await members(id)).length, 1, "sign-in must not autojoin");
  await layout(guest, "clan-invitation-confirm");
  await enter(guest, "[data-action=join]");
  await wait(guest, "document.querySelector('[data-action=leave]')");
  await ready(guest);
  assert.equal((await members(id)).length, 2);
  await click(guest, "[data-clan-view=manage]");
  await layout(guest, "clan-member");
  await navigate(creator, "/clans/?id=" + id);
  await ready(creator);
  await layout(creator, "clan-members");
  await click(creator, "#clanRankingStyle");
  await evaluate(
    creator,
    "{const s=document.querySelector('#clanRankingStyle');s.value='style';s.dispatchEvent(new Event('change',{bubbles:true}))}",
  );
  assert.match(
    await evaluate(
      creator,
      "document.querySelector('#clanRankings').textContent",
    ),
    /#1.*One/s,
  );
  await click(creator, "[data-clan-view=manage]");
  await fill(creator, "#clanPrefix", "VFX1");
  await enter(creator, "#updateClan button");
  await wait(
    creator,
    "document.querySelector('#clanNotice').textContent.includes('Clan saved')",
  );
  await ready(creator);
  await navigate(
    guest,
    "/profile/?account=00000000-0000-4000-8000-000000000005",
  );
  await wait(
    guest,
    "document.querySelector('#publicProfile h1 .rel-clan-prefix')",
  );
  assert.match(
    await evaluate(guest, "document.querySelector('h1').textContent"),
    /\[VFX1\].*stranger/,
  );
  await click(guest, ".rel-clan-prefix");
  await ready(guest);
  await navigate(creator, "/list/");
  await wait(creator, "document.querySelector('.rel-clan-prefix')");
  assert.match(
    await evaluate(
      creator,
      "document.querySelector('.rel-clan-prefix').textContent",
    ),
    /VFX1/,
  );
  await layout(creator, "clan-ranked-prefix");
  await navigate(creator, "/popularity/");
  await wait(creator, "document.querySelector('.pop-row .rel-clan-prefix')");
  assert.equal(
    await evaluate(creator, "document.querySelector('.pop-count').textContent"),
    "42,000",
  );
  await layout(creator, "clan-popularity-prefix");
  await navigate(creator, "/clans/?id=" + id);
  await ready(creator);
  await click(creator, "[data-clan-view=members]");
  await click(creator, "[data-action=remove]");
  await wait(
    creator,
    "document.querySelector('#clanNotice').textContent==='Member removed.'",
  );
  await ready(creator);
  assert.equal((await members(id)).length, 1);
  await navigate(guest, invitePath);
  await ready(guest);
  await click(guest, "[data-action=join]");
  await wait(guest, "document.querySelector('[data-action=leave]')");
  await click(guest, "[data-clan-view=manage]");
  await click(guest, "[data-action=leave]");
  await wait(
    guest,
    "document.querySelector('#clanNotice').textContent.includes('You left')",
  );
  assert.equal((await members(id)).length, 1);
  await click(creator, "[data-clan-view=manage]");
  await click(creator, "[data-action=invite]");
  await wait(creator, "document.querySelector('#clanInviteUrl')");
  await navigate(guest, invitePath);
  await ready(guest);
  assert.match(
    await evaluate(guest, "document.querySelector('.clan-error').textContent"),
    /expired|revoked|unavailable/,
  );
  await layout(guest, "clan-invite-expired");
  await click(guest, "[data-action=cancel]");
  await ready(guest);
  await click(creator, "[data-action=revoke_invite]");
  await wait(
    creator,
    "document.querySelector('#clanNotice').textContent.includes('revoked')",
  );
  await ready(creator);
  await send(
    "Emulation.setEmulatedMedia",
    { features: [{ name: "prefers-reduced-motion", value: "reduce" }] },
    creator.sessionId,
  );
  await send(
    "Emulation.setDeviceMetricsOverride",
    { width: 640, height: 1000, deviceScaleFactor: 1, mobile: false },
    creator.sessionId,
  );
  await evaluate(creator, "document.documentElement.style.fontSize='200%'");
  assert.equal(
    await evaluate(creator, "document.documentElement.scrollWidth<=innerWidth"),
    true,
  );
  await evaluate(creator, "document.documentElement.style.fontSize=''");
  await click(creator, "[data-action=disband]");
  await wait(
    creator,
    "document.querySelector('#clanNotice').textContent.includes('disbanded')",
  );
  await ready(creator);
  assert.equal((await fetch(base + "/api/clans?id=" + id)).status, 404);
  assert.ok(
    requests
      .filter((url) => url.includes("/api/"))
      .every((url) => !url.includes(token)),
    "raw invite must not enter an API URL",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS create/preview, exact prefix validation, private fragment invites, cancel without joining, sign-in return and keyboard confirmation, clan positions in source order, profile/members/management views, prefix propagation, member removal/leave, invite replacement/revocation, disband, reduced motion and 200% text.",
  );
} finally {
  for (const browserContextId of contexts)
    await send("Target.disposeBrowserContext", { browserContextId });
  socket.close();
}
