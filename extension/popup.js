// Popup logic: talks to the background worker to start/stop recording.
const $ = (id) => document.getElementById(id);

function ctl(action, extra = {}) {
  return chrome.runtime.sendMessage({ kind: 'osr-control', action, ...extra });
}

async function render() {
  const st = await ctl('status');
  const recording = st?.recording;
  $('dot').className = 'dot' + (recording ? ' on' : '');
  $('state').textContent = recording ? '录制中…' : '未录制';
  const btn = $('toggle');
  btn.textContent = recording ? '■ 停止录制' : '● 开始录制';
  btn.className = recording ? 'stop' : 'start';
  $('server').value = st?.serverUrl || 'http://localhost:3737';
  $('sid').textContent = recording && st?.sessionId ? 'session: ' + st.sessionId : '';
}

$('toggle').addEventListener('click', async () => {
  const st = await ctl('status');
  await ctl(st?.recording ? 'stop' : 'start');
  render();
});

$('open').addEventListener('click', async () => {
  const st = await ctl('status');
  chrome.tabs.create({ url: (st?.serverUrl || 'http://localhost:3737') + '/' });
});

$('save').addEventListener('click', async () => {
  await ctl('setServer', { serverUrl: $('server').value.trim() });
  render();
});

render();
