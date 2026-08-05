/* 潜影 LatentEye — hook_close (主世界)
 * 拦截 window.close，避免反调试关闭页面。 */
(function () {
    'use strict';
    const SCRIPT_ID = 'hook_close';
    function initHook() {
        try {
            window.close = function () {
                console.log('[LatentEye] 拦截 window.close 调用');
            };
        } catch (e) { console.error('[LatentEye] hook_close:', e); }
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
