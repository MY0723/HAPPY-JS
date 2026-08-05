/* 潜影 LatentEye — hook_json (主世界)
 * 捕获 JSON.stringify 与 JSON.parse。flag=1 按 param 关键字过滤(匹配输入字符串)。 */
(function () {
    'use strict';
    const SCRIPT_ID = 'hook_json';
    function clearCfg(id) { ['value', 'flag', 'param', 'debugger', 'stack'].forEach(k => localStorage.removeItem('LatentEye_' + id + '_' + k)); }
    function initHook() {
        try {
            const flag = localStorage.getItem('LatentEye_' + SCRIPT_ID + '_flag');
            let param = []; try { param = JSON.parse(localStorage.getItem('LatentEye_' + SCRIPT_ID + '_param')) || []; } catch {}
            const isDbg = localStorage.getItem('LatentEye_' + SCRIPT_ID + '_debugger') === '1';
            const isStack = localStorage.getItem('LatentEye_' + SCRIPT_ID + '_stack') === '1';
            const match = (s) => {
                if (flag !== '1' || !param.length) return true;
                const str = typeof s === 'string' ? s : (function () { try { return JSON.stringify(s); } catch { return String(s); } })();
                return param.some(k => str.toLowerCase().includes(String(k).toLowerCase()));
            };

            const _stringify = JSON.stringify;
            JSON.stringify = function () {
                if (match(arguments[0])) {
                    console.log('%c[LatentEye] JSON.stringify', 'color:#eab308;font-weight:bold', '\n输入:', arguments[0]);
                    if (isDbg) debugger;
                    if (isStack) console.log(new Error().stack);
                }
                return _stringify.apply(this, arguments);
            };

            const _parse = JSON.parse;
            JSON.parse = function () {
                const r = _parse.apply(this, arguments);
                if (match(arguments[0])) {
                    console.log('%c[LatentEye] JSON.parse', 'color:#eab308;font-weight:bold', '\n输入:', arguments[0], '\n结果:', r);
                    if (isDbg) debugger;
                    if (isStack) console.log(new Error().stack);
                }
                return r;
            };
            clearCfg(SCRIPT_ID);
        } catch (e) { console.error('[LatentEye] hook_json:', e); }
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
