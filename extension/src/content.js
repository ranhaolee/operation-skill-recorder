// Content script (isolated world). Captures DOM interactions, builds robust
// selectors, and relays everything to the background service worker. The page-context
// hook (injected.js) is loaded separately as a MAIN-world content script, so we no
// longer inject a <script> tag here (which strict-CSP sites would block).
// The background decides whether recording is on.

(function () {
  // Guard against double-attachment: the manifest declares this script AND the
  // background re-injects it into already-open tabs when recording starts. Without
  // this guard a page that has both would emit every interaction twice.
  if (window.__osrContentLoaded) return;
  window.__osrContentLoaded = true;

  let contextDead = false;
  function relay(event) {
    if (contextDead) return;
    try {
      chrome.runtime.sendMessage({ kind: 'osr-event', event }, () => {
        // reading lastError prevents "Unchecked runtime.lastError" noise
        void chrome.runtime.lastError;
      });
    } catch (e) {
      // The extension was reloaded/updated while this page stayed open: the old
      // content script can no longer reach the background. Make it LOUD instead of
      // silently dropping every interaction.
      if (/context invalidated|Extension context/i.test(e.message || '')) {
        contextDead = true;
        console.error('[OSR] 扩展已被重新加载，本页面的录制已失效 —— 请刷新此页面后重新开始录制。');
      }
    }
  }

  // --- receive API + navigation events from the page context -----------------
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.__osr !== true) return;
    const p = e.data.payload;
    relay({ ...p, pageUrl: p.pageUrl || location.href });
  });

  // --- robust selector builder ------------------------------------------------
  function robustSelector(el) {
    if (!(el instanceof Element)) return '';
    const testid = el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-cy');
    if (testid) return `[data-testid="${testid}"]`;
    if (el.id && !/^\d/.test(el.id)) return `#${cssEscape(el.id)}`;
    const name = el.getAttribute('name');
    if (name) return `${el.tagName.toLowerCase()}[name="${name}"]`;

    // short structural path with nth-of-type, max 4 levels
    const parts = [];
    let node = el;
    for (let depth = 0; node && node.nodeType === 1 && depth < 4; depth++) {
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const sibs = [...parent.children].filter((c) => c.tagName === node.tagName);
        if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      if (node.id) { parts[0] = `#${cssEscape(node.id)}`; break; }
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  function cssEscape(s) {
    return (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/([^\w-])/g, '\\$1');
  }

  function describe(el) {
    return {
      selector: robustSelector(el),
      text: (el.innerText || el.value || '').trim().slice(0, 60),
      ariaLabel: el.getAttribute('aria-label') || '',
      name: el.getAttribute('name') || '',
      id: el.id || '',
      placeholder: el.getAttribute('placeholder') || '',
      tag: el.tagName.toLowerCase(),
    };
  }

  // --- DOM interaction capture ------------------------------------------------
  document.addEventListener(
    'click',
    (e) => {
      const el = e.target.closest('button,a,[role=button],input[type=submit],input[type=button],[onclick]') || e.target;
      relay({ type: 'ui_action', action: 'click', target: describe(el), pageUrl: location.href });
    },
    true
  );

  // capture typed values on blur/change (avoids per-keystroke noise)
  document.addEventListener(
    'change',
    (e) => {
      const el = e.target;
      if (!(el instanceof HTMLElement)) return;
      const tag = el.tagName.toLowerCase();
      if (tag === 'select') {
        relay({ type: 'ui_action', action: 'select', target: describe(el), value: el.value, pageUrl: location.href });
      } else if (tag === 'input' || tag === 'textarea') {
        const type = (el.getAttribute('type') || 'text').toLowerCase();
        if (['button', 'submit', 'file'].includes(type)) return;
        relay({ type: 'ui_action', action: 'type', target: describe(el), value: el.value, pageUrl: location.href });
      }
    },
    true
  );

  // initial navigation
  relay({ type: 'navigation', pageUrl: location.href });
})();
