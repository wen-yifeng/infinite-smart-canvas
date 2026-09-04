(function(global){
    'use strict';

    function originalUrl(itemOrUrl){
        const raw = typeof itemOrUrl === 'string' ? itemOrUrl : (itemOrUrl?.url || '');
        const text = String(raw || '');
        if(!text) return '';
        try {
            const parsed = new URL(text, global.location?.origin || 'http://localhost');
            if(parsed.pathname === '/api/media-preview'){
                const original = parsed.searchParams.get('url') || '';
                return original || text;
            }
        } catch(e) {}
        return text;
    }

    function displayUrl(itemOrUrl, fallback){
        return typeof fallback === 'function' ? fallback(itemOrUrl) : originalUrl(itemOrUrl);
    }

    function previewUrl(itemOrUrl, size=512, displayMediaUrl){
        const raw = originalUrl(itemOrUrl);
        const displayItem = typeof itemOrUrl === 'object' && itemOrUrl ? {...itemOrUrl, url:raw} : raw;
        const display = displayUrl(displayItem, displayMediaUrl);
        if(!raw || raw.startsWith('data:') || raw.startsWith('blob:')) return display;
        if(!raw.startsWith('/output/') && !raw.startsWith('/assets/')) return display;
        if(!/\.(png|jpe?g|webp|gif|bmp|avif|tiff?|mp4|webm|mov|m4v|avi|mkv)(\?|#|$)/i.test(raw)) return display;
        const width = Math.max(64, Math.min(2048, Math.round(Number(size) || 512)));
        return `/api/media-preview?w=${width}&url=${encodeURIComponent(raw)}`;
    }

    function previewImageHtml(itemOrUrl, size=512, attrs='', deps={}){
        const original = originalUrl(itemOrUrl);
        const preview = previewUrl(itemOrUrl, size, deps.displayMediaUrl);
        const escapeHtml = typeof deps.escapeHtml === 'function' ? deps.escapeHtml : value => String(value ?? '');
        const escapeAttr = typeof deps.escapeAttr === 'function' ? deps.escapeAttr : escapeHtml;
        const attrText = String(attrs || '');
        const loadingAttr = /(?:^|\s)loading\s*=/.test(attrText) ? '' : ' loading="lazy"';
        const decodingAttr = /(?:^|\s)decoding\s*=/.test(attrText) ? '' : ' decoding="async"';
        return `<img src="${escapeHtml(preview)}" data-preview-src="${escapeAttr(preview)}" data-original-src="${escapeAttr(original)}"${loadingAttr}${decodingAttr}${attrText ? ` ${attrText}` : ''}>`;
    }

    function videoPreviewHtml(itemOrUrl, size=512, attrs='', deps={}){
        const original = originalUrl(itemOrUrl);
        const preview = previewUrl(itemOrUrl, size, deps.displayMediaUrl);
        const escapeHtml = typeof deps.escapeHtml === 'function' ? deps.escapeHtml : value => String(value ?? '');
        const escapeAttr = typeof deps.escapeAttr === 'function' ? deps.escapeAttr : escapeHtml;
        const attrText = String(attrs || '');
        const loadingAttr = /(?:^|\s)loading\s*=/.test(attrText) ? '' : ' loading="lazy"';
        const decodingAttr = /(?:^|\s)decoding\s*=/.test(attrText) ? '' : ' decoding="async"';
        return `<img src="${escapeHtml(preview)}" data-preview-src="${escapeAttr(preview)}" data-original-src="${escapeAttr(original)}" data-url="${escapeAttr(original)}" data-preview-kind="video"${loadingAttr}${decodingAttr}${attrText ? ` ${attrText}` : ''}>`;
    }

    function videoFallbackHtml(url, attrs='', deps={}){
        const original = originalUrl(url);
        const src = displayUrl({url:original}, deps.displayMediaUrl);
        const escapeHtml = typeof deps.escapeHtml === 'function' ? deps.escapeHtml : value => String(value ?? '');
        const escapeAttr = typeof deps.escapeAttr === 'function' ? deps.escapeAttr : escapeHtml;
        return `<video src="${escapeHtml(src)}" data-url="${escapeAttr(original)}" muted preload="metadata" playsinline disablepictureinpicture controlslist="nodownload noplaybackrate noremoteplayback"${attrs ? ` ${attrs}` : ''}></video>`;
    }

    function videoPlayerHtml(url, attrs='', deps={}){
        const original = originalUrl(url);
        const src = displayUrl({url:original}, deps.displayMediaUrl);
        const escapeHtml = typeof deps.escapeHtml === 'function' ? deps.escapeHtml : value => String(value ?? '');
        const escapeAttr = typeof deps.escapeAttr === 'function' ? deps.escapeAttr : escapeHtml;
        return `<video src="${escapeHtml(src)}" data-url="${escapeAttr(original)}" data-inline-video-active="1" controls autoplay playsinline preload="metadata" disablepictureinpicture controlslist="nodownload noplaybackrate noremoteplayback"${attrs ? ` ${attrs}` : ''}></video>`;
    }

    function isPreviewImage(img){
        return img?.tagName?.toLowerCase?.() === 'img'
            && img.dataset?.previewSrc
            && img.dataset?.originalSrc
            && img.dataset.previewSrc !== img.dataset.originalSrc
            && img.getAttribute('src') !== img.dataset.originalSrc;
    }

    global.SmartCanvasMediaPreviewPrimitives = Object.freeze({
        originalUrl,
        previewUrl,
        previewImageHtml,
        videoPreviewHtml,
        videoFallbackHtml,
        videoPlayerHtml,
        isPreviewImage
    });
})(window);
