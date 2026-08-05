/* =====================================================================
 * HAPPY JS — content script (扫描引擎)
 * 运行于隔离世界(document_start, all_frames)，负责：
 *   1. 敏感信息正则扫描（域名/IP/URL/API/手机/邮箱/身份证/JWT/密钥/凭证…）
 *   2. 动态扫描（MutationObserver 实时捕获动态渲染内容）
 *   3. 深度扫描（解析 JS 中嵌套的 JS / webpack chunk，递归抓取）
 *   4. 同步 Hook 配置到页面 localStorage 并注入主世界脚本
 *   5. 与 background(popup) 通信上报结果
 * ===================================================================== */

'use strict';

/* ========================== 通信桥 ========================== */
const Bridge = {
    toBg(type, payload = {}) {
        return new Promise((resolve) => {
            try {
                API.runtime.sendMessage({ ...payload, type, to: 'background' }, (r) => {
                    if (API.runtime.lastError) resolve(null); else resolve(r);
                });
            } catch { resolve(null); }
        });
    },
    toPopup(type, payload = {}) {
        try { API.runtime.sendMessage({ ...payload, type, to: 'popup' }).catch(() => {}); } catch {}
    },
    onMessage(handler) {
        API.runtime.onMessage.addListener((m, s, send) => {
            try { handler(m, s, send); } catch (e) { console.error('[LatentEye] msg:', e); send(null); }
            return true;
        });
    }
};
const API = (typeof browser !== 'undefined') ? browser : chrome;

/* ========================== 页面消息桥（隔离↔主世界） ========================== */
const PageBridge = {
    post(msg) { window.postMessage(msg, '*'); },
    on(type, cb) {
        window.addEventListener('message', (e) => {
            if (e.source !== window) return;
            if (e.data && e.data.type === type) cb(e.data);
        });
    }
};

/* ========================== Heimdallr position5 响应体桥接 ========================== */
// 接收主世界 hook_response_body 发来的 AJAX 响应体，转发给 background 匹配 position5 规则
window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.type !== 'HAPPYJS_RESPONSE_BODY') return;
    try {
        API.runtime.sendMessage({
            type: 'HEIMDALLR_MATCH_BODY',
            url: location.href,
            bodyUrl: d.url,
            body: d.body,
            status: d.status
        }).catch(() => {});
    } catch {}
});

// 页面 HTML 扫描：页面加载完成后把 outerHTML 发给 background 匹配 position5 规则
function scanPageHtmlForHeimdallr() {
    try {
        const html = document.documentElement.outerHTML;
        if (html && html.length > 0) {
            API.runtime.sendMessage({
                type: 'HEIMDALLR_MATCH_BODY',
                url: location.href,
                bodyUrl: location.href,
                body: html.length > 200 * 1024 ? html.slice(0, 200 * 1024) : html,
                status: 200
            }).catch(() => {});
        }
    } catch {}
}
if (document.readyState === 'complete') {
    scanPageHtmlForHeimdallr();
} else {
    window.addEventListener('load', () => setTimeout(scanPageHtmlForHeimdallr, 500));
}

