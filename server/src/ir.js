// Build a format-agnostic Skill IR from a correlated task.
// The IR is the single source of truth that both renderers (markdown + Playwright)
// consume, and is also exactly what the LLM synthesizer is asked to produce/refine.

function slug(s) {
  return String(s || '')
    .replace(/[^a-zA-Z0-9一-龥]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

// Derive a human-ish parameter name from an element's selector / label.
function paramNameFrom(target, idx) {
  const basis =
    target?.name ||
    target?.id ||
    target?.ariaLabel ||
    target?.placeholder ||
    (target?.selector || '').replace(/[#.\[\]="']/g, ' ').trim().split(/\s+/).pop();
  const s = slug(basis).replace(/-/g, '_');
  return s && s.length > 1 ? s : `value_${idx + 1}`;
}

function guessType(value) {
  if (value == null) return 'string';
  if (/^\d+$/.test(value)) return 'integer';
  if (/^\d+\.\d+$/.test(value)) return 'number';
  if (/@/.test(value)) return 'email';
  return 'string';
}

// Replace dynamic path segments (ids, uuids, numbers) with :id markers.
function urlPattern(url) {
  try {
    const u = new URL(url, 'http://x');
    const p = u.pathname
      .split('/')
      .map((seg) => (/^[0-9a-f]{8,}$/i.test(seg) || /^\d+$/.test(seg) ? ':id' : seg))
      .join('/');
    return p + (u.search ? '?…' : '');
  } catch {
    return url;
  }
}

function apiFromEvent(apiEvent, id) {
  const req = apiEvent.request || {};
  const res = apiEvent.response || {};
  return {
    kind: 'api',
    id,
    method: (req.method || 'GET').toUpperCase(),
    url: req.url || '',
    urlPattern: urlPattern(req.url || ''),
    expectStatus: res.status ?? null,
    requestKeys: req.body && typeof req.body === 'object' ? Object.keys(req.body) : [],
    // best-effort: surface id/token-like fields from the response for chaining
    responseExtract:
      res.body && typeof res.body === 'object'
        ? Object.keys(res.body)
            .filter((k) => /(^|_)id$|code|token/i.test(k))
            .slice(0, 3)
            .reduce((acc, k) => ((acc[k] = `$.${k}`), acc), {})
        : {},
    durationMs: res.durationMs ?? null,
  };
}

export function buildIR(task, steps, meta = {}) {
  const parameters = [];
  const paramSeen = new Set();
  const flat = [];
  let apiCounter = 0;

  for (const step of steps) {
    if (step.kind === 'ui') {
      const e = step.event;
      const ui = {
        kind: 'ui',
        action: e.action, // click | type | select
        selector: e.target?.selector || '',
        label: e.target?.text || e.target?.ariaLabel || e.target?.name || '',
        value: e.value ?? null,
        triggeredApis: [],
      };

      // A typed/selected value (not redacted) becomes a parameter.
      if ((e.action === 'type' || e.action === 'select') && e.value && e.value !== '«redacted»') {
        let name = paramNameFrom(e.target, parameters.length);
        while (paramSeen.has(name)) name += '_x';
        paramSeen.add(name);
        parameters.push({ name, type: guessType(e.value), example: e.value, source: ui.selector });
        ui.value = `{${name}}`;
      }

      flat.push(ui);
      for (const apiEvent of step.triggeredApis || []) {
        const api = apiFromEvent(apiEvent, `api_${++apiCounter}`);
        ui.triggeredApis.push(api.id);
        flat.push(api);
      }
    } else if (step.kind === 'api') {
      flat.push(apiFromEvent(step.event, `api_${++apiCounter}`));
    } else if (step.kind === 'nav') {
      flat.push({ kind: 'nav', url: step.event.pageUrl || step.event.url || '' });
    }
  }

  const name = meta.name || inferName(flat);
  return {
    name,
    slug: slug(name) || 'skill',
    description: meta.description || `通过 ${parameters.length} 个参数，在该系统中复现一段操作流程。`,
    startUrl: task.startUrl,
    parameters,
    steps: flat,
    generatedBy: meta.generatedBy || 'rule-based',
  };
}

function inferName(steps) {
  const lastClick = [...steps].reverse().find((s) => s.kind === 'ui' && s.action === 'click' && s.label);
  if (lastClick) return `操作：${lastClick.label}`.slice(0, 40);
  const api = steps.find((s) => s.kind === 'api');
  if (api) return `${api.method} ${api.urlPattern}`.slice(0, 40);
  return '未命名技能';
}
