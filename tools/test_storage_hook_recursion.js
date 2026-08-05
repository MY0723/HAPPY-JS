/* 运行时验证：hook_storage_get/set 修复后不再递归栈溢出 */
const fs = require('fs');
const vm = require('vm');

// ---- mock 浏览器环境 ----
const store = new Map();
const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
};
const sessionStorage = { _s: new Map(), getItem(k){return this._s.has(k)?this._s.get(k):null}, setItem(k,v){this._s.set(k,String(v))}, removeItem(k){this._s.delete(k)} };
// Storage.prototype.getItem（原生入口，hook 不会替换它）
const Storage = { prototype: { getItem: localStorage.getItem } };

// 预置配置（模拟 content.js syncHookConfig 写入）
localStorage.setItem('LatentEye_hook_storage_get_flag', '1');
localStorage.setItem('LatentEye_hook_storage_get_param', JSON.stringify(['token']));
localStorage.setItem('LatentEye_hook_storage_get_debugger', '0');
localStorage.setItem('LatentEye_hook_storage_get_stack', '0');

const windowObj = {
    localStorage, sessionStorage,
    Storage,
    addEventListener: () => {},
    postMessage: () => {},
};

const sandbox = {
    window: windowObj,
    localStorage, sessionStorage, Storage,
    console,
    setTimeout, setInterval, clearInterval,
    Error,
};
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

// ---- 加载 hook 脚本 ----
const code = fs.readFileSync(require('path').join(__dirname, '..', 'hooks', 'hook_storage_get.js'), 'utf8');
vm.runInContext(code, sandbox);

// ---- 模拟 content.js 发送 HOOK_CONFIG_READY ----
// hook_storage_get.js 注册了 window.addEventListener('message', ...)，但因为 mock 的 addEventListener 是 no-op，
// 我们需要手动触发。改成直接调用 initHook 的方式：通过 postMessage 触发不可行，改为手动调用 setup 注册的监听器。
// 这里我们验证核心：readCfg 使用 Storage.prototype.getItem 不触发 hook。

// 直接 mock：手动构造一个假的 message event 并调用 window 上注册的监听器
let msgHandler = null;
windowObj.addEventListener = (type, cb) => { if (type === 'message') msgHandler = cb; };
// 重新加载（这次会真正注册监听器）
vm.runInContext(code, sandbox);

// 触发 HOOK_CONFIG_READY
msgHandler({
    source: windowObj,
    data: { source: 'latenteye-extension', type: 'HOOK_CONFIG_READY', scriptIds: ['hook_storage_get'] }
});

// ---- 验证：调用 localStorage.getItem，不应递归 ----
let depth = 0;
let ok = true;
const origGetItem = localStorage.getItem;
// 此时 localStorage.getItem 已被 hook 替换
console.log('localStorage.getItem 已被 hook:', localStorage.getItem !== origGetItem);

try {
    // 调用被 hook 的 getItem 读取一个 token 键（应命中关键字过滤并打印日志，但不应递归）
    const r = localStorage.getItem('user_token');
    console.log('✅ 调用 localStorage.getItem(user_token) 未栈溢出，返回:', r);

    // 再调用一次非关键字的键
    localStorage.getItem('foo');
    console.log('✅ 调用 localStorage.getItem(foo) 未栈溢出');

    // 同时启用 hook_storage_set 验证不互相递归
    const code2 = fs.readFileSync(require('path').join(__dirname, '..', 'hooks', 'hook_storage_set.js'), 'utf8');
    let msgHandler2 = null;
    const origAdd = windowObj.addEventListener;
    windowObj.addEventListener = (type, cb) => { if (type === 'message') { msgHandler2 = cb; } };
    vm.runInContext(code2, sandbox);
    // 触发 set 的 HOOK_CONFIG_READY
    msgHandler2({
        source: windowObj,
        data: { source: 'latenteye-extension', type: 'HOOK_CONFIG_READY', scriptIds: ['hook_storage_set'] }
    });
    localStorage.setItem('user_token', 'abc123');
    console.log('✅ 同时启用 set+get 后 localStorage.setItem 未栈溢出');
    localStorage.getItem('user_token');
    console.log('✅ 同时启用 set+get 后 localStorage.getItem 未栈溢出');
} catch (e) {
    ok = false;
    console.log('❌ 失败:', e.message);
    console.log(e.stack);
}

console.log(ok ? '\n🎉 全部通过：递归 bug 已修复' : '\n💥 存在问题');
process.exit(ok ? 0 : 1);
