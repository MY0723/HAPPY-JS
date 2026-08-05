/* =====================================================================
 * HAPPY JS — background service worker
 * 职责：徽章管理 / HTTP头指纹识别 / JS抓取 / CSP安全正则匹配
 *       Hook脚本动态注册(主世界) / webRequest观测 / 消息路由
 * 兼容：Chrome MV3 + Firefox MV3 (115+)
 * ===================================================================== */

'use strict';

// Firefox 兼容：chrome 命名空间在 Firefox MV3 下同样可用，无需额外 polyfill
const API = (typeof browser !== 'undefined') ? browser : chrome;

// 加载 Heimdallr 规则库（反蜜罐 / 指纹识别 / 特征对抗）
try { importScripts('data/heimdallr_rules.js'); } catch (e) { console.error('[LatentEye] load heimdallr_rules:', e); }

/* ========================== 工具函数 ========================== */
function safeHostname(url) {
    try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}
function genId() { return `le_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`; }

/* =====================================================================
 * 1. 徽章管理器：按"有结果的非空分类数"显示徽章
 * ===================================================================== */
const BadgeManager = {
    cache: new Map(), // tabId -> count
    RESULT_KEYS: ['domains', 'routes', 'absoluteApis', 'apis', 'moduleFiles', 'docFiles',
        'ips', 'phones', 'emails', 'idcards', 'jwts', 'imageFiles', 'jsFiles',
        'vueFiles', 'urls', 'githubUrls', 'companies', 'credentials', 'cookies',
        'idKeys', 'windowsPaths', 'thirdPartyLibs', 'fingers',
        'privateKeys', 'dbConns', 'mqConns', 'linuxPaths', 'sourceMaps', 'ossEndpoints'],

    init() {
        API.tabs.onActivated.addListener(({ tabId }) => this.refresh(tabId));
        API.tabs.onRemoved.addListener((tabId) => {
            this.cache.delete(tabId);
            API.storage.session && API.storage.session.remove(`tab_${tabId}`).catch(() => {});
        });
    },
    set(tabId, count) {
        this.cache.set(tabId, count);
        const show = count > 0;
        API.action.setBadgeText({ text: show ? String(count > 999 ? '999+' : count) : '', tabId });
        API.action.setBadgeBackgroundColor({ color: show ? '#4e6ef2' : '#8f959e', tabId });
    },
    refresh(tabId) {
        if (this.cache.has(tabId)) this.set(tabId, this.cache.get(tabId));
        else this.set(tabId, 0);
    },
    // 由 content 上报扫描结果时调用
    updateFromResults(results, tabId) {
        let n = 0;
        for (const k of this.RESULT_KEYS) {
            const v = results[k];
            if (Array.isArray(v) && v.length > 0) n++;
        }
        this.set(tabId, n);
    }
};

/* =====================================================================
 * 2. 指纹引擎：HTTP响应头 / Cookie / 流量统计 三类指纹
 * ===================================================================== */
const FINGERPRINT_DESC = {
    framework: '框架', technology: '语言', security: '(安全应用/策略)', server: '服务器',
    os: '操作系统', app: '应用', env: '环境', port: '端口', version: '版本', builder: '构建工具',
    appType: '应用类型', time: '时间', component: '组件', panel: '面板', cdn: 'CDN', analytics: '统计分析'
};

