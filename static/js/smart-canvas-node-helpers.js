/*
 * smart-canvas-node-helpers.js — 节点交互/渲染杂项域（Phase 2 P2.10⑤，自 smart-canvas.js 迁入）。
 *
 * ES module 工厂 `createNodeHelpers(ctx)`；可变共享状态经 ctx 访问器读写，
 * window 别名与 window 挂载名裸引用直达。DOM 结构与类名零漂移，函数体逐行保留
 * （仅可变绑定读写经 AST 引导精确改写为访问器调用）。
 * 域内包含：SmartCanvasNodeInteractions 交互回调包、节点渲染器注册表、
 * 节点 HTML（body/provider label/meta/任务恢复态）、节点工具栏动作、
 * 运行计时（formatRunDuration/nodeRunElapsedMs/计时 pill）、
 * measureSmartNodeImages 视口内测量、bindNodeEvents 事件总装、
 * 拖拽辅助（rectOverlapNode/dragConnectTargetFor/canAutoConnectDraggedNode/
 * restoreDraggedNodePosition）、drop highlight、上传 entry 解析
 * （isSupportedUploadFile/dataTransferItemEntry/filesFromEntry）、
 * pending 尺寸计算簇（sizeForRun→pendingBoxSize）。
 */
export function createNodeHelpers(ctx) {

    const {
        MEDIA_NODE_DEFAULT_SCALE,
        SMART_CANVAS_MANUAL_CONNECTIONS_ENABLED,
        SMART_IMAGE_NODE_FIXED_HEIGHT,
        activeComposerNode,
        apiImageSize,
        apiProviderById,
        applyThumbDisplaySizeToElement,
        beginSmartNodeDrag,
        beginSmartNodeResize,
        beginSmartPortDrag,
        beginSmartThumbnailDrag,
        bindImageProxyFallback,
        bindSmartChatEvents,
        clearImageClickTimer,
        currentShellRect,
        defaultSmartApiResolution,
        deleteImage,
        deleteNodeFromButton,
        downloadPreviewFile,
        escapeAttr,
        escapeHtml,
        fixedSmartImageNodeSize,
        handleSmartChatAction,
        handleSmartNodeDrop,
        imageForDisplay,
        isApiLikeEngine,
        isGptImageAutoSizeModel,
        isHistoryGroupNode,
        isNodeSelected,
        isSmartChatNode,
        isSmartImageNode,
        isSmartPreviewImage,
        loadSmartOriginalImageDimensions,
        mediaNodeDefaultScale,
        nodeRect,
        openCreateMenu,
        openImagePreviewSmart,
        parseSizeValue,
        pickMediaForSmartNode,
        pickSingleReferenceImageForSmartNode,
        querySmartImageTaskNow,
        renameSmartNodeImage,
        renderSmartTaskStatus,
        resetSmartNodeAspect,
        scheduleComposerUpdate,
        scheduleRunTimerRaf,
        scheduleSave,
        scheduleSmartCanvasRender,
        setSmartDropCopyEffect,
        setSmartNodeDropPreview,
        singleImageAspectRatio,
        singleImageLayout,
        smartActivateVideoPreview,
        smartCanvasState,
        smartCanvasTaskController,
        smartImageBodyHtml,
        smartPendingTasks,
        smartSettingsForNode,
        smartTaskStatus,
        syncSelectionUi,
        toggleSmartNodeSelection,
        updateComposer,
        updateImageResolutionBadgeElement,
        updateNodeElementDuringResize,
        videoProviderById,
        world
    } = ctx;

const smartCanvasNodeInteractions = SmartCanvasNodeInteractions.create({
    world,
    getNodes:() => ctx.nodes(),
    getSelection:() => ({primaryId:selectedId, ids:selectedIds, image:selectedImage}),
    setSelection:selection => {
        selectedId = selection?.primaryId || '';
        selectedIds = Array.isArray(selection?.ids) ? selection.ids : [];
        selectedImage = selection?.image || {nodeId:'', index:-1};
    },
    getSuppressNodeClickUntil:() => ctx.suppressNodeClickUntil(),
    getSuppressImageClickUntil:() => ctx.suppressImageClickUntil(),
    setSuppressImageClickUntil:value => { ctx.setSuppressImageClickUntil(value); },
    scheduleRender:scheduleSmartCanvasRender,
    hideRunTimer:hideRunTimerForNode,
    toggleSelection:toggleSmartNodeSelection,
    syncSelectionUi,
    updateComposer,
    
    openCreateMenu,
    deleteNodeFromButton,
    runNodeToolbarAction:runSmartNodeToolbarAction,
    
    queryImageTask:querySmartImageTaskNow,
    deleteImage,
    mediaKindForItem,
    clearImageClickTimer,
    scheduleImageClick:(callback, delay=220) => {
        clearImageClickTimer();
        ctx.setImageClickTimer(setTimeout(() => {
            ctx.setImageClickTimer(null);
            callback();
        }, delay));
    },
    activateVideoPreview:smartActivateVideoPreview,
    openImagePreview:openImagePreviewSmart,
    scheduleComposerUpdate,
    pickMediaForNode:pickMediaForSmartNode,
    setUploadTargetId:value => { ctx.setUploadTargetId(value); },
    clearPendingGroupUploadPoint:() => { ctx.setPendingGroupUploadPoint(null); },
    renameImage:renameSmartNodeImage,
    getNodeAspectRatio:id => singleImageAspectRatio(ctx.nodes().find(node => node.id === id)),
    beginThumbnailDrag:beginSmartThumbnailDrag,
    resetNodeAspect:resetSmartNodeAspect,
    beginNodeResize:beginSmartNodeResize,
    beginNodeDrag:beginSmartNodeDrag,
    allowPortDrag:() => SMART_CANVAS_MANUAL_CONNECTIONS_ENABLED,
    beginPortDrag:beginSmartPortDrag,
    setNodeDropEffect:setSmartDropCopyEffect,
    setNodeDropPreview:setSmartNodeDropPreview,
    handleNodeDrop:handleSmartNodeDrop,
});

const smartCanvasNodeRendererRegistry = SmartCanvasNodeRendererRegistry.create({

    'smart-image':(node, context) => smartImageBodyHtml(node, context.layout)

});

function nodeBodyHtml(node, layout){

    return smartCanvasNodeRendererRegistry.render(node, {layout});

}

function nodeProviderLabel(node){
    const isActiveComposerNode = activeComposerNode()?.id === node?.id;
    const nodeSettings = isActiveComposerNode ? ctx.settings() : smartSettingsForNode(node || {});
    const providerId = nodeSettings.apiKind === 'video'
        ? nodeSettings.videoProvider
        : nodeSettings.provider_id;
    return nodeSettings.engine === 'modelscope'
        ? 'Modelscope'
        : (nodeSettings.apiKind === 'video'
            ? (videoProviderById(providerId || '')?.name || providerId || '默认平台')
            : (apiProviderById(providerId || '')?.name || providerId || '默认平台'));
}

function nodeMetaHtml(node){
    if(isSmartChatNode(node)) return '';
    const provider = nodeProviderLabel(node);
    return `<div class="node-context-meta node-platform-control image-overlay-control" aria-hidden="true"><span class="node-context-provider" title="${escapeHtml(provider)}">${escapeHtml(provider)}</span></div>`;
}

function refreshNodeProviderMeta(node){
    if(!node?.id) return;
    const label = world.querySelector(`.image-node[data-id="${CSS.escape(node.id)}"] .node-context-provider`);
    if(!label) return;
    const provider = nodeProviderLabel(node);
    label.textContent = provider;
    label.title = provider;
}

function smartRecoverableImageTask(node){

    return smartPendingTasks(node).find(task => task.failed && task.recoverTaskId) || null;

}

function imageTaskRecoverBodyHtml(node, task, layout){

    const querying = Boolean(task.querying);

    const failedCount = smartPendingTasks(node).filter(item => item.failed && item.recoverTaskId).length;

    const title = querying ? '查询中' : '任务未丢失';

    const sub = failedCount > 1 ? `还有 ${failedCount} 个任务可查询` : `任务 ID：${task.recoverTaskId || ''}`;

    return `<div class="task-recovery-cell loading-cell single" style="width:${layout.width}px;height:${layout.height}px">

        <div class="task-recovery-overlay">

            <div class="task-recovery-spinner"><i data-lucide="${querying ? 'loader-2' : 'refresh-cw'}"></i></div>

            <div class="task-recovery-text">${escapeHtml(title)}</div>

            <div class="task-recovery-sub">${escapeHtml(sub)}</div>

            <button class="task-recovery-query" type="button" data-image-task-query="${escapeAttr(node.id)}" data-task-id="${escapeAttr(task.taskId)}" ${querying ? 'disabled' : ''}><i data-lucide="${querying ? 'loader-2' : 'refresh-cw'}"></i><span>${querying ? '查询中…' : '查询结果'}</span></button>

        </div>

    </div>`;

}

function smartNodeToolbarImageIndex(node){

    const images = node?.images || [];

    if(selectedImage.nodeId === node?.id){

        const index = Number(selectedImage.index);

        if(Number.isFinite(index) && index >= 0 && index < images.length) return index;

    }

    return 0;

}

function smartNodeToolbarMediaItem(node){

    const index = smartNodeToolbarImageIndex(node);

    const item = imageForDisplay(node?.images?.[index]);

    return item?.url ? (node.images?.[index] || item) : null;

}

function runSmartNodeToolbarAction(nodeId, action){
    const node = ctx.nodes().find(n => n.id === nodeId);
    if(!node) return;
    if(action === 'replace-input'){
        selectedId = node.id;
        selectedIds = [];
        selectedImage = {nodeId:'', index:-1};
        syncSelectionUi();
        updateComposer();
        pickSingleReferenceImageForSmartNode(node.id);
        return;
    }
    if(isSmartChatNode(node)){
        handleSmartChatAction(node, action);
        return;
    }
    if(action !== 'download') return;
    const item = smartNodeToolbarMediaItem(node);
    if(item) downloadPreviewFile(item);
}

function nowMs(){ return Date.now(); }

function formatRunDuration(ms){

    const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));

    const min = Math.floor(total / 60);

    const sec = total % 60;

    return min ? `${min}:${String(sec).padStart(2, '0')}` : `${sec}s`;

}

