/* 潜影 LatentEye — hook_date (主世界)
 * 固定 Date.now 返回值。 */
(function () {
    'use strict';
    const SCRIPT_ID = 'hook_date';
    function clearCfg(id) { ['value', 'flag', 'param', 'debugger', 'stack'].forEach(k => localStorage.removeItem('LatentEye_' + id + '_' + k)); }
    function initHook() {
        try {
            const val = parseInt(localStorage.getItem('LatentEye_' + SCRIPT_ID + '_value') || '0', 10) || 0;
            Date.now = function () {
                console.log('[LatentEye] Date.now() ->', val);
                return val;
            };
            // 兼容部分代码通过实例调用 now（非标准，但反调试脚本偶有使用）
            Date.prototype.now = function () { return val; };
            console.log('[LatentEye] Date.now 已固定为', val);
            clearCfg(SCRIPT_ID);
        } catch (e) { console.error('[LatentEye] hook_date:', e); }
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