const FingerprintEngine = {
    // 按 tabId 缓存指纹聚合结果
    store: new Map(),
    analyticsSeen: { baidu: new Map(), yahoo: new Map(), google: new Map() },

    get(tabId) {
        if (!this.store.has(tabId)) {
            this.store.set(tabId, {
                server: [], component: [], technology: [], security: [],
                analytics: [], builder: [], framework: [], os: [], panel: [], cdn: [],
                nameMap: new Set()
            });
        }
        return this.store.get(tabId);
    },

    // HTTP 响应头规则（type/name/pattern/header/value[/extType/extName]）
    HEADER_RULES: [
        { type: 'server', name: 'Apache', pattern: /apache\/?([\d\.]+)?/i, header: 'server', value: 'version' },
        { type: 'server', name: 'Tomcat', pattern: /apache-coyote\/?([\d\.]+)?/i, header: 'server', value: 'version', extType: 'technology', extName: 'Java' },
        { type: 'server', name: 'Nginx', pattern: /nginx\/?([\d\.]+)?/i, header: 'server', value: 'version' },
        { type: 'server', name: 'IIS', pattern: /microsoft-iis\/?([\d\.]+)?/i, header: 'server', value: 'version', extType: 'os', extName: 'Windows' },
        { type: 'server', name: 'Jetty', pattern: /jetty\s?\/?\(?([0-9a-zA-Z.-]*)\)?/i, header: 'server', value: 'version', extType: 'technology', extName: 'Java' },
        { type: 'server', name: 'Resin', pattern: /resin\/?([\d\.]+)?/i, header: 'server', value: 'version' },
        { type: 'server', name: 'Cloudflare', pattern: /cloudflare/i, header: 'server', extType: 'cdn', extName: 'Cloudflare' },
        { type: 'server', name: 'OpenResty', pattern: /openresty\/?([\d\.]+)?/i, header: 'server', value: 'version', extType: 'server', extName: 'Nginx' },
        { type: 'server', name: 'Tengine', pattern: /tengine\/?([\d\.]+)?/i, header: 'server', value: 'version' },
        { type: 'server', name: 'Varnish', pattern: /varnish\/?([\d\.]+)?/i, header: 'server', value: 'version' },
        { type: 'server', name: 'Caddy', pattern: /caddy\/?([\d\.]+)?/i, header: 'server', value: 'version' },
        { type: 'server', name: 'LiteSpeed', pattern: /litespeed/i, header: 'server' },
        { type: 'component', name: 'OpenSSL', pattern: /openssl\s?\/?\(?([0-9a-zA-Z.-]*)\)?/i, header: 'server', value: 'version' },
        { type: 'component', name: 'PHP-FPM', pattern: /php\/?([\d\.]+)?/i, header: 'server', value: 'version', extType: 'technology', extName: 'PHP' },
        { type: 'os', name: 'Windows', pattern: /win64|win32/i, header: 'server' },
        { type: 'os', name: 'Ubuntu', pattern: /ubuntu/i, header: 'server' },
        { type: 'os', name: 'CentOS', pattern: /centos/i, header: 'server' },
        { type: 'os', name: 'Debian', pattern: /debian/i, header: 'server' },
        { type: 'framework', name: 'Spring', pattern: /([a-zA-Z0-9.\-]+):([a-zA-Z0-9\-]+):(\d+)/i, header: 'x-application-context', value: 'app,env,port', extType: 'technology', extName: 'Java' },
        { type: 'framework', name: 'JFinal', pattern: /jfinal\s?\/?([\d\.]+)?/i, header: 'server', value: 'version', extType: 'technology', extName: 'Java' },
        { type: 'framework', name: 'ASP.NET', pattern: /[0-9.]+/i, header: 'x-aspnet-version', value: 'version' },
        { type: 'framework', name: 'ASP.NET', pattern: /asp\.net/i, header: 'x-powered-by' },
        { type: 'framework', name: 'ASP.NET MVC', pattern: /[0-9.]+/i, header: 'x-aspnetmvc-version', value: 'version' },
        { type: 'framework', name: 'Express', pattern: /express/i, header: 'x-powered-by', extType: 'technology', extName: 'Node.js' },
        { type: 'framework', name: 'ThinkPHP', pattern: /thinkphp\/?([\d\.]+)?/i, header: 'x-powered-by', value: 'version', extType: 'technology', extName: 'PHP' },
        { type: 'framework', name: 'Laravel', pattern: /laravel/i, header: 'x-powered-by', extType: 'technology', extName: 'PHP' },
        { type: 'technology', name: 'PHP', pattern: /php\/?([\d\.]+)?/i, header: 'x-powered-by', value: 'version' },
        { type: 'technology', name: 'PHP', pattern: /PHPSESSID/i, header: 'set-cookie' },
        { type: 'technology', name: 'Java', pattern: /java/i, header: 'x-powered-by' },
        { type: 'technology', name: 'Java', pattern: /JSESSIONID|jeesite/i, header: 'set-cookie' },
        { type: 'technology', name: 'Python', pattern: /python\/?([\d\.]+)?/i, header: 'server', value: 'version' },
        { type: 'technology', name: 'Node.js', pattern: /node/i, header: 'x-powered-by' },
        { type: 'technology', name: 'Ruby', pattern: /ruby|rails/i, header: 'x-powered-by' },
        { type: 'security', name: '安全狗', pattern: /waf\/?([\d\.]+)?$/i, header: 'x-powered-by', value: 'version' },
        { type: 'security', name: 'Janusec', pattern: /janusec/i, header: 'x-powered-by' },
        { type: 'security', name: '360防火墙', pattern: /360/i, header: 'x-safe-firewall' },
        { type: 'security', name: 'HSTS', pattern: /max-age=(\d+)/i, header: 'strict-transport-security', value: 'time' },
        { type: 'security', name: 'CSP', pattern: /.+/i, header: 'content-security-policy' },
        { type: 'panel', name: 'Plesk', pattern: /plesk/i, header: 'x-powered-by' },
        { type: 'panel', name: '宝塔', pattern: /bt-panel|baota/i, header: 'server' },
        { type: 'panel', name: 'phpMyAdmin', pattern: /phpmyadmin/i, header: 'set-cookie' }
    ],

    COOKIE_RULES: [
        { type: 'technology', name: 'PHP', match: /PHPSESSID/i },
        { type: 'framework', name: 'ASP.NET', match: /ASP\.NET_SessionId|ASPSESSIONID/i },
        { type: 'technology', name: 'Java', match: /JSESSIONID|jeesite/i },
        { type: 'framework', name: 'ThinkPHP', match: /think_php/i },
        { type: 'technology', name: 'Ruby', match: /_session_id/i }
    ],

    ANALYTICS: {
        baidu: { pattern: '*://hm.baidu.com/hm.js*', name: '百度统计' },
        google: { pattern: '*://www.google-analytics.com/*', name: 'Google Analytics' },
        cnzz: { pattern: '*://*.cnzz.com/*', name: 'CNZZ统计' },
        umeng: { pattern: '*://*.umeng.com/*', name: '友盟统计' },
        matomo: { pattern: '*://*/matomo.js*', name: 'Matomo统计' }
    },

    desc(type) { return FINGERPRINT_DESC[type] || type; },

    processHeaders(responseHeaders, tabId) {
        const fp = this.get(tabId);
        const map = new Map((responseHeaders || []).map(h => [h.name.toLowerCase(), h.value || '']));
        for (const rule of this.HEADER_RULES) {
            if (!rule.header) continue;
            const val = map.get(rule.header.toLowerCase());
            if (!val) continue;
            const m = val.match(rule.pattern);
            if (!m || fp.nameMap.has(rule.name)) continue;
            const item = { ...rule };
            item.description = `通过 ${rule.header} 识别到 ${rule.name} ${this.desc(rule.type)}`;
            // 扩展指纹（如 Java、Windows、CDN）
            if (rule.extType && rule.extName && !fp.nameMap.has(rule.extName)) {
                fp[rule.extType].push({ type: rule.extType, name: rule.extName, header: rule.header,
                    description: `通过 ${rule.header} 识别到 ${rule.extName} ${this.desc(rule.extType)}` });
                fp.nameMap.add(rule.extName);
            }
            if (rule.value) {
                const parts = rule.value.split(',');
                if (m.length > 1) parts.forEach((p, i) => { item[p] = m[i + 1] || null; });
                else item[rule.value] = m[0] || null;
            }
            delete item.pattern;
            fp[rule.type].push(item);
            fp.nameMap.add(rule.name);
        }
    },

    identifyFromCookie(cookieNamesStr, tabId) {
        const fp = this.get(tabId);
        for (const r of this.COOKIE_RULES) {
            if (r.match.test(cookieNamesStr) && !fp.nameMap.has(r.name)) {
                fp[r.type].push({ type: r.type, name: r.name,
                    description: `通过 Cookie 识别到 ${r.name} ${this.desc(r.type)}` });
                fp.nameMap.add(r.name);
            }
        }
    },

    handleAnalytics(url, tabId) {
        for (const [key, info] of Object.entries(this.ANALYTICS)) {
            const re = new RegExp(info.pattern.replace(/\*/g, '.*'));
            if (re.test(url)) {
                if (this.analyticsSeen[key].has(tabId)) return;
                this.analyticsSeen[key].set(tabId, true);
                const fp = this.get(tabId);
                fp.analytics.push({ type: 'analytics', name: info.name,
                    description: `通过网络请求识别到 ${info.name}，用户访问数据会被记录` });
                return;
            }
        }
    },

    // content 在页面中识别到的构建工具/CDN/框架指纹（如 webpack chunk、cdnjs）
    updateBuilder(tabId, finger) {
        const fp = this.get(tabId);
        if (fp.nameMap.has(finger.name)) return;
        fp[finger.type] = fp[finger.type] || [];
        fp[finger.type].push(finger);
        fp.nameMap.add(finger.name);
    },

    serialize(tabId) {
        const fp = this.get(tabId);
        const out = {};
        for (const k of ['server', 'component', 'technology', 'security', 'analytics',
            'builder', 'framework', 'os', 'panel', 'cdn']) {
            out[k] = fp[k] || [];
        }
        return out;
    },

    clear(tabId) {
        this.store.delete(tabId);
        for (const k of Object.keys(this.analyticsSeen)) this.analyticsSeen[k].delete(tabId);
    }
};