function nodeRunElapsedMs(node){

    if(!node) return 0;

    if(node.runFinishedAt && node.runStartedAt) return Number(node.runElapsedMs) || (Number(node.runFinishedAt) - Number(node.runStartedAt));

    if(node.runStartedAt) return nowMs() - Number(node.runStartedAt);

    return 0;

}

function runTimePillHtml(node){
    if(!node || node.runTimerHidden) return '';
    const running = Boolean(node.pending || node.running);
    if(!running && !node.runFinishedAt) return '';
    const cls = running ? '' : ' done';
    return `<span class="run-time-pill${cls}" data-run-timer="${escapeHtml(node.id)}">${formatRunDuration(nodeRunElapsedMs(node))}</span>`;
}

function hideRunTimerForNode(node){

    if(!node || node.runTimerHidden || node.pending || node.running || !node.runFinishedAt) return false;

    node.runTimerHidden = true;

    scheduleSave();

    return true;

}

function refreshRunTimerPills(){
    const active = ctx.nodes().some(node => !node.runTimerHidden && (node.pending || node.running || node.runFinishedAt));
    document.querySelectorAll('[data-run-timer]').forEach(el => {
        const node = ctx.nodes().find(item => item.id === el.dataset.runTimer);
        if(!node || node.runTimerHidden){
            el.remove();
            return;
        }
        el.textContent = formatRunDuration(nodeRunElapsedMs(node));
        el.classList.toggle('done', Boolean(!node.pending && !node.running && node.runFinishedAt));
    });
    if(smartTaskStatus && !smartTaskStatus.hidden && smartCanvasTaskController?.getSummary().activeCount){
        renderSmartTaskStatus({type:'timer'});
    }
    if(active && !ctx.runTimerRaf()) scheduleRunTimerRaf();
    if(!active && ctx.runTimerRaf()){ cancelAnimationFrame(ctx.runTimerRaf()); ctx.setRunTimerRaf(0); ctx.setRunTimerLast(0); }
}

