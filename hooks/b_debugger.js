/* 潜影 LatentEye — bypass_debugger (主世界)
 * 绕过无限 Debugger：Hook eval / Function 构造函数，
 * 移除其中的 debugger 语句。
 * 通过让 stripDebugger.prototype.constructor === stripDebugger，
 * 使 (function(){}).constructor('debugger')() 也走 hook，无需单独改原型。 */
(function () {
    'use strict';
    const SCRIPT_ID = 'bypass_debugger';

    function stripDebuggerArgs(args) {
        for (let i = 0; i < args.length; i++) {
            if (typeof args[i] === 'string') {
                args[i] = args[i].replace(/debugger/g, '');
            }
        }
        return args;
    }

    function initHook() {
        try {
            // 1. Hook eval
            const _eval = window.eval;
            window.eval = function () {
                if (typeof arguments[0] === 'string') {
                    arguments[0] = arguments[0].replace(/debugger/g, '');
                }
                return _eval.apply(this, arguments);
            };

            // 2. Hook Function 构造函数
            const _Function = Function;
            function stripDebugger() {
                return _Function.apply(this, stripDebuggerArgs(arguments));
            }
            // 保留原型链：stripDebugger.prototype === 原 Function.prototype
            // 这样 new Function(...) 创建的对象原型正确，instanceof Function 仍成立
            stripDebugger.prototype = _Function.prototype;
            // 让 Function.prototype.constructor 指向 stripDebugger，
            // 从而 (function(){}).constructor === stripDebugger，自动被 hook
            _Function.prototype.constructor = stripDebugger;
            window.Function = stripDebugger;
        } catch (e) { console.error('[LatentEye] bypass_debugger:', e); }
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
