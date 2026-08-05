/* 潜影 LatentEye — hook_performance (主世界)
 * 固定 performance.now 返回值，绕过基于时间差的反调试。 */
(function () {
    'use strict';
    const SCRIPT_ID = 'hook_performance';
    function clearCfg(id) { ['value', 'flag', 'param', 'debugger', 'stack'].forEach(k => localStorage.removeItem('LatentEye_' + id + '_' + k)); }
    function initHook() {
        try {
            const val = parseFloat(localStorage.getItem('LatentEye_' + SCRIPT_ID + '_value') || '0') || 0;
            if (window.performance && performance.now) {
                performance.now = function () {
                    console.log('[LatentEye] performance.now() ->', val);
                    return val;
                };
            }
            console.log('[LatentEye] performance.now 已固定为', val);
            clearCfg(SCRIPT_ID);
        } catch (e) { console.error('[LatentEye] hook_performance:', e); }
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
