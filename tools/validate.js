/* HAPPY JS — manifest 资源一致性校验 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
let errors = 0, ok = 0;
const check = (rel, label) => {
    const full = path.join(root, rel);
    if (fs.existsSync(full)) { ok++; console.log(`  ✓ ${label}: ${rel}`); }
    else { errors++; console.error(`  ✗ ${label}: ${rel}  [MISSING]`); }
};

console.log('=== manifest.json 资源校验 ===');

// background
if (manifest.background?.service_worker) check(manifest.background.service_worker, 'background.service_worker');
(manifest.background?.scripts || []).forEach(f => check(f, 'background.scripts'));

// content_scripts
(manifest.content_scripts || []).forEach(cs => {
    (cs.js || []).forEach(f => check(f, 'content_scripts.js'));
});

// action
check(manifest.action?.default_popup, 'action.default_popup');
Object.values(manifest.action?.default_icon || {}).forEach(f => check(f, 'action.default_icon'));
Object.values(manifest.icons || {}).forEach(f => check(f, 'icons'));

// web_accessible_resources
(manifest.web_accessible_resources || []).forEach(group => {
    (group.resources || []).forEach(r => {
        // 通配符资源：检查目录是否存在
        if (r.includes('*')) {
            const dir = path.join(root, path.dirname(r));
            if (fs.existsSync(dir)) { ok++; console.log(`  ✓ war (dir): ${r}`); }
            else { errors++; console.error(`  ✗ war (dir): ${r}  [MISSING]`); }
        } else {
            check(r, 'war');
        }
    });
});

// hooks.json 与 hooks/*.js 一致性
console.log('\n=== hooks.json ↔ hooks/*.js 一致性 ===');
const hooksMeta = JSON.parse(fs.readFileSync(path.join(root, 'hooks.json'), 'utf8'));
const hookFiles = fs.readdirSync(path.join(root, 'hooks')).filter(f => f.endsWith('.js')).map(f => f.replace(/\.js$/, ''));
const metaIds = hooksMeta.map(h => h.id);
const missingFiles = metaIds.filter(id => !hookFiles.includes(id));
const orphanFiles = hookFiles.filter(id => !metaIds.includes(id));
if (missingFiles.length) { errors++; console.error(`  ✗ hooks.json 中有 id 缺少对应 .js: ${missingFiles.join(', ')}`); }
else { ok++; console.log(`  ✓ hooks.json 的 ${metaIds.length} 个 id 均有对应 .js 文件`); }
if (orphanFiles.length) console.warn(`  ! hooks/ 下有未注册的脚本: ${orphanFiles.join(', ')}`);

// popup 内部引用
console.log('\n=== popup 内部引用 ===');
const popupHtml = fs.readFileSync(path.join(root, 'popup/popup.html'), 'utf8');
const popupRefs = [...popupHtml.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]);
popupRefs.forEach(r => {
    const full = path.join(root, 'popup', r);
    if (fs.existsSync(full)) { ok++; console.log(`  ✓ popup.html ref: ${r}`); }
    else { errors++; console.error(`  ✗ popup.html ref: ${r}  [MISSING]`); }
});

console.log(`\n=== 结果: ${ok} OK, ${errors} 错误 ===`);
process.exit(errors ? 1 : 0);