/* =====================================================================
 * 3. JS 抓取器：主fetch + 标签页注入回退（绕过跨域/CSP）
 * ===================================================================== */
const JsFetcher = {
    async fetch(url) {
        // 方案一：SW 直接 fetch
        try {
            const res = await fetch(url, {
                headers: { 'Accept': '*/*', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36' },
                credentials: 'omit'
            });
            if (res.ok) return await res.text();
        } catch (e) { /* 落入回退方案 */ }
        return null;
    },
    async fetchViaTab(tabId, url) {
        try {
            const [res] = await API.scripting.executeScript({
                target: { tabId },
                func: (u) => fetch(u, { credentials: 'omit' }).then(r => r.text()).catch(() => null),
                args: [url]
            });
            return res?.result ?? null;
        } catch { return null; }
    },
    async handle({ url, tabId, frameId }) {
        let content = await this.fetch(url);
        if (content === null && tabId != null) content = await this.fetchViaTab(tabId, url);
        return { content, frameId };
    }
};

/* =====================================================================
 * 4. 正则匹配器：在 background 执行（CSP安全），支持大文本分块
 * ===================================================================== */
const RegexMatcher = {
    MAX_ITER: 100000,
    perform(text, patternStrs, typeName) {
        const matches = [];
        for (const ps of patternStrs) {
            let re;
            try {
                const m = ps.match(/^\/(.+)\/([gimuy]*)$/);
                if (!m) continue;
                re = new RegExp(m[1], m[2]);
            } catch { continue; }
            let last = -1, iter = this.MAX_ITER, m;
            while ((m = re.exec(text)) !== null) {
                matches.push({ match: m[0] });
                if (--iter <= 0) { console.warn('[LatentEye] 超过最大迭代:', typeName); break; }
                if (!re.global) break;
                // 零宽匹配防护：lastIndex 未推进则手动 +1，避免死循环且不丢失后续匹配
                if (re.lastIndex === last || re.lastIndex <= m.index) {
                    re.lastIndex = m.index + 1;
                }
                last = re.lastIndex;
            }
        }
        return matches;
    }
};

/* =====================================================================
 * 5. Hook 脚本注册表：动态注册 hooks/*.js 到主世界(document_start)
 *    支持标准模式(按域名) / 全局模式(<all_urls>)
 * ===================================================================== */
const HookRegistry = {
    registry: new Map(), // `${prefix}|${hookId}` -> 注册ID
    MODE_KEY: 'le_mode',
    GLOBAL_KEY: 'le_global_hooks',
    initialized: false,

    async init() {
        if (this.initialized) return;
        try {
            const registered = await API.scripting.getRegisteredContentScripts();
            const ours = registered.filter(s => s.id.startsWith('le_'));
            if (ours.length) await API.scripting.unregisterContentScripts({ ids: ours.map(s => s.id) });
        } catch (e) { console.error('[LatentEye] HookRegistry init:', e); }
        this.initialized = true;
    },

    async clearMode(isGlobal) {
        const toRemove = [];
        for (const key of this.registry.keys()) {
            if (isGlobal ? key.startsWith('global|') : (!key.startsWith('global|') && key.includes('|'))) {
                toRemove.push(key);
            }
        }
        if (toRemove.length) {
            try { await API.scripting.unregisterContentScripts({ ids: toRemove.map(k => this.registry.get(k)) }); }
            catch (e) { if (!/Nonexistent/.test(e.message)) console.error(e); }
            toRemove.forEach(k => this.registry.delete(k));
        }
    },

    async sync(hostname, hookIds, isGlobal) {
        if (!isGlobal && (!hostname || !hostname.includes('.'))) return;
        const prefix = isGlobal ? 'global' : hostname;
        const valid = (hookIds || []).filter(id => typeof id === 'string' && id.trim());
        const want = new Set(valid.map(id => `${prefix}|${id}`));

        // 注销不再需要的
        const toRemove = [];
        for (const [key] of this.registry) {
            if (key.startsWith(`${prefix}|`) && !want.has(key)) toRemove.push(key);
        }
        if (toRemove.length) {
            try { await API.scripting.unregisterContentScripts({ ids: toRemove.map(k => this.registry.get(k)) }); }
            catch (e) { if (!/Nonexistent/.test(e.message)) console.error(e); }
            toRemove.forEach(k => this.registry.delete(k));
        }

        // 注册新增的
        const toAdd = [];
        for (const id of valid) {
            const key = `${prefix}|${id}`;
            if (this.registry.has(key)) continue;
            const regId = genId();
            this.registry.set(key, regId);
            toAdd.push({
                id: regId,
                js: [`hooks/${id}.js`],
                matches: isGlobal ? ['<all_urls>'] : [`*://${hostname}/*`],
                runAt: 'document_start',
                world: 'MAIN'
            });
        }
        if (toAdd.length) {
            try { await API.scripting.registerContentScripts(toAdd); }
            catch (e) { console.error('[LatentEye] register hooks failed:', e); }
        }
    }
};

/* =====================================================================
 * 6. webRequest 观测器：记录每标签页/每frame的JS文件 + 头指纹 + 统计
 * ===================================================================== */
const WebRequestObserver = {
    tabJs: {}, // tabId -> { frameId -> Set<jsUrl> }

    init() {
        API.webNavigation.onCommitted.addListener(({ tabId, frameId }) => {
            if (frameId === 0 && this.tabJs[tabId]) this.tabJs[tabId].clear?.();
        });
        API.webRequest.onBeforeRequest.addListener((d) => {
            const { tabId, url, type, frameId } = d;
            if (tabId < 0) return;
            let isJs = type === 'script';
            if (!isJs) { try { isJs = /\.(?:js|mjs|jsx|ts|tsx)(\?|$)/i.test(new URL(url).pathname); } catch {} }
            if (!isJs) return;
            FingerprintEngine.handleAnalytics(url, tabId);
            try {
                const ini = new URL(d.initiator || '');
                const tgt = new URL(url);
                if (ini.hostname !== tgt.hostname) return; // 仅跟踪同源JS（第三方库单独识别）
            } catch {}
            if (!this.tabJs[tabId]) this.tabJs[tabId] = new Map();
            const fid = String(frameId);
            if (!this.tabJs[tabId].has(fid)) this.tabJs[tabId].set(fid, new Set());
            this.tabJs[tabId].get(fid).add(url);
        }, { urls: ['<all_urls>'] });

        API.webRequest.onHeadersReceived.addListener((d) => {
            if (d.type !== 'main_frame') return;
            if (!d.responseHeaders) return;
            // 异步处理，避免阻塞请求
            setTimeout(() => {
                FingerprintEngine.processHeaders(d.responseHeaders, d.tabId);
                API.cookies.getAll({ url: d.url }, (cookies) => {
                    if (cookies && cookies.length) {
                        FingerprintEngine.identifyFromCookie(cookies.map(c => c.name).join(';'), d.tabId);
                    }
                });
            }, 0);
            return { responseHeaders: d.responseHeaders };
        }, { urls: ['<all_urls>'] }, ['responseHeaders']);

        API.tabs.onRemoved.addListener((tabId) => {
            delete this.tabJs[tabId];
            FingerprintEngine.clear(tabId);
        });
    },

    getTabJs(tabId, frameId) {
        return Array.from(this.tabJs[tabId]?.get(String(frameId)) || []);
    }
};

/* =====================================================================
 * 7. 初始化 + 消息路由
 * ===================================================================== */
API.runtime.onStartup.addListener(() => HookRegistry.init());
API.runtime.onInstalled.addListener(() => HookRegistry.init());

API.storage.local.get(null, (data) => {
    HookRegistry.init().then(() => {
        const mode = data[HookRegistry.MODE_KEY] || 'standard';
        const globalHooks = data[HookRegistry.GLOBAL_KEY] || [];
        if (mode === 'global' && globalHooks.length) HookRegistry.sync('*', globalHooks, true);
        if (mode === 'standard') {
            for (const key of Object.keys(data)) {
                if (Array.isArray(data[key]) && key.includes('.')) HookRegistry.sync(key, data[key], false);
            }
        }
    });
});

// 存储变化时同步 Hook 注册
API.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const [key, { newValue }] of Object.entries(changes)) {
        if (key === HookRegistry.MODE_KEY) continue;
        if (key === HookRegistry.GLOBAL_KEY && Array.isArray(newValue)) {
            HookRegistry.sync('*', newValue, true);
            continue;
        }
        if (Array.isArray(newValue) && key.includes('.')) HookRegistry.sync(key, newValue, false);
    }
});

