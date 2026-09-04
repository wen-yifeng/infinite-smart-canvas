(function attachSmartCanvasSize(global){
    'use strict';

    const SIZE_MAP = Object.freeze({
        square: Object.freeze({'1k':'1024x1024', '2k':'2048x2048', '4k':'4096x4096'}),
        portrait: Object.freeze({'1k':'1024x1536', '2k':'1360x2048', '4k':'2352x3520'}),
        portrait43: Object.freeze({'1k':'1008x1344', '2k':'1536x2048', '4k':'2448x3264'}),
        landscape43: Object.freeze({'1k':'1344x1008', '2k':'2048x1536', '4k':'3264x2448'}),
        landscape: Object.freeze({'1k':'1536x1024', '2k':'2048x1360', '4k':'3520x2352'}),
        story: Object.freeze({'1k':'720x1280', '2k':'1152x2048', '4k':'2160x3840'}),
        wide: Object.freeze({'1k':'1280x720', '2k':'2048x1152', '4k':'3840x2160'}),
        ultrawide: Object.freeze({'1k':'1280x544', '2k':'2048x880', '4k':'3840x1648'}),
        ultratall: Object.freeze({'1k':'544x1280', '2k':'880x2048', '4k':'1648x3840'})
    });
    const RES_LONG_SIDE = Object.freeze({'1k':1536, '2k':2048, '4k':3840});
    const RES_PIXEL_LIMIT = Object.freeze({'1k':1572864, '2k':4194304, '4k':8294400});

function parseSizeValue(value){
        const match = String(value || '').trim().match(/^(\d+)\s*[xX*]\s*(\d+)$/);
        return match ? {width:match[1], height:match[2]} : null;
    }

    function parseRatioValue(value){
        const raw = String(value || '').trim();
        const parts = raw.includes(':') ? raw.split(':') : raw.split(/[xX*]/);
        if(parts.length !== 2) return 0;
        const width = Number(parts[0]);
        const height = Number(parts[1]);
        return width > 0 && height > 0 ? width / height : 0;
    }

    function apiImageSize(ratioValue, resolutionValue, customRatioValue='', customSizeValue=''){
        if(resolutionValue === 'auto') return 'auto';
        if(resolutionValue === 'custom') return String(customSizeValue || '').trim();
        const resolutionKey = resolutionValue || '1k';
        if(ratioValue === 'custom' || ratioValue === 'source'){
            const ratio = parseRatioValue(customRatioValue);
            const longSide = RES_LONG_SIDE[resolutionKey] || 1024;
            if(ratio){
                const pixelLimit = RES_PIXEL_LIMIT[resolutionKey] || (longSide * longSide);
                const rawWidth = ratio >= 1 ? longSide : Math.min(longSide * ratio, Math.sqrt(pixelLimit * ratio));
                const rawHeight = ratio >= 1 ? Math.min(longSide / ratio, Math.sqrt(pixelLimit / ratio)) : longSide;
                const width = Math.floor(rawWidth / 16) * 16;
                const height = Math.floor(rawHeight / 16) * 16;
                return `${Math.max(64, width)}x${Math.max(64, height)}`;
            }
        }
        const ratioKey = ratioValue && SIZE_MAP[ratioValue] ? ratioValue : 'square';
        return SIZE_MAP[ratioKey]?.[resolutionKey] || SIZE_MAP.square[resolutionKey] || SIZE_MAP.square['1k'];
    }

    function normalizeApiSizeSettings(target, prefix='', options={}){
        if(!target || typeof target !== 'object') return target;
        const ratioKey = prefix ? `${prefix}Ratio` : 'ratio';
        const resolutionKey = prefix ? `${prefix}Resolution` : 'resolution';
        const allowAuto = Boolean(options.allowAuto);
        const defaultResolution = String(options.defaultResolution || (allowAuto ? 'auto' : '1k'));
        if(!target[resolutionKey]) target[resolutionKey] = defaultResolution;
        if(!allowAuto && target[resolutionKey] === 'auto') target[resolutionKey] = '1k';
        if(target[resolutionKey] === 'auto' && !target[ratioKey]) target[ratioKey] = 'square';
        return target;
    }

    function gcdInt(left, right){
        let a = Math.abs(Math.round(Number(left) || 0));
        let b = Math.abs(Math.round(Number(right) || 0));
        while(b){
            const next = b;
            b = a % b;
            a = next;
        }
        return a || 1;
    }

    function imageSizeForRatio(item){
        const width = Math.round(Number(item?.natural_w || item?.width || item?.w || 0));
        const height = Math.round(Number(item?.natural_h || item?.height || item?.h || 0));
        return width > 0 && height > 0 ? {w:width, h:height} : null;
    }

    function reducedRatioForImage(item){
        const size = imageSizeForRatio(item);
        if(!size) return null;
        const divisor = gcdInt(size.w, size.h);
        return {
            w:Math.max(1, Math.round(size.w / divisor)),
            h:Math.max(1, Math.round(size.h / divisor))
        };
    }

function videoAspectIconClass(value){
        if(value === '16:9' || value === '21:9') return 'r-wide';
        if(value === '9:16' || value === '9:21') return 'r-story';
        if(value === '4:3') return 'r-landscape43';
        if(value === '3:4') return 'r-portrait43';
        if(value === 'keep_ratio' || value === 'adaptive') return 'r-source';
        return '';
    }

    global.SmartCanvasSizePrimitives = Object.freeze({
        SIZE_MAP,
        RES_LONG_SIDE,
        RES_PIXEL_LIMIT,
        parseSizeValue,
        apiImageSize,
        normalizeApiSizeSettings,
        imageSizeForRatio,
        reducedRatioForImage,
        videoAspectIconClass
    });
})(window);
