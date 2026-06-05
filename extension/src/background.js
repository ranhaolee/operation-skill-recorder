// Background service worker: holds recording state + session id, buffers events,
// stamps seq numbers, and flushes batches to the local server.

const DEFAULTS = { recording: false, serverUrl: 'http://localhost:3737', sessionId: null, seq: 0 };
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

async function handleControl(msg) {
  if (msg.action === 'start') {
    const sessionId = crypto.randomUUID();
    await setState({ recording: true, sessionId, seq: 0 });
    updateBadge();
    return { ok: true, recording: true, sessionId };
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
