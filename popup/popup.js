/* HAPPY JS — popup 逻辑 */
'use strict';
const API = (typeof browser !== 'undefined') ? browser : chrome;

const MODE_KEY = 'le_mode';
const GLOBAL_KEY = 'le_global_hooks';
const THEME_KEY = 'le_theme';

/* ====================== 主题切换 ====================== */
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const icon = document.getElementById('theme-icon');
    if (icon) {
        // 浅色显示月亮（点击切深色），深色显示太阳（点击切浅色）
        icon.innerHTML = theme === 'dark'
            ? '<path fill="currentColor" d="M6.76 4.84l-1.8-1.79-1.41 1.41 1.79 1.79 1.42-1.41zM4 10.5H1v2h3v-2zm9-9.95h-2V3.5h2V.55zm7.45 3.91l-1.41-1.41-1.79 1.79 1.41 1.41 1.79-1.79zm-3.21 13.7l1.79 1.8 1.41-1.41-1.8-1.79-1.4 1.4zM20 10.5v2h3v-2h-3zm-8-5c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm-1 16.95h2V19.5h-2v2.95zm-7.45-3.91l1.41 1.41 1.79-1.8-1.41-1.41-1.79 1.8z"/>'
            : '<path fill="currentColor" d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"/>';
    }
}
function initTheme() {
    API.storage.local.get([THEME_KEY], (d) => {
        applyTheme(d[THEME_KEY] || 'light');
    });
    const btn = document.getElementById('theme-btn');
    if (btn) {
        btn.onclick = () => {
            const cur = document.documentElement.getAttribute('data-theme') || 'light';
            const next = cur === 'dark' ? 'light' : 'dark';
            applyTheme(next);
            API.storage.local.set({ [THEME_KEY]: next });
        };
    }
}

const State = {
    tabId: null, hostname: '', currentTab: null,
    page: 'scanner',
    frameResults: {}, currentFrame: '0',
    allHooks: [], enabledHooks: [], isGlobal: false,
    hookSub: 'antidebug', routeSub: 'vue',
    vueRoutes: null, reactRoutes: null,
    scannerSearch: ''
};

/* ====================== 工具 ====================== */
const $ = (s, p = document) => p.querySelector(s);
const $$ = (s, p = document) => Array.from(p.querySelectorAll(s));
function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 1500);
}
async function getTab() {
    const tabs = await API.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
}
function sendBg(type, payload = {}) {
    return new Promise(r => API.runtime.sendMessage({ ...payload, type, to: 'background' }, r));
}
function sendTab(type, payload = {}) {
    if (!State.tabId) return Promise.resolve();
    return new Promise(r => API.tabs.sendMessage(State.tabId, { ...payload, type }, r));
}

/* ====================== 导航 ====================== */
$$('.nav-btn').forEach(btn => btn.addEventListener('click', () => switchPage(btn.dataset.page)));
function switchPage(page) {
    State.page = page;
    $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === page));
    $$('.page').forEach(p => p.classList.toggle('active', p.dataset.page === page));
    if (page === 'finger') renderFingerprints();
    if (page === 'hooks') renderHooks();
    if (page === 'routes') {
        renderRoutes();
        // 进入路由页时主动触发一次重扫（SPA 可能已变更）
        if (State.tabId) {
            sendTab('GET_RESULTS').catch(() => {});
        }
    }
    if (page === 'guard') initGuardPage();
}

/* ====================== 扫描结果页 ====================== */
const SECTION_DEFS = [
    ['domains', '域名'], ['routes', '页面路由'], ['absoluteApis', 'API(绝对路径)', true],
    ['apis', 'API(相对路径)', true], ['moduleFiles', '模块路径'], ['docFiles', '文档文件'],
    ['credentials', '用户名密码'], ['cookies', 'Cookie'], ['idKeys', 'ID密钥'],
    ['privateKeys', '私钥/证书'], ['dbConns', '数据库连接'], ['mqConns', '消息队列'], ['ossEndpoints', '对象存储'],
    ['phones', '手机号'], ['emails', '邮箱'], ['idcards', '身份证号'], ['ips', 'IP地址'],
    ['jwts', 'JWT Token'], ['companies', '公司机构'], ['windowsPaths', 'Windows路径'], ['linuxPaths', 'Linux路径'],
    ['sourceMaps', 'SourceMap'], ['githubUrls', 'GitHub链接'], ['vueFiles', 'Vue文件'], ['jsFiles', 'JS文件'],
    ['thirdPartyLibs', 'JS库'], ['imageFiles', '图片音频'], ['iframes', 'Iframe'], ['urls', 'URL'],
    ['fingers', '页面指纹']
];

