# EX 图片域重定向 · s.exhentai.org → ehgt.org

Chrome / Edge 扩展（Manifest V3）。把 `s.exhentai.org`（以及 `s1`/`s2`/`s3`… 这类编号子域）的图片请求，在网络请求层重定向到 `ehgt.org`，**路径、文件名、查询参数完整保留**。

> 例：`https://s.exhentai.org/w/02/721/02670-5c2cdxou.webp`
> → `https://ehgt.org/w/02/721/02670-5c2cdxou.webp`

## 为什么要做这个替换

**原因：有些网络环境下，代理无法解析 `s.exhentai.org` 这个域名，而 `ehgt.org` 与它指向的实际上是同一个存储库。**

所以把请求域名换掉即可，路径不变、图片不变。

## 为什么用「请求层重定向」而不是改 DOM

| 方案 | 效果 |
|---|---|
| **declarativeNetRequest（本扩展采用）** | 浏览器发出请求**之前**就改写 URL，页面不会先显示裂图再修，无闪烁、无重复请求 |
| 内容脚本改 `<img src>` | 兜底用：只能处理已经进入 DOM 的图片，CSS 背景图 / JS 动态图容易漏 |

本扩展**两者都有**：请求层做主力，内容脚本做兜底（含 `srcset`、`data-src`、内联 `style` 背景图、`MutationObserver` 监听动态插入）。

## 安装（2 分钟）

1. 解压 `ex-img-rewrite-v*.zip`，得到 `ex-img-rewrite` 文件夹（或直接使用本目录）。
2. Chrome 地址栏打开 `chrome://extensions/`。
3. 右上角打开 **开发者模式**。
4. 点 **加载已解压的扩展程序**，选择 `ex-img-rewrite` 文件夹。
5. 扩展列表里出现「EX 图片域重定向」即成功。图标可能显示为灰块（本扩展没有放图标文件，不影响功能）。

Edge：`edge://extensions/` → 同样打开开发者模式 → 加载解压缩的扩展。

## 验证是否生效

**方法一（最快）**：在浏览器直接打开任意一张 `https://ehgt.org/...` 的图，确认基础网络通顺；再打开任意 EX 画廊页，看扩展图标是否出现绿色数字角标。

**方法二（看规则命中）**：

1. 打开任意 EX 画廊页。
2. `chrome://extensions/` → 找到本扩展 → 点 **服务工作进程 / service worker** 打开控制台。
3. 应能看到日志：`[EX重定向] 请求层命中规则 1 https://s.exhentai.org/... -> ...`
4. 扩展图标上的**绿色数字角标** = 当前页被重定向的资源数量。

**方法三（弹窗面板）**：点图标，能看到

- `规则集`：是否启用
- `请求层拦截`：`s.exhentai.org → ehgt.org`
- `页内改写（DOM）`：本页由内容脚本兜底改写的数量（正常情况下应是 0，因为请求层已经拦掉了）
- `当前标签页`：正在浏览的域名

> 早期版本弹窗里有一个「打开样例图」的测试链接，现已移除——它会把用户的浏览记录/请求指向一个特定的图片地址，没有必要保留这种内置外链。

## 规则说明

`rules.json` 里两条规则：

| id | 匹配 | 说明 |
|---|---|---|
| 1 | `^https?://s\.exhentai\.org/(.*)$` | 主规则，`s.exhentai.org` |
| 2 | `^https?://s\d+\.exhentai\.org/(.*)$` | `s1` ~ `sN` 这类编号子域 |

替换目标统一是 `https://ehgt.org/\1`（`\1` = 原路径部分，含 query）。

**不匹配** `exhentai.org` 本身、`forums.e-hentai.org`、`ehgt.org`，所以不会误伤主站和论坛。

覆盖的资源类型：`image`、`media`、`object`、`xmlhttprequest`、`main_frame`、`sub_frame`、`font`、`other`。之所以包含 `main_frame`，是为了让「直接在新标签页打开图片 URL」也能自动跳转。

## 常见问题

**装了之后图片还是不显示？**
先确认 `ehgt.org` 本身能访问：在浏览器打开任意 `https://ehgt.org/...` 的图。如果这个也打不开，说明是网络/代理问题，跟本扩展无关——本扩展只负责把域名换掉。

**会不会影响正常浏览？**
不会。规则只作用于 `s*.exhentai.org` 这个图片域，EX 主站、登录、画廊列表、阅读页都不受影响。

**想临时关掉？**
点扩展图标 → 点「禁用」。规则集会立即卸载，无需重启浏览器。

**链接复制出来还是 `s.exhentai.org`？**
正常。请求层重定向不改变页面上写着的 URL 文本，只改变实际发出的请求。如果希望页面上的图片地址文本也变，那是内容脚本负责的部分（本扩展已包含，针对 `img`/`video`/`source`/`srcset`/`style`）。

## 文件清单

```
ex-img-rewrite/
├── manifest.json    扩展清单（MV3）
├── rules.json       declarativeNetRequest 重定向规则
├── background.js    service worker：规则集启停、角标计数、日志
├── content.js       内容脚本：DOM 兜底改写 + 计数上报
├── popup.html       弹窗界面
└── popup.js         弹窗逻辑
```

## 安全说明

扩展**不收集、不上传任何数据**，没有远程代码。所有逻辑都在本地，权限仅限 `*.exhentai.org` / `*.e-hentai.org` / `ehgt.org`。
