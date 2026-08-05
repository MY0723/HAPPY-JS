/* 潜影 LatentEye — hook_fetch (主世界)
 * 捕获 fetch 请求参数。支持 debugger 与堆栈打印。 */
(function () {
    'use strict';
    const SCRIPT_ID = 'hook_fetch';
    function clearCfg(id) { ['value', 'flag', 'param', 'debugger', 'stack'].forEach(k => localStorage.removeItem('LatentEye_' + id + '_' + k)); }
    function initHook() {
        try {
            const isDbg = localStorage.getItem('LatentEye_' + SCRIPT_ID + '_debugger') === '1';
            const isStack = localStorage.getItem('LatentEye_' + SCRIPT_ID + '_stack') === '1';
            const _fetch = window.fetch;
            if (!_fetch) return;
            window.fetch = function () {
                console.log('%c[LatentEye] fetch 请求', 'color:#10b981;font-weight:bold');
                for (let i = 0; i < arguments.length; i++) console.log(arguments[i]);
                if (isDbg) debugger;
                if (isStack) console.log(new Error().stack);
                return _fetch.apply(this, arguments);
            };
            window.fetch.__proto__ = _fetch.__proto__;
            clearCfg(SCRIPT_ID);
        } catch (e) { console.error('[LatentEye] hook_fetch:', e); }
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
