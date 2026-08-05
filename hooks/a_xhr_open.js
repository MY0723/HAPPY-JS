/* 潜影 LatentEye — hook_xhr_open (主世界)
 * 捕获 XMLHttpRequest.open(url, method)。flag=1 按 param 关键字过滤 URL。 */
(function () {
    'use strict';
    const SCRIPT_ID = 'hook_xhr_open';
    function clearCfg(id) { ['value', 'flag', 'param', 'debugger', 'stack'].forEach(k => localStorage.removeItem('LatentEye_' + id + '_' + k)); }
    function initHook() {
        try {
            const flag = localStorage.getItem('LatentEye_' + SCRIPT_ID + '_flag');
            let param = []; try { param = JSON.parse(localStorage.getItem('LatentEye_' + SCRIPT_ID + '_param')) || []; } catch {}
            const isDbg = localStorage.getItem('LatentEye_' + SCRIPT_ID + '_debugger') === '1';
            const isStack = localStorage.getItem('LatentEye_' + SCRIPT_ID + '_stack') === '1';
            const _open = XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.open = function (method, url) {
                const u = String(url || '');
                const hit = flag === '1' && param.length
                    ? param.some(k => u.toLowerCase().includes(String(k).toLowerCase()))
                    : true;
                if (hit) {
                    console.log('%c[LatentEye] XHR.open', 'color:#3b82f6;font-weight:bold',
                        '\nmethod:', method, '\nurl:', u);
                    if (isDbg) debugger;
                    if (isStack) console.log(new Error().stack);
                }
                return _open.apply(this, arguments);
            };
            clearCfg(SCRIPT_ID);
        } catch (e) { console.error('[LatentEye] hook_xhr_open:', e); }
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
