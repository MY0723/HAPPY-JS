/* 潜影 LatentEye — hook_xhr_header (主世界)
 * 捕获 XMLHttpRequest.setRequestHeader(header, value)。flag=1 按 param 关键字过滤。 */
(function () {
    'use strict';
    const SCRIPT_ID = 'hook_xhr_header';
    function clearCfg(id) { ['value', 'flag', 'param', 'debugger', 'stack'].forEach(k => localStorage.removeItem('LatentEye_' + id + '_' + k)); }
    function initHook() {
        try {
            const flag = localStorage.getItem('LatentEye_' + SCRIPT_ID + '_flag');
            let param = []; try { param = JSON.parse(localStorage.getItem('LatentEye_' + SCRIPT_ID + '_param')) || []; } catch {}
            const isDbg = localStorage.getItem('LatentEye_' + SCRIPT_ID + '_debugger') === '1';
            const isStack = localStorage.getItem('LatentEye_' + SCRIPT_ID + '_stack') === '1';
            const _set = XMLHttpRequest.prototype.setRequestHeader;
            XMLHttpRequest.prototype.setRequestHeader = function (header, value) {
                const h = String(header || '');
                const hit = flag === '1' && param.length
                    ? param.some(k => h.toLowerCase().includes(String(k).toLowerCase()))
                    : true;
                if (hit) {
                    console.log('%c[LatentEye] XHR.setHeader', 'color:#8b5cf6;font-weight:bold',
                        '\n', h + ':', value);
                    if (isDbg) debugger;
                    if (isStack) console.log(new Error().stack);
                }
                return _set.apply(this, arguments);
            };
            clearCfg(SCRIPT_ID);
        } catch (e) { console.error('[LatentEye] hook_xhr_header:', e); }
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
