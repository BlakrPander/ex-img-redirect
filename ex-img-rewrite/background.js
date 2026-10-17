/* EX 图片域重定向 — service worker
 * 职责：
 *  1. 记录每个标签页被改写的资源数量，显示在扩展图标角标上
 *  2. 汇总被 declarativeNetRequest 实际重定向的请求（用于自检）
 *  3. 提供开关（enable/disable 规则集）
 */

const RULE_SET_ID = 'ex_img_redirect';
const DEFAULTS = { enabled: true };

// 每个 tab 的改写计数
const perTab = new Map();

async function getState() {
  const s = await chrome.storage.local.get(DEFAULTS);
  return s;
}

async function applyEnabled(enabled) {
  try {
    await chrome.declarativeNetRequest.updateEnabledRulesets(
      enabled ? { enableRulesetIds: [RULE_SET_ID] } : { disableRulesetIds: [RULE_SET_ID] }
    );
    return true;
  } catch (e) {
    console.error('[EX重定向] 更新规则集失败', e);
    return false;
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const st = await getState();
  await applyEnabled(st.enabled);
  await chrome.storage.local.set({ stats: { total: 0, byTab: {} } });
  console.log('[EX重定向] 已安装，规则集状态:', st.enabled);
});

chrome.runtime.onStartup.addListener(async () => {
  const st = await getState();
  await applyEnabled(st.enabled);
});

// 内容脚本上报改写数量
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'count') {
    const tabId = sender.tab ? sender.tab.id : -1;
    const n = Number(msg.count) || 0;
    perTab.set(tabId, n);
    updateBadge(tabId, n);
    sendResponse({ ok: true });
    return true;
  }
  if (msg && msg.type === 'getState') {
    (async () => {
      const st = await getState();
      const rules = await chrome.declarativeNetRequest.getEnabledRulesets();
      const dyn = await chrome.declarativeNetRequest.getDynamicRules();
      sendResponse({
        ok: true,
        enabled: st.enabled,
        enabledRulesets: rules,
        dynamicRules: dyn.map(r => ({ id: r.id, regex: r.condition && r.condition.regexFilter, to: r.action && r.action.redirect }))
      });
    })();
    return true;
  }
  if (msg && msg.type === 'setEnabled') {
    (async () => {
      const okSet = await applyEnabled(!!msg.enabled);
      await chrome.storage.local.set({ enabled: !!msg.enabled });
      sendResponse({ ok: okSet, enabled: !!msg.enabled });
    })();
    return true;
  }
  return false;
});

function updateBadge(tabId, count) {
  const text = count > 0 ? String(count) : '';
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#1a7f37' }).catch(() => {});
}

// 页面导航时清空该标签页计数
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    perTab.delete(tabId);
    chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  perTab.delete(tabId);
});

// 汇总 DNR 实际拦截的请求（需要 declarativeNetRequestFeedback 权限）
if (chrome.declarativeNetRequest.onRuleMatchedDebug) {
  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
    try {
      const tabId = info.request.tabId;
      const cur = perTab.get(tabId) || 0;
      perTab.set(tabId, cur + 1);
      updateBadge(tabId, cur + 1);
      console.log('[EX重定向] 请求层命中规则', info.rule.ruleId, info.request.url, '->', info.rule.action && info.rule.action.redirect);
    } catch (e) { /* ignore */ }
  });
}
