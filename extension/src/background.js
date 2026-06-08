// Background service worker: holds recording state + session id, buffers events,
// stamps seq numbers, and flushes batches to the local server.

const DEFAULTS = { recording: false, serverUrl: 'http://localhost:3737', sessionId: null, seq: 0, recordingTabId: null };
let buffer = [];
let flushTimer = null;

async function getState() {
  const s = await chrome.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...s };
}

async function setState(patch) {
  await chrome.storage.local.set(patch);
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flush, 1500);
}

async function flush() {
  clearTimeout(flushTimer);
  flushTimer = null;
  if (buffer.length === 0) return;
  const { serverUrl } = await getState();
  const batch = buffer;
  buffer = [];
  try {
    await fetch(serverUrl.replace(/\/$/, '') + '/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: batch }),
    });
  } catch (e) {
    // server down — requeue so we don't lose data
    buffer = batch.concat(buffer);
  }
  updateBadge();
}

async function updateBadge() {
  const { recording } = await getState();
  chrome.action.setBadgeText({ text: recording ? 'REC' : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#e0443e' });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.kind === 'osr-event') {
    handleEvent(msg.event, sender);
    sendResponse?.({ ok: true });
    return true;
  }
  if (msg?.kind === 'osr-control') {
    handleControl(msg).then((r) => sendResponse(r));
    return true; // async
  }
});

async function handleEvent(event, sender) {
  const st = await getState();
  if (!st.recording) return;
  // Only record the tab that was active when recording started — ignore every other tab.
  // (sender.tab.id is shared across a tab's frames, so iframes of the recorded tab still match.)
  if (st.recordingTabId != null && sender?.tab?.id !== st.recordingTabId) return;
  if (isRecorderOwnEvent(event, st.serverUrl)) return; // skip our own dashboard/control-plane traffic
  const seq = st.seq + 1;
  await setState({ seq });
  buffer.push({
    ...event,
    sessionId: st.sessionId,
    seq,
    ts: Date.now(),
    tabId: sender?.tab?.id ?? null,
  });
  if (buffer.length >= 20) flush();
  else scheduleFlush();
}

// Don't record the recorder recording itself: the dashboard polls /api/sessions
// every few seconds, and clicking around the dashboard would otherwise pollute the
// session. We drop (a) anything happening ON the recorder's own pages — except the
// bundled /test-page demo — and (b) any API call hitting the server's own endpoints.
function isRecorderOwnEvent(event, serverUrl) {
  let origin;
  try { origin = new URL(serverUrl).origin; } catch { return false; }

  const page = event.pageUrl || '';
  if (page) {
    try {
      const u = new URL(page);
      if (u.origin === origin && !u.pathname.startsWith('/test-page')) return true;
    } catch {}
  }

  if (event.type === 'api_call') {
    try {
      const u = new URL(event.request?.url || '', origin);
      if (u.origin === origin && (u.pathname === '/ingest' || u.pathname.startsWith('/api'))) return true;
    } catch {}
  }

  return false;
}

// Manifest content scripts only attach to pages loaded AFTER the extension is ready.
// To record a tab the user already had open when they hit "start", inject both the
// isolated-world capture script and the main-world fetch/XHR hook on demand — into
// the recorded tab only (all of its frames).
async function injectTab(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, world: 'MAIN', files: ['src/injected.js'] });
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, world: 'ISOLATED', files: ['src/content.js'] });
  } catch (e) {
    // Restricted URLs (chrome://, web store, …) reject injection — nothing to record there.
  }
}

async function activeTabId() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id ?? null;
  } catch {
    return null;
  }
}

async function handleControl(msg) {
  if (msg.action === 'start') {
    const sessionId = crypto.randomUUID();
    const tabId = await activeTabId();
    await setState({ recording: true, sessionId, seq: 0, recordingTabId: tabId });
    updateBadge();
    if (tabId != null) await injectTab(tabId); // capture the active tab if it was already open
    return { ok: true, recording: true, sessionId, tabId };
  }
  if (msg.action === 'stop') {
    await setState({ recording: false });
    await flush();
    updateBadge();
    return { ok: true, recording: false };
  }
  if (msg.action === 'status') {
    const st = await getState();
    return { ok: true, ...st };
  }
  if (msg.action === 'setServer') {
    await setState({ serverUrl: msg.serverUrl });
    return { ok: true };
  }
  return { ok: false };
}

updateBadge();
