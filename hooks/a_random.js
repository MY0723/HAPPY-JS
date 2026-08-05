/* 潜影 LatentEye — hook_random (主世界)
 * 固定 Math.random 返回值。固定值从 localStorage 读取(默认 0)。 */
(function () {
    'use strict';
    const SCRIPT_ID = 'hook_random';
    function clearCfg(id) { ['value', 'flag', 'param', 'debugger', 'stack'].forEach(k => localStorage.removeItem('LatentEye_' + id + '_' + k)); }
    function initHook() {
        try {
            const val = parseFloat(localStorage.getItem('LatentEye_' + SCRIPT_ID + '_value') || '0');
            const fixed = isNaN(val) ? 0 : Math.min(1, Math.max(0, val));
            const orig = Math.random;
            Math.random = function () {
                console.log('[LatentEye] Math.random() ->', fixed);
                return fixed;
            };
            console.log('[LatentEye] Math.random 已固定为', fixed);
            clearCfg(SCRIPT_ID);
        } catch (e) { console.error('[LatentEye] hook_random:', e); }
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
