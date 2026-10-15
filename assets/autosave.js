export function createAutosave({ write, onState, delay = 800 }) {
  let version = 0, savedVersion = 0, timer, running, blocked = false;
  const dirty = () => version !== savedVersion;
  const schedule = () => {
    clearTimeout(timer);
    if (!blocked) timer = setTimeout(() => { void flush(); }, delay);
  };
  async function flush() {
    clearTimeout(timer);
    if (running) return running;
    if (!dirty() || blocked) return;
    const savingVersion = version;
    onState("saving");
    running = (async () => {
      try {
        await write();
        savedVersion = savingVersion;
        onState(dirty() ? "dirty" : "saved");
        if (dirty()) schedule();
      } catch (error) {
        // A conflict never retries with a newer revision and stale local data.
        blocked = error.status === 409;
        onState("error", error);
      } finally { running = null; }
    })();
    return running;
  }
  return {
    change() { version++; onState("dirty"); schedule(); },
    flush,
    pause() { clearTimeout(timer); },
    reset() { if (running) return false; clearTimeout(timer); version = savedVersion = 0; blocked = false; return true; },
    get dirty() { return dirty(); },
    get busy() { return Boolean(running); },
    get blocked() { return blocked; },
  };
}

const pageSource = globalThis.crypto?.randomUUID?.() || String(Math.random());

export function watchChanges(callback, interval = 10000) {
  let busy = false;
  async function refresh() {
    if (busy || document.hidden) return;
    busy = true;
    try { await callback(); } catch {} finally { busy = false; }
  }
  const timer = setInterval(() => { void refresh(); }, interval);
  const changed = event => { if (event.data === "changed" || (event.data?.type === "changed" && event.data.source !== pageSource)) void refresh(); };
  const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("rel-changes") : null;
  if (channel) channel.onmessage = changed;
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", refresh);
  return () => { clearInterval(timer); channel?.close(); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
}

export function announceChange() {
  if (typeof BroadcastChannel !== "function") return;
  const channel = new BroadcastChannel("rel-changes");
  channel.postMessage({type:"changed",source:pageSource});
  channel.close();
}