function rememberInlineVideoActivations(){

    world.querySelectorAll('.image-node [data-image-index] video[data-inline-video-active="1"]').forEach(video => {

        const nodeEl = video.closest('.image-node');

        const itemEl = video.closest('[data-image-index]');

        const node = ctx.nodes().find(n => n.id === nodeEl?.dataset.id);

        const index = Number(itemEl?.dataset.imageIndex ?? 0);

        const image = node?.images?.[index];

        if(image && mediaKindForItem(image) === 'video') image._inlineVideoActive = true;

    });

}


function measureSmartNodeImages(){
    const shellRect = currentShellRect();
    const viewportMargin = 240;
    const nodeById = new Map(ctx.nodes().map(node => [node.id, node]));
    const nearViewport = new Map();
    const isNearViewport = nodeEl => {
        if(!nodeEl) return false;
        if(nearViewport.has(nodeEl)) return nearViewport.get(nodeEl);
        const rect = nodeEl.getBoundingClientRect();
        const visible = rect.right >= shellRect.left - viewportMargin
            && rect.bottom >= shellRect.top - viewportMargin
            && rect.left <= shellRect.right + viewportMargin
            && rect.top <= shellRect.bottom + viewportMargin;
        nearViewport.set(nodeEl, visible);
        return visible;
    };

    world.querySelectorAll('.image-node img,.image-node video').forEach(imgEl => {
        const nodeEl = imgEl.closest('.image-node');
        if(!isNearViewport(nodeEl)) return;
        const itemEl = imgEl.closest('[data-image-index]');
        const containerNode = nodeById.get(nodeEl?.dataset.id);
        const targetNodeId = itemEl?.dataset.refNodeId || nodeEl?.dataset.id;
        const index = Number(itemEl?.dataset.refImageIndex ?? itemEl?.dataset.imageIndex ?? 0);
        const node = nodeById.get(targetNodeId);
        const image = node?.images?.[index];

        if(imgEl.tagName?.toLowerCase() === 'img' && image?.url) bindImageProxyFallback(imgEl, image);
        if(!node || !image || image.natural_w || image.natural_h) return;

        const isPreview = isSmartPreviewImage(imgEl);
        const originalSrc = imgEl.dataset?.originalSrc || image.url || '';
        if(isPreview && imgEl.dataset?.previewKind !== 'video' && originalSrc && !image._naturalSizeLoading){
            image._naturalSizeLoading = true;
            loadSmartOriginalImageDimensions(originalSrc).then(size => {
                image._naturalSizeLoading = false;
                if(!size || image.natural_w || image.natural_h) return;
                image.natural_w = size.w;
                image.natural_h = size.h;
                delete image.layout_w;
                delete image.layout_h;
                applyThumbDisplaySizeToElement(itemEl, image, Math.max(itemEl?.clientWidth || 0, itemEl?.clientHeight || 0));
                updateImageResolutionBadgeElement(itemEl, image);
                if((node.images || []).length === 1 && !node.w && !node.h){
                    const layout = singleImageLayout(image, node, mediaNodeDefaultScale(node));
                    node.w = fixedSmartImageNodeSize(node, layout).width;
                    node.h = SMART_IMAGE_NODE_FIXED_HEIGHT;
                    node.scale = 1;
                }
                updateNodeElementDuringResize(node);
                if(containerNode && containerNode.id !== node.id) updateNodeElementDuringResize(containerNode);
                if(isNodeSelected(node.id)) updateComposer();
                scheduleSave();
            });
        }

        if(isPreview && image.layout_w && image.layout_h) return;
        const apply = () => {
            const w = imgEl.naturalWidth || imgEl.videoWidth || 0;
            const h = imgEl.naturalHeight || imgEl.videoHeight || 0;
            if(w <= 0 || h <= 0 || image.natural_w || image.natural_h) return;
            const prevW = Number(image.layout_w || 0);
            const prevH = Number(image.layout_h || 0);
            if(isPreview){
                if(prevW === w && prevH === h) return;
                image.layout_w = w;
                image.layout_h = h;
            } else {
                image.natural_w = w;
                image.natural_h = h;
                delete image.layout_w;
                delete image.layout_h;
            }
            applyThumbDisplaySizeToElement(itemEl, image, Math.max(itemEl?.clientWidth || 0, itemEl?.clientHeight || 0));
            updateImageResolutionBadgeElement(itemEl, image);
            if((node.images || []).length === 1 && !node.w && !node.h){
                const layout = singleImageLayout(image, node, mediaNodeDefaultScale(node));
                node.w = fixedSmartImageNodeSize(node, layout).width;
                node.h = SMART_IMAGE_NODE_FIXED_HEIGHT;
                node.scale = 1;
            }
            updateNodeElementDuringResize(node);
            if(containerNode && containerNode.id !== node.id) updateNodeElementDuringResize(containerNode);
            if(isNodeSelected(node.id)) updateComposer();
            scheduleSave();
        };

        const isVideo = imgEl.tagName?.toLowerCase() === 'video';
        if(!isVideo && imgEl.complete) apply();
        else imgEl.addEventListener('load', apply, {once:true});
        imgEl.addEventListener('loadedmetadata', apply, {once:true});
    });
}


