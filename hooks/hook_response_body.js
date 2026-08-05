/*
 * 响应体捕获 Hook（整合自 Heimdallr position5 规则匹配需求）
 *
 * 作用：在主世界 Hook window.fetch 与 XMLHttpRequest，
 *       捕获响应体文本后通过 postMessage 发给 content script，
 *       由 content script 转发 background 用 position5 规则匹配。
 *
 * 配置：通过 localStorage 读取开关（与 HAPPY JS 其它 Hook 一致）
 *   LatentEye_hook_response_body_flag = '1'  启用
 *
 * 注意：本脚本运行在主世界（MAIN world）。
 *       为避免性能问题，仅发送响应体前 200KB。
 */
(function () {
    'use strict';

    function readCfg() {
        try {
            const proto = Storage.prototype;
            const get = proto.getItem;
            return get.call(localStorage, 'LatentEye_hook_response_body_flag') === '1';
        } catch { return false; }
    }

    if (!readCfg()) return;
    if (window.__happyjsResponseBodyHooked) return;
    window.__happyjsResponseBodyHooked = true;

    const MAX_BODY = 200 * 1024; // 最多发送 200KB 响应体

    function sendBody(url, body, status) {
        try {
            const truncated = body.length > MAX_BODY ? body.slice(0, MAX_BODY) : body;
            window.postMessage({
                type: 'HAPPYJS_RESPONSE_BODY',
                url: url,
                body: truncated,
                status: status
            }, '*');
        } catch {}
    }

    /* ---------- Hook fetch ---------- */
    const originalFetch = window.fetch;
    if (originalFetch) {
        window.fetch = function () {
            const url = (arguments[0] instanceof Request) ? arguments[0].url : String(arguments[0]);
            const ret = originalFetch.apply(this, arguments);
            if (ret && typeof ret.then === 'function') {
                ret.then(response => {
                    try {
                        if (response.ok || response.status === 404) {
                            response.clone().text().then(text => {
                                if (text) sendBody(url, text, response.status);
                            }).catch(() => {});
                        }
                    } catch {}
                    return response;
                }).catch(() => {});
            }
            return ret;
        };
        // 伪装
        Object.defineProperty(window.fetch, 'toString', { value: () => 'function fetch() { [native code] }' });
    }

    /* ---------- Hook XMLHttpRequest ---------- */
    const OriginalXHR = window.XMLHttpRequest;
    if (OriginalXHR) {
        const originalOpen = OriginalXHR.prototype.open;
        const originalSend = OriginalXHR.prototype.send;

        OriginalXHR.prototype.open = function (method, url) {
            this.__happyjs_url = url;
            return originalOpen.apply(this, arguments);
        };

        OriginalXHR.prototype.send = function () {
            const self = this;
            const url = this.__happyjs_url;
            if (url) {
                this.addEventListener('load', function () {
                    try {
                        const status = self.status;
                        if (status === 200 || status === 404) {
                            const body = self.responseText || self.response;
                            if (body && typeof body === 'string') {
                                sendBody(url, body, status);
                            }
                        }
                    } catch {}
                });
            }
            return originalSend.apply(this, arguments);
        };

        Object.defineProperty(OriginalXHR.prototype.open, 'toString', { value: () => 'function open() { [native code] }' });
        Object.defineProperty(OriginalXHR.prototype.send, 'toString', { value: () => 'function send() { [native code] }' });
    }
})();