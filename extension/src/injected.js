// Runs in the PAGE's JavaScript context (injected by content.js so it can see the
// real window.fetch / XMLHttpRequest). Captures request + response bodies and
// SPA route changes, then forwards them to the content script via window.postMessage.
(function () {
  if (window.__osrInjected) return;
  window.__osrInjected = true;

  const MAX_BODY = 20_000; // cap captured body size

  function post(payload) {
    window.postMessage({ __osr: true, payload }, '*');
  }

  function safeParse(text) {
    if (text == null) return null;
    if (typeof text !== 'string') return text;
    const t = text.slice(0, MAX_BODY);
    try {
      return JSON.parse(t);
    } catch {
      return t;
    }
  }

  function headersToObj(h) {
    const o = {};
    try {
      if (h && typeof h.forEach === 'function') h.forEach((v, k) => (o[k] = v));
      else if (h && typeof h === 'object') Object.assign(o, h);
    } catch {}
    return o;
  }

  // --- patch fetch ---------------------------------------------------------
  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = async function (...args) {
      const start = performance.now();
      const [input, init = {}] = args;
      const url = typeof input === 'string' ? input : input?.url || '';
      const method = (init.method || (typeof input === 'object' && input?.method) || 'GET').toUpperCase();
      const reqBody = safeParse(init.body);

      let resp;
      try {
        resp = await origFetch.apply(this, args);
      } catch (err) {
        post({ type: 'api_call', request: { method, url, body: reqBody }, response: { status: 0, error: String(err) }, durationMs: Math.round(performance.now() - start) });
        throw err;
      }

      const clone = resp.clone();
      clone.text().then((text) => {
        post({
          type: 'api_call',
          request: { method, url, headers: headersToObj(init.headers), body: reqBody },
          response: {
            status: resp.status,
            headers: headersToObj(resp.headers),
            body: safeParse(text),
            durationMs: Math.round(performance.now() - start),
          },
        });
      }).catch(() => {});
      return resp;
    };
  }

  // --- patch XMLHttpRequest -------------------------------------------------
  const XHR = window.XMLHttpRequest;
  if (XHR) {
    const open = XHR.prototype.open;
    const sendM = XHR.prototype.send;
    XHR.prototype.open = function (method, url) {
      this.__osr = { method: (method || 'GET').toUpperCase(), url, start: 0 };
      return open.apply(this, arguments);
    };
    XHR.prototype.send = function (body) {
      const meta = this.__osr;
      if (meta) {
        meta.start = performance.now();
        this.addEventListener('loadend', () => {
          let respBody = null;
          try {
            respBody = safeParse(this.responseType === '' || this.responseType === 'text' ? this.responseText : this.response);
          } catch {}
          post({
            type: 'api_call',
            request: { method: meta.method, url: meta.url, body: safeParse(body) },
            response: { status: this.status, body: respBody, durationMs: Math.round(performance.now() - meta.start) },
          });
        });
      }
      return sendM.apply(this, arguments);
    };
  }

  // --- SPA route changes ----------------------------------------------------
  const fireNav = () => post({ type: 'navigation', pageUrl: location.href });
  const push = history.pushState;
  const replace = history.replaceState;
  history.pushState = function () { const r = push.apply(this, arguments); fireNav(); return r; };
  history.replaceState = function () { const r = replace.apply(this, arguments); fireNav(); return r; };
  window.addEventListener('popstate', fireNav);
})();