API.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SCAN_UPDATE' && msg.tabId === State.tabId) onScanUpdate(msg);
    if (msg.type === 'VUE_ROUTER_DATA_UPDATE' && msg.hostname === State.hostname) { State.vueRoutes = msg.data; if (State.page === 'routes') renderRoutes(); }
    if (msg.type === 'REACT_ROUTER_DATA_UPDATE' && msg.hostname === State.hostname) { State.reactRoutes = msg.data; if (State.page === 'routes') renderRoutes(); }
});

function onScanUpdate(msg) {
    State.frameResults[msg.frameId] = { results: msg.results, isInIframe: msg.isInIframe, frameUrl: msg.frameUrl };
    // 进度
    const pct = msg.results.progress ?? 0;
    $('#progress-badge').textContent = pct >= 100 ? '完成' : pct + '%';
    // 帧导航
    renderFrameNav();
    if (msg.frameId === State.currentFrame) renderScanner(msg.results, msg.isInIframe);
}

function renderFrameNav() {
    const ids = Object.keys(State.frameResults);
    const nav = $('#frame-nav');
    if (ids.length <= 1) { nav.style.display = 'none'; return; }
    nav.style.display = 'flex';
    nav.innerHTML = '';
    ids.sort((a, b) => a === '0' ? -1 : b === '0' ? 1 : a.localeCompare(b)).forEach(id => {
        const r = State.frameResults[id];
        let label = '主页面';
        try { if (id !== '0' && r.frameUrl) label = new URL(r.frameUrl).hostname; } catch {}
        const el = document.createElement('div');
        el.className = 'frame-tab' + (id === State.currentFrame ? ' active' : '');
        el.textContent = label; el.title = label;
        el.onclick = () => { State.currentFrame = id; renderFrameNav(); if (r) renderScanner(r.results, r.isInIframe); };
        nav.appendChild(el);
    });
}

function renderScanner(results, isInIframe) {
    const container = $('#scanner-sections');
    // 摘要
    const summary = $('#scanner-summary');
    const chips = SECTION_DEFS.filter(([k]) => Array.isArray(results[k]) && results[k].length)
        .map(([k, n]) => `<span class="summary-chip">${n}<b>${results[k].length}</b></span>`).join('');
    summary.innerHTML = chips || '<span class="summary-chip">扫描中…</span>';

    const term = State.scannerSearch.toLowerCase();
    container.innerHTML = '';
    let any = false;
    for (const [key, name, hasUrl] of SECTION_DEFS) {
        const arr = results[key];
        if (!Array.isArray(arr) || !arr.length) continue;
        any = true;
        const sec = document.createElement('div');
        sec.className = 'section';
        sec.innerHTML = `
            <div class="section-header">
                <div><span class="section-title">${name}</span><span class="section-count">(${arr.length})</span></div>
                <div class="section-actions">
                    <button class="mini-btn copy-all" data-key="${key}">复制全部</button>
                    ${hasUrl ? `<button class="mini-btn copy-url" data-key="${key}">复制URL</button>` : ''}
                </div>
            </div>
            <div class="section-items"></div>`;
        const items = $('.section-items', sec);
        arr.forEach(([v, src]) => {
            if (term && !String(v).toLowerCase().includes(term)) return;
            const it = document.createElement('div');
            it.className = 'item';
            const isJsSrc = isJsSourceUrl(src);
            it.innerHTML = `<span class="item-val" title="点击复制">${escapeHtml(String(v))}</span>` +
                `<span class="item-src${isJsSrc ? ' item-src-link' : ''}" ` +
                `title="${isJsSrc ? '点击打开该 JS 文件' : escapeHtml(src || '')}">${escapeHtml(srcName(src))}</span>`;
            // 左侧值点击：复制
            $('.item-val', it).onclick = (e) => {
                e.stopPropagation();
                if (e.ctrlKey || e.metaKey) { API.tabs.create({ url: String(v) }).catch(() => copy(String(v))); }
                else copy(String(v));
            };
            // 右侧 JS 源点击：打开对应 JS 文件
            const srcEl = $('.item-src', it);
            if (srcEl) srcEl.onclick = (e) => {
                e.stopPropagation();
                if (src && isJsSourceUrl(src)) {
                    const jsUrl = resolveJsUrl(src);
                    if (jsUrl) { API.tabs.create({ url: jsUrl }).catch(() => copy(jsUrl)); }
                    else copy(String(src));
                } else if (src) {
                    copy(String(src));
                }
            };
            items.appendChild(it);
        });
        container.appendChild(sec);
    }
    if (!any) container.innerHTML = '<div class="no-results">未发现敏感信息</div>';

    // 绑定复制按钮
    $$('.copy-all', container).forEach(b => b.onclick = () => {
        const arr = results[b.dataset.key] || [];
        copy(arr.map(x => x[0]).join('\n'));
    });
    $$('.copy-url', container).forEach(b => {
        b.onclick = async () => {
            const arr = results[b.dataset.key] || [];
            const origin = State.currentTab?.url ? new URL(State.currentTab.url).origin : '';
            const text = arr.map(x => {
                const v = String(x[0]);
                if (v.startsWith('http')) return v;
                if (v.startsWith('/')) return origin + v;
                return v;
            }).join('\n');
            copy(text);
        };
    });
}

