/* 潜影 LatentEye — hook_console (主世界)
 * 保护 console 方法不被重写，并禁止 console.clear 清空控制台。 */
(function () {
    'use strict';
    const SCRIPT_ID = 'hook_console';

    function initHook() {
        try {
            const methods = ['log', 'info', 'warn', 'error', 'debug', 'table', 'dir', 'group', 'groupEnd', 'trace'];
            methods.forEach(m => {
                const orig = console[m];
                if (typeof orig === 'function') {
                    try {
                        Object.defineProperty(console, m, {
                            value: orig, configurable: false, writable: false
                        });
                    } catch { /* 已锁定则忽略 */ }
                }
            });
            // 禁止 clear
            console.clear = function () { /* no-op */ };
        } catch (e) { console.error('[LatentEye] hook_console:', e); }
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
