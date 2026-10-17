// 校验扩展：manifest 结构、DNR 规则合法性、正则替换语义、JS 语法、弹窗内容
// 用法：node validate-extension.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = dirname(fileURLToPath(import.meta.url));
const dir = join(root, 'ex-img-rewrite');

let pass = 0, fail = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) { pass++; console.log(`PASS  ${msg}`); }
  else { fail++; console.log(`FAIL  ${msg}${extra ? '  ' + extra : ''}`); }
};

// ---- 1. JSON 可解析 ----
let manifest, rules;
try { manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')); ok(true, 'manifest.json 是合法 JSON'); }
catch (e) { ok(false, 'manifest.json 解析失败', e.message); }

try { rules = JSON.parse(readFileSync(join(dir, 'rules.json'), 'utf8')); ok(true, 'rules.json 是合法 JSON'); }
catch (e) { ok(false, 'rules.json 解析失败', e.message); }

// ---- 2. manifest 关键字段 ----
if (manifest) {
  ok(manifest.manifest_version === 3, 'manifest_version = 3');
  ok(/^\d+\.\d+\.\d+$/.test(manifest.version), `version 格式合法 (${manifest.version})`);
  ok(Array.isArray(manifest.permissions) && manifest.permissions.includes('declarativeNetRequest'), '声明 declarativeNetRequest 权限');
  ok(Array.isArray(manifest.host_permissions) && manifest.host_permissions.some(h => h.includes('exhentai.org')), 'host_permissions 含 exhentai.org');
  ok(manifest.host_permissions.some(h => h.includes('ehgt.org')), 'host_permissions 含 ehgt.org');
  ok(manifest.background && manifest.background.service_worker === 'background.js', 'service_worker 指向 background.js');
  ok(manifest.declarative_net_request.rule_resources[0].path === 'rules.json', 'rule_resources 指向 rules.json');
  ok(manifest.declarative_net_request.rule_resources[0].enabled === true, '规则集默认启用');
  const cs = manifest.content_scripts[0];
  ok(cs.matches.some(m => m.includes('exhentai.org')), 'content_scripts 匹配 exhentai.org');
}

// ---- 3. DNR 规则合法性 ----
const validResourceTypes = new Set(['main_frame','sub_frame','stylesheet','script','image','font','object','xmlhttprequest','ping','csp_report','media','websocket','webtransport','webbundle','other']);
if (rules) {
  ok(rules.length >= 1, `规则数量 = ${rules.length}`);
  const ids = new Set();
  for (const r of rules) {
    ok(Number.isInteger(r.id) && r.id > 0, `规则 ${r.id} id 是正整数`);
    ok(!ids.has(r.id), `规则 ${r.id} id 唯一`);
    ids.add(r.id);
    ok(r.action && r.action.type === 'redirect', `规则 ${r.id} action = redirect`);
    const sub = r.action && r.action.redirect && r.action.redirect.regexSubstitution;
    ok(typeof sub === 'string' && sub.startsWith('https://ehgt.org/'), `规则 ${r.id} regexSubstitution 指向 ehgt.org`);
    ok(!(r.action && r.action.redirect && r.action.redirect.url), `规则 ${r.id} 未同时使用 url 与 regexSubstitution`);
    ok(typeof r.condition.regexFilter === 'string', `规则 ${r.id} 有 regexFilter`);
    const bad = (r.condition.resourceTypes || []).filter(t => !validResourceTypes.has(t));
    ok(bad.length === 0, `规则 ${r.id} resourceTypes 全部合法`, bad.join(','));
    ok((r.condition.resourceTypes || []).includes('image'), `规则 ${r.id} 覆盖 image 类型`);
    try { new RegExp(r.condition.regexFilter); ok(true, `规则 ${r.id} regexFilter 可编译`); }
    catch (e) { ok(false, `规则 ${r.id} regexFilter 不可编译`, e.message); }
  }
}

// ---- 4. 替换语义验证（模拟 DNR regexSubstitution） ----
if (rules) {
  const apply = (rule, url) => {
    const re = new RegExp(rule.condition.regexFilter);
    const m = url.match(re);
    if (!m) return null;
    return rule.action.redirect.regexSubstitution.replace(/\\(\d)/g, (_, i) => m[Number(i)] || '');
  };
  const cases = [
    ['https://s.exhentai.org/w/02/721/02670-5c2cdxou.webp', 'https://ehgt.org/w/02/721/02670-5c2cdxou.webp'],
    ['http://s.exhentai.org/w/02/721/02670-5c2cdxou.webp', 'https://ehgt.org/w/02/721/02670-5c2cdxou.webp'],
    ['https://s.exhentai.org/t/a3/4c/abc-1-2-3-jpg_l.jpg', 'https://ehgt.org/t/a3/4c/abc-1-2-3-jpg_l.jpg'],
    ['https://s1.exhentai.org/w/aa/bb/cc.webp', 'https://ehgt.org/w/aa/bb/cc.webp'],
    ['https://s23.exhentai.org/x/y.webp', 'https://ehgt.org/x/y.webp'],
    ['https://s.exhentai.org/w/a.webp?q=1', 'https://ehgt.org/w/a.webp?q=1'],
    ['https://exhentai.org/w/x.webp', null],
    ['https://ehgt.org/w/x.webp', null],
    ['https://forums.e-hentai.org/x', null],
  ];
  for (const [input, expected] of cases) {
    let got = null;
    for (const r of rules) { const g = apply(r, input); if (g !== null) { got = g; break; } }
    ok(got === expected, `替换 ${input}`, `得到 ${got}`);
  }
}

// ---- 5. JS 语法检查 ----
for (const f of ['background.js', 'content.js', 'popup.js']) {
  try {
    new vm.Script(readFileSync(join(dir, f), 'utf8'), { filename: f });
    ok(true, `${f} 语法正确`);
  } catch (e) {
    ok(false, `${f} 语法错误`, e.message);
  }
}

// ---- 6. popup.html 一致性 ----
try {
  const html = readFileSync(join(dir, 'popup.html'), 'utf8');
  ok(html.includes('popup.js'), 'popup.html 引用了 popup.js');
  ok(html.includes('id="toggle"'), 'popup.html 含开关按钮');
  ok(html.includes('id="domcount"'), 'popup.html 含 DOM 计数显示');
  ok(!html.includes('testlink'), 'popup.html 已移除内置样例图链接');
  ok(!/s\.exhentai\.org\/w\//.test(html), 'popup.html 不含硬编码的样例图地址');
} catch (e) { ok(false, 'popup.html 读取失败', e.message); }

// ---- 7. 无远程代码 / 无内联脚本 ----
try {
  const html = readFileSync(join(dir, 'popup.html'), 'utf8');
  ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'popup.html 无内联 <script>（符合 MV3 CSP）');
  const all = ['manifest.json', 'rules.json', 'background.js', 'content.js', 'popup.js']
    .map(f => readFileSync(join(dir, f), 'utf8')).join('\n');
  ok(!/https?:\/\/(?!ehgt\.org|s\\?\.exhentai|api\.github)/.test(all), '源码中无意外外链');
  ok(!/eval\s*\(|new\s+Function\s*\(/.test(all), '源码中无 eval / new Function');
} catch (e) { ok(false, '源码扫描失败', e.message); }

console.log(`\n===== ${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail === 0 ? 0 : 1);
