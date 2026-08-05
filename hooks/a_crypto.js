/* 潜影 LatentEye — hook_crypto (主世界)
 * Hook CryptoJS 的对称/哈希/HMAC 算法，打印算法名、密钥、明文、密文。
 * 支持 debugger 断点与堆栈打印。 */
(function () {
    'use strict';
    const SCRIPT_ID = 'hook_crypto';
    function clearCfg(id) { ['value', 'flag', 'param', 'debugger', 'stack'].forEach(k => localStorage.removeItem('LatentEye_' + id + '_' + k)); }

    let retryTimer = null; // 模块级：多次 initHook 时先清理上一个定时器，避免泄漏

    function initHook() {
        try {
            const isDbg = localStorage.getItem('LatentEye_' + SCRIPT_ID + '_debugger') === '1';
            const isStack = localStorage.getItem('LatentEye_' + SCRIPT_ID + '_stack') === '1';
            const ALGOS = ['AES', 'DES', 'TripleDES', 'Rabbit', 'RC4', 'RC4Drop', 'Blowfish',
                'MD5', 'SHA1', 'SHA224', 'SHA256', 'SHA384', 'SHA512', 'SHA3', 'RIPEMD160',
                'HmacMD5', 'HmacSHA1', 'HmacSHA256', 'HmacSHA512', 'PBKDF2', 'EvpKDF'];

            function tryHookCryptoJS(CryptoJS) {
                if (!CryptoJS) return false;
                ALGOS.forEach(name => {
                    const obj = CryptoJS[name];
                    if (!obj) return;
                    // 对称加密：encrypt/decrypt
                    ['encrypt', 'decrypt'].forEach(fn => {
                        const orig = obj[fn];
                        if (typeof orig !== 'function' || orig.__le_hooked) return;
                        const hooked = function () {
                            const result = orig.apply(this, arguments);
                            console.log(`%c[LatentEye] CryptoJS.${name}.${fn}`, 'color:#22d3ee;font-weight:bold',
                                '\n明文/密文:', arguments[0] && arguments[0].toString(),
                                '\n密钥:', arguments[1] && arguments[1].toString(),
                                '\n结果:', result && result.toString());
                            if (isDbg) debugger;
                            if (isStack) console.log(new Error().stack);
                            return result;
                        };
                        hooked.__le_hooked = true;
                        obj[fn] = hooked;
                    });
                    // 哈希直接调用（如 CryptoJS.MD5(msg)）
                    if (typeof obj === 'function' && !obj.__le_hooked) {
                        const hashOrig = obj;
                        const wrapper = function () {
                            const r = hashOrig.apply(this, arguments);
                            console.log(`%c[LatentEye] CryptoJS.${name}()`, 'color:#22d3ee;font-weight:bold',
                                '\n输入:', arguments[0] && arguments[0].toString(), '\n结果:', r && r.toString());
                            if (isDbg) debugger;
                            if (isStack) console.log(new Error().stack);
                            return r;
                        };
                        wrapper.__le_hooked = true;
                        try { CryptoJS[name] = wrapper; } catch {}
                    }
                });
                return true;
            }

            // 清理上一个定时器（多次 initHook 时避免泄漏）
            if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }

            // 立即尝试
            if (window.CryptoJS && tryHookCryptoJS(window.CryptoJS)) {
                console.log('[LatentEye] CryptoJS 已 Hook');
            } else {
                // 延迟尝试（懒加载场景）
                let tries = 0;
                retryTimer = setInterval(() => {
                    if (window.CryptoJS && tryHookCryptoJS(window.CryptoJS)) {
                        console.log('[LatentEye] CryptoJS 已 Hook(延迟)');
                        clearInterval(retryTimer); retryTimer = null;
                    } else if (++tries > 40) { clearInterval(retryTimer); retryTimer = null; }
                }, 250);
            }
            clearCfg(SCRIPT_ID);
        } catch (e) { console.error('[LatentEye] hook_crypto:', e); }
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