function bindNodeEvents(){
    smartCanvasNodeInteractions.bindAll();
    bindSmartChatEvents();
}
function rectOverlapNode(draggedId, x, y, w, h, excludeIds=[]){

    const cx = x + w/2, cy = y + h/2;

    const excluded = new Set([draggedId, ...(excludeIds || [])]);

    for(const n of ctx.nodes()){

        if(excluded.has(n.id)) continue;

        const r = nodeRect(n);

        if(cx >= r.x && cx <= r.x + r.width && cy >= r.y && cy <= r.y + r.height) return n;

    }

    return null;

}

function dragConnectTargetFor(sourceNode){
    if(!sourceNode || (smartCanvasState.interaction.drag?.group || []).length > 1) return null;
    const rect = nodeRect(sourceNode);
    return rectOverlapNode(sourceNode.id, rect.x, rect.y, rect.width, rect.height, smartCanvasState.interaction.drag?.groupIds || []);
}

function canAutoConnectDraggedNode(sourceNode, targetNode){
    if(!sourceNode || !targetNode || sourceNode.id === targetNode.id) return false;
    if(isHistoryGroupNode(sourceNode) || isHistoryGroupNode(targetNode)) return false;
    return isSmartImageNode(sourceNode) && isSmartImageNode(targetNode);
}

