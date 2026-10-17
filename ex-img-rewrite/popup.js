/* EX 图片域重定向 — 弹窗 */

const $ = (id) => document.getElementById(id);

function setDot(state) {
  const dot = $('dot');
  dot.classList.remove('on', 'off');
  if (state === true) dot.classList.add('on');
  else if (state === false) dot.classList.add('off');
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs && tabs[0] ? tabs[0] : null;
}

async function askBackground(payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(payload, (res) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(res);
    });
  });
}

async function render() {
  // 1) 规则/开关状态
  const st = await askBackground({ type: 'getState' });
  const enabled = st ? st.enabled : null;
  setDot(enabled);
  $('title').textContent = enabled === null ? 'EX 图片域重定向' : (enabled ? '已启用' : '已禁用');

  const rulesets = st && st.enabledRulesets ? st.enabledRulesets : [];
  $('ruleset').textContent = rulesets.length
    ? rulesets.join(', ')
    : '未启用';
  $('dnr').textContent = rulesets.includes('ex_img_redirect')
    ? 's.exhentai.org → ehgt.org'
    : '无';
  $('toggle').textContent = enabled ? '禁用' : '启用';

  // 2) 当前标签页信息
  const tab = await getActiveTab();
  if (tab) {
    const u = tab.url || '';
    let host = '—';
    try { host = new URL(u).host; } catch (e) {}
    $('tabinfo').textContent = host || '—';
  }

  // 3) 当前页 DOM 改写数量（向内容脚本询问）
  if (tab && tab.id >= 0) {
    chrome.tabs.sendMessage(tab.id, { type: 'getCount' }, (res) => {
      if (chrome.runtime.lastError || !res) {
        $('domcount').textContent = '页面未注入脚本';
        return;
      }
      $('domcount').textContent = String(res.count || 0) + ' 处';
      const ul = $('samples');
      ul.innerHTML = '';
      (res.samples || []).slice(0, 6).forEach((s) => {
        const li = document.createElement('li');
        li.title = s.from + '  →  ' + s.to;
        li.textContent = '→ ' + s.to.replace('https://ehgt.org/', '');
        ul.appendChild(li);
      });
      if (!res.samples || res.samples.length === 0) {
        const li = document.createElement('li');
        li.textContent = '（本页无 s.exhentai.org 资源）';
        ul.appendChild(li);
      }
    });
  } else {
    $('domcount').textContent = '—';
  }
}

$('toggle').addEventListener('click', async () => {
  const st = await askBackground({ type: 'getState' });
  const enabled = st ? st.enabled : true;
  await askBackground({ type: 'setEnabled', enabled: !enabled });
  await render();
});

$('refresh').addEventListener('click', render);

render();
