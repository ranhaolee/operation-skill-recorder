// JSON-lines event store. One append-only file; sessions are derived by grouping
// on `sessionId`. Deliberately dependency-free for v1 — swap for SQLite later.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, EVENTS_FILE, REDACT_HEADERS, REDACT_BODY_KEYS } from './config.js';

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// --- redaction -------------------------------------------------------------

function redactHeaders(headers) {
  if (!headers || typeof headers !== 'object') return headers;
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = REDACT_HEADERS.includes(k.toLowerCase()) ? '«redacted»' : v;
  }
  return out;
}

function redactBody(body) {
  if (body == null) return body;
  if (typeof body === 'string') return body; // raw strings left as-is (already on the wire)
  if (Array.isArray(body)) return body.map(redactBody);
  if (typeof body === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(body)) {
      out[k] = REDACT_BODY_KEYS.includes(k.toLowerCase())
        ? '«redacted»'
        : redactBody(v);
    }
    return out;
  }
  return body;
}

function sanitize(event) {
  const e = { ...event };
  if (e.request) {
    e.request = {
      ...e.request,
      headers: redactHeaders(e.request.headers),
      body: redactBody(e.request.body),
    };
  }
  if (e.response) {
    e.response = {
      ...e.response,
      headers: redactHeaders(e.response.headers),
      body: redactBody(e.response.body),
    };
  }
  if (e.action === 'type' && e.target && /pass(word)?/i.test(e.target.selector || '')) {
    e.value = '«redacted»';
  }
  return e;
}

// --- write -----------------------------------------------------------------

export function appendEvents(events) {
  ensureDir();
  const lines = events.map((e) => JSON.stringify(sanitize(e))).join('\n') + '\n';
  fs.appendFileSync(EVENTS_FILE, lines, 'utf8');
  return events.length;
}

// --- read ------------------------------------------------------------------

export function readAllEvents() {
  if (!fs.existsSync(EVENTS_FILE)) return [];
  const raw = fs.readFileSync(EVENTS_FILE, 'utf8');
  const out = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      /* skip malformed line */
    }
  }
  return out;
}

export function listSessions() {
  const events = readAllEvents();
  const map = new Map();
  for (const e of events) {
    const id = e.sessionId || 'unknown';
    if (!map.has(id)) {
      map.set(id, {
        sessionId: id,
        count: 0,
        firstTs: e.ts,
        lastTs: e.ts,
        startUrl: e.pageUrl || '',
        uiCount: 0,
        apiCount: 0,
      });
    }
    const s = map.get(id);
    s.count += 1;
    s.firstTs = Math.min(s.firstTs, e.ts);
    s.lastTs = Math.max(s.lastTs, e.ts);
    if (e.type === 'api_call') s.apiCount += 1;
    else s.uiCount += 1;
  }
  return [...map.values()].sort((a, b) => b.lastTs - a.lastTs);
}

export function getSessionEvents(sessionId) {
  return readAllEvents()
    .filter((e) => (e.sessionId || 'unknown') === sessionId)
    .sort((a, b) => (a.seq ?? a.ts) - (b.seq ?? b.ts));
}

export function clearAll() {
  ensureDir();
  fs.writeFileSync(EVENTS_FILE, '', 'utf8');
}
