/*
 * smart-canvas-media-preview-helpers.js — 媒体预览/高分辨率同步辅助域（Phase 2 P2.10⑦，自 smart-canvas.js 迁入）。
 *
 * ES module 工厂 `createMediaPreview(ctx)`；可变共享状态经 ctx 访问器读写，
 * window 别名与 window 挂载名裸引用直达。DOM 结构与类名零漂移，函数体逐行保留
 * （仅可变绑定读写经 AST 引导精确改写为访问器调用）。
 * 域内包含：预览 HTML 生成（smartPreviewImgHtml/smartVideoPreviewHtml/
 * smartVideoFallbackHtml/smartVideoPlayerHtml）、原始尺寸 LRU 缓存加载、
 * 视频预览激活、预览回退绑定、选中高分辨率预加载/同步
 * （smartSelectedHighRes* 状态随块自迁）。
 */
export function createMediaPreview(ctx) {

    const {
        displayMediaUrl,
        escapeAttr,
        escapeHtml,
        isNodeSelected,
        mediaPreviewModal,
        selectedNodeIds,
        world
    } = ctx;

function smartMediaPreviewUrl(itemOrUrl, size=512){

    return SmartCanvasMediaPreviewPrimitives.previewUrl(itemOrUrl, size, displayMediaUrl);

}

function smartPreviewImgHtml(itemOrUrl, size=512, attrs=''){

    return SmartCanvasMediaPreviewPrimitives.previewImageHtml(itemOrUrl, size, attrs, {displayMediaUrl, escapeHtml, escapeAttr});

}

function smartVideoPreviewHtml(itemOrUrl, size=512, attrs=''){

    return SmartCanvasMediaPreviewPrimitives.videoPreviewHtml(itemOrUrl, size, attrs, {displayMediaUrl, escapeHtml, escapeAttr});

}

function smartVideoFallbackHtml(url, attrs=''){

    return SmartCanvasMediaPreviewPrimitives.videoFallbackHtml(url, attrs, {displayMediaUrl, escapeHtml, escapeAttr});

}

function smartVideoPlayerHtml(url, attrs=''){

    return SmartCanvasMediaPreviewPrimitives.videoPlayerHtml(url, attrs, {displayMediaUrl, escapeHtml, escapeAttr});

}

function isSmartPreviewImage(img){

    return SmartCanvasMediaPreviewPrimitives.isPreviewImage(img);

}

const smartImageDimensionCache = new Map();
const SMART_IMAGE_DIMENSION_CACHE_LIMIT = 240;

function loadSmartOriginalImageDimensions(url){
    const original = smartOriginalMediaUrl(url);
    const src = displayMediaUrl({url:original});
    const serverLocal = String(original || '').startsWith('/assets/')
        || String(original || '').startsWith('/output/')
        || String(original || '').startsWith('/api/storage-files/');
    if(serverLocal){
        if(smartImageDimensionCache.has(original)) return smartImageDimensionCache.get(original);
        const promise = fetch(`/api/media-dimensions?url=${encodeURIComponent(original)}`)
            .then(response => response.ok ? response.json() : null)
            .then(data => data && Number(data.w) > 0 && Number(data.h) > 0 ? {w:Number(data.w), h:Number(data.h)} : null)
            .catch(() => null);
        if(smartImageDimensionCache.size >= SMART_IMAGE_DIMENSION_CACHE_LIMIT){
            const oldestKey = smartImageDimensionCache.keys().next().value;
            if(oldestKey !== undefined) smartImageDimensionCache.delete(oldestKey);
        }
        smartImageDimensionCache.set(original, promise);
        return promise;
    }
    return loadSmartOriginalImageDimensionsLegacy(src);
}

function loadSmartOriginalImageDimensionsLegacy(url){

    const src = displayMediaUrl({url:smartOriginalMediaUrl(url)});

    if(!src || /^data:/i.test(src) || /^blob:/i.test(src)) return Promise.resolve(null);

    return new Promise(resolve => {

        const img = new Image();

        img.onload = () => resolve(img.naturalWidth && img.naturalHeight ? {w:img.naturalWidth, h:img.naturalHeight} : null);

        img.onerror = () => resolve(null);

        img.src = src;

    });

}

function smartActivateVideoPreview(target){

    const root = target?.closest?.('.media-video-card,.video-thumb,.image-wrap,.thumb-item') || target?.parentElement || null;

    const img = target?.matches?.('img[data-preview-kind="video"]') ? target : root?.querySelector?.('img[data-preview-kind="video"]');

    if(!img){

        const fallback = target?.matches?.('video[data-url]') ? target : root?.querySelector?.('video[data-url]');

        if(fallback){

            fallback.controls = true;

            fallback.muted = false;

            fallback.play?.().catch(() => {});

            return true;

        }

        return false;

    }

    const original = smartOriginalMediaUrl(img.dataset.originalSrc || img.dataset.url || img.getAttribute('src') || '');

    if(!original) return false;

    const itemEl = target?.closest?.('[data-image-index]') || root?.closest?.('[data-image-index]') || root;

    const nodeEl = target?.closest?.('.image-node') || root?.closest?.('.image-node');

    const node = ctx.nodes().find(n => n.id === nodeEl?.dataset.id);

    const imageIndex = Number(itemEl?.dataset?.imageIndex ?? 0);

    const image = node?.images?.[imageIndex];

    if(image) image._inlineVideoActive = true;

    const tpl = document.createElement('template');

    tpl.innerHTML = smartVideoPlayerHtml(original);

    const video = tpl.content.firstElementChild;

    if(!video) return false;

    img.replaceWith(video);

    video.parentElement?.querySelector?.('.smart-video-play')?.style?.setProperty('display', 'none');

    video.addEventListener('ended', () => {

        if(image) image._inlineVideoActive = true;

        video.dataset.inlineVideoActive = '1';

    });

    video.play?.().catch(() => {});

    return true;

}

function bindSmartPreviewImageFallbacks(root=document){

    root.querySelectorAll?.('img[data-preview-src][data-original-src]:not([data-preview-fallback-bound])').forEach(img => {

        img.dataset.previewFallbackBound = '1';

        img.addEventListener('error', () => {

            const original = img.dataset.originalSrc || '';

            if(img.dataset.previewKind === 'video'){

                const tpl = document.createElement('template');

                tpl.innerHTML = smartVideoFallbackHtml(original, img.dataset.videoFallbackAttrs || '');

                img.replaceWith(tpl.content.firstElementChild);

                return;

            }

            if(original && img.getAttribute('src') !== original) img.src = original;
            else {
                img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
                img.style.minHeight = '120px';
                img.style.background = '#262626';
                img.style.borderRadius = '8px';
                img.dataset.broken = '1';
            }

        });

    });

}

const SMART_SELECTED_HIGH_RES_DELAY = 320;

let smartSelectedHighResTimer = 0;

let smartSelectedHighResSeq = 0;

let smartSelectedHighResNodeIds = new Set();

const smartSelectedHighResLoaded = new Set();

const smartSelectedHighResLoading = new Map();

function smartImageEditorIsOpen(){

    return Boolean(mediaPreviewModal?.classList?.contains('open'));

}

function preloadSmartSelectedHighRes(src){

    if(!src || smartSelectedHighResLoaded.has(src)) return Promise.resolve(true);

    if(smartSelectedHighResLoading.has(src)) return smartSelectedHighResLoading.get(src);

    const task = new Promise(resolve => {

        const img = new Image();

        img.decoding = 'async';

        img.onload = async () => {

            try { if(img.decode) await img.decode(); } catch(e) {}

            smartSelectedHighResLoaded.add(src);

            resolve(true);

        };

        img.onerror = () => resolve(false);

        img.src = src;

    }).finally(() => smartSelectedHighResLoading.delete(src));

    smartSelectedHighResLoading.set(src, task);

    return task;

}

function smartNodeElementsByIds(ids){

    const wanted = ids instanceof Set ? ids : new Set(ids || []);

    const elements = [];

    if(!wanted.size) return elements;

    world.querySelectorAll?.('.image-node').forEach(el => {

        const id = el.dataset?.id || '';

        if(wanted.has(id)) elements.push(el);

    });

    return elements;

}

function smartNodeElementsForHighResSync(root){

    if(root && root !== world) return [root];

    const ids = new Set([...smartSelectedHighResNodeIds, ...selectedNodeIds()]);

    return smartNodeElementsByIds(ids);

}

function syncSmartSelectedImageResolution(root=null){

    const selectedImages = [];

    smartNodeElementsForHighResSync(root).forEach(scope => {

        const nodeEl = scope?.classList?.contains('image-node') ? scope : scope?.closest?.('.image-node');

        const nodeId = nodeEl?.dataset?.id || '';

        const selectedNode = Boolean(nodeId && isNodeSelected(nodeId));

        scope.querySelectorAll?.('img[data-preview-src][data-original-src]').forEach(img => {

            if(img.dataset.previewKind === 'video') return;

            const preview = img.dataset.previewSrc || '';

            const original = img.dataset.originalSrc || '';

            if(!selectedNode){

                delete img.dataset.selectedHighResTarget;

                if(preview && img.getAttribute('src') !== preview) img.src = preview;

                return;

            }

            const target = displayMediaUrl({url:smartOriginalMediaUrl(original)});

            if(!target) return;

            img.dataset.selectedHighResTarget = target;

            if(smartSelectedHighResLoaded.has(target)){

                if(img.getAttribute('src') !== target) img.src = target;

                return;

            }

            if(preview && img.getAttribute('src') !== preview) img.src = preview;

            selectedImages.push({img, target});

        });

    });

    if(smartSelectedHighResTimer) clearTimeout(smartSelectedHighResTimer);

    const seq = ++smartSelectedHighResSeq;

    smartSelectedHighResNodeIds = new Set(selectedNodeIds());

    if(!selectedImages.length || smartImageEditorIsOpen()) return;

    smartSelectedHighResTimer = setTimeout(async () => {

        smartSelectedHighResTimer = 0;

        if(seq !== smartSelectedHighResSeq || smartImageEditorIsOpen()) return;

        await Promise.all(selectedImages.map(item => preloadSmartSelectedHighRes(item.target)));

        if(seq !== smartSelectedHighResSeq || smartImageEditorIsOpen()) return;

        selectedImages.forEach(({img, target}) => {

            if(!img.isConnected || img.dataset.selectedHighResTarget !== target) return;

            const nodeEl = img.closest('.image-node');

            if(!nodeEl?.dataset?.id || !isNodeSelected(nodeEl.dataset.id)) return;

            if(smartSelectedHighResLoaded.has(target) && img.getAttribute('src') !== target) img.src = target;

        });

    }, SMART_SELECTED_HIGH_RES_DELAY);

}

    return {
        smartMediaPreviewUrl,
        smartPreviewImgHtml,
        smartVideoPreviewHtml,
        smartVideoFallbackHtml,
        smartVideoPlayerHtml,
        isSmartPreviewImage,
        loadSmartOriginalImageDimensions,
        smartActivateVideoPreview,
        bindSmartPreviewImageFallbacks,
        smartNodeElementsByIds,
        syncSmartSelectedImageResolution
    };

}