/* ========================== 检测规则集（原创） ========================== */
const PATTERNS = {
    // 域名（带资源边界，用于JS文本扫描）
    DOMAIN: /\b(?:(?!this)[a-z0-9%-]+\.)*?(?:(?!this)[a-z0-9%-]{2,}\.)(?:wang|club|xyz|vip|top|beer|work|ren|technology|fashion|luxe|yoga|red|love|online|ltd|chat|group|pub|run|city|live|kim|pet|space|site|tech|host|fun|store|pink|ski|design|ink|wiki|video|email|company|plus|center|cool|fund|gold|guru|life|team|today|world|zone|social|bio|black|blue|green|lotto|organic|poker|promo|vote|archi|voto|fit|cn|website|press|icu|art|law|shop|band|media|cab|cash|cafe|games|link|fan|net|cc|com|fans|cloud|info|pro|mobi|asia|studio|biz|vin|news|fyi|tax|tv|market|shopping|mba|sale|co|org)(?::\d{1,5})?(?![a-z0-9._=>()!;}-])\b/gi,
    DOMAIN_RES: /["'](?!\/)(?:(?:[a-z0-9]+:)?\/\/)?(?:(?!this)[a-z0-9%-]+\.)*?(?:[a-z0-9%-]{2,}\.)(?:wang|club|xyz|vip|top|online|site|tech|cn|net|cc|com|cloud|info|pro|org|tv|biz|me|io|co|asia|studio|store|shop|news)(?![a-z0-9.])(?::\d{1,5})?\S*?["']/gi,
    IP: /(?<!\.|\d)(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)(?::\d{1,5})?(?!\.|\d)/g,
    IP_RES: /["'](?!\/)(?:(?:[a-z0-9]+:)?\/\/)?(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)(?::\d{1,5}|\/)?\S*?["']/gi,
    PHONE: /(?<!\d|\.)(?:13[0-9]|14[01456879]|15[0-35-9]|16[2567]|17[0-8]|18[0-9]|19[0-35-9])\d{8}(?!\d)/g,
    EMAIL: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:\.[a-zA-Z]{2,})?/g,
    IDCARD: /(?:(?:\d{6})(?:18|19|20)(?:\d{2})(?:0[1-9]|10|11|12)(?:0[1-9]|[12]\d|30|31)\d{3}(?:\d|X|x))(?!\d)/g,
    URL: /(?:https?|wss?|ftp):\/\/(?:(?:[\w-]+\.)+[a-z]{2,}|(?:\d{1,3}\.){3}\d{1,3})(?::\d{2,5})?(?:\/[^\s>)<}'"]*)?/gi,
    JWT: /["']ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]{10,}["']/g,
    GITHUB: /(?:https?:\/\/)?(?:www\.)?github\.com\/[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+/gi,
    WIN_PATH: /(?:[cdefgCDEFG]):(?:\\\\[\w\u4e00-\u9fa5_@.\-]+)+/gi,
    COMPANY: /(?:[\u4e00-\u9fa5（）]{4,15}[^的](?:公司|中心|集团)|[\u4e00-\u9fa5（）]{2,10}[^的](?:软件|科技))(?!法|点|与|查)/g,
    // API 路径（相对/绝对）
    API: /['"`](?:\/|\.\.\/|\.\/)[^/>< ()},'"\\][^^>< (),'"\\]*?['"`]|['"`][a-zA-Z0-9]+(?<!text|application)\/(?:[^^>< (){},'"\\])*?["'`]/g,
    // 资源文件后缀
    IMG: /\.(jpg|jpeg|png|gif|bmp|webp|svg|ico|mp3|mp4|m4a|wav|swf)(?:\?[^'"]*)?$/i,
    JS: /\.(js|jsx|ts|tsx|mjs)(?:\?[^'"]*)?$/i,
    DOC: /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|exe|apk|zip|7z|rar|dll|dmg|txt|csv|md)(?:\?[^'"]*)?$/i,
    FONT: /\.(ttf|eot|woff|woff2|otf|css)(?:\?[^'"]*)?$/i,
    // 第三方库识别（文件名）
    THIRD_PARTY: [
        /^jquery(?:[\.\-](?:cookie|fancybox|validate|blockui|pack|base64|md5|datatables|min))?(?:[\.\-]?\d*\.?\d*)?\.js$/i,
        /^(?:vue|vue-router|vuex|pinia|react|react-dom|react-router|angular|core-js)[\.\-]?\d*\.?\d*\.?\d*(?:\.min)?\.js$/i,
        /^(?:bootstrap|layui|layer|element-ui|element-plus|ant-design|antd|vant|iview|mui|uview)[\.\-]?\d*\.?\d*\.?\d*(?:\.min)?\.js$/i,
        /^(?:echarts|chart|highcharts|d3|antv|mermaid)[\.\-]?\d*\.?\d*\.?\d*(?:\.min)?\.js$/i,
        /^(?:axios|lodash|moment|dayjs|qs|md5|jsencrypt|crypto-js|base64|uuid|underscore|backbone|rxjs)[\.\-]?\d*\.?\d*\.?\d*(?:\.min)?\.js$/i,
        /^(?:handlebars|mustache|nunjucks)[\.\-]?\d*\.?\d*\.?\d*(?:\.min)?\.js$/i,
        /^(?:ueditor|kindeditor|tinymce|ckeditor|wangEditor|quill|monaco-editor)[\.\-]?\d*\.?\d*\.?\d*(?:\.min)?\.js$/i,
        /^(?:swiper|slick|fancybox|magnific-popup|select2|laydate)[\.\-]?\d*\.?\d*\.?\d*(?:\.min)?\.js$/i,
        /^(?:fingerprintjs|js-cookie|nprogress|polyfill|modernizr)[\.\-]?\d*\.?\d*\.?\d*(?:\.min)?\.js$/i
    ],
    // 凭证 user=pass
    CREDENTIALS: [
        { name: '凭证键值对', pattern: /['"]?\w*(?:pwd|pass|user|member|account|password|passwd|admin|root|system)[_-]?(?:id|name)?[0-9]*['"]?\s*[:=]\s*(?:['"][^,\s"'(]*['"])/gi }
    ],
    // Cookie 值
    COOKIE: /\b\w*(?:token|PHPSESSID|JSESSIONID|session|access_token|refresh_token)\s*[:=]\s*["']?(?!\.localStorage)(?:[a-zA-Z0-9._-]{6,})["']?/gi,
    // 云/平台密钥
    ID_KEY: [
        { name: '微信开放平台', pattern: /wx[a-z0-9]{15,18}/g },
        { name: '企业微信', pattern: /ww[a-z0-9]{15,18}/g },
        { name: '微信小程序/公众号AppID', pattern: /["'(]wx[0-9a-f]{16,18}["')]/g },
        { name: 'AWS AccessKey', pattern: /(?:AKIA|ASIA|AIDA|AGPA|AROA|AIPA|ANPA|ANVA|A3T)[0-9A-Z]{16}/g },
        { name: '阿里云AccessKey', pattern: /LTAI[A-Za-z\d]{12,30}/g },
        { name: '腾讯云密钥', pattern: /AKID[A-Za-z\d]{13,40}/g },
        { name: '京东云密钥', pattern: /JDC_[0-9A-Z]{25,40}/g },
        { name: 'Google API', pattern: /AIza[0-9A-Za-z_\-]{35}/g },
        { name: 'GitHub Token', pattern: /(?:ghp|gho|ghu|ghs|ghr|github_pat)_[a-zA-Z0-9_]{36,255}/g },
        { name: 'GitLab Token', pattern: /glpat-[a-zA-Z0-9\-=]{20,22}/g },
        { name: '支付宝开放平台', pattern: /(?:AKLT|AKTP)[a-zA-Z0-9]{35,50}/g },
        { name: 'Apple开发者', pattern: /APID[a-zA-Z0-9]{32,42}/g },
        { name: 'Slack Token', pattern: /xox[baprs]-[a-zA-Z0-9-]{10,}/g },
        { name: 'Stripe密钥', pattern: /(?:sk|pk|rk)_(?:live|test)_[0-9a-zA-Z]{24,}/g },
        { name: 'Twilio密钥', pattern: /SK[0-9a-fA-F]{32}/g },
        { name: '钉钉Token', pattern: /ding[a-z0-9]{15,}/g },
        { name: '飞书AppID', pattern: /cli_[a-z0-9]{16}/g },
        { name: '通用密钥串', pattern: /(?:['"]?(?:[\w-]*(?:secret|api[_-]?key|access[_-]?key|bucket|appkey|appsecret|private[_-]?key)[\w-]*)['"]?\s*[:=]\s*(?:"(?!\+)[^,"(<]{6,}"|'(?!\+)[^,'(<]{6,}'))/gi }
    ],
    // 私钥/证书
    PRIVATE_KEY: /-----\s*BEGIN\s+(?:RSA\s+|EC\s+|DSA\s+|OPENSSH\s+|PGP\s+|ENCRYPTED\s+)?PRIVATE KEY\s*-----[\s\S]{32,}?-----\s*END\s+(?:RSA\s+|EC\s+|DSA\s+|OPENSSH\s+|PGP\s+|ENCRYPTED\s+)?PRIVATE KEY\s*-----/g,
    // 数据库连接串
    DB_CONN: /(?:mongodb(?:\+srv)?:\/\/|mysql:\/\/|postgres(?:ql)?:\/\/|redis:\/\/|mssql:\/\/|jdbc:[a-zA-Z]+:\/\/)[^\s"'<>]{6,}/gi,
    // 消息队列/缓存
    MQ_CONN: /amqp:\/\/[^\s"'<>]{6,}|kafka:\/\/[^\s"'<>]{6,}/gi,
    // Linux 敏感路径
    LINUX_PATH: /(?:^|["'(=\s])(\/(?:etc|var|usr|root|home|opt|tmp|proc|sys)\/[^\s"'<>)\]}{]{3,})/g,
    // Source Map
    SOURCE_MAP: /\/\/[#@]\s*sourceMappingURL=[^\s'"]+/g,
    // OSS/对象存储 endpoint
    OSS_ENDPOINT: /https?:\/\/[a-z0-9-]+\.(?:oss|cos|s3|obs|bcebos|myqcloud|amazonaws)[a-z0-9.-]*\.[a-z0-9.-]+[^\s"'<>)\]}{]*/gi,
    // 页面/JS 内的构建工具与框架特征
    FINGER: [
        { cls: 'Webpack', name: 'Webpack', pattern: /(?:webpackJsonp|__webpack_require__|webpack-dev-server|__webpack_modules__)/i, type: 'builder', desc: '前端资源打包构建工具' },
        { cls: 'Vite', name: 'Vite', pattern: /(?:__vite_|vite\/dist|@vite\/client)/i, type: 'builder', desc: '现代前端构建工具' },
        { cls: 'Vue', name: 'Vue', pattern: /(?:__vue_app__|Vue\.config|vue\.runtime|vue-router)/i, type: 'framework', desc: '渐进式JS框架', extType: 'technology', extName: 'JavaScript' },
        { cls: 'React', name: 'React', pattern: /(?:__REACT_DEVTOOLS_GLOBAL_HOOK__|react-dom|react\.production)/i, type: 'framework', desc: 'UI构建库', extType: 'technology', extName: 'JavaScript' },
        { cls: 'Angular', name: 'Angular', pattern: /(?:ng-version|angular(?:\.min)?\.js|@angular)/i, type: 'framework', desc: '前端框架' },
        { cls: 'jQuery', name: 'jQuery', pattern: /jquery[.-]?\d/i, type: 'framework', desc: 'JS库' },
        { cls: 'CloudflareCDN', name: 'Cloudflare CDN', pattern: /cdnjs\.cloudflare\.com/i, type: 'cdn', desc: 'CDN加速服务' },
        { cls: 'jsDelivr', name: 'jsDelivr', pattern: /cdn\.jsdelivr\.net/i, type: 'cdn', desc: 'CDN加速服务' },
        { cls: 'unpkg', name: 'unpkg', pattern: /unpkg\.com/i, type: 'cdn', desc: 'CDN加速服务' },
        { cls: 'Django', name: 'Django', pattern: /csrfmiddlewaretoken/i, type: 'framework', desc: 'Python Web框架', extType: 'technology', extName: 'Python' },
        { cls: 'ThinkPHP', name: 'ThinkPHP', pattern: /think\(|THINK_PATH/i, type: 'framework', desc: 'PHP框架', extType: 'technology', extName: 'PHP' },
        { cls: 'ElementUI', name: 'Element UI', pattern: /el-[a-z]+|element-ui/i, type: 'framework', desc: 'Vue组件库' }
    ]
};

// 误报过滤用停用词集
const STOPWORDS = {
    SHORT: new Set(['up', 'in', 'by', 'of', 'is', 'on', 'to', 'no', 'all', 'app', 'com', 'con', 'for', 'get', 'has', 'ing', 'int', 'key', 'log', 'low', 'new', 'not', 'num', 'obj', 'out', 'pro', 'set', 'sub', 'use', 'url', 'sum', 'bit', 'kit', 'uid']),
    MID: new Set(['null', 'node', 'when', 'read', 'load', 'body', 'left', 'mark', 'play', 'head', 'item', 'init', 'hand', 'next', 'json', 'long', 'less', 'view', 'html', 'link', 'char', 'core', 'type', 'main', 'size', 'time', 'full', 'card', 'this', 'tool', 'note', 'area', 'bool', 'axis', 'high', 'true', 'date', 'work', 'lang', 'func', 'able', 'dark', 'info', 'data', 'self', 'void', 'list', 'text', 'stor', 'back', 'port', 'case', 'else', 'fail', 'with', 'base', 'rate', 'name', 'post', 'icon', 'auth', 'user', 'line', 'send', 'mess', 'http', 'rest', 'last', 'task', 'stat', 'fill', 'word', 'lock', 'sign', 'code', 'math', 'draw', 'blue']),
    LONG: new Set(['about', 'array', 'basic', 'begin', 'black', 'break', 'catch', 'class', 'close', 'clear', 'click', 'color', 'count', 'cover', 'error', 'false', 'fetch', 'final', 'found', 'green', 'group', 'index', 'inner', 'input', 'light', 'login', 'opera', 'param', 'parse', 'place', 'print', 'radio', 'range', 'right', 'refer', 'serve', 'share', 'style', 'title', 'token', 'trans', 'valid', 'video', 'white', 'write', 'button', 'cancel', 'create', 'double', 'global', 'insert', 'module', 'normal', 'object', 'search', 'select', 'simple', 'single', 'status', 'switch', 'system', 'verify', 'screen', 'member', 'change', 'buffer']),
    CN: new Set(['请', '输入', '前往', '整个', '常用', '咨询', '是否', '以上', '目前', '任务', '或者', '推动', '需要', '直接', '识别', '获取', '用于', '清除', '遍历', '使用', '是由', '用户', '一家', '项目', '判断', '通过', '为了', '可以', '掌握', '传统', '允许', '分析', '包括', '很多', '未经', '方式', '因此', '形式', '任何', '提交', '其他', '执行', '操作', '维护', '分享', '导致', '所有', '以及', '应当', '条件', '除非', '否则', '违反', '提供', '无法', '建立', '帮助', '快速', '构建', '恶意', '勒索', '通常', '没有', '查看', '确保', '提高', '减少', '检查', '更新', '卸载', '常见', '依赖', '进行', '测试', '的', '在', '去', '个', '、', '，', ' ']),
    KEY_BLACK: new Set(['size', 'row', 'dict', 'time', 'highlight'])
};

/* ========================== 配置上下文 ========================== */
const Ctx = {
    tabId: null, frameId: null, hostname: '', protocol: '', port: '',
    inIframe: window.self !== window.top,
    dynamicScan: false, deepScan: false, whitelisted: false,
    useWebpack: false, scanned: new Set(), tree: {},
    async init() {
        const cfg = await new Promise(r => API.storage.local.get(['dynamicScan', 'deepScan', 'customWhitelist'], r));
        this.dynamicScan = cfg.dynamicScan === true;
        this.deepScan = cfg.deepScan === true;
        this.protocol = location.protocol;
        this.hostname = location.hostname.toLowerCase();
        this.port = location.port;
        this.tabId = (await Bridge.toBg('GET_TAB_ID'))?.tabId ?? null;
        this.frameId = (await Bridge.toBg('GET_IFRAME_ID'))?.frameId ?? '0';
        const wl = cfg.customWhitelist || [];
        this.whitelisted = wl.some(d => this.hostname === d || this.hostname.endsWith(`.${d}`));
    },
    origin() { return `${this.protocol}//${this.hostname}${this.port ? ':' + this.port : ''}`; },
    fullUrl(p) { return `${this.protocol}//${this.hostname}${this.port ? ':' + this.port : ''}${p}`; },
    isScanned(u) { return this.scanned.has(u); },
    markScanned(u) { this.scanned.add(u); },
    updateTree(baseUrl) {
        const parts = baseUrl.split('/').filter(Boolean);
        let node = this.tree;
        parts.forEach(p => { node[p] ||= {}; node = node[p]; });
    },
    getFullPath(prefix) {
        const first = prefix.split('/').filter(Boolean)[0];
        const walk = (n, pre) => {
            for (const k in n) {
                const cur = pre + '/' + k;
                if (k === first) return cur;
                const r = walk(n[k], cur);
                if (r) return r;
            }
            return '';
        };
        return walk(this.tree, '');
    }
};

/* ========================== 结果集合（主frame维护） ========================== */
const Results = {
    data: null,
    empty() {
        return {
            domains: [], routes: [], absoluteApis: [], apis: [], moduleFiles: [],
            docFiles: [], ips: [], phones: [], emails: [], idcards: [], jwts: [],
            imageFiles: [], jsFiles: [], thirdPartyLibs: [], vueFiles: [], urls: [],
            githubUrls: [], companies: [], credentials: [], cookies: [], idKeys: [],
            windowsPaths: [], iframes: [], fingers: [],
            privateKeys: [], dbConns: [], mqConns: [], linuxPaths: [], sourceMaps: [], ossEndpoints: [],
            progress: 0
        };
    },
    get() {
        if (!this.data) this.data = this.empty();
        return this.data;
    },
    clear() { this.data = this.empty(); }
};

const addTo = (key, value, source) => {
    const arr = Results.get()[key];
    if (!Array.isArray(arr)) return;
    // 用 value 去重
    const exists = arr.find(it => it[0] === value);
    if (exists) return;
    arr.push([value, source]);
};

/* ========================== 过滤器（去误报） ========================== */
const Filter = {
    cleanDomain(raw) {
        try {
            let t = raw.replace(/^['"]|['"]$/g, '').toLowerCase();
            const m = t.match(/\b(?:[a-z0-9%-]+\.)+[a-z]{2,12}(?::\d{1,5})?\b/);
            if (!m) return false;
            t = m[0];
            if (BLACKLIST_DOMAIN.some(b => t.includes(b))) return false;
            return t;
        } catch { return false; }
    },
    isSpecialIp(ip) { return /^0\.0\.0\.0$|^255\.255\.255\.255$|^127\.0\.0\.1$/.test(ip); },
    badValue(v) {
        const s = v.toLowerCase();
        const set = s.length < 12 ? STOPWORDS.SHORT : s.length < 16 ? STOPWORDS.MID : STOPWORDS.LONG;
        for (const w of set) if (s.includes(w)) return true;
        return false;
    },
    badCn(v) { for (const w of STOPWORDS.CN) if (v.includes(w)) return true; return false; }
};

const BLACKLIST_DOMAIN = ['el.datepicker', 'obj.style.top', 'window.top', 'mydragdiv.style', 'container.style', 'location.host', 'page.info', 'res.info', 'item.info', 'this.domain'];

/* ========================== 分类处理函数 ========================== */
const Handlers = {
    api(raw, src) {
        let t = raw.slice(1, -1);
        if (PATTERNS.FONT.test(t)) return;
        if (t.endsWith('.vue')) { addTo('vueFiles', t, src); return; }
        if (PATTERNS.IMG.test(t)) { addTo('imageFiles', t, src); return; }
        if (PATTERNS.DOC.test(t)) { addTo('docFiles', t, src); return; }
        const low = t.toLowerCase();
        // 扩充的噪声过滤（参考 SnowEyes + 实战误报）
        const NOISE = [
            'multipart/form-data', 'node_modules/', 'application/json', 'text/javascript', 'text/css',
            'text/plain', 'text/html', 'application/xml', 'application/x-www-form-urlencoded',
            'pause/break', 'partial/ajax', 'chrome/', 'firefox/', 'edge/', 'safari/',
            'examples/element-ui', 'static/js/', 'static/css/', 'static/img/', 'stylesheet/less',
            'jpg/jpeg/png/pdf', 'yyyy/mm/dd', 'dd/mm/yyyy', 'mm/dd/yy', 'yy/mm/dd', 'm/d/y', 'xx/xx',
            'zrender/vml/vml', 'www.w3.org', 'schemas.microsoft', 'ns.adobe.com'
        ];
        if (NOISE.some(x => low === x || low.startsWith(x))) return;
        if (t.startsWith('./') && !Results.get().moduleFiles.find(m => m[0] === t + '.js')) {
            addTo('moduleFiles', t, src);
            return;
        }
        if (PATTERNS.JS.test(t)) return;
        if (t.startsWith('/')) {
            if (t.length <= 4 && /[A-Z.\/#?+]/.test(t.slice(1))) return;
            // 排除纯静态资源路径
            if (/^\/(?:static|assets|public|dist|img|images|fonts|css|style)\/[^?]*\.(?:png|jpe?g|gif|svg|ico|woff2?|ttf|eot|css)(?:\?|$)/i.test(t)) return;
            addTo('absoluteApis', t, src);
        } else {
            if (/^(audio|blots|core|ace|icon|css|formats|image|js|modules|text|themes|ui|video|static|attributors|application)/.test(t) || t.length <= 4) return;
            addTo('apis', t, src);
        }
    },
    domain(raw, src) {
        const d = Filter.cleanDomain(raw);
        if (d) addTo('domains', d, src);
    },
    ip(raw, src) {
        const t = raw.replace(/^[`'"]|[`'"]$/g, '');
        const m = t.match(PATTERNS.IP);
        if (m) { const ip = m[0]; if (!Filter.isSpecialIp(ip)) addTo('ips', ip, src); }
    },
    url(raw, src) {
        if (/github\.com\//i.test(raw)) { addTo('githubUrls', raw, src); return; }
        try {
            const u = new URL(raw);
            if (u.host === location.host) {
                const p = u.pathname;
                if (PATTERNS.FONT.test(p)) return;
                if (PATTERNS.IMG.test(p)) { addTo('imageFiles', p, src); return; }
                if (PATTERNS.DOC.test(p)) { addTo('docFiles', p, src); return; }
                if (!/\.[a-zA-Z0-9]+$/.test(p)) {
                    p.startsWith('/') ? addTo('absoluteApis', p, src) : addTo('apis', p, src);
                }
            }
            addTo('urls', raw, src);
        } catch { addTo('urls', raw, src); }
    },
    phone(v, src) { addTo('phones', v, src); },
    email(v, src) { addTo('emails', v, src); },
    idcard(v, src) { addTo('idcards', v, src); },
    jwt(v, src) { addTo('jwts', v, src); },
    company(v, src) { if (!Filter.badCn(v) && !/[（）]/.test(v) || /（\S*）/.test(v)) addTo('companies', v, src); },
    github(v, src) { addTo('githubUrls', v, src); },
    winPath(v, src) { addTo('windowsPaths', v, src); },
    credentials(v, src) {
        const parts = v.replace(/\s+/g, '').split(/[:=]/);
        if (parts.length < 2) return;
        const val = (parts[1] || '').replace(/['"]/g, '');
        if (!val || val.length < 2) return;
        if (Filter.badValue(val)) return;
        if (/^(true|false|null|undefined|0|1)$/i.test(val)) return;
        addTo('credentials', v, src);
    },
    cookie(v, src) {
        const parts = v.replace(/\s+/g, '').split(/[:=]/);
        if (parts.length < 2) return;
        const val = (parts[1] || '').replace(/['"]/g, '');
        if (val.length < 4 || Filter.badValue(val)) return;
        const key = (parts[0] || '').replace(/['"<>]/g, '').toLowerCase();
        if (key === val) return;
        addTo('cookies', v, src);
    },
    idKey(v, src) {
        const raw = v.replace(/^\s+/, '');
        const eq = raw.match(/[:=]/);
        if (eq) {
            const parts = raw.replace(/\s+/g, '').split(/[:=]/);
            const k = (parts[0] || '').replace(/['"<>]/g, ''), val = (parts[1] || '').replace(/['"<>]/g, '');
            if (!val || k === val) return;
            if (STOPWORDS.KEY_BLACK.has(k.toLowerCase())) return;
            if (val.length < 12 && Filter.badValue(val)) return;
            if (k === 'key' && val.length <= 8) return;
            addTo('idKeys', v, src);
        } else if (v.length >= 16) {
            addTo('idKeys', v, src);
        }
    },
    privateKey(v, src) { addTo('privateKeys', v.trim(), src); },
    dbConn(v, src) {
        // 脱敏密码后保存
        let safe = v;
        try { safe = v.replace(/(:\/\/[^:]+:)[^@]+(@)/, '$1****$2'); } catch {}
        addTo('dbConns', safe, src);
    },
    mqConn(v, src) { addTo('mqConns', v, src); },
    linuxPath(v, src) {
        const p = v.trim().replace(/^["'(=\s]+/, '');
        if (p.length < 6) return;
        addTo('linuxPaths', p, src);
    },
    sourceMap(v, src) {
        const m = v.match(/sourceMappingURL=(\S+)/);
        if (m) addTo('sourceMaps', m[1], src);
    },
    ossEndpoint(v, src) { addTo('ossEndpoints', v, src); },
    finger(name, cls, type, desc, src, extType, extName) {
        Bridge.toBg('UPDATE_BUILDER', { finger: { type, name, description: `通过页面内容识别到 ${name} ${desc}`, version: name, extType, extName } });
        if (!Results.get().fingers.find(f => f[0] === name)) Results.get().fingers.push([name, src]);
    }
};

/* ========================== 提取器（正则匹配委托给 background） ========================== */
class Extractor {
    constructor(name, patternKey, handler, useRes = false) {
        this.name = name;
        this.patternKey = patternKey;
        this.handler = handler;
        this.useRes = useRes;
    }
    async extract(text, src) {
        const pat = PATTERNS[this.patternKey];
        let patterns;
        if (Array.isArray(pat)) {
            patterns = pat.map(p => ({ pattern: p.pattern.toString(), name: p.name }));
        } else if (this.useRes && PATTERNS[this.patternKey + '_RES']) {
            patterns = [{ pattern: PATTERNS[this.patternKey + '_RES'].toString() }];
        } else {
            patterns = [{ pattern: pat.toString() }];
        }
        const res = await Bridge.toBg('REGEX_MATCH', { chunk: text, patterns: patterns.map(p => p.pattern), patternType: this.name });
        if (!res?.matches?.length) return;
        for (const { match } of res.matches) {
            try { this.handler(match, src); } catch {}
        }
    }
}

class FingerExtractor {
    constructor() { this.name = 'Finger'; }
    async extract(text, src) {
        for (const f of PATTERNS.FINGER) {
            if (Results.get().fingers.find(x => x[0] === f.name)) continue;
            if (f.pattern.test(text)) Handlers.finger(f.name, f.cls, f.type, f.desc, src, f.extType, f.extName);
        }
    }
}

const Extractors = [
    new FingerExtractor(),
    new Extractor('API', 'API', Handlers.api),
    new Extractor('DOMAIN', 'DOMAIN', Handlers.domain, true),
    new Extractor('IP', 'IP', Handlers.ip, true),
    new Extractor('URL', 'URL', Handlers.url),
    new Extractor('PHONE', 'PHONE', Handlers.phone),
    new Extractor('EMAIL', 'EMAIL', Handlers.email),
    new Extractor('IDCARD', 'IDCARD', Handlers.idcard),
    new Extractor('JWT', 'JWT', Handlers.jwt),
    new Extractor('GITHUB', 'GITHUB', Handlers.github),
    new Extractor('COMPANY', 'COMPANY', Handlers.company),
    new Extractor('WIN_PATH', 'WIN_PATH', Handlers.winPath),
    new Extractor('CREDENTIALS', 'CREDENTIALS', Handlers.credentials),
    new Extractor('COOKIE', 'COOKIE', Handlers.cookie),
    new Extractor('ID_KEY', 'ID_KEY', Handlers.idKey),
    new Extractor('PRIVATE_KEY', 'PRIVATE_KEY', Handlers.privateKey),
    new Extractor('DB_CONN', 'DB_CONN', Handlers.dbConn),
    new Extractor('MQ_CONN', 'MQ_CONN', Handlers.mqConn),
    new Extractor('LINUX_PATH', 'LINUX_PATH', Handlers.linuxPath),
    new Extractor('SOURCE_MAP', 'SOURCE_MAP', Handlers.sourceMap),
    new Extractor('OSS_ENDPOINT', 'OSS_ENDPOINT', Handlers.ossEndpoint)
];

/* ========================== 大文本分块 ========================== */
const CHUNK = 50000;
function* chunkText(text) {
    if (text.length <= CHUNK) { yield text; return; }
    const lines = text.split(/\r?\n/);
    let buf = [], len = 0;
    for (const line of lines) {
        const add = line.length + 1;
        if (len + add > CHUNK && buf.length) {
            yield buf.join('\n') + '\n';
            buf = []; len = 0;
        }
        buf.push(line); len += add;
    }
    if (buf.length) yield buf.join('\n') + '\n';
}

/* ========================== Webpack/嵌套JS提取器（深度扫描核心） ========================== */
const WebpackExtractor = {
    baseDir(url) {
        try { const p = new URL(url).pathname.split('/'); p.pop(); return p.join('/') + '/'; }
        catch { return '/'; }
    },
    extract(text, src) {
        if (Ctx.inIframe) return new Set();
        const found = new Set();
        const origin = (() => { try { return new URL(src).origin; } catch { return location.origin; } })();

        for (const chunk of chunkText(text)) {
            // 1) *** /path *** 注释式引用
            for (const m of chunk.matchAll(/!\*\*\*\s(?:\/|\.\/|\.\.\/)*[\w_~./]*\s\*\*\*!/g)) {
                const p = m[0].slice(5, -5);
                addTo('moduleFiles', p, src);
                Results.get().jsFiles = Results.get().jsFiles.filter(x => x[0] !== p);
            }
            // 2) {"/path.js":123} chunk 映射
            for (const m of chunk.matchAll(/{(?:"\.\/[\w._-]*\.js":\d{0,3},?){1,}}/g)) {
                try {
                    const obj = JSON.parse(m[0]);
                    for (const k in obj) { addTo('moduleFiles', k, src); Results.get().jsFiles = Results.get().jsFiles.filter(x => x[0] !== k); }
                } catch {}
            }
            // 3) 引号/反引号包裹的 .js 字符串（chunk 抓取：webpack/vite/rollup 动态 import 的 chunk）
            //    - 仅 deepScan 开启时提取：这些字符串通常是 chunk 路径，开启后才能递归抓取发现深层 API
            //    - 默认（关闭）只扫直接 script src + performance 资源，性能更友好
            if (Ctx.deepScan) {
            for (const m of chunk.matchAll(/['"`](?:[^?'"`]+\.js)['"`]/g)) {
                let p = m[0].slice(1, -1);
                try {
                    p = decodeURIComponent(p);
                    // 仅跳过 node_modules 第三方库；dist 为业务构建产物，需继续抓取以发现 API
                    if (p.includes(' ') || p.includes('/node_modules/')) {
                        if (!p.includes(' ')) addTo('moduleFiles', p, src);
                        continue;
                    }
                } catch { if (p.includes(' ')) continue; }
                if (p.startsWith('http') || p.startsWith('//')) {
                    try {
                        const full = p.startsWith('//') ? location.protocol + p : p;
                        if (new URL(full).hostname.toLowerCase() !== Ctx.hostname) continue;
                        found.add(full);
                    } catch {}
                } else if (!Results.get().moduleFiles.find(x => x[0] === p)) {
                    found.add(origin + (p.startsWith('/') ? p : WebpackExtractor.baseDir(src) + p));
                }
            }
            } // end if (Ctx.deepScan) — 第 3 段 chunk 字符串提取
            // 4) webpack chunk 模板 base+name+hash+end
            if (!Ctx.useWebpack) {
                // 对齐 SnowEyes：base 可选 + 捕获 "." 分隔符(add) + hash 映射按 key(chunkId)/value(hash) 成对重建
                const tpl = chunk.match(/(?:(?<base>"[a-z-_/]*")\+)?(?<name_struct>(?:\(\{(?<name>[^{};=]*?:"[^{},;=]*?")?\}\[[a-z]\]\|\|[a-z]\))?[\w]?)?\+?(?<add>"."\+)?(?<hash_struct>\{(?<hash>[^{}=]*?:"[\w]*")?\}\[[a-z]\]\+)?(?<end>"[\w._-]*\.js")/i);
                if (tpl && tpl.groups) {
                    try {
                        let base = (tpl.groups.base || WebpackExtractor.baseDir(src)).replace(/"/g, '');
                        const end = (tpl.groups.end || '').replace(/"/g, '');
                        const sep = tpl.groups.add ? '.' : ''; // name 与 hash 之间的 "." 分隔符
                        if (!base.startsWith('/')) base = '/' + base;
                        if (!base.endsWith('/')) base += '/';
                        const hasNameStruct = !!tpl.groups.name_struct;
                        const hashMap = tpl.groups.hash;
                        const nameMap = tpl.groups.name;
                        if (hashMap) {
                            // hash 映射：key=chunkId, value=hash（成对重建，不再交叉乘积）
                            hashMap.split(',').forEach(pair => {
                                const ci = pair.indexOf(':');
                                if (ci < 0) return;
                                const chunkId = pair.slice(0, ci).replace(/"/g, '');
                                const hash = pair.slice(ci + 1).replace(/"/g, '');
                                if (hasNameStruct && chunkId) {
                                    found.add(origin + base + chunkId + sep + hash + end);
                                } else if (hash) {
                                    found.add(origin + base + hash + end);
                                }
                            });
                        } else if (nameMap) {
                            // 仅 name 映射（无 hash）：filename = base + name + end
                            nameMap.split(',').forEach(pair => {
                                const n = pair.split(':')[0].replace(/"/g, '');
                                if (n) found.add(origin + base + n + end);
                            });
                        }
                        Ctx.useWebpack = true;
                    } catch {}
                }
            }
        }
        return found;
    }
};

/* ========================== 调度器：并发JS抓取队列 ========================== */
class Scheduler {
    constructor(onContent, onProgress) {
        this.queue = []; this.queued = new Set(); this.inFlight = new Set();
        this.processing = false; this.onContent = onContent; this.onProgress = onProgress;
    }
    scanDom(html, src) {
        if (Ctx.whitelisted) return;
        this.onContent(html, src, true);
        const urls = WebpackExtractor.extract(html, src);
        urls.forEach(u => { if (!u.startsWith('chrome-extension://') && !u.startsWith('moz-extension://')) this.enqueue(u, src); });
        // 同时直接抓取 DOM 中 <script src>（比正则更可靠，覆盖动态注入）
        this.collectScriptTags(src);
    }
    // 收集页面所有 <script src> 并入队（含动态注入的脚本）
    collectScriptTags(src) {
        try {
            const scripts = document.querySelectorAll('script[src]');
            scripts.forEach(s => {
                let u = s.src || s.getAttribute('src') || '';
                if (!u) return;
                if (u.startsWith('chrome-extension://') || u.startsWith('moz-extension://')) return;
                // 相对路径转绝对
                try { u = new URL(u, location.href).href; } catch { return; }
                this.enqueue(u, src || location.href);
            });
            // link[href] 中的 js/json
            document.querySelectorAll('link[rel="modulepreload"][href], link[rel="preload"][as="script"][href]').forEach(l => {
                let u = l.href;
                if (!u) return;
                try { u = new URL(u, location.href).href; } catch { return; }
                this.enqueue(u, src || location.href);
            });
            // performance entries：收集所有已加载的 JS 资源（覆盖 dynamic import 的 chunk）
            // 这是 SnowEyes 没有的数据源，能抓取到代码中无字符串引用、但运行时动态加载的 chunk
            try {
                performance.getEntriesByType('resource').forEach(e => {
                    const u = e.name;
                    if (!u || !/\.(?:js|mjs|jsx)(\?|$)/i.test(u)) return;
                    if (u.startsWith('chrome-extension://') || u.startsWith('moz-extension://')) return;
                    try { this.enqueue(new URL(u, location.href).href, src || location.href); } catch {}
                });
            } catch {}
            // performance entries：收集 XHR/fetch 实际调用的接口端点（对齐 FindSomething 运行时发现）
            // 仅记录路径，不抓取（避免对 API 产生副作用）；跳过静态资源扩展名，仅同源
            try {
                performance.getEntriesByType('resource').forEach(e => {
                    const u = e.name;
                    if (!u || u.startsWith('chrome-extension://') || u.startsWith('moz-extension://')) return;
                    if (PATTERNS.JS.test(u) || PATTERNS.IMG.test(u) || PATTERNS.FONT.test(u) || PATTERNS.DOC.test(u)) return;
                    try {
                        const x = new URL(u, location.href);
                        if (x.hostname !== Ctx.hostname) return;
                        const p = x.pathname;
                        if (!p || p === '/') return;
                        p.startsWith('/') ? addTo('absoluteApis', p, u) : addTo('apis', p, u);
                    } catch {}
                });
            } catch {}
        } catch {}
    }
    enqueue(url, src) {
        if (Ctx.isScanned(url) || this.queued.has(url) || Ctx.whitelisted) return;
        // 第三方库识别
        const fname = (() => { try { return new URL(url).pathname.split('/').pop() || ''; } catch { return ''; } })();
        if (PATTERNS.THIRD_PARTY.some(re => re.test(fname))) { addTo('thirdPartyLibs', fname, src); return; }
        try { if (new URL(src).hostname.toLowerCase() !== Ctx.hostname) return; } catch { return; }
        this.queued.add(url); this.queue.push(url);
        addTo('jsFiles', (() => { try { return new URL(url).pathname; } catch { return url; } })(), src);
        addTo('urls', url, src);
        this.process();
    }
    async process() {
        if (this.processing) return;
        this.processing = true;
        try {
            while (this.queue.length && this.inFlight.size < 10) {
                const url = this.queue.shift();
                if (!url) break;
                this.inFlight.add(url);
                this.handle(url).finally(() => { this.inFlight.delete(url); this.onProgress(); this.process(); });
                await new Promise(r => setTimeout(r, 0));
            }
        } finally { this.processing = false; }
    }
    async handle(url) {
        try {
            const r = await Bridge.toBg('FETCH_JS', { url, frameId: Ctx.frameId });
            if (!r?.content || r.frameId !== Ctx.frameId) return;
            Ctx.updateTree(WebpackExtractor.baseDir(url));
            await this.onContent(r.content, url, false);
            if (Ctx.frameId !== '0') return; // 仅主frame递归深度扫描
            const urls = WebpackExtractor.extract(r.content, url);
            urls.forEach(u => this.enqueue(u, url));
        } catch (e) { console.error('[LatentEye] task:', e); }
    }
    stats() { return { total: this.queued.size, remaining: this.queue.length, dealing: this.inFlight.size }; }
}

/* ========================== 动态扫描器（MutationObserver） ========================== */
class DynamicScanner {
    constructor(onScan) {
        this.onScan = onScan;
        this.timer = null;
        this.DEBOUNCE = 1000;
        this.observer = new MutationObserver(muts => this.handle(muts));
    }
    handle(muts) {
        // 始终监听 iframe 新增（即使关闭动态扫描）
        let iframeAdded = false;
        for (const m of muts) {
            for (const n of m.addedNodes) {
                if (n.nodeType === 1 && (n.tagName === 'IFRAME' || n.querySelector?.('iframe'))) { iframeAdded = true; break; }
            }
            if (iframeAdded) break;
        }
        if (iframeAdded) this.debounce();
        if (!Ctx.dynamicScan) return;
        const meaningful = muts.some(m => !(m.type === 'attributes' && (m.attributeName === 'class' || m.attributeName === 'style')));
        if (meaningful) this.debounce();
    }
    debounce() {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            const html = document.documentElement.innerHTML;
            if (html) this.onScan(html, location.href);
        }, this.DEBOUNCE);
    }
    start() {
        const root = document.body || document.documentElement;
        if (!root) return;
        try {
            this.observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['src', 'href'] });
        } catch (e) { console.error('[LatentEye] observer:', e); }
    }
    stop() { this.observer.disconnect(); if (this.timer) clearTimeout(this.timer); }
}

/* ========================== 上报结果 ========================== */
let _reportTimer = null;
function _doReport() {
    _reportTimer = null;
    if (Ctx.tabId == null) return;
    const sched = scheduler;
    const s = sched.stats();
    const pct = s.total === 0 ? 100 : Math.floor((s.total - s.remaining - s.dealing) / s.total * 100);
    Results.get().progress = Math.max(Results.get().progress || 0, pct);
    // 收集 iframe
    document.querySelectorAll('iframe').forEach(f => {
        const src = f.src || 'about:blank';
        if (!Results.get().iframes.find(x => x[0] === src)) Results.get().iframes.push([src, location.href]);
    });
    const out = {};
    for (const k in Results.get()) out[k] = Results.get()[k];
    const payload = { results: out, tabId: Ctx.tabId, frameId: Ctx.frameId, isInIframe: Ctx.inIframe, frameUrl: location.href };
    Bridge.toPopup('SCAN_UPDATE', payload);
    Bridge.toBg('UPDATE_BADGE', { results: out });
}
// 节流上报：250ms 内最多一次，避免每个 JS 文件都全量推送导致 popup 卡顿
function report() {
    if (Ctx.tabId == null) return;
    if (_reportTimer) return;
    _reportTimer = setTimeout(_doReport, 250);
}
// 立即上报（用于 GET_RESULTS 等需要即时响应的场景）
function reportNow() {
    if (_reportTimer) { clearTimeout(_reportTimer); _reportTimer = null; }
    _doReport();
}

/* ========================== 内容处理（执行所有提取器） ========================== */
async function dealContent(text, src, isDom) {
    if (!Ctx.tabId) return;
    for (const chunk of chunkText(text)) {
        await Promise.all(Extractors.map(ex => ex.extract(chunk, src).catch(() => {})));
        await new Promise(r => setTimeout(r, 0));
    }
    if (!isDom) Ctx.markScanned(src);
}

/* ========================== 主世界脚本注入（Vue/React 路由） ========================== */
function injectPageScript(url) {
    return new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = url; s.async = false;
        s.onload = () => { s.remove(); resolve(); };
        s.onerror = () => { s.remove(); resolve(); };
        (document.head || document.documentElement || document).appendChild(s);
    });
}

/* ========================== Hook 配置同步 ========================== */
async function syncHookConfig() {
    try {
        const data = await new Promise(r => API.storage.local.get(null, r));
        const mode = data[HookConst.MODE_KEY] || 'standard';
        const enabled = mode === 'global' ? (data[HookConst.GLOBAL_KEY] || []) : (data[Ctx.hostname] || []);
        if (!enabled.length) return;
        const configKeys = enabled.map(id => `${id}_config`);
        const cfgs = await new Promise(r => API.storage.local.get([...configKeys, HookConst.MERGED_KEY], r));
        const ready = [];
        enabled.forEach(id => {
            const cfg = cfgs[`${id}_config`];
            if (!cfg) return;
            const base = `LatentEye_${id}`;
            try {
                if (cfg.value !== undefined) localStorage.setItem(`${base}_value`, cfg.value);
                if (cfg.flag !== undefined) localStorage.setItem(`${base}_flag`, String(cfg.flag));
                if (cfg.param !== undefined) localStorage.setItem(`${base}_param`, JSON.stringify(cfg.param));
                Object.keys(cfg).forEach(k => {
                    if (!['value', 'flag', 'param', 'keyword_filter_enabled'].includes(k)) {
                        localStorage.setItem(`${base}_${k}`, String(cfg[k] || 0));
                    }
                });
                ready.push(id);
            } catch {}
        });
        if (cfgs[HookConst.MERGED_KEY]) {
            try { localStorage.setItem('LatentEye_Hooks', JSON.stringify(cfgs[HookConst.MERGED_KEY])); } catch {}
        }
        if (ready.length) {
            window.postMessage({ type: 'HOOK_CONFIG_READY', source: 'latenteye-extension', scriptIds: ready }, '*');
        }
    } catch {}
}
const HookConst = { MODE_KEY: 'le_mode', GLOBAL_KEY: 'le_global_hooks', MERGED_KEY: 'le_merged_hooks' };

/* ========================== 全局实例 ========================== */
let scheduler = null;
let dynamic = null;

/* ========================== 启动流程 ========================== */
async function bootstrap() {
    await Ctx.init();
    if (Ctx.whitelisted || Ctx.tabId == null) return;
    Results.clear();

    // 注入 Vue/React 路由 hook 脚本（主世界）
    injectPageScript(API.runtime.getURL('inject/vue_router.js'));

    // 同步 Hook 配置（供 hooks/*.js 主世界脚本读取）
    syncHookConfig();

    // 注册并获取 background 观测到的同源 JS 列表
    const reg = await Bridge.toBg('REGISTER_CONTENT', { frameId: Ctx.frameId });
    if (reg && reg.frameId === Ctx.frameId) {
        scheduler = new Scheduler(dealContent, report);
        dynamic = new DynamicScanner((html, src) => { scheduler.scanDom(html, src); report(); });
        // 入队 background 观测到的 JS
        new Set(reg.tabJs || []).forEach(u => scheduler.enqueue(u, location.href));
    }
    await initialScan();
}

async function initialScan() {
    if (Ctx.tabId == null || Ctx.whitelisted) return;
    if (scheduler) {
        scheduler.scanDom(document.documentElement.innerHTML, location.href);
        report();
        if (dynamic && !Ctx.inIframe) dynamic.start();
    }
}

// 接收主世界 Vue Router 数据
PageBridge.on('VUE_ROUTER_DATA', (d) => {
    if (d.source !== 'latenteye-inject' || Ctx.tabId == null) return;
    const data = d.data || {};
    const { version, routes } = data;
    Handlers.finger(`Vue ${version || ''}`.trim(), 'Vue', 'framework', '渐进式JS框架', location.href, 'technology', 'JavaScript');
    (routes || []).forEach(r => addTo('routes', r, Ctx.fullUrl(r)));
    // 转发到 popup 供路由页展示（关键：否则路由页永远空白）
    Bridge.toPopup('VUE_ROUTER_DATA_UPDATE', { hostname: Ctx.hostname, data });
    Bridge.toBg('VUE_ROUTER_DATA', { data }); // 供 background 持久化
    report();
});
PageBridge.on('REACT_ROUTER_DATA', (d) => {
    if (d.source !== 'latenteye-inject' || Ctx.tabId == null) return;
    const data = d.data || {};
    const { routes } = data;
    Handlers.finger('React', 'React', 'framework', 'UI构建库', location.href, 'technology', 'JavaScript');
    (routes || []).forEach(r => addTo('routes', r, Ctx.fullUrl(r)));
    Bridge.toPopup('REACT_ROUTER_DATA_UPDATE', { hostname: Ctx.hostname, data });
    Bridge.toBg('REACT_ROUTER_DATA', { data });
    report();
});

// 处理来自 popup 的消息
Bridge.onMessage((msg, sender, send) => {
    if (msg.to && msg.to !== 'content') return;
    switch (msg.type) {
        case 'GET_RESULTS':
            PageBridge.post({ type: 'TRIGGER_VUE_SCAN', source: 'latenteye-content' });
            PageBridge.post({ type: 'TRIGGER_REACT_SCAN', source: 'latenteye-content' });
            reportNow();
            send({ ok: true });
            break;
        case 'UPDATE_DYNAMIC_SCAN':
            Ctx.dynamicScan = !!msg.enabled; send({ ok: true }); break;
        case 'UPDATE_DEEP_SCAN':
            Ctx.deepScan = !!msg.enabled; send({ ok: true }); break;
        default: send(null);
    }
    return true;
});

// 启动
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrap);
else bootstrap();
