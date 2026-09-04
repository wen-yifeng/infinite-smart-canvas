/*
 * smart-canvas-log-status.js — surface 开合/任务状态/剪贴板/下载/日志视图域（Phase 2 P2.10⑩，自 smart-canvas.js 迁入）。
 *
 * ES module 工厂 `createLogStatus(ctx)`；可变共享状态经 ctx 访问器读写，
 * window 别名与 window 挂载名裸引用直达。DOM 结构与类名零漂移，函数体逐行保留
 * （仅可变绑定读写经 AST 引导精确改写为访问器调用）。
 * 域内包含：minimap 可见性记忆、composer surface 开合状态机、保存状态条与
 * 任务状态渲染、剪贴板写入五函数、媒体下载与运行请求元、日志灯箱聚焦、
 * 日志视图渲染/加载/持久化。
 */
export function createLogStatus(ctx) {

    const {
        SMART_COMPOSER_COLLAPSED_KEY,
        SMART_LOG_INITIAL_RENDER_COUNT,
        SMART_SURFACE_UI_STATE_KEY,
        VIDEO_OPTION_SECTION_DEFAULTS,
        VIDEO_OPTION_SECTION_STATE_KEY,
        apiProviderById,
        assetPanel,
        assetToggle,
        canvasId,
        composer,
        fitNodeIdsViewport,
        keyboardDomain,
        promptPresetPanel,
        promptTemplatePanel,
        safeExportFileName,
        scheduleSave,
        setSmartSelectionState,
        shell,
        smartCanvasCanvasSyncClient,
        smartCanvasLogView,
        smartCanvasPreviewState,
        smartCanvasState,
        smartCanvasTaskController,
        smartChatPanel,
        smartChatToggle,
        smartComposerToggle,
        smartLogList,
        smartLogModal,
        smartLogSummary,
        smartLogToggle,
        smartSaveStatus,
        smartShortcutModal,
        smartShortcutToggle,
        smartTaskStatus,
        smartTaskStatusText,
        syncComposerDock,
        toast,
        toggleAssetLibrary,
        updateComposer,
        videoProviderById
    } = ctx;

const SMART_MINIMAP_VISIBILITY_KEY = 'smartCanvas.minimapVisibility.v1';
const SMART_MINIMAP_DEFAULT_HIDDEN_AFTER = Date.UTC(2026, 6, 27);
function smartMinimapVisibilityKey(){
    return `${SMART_MINIMAP_VISIBILITY_KEY}:${canvasId || 'draft'}`;
}
function restoreSmartCanvasMinimapVisibility(){
    if(!shell) return;
    let stored = '';
    try { stored = localStorage.getItem(smartMinimapVisibilityKey()) || ''; } catch(e){}
    const isNewCanvas = Number(ctx.canvas()?.created_at || 0) >= SMART_MINIMAP_DEFAULT_HIDDEN_AFTER;
    shell.classList.toggle('minimap-hidden', stored ? stored === 'hidden' : isNewCanvas);
}

function setVideoOptionSectionOpen(section, open){
    if(!Object.prototype.hasOwnProperty.call(VIDEO_OPTION_SECTION_DEFAULTS, section)) return;
    ctx.videoOptionSectionState()[section] = Boolean(open);
    try { localStorage.setItem(VIDEO_OPTION_SECTION_STATE_KEY, JSON.stringify(ctx.videoOptionSectionState())); } catch(e){}
}

// Left-side utility surfaces share one interaction slot. The visual assistant and
// prompt workspace share one independent right-side slot.
function setComposerSurfaceCollapsed(collapsed, {source='surface', sync=true}={}){
    smartCanvasState.setComposerDockCollapsed(Boolean(collapsed), {source});
    try { localStorage.setItem(SMART_COMPOSER_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch(e) {}
    if(sync) syncComposerDock();
}

function syncSmartSurfaceState(){
    const assetOpen = Boolean(assetPanel?.classList.contains('open'));
    const logOpen = Boolean(smartLogModal?.classList.contains('open'));
    const shortcutOpen = Boolean(smartShortcutModal?.classList.contains('open'));
    const templateOpen = Boolean(promptTemplatePanel?.classList.contains('open'));
    const presetOpen = Boolean(promptPresetPanel?.classList.contains('open'));
    const chatOpen = Boolean(smartChatPanel?.classList.contains('open'));
    const composerOpen = !Boolean(smartCanvasState.ui.composerDockCollapsed) && !chatOpen;
    ctx.setSmartSurface(chatOpen ? 'chat' : composerOpen ? 'composer' : templateOpen ? 'template' : presetOpen ? 'preset' : assetOpen ? 'asset' : logOpen ? 'log' : shortcutOpen ? 'shortcut' : '');
    shell?.classList.toggle('visual-assistant-open', chatOpen);
    shell?.classList.toggle('prompt-template-open', templateOpen);
    composer?.classList.remove('surface-suspended');
    assetToggle?.classList.toggle('active', assetOpen);
    assetToggle?.setAttribute('aria-expanded', assetOpen ? 'true' : 'false');
    smartLogToggle?.classList.toggle('active', logOpen);
    smartLogToggle?.setAttribute('aria-expanded', logOpen ? 'true' : 'false');
    smartShortcutToggle?.classList.toggle('active', shortcutOpen);
    smartShortcutToggle?.setAttribute('aria-expanded', shortcutOpen ? 'true' : 'false');
    smartChatToggle?.classList.toggle('active', chatOpen);
    smartChatToggle?.setAttribute('aria-expanded', chatOpen ? 'true' : 'false');
    smartComposerToggle?.classList.toggle('active', composerOpen);
    smartComposerToggle?.setAttribute('aria-expanded', composerOpen ? 'true' : 'false');
    smartChatPanel?.setAttribute('aria-hidden', chatOpen ? 'false' : 'true');
    rememberSmartSurfaceState();
}

function rememberSmartSurfaceState({schedule=true}={}){
    if(!ctx.canvas() || !canvasId) return;
    const surface = {
        asset: Boolean(assetPanel?.classList.contains('open')),
        log: Boolean(smartLogModal?.classList.contains('open')),
        shortcut: Boolean(smartShortcutModal?.classList.contains('open')),
        chat: Boolean(smartChatPanel?.classList.contains('open')),
        composer: !Boolean(smartCanvasState.ui.composerDockCollapsed),
        template: Boolean(promptTemplatePanel?.classList.contains('open')),
        preset: Boolean(promptPresetPanel?.classList.contains('open')),
    };
    const before = JSON.stringify(ctx.canvas().ui_state || {});
    ctx.canvas().ui_state = {
        ...(ctx.canvas().ui_state && typeof ctx.canvas().ui_state === 'object' ? ctx.canvas().ui_state : {}),
        [SMART_SURFACE_UI_STATE_KEY]: surface,
    };
    if(schedule && JSON.stringify(ctx.canvas().ui_state) !== before) scheduleSave();
}

function restoreSmartSurfaceState(){
    const saved = ctx.canvas()?.ui_state?.[SMART_SURFACE_UI_STATE_KEY];
    if(!saved || typeof saved !== 'object') return;
    // 左侧：asset 优先，其次 log，其次 shortcut；默认全部关闭。
    // asset / log 内容异步加载，必须走上层入口（toggleAssetLibrary / openSmartCanvasLog），
    // 否则只打开面板壳、不拉数据，会出现"打开即空白"。
    if(saved.asset) toggleAssetLibrary(true);
    else if(saved.log) openSmartCanvasLog();
    else if(saved.shortcut) openSmartSurface('shortcut');
    // 右侧：chat / template / preset / composer 按互斥语义恢复；composer 缺省视为展开
    if(saved.chat) openSmartSurface('chat');
    else if(saved.template) openSmartSurface('template');
    else if(saved.preset) openSmartSurface('preset');
    else if(saved.composer !== false) openSmartSurface('composer');
    else closeSmartSurface('composer');
}

function smartSurfaceGroup(name=''){
    if(['asset', 'log', 'shortcut'].includes(name)) return 'left';
    if(['chat', 'composer', 'template', 'preset'].includes(name)) return 'right';
    return '';
}

function closeSmartSurfacePeers(except = ''){
    const group = smartSurfaceGroup(except);
    if(!group || group === 'left'){
        if(except !== 'asset'){
            ctx.setAssetLibraryOpen(false);
            assetPanel?.classList.remove('open', 'drag-over');
        }
        if(except !== 'log') smartLogModal?.classList.remove('open');
        if(except !== 'shortcut') smartShortcutModal?.classList.remove('open');
    }
    if(!group || group === 'right'){
        if(except !== 'chat') smartChatPanel?.classList.remove('open');
        const keepsComposerTemplatePair = except === 'composer' || except === 'template';
        if(!keepsComposerTemplatePair) setComposerSurfaceCollapsed(true, {source:'surface-peer', sync:false});
        if(!keepsComposerTemplatePair) promptTemplatePanel?.classList.remove('open');
        if(except !== 'preset') promptPresetPanel?.classList.remove('open');
    }
}

function openSmartSurface(name){
    closeSmartSurfacePeers(name);
    if(name === 'asset'){
        ctx.setAssetLibraryOpen(true);
        assetPanel?.classList.add('open');
    } else if(name === 'log'){
        smartLogModal?.classList.add('open');
    } else if(name === 'shortcut'){
        smartShortcutModal?.classList.add('open');
    } else if(name === 'chat'){
        setComposerSurfaceCollapsed(true, {source:'visual-assistant', sync:true});
        smartChatPanel?.classList.add('open');
    } else if(name === 'composer'){
        setComposerSurfaceCollapsed(false, {source:'prompt-workspace', sync:true});
        updateComposer();
    } else if(name === 'template'){
        promptTemplatePanel?.classList.add('open');
    } else if(name === 'preset'){
        promptPresetPanel?.classList.add('open');
    }
    syncSmartSurfaceState();
}

function closeSmartSurface(name){
    if(name === 'asset'){
        ctx.setAssetLibraryOpen(false);
        assetPanel?.classList.remove('open', 'drag-over');
    } else if(name === 'log'){
        smartLogModal?.classList.remove('open');
    } else if(name === 'shortcut'){
        smartShortcutModal?.classList.remove('open');
    } else if(name === 'chat'){
        smartChatPanel?.classList.remove('open');
    } else if(name === 'composer'){
        setComposerSurfaceCollapsed(true, {source:'prompt-workspace', sync:true});
    } else if(name === 'template'){
        promptTemplatePanel?.classList.remove('open');
    } else if(name === 'preset'){
        promptPresetPanel?.classList.remove('open');
    }
    syncSmartSurfaceState();
}

function setSmartSaveStatus(status, message='', meta={}){
    const snapshot = smartCanvasState.setSyncStatus(status, message, meta);
    if(smartSaveStatus){
        const visible = ['error', 'offline', 'conflict'].includes(snapshot.status) && Boolean(snapshot.message);
        smartSaveStatus.hidden = !visible;
        smartSaveStatus.dataset.state = visible ? snapshot.status : '';
        smartSaveStatus.textContent = visible ? snapshot.message : '';
        smartSaveStatus.title = visible ? snapshot.message : '';
    }
    return snapshot;
}

function renderSmartTaskStatus(event={}){
    if(!smartTaskStatus || !smartCanvasTaskController) return;
    const summary = smartCanvasTaskController.getSummary();
    const activeCount = Number(summary.activeCount || 0);
    if(ctx.smartTaskStatusHideTimer()){
        clearTimeout(ctx.smartTaskStatusHideTimer());
        ctx.setSmartTaskStatusHideTimer(null);
    }

    if(activeCount){
        ctx.setSmartTaskStatusSessionActive(true);
        const statuses = summary.statuses || {};
        const queued = Number(statuses.queued || 0);
        const label = queued && !statuses.running
            ? `任务排队中 · ${activeCount}`
            : `任务运行中 · ${activeCount}`;
        smartTaskStatus.hidden = false;
        smartTaskStatus.dataset.state = queued && !statuses.running ? 'queued' : 'running';
        if(smartTaskStatusText) smartTaskStatusText.textContent = label;
        smartTaskStatus.title = label;
        syncComposerTaskStatusPlacement();
        return;
    }

    // 页面刚打开时恢复到的历史终态不属于本次交互，不显示空状态条或旧任务结果。
    if(!ctx.smartTaskStatusSessionActive()){
        smartTaskStatus.hidden = true;
        syncComposerTaskStatusPlacement();
        return;
    }
    // poll-error 是可恢复的查询波动，不应提前把仍在运行的生成任务标记为失败。
    if(event?.type !== 'poll-settled') return;
    const state = event.state || smartCanvasTaskController.getTaskState(event.taskId) || {};
    const status = normalizeSmartCanvasTaskStatus(state.status || event.task?.status);
    const interrupted = status === 'interrupted' || event.error?.stopped || event.error?.code === 'task_stopped';
    const succeeded = status === 'succeeded';
    // 终态状态是 UI 的最终依据：成功不能被之前可恢复的查询错误或旧 error 字段覆盖。
    const failed = ['failed', 'stale', 'cancelled'].includes(status) || (!succeeded && Boolean(event.error && !interrupted));
    const label = interrupted ? '任务已停止' : failed ? '任务失败' : '任务完成';
    smartTaskStatus.hidden = false;
    smartTaskStatus.dataset.state = interrupted ? 'interrupted' : failed ? 'error' : 'success';
    if(smartTaskStatusText) smartTaskStatusText.textContent = label;
    smartTaskStatus.title = label;
    syncComposerTaskStatusPlacement();
    ctx.setSmartTaskStatusHideTimer(setTimeout(() => {
        if(!smartCanvasTaskController.getSummary().activeCount){
            smartTaskStatus.hidden = true;
            ctx.setSmartTaskStatusSessionActive(false);
            syncComposerTaskStatusPlacement();
        }
    }, 2600));
}

function syncComposerTaskStatusPlacement(){
    if(!smartTaskStatus) return;
    const target = document.getElementById('smartStatusRail');
    if(target && smartTaskStatus.parentElement !== target){
        target.appendChild(smartTaskStatus);
    }
}

function copyTextWithCopyEvent(value){

    let handled = false;

    const onCopy = event => {

        event.preventDefault();

        event.clipboardData?.setData('text/plain', value);

        handled = true;

    };

    const cleanupCopy = eventManager.addGlobal(document, 'copy', onCopy);

    try {

        return document.execCommand('copy') && handled;

    } catch(_) {

        return false;

    } finally {

        cleanupCopy();

    }

}

function copyTextWithTextarea(value){

    let ta = null;

    try {

        ta = document.createElement('textarea');

        ta.value = value;

        ta.setAttribute('readonly', '');

        ta.style.position = 'fixed';

        ta.style.left = '-9999px';

        ta.style.top = '0';

        ta.style.opacity = '0';

        document.body.appendChild(ta);

        ta.focus({preventScroll:true});

        ta.select();

        ta.setSelectionRange(0, ta.value.length);

        return document.execCommand('copy');

    } catch(_) {

        return false;

    } finally {

        ta?.remove();

    }

}

async function clipboardMatchesText(value){

    try {

        if(navigator.clipboard?.readText && window.isSecureContext){

            return (await navigator.clipboard.readText()) === value;

        }

    } catch(_) {}

    return null;

}

async function readTextFromClipboard(){
    if(!navigator.clipboard?.readText || window.isSecureContext === false){
        return {ok:false, reason:'unavailable', text:''};
    }
    try {
        return {ok:true, reason:'', text:String(await navigator.clipboard.readText() || '')};
    } catch(_) {
        return {ok:false, reason:'denied', text:''};
    }
}

async function copyTextToClipboard(text){

    const value = String(text || '');

    if(!value) return false;

    if(copyTextWithCopyEvent(value) || copyTextWithTextarea(value)){

        const verified = await clipboardMatchesText(value);

        return verified !== false;

    }

    try {

        if(navigator.clipboard?.writeText && window.isSecureContext !== false){

            await navigator.clipboard.writeText(value);

            const verified = await clipboardMatchesText(value);

            return verified !== false;

        }

    } catch(_) {}

    return false;

}

function fileNameFromUrl(url=''){

    try {

        const parsed = new URL(String(url || ''), window.location.href);

        return decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '');

    } catch(e) {

        return decodeURIComponent(String(url || '').split('?')[0].split('#')[0].split('/').filter(Boolean).pop() || '');

    }

}

function extensionForMediaItem(item, fallback='.png'){

    const source = [item?.name, item?.url].map(value => String(value || '').split('?')[0].split('#')[0]).find(value => /\.[a-z0-9]{2,8}$/i.test(value));

    if(source) return source.match(/(\.[a-z0-9]{2,8})$/i)?.[1] || fallback;

    const kind = mediaKindForItem(item);

    if(kind === 'video') return '.mp4';

    if(kind === 'audio') return '.mp3';

    if(kind === 'text') return '.txt';

    return fallback;

}

function downloadNameForMediaItem(item, fallbackPrefix='canvas-output'){

    const localName = fileNameFromUrl(item?.url || '');

    const preferred = localName || item?.name || '';

    const ext = extensionForMediaItem(item);

    const randomName = `${fallbackPrefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}${ext}`;

    let name = safeExportFileName(preferred || randomName, randomName);

    if(!/\.[a-z0-9]{2,8}$/i.test(name)) name += ext;

    return name;

}

function downloadPreviewImage(){

    const node = ctx.nodes().find(n => n.id === smartCanvasPreviewState.nodeId);

    const image = node?.images?.[smartCanvasPreviewState.index];

    if(!image?.url) return;

    const name = downloadNameForMediaItem(image, 'image');

    const link = document.createElement('a');

    link.href = `/api/download-output?url=${encodeURIComponent(image.url)}&name=${encodeURIComponent(name)}`;

    link.download = name;

    document.body.appendChild(link);

    link.click();

    link.remove();

}

function downloadPreviewFile(item){

    if(!item?.url) return;

    const name = downloadNameForMediaItem(item, 'output');

    const link = document.createElement('a');

    link.href = `/api/download-output?url=${encodeURIComponent(item.url)}&name=${encodeURIComponent(name)}`;

    link.download = name;

    document.body.appendChild(link);

    link.click();

    link.remove();

}


function smartRunPlatformLabel(run){

    const s = run?.settings || {};

    if(s.engine === 'modelscope') return 'Modelscope';

    if(run?.kind === 'video') return videoProviderById(s.videoProvider || '')?.name || s.videoProvider || 'Video';

    return apiProviderById(s.provider_id || '')?.name || s.provider_id || 'API';

}

function smartRunRequestMeta(run){

    const s = run?.settings || {};

    if(s.engine === 'modelscope') return {backend:'Modelscope', model:s.msgenModel || '', custom_model:s.msCustomModel || ''};

    if(run?.kind === 'video') return {provider_id:s.videoProvider || '', model:s.videoModel || '', duration:s.videoDuration || '', aspect_ratio:s.videoAspect || '', resolution:s.videoResolution || ''};

    return {provider_id:s.provider_id || '', model:s.model || '', size:run?.size || '', quality:s.quality || '', n:s.count || 1};

}

function runViewShortcut(...args){ return keyboardDomain.runViewShortcut(...args); }
function cancelActiveCanvasInteraction(...args){ return keyboardDomain.cancelActiveCanvasInteraction(...args); }


function runSmartLogFocusWithGlassFreeze(task){
    const modal = smartLogModal;
    if(!modal || !modal.classList.contains('open') || typeof task !== 'function'){
        return typeof task === 'function' ? task() : undefined;
    }
    const props = ['backdrop-filter', '-webkit-backdrop-filter'];
    const targets = [modal, ...modal.querySelectorAll('.log-item')];
    const saved = targets.map(el => props.map(prop => ({
        el,
        prop,
        value: el.style.getPropertyValue(prop),
        priority: el.style.getPropertyPriority(prop)
    })));
    targets.forEach(el => {
        props.forEach(prop => el.style.setProperty(prop, 'none', 'important'));
    });
    let result;
    try {
        result = task();
    } finally {
        requestAnimationFrame(() => requestAnimationFrame(() => {
            saved.forEach(entry => entry.forEach(item => {
                if(item.priority){
                    item.el.style.setProperty(item.prop, item.value, item.priority);
                } else {
                    item.el.style.removeProperty(item.prop);
                }
            }));
        }));
    }
    return result;
}

function focusSmartLogNode(nodeId, label){
    const node = ctx.nodes().find(item => item.id === nodeId);
    if(!node){
        toast(`${label}已不存在`);
        return false;
    }
    setSmartSelectionState({primaryId:node.id, ids:[node.id], image:{nodeId:'', index:-1}}, {source:'log-focus'});
    const focused = runSmartLogFocusWithGlassFreeze(() => fitNodeIdsViewport([node.id]));
    if(focused) toast(`已定位${label}`);
    return focused;
}

function closeSmartLogLightbox(){
    smartCanvasLogView.closeLightbox();
}

function smartLogPreviewNode(url, kind='image', nodeId=''){
    smartCanvasLogView.preview(url, kind, nodeId);
}

function smartCanvasLogsSummaryText(){
    const s = ctx.smartCanvasLogsSummary();
    return `成功 ${s.success} · 运行中 ${s.running} · 失败 ${s.failed}`;
}

function renderSmartCanvasLog(){
    const logs = ctx.smartCanvasLogsCache();
    if(logs.length) ctx.setSmartLogVisibleCount(Math.max(ctx.smartLogVisibleCount(), Math.min(logs.length, SMART_LOG_INITIAL_RENDER_COUNT)));
    smartCanvasLogView.renderList({
        list:smartLogList,
        summary:smartLogSummary,
        logs,
        visibleCount:ctx.smartLogVisibleCount(),
        summaryText:smartCanvasLogsSummaryText()
    });
    ctx.setSmartLogRenderedVersion(ctx.smartLogRenderVersion());
}

function markSmartCanvasLogDirty({reset=false}={}){
    ctx.setSmartLogRenderVersion(1);
    if(reset){
        ctx.setSmartLogRenderedVersion(-1);
        ctx.setSmartLogVisibleCount(0);
        ctx.setSmartLogServerLoaded(false);
        ctx.setSmartCanvasLogsCache([]);
        ctx.setSmartCanvasLogsTotal(0);
        ctx.setSmartCanvasLogsSummary({success:0, running:0, failed:0});
        if(smartLogList) smartLogList.innerHTML = '';
    }
    if(smartLogModal?.classList.contains('open')) scheduleSmartCanvasLogRender();
}

function scheduleSmartCanvasLogRender(){
    if(!smartLogModal?.classList.contains('open') || ctx.smartLogRenderFrame()) return;
    ctx.setSmartLogRenderFrame(requestAnimationFrame(() => {
        ctx.setSmartLogRenderFrame(0);
        if(!smartLogModal?.classList.contains('open') || ctx.smartLogRenderedVersion() === ctx.smartLogRenderVersion()) return;
        renderSmartCanvasLog();
    }));
}

async function loadSmartCanvasLogs({offset=0, limit=SMART_LOG_RENDER_STEP}={}){
    if(!canvasId || ctx.smartLogLoadingMore()) return;
    ctx.setSmartLogLoadingMore(true);
    try {
        const result = await smartCanvasCanvasSyncClient.loadLogs({canvasId, offset, limit});
        if(result.ok && result.data){
            const data = result.data;
            const page = Array.isArray(data.logs) ? data.logs : [];
            if(offset === 0){
                const pageIds = new Set(page.map(l => l?.id || l?.createdAt));
                const localOnly = ctx.smartCanvasLogsCache().filter(l => !pageIds.has(l?.id || l?.createdAt));
                ctx.setSmartCanvasLogsCache(localOnly.length ? [...localOnly, ...page] : page);
                ctx.setSmartLogServerLoaded(true);
            } else {
                ctx.setSmartCanvasLogsCache([...ctx.smartCanvasLogsCache(), ...page]);
            }
            ctx.setSmartCanvasLogsTotal(Number(data.total || 0) || ctx.smartCanvasLogsCache().length);
            if(data.summary) ctx.setSmartCanvasLogsSummary(data.summary);
            ctx.setSmartLogVisibleCount(ctx.smartCanvasLogsCache().length);
            if(smartLogModal?.classList.contains('open')) renderSmartCanvasLog();
        }
    } catch(e) {
        console.warn('[smart-canvas] load logs failed', e);
    } finally {
        ctx.setSmartLogLoadingMore(false);
    }
}

async function persistSmartCanvasLog(entry){
    if(!canvasId || !entry) return;
    try {
        await smartCanvasCanvasSyncClient.appendLog({canvasId, entry});
    } catch(e) {
        console.warn('[smart-canvas] append log failed', e);
    }
}

function openSmartCanvasLog(){

    if(!ctx.canvas()) return;

    openSmartSurface('log');

    if(ctx.smartLogRenderedVersion() < 0 && !smartLogList.childElementCount){
        smartLogList.innerHTML = '<div class="log-loading">正在加载日志...</div>';
    }

    if(!ctx.smartLogServerLoaded() && !ctx.smartLogLoadingMore()){
        if(!smartLogList.childElementCount) smartLogList.innerHTML = '<div class="log-loading">正在加载日志...</div>';
        loadSmartCanvasLogs({offset:0, limit:SMART_LOG_INITIAL_RENDER_COUNT});
    } else {
        scheduleSmartCanvasLogRender();
    }

}

function closeSmartCanvasLog(){

    closeSmartSurface('log');

}

function closeSmartCanvasShortcuts(){

    closeSmartSurface('shortcut');

}

    return {
        smartMinimapVisibilityKey,
        restoreSmartCanvasMinimapVisibility,
        setVideoOptionSectionOpen,
        syncSmartSurfaceState,
        restoreSmartSurfaceState,
        openSmartSurface,
        closeSmartSurface,
        setSmartSaveStatus,
        renderSmartTaskStatus,
        syncComposerTaskStatusPlacement,
        readTextFromClipboard,
        copyTextToClipboard,
        fileNameFromUrl,
        downloadPreviewImage,
        downloadPreviewFile,
        smartRunPlatformLabel,
        smartRunRequestMeta,
        runViewShortcut,
        cancelActiveCanvasInteraction,
        focusSmartLogNode,
        closeSmartLogLightbox,
        markSmartCanvasLogDirty,
        loadSmartCanvasLogs,
        persistSmartCanvasLog,
        openSmartCanvasLog,
        closeSmartCanvasLog,
        closeSmartCanvasShortcuts
    };

}
