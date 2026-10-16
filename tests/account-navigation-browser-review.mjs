// Browser-only regression using the local fixture, never a production account or database.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const base = "http://127.0.0.1:" + Number(process.env.REL_PREVIEW_PORT || 8789);
const version = await (
  await fetch("http://127.0.0.1:9223/json/version")
).json();
const socket = new WebSocket(version.webSocketDebuggerUrl),
  pending = new Map(),
  contexts = [],
  errors = [];
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve);
  socket.addEventListener("error", reject);
});
let nextId = 0;
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
  throw new Error(
    "Timed out: " +
      expression +
      " " +
      JSON.stringify(
        await evaluate(
          page,
          "({path:location.pathname,hidden:document.hidden,buttons:[...document.querySelectorAll('[data-account-nav]')].map(a=>({text:a.textContent,state:a.dataset.accountState}))})",
        ),
      ) +
      " " +
      JSON.stringify(errors),
  );
}
async function page(browserContextId) {
  if (!browserContextId) {
    ({ browserContextId } = await send("Target.createBrowserContext"));
    contexts.push(browserContextId);
  }
  const { targetId } = await send("Target.createTarget", {
      url: "about:blank",
      browserContextId,
    }),
    { sessionId } = await send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
  for (const method of ["Runtime.enable", "Page.enable", "Network.enable"])
    await send(method, {}, sessionId);
  if (process.env.REL_BROWSER_FONT_DIR) {
    for (const style of ["normal", "italic"]) {
      const data = (
        await readFile(
          process.env.REL_BROWSER_FONT_DIR +
            "/red-hat-text-latin-wght-" +
            style +
            ".woff2",
        )
      ).toString("base64");
      await send(
        "Page.addScriptToEvaluateOnNewDocument",
        {
          source: `{const font=new FontFace('Red Hat Text','url(data:font/woff2;base64,${data})',{weight:'300 700',style:'${style}'});document.fonts.add(font);void font.load()}`,
        },
        sessionId,
      );
    }
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
      source: `{window.fixtureSessionError=false;const real=window.fetch;window.fetch=(...args)=>window.fixtureSessionError&&args[0]==='/api/auth/session'?Promise.resolve(new Response(JSON.stringify({error:'Fixture unavailable'}),{status:503})):real(...args)}`,
    },
    sessionId,
  );
  return { targetId, sessionId, browserContextId };
}
async function navigate(page, path) {
  await send("Target.activateTarget", { targetId: page.targetId });
  await send("Page.navigate", { url: base + path }, page.sessionId);
  await wait(
    page,
    `location.pathname===${JSON.stringify(path.split(/[?#]/)[0])}&&document.readyState==='complete'`,
  );
}
const click = (page, selector) =>
  evaluate(page, `document.querySelector(${JSON.stringify(selector)}).click()`);
const fill = (page, selector, value) =>
  evaluate(
    page,
    `{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}))}`,
  );
const state = (page, value) =>
  wait(
    page,
    `document.querySelector('[data-account-nav]')?.dataset.accountState===${JSON.stringify(value)}`,
  );
