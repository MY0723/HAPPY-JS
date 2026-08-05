/*
 * HAPPY JS 图标生成器（纯 Node.js，无外部依赖）
 * 生成 icons/icon16.png icon32.png icon48.png icon128.png
 *
 * 设计 D：靛蓝圆角方形 + 中央 'JS' 字样 + 右上角小闪电
 * 主色 #1f3fd6（深靛蓝，专业安全工具风），闪电 #ffd84d（金黄）
 * 呼应 Postman/Burp 这类工具的「专业但有活力」气质
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.join(__dirname, '..', 'icons');

/* ---------- 极简 PNG 编码器（RGBA8 + zlib） ---------- */
function crc32(buf) {
    let c = ~0;
    for (let i = 0; i < buf.length; i++) {
        c ^= buf[i];
        for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
    }
    return ~c >>> 0;
}
function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function encodePng(width, height, rgba) {
    const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    const stride = width * 4;
    const raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y++) {
        raw[y * (stride + 1)] = 0;
        rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
    }
    const idat = zlib.deflateSync(raw, { level: 9 });
    return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------- 画布辅助 ---------- */
function newCanvas(size) { return { size, buf: Buffer.alloc(size * size * 4) }; }
function setPx(c, x, y, r, g, b, a) {
    if (x < 0 || y < 0 || x >= c.size || y >= c.size) return;
    const i = (y * c.size + x) * 4;
    const sa = a / 255, da = c.buf[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    if (oa <= 0) return;
    c.buf[i]     = Math.round((r * sa + c.buf[i]     * da * (1 - sa)) / oa);
    c.buf[i + 1] = Math.round((g * sa + c.buf[i + 1] * da * (1 - sa)) / oa);
    c.buf[i + 2] = Math.round((b * sa + c.buf[i + 2] * da * (1 - sa)) / oa);
    c.buf[i + 3] = Math.round(oa * 255);
}
// 圆角矩形填充（含反走样边缘）
function fillRoundRect(c, x0, y0, x1, y1, radius, r, g, b) {
    for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
            const cx = Math.min(Math.max(x, x0 + radius), x1 - 1 - radius);
            const cy = Math.min(Math.max(y, y0 + radius), y1 - 1 - radius);
            const dx = (x + 0.5) - (cx + 0.5);
            const dy = (y + 0.5) - (cy + 0.5);
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d > radius) continue;
            let aa = 255;
            if (d > radius - 1) aa = 255 * (radius - d);
            setPx(c, x, y, r, g, b, aa);
        }
    }
}
// 实心圆（反走样）
function disc(c, cx, cy, radius, r, g, b, a = 255) {
    const minX = Math.floor(cx - radius - 1), maxX = Math.ceil(cx + radius + 1);
    const minY = Math.floor(cy - radius - 1), maxY = Math.ceil(cy + radius + 1);
    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d >= radius + 0.5) continue;
            const aa = d <= radius - 0.5 ? a : a * (radius + 0.5 - d);
            if (aa > 0) setPx(c, x, y, r, g, b, aa);
        }
    }
}
// 实心矩形（含反走样边缘）
function fillRect(c, x0, y0, x1, y1, r, g, b) {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) setPx(c, x, y, r, g, b, 255);
}
// 反走样线段
function aaline(c, x0, y0, x1, y1, thick, r, g, b, a = 255) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len === 0) return;
    const ux = (x1 - x0) / len, uy = (y1 - y0) / len;
    const minX = Math.floor(Math.min(x0, x1) - thick), maxX = Math.ceil(Math.max(x0, x1) + thick);
    const minY = Math.floor(Math.min(y0, y1) - thick), maxY = Math.ceil(Math.max(y0, y1) + thick);
    for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            const px = x + 0.5 - x0, py = y + 0.5 - y0;
            let t = px * ux + py * uy;
            t = Math.max(0, Math.min(len, t));
            const dx = x + 0.5 - (x0 + ux * t), dy = y + 0.5 - (y0 + uy * t);
            const d = Math.sqrt(dx * dx + dy * dy) - thick / 2;
            if (d >= 1) continue;
            const aa = d <= 0 ? a : a * (1 - d);
            if (aa > 0) setPx(c, x, y, r, g, b, aa);
        }
    }
}
// 多边形填充（用于闪电形状），顶点顺时针/逆时针均可
function fillPolygon(c, pts, r, g, b) {
    const ys = pts.map(p => p[1]);
    const ymin = Math.floor(Math.min(...ys));
    const ymax = Math.ceil(Math.max(...ys));
    for (let y = ymin; y <= ymax; y++) {
        const xs = [];
        for (let i = 0; i < pts.length; i++) {
            const [x1, y1] = pts[i];
            const [x2, y2] = pts[(i + 1) % pts.length];
            if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
                xs.push(x1 + (y - y1) * (x2 - x1) / (y2 - y1));
            }
        }
        if (xs.length < 2) continue;
        const xLo = Math.max(0, Math.floor(Math.min(...xs)));
        const xHi = Math.min(c.size - 1, Math.ceil(Math.max(...xs)));
        for (let x = xLo; x <= xHi; x++) setPx(c, x, y, r, g, b, 255);
    }
}

