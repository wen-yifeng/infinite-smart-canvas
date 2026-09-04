(function attachSmartCanvasMediaLayout(global){
    'use strict';

    const DEFAULTS = Object.freeze({
        nodeDefaultScale: 2,
        multiDefaultScale: 0.8,
        multiThumbBase: 224,
        multiNodeHeight: 440,
        maxVisibleRows: 3,
        emptyWidth: 316,
        emptyHeight: 194,
        pendingWidth: 260,
        pendingHeight: 180,
        padding: 32,
        gap: 8,
        minimumThumb: 28,
        multiMaxWidth: 740
    });

    function optionNumber(options, key, fallback){
        const value = Number(options?.[key]);
        return Number.isFinite(value) && value > 0 ? value : fallback;
    }

    function layoutOptions(options={}){
        return {
            nodeDefaultScale: optionNumber(options, 'nodeDefaultScale', DEFAULTS.nodeDefaultScale),
            multiDefaultScale: optionNumber(options, 'multiDefaultScale', DEFAULTS.multiDefaultScale),
            multiThumbBase: optionNumber(options, 'multiThumbBase', DEFAULTS.multiThumbBase),
            multiNodeHeight: optionNumber(options, 'multiNodeHeight', DEFAULTS.multiNodeHeight),
            maxVisibleRows: Math.max(1, Math.round(optionNumber(options, 'maxVisibleRows', DEFAULTS.maxVisibleRows))),
            emptyWidth: optionNumber(options, 'emptyWidth', DEFAULTS.emptyWidth),
            emptyHeight: optionNumber(options, 'emptyHeight', DEFAULTS.emptyHeight),
            pendingWidth: optionNumber(options, 'pendingWidth', DEFAULTS.pendingWidth),
            pendingHeight: optionNumber(options, 'pendingHeight', DEFAULTS.pendingHeight),
            padding: optionNumber(options, 'padding', DEFAULTS.padding),
            gap: optionNumber(options, 'gap', DEFAULTS.gap),
            minimumThumb: optionNumber(options, 'minimumThumb', DEFAULTS.minimumThumb),
            multiMaxWidth: optionNumber(options, 'multiMaxWidth', DEFAULTS.multiMaxWidth),
            isAudioMediaItem: typeof options?.isAudioMediaItem === 'function' ? options.isAudioMediaItem : () => false
        };
    }

    function mediaNodeDefaultScale(node, options={}){
        const config = layoutOptions(options);
        if((node?.images || []).length > 1 && !Number.isFinite(Number(node?.scale))) return config.multiDefaultScale;
        return Number.isFinite(Number(node?.scale)) && Number(node.scale) > 0
            ? Number(node.scale)
            : config.nodeDefaultScale;
    }

    function mediaLayoutSize(item){
        const width = Number(item?.natural_w || item?.width || item?.w || item?.layout_w || item?.preview_w || 0);
        const height = Number(item?.natural_h || item?.height || item?.h || item?.layout_h || item?.preview_h || 0);
        return width > 0 && height > 0 ? {width, height} : {width:0, height:0};
    }

    function copyMediaSizeFields(source, target={}){
        if(!source || typeof source !== 'object') return target;
        ['natural_w', 'natural_h', 'width', 'height', 'w', 'h', 'layout_w', 'layout_h'].forEach(key => {
            const value = Number(source[key]);
            if(Number.isFinite(value) && value > 0) target[key] = value;
        });
        return target;
    }

    function singleImageLayout(image, node, scale, options={}){
        const config = layoutOptions(options);
        const explicitW = Number(node?.w);
        const explicitH = Number(node?.h);
        if(Number.isFinite(explicitW) && explicitW > 24 && Number.isFinite(explicitH) && explicitH > 24){
            return {cols:1, rows:1, width:Math.round(explicitW), height:Math.round(explicitH), thumb:Math.round(96 * scale), single:true};
        }
        if(config.isAudioMediaItem(image)){
            return {cols:1, rows:1, width:Math.round(288 * scale), height:Math.round(150 * scale), thumb:Math.round(96 * scale), single:true};
        }
        const size = mediaLayoutSize(image);
        if(size.width > 0 && size.height > 0){
            const fit = Math.min((260 * scale) / size.width, (220 * scale) / size.height);
            return {
                cols:1,
                rows:1,
                width:Math.max(72, Math.round(size.width * fit)),
                height:Math.max(72, Math.round(size.height * fit)),
                thumb:Math.round(96 * scale),
                single:true
            };
        }
        return {cols:1, rows:1, width:Math.round(260 * scale), height:Math.round(180 * scale), thumb:Math.round(96 * scale), single:true};
    }

    function groupImageGridLayout(count, explicitW, explicitH, maxThumb, pad=32, gap=8, maxVisibleRows=3, minimumThumb=28){
        let best = null;
        for(let cols = 1; cols <= count; cols++){
            const rows = Math.ceil(count / cols);
            const visibleRows = Math.min(Math.max(1, maxVisibleRows), rows);
            const availableW = explicitW - pad - (cols - 1) * gap;
            const availableH = explicitH - pad - (visibleRows - 1) * gap;
            if(availableW <= 0 || availableH <= 0) continue;
            const rawThumb = Math.floor(Math.min(availableW / cols, availableH / visibleRows));
            const fittedThumb = Math.max(minimumThumb, Math.min(maxThumb, rawThumb));
            const fits = rawThumb >= minimumThumb;
            const usedW = cols * fittedThumb + (cols - 1) * gap + pad;
            const usedH = visibleRows * fittedThumb + (visibleRows - 1) * gap + pad;
            const spareW = Math.max(0, explicitW - usedW);
            const spareH = Math.max(0, explicitH - usedH);
            const score = [
                fits ? 1 : 0,
                fittedThumb,
                fittedThumb >= maxThumb ? cols : 0,
                -(spareW + spareH * 0.35),
                -rows
            ];
            let better = !best;
            if(best){
                for(let index = 0; index < score.length; index++){
                    if(score[index] === best.score[index]) continue;
                    better = score[index] > best.score[index];
                    break;
                }
            }
            if(better) best = {cols, rows, visibleRows, thumb:fittedThumb, score};
        }
        const fallbackCols = Math.min(count, 2);
        const fallbackRows = Math.ceil(count / fallbackCols);
        return best || {
            cols:fallbackCols,
            rows:fallbackRows,
            visibleRows:Math.min(Math.max(1, maxVisibleRows), fallbackRows),
            thumb:minimumThumb
        };
    }

    function imageLayout(images, scale=1, node=null, options={}){
        const config = layoutOptions(options);
        const items = Array.isArray(images) ? images : [];
        const count = items.length;
        const resolvedScale = node?.type === 'smart-image' || !node?.type
            ? mediaNodeDefaultScale(node, config)
            : (Number.isFinite(scale) && scale > 0 ? scale : 1);
        if(count === 0){
            const explicitW = Number(node?.w);
            const explicitH = Number(node?.h);
            const pending = Number(node?.pending) > 0 || Boolean(node?.queued);
            const fallbackW = pending ? config.pendingWidth * resolvedScale : config.emptyWidth;
            const fallbackH = pending ? config.pendingHeight * resolvedScale : config.emptyHeight;
            return {
                cols:1,
                rows:1,
                width:Math.round(Number.isFinite(explicitW) && explicitW > 24 ? explicitW : fallbackW),
                height:Math.round(Number.isFinite(explicitH) && explicitH > 24 ? explicitH : fallbackH),
                thumb:Math.round(96 * resolvedScale),
                single:true
            };
        }
        if(count === 1) return singleImageLayout(items[0], node, resolvedScale, config);

        // Multi-image nodes use one deterministic 4:5 photo stack. The primary
        // card is always 440px high; at most four additional cards are rendered
        // behind it without changing the persisted media list.
        const height = Math.max(config.minimumThumb, Math.round(config.multiNodeHeight));
        const width = Math.round(height * 4 / 5);
        return {
            cols:Math.min(count, 5),
            rows:1,
            visibleRows:1,
            visibleCount:Math.min(count, 5),
            width,
            height,
            thumb:height,
            overlap:0,
            stacked:true,
            irregularStack:true
        };
    }

    global.SmartCanvasMediaLayoutPrimitives = Object.freeze({
        defaults: DEFAULTS,
        mediaNodeDefaultScale,
        mediaLayoutSize,
        copyMediaSizeFields,
        singleImageLayout,
        groupImageGridLayout,
        imageLayout
    });
})(window);


