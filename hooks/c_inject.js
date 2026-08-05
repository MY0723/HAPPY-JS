/*
 * Canvas 指纹干扰（整合自 Heimdallr by Ghroth）
 * 文档：https://github.com/graynjo/Heimdallr
 *
 * 作用：在网页调用 Canvas API（toBlob/toDataURL/getImageData）时，
 *       向像素数据注入随机扰动，使 Canvas 指纹每次都不同，
 *       防止网站通过 Canvas 指纹追踪用户。
 *
 * 配置：通过 localStorage 读取开关（与 HAPPY JS 其它 Hook 一致）
 *   LatentEye_canvas_inject_flag = '1'  启用
 *
 * 注意：本脚本运行在主世界（MAIN world），与 Heimdallr 原始实现一致。
 */
(function () {
    'use strict';

    // 读取配置（使用原生 getItem 避免触发自身 hook）
    function readCfg() {
        try {
            const proto = Storage.prototype;
            const get = proto.getItem;
            return get.call(localStorage, 'LatentEye_canvas_inject_flag') === '1';
        } catch { return false; }
    }

    if (!readCfg()) return;

    // 防止重复注入
    if (window.__happyjsCanvasInjected) return;
    window.__happyjsCanvasInjected = true;

    const OriginalToBlob = HTMLCanvasElement.prototype.toBlob;
    const OriginalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    const OriginalGetImageData = CanvasRenderingContext2D.prototype.getImageData;

    // 每次注入使用一组随机偏移（同页内保持一致，跨页/跨刷新变化）
    const randomRGBA = {
        r: Math.floor(Math.random() * 255),
        g: Math.floor(Math.random() * 255),
        b: Math.floor(Math.random() * 255),
        a: Math.floor(Math.random() * 255)
    };

    // 对 Canvas 像素数据施加扰动（加法取模，不破坏图像可见性）
    function interfere(canvasElement, context2d) {
        if (!context2d) return;
        const width = canvasElement.width;
        const height = canvasElement.height;
        if (!width || !height) return;

        const imageData = OriginalGetImageData.apply(context2d, [0, 0, width, height]);
        for (let i = 0; i < height; i++) {
            for (let j = 0; j < width; j++) {
                const n = (i * (width * 4)) + (j * 4);
                imageData.data[n + 0] = (imageData.data[n + 0] + randomRGBA.r) >= 255
                    ? (imageData.data[n + 0] + randomRGBA.r - 255)
                    : (imageData.data[n + 0] + randomRGBA.r);
                imageData.data[n + 1] = (imageData.data[n + 1] + randomRGBA.g) >= 255
                    ? (imageData.data[n + 1] + randomRGBA.g - 255)
                    : (imageData.data[n + 1] + randomRGBA.g);
                imageData.data[n + 2] = (imageData.data[n + 2] + randomRGBA.b) >= 255
                    ? (imageData.data[n + 2] + randomRGBA.b - 255)
                    : (imageData.data[n + 2] + randomRGBA.b);
                imageData.data[n + 3] = (imageData.data[n + 3] + randomRGBA.a) >= 255
                    ? (imageData.data[n + 3] + randomRGBA.a - 255)
                    : (imageData.data[n + 3] + randomRGBA.a);
            }
        }
        context2d.putImageData(imageData, 0, 0);
    }

    // Hook toBlob
    Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
        value: function () {
            interfere(this, this.getContext('2d'));
            return OriginalToBlob.apply(this, arguments);
        },
        configurable: true
    });
    Object.defineProperty(HTMLCanvasElement.prototype.toBlob, 'length', { value: 1 });
    Object.defineProperty(HTMLCanvasElement.prototype.toBlob, 'toString', { value: () => 'function toBlob() { [native code] }' });
    Object.defineProperty(HTMLCanvasElement.prototype.toBlob, 'name', { value: 'toBlob' });

    // Hook toDataURL
    Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', {
        value: function () {
            interfere(this, this.getContext('2d'));
            return OriginalToDataURL.apply(this, arguments);
        },
        configurable: true
    });
    Object.defineProperty(HTMLCanvasElement.prototype.toDataURL, 'length', { value: 0 });
    Object.defineProperty(HTMLCanvasElement.prototype.toDataURL, 'toString', { value: () => 'function toDataURL() { [native code] }' });
    Object.defineProperty(HTMLCanvasElement.prototype.toDataURL, 'name', { value: 'toDataURL' });

    // Hook getImageData
    Object.defineProperty(CanvasRenderingContext2D.prototype, 'getImageData', {
        value: function () {
            interfere(this.canvas, this);
            return OriginalGetImageData.apply(this, arguments);
        },
        configurable: true
    });
    Object.defineProperty(CanvasRenderingContext2D.prototype.getImageData, 'length', { value: 4 });
    Object.defineProperty(CanvasRenderingContext2D.prototype.getImageData, 'toString', { value: () => 'function getImageData() { [native code] }' });
    Object.defineProperty(CanvasRenderingContext2D.prototype.getImageData, 'name', { value: 'getImageData' });
})();