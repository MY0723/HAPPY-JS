/* 潜影 LatentEye — fixed_window (主世界)
 * 固定窗口尺寸，绕过检测控制台是否打开的脚本。
 * 固定值格式: "宽x高" 例如 "1366x660" */
(function () {
    'use strict';
    const SCRIPT_ID = 'fixed_window';

    function clearCfg(id) {
        ['value', 'flag', 'param', 'debugger', 'stack'].forEach(k =>
            localStorage.removeItem('LatentEye_' + id + '_' + k));
    }

    function initHook() {
        try {
            const raw = localStorage.getItem('LatentEye_' + SCRIPT_ID + '_value') || '1366x660';
            const m = raw.match(/(\d+)\s*[x×*]\s*(\d+)/i);
            const w = m ? parseInt(m[1]) : 1366;
            const h = m ? parseInt(m[2]) : 660;
            try { Object.defineProperty(window, 'innerWidth', { get: () => w, configurable: true }); } catch {}
            try { Object.defineProperty(window, 'innerHeight', { get: () => h, configurable: true }); } catch {}
            try { Object.defineProperty(window, 'outerWidth', { get: () => w + 34, configurable: true }); } catch {}
            try { Object.defineProperty(window, 'outerHeight', { get: () => h + 100, configurable: true }); } catch {}
            console.log(`[LatentEye] 固定窗口尺寸: inner ${w}x${h}`);
            clearCfg(SCRIPT_ID);
        } catch (e) { console.error('[LatentEye] fixed_window:', e); }
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
