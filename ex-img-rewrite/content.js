/* EX 图片域重定向 — 内容脚本（DOM 兜底 + 计数上报）
 *
 * declarativeNetRequest 已经在请求层把 s.exhentai.org 改成 ehgt.org，
 * 正常情况下页面不会出现 s.exhentai.org 的请求。
 * 这个脚本负责兜底：
 *   - 把已经写进 DOM 的 s*.exhentai.org 地址改写成 ehgt.org
 *   - 覆盖 JS 动态插入的图片（MutationObserver）
 *   - 覆盖 srcset / CSS background-image
 *   - 统计改写数量，上报给 background 显示角标
 */

const EX_IMG_HOST_RE = /^(https?:)?\/\/s\d*\.exhentai\.org\//i;

function rewriteUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!EX_IMG_HOST_RE.test(s)) return null;
  // 保留协议无关写法，统一成 https
  return s.replace(/^(?:https?:)?\/\/s\d*\.exhentai\.org\//i, 'https://ehgt.org/');
}

let rewritten = 0;
const samples = [];

function noteRewrite(oldUrl, newUrl) {
  rewritten++;
  if (samples.length < 8) samples.push({ from: oldUrl, to: newUrl });
  scheduleReport();
}

function fixElement(el) {
  if (!el || el.nodeType !== 1) return;

  // <img src> / <video src>
  if (typeof el.getAttribute === 'function') {
    const src = el.getAttribute('src');
    const newSrc = rewriteUrl(src);
    if (newSrc) {
      noteRewrite(src, newSrc);
      el.setAttribute('src', newSrc);
    }

    // <source src> / <track>
    const dataSrc = el.getAttribute('data-src');
    const newData = rewriteUrl(dataSrc);
    if (newData) {
      noteRewrite(dataSrc, newData);
      el.setAttribute('data-src', newData);
    }

    // srcset（可能多个候选）
    const srcset = el.getAttribute('srcset');
    if (srcset && EX_IMG_HOST_RE.test(srcset)) {
      const newSet = srcset
        .split(',')
        .map(part => {
          const seg = part.trim();
          const newSeg = rewriteUrl(seg);
          return newSeg || seg;
        })
        .join(', ');
      noteRewrite(srcset, newSet);
      el.setAttribute('srcset', newSet);
    }

    // 内联样式里的 background-image
    const style = el.getAttribute('style');
    if (style && EX_IMG_HOST_RE.test(style)) {
      const newStyle = style.replace(/(?:https?:)?\/\/s\d*\.exhentai\.org\//gi, 'https://ehgt.org/');
      noteRewrite(style, newStyle);
      el.setAttribute('style', newStyle);
    }
  }
}

function scan(root) {
  if (!root || !root.querySelectorAll) return;
  // 常见承载图片的标签
  const els = root.querySelectorAll('img, video, source, track, [style*="exhentai.org"]');
  els.forEach(fixElement);
  if (root.nodeType === 1) fixElement(root);
}

// 初始扫描
scan(document);

// 动态内容
const observer = new MutationObserver((mutations) => {
  for (const m of mutations) {
    if (m.type === 'attributes' && m.target && m.target.nodeType === 1) {
      fixElement(m.target);
    } else if (m.addedNodes) {
      m.addedNodes.forEach(node => {
        if (node.nodeType === 1) scan(node);
      });
    }
  }
});

observer.observe(document.documentElement || document, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['src', 'srcset', 'data-src', 'style']
});

// 上报计数（防抖）
let reportTimer = null;
function scheduleReport() {
  if (reportTimer) return;
  reportTimer = setTimeout(() => {
    reportTimer = null;
    try {
      chrome.runtime.sendMessage({ type: 'count', count: rewritten });
    } catch (e) { /* 扩展重载时可能失效 */ }
  }, 400);
}

// 弹窗询问当前页改写情况
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'getCount') {
    sendResponse({ count: rewritten, samples });
    return true;
  }
  return false;
});

// 首次上报
scheduleReport();
setTimeout(() => {
  scheduleReport();
  console.log('[EX重定向] DOM 层改写完成，计数 =', rewritten, samples);
}, 800);
