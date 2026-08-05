# HAPPY JS

> 跨浏览器（Chrome / Firefox）的敏感信息与指纹扫描 · 动态/深度扫描 · JS 逆向 Hook 辅助浏览器扩展

HAPPY JS 是一款面向 Web 安全测试与 JS 逆向工程的综合型浏览器扩展，融合了 **FindSomething（敏感信息扫描）**、**SnowEyes（指纹/资源发现）**、**AntiDebug_Breaker（反调试与 API Hook）** 三类项目的核心能力，并重新设计了插件 UI 与扫描引擎。采用 Manifest V3，同时适配 Chrome / Edge / Brave（Chromium 内核）与 Firefox 128+。

---

## ✨ 功能特性

### 1. 多维敏感信息扫描（扫描页）
基于自研正则规则集，对页面 HTML 与已加载 JS 进行分类扫描，支持以下 29 类：

| 分类 | 说明 |
| --- | --- |
| 域名 / IP / URL / Iframe | 资源边界识别，区分资源串与裸域名 |
| API（绝对路径 / 相对路径）| 识别 RESTful 接口、模块路径 |
| 用户名密码 / Cookie / ID密钥 | 凭证键值对、Session、JWT、云平台 AK/SK |
| 私钥/证书 / 数据库连接 / 消息队列 / 对象存储 | 私钥泄露、MongoDB/MySQL/Redis 连接串、OSS endpoint |
| 手机号 / 邮箱 / 身份证 / 公司机构 | PII 个人信息识别 |
| Windows 路径 / Linux 路径 / SourceMap / GitHub 链接 | 信息泄露线索 |
| Vue文件 / JS文件 / JS库 / 图片音频 / 文档文件 | 资源文件归类 |
| 页面路由 / 页面指纹 | 内嵌路由与框架指纹 |

**云密钥识别覆盖**：微信开放平台/小程序、企业微信、AWS（全前缀）、阿里云、腾讯云、京东云、Google API、GitHub/GitLab Token、支付宝、Apple、Slack、Stripe、Twilio、钉钉、飞书等近 20 种。

**扫描增强**：直接抓取 DOM `<script src>` 与 `<link rel="modulepreload">`（比纯正则更可靠，覆盖动态注入）；扩充噪声过滤词减少误报。点击扫描项右侧的 JS 源路径可直接在新标签打开该 JS 文件。

### 2. 指纹识别（指纹页）
- **HTTP 响应头指纹**：Server / X-Powered-By / Via / Set-Cookie 等
- **Cookie 指纹**：基于 Cookie 名识别常见 CMS / 框架
- **流量统计指纹**：基于同源 JS 资源特征识别
- **页面内嵌指纹**：Webpack / Vite / Vue / React / Angular / jQuery / Element UI / ThinkPHP / Django 等
- **CDN 识别**：Cloudflare / jsDelivr / unpkg

### 3. 动态扫描（MutationObserver）
开启后通过 `MutationObserver` 实时监听 DOM 变化，对动态渲染（SPA、AJAX 注入、懒加载）产生的新内容即时扫描，无需手动刷新。

### 4. 深度扫描（嵌套 JS / Webpack Chunk）
开启后解析 JS 文本中嵌套引用的 JS 与 webpack chunk（`webpackJsonp` / `__webpack_require__` / chunk 映射表），递归抓取并扫描，发现被深藏的接口与密钥。

### 5. JS 逆向 Hook 工具（Hook 页）

#### 反调试脚本（9 个）
| 脚本 | 作用 |
| --- | --- |
| Bypass Debugger | Hook eval/Function 移除 `debugger` 语句，绕过无限 Debugger |
| Hook Console | 防止 JS 重写 console 方法，禁止 `console.clear` |
| Hook Close | 重写 `window.close` 防止反调试关闭页面 |
| Hook History | 拦截 `history.go/back` 防止反调试跳转 |
| Fixed Window Size | 固定窗口尺寸绕过控制台检测 |
| Hook CryptoJS | 打印 AES/DES/Rabbit/MD5/SHA/HMAC 算法的密钥与明文密文 |
| Math.random / Date.now / performance.now | 固定返回值便于调试 |