/* ---------- 主题色 ---------- */
const BG = [31, 63, 214];       // #1f3fd6 深靛蓝（专业安全工具风）
const BG_DARK = [18, 38, 138];  // #12268a 角落阴影
const WHITE = [255, 255, 255];
const BOLT = [255, 216, 77];    // #ffd84d 金黄闪电
const BOLT_DARK = [230, 175, 30]; // 闪电暗调描边

/* ---------- 5x7 点阵字库（仅 JS 字母所需） ---------- */
// 用最常见的 5x7 点阵字体手工绘制 'J' 和 'S'
const FONT_5x7 = {
    'J': [
        '00100',
        '00000',
        '00100',
        '00100',
        '00100',
        '00100',
        '11000',
    ],
    'S': [
        '01110',
        '10001',
        '10000',
        '01110',
        '00001',
        '10001',
        '01110',
    ],
};
// 渲染一个字符到画布（白底），给定左上角 (x,y) 与单元像素大小 px
function drawChar(c, ch, x0, y0, px, r, g, b) {
    const glyph = FONT_5x7[ch];
    if (!glyph) return;
    for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 5; col++) {
            if (glyph[row][col] === '1') {
                fillRect(c, x0 + col * px, y0 + row * px, x0 + (col + 1) * px, y0 + (row + 1) * px, r, g, b);
            }
        }
    }
}

/* ---------- 绘制单个尺寸图标 ---------- */
function drawIcon(size) {
    const c = newCanvas(size);
    const S = size;

    // 1) 主底：圆角方形（深靛蓝）—— 占满全部画布
    const rad = Math.max(2, Math.round(S * 0.22));
    fillRoundRect(c, 0, 0, S, S, rad, BG[0], BG[1], BG[2]);

    // 角落暗调：左上→右下对角线阴影，制造层次感
    for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
            const cx = Math.min(Math.max(x, rad), S - 1 - rad);
            const cy = Math.min(Math.max(y, rad), S - 1 - rad);
            const dx = (x + 0.5) - (cx + 0.5);
            const dy = (y + 0.5) - (cy + 0.5);
            if (Math.sqrt(dx * dx + dy * dy) > rad) continue;
            // 越靠近右下角越深
            const t = (x + y) / (2 * S);
            if (t > 0.55) {
                const f = (t - 0.55) / 0.45; // 0..1
                setPx(c, x, y,
                    Math.round(BG[0] + (BG_DARK[0] - BG[0]) * f),
                    Math.round(BG[1] + (BG_DARK[1] - BG[1]) * f),
                    Math.round(BG[2] + (BG_DARK[2] - BG[2]) * f), 255);
            }
        }
    }

    // 2) 中央 'JS' 文字（白色点阵字体）
    // 字符宽度 5*px + 1*px 间距 + 5*px = 11*px 总宽
    // 高度 7*px
    const px = Math.max(1, Math.round(S * 0.072));  // 单元像素大小
    const totalW = 11 * px;
    const totalH = 7 * px;
    const textX0 = Math.round((S - totalW) / 2);
    const textY0 = Math.round((S - totalH) / 2 - S * 0.04); // 略偏上，给闪电留点垂直空间
    drawChar(c, 'J', textX0, textY0, px, WHITE[0], WHITE[1], WHITE[2]);
    drawChar(c, 'S', textX0 + 6 * px, textY0, px, WHITE[0], WHITE[1], WHITE[2]);

    // 3) 右上角小闪电（金黄，描深色边）
    // 闪电形状顶点（相对锚点 0,0 在闪电中心），锚点位置在右上角
    const boltAnchorX = S * 0.78;
    const boltAnchorY = S * 0.22;
    const boltScale = S * 0.18; // 控制闪电大小
    function bolt(x, y) { return [boltAnchorX + x * boltScale, boltAnchorY + y * boltScale]; }
    // 闪电外轮廓（经典锯齿闪电）
    const pts = [
        bolt( 0.0, -1.0),   // 顶点（上）
        bolt(-0.5,  0.0),   // 左中
        bolt(-0.1,  0.0),   // 内凹
        bolt(-0.4,  1.0),   // 底尖
        bolt( 0.6, -0.1),   // 右中（最右）
        bolt( 0.1, -0.1),   // 内凹
        bolt( 0.4, -0.9),   // 回到顶部附近
    ];
    // 描深色边（先画大一点的深色多边形当描边）
    const ptsEdge = pts.map(([x, y]) => [x * 1.12, y * 1.12]);
    fillPolygon(c, ptsEdge, BOLT_DARK[0], BOLT_DARK[1], BOLT_DARK[2]);
    fillPolygon(c, pts, BOLT[0], BOLT[1], BOLT[2]);
    // 高光：闪电左半画一根细白线
    aaline(c, boltAnchorX, boltAnchorY - boltScale * 0.6,
               boltAnchorX - boltScale * 0.15, boltAnchorY,
               Math.max(0.5, S * 0.012), 255, 255, 255, 180);

    return c.buf;
}

/* ---------- 主流程 ---------- */
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
[16, 32, 48, 128].forEach(size => {
    const rgba = drawIcon(size);
    const png = encodePng(size, size, rgba);
    const outPath = path.join(OUT_DIR, `icon${size}.png`);
    fs.writeFileSync(outPath, png);
    console.log(`written ${outPath} (${png.length} bytes)`);
});
console.log('done.');