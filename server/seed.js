// Dev helper: replays a realistic recording (the same event shape the extension
// emits) against a running server, then triggers skill generation.
//   node seed.js            # ingest + generate (rule-based)
const BASE = process.env.OSR_BASE || 'http://localhost:3737';
const sessionId = 'demo-' + Date.now();
let seq = 0;
let t = Date.now();
const next = (ms = 400) => (t += ms);

const ev = (e) => ({ sessionId, seq: ++seq, ts: next(), pageUrl: 'http://localhost:3737/test-page/', ...e });

const events = [
  ev({ type: 'navigation', pageUrl: 'http://localhost:3737/test-page/' }),
  ev({ type: 'ui_action', action: 'type', target: { selector: '[data-testid="ticket-title"]', name: 'title', text: '' }, value: '登录页报错' }),
  ev({ type: 'ui_action', action: 'select', target: { selector: '[data-testid="ticket-priority"]', name: 'priority' }, value: 'high' }),
  ev({ type: 'ui_action', action: 'type', target: { selector: 'input[name="assignee"]', name: 'assignee' }, value: 'zhang.san' }),
  ev({ type: 'ui_action', action: 'click', target: { selector: '[data-testid="submit-ticket"]', text: '提交工单' } }),
  // API triggered right after the submit click (within the 5s attribution window)
  ev({
    type: 'api_call',
    request: {
      method: 'POST',
      url: 'https://jsonplaceholder.typicode.com/posts',
      headers: { 'content-type': 'application/json', authorization: 'Bearer SECRET' },
      body: { title: '登录页报错', priority: 'high', assignee: 'zhang.san', password: 'should-be-redacted' },
    },
    response: { status: 201, headers: {}, body: { id: 101 }, durationMs: 134 },
  }),
];

async function main() {
  let r = await fetch(BASE + '/ingest', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ events }),
  });
  console.log('ingest:', await r.json());

  r = await fetch(`${BASE}/api/sessions/${sessionId}/generate?engine=rule`, { method: 'POST' });
  const out = await r.json();
  console.log('generate:', JSON.stringify(out.skills?.map((s) => ({ name: s.name, dir: s.dir })), null, 2));
}

main().catch((e) => {
  console.error('seed failed:', e.message);
  process.exit(1);
});