#### API Hook 脚本（7 个）
| 脚本 | 作用 |
| --- | --- |
| document.cookie | 捕获 Cookie 写入，支持关键字过滤 |
| fetch | 捕获 fetch 请求参数 |
| XMLHttpRequest.open | 捕获 XHR 初始化配置 |
| XMLHttpRequest.setRequestHeader | 捕获 XHR 请求头 |
| Storage.setItem / getItem | 捕获 localStorage / sessionStorage 读写 |
| JSON.stringify/parse | 捕获 JSON 序列化/反序列化 |

所有 Hook 脚本支持 **debugger 断点** 与 **调用栈打印** 开关，支持 **固定变量值** 与 **关键字检索** 配置。

### 6. 路由提取（路由页）
通过主世界注入脚本（`inject/vue_router.js`）提取 **Vue2/Vue3 Router** 与 **React Router** 的完整路由表：
- BFS 全 DOM 定位 Vue 根（`__vue_app__`/`__vue__`/`_vnode`），不限 `#app` 挂载点
- Vue3 三条路径、Vue2 四条路径取 router 实例
- 路由表 4 级回退（`getRoutes` → `options.routes` 递归 → `matcher` → `history.matched`）
- 清空 `beforeHooks`/`beforeGuards` 等守卫容器 + 关闭 `meta.auth` 鉴权标记，绕过登录拿完整路由
- hash/history 模式自动识别 + base 路径
- 多档延时重试（300/800/1500/3000/6000ms）覆盖 SPA 异步挂载
- 支持路径/URL 批量复制、当前标签页直接打开路由

### 7. 防护模块（防护页 · 整合自 Heimdallr）
融合 Heimdallr 的反蜜罐、特征对抗、指纹规则识别三大能力，按子标题分三个区块：

#### 反蜜罐检测
- **蜜罐域名拦截**：通过 `declarativeNetRequest` 动态规则拦截已知蜜罐 JSONP 域名（QQ 音乐/腾讯视频/微博/贴吧/搜狐/网易/豆瓣/B 站等 8 个域名）
- **JSONP 告警通知**：单页 JSONP 蜜罐特征命中超过 10 个时弹出系统通知
- 实时展示蜜罐命中结果（URL 拦截 / JSONP 拦截 / JS 特征告警）

#### 特征对抗
- **禁用页面缓存**：每次页面加载时清除浏览器缓存，避免缓存影响检测结果
- **Canvas 指纹干扰**（Hook 页 → API Hook）：Hook Canvas `toBlob`/`toDataURL`/`getImageData`，向像素数据注入随机扰动，使 Canvas 指纹每次不同

#### 指纹规则识别
- **完整集成 Heimdallr 规则库（265 条规则）**，监听请求 URL / 请求头 / 请求体 / 响应头 / 响应体（五维全覆盖）
- 规则分布：指纹 89 条、关键字 24 条、蜜罐 URL 拦截 4 条、蜜罐 JSONP 域名拦截 138 条、蜜罐 JS 告警 10 条
- 拦截规则 142 条（138 个域名 + 4 个 URL 特征）
- position5（响应体 20 条）通过 **主世界 hook fetch/XHR + content.js 页面 HTML 扫描** 实现，**无需 debugger 权限、无浏览器调试提示条**
- 覆盖：Web 服务器（Tomcat/IIS/JBoss/Jetty/WebSphere/WebLogic）、Java 框架（Shiro/Spring/Struts2/Dubbo）、OA 系统（致远/泛微/用友/通达/心通达/新点/帆软/蓝凌/红帆/华天/万户/金蝶/协众/金和/海昌）、CMS（WordPress/DedeCMS/Jira/Confluence/ShowDoc/米拓）、PHP 框架（ThinkPHP/Laravel）、编辑器（Ueditor/KindEditor/FCKeditor/eWebEditor）、堡垒机（Teleport/齐治/帕拉迪/H3C）、安全设备（F5 BIG-IP/绿盟防火墙/安全狗Waf/宝塔Waf）、海康威视、博达站群、向日葵、Exchange/Coremail/亿邮邮件等
- 覆盖：敏感信息（内网 IP/手机号/邮箱/身份证号/JSON 格式数据）
- 蜜罐检测：HFish 特征资源、fingerprintjs、热点溯源 JSONP 脚本等