BadgeManager.init();
WebRequestObserver.init();

API.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.to && msg.to !== 'background') return true;
    const tabId = sender.tab?.id ?? msg.tabId;
    const frameId = String(sender.frameId ?? msg.frameId ?? '0');
    try {
        switch (msg.type) {
            case 'GET_TAB_ID':
                sendResponse({ tabId: sender.tab?.id ?? null }); return true;
            case 'GET_IFRAME_ID':
                sendResponse({ frameId }); return true;
            case 'REGISTER_CONTENT': {
                if (tabId != null) sendResponse({ tabJs: WebRequestObserver.getTabJs(tabId, frameId), tabId, frameId });
                else sendResponse({ tabJs: [], tabId: null, frameId });
                return true;
            }
            case 'FETCH_JS':
                JsFetcher.handle({ url: msg.url, tabId, frameId: msg.frameId }).then(r => sendResponse(r));
                return true;
            case 'REGEX_MATCH':
                sendResponse({ matches: RegexMatcher.perform(msg.chunk, msg.patterns, msg.patternType) });
                return true;
            case 'UPDATE_BADGE':
                if (tabId != null) BadgeManager.updateFromResults(msg.results, tabId);
                sendResponse({ ok: true }); return true;
            case 'GET_FINGERPRINTS':
                sendResponse(tabId != null ? FingerprintEngine.serialize(tabId) : {});
                return true;
            case 'UPDATE_BUILDER':
                if (tabId != null) FingerprintEngine.updateBuilder(tabId, msg.finger);
                sendResponse({ ok: true }); return true;
            case 'update_hooks_registration':
                HookRegistry.sync(msg.isGlobal ? '*' : msg.hostname, msg.enabledHooks, !!msg.isGlobal);
                sendResponse({ ok: true }); return true;
            case 'clear_mode_hooks':
                HookRegistry.clearMode(!!msg.clearGlobal);
                sendResponse({ ok: true }); return true;
            case 'VUE_ROUTER_DATA':
            case 'REACT_ROUTER_DATA': {
                if (sender.tab) {
                    const hn = safeHostname(sender.tab.url);
                    API.storage.local.set({ [`${hn}_${msg.type.toLowerCase()}`]: { data: msg.data, ts: Date.now() } });
                    API.runtime.sendMessage({ type: msg.type + '_UPDATE', hostname: hn, data: msg.data }).catch(() => {});
                }
                sendResponse({ ok: true }); return true;
            }
            case 'HEIMDALLR_GET_CFG':
                sendResponse({ cfg: HeimdallrModule.getCfg(), stats: HeimdallrModule.getStats() });
                return true;
            case 'HEIMDALLR_SET_OPTION':
                HeimdallrModule.setOption(msg.key, !!msg.enabled).then(() => sendResponse({ ok: true }));
                return true;
            case 'HEIMDALLR_GET_RESULTS':
                sendResponse({ results: HeimdallrModule.getResults(msg.tabId || tabId) });
                return true;
            case 'HEIMDALLR_MATCH_BODY':
                HeimdallrModule.matchBody(tabId, msg.url, msg.bodyUrl, msg.body);
                sendResponse({ ok: true });
                return true;
            default:
                sendResponse(null); return true;
        }
    } catch (e) {
        console.error('[LatentEye] bg message error:', e);
        sendResponse(null);
        return true;
    }
});

