/* 潜影 LatentEye — hook_storage_set (主世界)
 * 捕获 localStorage / sessionStorage.setItem。flag=1 按 param 关键字过滤键名。
 * 注意：配置在 initHook 时一次性读取（闭包持有），避免在 hook 内调用
 *       localStorage.getItem 触发 hook_storage_get 的 hook 造成递归。 */
(function () {
    'use strict';
    const SCRIPT_ID = 'hook_storage_set';
    function clearCfg(id) { ['value', 'flag', 'param', 'debugger', 'stack'].forEach(k => localStorage.removeItem('LatentEye_' + id + '_' + k)); }

    function hookStorage(storage, label, cfg) {
        const _set = storage.setItem;
        storage.setItem = function (key, value) {
            const k = String(key || '');
            const hit = cfg.flag === '1' && cfg.param.length
                ? cfg.param.some(p => k.toLowerCase().includes(String(p).toLowerCase()))
                : true;
            if (hit) {
                console.log(`%c[LatentEye] ${label}.setItem`, 'color:#ec4899;font-weight:bold',
                    '\nkey:', k, '\nvalue:', value);
                if (cfg.isDbg) debugger;
                if (cfg.isStack) console.log(new Error().stack);
            }
            return _set.apply(this, arguments);
        };
    }

    function readCfg() {
        // 使用原生 getItem 读取，避免触发 hook_storage_get 的 hook
        const get = Storage.prototype.getItem;
        const flag = get.call(localStorage, 'LatentEye_' + SCRIPT_ID + '_flag');
        let param = []; try { param = JSON.parse(get.call(localStorage, 'LatentEye_' + SCRIPT_ID + '_param')) || []; } catch {}
        const isDbg = get.call(localStorage, 'LatentEye_' + SCRIPT_ID + '_debugger') === '1';
        const isStack = get.call(localStorage, 'LatentEye_' + SCRIPT_ID + '_stack') === '1';
        return { flag, param, isDbg, isStack };
    }

    function initHook() {
        try {
            const cfg = readCfg();
            hookStorage(localStorage, 'localStorage', cfg);
            hookStorage(sessionStorage, 'sessionStorage', cfg);
            clearCfg(SCRIPT_ID);
        } catch (e) { console.error('[LatentEye] hook_storage_set:', e); }
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