/* ==================== 媒体类型判断（自 smart-canvas.js 迁移） ==================== */
function smartOriginalMediaUrl(itemOrUrl){

    return SmartCanvasMediaPreviewPrimitives.originalUrl(itemOrUrl);

}

function isVideoMediaItem(img){

    if(!img) return false;

    if(img.kind === 'video') return true;

    const url = smartOriginalMediaUrl(img).toLowerCase();

    return /\.(mp4|webm|mov|m4v|avi|mkv)(\?|$)/.test(url);

}

function isInlineVideoActive(img){

    return Boolean(img && img._inlineVideoActive);

}

function isAudioMediaItem(img){

    if(!img) return false;

    if(img.kind === 'audio') return true;

    const url = smartOriginalMediaUrl(img).toLowerCase();

    return /\.(mp3|wav|m4a|aac|ogg|flac)(\?|$)/.test(url);

}

function isTextMediaItem(img){

    if(!img) return false;

    if(img.kind === 'text') return true;

    const url = smartOriginalMediaUrl(img).toLowerCase();

    return /\.(txt|json|csv|srt|vtt|md)(\?|$)/.test(url);

}

function isFileMediaItem(img){

    if(!img) return false;

    return img.kind === 'file';

}

function mediaKindForFile(file){

    const type = String(file?.type || '').toLowerCase();

    const name = String(file?.name || '').toLowerCase();

    if(type.startsWith('video/') || /\.(mp4|webm|mov|m4v|avi|mkv)(\?|$)/.test(name)) return 'video';

    if(type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac)(\?|$)/.test(name)) return 'audio';

    if(type.startsWith('text/') || /\.(txt|json|csv|srt|vtt|md)(\?|$)/.test(name)) return 'text';

    return 'image';

}

function mediaKindForItem(img){

    if(isFileMediaItem(img)) return 'file';

    if(isTextMediaItem(img)) return 'text';

    if(isAudioMediaItem(img)) return 'audio';

    if(isVideoMediaItem(img)) return 'video';

    return 'image';

}

function smartMediaKindLabel(kind){
    if(kind === 'audio') return '音频';
    if(kind === 'video') return '视频';
    if(kind === 'text') return '文本';
    if(kind === 'file') return '文件';
    return '图片';
}

// P2.1 后主文件为 ES module，无法再经经典词法作用域读取本文件顶层函数；
// 显式挂载到 window（与 IIFE 段的导出方式一致）。
if (typeof window !== 'undefined') {
    window.smartOriginalMediaUrl = smartOriginalMediaUrl;
    window.isVideoMediaItem = isVideoMediaItem;
    window.isInlineVideoActive = isInlineVideoActive;
    window.isAudioMediaItem = isAudioMediaItem;
    window.isTextMediaItem = isTextMediaItem;
    window.isFileMediaItem = isFileMediaItem;
    window.mediaKindForFile = mediaKindForFile;
    window.mediaKindForItem = mediaKindForItem;
    window.smartMediaKindLabel = smartMediaKindLabel;
}
