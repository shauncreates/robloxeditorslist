// Uses fictional accounts and mocked provider pictures on the isolated preview only.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

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
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=";
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.method === "Runtime.exceptionThrown")
    errors.push(message.params.exceptionDetails.text);
  if (message.method === "Fetch.requestPaused") {
    void send(
      "Fetch.fulfillRequest",
      {
        requestId: message.params.requestId,
        responseCode: 200,
        responseHeaders: [{ name: "Content-Type", value: "image/png" }],
        body: png,
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
  await send("Runtime.enable", {}, sessionId);
  await send("Page.enable", {}, sessionId);
  await send(
    "Fetch.enable",
    {
      patterns: [
        { urlPattern: "https://rel.example.test/api/youtube-avatar*" },
      ],
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
      source: `{
    const original=window.fetch;
    window.fetch=async(...args)=>{
      if(args[0]==='/api/avatar'&&window.holdPicture)await new Promise(resolve=>{window.releasePicture=resolve});
      if(args[0]==='/api/avatar'&&window.failPicture)return new Response(JSON.stringify({error:'YouTube picture fetching is not configured yet. Paste a profile picture URL instead.'}),{status:503});
      const response=await original(...args);
      if(args[0]==='/api/avatar'&&response.ok){const data=await response.clone().json();
        if(data.url.includes('/api/youtube-avatar?')){data.url='https://rel.example.test'+new URL(data.url).pathname+new URL(data.url).search;return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}})}
      }
      return response;
    };
  }`,
    },
    sessionId,
  );
  return { sessionId };
}
async function navigate(page, path) {
  await send("Page.navigate", { url: base + path }, page.sessionId);
  await wait(
    page,
    `document.readyState==='complete' && location.pathname+location.search===${JSON.stringify(path)}`,
  );
}
const click = (page, selector) =>
  evaluate(page, `document.querySelector(${JSON.stringify(selector)}).click()`);
const fill = (page, selector, value) =>
  evaluate(
    page,
    `(()=>{const input=document.querySelector(${JSON.stringify(selector)});input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))})()`,
  );
async function login(page, name) {
  await navigate(page, "/signin/");
  await fill(page, "#email", name + "@example.test");
  await fill(page, "#password", "test-password-123");
  await click(page, "#submit");
  await wait(
    page,
    name === "owner"
      ? "location.pathname==='/admin/' && document.querySelector('details[data-idx]')"
      : "location.pathname==='/account/' && document.querySelector('#profile-main_platform')",
  );
}
const site = (page) =>
  evaluate(page, "fetch('/api/account/site').then(r=>r.json())");
async function saved(page) {
  await wait(
    page,
    "document.querySelector('#status').textContent.includes('saved')||document.querySelector('#status').textContent.includes('Saved')",
  );
}
async function layout(page, name) {
  for (const width of [1440, 768, 390, 320]) {
    await send(
      "Emulation.setDeviceMetricsOverride",
      { width, height: 1000, deviceScaleFactor: 1, mobile: width < 500 },
      page.sessionId,
    );
    await delay(700);
    const state = await evaluate(
      page,
      "document.fonts.ready.then(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}))",
    );
    assert.ok(state.scroll <= state.width, name + " overflow at " + width);
    if (width === 1440 || width === 390) {
      await evaluate(
        page,
        name === "editor-platform-account"
          ? "document.querySelector('#profile-main_platform').closest('.two').scrollIntoView({block:'start'})"
          : "scrollTo(0,0)",
      );
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
  const owner = await page();
  await login(owner, "owner");
  const before = await site(owner);
  await click(owner, "details[data-idx='0'] summary");
  await delay(300);
  await fill(
    owner,
    "#editor-youtube-0",
    "https://www.youtube.com/@fixture_editor",
  );
  await fill(owner, "input[data-i='0'][data-f='tiktok']", "fixture_editor");
  await fill(owner, "#editor-platform-0", "YouTube");
  assert.equal(
    await evaluate(
      owner,
      "document.querySelector('[data-act=fetchPic]').textContent",
    ),
    "Fetch from YouTube",
  );
  await click(owner, "#saveSite");
  await saved(owner);
  await click(owner, "[data-act='fetchPic'][data-i='0']");
  await wait(
    owner,
    "document.querySelector('#status').textContent.includes('Pictures fetched')||document.querySelector('#status').textContent.includes('Saved')",
  );
  await wait(
    owner,
    "document.querySelector('input[data-i=\"0\"][data-f=thumb]').value.startsWith('https://rel.example.test/api/youtube-avatar')",
  );
  await click(owner, "#saveSite");
  await saved(owner);
  await layout(owner, "editor-platform-admin");

  const publicPage = await page();
  await navigate(publicPage, "/list/");
  await wait(publicPage, "document.querySelector('[data-profile=editor1]')");
  const links = await evaluate(
    publicPage,
    "(()=>{const row=document.querySelector('[data-profile=editor1]').closest('.row');return [...row.querySelectorAll('a')].map(a=>({href:a.href,label:a.getAttribute('aria-label')}))})()",
  );
  assert.equal(links.length, 2);
  assert.ok(
    links.every(
      (link) => link.href === "https://www.youtube.com/@fixture_editor",
    ),
  );
  await evaluate(
    publicPage,
    "document.querySelector('[data-profile=editor1]').closest('.row').querySelector('.avatar-link').focus()",
  );
  assert.notEqual(
    await evaluate(
      publicPage,
      "getComputedStyle(document.activeElement).outlineStyle",
    ),
    "none",
  );
  await layout(publicPage, "editor-platform-ranking");
  await click(publicPage, "[data-profile=editor1]");
  await wait(publicPage, "document.querySelector('#drawer').open");
  assert.equal(
    await evaluate(
      publicPage,
      "document.querySelector('#drawer .ext a').textContent.startsWith('YouTube')",
    ),
    true,
  );
  assert.equal(
    await evaluate(
      publicPage,
      "document.querySelectorAll('#drawer .ext a').length",
    ),
    2,
  );
  await click(publicPage, "#drawer a[href='/profile/?editor=editor1']");
  await wait(publicPage, "document.querySelector('.profile-links')");
  assert.match(
    await evaluate(
      publicPage,
      "document.querySelector('.profile-links a').textContent",
    ),
    /YouTube · Main platform/,
  );

  const member = await page();
  await login(member, "member");
  assert.equal(
    await evaluate(
      member,
      "document.querySelector('#profile-main_platform').value",
    ),
    "YouTube",
  );
  await layout(member, "editor-platform-account");
  await fill(member, "#profile-main_platform", "TikTok");
  assert.equal(
    await evaluate(member, "document.querySelector('#fetchPic').textContent"),
    "Fetch picture from TikTok",
  );
  await click(member, "#fetchPic");
  await wait(
    member,
    "document.querySelector('#pictureNotice').textContent.includes('Picture fetched')",
  );
  await saved(member);
  assert.match((await site(member)).data.editors[0].thumb, /editor-avatars/);
  await fill(member, "#profile-main_platform", "YouTube");
  await saved(member);
  await evaluate(member, "window.failPicture=true");
  const previous = (await site(member)).data.editors[0].thumb;
  await click(member, "#fetchPic");
  await wait(
    member,
    "document.querySelector('#pictureNotice').textContent.includes('not configured')",
  );
  assert.equal((await site(member)).data.editors[0].thumb, previous);
  await evaluate(member, "window.failPicture=false;window.holdPicture=true");
  await click(member, "#fetchPic");
  await wait(member, "typeof window.releasePicture==='function'");
  await fill(member, "#profile-main_platform", "TikTok");
  await fill(
    member,
    "#profile-thumb",
    "https://example.test/newer-manual-picture.png",
  );
  await evaluate(member, "window.holdPicture=false;window.releasePicture()");
  await wait(
    member,
    "document.querySelector('#pictureNotice').textContent.includes('profile changed')",
  );
  await saved(member);
  assert.equal(
    (await site(member)).data.editors[0].thumb,
    "https://example.test/newer-manual-picture.png",
  );
  await navigate(publicPage, "/list/");
  await wait(publicPage, "document.querySelector('[data-profile=editor1]')");
  assert.equal(
    await evaluate(
      publicPage,
      "document.querySelector('[data-profile=editor1]').closest('.row').querySelector('a.who').href",
    ),
    "https://www.tiktok.com/@fixture_editor",
  );
  await evaluate(
    publicPage,
    "document.querySelector('[data-profile=editor1]').closest('.row').querySelector('.av img').dispatchEvent(new Event('error'))",
  );
  assert.equal(
    await evaluate(
      publicPage,
      "document.querySelector('[data-profile=editor1]').closest('.row').querySelector('.av img').hidden",
    ),
    true,
  );
  assert.deepEqual((await site(owner)).data.lists, before.data.lists);
  assert.deepEqual(errors, []);
  console.log(
    "PASS main links, both avatar providers, REL profile access, error preservation, stale-fetch protection, keyboard focus and unchanged rank order.",
  );
} finally {
  for (const browserContextId of contexts)
    await send("Target.disposeBrowserContext", { browserContextId });
  socket.close();
}