function restoreDraggedNodePosition(){

    if(!smartCanvasState.interaction.drag) return;

    (smartCanvasState.interaction.drag.group || [{id:smartCanvasState.interaction.drag.id, ox:smartCanvasState.interaction.drag.ox, oy:smartCanvasState.interaction.drag.oy}]).forEach(item => {

        const n = ctx.nodes().find(x => x.id === item.id);

        if(n){

            n.x = item.ox;

            n.y = item.oy;

        }

    });

}

let activeDropHighlightEl = null;

function clearDropHighlight(){

    if(activeDropHighlightEl){

        activeDropHighlightEl.classList.remove('drop-target');

        activeDropHighlightEl = null;

        return;

    }

    world.querySelectorAll('.image-node.drop-target').forEach(el => el.classList.remove('drop-target'));

}

function setDropHighlight(targetId){

    if(activeDropHighlightEl?.isConnected && activeDropHighlightEl.dataset.id === targetId) return;

    clearDropHighlight();

    if(!targetId) return;

    const el = world.querySelector(`.image-node[data-id="${targetId}"]`);

    if(el){

        el.classList.add('drop-target');

        activeDropHighlightEl = el;

    }

}



function isSupportedUploadFile(file){

    const type = String(file?.type || '').toLowerCase();

    const name = String(file?.name || '').toLowerCase();

    return type.startsWith('image/') || type.startsWith('video/') || type.startsWith('audio/')

        || /\.(png|jpe?g|webp|gif|mp4|webm|mov|m4v|mp3|wav|m4a|aac|ogg|flac)(\?|$)/.test(name);

}

function dataTransferItemEntry(item){

    try { return item?.webkitGetAsEntry?.() || null; } catch { return null; }

}

async function filesFromEntry(entry){

    if(!entry) return [];

    if(entry.isFile){

        return new Promise(resolve => entry.file(file => resolve(file ? [file] : []), () => resolve([])));

    }

    if(!entry.isDirectory) return [];

    const reader = entry.createReader();

    const children = [];

    while(true){

        const batch = await new Promise(resolve => reader.readEntries(resolve, () => resolve([])));

        if(!batch.length) break;

        children.push(...batch);

    }

    const nested = await Promise.all(children.map(filesFromEntry));

    return nested.flat();

}


function sizeForRun(sourceSettings=ctx.settings()){

    const fallbackResolution = sourceSettings.engine === 'api' && isGptImageAutoSizeModel(sourceSettings.model)

        ? defaultSmartApiResolution(sourceSettings.model)

        : '1k';

    return apiImageSize(sourceSettings.ratio || 'square', sourceSettings.resolution || fallbackResolution, sourceSettings.customRatio || '', sourceSettings.customSize || '') || '1024x1024';

}

function expectedOutputSize(){

    const sizeStr = ctx.settings().engine === 'modelscope'

        ? apiImageSize(ctx.settings().msRatio || 'square', ctx.settings().msResolution || '1k', ctx.settings().msCustomRatio || '', ctx.settings().msCustomSize || '')

        : sizeForRun();

    const parsed = parseSizeValue(sizeStr);

    if(parsed){

        return {w: Number(parsed.width) || 1024, h: Number(parsed.height) || 1024};

    }

    return {w:1024, h:1024};

}

