(function attachSmartCanvasNodeSizing(global){
    'use strict';

    const DEFAULTS = Object.freeze({height:440, minWidth:220, maxWidth:880});

    function positive(value){
        const number = Number(value);
        return Number.isFinite(number) && number > 0 ? number : 0;
    }

    function clamp(value, minimum, maximum){
        return Math.max(minimum, Math.min(maximum, value));
    }

    function mediaSize(item){
        const width = positive(item?.natural_w || item?.width || item?.w || item?.layout_w || item?.preview_w);
        const height = positive(item?.natural_h || item?.height || item?.h || item?.layout_h || item?.preview_h);
        return width && height ? {width, height} : {width:0, height:0};
    }

    function aspectRatio(node, options={}){
        const images = Array.isArray(node?.images) ? node.images : [];
        if(images.length === 1){
            const size = (options.mediaSize || mediaSize)(images[0]) || {};
            if(positive(size.width) && positive(size.height)) return positive(size.width) / positive(size.height);
        }
        const rect = typeof options.rectForNode === 'function' ? (options.rectForNode(node) || {}) : node || {};
        const rectWidth = positive(rect.width || rect.w);
        const rectHeight = positive(rect.height || rect.h);
        if(rectWidth && rectHeight) return rectWidth / rectHeight;
        const firstSize = images.length ? (options.mediaSize || mediaSize)(images[0]) || {} : {};
        if(positive(firstSize.width) && positive(firstSize.height)) return positive(firstSize.width) / positive(firstSize.height);
        return positive(options.fallbackRatio) || 1;
    }

    function fixedSize(node, options={}){
        const height = Math.round(positive(options.height) || DEFAULTS.height);
        const minWidth = Math.round(positive(options.minWidth) || DEFAULTS.minWidth);
        const maxWidth = Math.max(minWidth, Math.round(positive(options.maxWidth) || DEFAULTS.maxWidth));
        const ratio = aspectRatio(node, options);
        return {width:Math.round(clamp(height * ratio, minWidth, maxWidth)), height, ratio};
    }

    function applyFixedSize(node, options={}){
        if(!node || (node.type && node.type !== 'smart-image')) return false;
        const next = fixedSize(node, options);
        const changed = Math.round(positive(node.w)) !== next.width || Math.round(positive(node.h)) !== next.height || Number(node.scale) !== 1;
        node.w = next.width;
        node.h = next.height;
        node.scale = 1;
        return changed;
    }

    global.SmartCanvasNodeSizing = Object.freeze({defaults:DEFAULTS, mediaSize, aspectRatio, fixedSize, applyFixedSize});
})(window);