> 规则库定义在 [data/heimdallr_rules.js](data/heimdallr_rules.js)，完整保留 Heimdallr 原始规则结构与 `initPrinter()` 索引逻辑，可自行扩展。

### 8. 多 Frame 支持
自动识别主页面与 iframe，按 Frame 分组展示扫描结果，可切换查看不同 Frame 的扫描数据。

### 8. 模式与白名单
- **标准模式**：Hook 脚本按域名独立配置
- **全局模式**：Hook 脚本注入所有网站
- **白名单**：按域名跳过扫描

### 10. 浅色/深色双主题
- 顶部右上角主题切换按钮，一键在浅色（简约中性灰 + 靛蓝）与深色（深石板）间切换
- 主题偏好持久化存储，下次打开自动恢复

---

## 📁 目录结构

```
LatentEye/
├── manifest.json              # MV3 清单（Chrome + Firefox 兼容）
├── background.js              # 后台 Service Worker：徽章/指纹/JS抓取/Hook注册/webRequest/Heimdallr模块
├── content.js                 # 内容脚本：扫描引擎（正则/动态/深度/Hook配置同步）
├── hooks.json                 # Hook 脚本元数据（名称/描述/分类/配置项）
├── data/
│   └── heimdallr_rules.js     # Heimdallr 规则库（40条精选规则 + 拦截域名）
├── hooks/                     # 17 个主世界 Hook 脚本（含 Canvas 指纹干扰）
│   ├── bypass_debugger.js
│   ├── hook_console.js
│   ├── hook_cookie.js
│   ├── hook_crypto.js
│   ├── hook_fetch.js
│   ├── hook_xhr_open.js
│   ├── hook_xhr_header.js
│   ├── hook_storage_set.js
│   ├── hook_storage_get.js
│   ├── hook_json.js
│   └── ... (共 16 个)
├── inject/
│   └── vue_router.js          # 主世界注入：Vue/React 路由提取
├── popup/
│   ├── popup.html             # 弹窗 UI 结构（5 页面导航）
│   ├── popup.css              # 暗色主题样式
│   └── popup.js               # 弹窗逻辑（扫描结果/指纹/Hook/路由/设置）
├── icons/
│   ├── icon16.png             # 工具栏图标
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
└── tools/
    └── gen_icons.js           # 图标生成脚本（纯 Node.js，无依赖）
```

---

## 🚀 安装

### Chrome / Edge / Brave（Chromium 内核）

1. 打开 `chrome://extensions/`
2. 右上角开启 **「开发者模式」**
3. 点击 **「加载已解压的扩展程序」**
4. 选择 `LatentEye/` 目录（包含 `manifest.json` 的目录）
5. 工具栏出现「HAPPY JS」图标即安装成功

> 访问 `file://` 协议或 `localhost` 时需在扩展详情中开启 **「允许访问文件网址」**。

### Firefox（128+）

1. 打开 `about:debugging#/runtime/this-firefox`
2. 点击 **「此 Firefox」** → **「临时载入附加组件」**
3. 选择 `HAPPY JS/manifest.json` 文件
4. 工具栏出现「HAPPY JS」图标即安装成功

> 临时载入的扩展在 Firefox 重启后会移除。如需长期安装，需通过 Mozilla 签名流程。

---

## 📖 使用指南

### 基础流程
1. 打开目标网站
2. 点击工具栏「HAPPY JS」图标打开弹窗
3. **扫描页**自动展示敏感信息分类结果，徽章显示有结果的分类数
4. 顶部进度条显示扫描进度，支持结果过滤与 JSON 导出
5. 多 Frame 站点可在顶部切换不同 Frame 查看结果

