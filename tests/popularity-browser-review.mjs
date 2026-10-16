// Fictional accounts and provider screens only; all REL requests stay on the local fixture.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";

const base = "http://127.0.0.1:" + Number(process.env.REL_PREVIEW_PORT || 8789);
const version = await (
  await fetch("http://127.0.0.1:9223/json/version")
).json();
const socket = new WebSocket(version.webSocketDebuggerUrl),
  pending = new Map(),
  errors = [],
  contexts = [];
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve);
  socket.addEventListener("error", reject);
});
let nextId = 0;
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
    const url = new URL(message.params.request.url),
      callback = new URL(url.searchParams.get("redirect_uri"));
    assert.equal(callback.origin, base);
    callback.search = new URLSearchParams({
      state: url.searchParams.get("state"),
      code:
        url.hostname === "accounts.google.com"
          ? "fixture-youtube-code"
          : "fixture-tiktok-code-" + randomUUID(),
    });
    const html = `<!doctype html><html><body><h1>Local authorisation fixture</h1><p>No real provider account is involved.</p><a id="authoriseFixture" href="${callback.href.replaceAll("&", "&amp;")}">Authorise fixture channel</a></body></html>`;
    void send(
      "Fetch.fulfillRequest",
      {
        requestId: message.params.requestId,
        responseCode: 200,
        responseHeaders: [
          { name: "Content-Type", value: "text/html; charset=utf-8" },
        ],
        body: Buffer.from(html).toString("base64"),
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
  for (let i = 0; i < 200; i++) {
    if (await evaluate(page, expression)) return;
    await delay(100);
  }
  throw new Error("Timed out: " + expression + " " + JSON.stringify(await evaluate(page,"({path:location.pathname,message:document.querySelector('#message')?.textContent,youtube:document.querySelector('#youtubeConnection')?.outerHTML,errors:window.fixtureErrors})")) + " " + JSON.stringify(errors));
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
        { urlPattern: "https://www.tiktok.com/v2/auth/authorize/*" },
        { urlPattern: "https://accounts.google.com/o/oauth2/v2/auth*" },
      ],
    },
    sessionId,
  );
  for (const [family, path] of [
    [
      "Red Hat Text",
      process.env.REL_BROWSER_FONT_DIR &&
        process.env.REL_BROWSER_FONT_DIR +
          "/red-hat-text-latin-wght-normal.woff2",
    ],
    ["Material Symbols Rounded", process.env.REL_BROWSER_SYMBOL_FONT],
  ]) {
    if (!path) continue;
    const data = (await readFile(path)).toString("base64");
    await send(
      "Page.addScriptToEvaluateOnNewDocument",
      {
        source: `{const font=new FontFace('${family}','url(data:font/woff2;base64,${data})',{weight:'100 700'});document.fonts.add(font);void font.load()}`,
      },
      sessionId,
    );
  }
  await send(
    "Page.addScriptToEvaluateOnNewDocument",
    {
      source: `{window.popFixtureMode='normal';window.youtubeFixtureError=false;const real=window.fetch;window.fetch=async(...args)=>{
    if(String(args[0]).startsWith('/api/popularity')){
      if(window.popFixtureMode==='error')return new Response(JSON.stringify({error:'Fixture popularity unavailable.'}),{status:503});
      if(window.popFixtureMode==='empty')return new Response(JSON.stringify({editors:[]}));
      if(window.popFixtureMode==='loading')await new Promise(resolve=>{window.releasePopularity=resolve});
    }
    if(args[0]==='/api/account/youtube'&&window.youtubeFixtureError&&(!args[1]?.method||args[1].method==='GET'))return new Response(JSON.stringify({error:'Fixture YouTube unavailable.'}),{status:503});
    return real(...args);
  }}`,
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
    `{const input=document.querySelector(${JSON.stringify(selector)});input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}))}`,
  );
async function key(page, key, code, value) {
  for (const type of ["keyDown", "keyUp"])
    await send(
      "Input.dispatchKeyEvent",
      {
        type,
        key,
        code,
        windowsVirtualKeyCode: value,
        ...(type === "keyDown" && key === "Enter" ? { text: "\r" } : {}),
      },
      page.sessionId,
    );
}
async function settled(page) {
  await wait(
    page,
    "document.querySelector('#popularityResults')?.getAttribute('aria-busy')==='false'",
  );
}
async function layout(page, name, selector = "body") {
  for (const width of [1440, 768, 390, 320]) {
    await send(
      "Emulation.setDeviceMetricsOverride",
      { width, height: 1000, deviceScaleFactor: 1, mobile: width < 500 },
      page.sessionId,
    );
    await evaluate(page, "document.fonts.ready");
    await delay(150);
    const state = await evaluate(
      page,
      `({width:innerWidth,scroll:document.documentElement.scrollWidth,loaded:[...document.fonts].some(f=>f.family.includes('Red Hat Text')&&f.status==='loaded'),controls:[...document.querySelectorAll('.pop-platforms a,.pop-name,.pop-channel,#youtubeConnection button')].filter(e=>e.getClientRects().length).map(e=>e.getBoundingClientRect().height)})`,
    );
    assert.ok(state.scroll <= state.width, name + " overflow at " + width);
    assert.equal(state.loaded, true);
    assert.ok(
      state.controls.every((height) => height >= 44),
      name + " small targets",
    );
    if (width === 1440 || width === 390) {
      await evaluate(
        page,
        `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'start'})`,
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
  console.log(
    "PASS " + name + ": 320/390/768/1440px, local Red Hat Text, 44px targets",
  );
}
async function authorise(page, platform) {
  await click(
    page,
    platform === "tiktok" ? "#connectTikTok" : "#connectYouTube",
  );
  await wait(page, "document.querySelector('#authoriseFixture')");
  await click(page, "#authoriseFixture");
  await wait(
    page,
    `location.pathname==='/account/'&&document.querySelector('#${platform === "tiktok" ? "tiktok" : "youtube"}Connection')?.getAttribute('aria-busy')==='false'`,
  );
}

await mkdir(new URL("../.wrangler/ui-review/", import.meta.url), {
  recursive: true,
});
try {
  const member = await page();
  await navigate(member, "/popularity/");
  await settled(member);
  assert.match(
    await evaluate(
      member,
      "document.querySelector('#popularityResults').textContent",
    ),
    /No follower counts yet/,
  );
  await layout(member, "popularity-empty");
  await evaluate(
    member,
    "document.querySelector('[data-platform=youtube]').focus()",
  );
  await key(member, "Enter", "Enter", 13);
  await settled(member);
  assert.equal(
    await evaluate(
      member,
      "new URLSearchParams(location.search).get('platform')",
    ),
    "youtube",
  );
  assert.equal(
    await evaluate(
      member,
      "document.querySelector('[data-platform=youtube]').getAttribute('aria-current')",
    ),
    "page",
  );
  assert.notEqual(
    await evaluate(
      member,
      "getComputedStyle(document.activeElement).outlineStyle",
    ),
    "none",
  );
  await evaluate(member, "history.back()");
  await wait(member, "location.search===''");
  await settled(member);
  await evaluate(member, "window.popFixtureMode='loading'");
  await click(member, "[data-platform=youtube]");
  await wait(
    member,
    "document.querySelector('#popularityResults').getAttribute('aria-busy')==='true'",
  );
  assert.match(
    await evaluate(
      member,
      "document.querySelector('#popularityResults').textContent",
    ),
    /Loading/,
  );
  await evaluate(
    member,
    "window.popFixtureMode='normal';window.releasePopularity()",
  );
  await settled(member);
  await evaluate(member, "window.popFixtureMode='error'");
  await click(member, "[data-platform=tiktok]");
  await settled(member);
  assert.match(
    await evaluate(
      member,
      "document.querySelector('[role=status]').textContent",
    ),
    /unavailable/,
  );
  await layout(member, "popularity-error");
  await evaluate(member, "window.popFixtureMode='normal'");
  await click(member, "#retryPopularity");
  await settled(member);
  await click(member, ".pop-empty a");
  await wait(member, "location.pathname==='/signin/'&&document.readyState==='complete'");
  await fill(member, "#email", "member@example.test");
  await fill(member, "#password", "test-password-123");
  await click(member, "#submit");
  await wait(
    member,
    "location.pathname==='/account/'&&document.querySelector('#youtubeConnection')?.getAttribute('aria-busy')==='false'",
  );
  await authorise(member, "tiktok");
  assert.match(
    await evaluate(
      member,
      "document.querySelector('#confirmTikTok').textContent",
    ),
    /42,000.*publishes/s,
  );
  await click(member, "#confirmTikTok button[type=submit]");
  await wait(member, "document.querySelector('#disconnectTikTok')");
  await authorise(member, "youtube");
  assert.match(
    await evaluate(
      member,
      "document.querySelector('#pendingSubscriberCount').textContent",
    ),
    /12,500.*rounded.*publishes/s,
  );
  await layout(member, "youtube-popularity-confirmation", "#youtubeConnection");
  await evaluate(
    member,
    "document.querySelector('#confirmYouTube button[type=submit]').focus()",
  );
  await key(member, "Enter", "Enter", 13);
  await wait(
    member,
    "document.querySelector('#disconnectYouTube')&&!document.querySelector('#confirmYouTube')",
  );
  assert.equal(
    await evaluate(member, "document.cookie.includes('rel_youtube')"),
    false,
  );
  await layout(member, "youtube-popularity-connected", "#youtubeConnection");
  await navigate(member, "/popularity/");
  await settled(member);
  assert.equal(
    await evaluate(member, "document.querySelectorAll('.pop-row').length"),
    1,
  );
  assert.equal(
    await evaluate(member, "document.querySelector('.pop-count').textContent"),
    "42,000",
  );
  assert.equal(
    await evaluate(
      member,
      "document.querySelector('.pop-channel').getAttribute('href')",
    ),
    "https://www.tiktok.com/@fixture_editor",
  );
  await layout(member, "popularity-tiktok");
  await click(member, "[data-platform=youtube]");
  await settled(member);
  assert.equal(
    await evaluate(member, "document.querySelector('.pop-count').textContent"),
    "12,500",
  );
  assert.match(
    await evaluate(member, "document.querySelector('.pop-date').textContent"),
    /Last updated/,
  );
  await layout(member, "popularity-youtube");
  await send(
    "Emulation.setEmulatedMedia",
    { features: [{ name: "prefers-reduced-motion", value: "reduce" }] },
    member.sessionId,
  );
  await send(
    "Emulation.setDeviceMetricsOverride",
    { width: 640, height: 900, deviceScaleFactor: 1, mobile: false },
    member.sessionId,
  );
  await evaluate(member, "document.documentElement.style.fontSize='200%'");
  assert.equal(
    await evaluate(member, "document.documentElement.scrollWidth<=innerWidth"),
    true,
    "200% text overflow",
  );
  await evaluate(member, "document.documentElement.style.fontSize='' ");
  await click(member, ".pop-name");
  await wait(
    member,
    "document.querySelector('#profileMain h1')||document.querySelector('.profile-identity h1')",
  );
  assert.match(
    await evaluate(member, "document.body.textContent"),
    /Connected YouTube/,
  );
  await navigate(member, "/popularity/");
  await settled(member);
  for (const path of ["/tiktok-privacy/", "/youtube-privacy/"]) {
    await click(member, `a[href="${path}"]`);
    await wait(member, `location.pathname===${JSON.stringify(path)}`);
    await layout(
      member,
      path.includes("youtube")
        ? "youtube-privacy-popularity"
        : "tiktok-privacy-popularity",
    );
    await navigate(member, "/popularity/");
    await settled(member);
  }
  await click(member, "a[href='/list/']");
  await wait(
    member,
    "location.pathname==='/list/'&&document.querySelector('a[href=\"/popularity/\"]')",
  );
  await click(member, "a[href='/popularity/']");
  await settled(member);
  await click(member, ".pop-explainer a");
  await wait(member, "document.querySelector('#connectYouTube')");
  await authorise(member, "youtube");
  await click(member, "#cancelYouTube");
  await wait(
    member,
    "!document.querySelector('#disconnectYouTube')&&document.querySelector('#connectYouTube')",
  );
  await navigate(member, "/popularity/?platform=youtube");
  await settled(member);
  assert.equal(
    await evaluate(member, "document.querySelectorAll('.pop-row').length"),
    0,
  );
  await navigate(member, "/account/");
  await wait(member, "document.querySelector('#connectYouTube')");
  await authorise(member, "youtube");
  await click(member, "#confirmYouTube button[type=submit]");
  await wait(
    member,
    "document.querySelector('#disconnectYouTube')&&!document.querySelector('#confirmYouTube')",
  );
  await click(member, "#disconnectYouTube");
  await wait(member, "!document.querySelector('#disconnectYouTube')");
  await send(
    "Page.addScriptToEvaluateOnNewDocument",
    { source: "window.youtubeFixtureError=true" },
    member.sessionId,
  );
  await navigate(member, "/account/");
  await wait(member, "document.querySelector('#retryYouTube')");
  await evaluate(member, "window.youtubeFixtureError=false");
  await click(member, "#retryYouTube");
  await wait(member, "document.querySelector('#connectYouTube')");
  await navigate(member, "/");
  await click(member, "a[href='/popularity/']");
  await settled(member);
  assert.deepEqual(errors, []);
  console.log(
    "PASS real local OAuth callbacks/cookies, count publication consent, keyboard confirmation, public profiles, navigation, platform history, loading/error/retry, disconnect/removal, privacy pages, reduced motion and 200% text.",
  );
} finally {
  for (const browserContextId of contexts)
    await send("Target.disposeBrowserContext", { browserContextId });
  socket.close();
}
