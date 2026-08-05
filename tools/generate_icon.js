/*
 * 使用用户提供的图片生成扩展图标 (优化版)
 * 源图片: ../微信图片_20260805111515_517_256.jpg
 * 输出: icons/icon16.png, icon32.png, icon48.png, icon128.png
 * 
 * 优化: 对于小尺寸(16, 32)使用contain模式，确保整个幽灵可见
 *       对于大尺寸(48, 128)使用cover模式，填满空间
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const SOURCE_IMAGE = path.join(__dirname, '..', '微信图片_20260805111515_517_256.jpg');
const OUTPUT_DIR = path.join(__dirname, '..', 'icons');

const SIZES = [16, 32, 48, 128];

async function generateIcons() {
    try {
        if (!fs.existsSync(SOURCE_IMAGE)) {
            console.error('错误: 找不到源图片文件', SOURCE_IMAGE);
            process.exit(1);
        }

        if (!fs.existsSync(OUTPUT_DIR)) {
            fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        }

        console.log('开始生成图标...');
        console.log('源图片:', SOURCE_IMAGE);
        
        const metadata = await sharp(SOURCE_IMAGE).metadata();
        console.log('源图片尺寸:', metadata.width, 'x', metadata.height);

        for (const size of SIZES) {
            const outputPath = path.join(OUTPUT_DIR, `icon${size}.png`);
            
            // 小尺寸使用contain，确保主体可见且有适当边距
            // 大尺寸使用cover，填满整个空间
            const useContain = size <= 32;
            
            if (useContain) {
                // contain模式: 保持比例，完整显示，填充透明背景
                await sharp(SOURCE_IMAGE)
                    .resize(size, size, {
                        fit: 'contain',
                        background: { r: 0, g: 0, b: 0, alpha: 0 } // 透明背景
                    })
                    .png()
                    .toFile(outputPath);
            } else {
                // cover模式: 保持比例，裁剪填充
                await sharp(SOURCE_IMAGE)
                    .resize(size, size, {
                        fit: 'cover',
                        position: 'centre'
                    })
                    .png()
                    .toFile(outputPath);
            }
            
            const stats = await fs.promises.stat(outputPath);
            console.log(`已生成: icon${size}.png (${stats.size} bytes)`);
        }

        console.log('\n图标生成完成！');
        console.log('策略: 16/32px 使用 contain (完整显示主体)');
        console.log('      48/128px 使用 cover (填满空间)');
        console.log('请重新加载浏览器扩展以使新图标生效。');
        
    } catch (error) {
        console.error('生成图标时出错:', error);
        process.exit(1);
    }
}

generateIcons();