async function login(page, name = "member") {
  await navigate(page, "/signin/");
  await fill(page, "#email", name + "@example.test");
  await fill(page, "#password", "test-password-123");
  await click(page, "#submit");
  await wait(
    page,
    `location.pathname===${JSON.stringify(name === "owner" ? "/admin/" : "/account/")}&&document.querySelector('#signout')&&!document.querySelector('#signout').hidden`,
  );
}
async function layout(page, name, widths = [1440, 1024, 768, 560, 390, 320]) {
  for (const width of widths) {
    await send(
      "Emulation.setDeviceMetricsOverride",
      { width, height: 1000, deviceScaleFactor: 1, mobile: width < 500 },
      page.sessionId,
    );
    await evaluate(page, "document.fonts.ready");
    await delay(80);
    assert.equal(
      await evaluate(page, "document.documentElement.scrollWidth<=innerWidth"),
      true,
      name + " overflow at " + width,
    );
    assert.equal(
      await evaluate(
        page,
        "[...document.querySelectorAll('[data-account-nav]')].filter(e=>e.getClientRects().length).every(e=>e.getBoundingClientRect().height>=44)",
      ),
      true,
      name + " short button",
    );
  }
}
async function screenshot(page, name, width) {
  await send(
    "Emulation.setDeviceMetricsOverride",
    { width, height: 1100, deviceScaleFactor: 1, mobile: width < 500 },
    page.sessionId,
  );
  await evaluate(page, "scrollTo(0,0);document.fonts.ready");
  await delay(150);
  const image = await send(
    "Page.captureScreenshot",
    { format: "png", captureBeyondViewport: false },
    page.sessionId,
  );
  await writeFile(
    new URL(`../.wrangler/ui-review/${name}.png`, import.meta.url),
    Buffer.from(image.data, "base64"),
  );
}
const publicPages = [
  "/",
  "/list/",
  "/profile/?editor=editor1",
  "/changelog/",
  "/popularity/",
  "/clans/",
  "/tiktok-privacy/",
];
await mkdir(new URL("../.wrangler/ui-review/", import.meta.url), {
  recursive: true,
});
try {
  const guest = await page();
  for (const path of publicPages) {
    console.log("Checking guest " + path);
    await navigate(guest, path);
    await state(guest, "signed-out");
    assert.equal(
      await evaluate(
        guest,
        "document.querySelector('[data-account-nav]').textContent.trim()",
      ),
      "Sign in / Sign up",
      path,
    );
    assert.equal(
      await evaluate(
        guest,
        "document.querySelector('[data-account-nav]').getAttribute('href')",
      ),
      "/signin/",
    );
    assert.equal(
      await evaluate(
        guest,
        "document.querySelector('[data-account-nav]').getAttribute('aria-label')",
      ),
      "Sign in / Sign up",
    );
    await layout(guest, "guest " + path);
  }
  await navigate(guest, "/list/");
  await state(guest, "signed-out");
  await send(
    "Emulation.setDeviceMetricsOverride",
    { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false },
    guest.sessionId,
  );
  const bounds = await evaluate(
    guest,
    "{const r=document.querySelector('[data-account-nav]').getBoundingClientRect();({x:r.x+r.width/2,y:r.y+r.height/2})}",
  );
  await send(
    "Input.dispatchMouseEvent",
    { type: "mouseMoved", ...bounds },
    guest.sessionId,
  );
  await delay(400);
  assert.equal(
    await evaluate(
      guest,
      "{const a=document.querySelector('[data-account-nav]'),s=a.querySelector('span'),range=document.createRange();range.selectNodeContents(s);getComputedStyle(s).opacity==='1'&&s.clientWidth+1>=range.getBoundingClientRect().width}",
    ),
    true,
  );
  await screenshot(guest, "account-nav-signed-out", 1440);
  await evaluate(guest, "document.querySelector('[data-account-nav]').focus()");
  assert.notEqual(
    await evaluate(
      guest,
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
      guest.sessionId,
    );
  await wait(guest, "location.pathname==='/signin/'");
  assert.ok(
    await evaluate(
      guest,
      "document.querySelector('.account-wrap').getBoundingClientRect().width<=420",
    ),
  );

  const member = await page();
  await login(member);
  await wait(
    member,
    "document.querySelector('#profileForm')&&document.querySelector('#tiktokConnection')?.getAttribute('aria-busy')==='false'&&document.querySelector('#youtubeConnection')?.getAttribute('aria-busy')==='false'",
  );
  for (const width of [1440, 1024, 768, 560, 390, 320]) {
    await layout(member, "dashboard", [width]);
    const result = await evaluate(
      member,
      "{const main=document.querySelector('.account-dashboard').getBoundingClientRect(),t=document.querySelector('#tiktokConnection').getBoundingClientRect(),y=document.querySelector('#youtubeConnection').getBoundingClientRect();({width:main.width,columns:getComputedStyle(document.querySelector('#profileForm .two')).gridTemplateColumns.split(' ').length,sideBySide:Math.abs(t.y-y.y)<2&&y.x>t.x+t.width-1})}",
    );
    if (width >= 960) {
      assert.ok(result.width >= 960);
      assert.equal(result.sideBySide, true);
    } else assert.equal(result.sideBySide, false);
    assert.equal(result.columns, width <= 560 ? 1 : 2);
  }
  await screenshot(member, "account-dashboard-desktop", 1440);
  assert.equal(await evaluate(member,"getComputedStyle(document.querySelector('#identity')).textAlign"),"left");
  assert.ok(await evaluate(member,"document.querySelector('#usernameForm button').getBoundingClientRect().width<document.querySelector('#usernameForm').getBoundingClientRect().width"));
  await screenshot(member, "account-dashboard-mobile", 390);
  for (const path of publicPages) {
    await navigate(member, path);
    await state(member, "signed-in");
    assert.equal(
      await evaluate(
        member,
        "document.querySelector('[data-account-nav]').textContent.trim()",
      ),
      "My account",
    );
    assert.equal(
      await evaluate(
        member,
        "document.querySelector('[data-account-nav]').getAttribute('href')",
      ),
      "/account/",
    );
    await layout(member, "member " + path);
  }
  await navigate(member, "/");
  await state(member, "signed-in");
  await screenshot(member, "account-nav-signed-in", 1440);
  await evaluate(
    member,
    "{const a=document.createElement('a');a.className='rel-action rel-action--account';a.href='/account/';a.innerHTML='<span>Old label</span>';document.querySelector('header').append(a)}",
  );
  await wait(
    member,
    "document.querySelectorAll('[data-account-nav]').length===2",
  );
  assert.equal(
    await evaluate(
      member,
      "[...document.querySelectorAll('[data-account-nav]')].every(a=>a.textContent==='My account')",
    ),
    true,
  );
  await evaluate(
    member,
    "window.fixtureSessionError=true;window.dispatchEvent(new Event('focus'))",
  );
  await state(member, "unavailable");
  assert.equal(
    await evaluate(
      member,
      "document.querySelector('[data-account-nav]').textContent",
    ),
    "Account",
  );
  await evaluate(
    member,
    "window.fixtureSessionError=false;window.dispatchEvent(new Event('focus'))",
  );
  await state(member, "signed-in");
  const cookies = await send(
    "Network.getCookies",
    { urls: [base] },
    member.sessionId,
  );
  const refresh = cookies.cookies.find(
    (cookie) => cookie.name === "rel_refresh",
  );
  assert.ok(refresh);
  await send(
    "Network.setCookie",
    {
      name: "rel_access",
      value: "invalid-fixture-access",
      url: base,
      path: "/",
      httpOnly: true,
      sameSite: "Strict",
    },
    member.sessionId,
  );
  await evaluate(member, "window.dispatchEvent(new Event('focus'))");
  await state(member, "signed-in");
  await wait(member, "fetch('/api/auth/session').then(r=>r.ok)");
  const owner = await page();
  await login(owner, "owner");
  await state(owner, "signed-in");
  assert.equal(
    await evaluate(
      owner,
      "document.querySelector('[data-account-nav]').textContent.trim()",
    ),
    "My account",
  );
  await layout(owner, "admin");

  const passive = await page(),
    auth = await page(passive.browserContextId);
  await navigate(passive, "/");
  await state(passive, "signed-out");
  await login(auth);
  await send("Target.activateTarget", { targetId: passive.targetId });
  await evaluate(passive, "window.dispatchEvent(new Event('focus'))");
  await state(passive, "signed-in");
  await send("Target.activateTarget", { targetId: auth.targetId });
  await click(auth, "#signout");
  await wait(auth, "location.pathname==='/signin/'");
  await send("Target.activateTarget", { targetId: passive.targetId });
  await evaluate(passive, "window.dispatchEvent(new Event('focus'))");
  await state(passive, "signed-out");
  await navigate(passive, "/email-verified/");
  await wait(
    passive,
    "document.querySelector('.primary-link')?.classList.contains('rel-action')",
  );
  assert.equal(
    await evaluate(
      passive,
      "document.querySelector('.primary-link').textContent.trim()",
    ),
    "Go back to sign in",
  );
  await send("Page.navigate", {url:base+"/account/"}, passive.sessionId);
  await wait(passive, "location.pathname==='/signin/'");
  assert.deepEqual(errors, []);
  console.log(
    "PASS anonymous/member navigation on home, rankings, profiles, changelog, Popularity, clans and privacy; Owner admin; href/aria labels, dynamic buttons, session refresh, unavailable/retry, cross-tab login/logout, keyboard/sliding labels, desktop/tablet/phone dashboard and unchanged sign-in form.",
  );
} finally {
  for (const browserContextId of contexts)
    await send("Target.disposeBrowserContext", { browserContextId });
  socket.close();
}
