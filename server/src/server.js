// Zero-dependency HTTP server: ingest events, browse sessions, generate skills.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { PORT, SKILLS_DIR, ROOT } from './config.js';
import { appendEvents, listSessions, getSessionEvents, clearAll } from './store.js';
import { synthesize } from './synthesizer.js';
import { renderMarkdown, renderPlaywright } from './renderers.js';
import { DASHBOARD_HTML } from './dashboard.js';

function send(res, status, body, headers = {}) {
  const isJson = typeof body === 'object';
  res.writeHead(status, {
    'content-type': isJson ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 50 * 1024 * 1024) reject(new Error('payload too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function writeSkillFiles(ir) {
  fs.mkdirSync(SKILLS_DIR, { recursive: true });
  const base = ir.slug || 'skill';
  const dir = path.join(SKILLS_DIR, base);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), renderMarkdown(ir), 'utf8');
  fs.writeFileSync(path.join(dir, `${base}.spec.ts`), renderPlaywright(ir), 'utf8');
  fs.writeFileSync(path.join(dir, 'skill.ir.json'), JSON.stringify(ir, null, 2), 'utf8');
  return path.relative(path.join(SKILLS_DIR, '..'), dir);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const { pathname } = url;

    if (req.method === 'OPTIONS') return send(res, 204, '');

    // --- ingest ---
    if (req.method === 'POST' && pathname === '/ingest') {
      const raw = await readBody(req);
      const parsed = raw ? JSON.parse(raw) : {};
      const events = Array.isArray(parsed) ? parsed : parsed.events || [];
      const n = appendEvents(events);
      return send(res, 200, { ok: true, ingested: n });
    }

    // --- sessions list ---
    if (req.method === 'GET' && pathname === '/api/sessions') {
      return send(res, 200, { sessions: listSessions() });
    }

    // --- session events ---
    let m = pathname.match(/^\/api\/sessions\/([^/]+)\/events$/);
    if (req.method === 'GET' && m) {
      return send(res, 200, { events: getSessionEvents(decodeURIComponent(m[1])) });
    }

    // --- generate skills for a session ---
    m = pathname.match(/^\/api\/sessions\/([^/]+)\/generate$/);
    if (req.method === 'POST' && m) {
      const engine = url.searchParams.get('engine') || 'rule';
      const name = (url.searchParams.get('name') || '').trim();
      const split = url.searchParams.get('split') === 'true';
      const events = getSessionEvents(decodeURIComponent(m[1]));
      const irs = await synthesize(events, engine, { name: name || undefined, split });
      const written = irs.map((ir) => ({ name: ir.name, dir: writeSkillFiles(ir), ir }));
      return send(res, 200, { ok: true, engine, skills: written });
    }

    // --- clear store ---
    if (req.method === 'POST' && pathname === '/api/clear') {
      clearAll();
      return send(res, 200, { ok: true });
    }

    // --- dashboard ---
    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      return send(res, 200, DASHBOARD_HTML);
    }

    // --- serve the demo "system" page over http (so content scripts run) ---
    if (req.method === 'GET' && pathname.startsWith('/test-page')) {
      let rel = pathname.replace(/^\/test-page\/?/, '') || 'index.html';
      const file = path.join(ROOT, 'test-page', rel);
      if (!file.startsWith(path.join(ROOT, 'test-page'))) return send(res, 403, { error: 'forbidden' });
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        const type = file.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8';
        return send(res, 200, fs.readFileSync(file, 'utf8'), { 'content-type': type });
      }
      return send(res, 404, { error: 'not found' });
    }

    return send(res, 404, { error: 'not found' });
  } catch (err) {
    return send(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`\n  Operation Skill Recorder — server running`);
  console.log(`  Dashboard:  http://localhost:${PORT}/`);
  console.log(`  Ingest:     POST http://localhost:${PORT}/ingest`);
  console.log(`  Skills out: ${SKILLS_DIR}\n`);
});
