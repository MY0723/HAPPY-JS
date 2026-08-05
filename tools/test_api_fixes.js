/*
 * 验证 API 识别三项修复：
 *   1. webpack chunk 模板重建（补 add 分隔符 + base 可选 + hash 成对）
 *   2. API 正则放开 {}（匹配 /api/user/{id} 等 REST 模板路径）
 *   3. 运行时端点记录（逻辑较简单，仅验证静态扩展名过滤）
 */
const assert = require('assert');

/* ---- 1) webpack chunk 模板重建（复刻 content.js 修复后逻辑） ---- */
const WP_RE = /(?:(?<base>"[a-z-_/]*")\+)?(?<name_struct>(?:\(\{(?<name>[^{};=]*?:"[^{},;=]*?")?\}\[[a-z]\]\|\|[a-z]\))?[\w]?)?\+?(?<add>"."\+)?(?<hash_struct>\{(?<hash>[^{}=]*?:"[\w]*")?\}\[[a-z]\]\+)?(?<end>"[\w._-]*\.js")/i;

function reconstruct(src, chunk) {
    const found = new Set();
    const origin = new URL(src).origin;
    const baseDir = (u) => { const p = new URL(u).pathname.split('/'); p.pop(); return p.join('/') + '/'; };
    const tpl = chunk.match(WP_RE);
    if (!tpl || !tpl.groups) return found;
    let base = (tpl.groups.base || baseDir(src)).replace(/"/g, '');
    const end = (tpl.groups.end || '').replace(/"/g, '');
    const sep = tpl.groups.add ? '.' : '';
    if (!base.startsWith('/')) base = '/' + base;
    if (!base.endsWith('/')) base += '/';
    const hasNameStruct = !!tpl.groups.name_struct;
    const hashMap = tpl.groups.hash, nameMap = tpl.groups.name;
    if (hashMap) {
        hashMap.split(',').forEach(pair => {
            const ci = pair.indexOf(':');
            if (ci < 0) return;
            const chunkId = pair.slice(0, ci).replace(/"/g, '');
            const hash = pair.slice(ci + 1).replace(/"/g, '');
            if (hasNameStruct && chunkId) found.add(origin + base + chunkId + sep + hash + end);
            else if (hash) found.add(origin + base + hash + end);
        });
    } else if (nameMap) {
        nameMap.split(',').forEach(pair => {
            const n = pair.split(':')[0].replace(/"/g, '');
            if (n) found.add(origin + base + n + end);
        });
    }
    return found;
}

const SRC = 'http://120.246.54.42:7000/static/js/app.js';

// Pattern A: base + chunkId + "." + hashMap + ".js"  (最常见 webpack5 生产包)
let r = reconstruct(SRC, `__webpack_require__.u=function(e){return "static/js/"+e+"."+{"1":"a1b2c3d4","2":"e5f6g7h8"}[e]+".js"}`);
assert.ok(r.has('http://120.246.54.42:7000/static/js/1.a1b2c3d4.js'), `Pattern A 1.a1b2c3d4.js 失败: ${[...r]}`);
assert.ok(r.has('http://120.246.54.42:7000/static/js/2.e5f6g7h8.js'), `Pattern A 2.e5f6g7h8.js 失败: ${[...r]}`);
console.log('✓ Pattern A (base+add+hash):', [...r]);

// Pattern B: 无 base，e + "." + hash + ".js"
let r2 = reconstruct(SRC, `function(e){return e+"."+{"app":"abcd1234"}[e]+".js"}`);
assert.ok([...r2].some(u => /abcd1234\.js$/.test(u)), `Pattern B 无base 失败: ${[...r2]}`);
console.log('✓ Pattern B (无 base):', [...r2]);

// Pattern C: 仅 name 映射（无 hash）
let r3 = reconstruct(SRC, `function(e){return "static/js/"+{"0":"runtime","1":"vendor"}[e]+".js"}`);
assert.ok(r3.has('http://120.246.54.42:7000/static/js/runtime.js'), `Pattern C runtime.js 失败: ${[...r3]}`);
assert.ok(r3.has('http://120.246.54.42:7000/static/js/vendor.js'), `Pattern C vendor.js 失败: ${[...r3]}`);
console.log('✓ Pattern C (仅 name):', [...r3]);

// 旧 bug 回归：不应出现缺点号的 appa1b2c3d4.js
assert.ok(![...r].some(u => /appa1b2c3d4\.js/.test(u)), '回归失败：仍出现缺点号 URL');
console.log('✓ 回归：无缺点号 URL');

/* ---- 2) API 正则放开 {} ---- */
const API_RE = /['"`](?:\/|\.\.\/|\.\/)[^/>< ()},'"\\][^^>< (),'"\\]*?['"`]|['"`][a-zA-Z0-9]+(?<!text|application)\/(?:[^^>< (){},'"\\])*?["'`]/g;
const cases = [
    ['"/api/user/{id}"', '/api/user/{id}'],
    ['"/api/{module}/list"', '/api/{module}/list'],
    ['"/order/{orderId}/detail"', '/order/{orderId}/detail'],
    ['"/api/v1/users"', '/api/v1/users'],
    ['`/api/foo/bar`', '/api/foo/bar'],
];
for (const [inp, expect] of cases) {
    const m = inp.match(API_RE);
    assert.ok(m && m[0] === inp, `API 正则未匹配 ${inp}: ${m}`);
    assert.ok(m[0].includes(expect), `API 正则匹配内容异常 ${inp}: ${m[0]}`);
}
console.log('✓ API 正则匹配 {} 模板路径:', cases.map(c => c[1]));

/* ---- 3) 静态扩展名过滤（运行时端点不记录静态资源） ---- */
const IMG = /\.(jpg|jpeg|png|gif|bmp|webp|svg|ico|mp3|mp4|m4a|wav|swf)(?:\?[^'"]*)?$/i;
const JS = /\.(js|jsx|ts|tsx|mjs)(?:\?[^'"]*)?$/i;
const FONT = /\.(ttf|eot|woff|woff2|otf|css)(?:\?[^'"]*)?$/i;
const DOC = /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|exe|apk|zip|7z|rar|dll|dmg|txt|csv|md)(?:\?[^'"]*)?$/i;
const isStatic = u => JS.test(u) || IMG.test(u) || FONT.test(u) || DOC.test(u);
assert.ok(isStatic('http://h/a.png'), 'png 未过滤');
assert.ok(isStatic('http://h/a.js?x=1'), 'js 未过滤');
assert.ok(isStatic('http://h/a.css'), 'css 未过滤');
assert.ok(!isStatic('http://h/api/users'), 'api/users 被误过滤');
assert.ok(!isStatic('http://h/api/v1/order/123'), 'api 路径被误过滤');
console.log('✓ 静态扩展名过滤正确，API 路径保留');

console.log('\n全部通过 ✔');