// 标签页 URL 变化时刷新徽章 + 清理旧路由数据
API.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (info.status === 'complete') BadgeManager.refresh(tabId);
    if (info.status === 'loading' && tab.url) {
        const hn = safeHostname(tab.url);
        if (hn) API.storage.local.remove([`${hn}_vue_router_data`, `${hn}_react_router_data`]).catch(() => {});
    }
});

/* =====================================================================
 * 7. Heimdallr 模块（整合自 Heimdallr by Ghroth）
 *    反蜜罐检测 / 特征对抗 / 指纹规则识别
 *    文档：https://github.com/graynjo/Heimdallr
 * ===================================================================== */
const HeimdallrModule = {
    STORAGE_KEY: 'le_heimdallr_cfg',     // 配置存储键
    RESULT_KEY: 'le_heimdallr_results',  // 按标签页存储命中结果
    cfg: { blockHoneypot: false, noPageCache: false, jsonpAlert: true, pluginStart: true },
    results: {},  // { tabId: { host, items: [{type, msg, url, ts}], jsonpCount } }
    initialized: false,

    init() {
        if (this.initialized) return;
        // 读取配置
        API.storage.local.get([this.STORAGE_KEY], (d) => {
            const saved = d[this.STORAGE_KEY];
            if (saved) Object.assign(this.cfg, saved);
            this.applyAll();
            this.initialized = true;
            console.log('[Heimdallr] init', this.cfg);
        });
        // 监听标签页关闭：清理结果
        API.tabs.onRemoved.addListener((tabId) => {
            if (this.results[tabId]) delete this.results[tabId];
        });
        // 监听标签页 URL 变更：清空该标签页结果（host 变了）
        API.tabs.onUpdated.addListener((tabId, info, tab) => {
            if (info.status === 'loading' && tab.url) {
                if (this.results[tabId]) {
                    this.results[tabId] = { host: safeHostname(tab.url), items: [], jsonpCount: 0 };
                    this.broadcast(tabId);
                }
            }
        });
    },

    // 应用所有配置（开关变更后调用）
    async applyAll() {
        // 蜜罐域名拦截
        await this.applyBlockHoneypot();
        // 页面缓存禁用
        await this.applyNoPageCache();
    },

    // 蜜罐域名拦截：通过 declarativeNetRequest 动态规则
    async applyBlockHoneypot() {
        if (!this.cfg.pluginStart || !this.cfg.blockHoneypot) {
            // 关闭：移除所有已有规则
            try {
                const existing = await API.declarativeNetRequest.getDynamicRules();
                if (existing.length) {
                    await API.declarativeNetRequest.updateDynamicRules({
                        removeRuleIds: existing.map(r => r.id)
                    });
                    console.log('[Heimdallr] 移除蜜罐拦截规则', existing.length);
                }
            } catch (e) { console.error('[Heimdallr] removeBlockRules:', e); }
            return;
        }
        // 开启：添加规则
        try {
            const existing = await API.declarativeNetRequest.getDynamicRules();
            if (existing.length) {
                await API.declarativeNetRequest.updateDynamicRules({
                    removeRuleIds: existing.map(r => r.id)
                });
            }
            const rules = (typeof self !== 'undefined' && self.HBlockingDomainRules) || [];
            if (rules.length) {
                await API.declarativeNetRequest.updateDynamicRules({
                    addRules: rules,
                    removeRuleIds: []
                });
                console.log('[Heimdallr] 添加蜜罐拦截规则', rules.length);
            }
        } catch (e) { console.error('[Heimdallr] addBlockRules:', e); }
    },

    // 页面缓存禁用：清缓存 + 后续请求加载时清
    async applyNoPageCache() {
        if (!this.cfg.pluginStart || !this.cfg.noPageCache) return;
        try {
            await new Promise(r => API.browsingData.removeCache({ since: Date.now() - 3600000 }, r));
            console.log('[Heimdallr] 已清除页面缓存');
        } catch (e) { console.error('[Heimdallr] clearCache:', e); }
    },

    // 设置单个开关
    async setOption(key, enabled) {
        this.cfg[key] = !!enabled;
        API.storage.local.set({ [this.STORAGE_KEY]: this.cfg });
        // 立即应用
        if (key === 'blockHoneypot') await this.applyBlockHoneypot();
        if (key === 'noPageCache') await this.applyNoPageCache();
        console.log('[Heimdallr] option', key, '=', enabled);
    },

    // 添加命中结果
    addHit(tabId, host, rule) {
        if (tabId == null) return;
        if (!this.results[tabId] || this.results[tabId].host !== host) {
            this.results[tabId] = { host, items: [], jsonpCount: 0 };
        }
        const r = this.results[tabId];
        // 去重
        if (r.items.some(it => it.msg === rule.commandments)) return;
        r.items.push({
            type: rule.type,
            msg: rule.commandments,
            rulename: rule.rulename,
            ts: Date.now()
        });
        // JSONP 计数（type=4）
        if (rule.type === 4) r.jsonpCount++;
        this.broadcast(tabId);
        // 蜜罐告警通知：JSONP 命中 > 10
        if (this.cfg.jsonpAlert && r.jsonpCount === 10) {
            this.notifyHoneypot(tabId, host, r.jsonpCount);
        }
    },

    // 通知蜜罐告警
    notifyHoneypot(tabId, host, count) {
        try {
            API.notifications.create('honeypot_' + tabId, {
                type: 'basic',
                iconUrl: 'icons/icon128.png',
                title: 'HAPPY JS · 蜜罐告警',
                message: `检测到 ${count} 个 JSONP 蜜罐特征请求\n主机：${host}\n该站点有较大可能为蜜罐`
            });
        } catch (e) { console.error('[Heimdallr] notify:', e); }
    },

    // 广播结果变更
    broadcast(tabId) {
        API.runtime.sendMessage({
            type: 'HEIMDALLR_UPDATE',
            tabId,
            results: this.results[tabId] || null
        }).catch(() => {});
    },

    // 规则匹配（请求 URL / 请求头 / 请求体）
    matchRequest(tabId, url, reqHeaders, reqBody) {
        if (!this.cfg.pluginStart) return;
        const host = safeHostname(url);
        const H = (typeof self !== 'undefined' && self.HPrinter) || { position1: [], position2: [], position3: [] };

        // position1: 请求 URL
        for (const rule of H.position1) {
            try {
                if (rule.rulecontent instanceof RegExp) {
                    if (rule.rulecontent.test(url)) this.addHit(tabId, host, rule);
                }
            } catch {}
        }
        // position2: 请求头
        if (reqHeaders && Array.isArray(reqHeaders)) {
            const headerMap = {};
            reqHeaders.forEach(h => { headerMap[h.name] = h.value; });
            for (const rule of H.position2) {
                try {
                    const name = rule.rulecontent.name;
                    const valRe = rule.rulecontent.value;
                    if (headerMap[name] && valRe.test(headerMap[name])) {
                        this.addHit(tabId, host, rule);
                    }
                } catch {}
            }
        }
        // position3: 请求体
        if (reqBody && typeof reqBody === 'string') {
            for (const rule of H.position3) {
                try {
                    if (rule.rulecontent instanceof RegExp && rule.rulecontent.test(reqBody)) {
                        this.addHit(tabId, host, rule);
                    }
                } catch {}
            }
        }
    },

    // 规则匹配（响应头 position4）
    matchResponseHeaders(tabId, url, respHeaders) {
        if (!this.cfg.pluginStart) return;
        const host = safeHostname(url);
        const H = (typeof self !== 'undefined' && self.HPrinter) || { position4: [] };
        if (!respHeaders || !Array.isArray(respHeaders)) return;
        const headerMap = {};
        respHeaders.forEach(h => { headerMap[h.name] = h.value; });
        for (const rule of H.position4) {
            try {
                const name = rule.rulecontent.name;
                const valRe = rule.rulecontent.value;
                if (headerMap[name] && valRe.test(headerMap[name])) {
                    this.addHit(tabId, host, rule);
                }
            } catch {}
        }
    },

    // 规则匹配（响应体 position5）
    // body: 响应体文本（来自 content.js 页面 HTML 或 hook_response_body AJAX 响应）
    matchBody(tabId, pageUrl, bodyUrl, body) {
        if (!this.cfg.pluginStart || !body) return;
        const host = safeHostname(pageUrl);
        const H = (typeof self !== 'undefined' && self.HPrinter) || { position5: [] };
        for (const rule of H.position5) {
            try {
                if (rule.rulecontent instanceof RegExp) {
                    if (rule.rulecontent.test(body)) {
                        this.addHit(tabId, host, rule);
                    }
                }
            } catch {}
        }
    },

    // 获取标签页结果
    getResults(tabId) {
        return this.results[tabId] || { host: '', items: [], jsonpCount: 0 };
    },

    // 获取规则统计
    getStats() {
        return (typeof self !== 'undefined' && self.HStats) || { total: 0, fingerprint: 0, keyword: 0, blockUrl: 0, blockJsonp: 0, alert: 0, blockingRules: 0 };
    },

    // 获取配置
    getCfg() { return { ...this.cfg }; }
};

