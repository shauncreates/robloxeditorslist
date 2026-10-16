// Real browser/cookie checks against fictional REL accounts and a local provider stand-in.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";

const base = "http://127.0.0.1:" + Number(process.env.REL_PREVIEW_PORT || 8789);
const version = await (
  await fetch("http://127.0.0.1:9223/json/version")
).json();
const socket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve);
  socket.addEventListener("error", reject);
});
const pending = new Map(),
  errors = [],
  contexts = [];
let nextId = 0;
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
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
}
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.method === "Runtime.exceptionThrown")
    errors.push(message.params.exceptionDetails.text);
  if (message.method === "Page.javascriptDialogOpening")
    void send(
      "Page.handleJavaScriptDialog",
      { accept: true },
      message.sessionId,
    );
  if (message.method === "Fetch.requestPaused") {
    const requested = new URL(message.params.request.url);
    const callback = new URL(requested.searchParams.get("redirect_uri"));
    assert.equal(callback.origin, base);
    callback.search = new URLSearchParams({
      state: requested.searchParams.get("state"),
      code: "fixture-tiktok-code-" + randomUUID(),
    });
    const decline = new URL(callback);
    decline.searchParams.delete("code");
    decline.searchParams.set("error", "access_denied");
    const body = `<!doctype html><html><head><meta charset="utf-8"><title>Local TikTok authorisation fixture</title></head><body style="font:18px/1.5 sans-serif;padding:40px"><h1>Local TikTok test screen</h1><p>No real TikTok account is involved. This page tests browser redirects and cookies only.</p><p><a id="authorise" href="${esc(callback.href)}">Authorise fixture account</a></p><p><a id="decline" href="${esc(decline.href)}">Decline</a></p></body></html>`;
    void send(
      "Fetch.fulfillRequest",
      {
        requestId: message.params.requestId,
        responseCode: 200,
        responseHeaders: [
          { name: "Content-Type", value: "text/html; charset=utf-8" },
        ],
        body: Buffer.from(body).toString("base64"),
      },
      message.sessionId,
    );
  }
  if (!message.id) return;
  const callback = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) callback.reject(new Error(message.error.message));
  else callback.resolve(message.result);
});
async function evaluate(page, expression) {
  const result = await send(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true },
    page.sessionId,
  );
  if (result.exceptionDetails)
    throw new Error(
      result.exceptionDetails.exception?.description ||
        result.exceptionDetails.text,
    );
  return result.result.value;
}
async function wait(page, expression) {
  for (let n = 0; n < 200; n++) {
    if (await evaluate(page, expression)) return;
    await delay(100);
  }
  throw new Error("Timed out: " + expression);
}
async function page({ error = false } = {}) {
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
  await send("Runtime.enable", {}, sessionId);
  await send("Page.enable", {}, sessionId);
  await send(
    "Fetch.enable",
    {
      patterns: [{ urlPattern: "https://www.tiktok.com/v2/auth/authorize/*" }],
    },
    sessionId,
  );
  if (process.env.REL_BROWSER_FONT_DIR) {
    const data = (
      await readFile(
        process.env.REL_BROWSER_FONT_DIR +
          "/red-hat-text-latin-wght-normal.woff2",
      )
    ).toString("base64");
    await send(
      "Page.addScriptToEvaluateOnNewDocument",
      {
        source: `{const font=new FontFace('Red Hat Text','url(data:font/woff2;base64,${data})',{weight:'300 700'});document.fonts.add(font);void font.load()}`,
      },
      sessionId,
    );
  }
  if (process.env.REL_BROWSER_SYMBOL_FONT) {
    const data = (await readFile(process.env.REL_BROWSER_SYMBOL_FONT)).toString(
      "base64",
    );
    await send(
      "Page.addScriptToEvaluateOnNewDocument",
      {
        source: `{const font=new FontFace('Material Symbols Rounded','url(data:font/woff2;base64,${data})',{weight:'100 700'});document.fonts.add(font);void font.load()}`,
      },
      sessionId,
    );
  }
  await send(
    "Page.addScriptToEvaluateOnNewDocument",
    {
      source: `{window.fixtureTiktokError=${error};const original=window.fetch;window.fetch=async(...args)=>{if(args[0]==='/api/account/tiktok'&&window.fixtureTiktokError&&(!args[1]?.method||args[1].method==='GET'))return new Response(JSON.stringify({error:'Fixture TikTok storage unavailable.'}),{status:503});return original(...args)}}`,
    },
    sessionId,
  );
  return { sessionId };
}
async function navigate(page, path) {
  await send("Page.navigate", { url: base + path }, page.sessionId);
  await wait(
    page,
    `document.readyState==='complete'&&location.pathname+location.search===${JSON.stringify(path)}`,
  );
}
const click = (page, selector) =>
  evaluate(page, `document.querySelector(${JSON.stringify(selector)}).click()`);
const fill = (page, selector, value) =>
  evaluate(
    page,
    `(()=>{const input=document.querySelector(${JSON.stringify(selector)});input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}))})()`,
  );
