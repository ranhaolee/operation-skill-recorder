// Segmentation + correlation: turn a flat per-session event stream into one or
// more "tasks", and attach to each UI action the API calls it most likely triggered.

const GAP_MS = 15_000; // a pause longer than this starts a new task

// Split a session's events into tasks on long idle gaps or hard navigations.
export function segment(events) {
  const tasks = [];
  let current = null;
  let lastTs = null;

  for (const e of events) {
    const navBoundary = e.type === 'navigation' && current && current.events.length > 0;
    const gapBoundary = lastTs != null && e.ts - lastTs > GAP_MS;

    if (!current || navBoundary || gapBoundary) {
      current = { startUrl: e.pageUrl || '', startTs: e.ts, events: [] };
      tasks.push(current);
    }
    current.events.push(e);
    lastTs = e.ts;
  }
  return tasks.filter((t) => t.events.some((e) => e.type === 'ui_action'));
}

// For one task, link each api_call to the nearest preceding ui_action within a
// window. Returns ordered "steps": ui steps carry a `triggeredApis` array;
// orphan api calls (no recent UI) become standalone api steps.
const ATTR_WINDOW_MS = 5_000;

export function correlate(task) {
  const steps = [];
  const uiSteps = [];

  for (const e of task.events) {
    if (e.type === 'api_call') {
      // find the most recent ui step within the attribution window
      let owner = null;
      for (let i = uiSteps.length - 1; i >= 0; i--) {
        if (e.ts - uiSteps[i].ts <= ATTR_WINDOW_MS) {
          owner = uiSteps[i];
          break;
        }
      }
      if (owner) owner.triggeredApis.push(e);
      else steps.push({ kind: 'api', event: e, ts: e.ts });
    } else if (e.type === 'ui_action') {
      const step = { kind: 'ui', event: e, ts: e.ts, triggeredApis: [] };
      uiSteps.push(step);
      steps.push(step);
    } else {
      steps.push({ kind: 'nav', event: e, ts: e.ts });
    }
  }
  return steps;
}
