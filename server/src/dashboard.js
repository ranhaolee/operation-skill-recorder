// The dashboard is a single self-contained HTML string served at "/".
export const DASHBOARD_HTML = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Operation Skill Recorder</title>
<style>
  :root { --bg:#0f1115; --panel:#171a21; --line:#262b36; --fg:#e6e8ec; --mut:#8a93a3; --acc:#5b9dff; }
  * { box-sizing:border-box; }
  body { margin:0; font:14px/1.5 system-ui,Segoe UI,Roboto,sans-serif; background:var(--bg); color:var(--fg); }
  header { padding:14px 20px; border-bottom:1px solid var(--line); display:flex; align-items:center; gap:14px; }
  header h1 { font-size:16px; margin:0; }
  header .mut { color:var(--mut); font-size:12px; }
  .wrap { display:grid; grid-template-columns:340px 1fr; height:calc(100vh - 53px); }
  .col { overflow:auto; padding:14px; }
  .col.left { border-right:1px solid var(--line); }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:10px 12px; margin-bottom:10px; cursor:pointer; }
  .card:hover { border-color:var(--acc); }
  .card.sel { border-color:var(--acc); }
  .card .url { color:var(--fg); word-break:break-all; }
  .card .meta { color:var(--mut); font-size:12px; margin-top:4px; }
  .tag { display:inline-block; padding:1px 7px; border-radius:10px; font-size:11px; background:#1f2530; color:var(--mut); margin-right:6px; }
  .tag.api { color:#7ee0a1; } .tag.ui { color:#7eb6ff; }
  button { background:var(--acc); color:#fff; border:0; border-radius:6px; padding:7px 12px; cursor:pointer; font-size:13px; }
  button.ghost { background:#1f2530; color:var(--fg); }
  .row { display:flex; gap:8px; align-items:center; margin-bottom:12px; flex-wrap:wrap; }
  select { background:#1f2530; color:var(--fg); border:1px solid var(--line); border-radius:6px; padding:6px; }
  pre { background:#0b0d11; border:1px solid var(--line); border-radius:8px; padding:12px; overflow:auto; white-space:pre-wrap; }
  .ev { border-bottom:1px solid var(--line); padding:7px 0; font-size:13px; }
  .ev .mono { font-family:ui-monospace,Consolas,monospace; color:var(--mut); }
  h3 { margin:16px 0 8px; font-size:13px; color:var(--mut); text-transform:uppercase; letter-spacing:.04em; }
  .empty { color:var(--mut); padding:30px; text-align:center; }
  .pill { font-size:11px; color:var(--mut); }
</style>
</head>
<body>
<header>
  <h1>🎬 Operation Skill Recorder</h1>
  <span class="mut" id="status">加载中…</span>
  <span style="flex:1"></span>
  <button class="ghost" onclick="refresh()">刷新</button>
  <button class="ghost" onclick="clearAll()">清空数据</button>
</header>
<div class="wrap">
  <div class="col left">
    <h3>会话 (Sessions)</h3>
    <div id="sessions"><div class="empty">暂无数据</div></div>
  </div>
  <div class="col right" id="detail">
    <div class="empty">← 选择左侧一个会话查看操作流，并生成技能</div>
  </div>
</div>
<script>
const API = location.origin;
let current = null;

async function refresh() {
  const r = await fetch(API + '/api/sessions').then(x => x.json());
  const el = document.getElementById('sessions');
  document.getElementById('status').textContent = r.sessions.length + ' 个会话';
  if (!r.sessions.length) { el.innerHTML = '<div class="empty">暂无数据，去浏览器里录制一段操作吧</div>'; return; }
  el.innerHTML = r.sessions.map(s => \`
    <div class="card \${s.sessionId===current?'sel':''}" onclick="openSession('\${s.sessionId}')">
      <div class="url">\${esc(s.startUrl) || '(无 URL)'}</div>
      <div class="meta">
        <span class="tag ui">UI \${s.uiCount}</span>
        <span class="tag api">API \${s.apiCount}</span>
        \${new Date(s.lastTs).toLocaleString()}
      </div>
    </div>\`).join('');
}

async function openSession(id) {
  current = id;
  await refresh();
  const r = await fetch(API + '/api/sessions/' + encodeURIComponent(id) + '/events').then(x => x.json());
  const evs = r.events.map(e => renderEvent(e)).join('');
  document.getElementById('detail').innerHTML = \`
    <div class="row">
      <strong>会话 \${id.slice(0,8)}</strong>
      <span class="pill">\${r.events.length} 个事件</span>
      <span style="flex:1"></span>
      <select id="engine">
        <option value="rule">规则引擎 (离线)</option>
        <option value="llm">LLM 增强 (需 API key)</option>
      </select>
      <button onclick="generate('\${id}')">⚙️ 生成技能</button>
    </div>
    <div class="row">
      <input id="skillname" placeholder="技能名称（留空则自动命名）" style="flex:1" />
      <label class="pill" style="display:flex;align-items:center;gap:5px;white-space:nowrap">
        <input type="checkbox" id="split" /> 按导航/停顿拆分为多个
      </label>
    </div>
    <div id="genout"></div>
    <h3>操作流 (Event stream)</h3>
    <div>\${evs}</div>\`;
}

function renderEvent(e) {
  if (e.type === 'api_call') {
    const req = e.request||{}, res = e.response||{};
    return \`<div class="ev"><span class="tag api">API</span>
      <span class="mono">\${esc(req.method||'')} \${esc(req.url||'')}</span>
      → \${res.status??''} <span class="pill">\${res.durationMs??''}ms</span></div>\`;
  }
  if (e.type === 'navigation') {
    return \`<div class="ev"><span class="tag">NAV</span> <span class="mono">\${esc(e.pageUrl||'')}</span></div>\`;
  }
  const t = e.target||{};
  const val = e.value!=null ? ' = "'+esc(String(e.value).slice(0,40))+'"' : '';
  return \`<div class="ev"><span class="tag ui">UI</span>
    <b>\${esc(e.action||'')}</b> \${esc(t.text||t.selector||'')}\${val}</div>\`;
}

async function generate(id) {
  const engine = document.getElementById('engine').value;
  const name = document.getElementById('skillname').value.trim();
  const split = document.getElementById('split').checked;
  const out = document.getElementById('genout');
  out.innerHTML = '<div class="pill">生成中…</div>';
  const qs = new URLSearchParams({ engine });
  if (name) qs.set('name', name);
  if (split) qs.set('split', 'true');
  const r = await fetch(API + '/api/sessions/' + encodeURIComponent(id) + '/generate?' + qs.toString(), { method:'POST' }).then(x=>x.json());
  if (!r.ok) { out.innerHTML = '<pre>'+esc(JSON.stringify(r,null,2))+'</pre>'; return; }
  out.innerHTML = '<h3>生成的技能 ('+r.engine+')</h3>' + r.skills.map(s => \`
    <div class="card" style="cursor:default">
      <div class="url">📦 \${esc(s.name)}</div>
      <div class="meta">已写入: \${esc(s.dir)}/ （SKILL.md · *.spec.ts · skill.ir.json）</div>
      <details><summary class="pill">查看 IR</summary><pre>\${esc(JSON.stringify(s.ir,null,2))}</pre></details>
    </div>\`).join('');
}

async function clearAll() {
  if (!confirm('确定清空所有已录制的事件？')) return;
  await fetch(API + '/api/clear', { method:'POST' });
  current = null;
  document.getElementById('detail').innerHTML = '<div class="empty">已清空</div>';
  refresh();
}

function esc(s){ return String(s??'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
refresh();
setInterval(refresh, 5000);
</script>
</body>
</html>`;
