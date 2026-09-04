/*
 * smart-canvas-media-view.js — 媒体显示/HTML 域（Phase 2 P2.9，自 smart-canvas.js 迁入）。
 *
 * ES module 工厂 `createMediaView(ctx)`；可变共享状态经 ctx 访问器读写，
 * window 别名与 window 挂载名裸引用直达。DOM 结构与类名零漂移，函数体逐行保留
 * （仅可变绑定读写经 AST 引导精确改写为访问器调用）。
 * 域内包含：媒体显示 URL 解析、结果媒体提取、缩略图与媒体卡 HTML、分辨率徽标、
 * 播放状态快照/恢复/transplant、代理回退绑定、安全导出文件名。
 */
export function createMediaView(ctx) {

    const {
        MS_GEN_MODELS,
        SMART_REFERENCE_IMAGE_MAX,
        escapeAttr,
        escapeHtml,
        fileNameFromUrl,
        mediaLayoutSize,
        smartPreviewImgHtml,
        smartVideoPlayerHtml,
        smartVideoPreviewHtml,
        world
    } = ctx;

function localDisplayUrlForMediaItem(img){

    if(!img) return '';

    const candidates = [

        img.originalLocalUrl,

        img.localUrl,

        img.sourceUrl,

        img.local_url,

        img.source_url,

        img.url

    ];

    const local = candidates.find(url => url && !/^https?:\/\//i.test(String(url)));

    return local || img.url || '';

}

function imageForDisplay(img){

    if(!img || typeof img !== 'object') return img;

    const localUrl = localDisplayUrlForMediaItem(img);

    if(!localUrl || localUrl === img.url) return img;

    return {

        ...img,

        url:localUrl,

        originalLocalUrl:img.originalLocalUrl || localUrl

    };

}

function resultMediaUrls(result){

    const urls = [];

    const add = value => {

        if(!value) return;

        if(typeof value === 'string'){

            urls.push(value);

            return;

        }

        if(Array.isArray(value)){

            value.forEach(add);

            return;

        }

        if(typeof value === 'object'){

            if(value.url || value.path || value.src || value.uri){

                const url = value.url || value.path || value.src || value.uri;

                if(url){

                    const item = {url, kind:value.kind || value.type || value.mediaKind || '', name:value.name || value.filename || ''};

                    ['natural_w','natural_h','width','height','w','h','layout_w','layout_h'].forEach(key => {

                        const n = Number(value[key]);

                        if(Number.isFinite(n) && n > 0) item[key] = n;

                    });

                    urls.push(item);

                }

            }

            ['image_items','media_items','items','outputs','videos','images','urls','data','result'].forEach(key => add(value[key]));

            ['url','path','src','uri','output','output_url','outputUrl','video','video_url','videoUrl','mp4_url','mp4Url','download_url','downloadUrl','preview_url','previewUrl'].forEach(key => add(value[key]));

        }

    };

    add(result);

    ['image_items','media_items','items','outputs','videos','audios','texts','files','images','urls','data','result','output','url'].forEach(key => add(result?.[key]));

    const seen = new Set();

    return urls.map(item => {

        const url = typeof item === 'string' ? item : item?.url || item?.path || '';

        if(!url) return null;

        return typeof item === 'object' ? {...item, url} : url;

    }).filter(item => {

        const url = typeof item === 'string' ? item : item?.url || '';

        return url && !seen.has(url) && seen.add(url);

    });

}

function imageRefsOnly(refs){

    return (refs || []).filter(ref => ref?.url && mediaKindForItem(ref) === 'image').slice(0, SMART_REFERENCE_IMAGE_MAX);

}

function looksLikeImageMediaUrl(url){

    const text = String(url || '').trim().toLowerCase();

    if(!text) return false;

    if(text.startsWith('data:image/')) return true;

    if(text.startsWith('asset://')) return false;

    const path = text.split('?', 1)[0].split('#', 1)[0];

    return /\.(png|jpe?g|webp|gif|bmp|tiff)$/i.test(path);

}

function videoRefsOnly(refs){

    return (refs || []).filter(ref => ref?.url && mediaKindForItem(ref) === 'video' && !looksLikeImageMediaUrl(ref.url));

}

function isRemoteVideoReferenceUrl(url){

    return /^https?:\/\//i.test(String(url || '')) || /^asset:\/\//i.test(String(url || ''));

}

function audioRefsOnly(refs){

    return (refs || []).filter(ref => ref?.url && mediaKindForItem(ref) === 'audio');

}

function thumbMediaHtml(img){

    if(isFileMediaItem(img) || isTextMediaItem(img)) return `<div class="media-thumb file-thumb" data-media-url="${escapeAttr(img.url || '')}" data-media-kind="${escapeAttr(mediaKindForItem(img))}"><i data-lucide="${isTextMediaItem(img) ? 'file-text' : 'file'}"></i><span>${escapeHtml(img.name || (isTextMediaItem(img) ? 'Text' : 'File'))}</span></div>`;

    if(isAudioMediaItem(img)) return `<div class="media-thumb audio-thumb" data-media-url="${escapeAttr(img.url || '')}" data-media-kind="audio"><i data-lucide="file-audio"></i><span>${escapeHtml(img.name || 'Audio')}</span></div>`;

    if(isVideoMediaItem(img)) return `<div class="media-thumb video-thumb">${isInlineVideoActive(img) ? smartVideoPlayerHtml(img.url || '') : `${smartVideoPreviewHtml(img, 512, 'alt=""')}<button class="smart-video-play thumb-video-play" type="button" title="播放"><i data-lucide="play"></i></button>`}</div>`;

    return smartPreviewImgHtml(img, 512, 'draggable="false"');

}

function imageResolutionLabel(img){

    const w = Number(img?.natural_w || img?.width || img?.w || 0);

    const h = Number(img?.natural_h || img?.height || img?.h || 0);

    return w > 0 && h > 0 ? `${Math.round(w)} x ${Math.round(h)}` : '';

}

function imageResolutionBadgeHtml(img){

    const label = imageResolutionLabel(img);

    return label ? `<span class="image-resolution-badge image-overlay-control">${escapeHtml(label)}</span>` : '';

}

function imageNameLabel(img, fallback='image'){

    const raw = String(img?.name || fileNameFromUrl(img?.url || '') || fallback || 'image').trim();

    return raw || 'image';

}

function imageNameBadgeHtml(img, options={}){

    if(!img?.url) return '';

    const label = imageNameLabel(img);

    const outsideClass = options.outside ? ' image-name-badge-outside' : '';

    return `<span class="image-name-badge${outsideClass}" data-image-name="1" title="${escapeAttr(label)}">${escapeHtml(label)}</span>`;

}

function thumbDisplaySize(img, maxSize){

    const limit = Math.max(28, Math.round(Number(maxSize) || 96));

    const size = mediaLayoutSize(img);

    const w = size.width;

    const h = size.height;

    if(!(w > 0 && h > 0)) return {width:limit, height:limit};

    const fit = Math.min(limit / w, limit / h);

    return {

        width:Math.max(28, Math.round(w * fit)),

        height:Math.max(28, Math.round(h * fit))

    };

}

function applyThumbDisplaySizeToElement(itemEl, img, maxSize=0){

    if(!itemEl?.classList?.contains('thumb-item')) return;

    const limit = Math.max(

        28,

        Math.round(

            Number(maxSize || 0)

            || Number(itemEl.style.getPropertyValue('--thumb-size').replace('px', ''))

            || Math.max(itemEl.clientWidth || 0, itemEl.clientHeight || 0)

            || 96

        )

    );

    const size = thumbDisplaySize(img, limit);

    itemEl.style.setProperty('--thumb-w', `${size.width}px`);

    itemEl.style.setProperty('--thumb-h', `${size.height}px`);

}

function updateImageResolutionBadgeElement(itemEl, img){

    if(!itemEl) return;

    const label = imageResolutionLabel(img);

    let badge = itemEl.querySelector('.image-resolution-badge');

    if(!label){

        badge?.remove();

        return;

    }

    if(!badge){

        badge = document.createElement('span');

        badge.className = 'image-resolution-badge image-overlay-control';

        itemEl.appendChild(badge);

    }

    badge.textContent = label;

}

function mediaCardBaseHtml(img, w, h, opts = {}){
    const staticCls = opts.staticMode ? ' multi-media-static' : '';
    const staticOnly = Boolean(opts.staticMode);
    if(isFileMediaItem(img) || isTextMediaItem(img)){
        const icon = isTextMediaItem(img) ? 'file-text' : 'file';
        const name = escapeHtml(img.name || (isTextMediaItem(img) ? 'Text' : 'File'));
        const sub = isTextMediaItem(img) ? 'TEXT' : 'FILE';
        return `<div class="node-img media-card media-file-card${staticCls}" style="width:${w}px;height:${h}px"><div class="media-card-icon"><i data-lucide="${icon}"></i></div><div class="media-card-title">${name}</div><div class="media-card-sub">${sub}</div></div>`;
    }
    if(isAudioMediaItem(img)){
        const audio = staticOnly ? '' : `<audio src="${escapeAttr(img.url || '')}" data-url="${escapeAttr(img.url || '')}" controls preload="metadata"></audio>`;
        return `<div class="node-img media-card media-audio-card${staticCls}" style="width:${w}px;height:${h}px"><div class="media-card-icon"><i data-lucide="file-audio"></i></div><div class="media-card-title">${escapeHtml(img.name || 'Audio')}</div><div class="media-card-sub">AUDIO</div>${audio}</div>`;
    }
    if(isVideoMediaItem(img)){
        const inner = staticOnly ? smartVideoPreviewHtml(img, 768, 'alt=""') : (isInlineVideoActive(img) ? smartVideoPlayerHtml(img.url || '') : `${smartVideoPreviewHtml(img, 768, 'alt=""')}<button class="smart-video-play" type="button" title="播放"><i data-lucide="play"></i></button>`);
        return `<div class="node-img media-card media-video-card${staticCls}" style="width:${w}px;height:${h}px">${inner}</div>`;
    }
    return smartPreviewImgHtml(img, 768, `class="node-img${staticCls}" draggable="false" style="width:${w}px;height:${h}px"`);
}

function singleMediaHtml(img, w, h){
    return mediaCardBaseHtml(img, w, h);
}

function multiMediaSummaryHtml(img, w, h){
    return mediaCardBaseHtml(img, w, h, {staticMode:true});
}

function captureMediaPlaybackState(media){

    if(!media) return null;

    return {

        currentTime:Number.isFinite(media.currentTime) ? media.currentTime : 0,

        paused:Boolean(media.paused),

        playbackRate:Number.isFinite(media.playbackRate) ? media.playbackRate : 1,

        muted:Boolean(media.muted),

        volume:Number.isFinite(media.volume) ? media.volume : 1

    };

}

function restoreMediaPlaybackState(media, state){

    if(!media || !state) return;

    try { media.playbackRate = state.playbackRate || 1; } catch(e) {}

    try { media.muted = state.muted; } catch(e) {}

    try { media.volume = state.volume; } catch(e) {}

    const applyTime = () => {

        if(Number.isFinite(state.currentTime) && state.currentTime > 0 && Math.abs((media.currentTime || 0) - state.currentTime) > 0.2){

            try { media.currentTime = state.currentTime; } catch(e) {}

        }

        if(!state.paused && typeof media.play === 'function'){

            const playPromise = media.play();

            if(playPromise?.catch) playPromise.catch(() => {});

        }

    };

    if(media.readyState >= 1) applyTime();

    else media.addEventListener('loadedmetadata', applyTime, {once:true});

}

function transplantSmartMediaElements(oldNodeEl, newNodeEl){

    const oldItems = [...(oldNodeEl?.querySelectorAll?.('.thumb-item,.image-wrap') || [])];

    const newItems = [...(newNodeEl?.querySelectorAll?.('.thumb-item,.image-wrap') || [])];

    oldItems.forEach((oldItem, index) => {

        const oldMedia = oldItem.querySelector('video,audio,img.node-img,.thumb-item > img,.media-thumb img');

        if(!oldMedia) return;

        const selector = oldMedia.tagName.toLowerCase();

        const oldUrl = oldMedia.dataset?.url || oldMedia.dataset?.originalSrc || oldMedia.getAttribute('src') || '';

        const oldSignature = oldItem.dataset?.mediaSignature || `${selector}:${oldUrl}`;

        const newItem = newItems.find(item => item.dataset?.mediaSignature === oldSignature)

            || newItems.find(item => item.querySelector?.(selector)?.dataset?.url === oldUrl)

            || newItems.find(item => item.querySelector?.(selector)?.dataset?.originalSrc === oldUrl)

            || newItems.find(item => item.querySelector?.(selector)?.getAttribute?.('src') === oldMedia.getAttribute('src'))

            || newItems[index];

        const newMedia = newItem?.querySelector?.(selector);

        const newUrl = newMedia?.dataset?.url || newMedia?.dataset?.originalSrc || newMedia?.getAttribute?.('src') || '';

        if(!newMedia || oldUrl !== newUrl) return;

        if(selector === 'img'){

            oldMedia.className = newMedia.className;

            oldMedia.draggable = false;

            oldMedia.alt = newMedia.getAttribute('alt') || oldMedia.getAttribute('alt') || '';

            oldMedia.style.cssText = newMedia.style.cssText;

            oldMedia.dataset.originalSrc = newMedia.dataset?.originalSrc || oldMedia.dataset?.originalSrc || '';

            newMedia.replaceWith(oldMedia);

            return;

        }

        const state = captureMediaPlaybackState(oldMedia);

        newMedia.replaceWith(oldMedia);

        restoreMediaPlaybackState(oldMedia, state);

        requestAnimationFrame(() => restoreMediaPlaybackState(oldMedia, state));

    });

}

function captureMediaPlaybackStates(){

    const states = new Map();

    world.querySelectorAll('video[data-url], audio[data-url]').forEach(media => {

        const tag = media.tagName.toLowerCase();

        const url = media.dataset.url || media.getAttribute('src') || '';

        if(url) states.set(`${tag}:${url}`, captureMediaPlaybackState(media));

    });

    return states;

}

function restoreMediaPlaybackStates(states){

    if(!states?.size) return;

    world.querySelectorAll('video[data-url], audio[data-url]').forEach(media => {

        const tag = media.tagName.toLowerCase();

        const url = media.dataset.url || media.getAttribute('src') || '';

        restoreMediaPlaybackState(media, states.get(`${tag}:${url}`));

    });

}

function smartRunTaskLabel(run){

    const s = run?.settings || {};

    if(run?.kind === 'video') return s.videoModel || 'Video';

    if(s.engine === 'modelscope'){

        return s.msgenModel === 'custom' ? (s.msCustomModel || 'Modelscope') : (MS_GEN_MODELS[s.msgenModel]?.label || s.msgenModel || 'Modelscope');

    }

    return s.model || 'API Image';

}

function outputUrlLooksVideo(url){

    return /\.(mp4|webm|mov|m4v|avi|mkv)(\?|$)/.test(smartOriginalMediaUrl(url).toLowerCase());

}

function proxiedMediaUrl(itemOrUrl, name=''){

    const url = smartOriginalMediaUrl(itemOrUrl);

    if(!url || String(url).startsWith('/assets/') || String(url).startsWith('/output/') || String(url).startsWith('data:') || String(url).startsWith('blob:')) return url;

    const filename = name || (typeof itemOrUrl === 'object' ? (itemOrUrl.name || '') : '') || fileNameFromUrl(url) || 'preview';

    return `/api/download-output?inline=1&url=${encodeURIComponent(url)}&name=${encodeURIComponent(filename)}`;

}

function displayMediaUrl(itemOrUrl, name=''){

    const url = smartOriginalMediaUrl(itemOrUrl);

    if(/^https?:\/\//i.test(String(url || ''))) return proxiedMediaUrl(itemOrUrl, name);

    return url;

}

function bindImageProxyFallback(imgEl, itemOrUrl){

    if(!imgEl || imgEl.dataset.proxyFallbackBound === '1') return;

    imgEl.dataset.proxyFallbackBound = '1';

    imgEl.addEventListener('error', () => {

        if(imgEl.dataset.proxyFallbackTried === '1') return;

        const fallback = proxiedMediaUrl(itemOrUrl);

        if(!fallback || fallback === imgEl.getAttribute('src')) return;

        imgEl.dataset.proxyFallbackTried = '1';

        imgEl.src = fallback;

    });

}

function safeExportFileName(name, fallback='download.zip'){

    const cleaned = String(name || fallback).replace(/[\\/:*?"<>|]+/g, '_').trim();

    return cleaned || fallback;

}

    return {
        localDisplayUrlForMediaItem,
        imageForDisplay,
        resultMediaUrls,
        imageRefsOnly,
        videoRefsOnly,
        isRemoteVideoReferenceUrl,
        audioRefsOnly,
        thumbMediaHtml,
        imageResolutionLabel,
        imageResolutionBadgeHtml,
        imageNameLabel,
        imageNameBadgeHtml,
        thumbDisplaySize,
        applyThumbDisplaySizeToElement,
        updateImageResolutionBadgeElement,
        singleMediaHtml,
        multiMediaSummaryHtml,
        transplantSmartMediaElements,
        captureMediaPlaybackStates,
        restoreMediaPlaybackStates,
        smartRunTaskLabel,
        outputUrlLooksVideo,
        proxiedMediaUrl,
        displayMediaUrl,
        bindImageProxyFallback,
        safeExportFileName
    };

}