async function login(page, name = "member") {
  await navigate(page, "/signin/");
  await fill(page, "#email", name + "@example.test");
  await fill(page, "#password", "test-password-123");
  await click(page, "#submit");
  await wait(
    page,
    "location.pathname==='/account/'&&document.querySelector('#tiktokConnection')?.getAttribute('aria-busy')==='false'",
  );
}
async function authorise(page, grant = true) {
  await click(page, "#connectTikTok");
  await wait(
    page,
    "location.hostname==='www.tiktok.com'&&document.querySelector('#authorise')",
  );
  await click(page, grant ? "#authorise" : "#decline");
  await wait(
    page,
    "location.pathname==='/account/'&&document.querySelector('#tiktokConnection')?.getAttribute('aria-busy')==='false'",
  );
}
async function layout(page, name, { scroll = true } = {}) {
  for (const width of [1440, 768, 390, 320]) {
    await send(
      "Emulation.setDeviceMetricsOverride",
      { width, height: 1000, deviceScaleFactor: 1, mobile: width < 500 },
      page.sessionId,
    );
    await delay(500);
    const state = await evaluate(
      page,
      "document.fonts.ready.then(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,controls:[...document.querySelectorAll('#tiktokConnection button')].map(b=>({height:b.getBoundingClientRect().height,label:b.textContent}))}))",
    );
    assert.ok(state.scroll <= state.width, name + " overflow at " + width);
    assert.ok(
      state.controls.every((button) => button.height >= 44),
      name + " small controls",
    );
    if (width === 1440 || width === 390) {
      if (scroll)
        await evaluate(
          page,
          "document.querySelector('#tiktokConnection').scrollIntoView({block:'start'})",
        );
      else await evaluate(page, "scrollTo(0,0)");
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
  console.log("PASS " + name + ": 320/390/768/1440px");
}

await mkdir(new URL("../.wrangler/ui-review/", import.meta.url), {
  recursive: true,
});
try {
  const member = await page();
  await login(member);
  assert.ok(
    await evaluate(member, "document.querySelector('#connectTikTok')!==null"),
  );
  const before = await evaluate(
    member,
    "fetch('/api/account/site').then(r=>r.json())",
  );
  await layout(member, "tiktok-empty");
  await authorise(member);
  await wait(member, "document.querySelector('#confirmTikTok')");
  assert.equal(
    await evaluate(
      member,
      "document.querySelector('#disconnectTikTok')!==null",
    ),
    false,
  );
  assert.equal(
    await evaluate(member, "document.cookie.includes('rel_tiktok')"),
    false,
  );
  await layout(member, "tiktok-confirmation");
  await evaluate(
    member,
    "document.querySelector('#confirmTikTok button').focus()",
  );
  assert.notEqual(
    await evaluate(
      member,
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
      member.sessionId,
    );
  await wait(member, "document.querySelector('#disconnectTikTok')");
  await layout(member, "tiktok-connected");
  const status = await evaluate(
    member,
    "fetch('/api/account/tiktok').then(r=>r.json())",
  );
  assert.equal(status.connection.username, "fixture_editor");
  assert.ok(!JSON.stringify(status).includes("fixture-open-id"));
  const publicPage = await page();
  await navigate(publicPage, "/profile/?editor=editor1");
  await wait(publicPage, "document.querySelector('h1').textContent==='member'");
  assert.equal(
    await evaluate(
      publicPage,
      "document.body.textContent.includes('Connected TikTok')",
    ),
    true,
  );
  const publicData = await evaluate(
    publicPage,
    "fetch('/api/profiles?editor=editor1').then(r=>r.json())",
  );
  assert.equal(publicData.tiktok.username, "fixture_editor");
  assert.equal(publicData.tiktok.open_id, undefined);
  await layout(publicPage, "tiktok-public-profile", { scroll: false });
  await authorise(member);
  await wait(member, "document.querySelector('#cancelTikTok')");
  await click(member, "#cancelTikTok");
  await wait(
    member,
    "!document.querySelector('#confirmTikTok')&&document.querySelector('#disconnectTikTok')",
  );
  assert.equal(
    (await evaluate(member, "fetch('/api/account/tiktok').then(r=>r.json())"))
      .connection.username,
    "fixture_editor",
  );
  await click(member, "#disconnectTikTok");
  await wait(
    member,
    "document.querySelector('#connectTikTok')&&!document.querySelector('#disconnectTikTok')",
  );
  await navigate(publicPage, "/profile/?editor=editor1");
  await wait(publicPage, "document.querySelector('h1').textContent==='member'");
  assert.equal(
    await evaluate(
      publicPage,
      "document.body.textContent.includes('Connected TikTok')",
    ),
    false,
  );
  await authorise(member, false);
  assert.equal(
    await evaluate(
      member,
      "document.querySelector('#tiktokNotice').textContent.includes('cancelled')",
    ),
    true,
  );
  await layout(member, "tiktok-cancelled");
  const errorPage = await page({ error: true });
  await login(errorPage, "stranger");
  await wait(errorPage, "document.querySelector('#retryTikTok')");
  await layout(errorPage, "tiktok-error");
  await evaluate(errorPage, "window.fixtureTiktokError=false");
  await click(errorPage, "#retryTikTok");
  await wait(errorPage, "document.querySelector('#connectTikTok')");
  await navigate(publicPage, "/tiktok-privacy/");
  await layout(publicPage, "tiktok-privacy", { scroll: false });
  const after = await evaluate(
    member,
    "fetch('/api/account/site').then(r=>r.json())",
  );
  assert.deepEqual(after, before);
  assert.deepEqual(errors, []);
  assert.equal(
    await evaluate(
      member,
      "Object.keys(localStorage).some(k=>/tiktok|token/i.test(k))",
    ),
    false,
  );
  console.log(
    "PASS TikTok browser authorisation, HttpOnly cookies, keyboard confirmation, public proof, reconnect/cancel, disconnect, provider denial, error retry and unchanged rankings. No real TikTok account was used.",
  );
} finally {
  for (const browserContextId of contexts)
    await send("Target.disposeBrowserContext", { browserContextId });
  socket.close();
}
