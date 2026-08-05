/* 潜影 LatentEye — hook_history (主世界)
 * 拦截 history.go / history.back / history.forward，避免反调试跳转。 */
(function () {
    'use strict';
    const SCRIPT_ID = 'hook_history';
    function initHook() {
        try {
            ['go', 'back', 'forward'].forEach(m => {
                const orig = history[m];
                if (typeof orig === 'function') {
                    history[m] = function () {
                        console.log(`[LatentEye] 拦截 history.${m}(`, ...arguments, ')');
                    };
                }
            });
        } catch (e) { console.error('[LatentEye] hook_history:', e); }
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
