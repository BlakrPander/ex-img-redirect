# Exhentai 图片域重定向 · s.exhentai.org → ehgt.org 用于解决无法在主页看到预览图的问题

一个 Chrome / Edge 扩展（Manifest V3），把 `s.exhentai.org`（以及 `s1`/`s2`/`s3`… 这类编号子域）的图片请求，在网络请求层重定向到 `ehgt.org`，**路径、文件名、查询参数完整保留**。

> 例：`https://s.exhentai.org/w/02/721/02670-5c2cdxou.webp`
> → `https://ehgt.org/w/02/721/02670-5c2cdxou.webp`

---

## 为什么要做这个替换

**原因：有些网络环境下，代理无法解析 `s.exhentai.org` 这个域名，而 `ehgt.org` 与它指向的实际上是同一个存储库。**

具体说：

1. `s.exhentai.org` 是 E-Hentai 的图片域名之一，解析到 `178.175.128.0/21`（E-Hentai 自有网段）。
2. 在部分网络/代理配置下，这个子域会**解析失败或被拦截**（表现为浏览器长时间转圈、`ERR_TIMED_OUT`、或被 DNS 返回 REFUSED）。
3. 而 `ehgt.org` 是同一个图片存储后端的**另一个入口域名**——两边的 URL 路径结构完全一致，同一个路径在两边都能取到同一张图。
4. 于是只要把请求的域名从 `s.exhentai.org` 换成 `ehgt.org`，图片就能正常加载。

这个扩展把这个替换自动化，并且做在**请求层**，所以不需要手工改地址、也不会出现"先裂图再修好"的闪烁。

### 两个必须说明的点

- **这不是"绕过"任何验证。** E-Hentai 的身份验证（`exhentai.org` 主站的 cookie）与图片域无关；本扩展只更换图片文件的获取入口，不改动、不携带、不转发任何登录凭据。
- **反过来（`ehgt.org` → `s.exhentai.org`）没有意义，不要这么做。** 浏览器保存的 cookie 是按域名隔离的，把图片请求强行塞到 `s.exhentai.org` 这个主机名上，等于把一个本不需要身份验证的静态资源请求，变成一个带着 EH 登录 cookie 的跨域请求。本扩展只做单向替换，就是为了避免这种情况。

---

## 功能

- **请求层重定向**：基于 `declarativeNetRequest`，在浏览器发出请求之前改写 URL
- **路径原样保留**：目录层级、文件名、query 参数（`?a=b`）全部不丢
- **覆盖编号子域**：`s.exhentai.org` 以及 `s1` ~ `sN.exhentai.org`
- **DOM 兜底**：内容脚本处理 `srcset`、`data-src`、内联 `style` 背景图，并用 `MutationObserver` 盯动态插入的图片
- **角标计数**：扩展图标上显示当前页被重定向的资源数量
- **一键开关**：弹窗里可以临时禁用，规则集立即卸载，无需重启浏览器
- **不误伤**：只作用于 `s*.exhentai.org`，`exhentai.org` 主站、`forums.e-hentai.org`、`ehgt.org` 本身都不受影响

---

## 安装

### 方式一：使用 Release 里的压缩包（推荐）

1. 去本仓库的 **Releases** 页面，下载最新的 `ex-img-rewrite-vX.Y.Z.zip`
2. 解压到任意目录
3. Chrome 地址栏打开 `chrome://extensions/`
4. 右上角打开 **开发者模式**
5. 点 **加载已解压的扩展程序**，选择解压出来的 `ex-img-rewrite` 文件夹

Edge：打开 `edge://extensions/`，同样开启开发者模式，点 **加载解压缩的扩展**。

### 方式二：直接从源码加载

```bash
git clone <this-repo>
```

然后按上面第 3–5 步，加载仓库里的 `ex-img-rewrite/` 目录。

---

## 验证是否生效

1. 打开任意 EX 画廊页，看扩展图标是否出现绿色数字角标
2. 点扩展图标，弹窗里应当显示：
   - `规则集`：`ex_img_redirect`
   - `请求层拦截`：`s.exhentai.org → ehgt.org`
   - `页内改写（DOM）`：正常情况下是 `0`（说明请求层已经拦掉了，没轮到 DOM 兜底）
3. 想看规则命中日志：`chrome://extensions/` → 本扩展 → 点 **服务工作进程** → 控制台应出现
   `[EX重定向] 请求层命中规则 1 https://s.exhentai.org/... -> ...`

---

## 规则

`ex-img-rewrite/rules.json`：

| id | regexFilter | 重定向到 |
|---|---|---|
| 1 | `^https?://s\.exhentai\.org/(.*)$` | `https://ehgt.org/\1` |
| 2 | `^https?://s\d+\.exhentai\.org/(.*)$` | `https://ehgt.org/\1` |

`\1` 捕获原 URL 中域名之后的所有内容（含路径与 query），因此是纯域名替换、路径保持不变。

覆盖的资源类型：`image`、`media`、`object`、`xmlhttprequest`、`main_frame`、`sub_frame`、`font`、`other`。
包含 `main_frame` 是为了让"直接在新标签页打开图片 URL"也能自动跳转。

---

## 常见问题

**装了之后图片还是不显示？**

先确认 `ehgt.org` 本身能不能访问：在浏览器里直接打开任意一张 `https://ehgt.org/...` 的图。如果这个也打不开，那就是网络/代理问题，与本扩展无关——本扩展只负责把域名换掉。

**会不会影响正常浏览？**

不会。规则只匹配 `s*.exhentai.org` 这个图片域。

**链接复制出来还是 `s.exhentai.org`？**

正常。请求层重定向不改变页面上写着的 URL 文本，只改变实际发出的请求。如果希望页面上的图片地址文本也变，那是内容脚本负责的部分（已包含：`img`/`video`/`source`/`srcset`/`style`）。

**需要什么权限？**

- `declarativeNetRequest`：下发重定向规则
- `storage`：记住开关状态
- `tabs`：显示角标、读取当前标签页域名
- `host_permissions`：仅 `*.exhentai.org` 与 `ehgt.org`

不收集、不上传任何数据，没有远程代码。

---

## 目录结构

```
ex-img-rewrite/
├── manifest.json    扩展清单（MV3）
├── rules.json       declarativeNetRequest 重定向规则
├── background.js    service worker：规则集启停、角标计数、命中日志
├── content.js       内容脚本：DOM 兜底改写 + 计数上报
├── popup.html       弹窗界面
└── popup.js         弹窗逻辑
```

---

## 开发 / 自检

仓库根目录有 `validate-extension.mjs`，用 Node 对扩展做静态校验（JSON 合法性、manifest 字段、DNR 规则结构、正则替换语义、JS 语法）：

```bash
node validate-extension.mjs
```

`build-release.mjs` 用来打包：

```bash
node build-release.mjs
```

---

## 免责声明

本项目仅用于改善个人网络环境下图片加载体验，不提供、不托管、不分发任何内容。使用时请遵守所在地区法律法规及目标站点的服务条款。

## License

[MIT](LICENSE)