### 开启动态/深度扫描
1. 进入 **设置页**
2. 开启 **「动态扫描」** 实时捕获动态渲染内容
3. 开启 **「深度扫描」** 递归解析嵌套 JS 与 webpack chunk
4. 刷新目标页面生效

### 使用 Hook 工具
1. 进入 **Hook 页**，切换「反调试 / API Hook」子页签
2. 开启所需脚本（可配置固定值、关键字、debugger、stack）
3. 设置页可切换 **全局模式**（注入所有站点）或 **标准模式**（仅当前域名）
4. **刷新目标页面** 使 Hook 生效
5. Hook 信息打印在浏览器控制台（F12）

### 提取路由
1. 在 Hook 页开启相关脚本后刷新页面
2. 进入 **路由页**，切换 Vue / React 子页签查看完整路由表
3. 支持自定义基础路径、复制所有路径/URL

---

## 🔧 技术实现要点

| 能力 | 实现 |
| --- | --- |
| 跨浏览器兼容 | Manifest V3 + `browser`/`chrome` 命名空间双适配 + `browser_specific_settings.gecko` |
| 主世界注入 | `chrome.scripting.registerContentScripts({ world: 'MAIN' })` 动态注册 Hook |
| 隔离↔主世界通信 | `window.postMessage` 桥接（content 隔离世界 ↔ inject/hooks 主世界） |
| 动态扫描 | `MutationObserver` 监听 DOM `childList`/`characterData` 变化 |
| 深度扫描 | 自研 `WebpackExtractor` 解析 chunk 映射表，递归 fetch 嵌套 JS |
| Hook 配置同步 | content 将启用脚本列表写入 `localStorage`，主世界脚本读取后初始化 |
| 反无限 Debugger | Hook `eval`/`Function`/`Function.prototype.constructor`，正则移除 `debugger` |
| 路由提取 | 主世界遍历 `__vue_app__`/`__vue__` 根节点与 React Router 实例 |

---

## 🛠️ 开发

### 重新生成图标
```bash
node tools/gen_icons.js
```
脚本使用纯 Node.js（内置 `zlib`）实现 PNG 编码，无需任何外部依赖，输出 `icons/icon16/32/48/128.png`。

### 语法校验
```bash
# 校验所有 JS 文件
node --check background.js
node --check content.js
node --check popup/popup.js
node --check inject/vue_router.js
# 批量校验 hooks
for /f %f in ('dir /b hooks\*.js') do node --check hooks\%f
```

### 修改扫描规则
扫描正则定义在 [content.js](content.js) 的 `PATTERNS` 对象中，按分类追加规则即可扩展。

### 新增 Hook 脚本
1. 在 `hooks/` 下新建 `hook_xxx.js`（参考现有脚本结构）
2. 在 [hooks.json](hooks.json) 追加元数据（id / name / description / category / 配置项）
3. 重新加载扩展

---

## ⚠️ 免责声明

本工具仅供授权的安全测试、CTF 竞赛、安全研究与学习使用。使用者需遵守所在地区法律法规，未经授权对他人系统进行扫描与调试可能违法。作者不对任何滥用行为承担责任。

---

## 🙏 致谢

本项目在功能设计上参考了以下优秀开源项目的思路：

- [FindSomething](https://github.com/momosecurity/FindSomething) — 敏感信息扫描
- [SnowEyes](https://github.com/SickleSec/SnowEyes) — 指纹与资源发现
- [AntiDebug_Breaker](https://github.com/0xsdeo/AntiDebug_Breaker) — 反调试与 JS Hook
- [Heimdallr](https://github.com/graynjo/Heimdallr) — 反蜜罐与特征对抗

HAPPY JS 在此基础上重新设计了扫描引擎、UI 与 Hook 注入架构，代码为原创实现。

---

## 📜 License

MIT