// 判断 src 是否为可打开的源 URL（JS/页面等，排除图片字体媒体）
function isJsSourceUrl(src) {
    if (!src || typeof src !== 'string') return false;
    if (!/^https?:\/\//i.test(src)) return false;
    // 排除图片/字体/音视频（这些不宜作为"源"在新标签打开）
    return !/\.(png|jpe?g|gif|svg|ico|woff2?|ttf|eot|mp[34]|wav|webm|css)(\?|$)/i.test(src);
}
// 把 src 解析为可访问 URL（保留原样，已是绝对 URL）
function resolveJsUrl(src) {
    if (!src) return '';
    if (/^https?:\/\//i.test(src)) return src;
    return '';
}
// 给路由页/源跳转：在源 URL 上附加 source-map 友好的查看
function openJsViewer(src) {
    if (!src) return;
    API.tabs.create({ url: src }).catch(() => copy(src));
}

function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function srcName(u) { try { return new URL(u).pathname } catch { return u || '' } }
function copy(text) { navigator.clipboard.writeText(text).then(() => toast('已复制')).catch(() => toast('复制失败')); }

$('#scanner-search').addEventListener('input', (e) => {
    State.scannerSearch = e.target.value;
    const r = State.frameResults[State.currentFrame];
    if (r) renderScanner(r.results, r.isInIframe);
});
$('#export-btn').addEventListener('click', () => {
    const all = {};
    Object.entries(State.frameResults).forEach(([fid, r]) => { all[fid] = r.results; });
    const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `happyjs_${State.hostname || 'scan'}.json`; a.click();
    URL.revokeObjectURL(url);
    toast('已导出');
});

/* ====================== 指纹页 ====================== */
async function renderFingerprints() {
    const c = $('#finger-list');
    c.innerHTML = '<div class="loading">采集中...</div>';
    const fp = await sendBg('GET_FINGERPRINTS', { tabId: State.tabId });
    if (!fp) { c.innerHTML = '<div class="loading">点击页面后刷新以采集指纹</div>'; return; }
    const groups = { server: '服务器', component: '组件', technology: '语言/技术', framework: '框架', os: '操作系统', security: '安全/WAF', cdn: 'CDN', analytics: '统计分析', builder: '构建工具', panel: '面板' };
    let any = false;
    c.innerHTML = '';
    for (const [type, label] of Object.entries(groups)) {
        const items = fp[type] || [];
        if (!items.length) continue;
        any = true;
        const g = document.createElement('div');
        g.className = 'finger-group';
        g.innerHTML = `<h3><span class="finger-tag">${label}</span> ${items.length} 项</h3>`;
        items.forEach(it => {
            const d = document.createElement('div');
            d.className = 'finger-item';
            d.innerHTML = `<div class="finger-name">${escapeHtml(it.name)}</div><div class="finger-desc">${escapeHtml(it.description || '')}</div>`;
            g.appendChild(d);
        });
        c.appendChild(g);
    }
    if (!any) c.innerHTML = '<div class="loading">暂未识别到指纹</div>';
}

/* ====================== Hook 页 ====================== */
async function loadHooks() {
    if (State.allHooks.length) return;
    State.allHooks = await fetch(API.runtime.getURL('hooks.json')).then(r => r.json());
}
async function loadHookState() {
    const data = await new Promise(r => API.storage.local.get([MODE_KEY, GLOBAL_KEY, State.hostname], r));
    State.isGlobal = data[MODE_KEY] === 'global';
    State.enabledHooks = State.isGlobal ? (data[GLOBAL_KEY] || []) : (data[State.hostname] || []);
    $('#global-mode').checked = State.isGlobal;
    updateModeBadge();
}
function updateModeBadge() { $('#mode-badge').textContent = State.isGlobal ? '全局模式' : '标准模式'; }

$$('.hooks-subtabs .subtab').forEach(b => b.onclick = () => {
    $$('.hooks-subtabs .subtab').forEach(x => x.classList.remove('active'));
    b.classList.add('active'); State.hookSub = b.dataset.sub; renderHooks();
});
$('#hooks-search').addEventListener('input', () => renderHooks());

async function renderHooks() {
    await loadHooks();
    const term = $('#hooks-search').value.toLowerCase().trim();
    const list = $('#hooks-list');
    list.innerHTML = '';
    const hooks = State.allHooks.filter(h => h.category === State.hookSub && !h.hidden)
        .filter(h => !term || h.name.toLowerCase().includes(term) || h.description.toLowerCase().includes(term));
    if (!hooks.length) { list.innerHTML = '<div class="empty-state">无匹配 Hook</div>'; return; }
    for (const h of hooks) list.appendChild(await buildHookCard(h));
}

async function buildHookCard(h) {
    const enabled = State.enabledHooks.includes(h.id);
    const cfg = await new Promise(r => API.storage.local.get([`${h.id}_config`], d => r(d[`${h.id}_config`] || {})));
    const card = document.createElement('div');
    card.className = 'hook-card' + (enabled ? ' enabled' : '');

    const isFixed = h.fixed_variate === 1;
    const hasParam = h.has_Param === 1;
    const dynSwitches = Object.keys(h).filter(k => !['id', 'name', 'description', 'category', 'fixed_variate', 'has_Param', 'value'].includes(k) && h[k] === 1);

    let controls = '';
    if (isFixed) {
        controls += `<div class="hook-input-row"><label>固定值</label><input class="hook-value" value="${escapeHtml(cfg.value ?? h.value ?? '')}" placeholder="按Enter保存"></div>`;
    }
    if (hasParam) {
        const kwEnabled = cfg.keyword_filter_enabled === true;
        const kws = (cfg.param || []).map((k, i) => `<span class="keyword-tag">${escapeHtml(k)}<span data-i="${i}">×</span></span>`).join('');
        controls += `<div class="hook-controls"><label class="toggle"><input type="checkbox" class="kw-toggle" ${kwEnabled ? 'checked' : ''}><span class="slider"></span></label><span style="font-size:10px;color:var(--text-mute)">关键字过滤</span></div>`;
        controls += `<div class="keyword-wrap">${kws}<input class="kw-input" placeholder="关键字(回车添加)" style="flex:1;min-width:80px;padding:3px 6px;border-radius:4px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:11px"></div>`;
    }
    if (dynSwitches.length) {
        controls += `<div class="hook-controls">${dynSwitches.map(k => `<button class="hook-switch-btn ${cfg[k] === 1 ? 'active' : ''}" data-sw="${k}">${k}</button>`).join('')}</div>`;
    }

    card.innerHTML = `
        <div class="hook-head">
            <div><div class="hook-name">${escapeHtml(h.name)}</div></div>
            <label class="toggle"><input type="checkbox" class="hook-main" ${enabled ? 'checked' : ''}><span class="slider"></span></label>
        </div>
        <div class="hook-desc">${escapeHtml(h.description)}</div>
        ${controls}`;

    // 主开关
    $('.hook-main', card).onchange = (e) => onHookToggle(h.id, e.target.checked, card);
    // 固定值
    const vInput = $('.hook-value', card);
    if (vInput) vInput.onkeypress = (e) => { if (e.key === 'Enter') { saveHookCfg(h.id, c => { c.value = e.target.value; }); toast('已保存'); } };
    // 关键字开关
    const kwTog = $('.kw-toggle', card);
    if (kwTog) kwTog.onchange = (e) => saveHookCfg(h.id, c => {
        c.keyword_filter_enabled = e.target.checked;
        c.flag = e.target.checked && (c.param || []).length ? 1 : 0;
    });
    // 关键字添加
    const kwIn = $('.kw-input', card);
    if (kwIn) kwIn.onkeypress = (e) => {
        if (e.key === 'Enter' && e.target.value.trim()) {
            saveHookCfg(h.id, c => {
                c.param = c.param || [];
                if (!c.param.includes(e.target.value.trim())) { c.param.push(e.target.value.trim()); c.flag = c.keyword_filter_enabled ? 1 : 0; }
            });
            e.target.value = ''; renderHooks();
        }
    };
    // 关键字删除
    $$('.keyword-tag span', card).forEach(s => s.onclick = () => {
        const i = parseInt(s.dataset.i);
        saveHookCfg(h.id, c => { c.param = c.param || []; c.param.splice(i, 1); c.flag = c.keyword_filter_enabled && c.param.length ? 1 : 0; });
        renderHooks();
    });
    // 动态开关
    $$('.hook-switch-btn', card).forEach(b => b.onclick = () => {
        if (!State.enabledHooks.includes(h.id)) return;
        const active = b.classList.toggle('active');
        saveHookCfg(h.id, c => { c[b.dataset.sw] = active ? 1 : 0; });
    });
    // 禁用态
    if (!enabled) {
        $$('.hook-value, .kw-input, .kw-toggle, .hook-switch-btn', card).forEach(el => el.disabled = true);
    }
    return card;
}

function saveHookCfg(id, mutator) {
    return new Promise(r => {
        const key = `${id}_config`;
        API.storage.local.get([key], d => {
            const cfg = d[key] || {};
            mutator(cfg);
            API.storage.local.set({ [key]: cfg }, r);
        });
    });
}

async function onHookToggle(id, on, card) {
    if (on) { if (!State.enabledHooks.includes(id)) State.enabledHooks.push(id); card.classList.add('enabled'); }
    else { State.enabledHooks = State.enabledHooks.filter(x => x !== id); card.classList.remove('enabled'); }
    await persistHooks();
    renderHooks();
}

function persistHooks() {
    const key = State.isGlobal ? GLOBAL_KEY : State.hostname;
    return new Promise(r => {
        API.storage.local.set({ [key]: [...State.enabledHooks] }, () => {
            sendBg('update_hooks_registration', { hostname: State.isGlobal ? '*' : State.hostname, enabledHooks: State.enabledHooks, isGlobal: State.isGlobal });
            // 通知 content 更新本地状态
            sendTab('scripts_updated', { hostname: State.hostname, enabledScripts: State.enabledHooks }).catch(() => {});
            r();
        });
    });
}

/* ====================== 路由页 ====================== */
$$('.routes-subtabs .subtab').forEach(b => b.onclick = () => {
    $$('.routes-subtabs .subtab').forEach(x => x.classList.remove('active'));
    b.classList.add('active'); State.routeSub = b.dataset.routeSub; renderRoutes();
});

function renderRoutes() {
    const data = State.routeSub === 'vue' ? State.vueRoutes : State.reactRoutes;
    const info = $('#routes-info');
    const list = $('#routes-list');
    const actions = $('#routes-actions');
    if (!data) {
        info.textContent = `等待检测 ${State.routeSub === 'vue' ? 'Vue' : 'React'} 路由（请在 Hook 页确认已开启对应能力并刷新页面）`;
        list.innerHTML = ''; actions.style.display = 'none'; return;
    }
    const routes = data.routes || [];
    if (!routes.length) {
        info.textContent = `未检测到 ${State.routeSub === 'vue' ? 'Vue' : 'React'} 路由`;
        list.innerHTML = ''; actions.style.display = 'none'; return;
    }
    info.innerHTML = `检测到 <b style="color:var(--accent)">${routes.length}</b> 条路由${data.version ? `（${data.version}）` : ''}`;
    actions.style.display = 'flex';
    list.innerHTML = '';
    const origin = State.currentTab?.url ? new URL(State.currentTab.url).origin : location.origin;
    routes.forEach(r => {
        const path = r.startsWith('/') ? r : '/' + r;
        const full = (data.routerMode === 'hash') ? `${origin}/#${path}` : `${origin}${path}`;
        const el = document.createElement('div');
        el.className = 'route-item';
        el.innerHTML = `<span class="route-url" title="${escapeHtml(full)}">${escapeHtml(full)}</span>
            <div class="route-actions"><button class="mini-btn r-copy">复制</button><button class="mini-btn r-open">打开</button></div>`;
        $('.r-copy', el).onclick = () => copy(full);
        $('.r-open', el).onclick = () => { if (State.tabId) API.tabs.update(State.tabId, { url: full }); };
        list.appendChild(el);
    });
    $('#copy-all-paths').onclick = () => copy(routes.map(r => r.startsWith('/') ? r : '/' + r).join('\n'));
    $('#copy-all-urls').onclick = () => copy(routes.map(r => {
        const p = r.startsWith('/') ? r : '/' + r;
        return (data.routerMode === 'hash') ? `${origin}/#${p}` : `${origin}${p}`;
    }).join('\n'));
}

/* ====================== 设置页 ====================== */
async function loadSettings() {
    const data = await new Promise(r => API.storage.local.get(['dynamicScan', 'deepScan', 'customWhitelist', MODE_KEY], r));
    $('#dynamic-scan').checked = data.dynamicScan === true;
    $('#deep-scan').checked = data.deepScan === true;
    $('#whitelist-input').value = (data.customWhitelist || []).join('\n');
    $('#global-mode').checked = data[MODE_KEY] === 'global';
}
$('#dynamic-scan').onchange = (e) => {
    API.storage.local.set({ dynamicScan: e.target.checked });
    sendTab('UPDATE_DYNAMIC_SCAN', { enabled: e.target.checked }).catch(() => {});
    toast(e.target.checked ? '已开启动态扫描' : '已关闭动态扫描');
};
$('#deep-scan').onchange = (e) => {
    API.storage.local.set({ deepScan: e.target.checked });
    sendTab('UPDATE_DEEP_SCAN', { enabled: e.target.checked }).catch(() => {});
    toast(e.target.checked ? '已开启深度扫描' : '已关闭深度扫描');
};
$('#global-mode').onchange = async (e) => {
    const wasGlobal = State.isGlobal;
    State.isGlobal = e.target.checked;
    API.storage.local.set({ [MODE_KEY]: State.isGlobal ? 'global' : 'standard' });
    sendBg('clear_mode_hooks', { clearGlobal: wasGlobal });
    // 切换数据源
    const key = State.isGlobal ? GLOBAL_KEY : State.hostname;
    const data = await new Promise(r => API.storage.local.get([key], r));
    State.enabledHooks = data[key] || [];
    updateModeBadge();
    persistHooks();
    toast(State.isGlobal ? '已切换全局模式' : '已切换标准模式');
};
$('#save-whitelist').onclick = () => {
    const wl = $('#whitelist-input').value.split('\n').map(s => s.trim()).filter(Boolean);
    API.storage.local.set({ customWhitelist: wl });
    toast('白名单已保存');
};

/* ====================== 初始化 ====================== */
async function init() {
    initTheme(); // 先应用主题，避免闪烁
    State.currentTab = await getTab();
    State.tabId = State.currentTab?.id || null;
    if (State.currentTab?.url) {
        try { State.hostname = new URL(State.currentTab.url).hostname; } catch {}
    }
    await loadHookState();
    await loadSettings();
    await initGuardPage();
    $('#mode-badge').textContent = State.isGlobal ? '全局模式' : '标准模式';

    // 请求扫描结果
    if (State.tabId && State.hostname) {
        const wl = await new Promise(r => API.storage.local.get(['customWhitelist'], r));
        const whitelisted = (wl.customWhitelist || []).some(d => State.hostname === d || State.hostname.endsWith(`.${d}`));
        if (whitelisted) {
            $('#scanner-sections').innerHTML = '<div class="whitelisted">当前域名在白名单中，已跳过扫描</div>';
        } else {
            sendTab('GET_RESULTS').catch(() => {});
        }
    } else {
        $('#scanner-sections').innerHTML = '<div class="no-results">请在网页中使用</div>';
    }
}
document.addEventListener('DOMContentLoaded', init);

/* ====================== 防护页（整合自 Heimdallr） ====================== */
const TYPE_LABELS = { 1: '指纹', 2: '关键字', 3: '蜜罐URL', 4: '蜜罐JSONP', 5: '蜜罐JS' };

async function initGuardPage() {
    // 加载配置与统计
    const res = await sendBg('HEIMDALLR_GET_CFG');
    if (!res) return;
    const { cfg, stats } = res;

    // 绑定开关
    const bind = (id, key) => {
        const el = $('#' + id);
        if (!el) return;
        el.checked = !!cfg[key];
        el.onchange = async () => {
            await sendBg('HEIMDALLR_SET_OPTION', { key, enabled: el.checked });
            toast(el.checked ? '已开启' : '已关闭');
        };
    };
    bind('hd-block-honeypot', 'blockHoneypot');
    bind('hd-jsonp-alert', 'jsonpAlert');
    bind('hd-no-page-cache', 'noPageCache');

    // 渲染统计
    renderGuardStats(stats);

    // 加载命中结果
    await loadGuardResults();

    // 监听实时更新
    if (!window.__hdListenerBound) {
        window.__hdListenerBound = true;
        API.runtime.onMessage.addListener((msg) => {
            if (msg.type === 'HEIMDALLR_UPDATE' && msg.tabId === State.tabId) {
                renderGuardResults(msg.results);
            }
            return false;
        });
    }
}

function renderGuardStats(stats) {
    if (!stats) return;
    const el = $('#hd-honeypot-stats');
    if (el) {
        el.innerHTML = `
            <span class="guard-stat-chip">规则总数<b>${stats.total}</b></span>
            <span class="guard-stat-chip danger">蜜罐JSONP拦截<b>${stats.blockJsonp}</b></span>
            <span class="guard-stat-chip warn">蜜罐JS告警<b>${stats.alert}</b></span>
            <span class="guard-stat-chip">拦截规则<b>${stats.blockingRules}</b></span>
        `;
    }
    const fEl = $('#hd-fingerprint-stats');
    if (fEl) {
        fEl.innerHTML = `
            <span class="guard-stat-chip">指纹规则<b>${stats.fingerprint}</b></span>
            <span class="guard-stat-chip">关键字规则<b>${stats.keyword}</b></span>
        `;
    }
}

async function loadGuardResults() {
    if (!State.tabId) return;
    const res = await sendBg('HEIMDALLR_GET_RESULTS', { tabId: State.tabId });
    if (res) renderGuardResults(res.results);
}

function renderGuardResults(results) {
    const items = results?.items || [];
    // 蜜罐类（type 3/4/5）
    const honeypotItems = items.filter(it => it.type >= 3);
    // 指纹类（type 1/2）
    const fingerItems = items.filter(it => it.type <= 2);

    const hEl = $('#hd-honeypot-results');
    if (hEl) {
        hEl.innerHTML = honeypotItems.length
            ? honeypotItems.map(it => `
                <div class="guard-result-item">
                    <span class="gr-type gr-type-${it.type}">${TYPE_LABELS[it.type] || ''}</span>
                    <span class="gr-msg">${escapeHtml(it.msg)}</span>
                    <span class="gr-rule">${escapeHtml(it.rulename || '')}</span>
                </div>`).join('')
            : '<div class="empty-state">暂无蜜罐命中</div>';
    }
    const fEl = $('#hd-fingerprint-results');
    if (fEl) {
        fEl.innerHTML = fingerItems.length
            ? fingerItems.map(it => `
                <div class="guard-result-item">
                    <span class="gr-type gr-type-${it.type}">${TYPE_LABELS[it.type] || ''}</span>
                    <span class="gr-msg">${escapeHtml(it.msg)}</span>
                    <span class="gr-rule">${escapeHtml(it.rulename || '')}</span>
                </div>`).join('')
            : '<div class="empty-state">暂无指纹命中</div>';
    }
}

function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}