// 注册 webRequest 监听器（Heimdallr 规则匹配）
API.webRequest.onBeforeRequest.addListener(
    (d) => {
        if (!HeimdallrModule.cfg.pluginStart) return;
        const { tabId, url, type, requestBody } = d;
        if (type === 'main_frame' || type === 'sub_frame' || type === 'script' || type === 'xmlhttprequest' || type === 'image' || type === 'other') {
            let bodyStr = null;
            if (requestBody) {
                if (requestBody.formData) {
                    bodyStr = JSON.stringify(requestBody.formData);
                } else if (requestBody.raw && requestBody.raw.length === 1 && requestBody.raw[0].bytes) {
                    try {
                        bodyStr = new TextDecoder().decode(new Uint8Array(requestBody.raw[0].bytes));
                    } catch {}
                }
            }
            HeimdallrModule.matchRequest(tabId, url, null, bodyStr);
        }
    },
    { urls: ['http://*/*', 'https://*/*'] },
    ['requestBody', 'extraHeaders']
);

API.webRequest.onBeforeSendHeaders.addListener(
    (d) => {
        if (!HeimdallrModule.cfg.pluginStart) return;
        const { tabId, url, type, requestHeaders } = d;
        if (type === 'main_frame' || type === 'sub_frame' || type === 'script' || type === 'xmlhttprequest' || type === 'other') {
            HeimdallrModule.matchRequest(tabId, url, requestHeaders, null);
        }
    },
    { urls: ['http://*/*', 'https://*/*'] },
    ['requestHeaders', 'extraHeaders']
);

// 响应头监听（position4 规则匹配）
API.webRequest.onHeadersReceived.addListener(
    (d) => {
        if (!HeimdallrModule.cfg.pluginStart) return;
        const { tabId, url, type, responseHeaders } = d;
        if (type === 'main_frame' || type === 'sub_frame' || type === 'script' || type === 'xmlhttprequest' || type === 'other') {
            HeimdallrModule.matchResponseHeaders(tabId, url, responseHeaders);
        }
    },
    { urls: ['http://*/*', 'https://*/*'] },
    ['responseHeaders', 'extraHeaders']
);

// 标签页加载完成时清缓存（若开启）
API.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (info.status === 'loading' && HeimdallrModule.cfg.pluginStart && HeimdallrModule.cfg.noPageCache) {
        API.browsingData.removeCache({ since: Date.now() - 3600000 }, () => {});
    }
});

HeimdallrModule.init();