function explicitRequestOutputSizeForPending(){

    if(isApiLikeEngine(ctx.settings().engine) && ctx.settings().apiKind !== 'video'){

        const parsed = parseSizeValue(sizeForRun());

        if(parsed) return {w:Number(parsed.width) || 1024, h:Number(parsed.height) || 1024};

    }

    if(ctx.settings().engine === 'modelscope'){

        const sizeStr = apiImageSize(ctx.settings().msRatio || 'square', ctx.settings().msResolution || '1k', ctx.settings().msCustomRatio || '', ctx.settings().msCustomSize || '');

        const parsed = parseSizeValue(sizeStr);

        if(parsed) return {w:Number(parsed.width) || 1024, h:Number(parsed.height) || 1024};

    }

    return null;

}

function pendingSizeFromImageRef(img){

    const w = Number(img?.natural_w || img?.width || 0);

    const h = Number(img?.natural_h || img?.height || 0);

    return w > 0 && h > 0 ? {w, h} : null;

}

function pendingSourceBoxSize(options={}){

    const sourceNode = options.sourceNode || null;

    if(sourceNode && (sourceNode.images || []).length){

        const rect = nodeRect(sourceNode);

        if(rect.width > 24 && rect.height > 24) return {w:Math.round(rect.width), h:Math.round(rect.height), display:true};

    }

    const ref = (options.refs || []).find(img => img?.url);

    const refSize = pendingSizeFromImageRef(ref);

    if(refSize) return refSize;

    const refNode = ref?.nodeId ? ctx.nodes().find(n => n.id === ref.nodeId) : null;

    if(refNode){

        const rect = nodeRect(refNode);

        if(rect.width > 24 && rect.height > 24) return {w:Math.round(rect.width), h:Math.round(rect.height), display:true};

    }

    return null;

}

function displayBoxFromNaturalSize(size){

    const layout = singleImageLayout(

        {natural_w:size?.w || size?.width || 1024, natural_h:size?.h || size?.height || 1024},

        {type:'smart-image', images:[{}]},

        MEDIA_NODE_DEFAULT_SCALE

    );

    return {w:layout.width, h:layout.height};

}

function pendingBaseBoxSize(options={}){

    const requestSize = explicitRequestOutputSizeForPending();

    if(requestSize) return displayBoxFromNaturalSize(requestSize);

    const sourceSize = pendingSourceBoxSize(options);

    if(sourceSize?.display) return {w:sourceSize.w, h:sourceSize.h};

    if(sourceSize) return displayBoxFromNaturalSize(sourceSize);

    return displayBoxFromNaturalSize(expectedOutputSize());

}

function pendingBoxSize(count, options={}){

    const base = pendingBaseBoxSize(options);

    const aspect = base.w / Math.max(1, base.h);

    const c = Math.max(1, Number(count) || 1);

    if(c <= 1){

        return {w:Math.round(base.w), h:Math.round(base.h)};

    }

    const cols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(c))));

    const rows = Math.ceil(c / cols);

    const cellMax = Math.max(96, Math.min(220, Math.max(base.w, base.h) * 0.42));

    let cellW, cellH;

    if(base.w >= base.h){

        cellW = cellMax;

        cellH = Math.max(40 * MEDIA_NODE_DEFAULT_SCALE, Math.round(cellMax / aspect));

    } else {

        cellH = cellMax;

        cellW = Math.max(40 * MEDIA_NODE_DEFAULT_SCALE, Math.round(cellMax * aspect));

    }

    const w = cols * (cellW + 8) + 16;

    const h = rows * (cellH + 8) + 16;

    return {w, h};

}

    return {
        nodeBodyHtml,
        nodeMetaHtml,
        refreshNodeProviderMeta,
        smartRecoverableImageTask,
        imageTaskRecoverBodyHtml,
        smartNodeToolbarMediaItem,
        nowMs,
        formatRunDuration,
        runTimePillHtml,
        refreshRunTimerPills,
        rememberInlineVideoActivations,
        measureSmartNodeImages,
        bindNodeEvents,
        rectOverlapNode,
        dragConnectTargetFor,
        canAutoConnectDraggedNode,
        restoreDraggedNodePosition,
        clearDropHighlight,
        setDropHighlight,
        isSupportedUploadFile,
        dataTransferItemEntry,
        filesFromEntry,
        sizeForRun,
        pendingBoxSize
    };

}
