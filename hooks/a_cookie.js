/* 潜影 LatentEye — hook_cookie (主世界)
 * 捕获 document.cookie 写入。flag=0 输出全部；flag=1 按 param 关键字过滤。 */
(function () {
    'use strict';
    const SCRIPT_ID = 'hook_cookie';
    function clearCfg(id) { ['value', 'flag', 'param', 'debugger', 'stack'].forEach(k => localStorage.removeItem('LatentEye_' + id + '_' + k)); }

    function parseCookieName(str) {
        if (!str) return '';
        const part = str.split(';')[0];
        const eq = part.indexOf('=');
        return eq >= 0 ? decodeURIComponent(part.slice(0, eq).trim()) : '';
    }

    function initHook() {
        try {
            const flag = localStorage.getItem('LatentEye_' + SCRIPT_ID + '_flag');
            let param = [];
            try { param = JSON.parse(localStorage.getItem('LatentEye_' + SCRIPT_ID + '_param')) || []; } catch {}
            const isDbg = localStorage.getItem('LatentEye_' + SCRIPT_ID + '_debugger') === '1';
            const isStack = localStorage.getItem('LatentEye_' + SCRIPT_ID + '_stack') === '1';

            const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie') ||
                Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'cookie');
            if (!desc) return;
            const _get = desc.get, _set = desc.set;
            Object.defineProperty(document, 'cookie', {
                configurable: true,
                get() { return _get.call(document); },
                set(v) {
                    const name = parseCookieName(v);
                    if (flag === '1' && param.length) {
                        if (param.some(k => name.toLowerCase().includes(String(k).toLowerCase()))) {
                            console.log('%c[LatentEye] 捕获 cookie: ' + name, 'color:#f59e0b;font-weight:bold', '\n值:', v);
                            if (isDbg) debugger;
                            if (isStack) console.log(new Error().stack);
                        }
                    } else {
                        console.log('%c[LatentEye] 设置 cookie', 'color:#f59e0b', '\n', v);
                        if (isDbg) debugger;
                        if (isStack) console.log(new Error().stack);
                    }
                    _set.call(document, v);
                }
            });
            clearCfg(SCRIPT_ID);
        } catch (e) { console.error('[LatentEye] hook_cookie:', e); }
    }

    function setup() {
        window.addEventListener('message', (e) => {
            if (e.source !== window) return;
            const d = e.data;
            if (!d || d.source !== 'latenteye-extension' || d.type !== 'HOOK_CONFIG_READY') return;
            if ((d.scriptIds || []).includes(SCRIPT_ID)) initHook();
        });
    }
    setup();
})();
