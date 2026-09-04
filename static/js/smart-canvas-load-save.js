/*
 * smart-canvas-load-save.js — 加载/保存/复制粘贴域（Phase 2 P2.9，自 smart-canvas.js 迁入）。
 *
 * ES module 工厂 `createLoadSave(ctx)`；可变共享状态经 ctx 访问器读写，
 * window 别名与 window 挂载名裸引用直达。DOM 结构与类名零漂移，函数体逐行保留
 * （仅可变绑定读写经 AST 引导精确改写为访问器调用）。
 * 域内包含：loadCanvas/saveCanvas 全链（文档模型、patch、退出冲刷、pagehide）、
 * 节点创建/克隆/删除/重命名/媒体清理、复制粘贴（含剪贴板与粘贴节流）、
 * 智能运行快照与生成日志追加。
 */
export function createLoadSave(ctx) {

    const {
        MEDIA_GROUP_DEFAULT_SCALE,
        applyFixedSmartImageNodeSize,
        applyViewport,
        buildSmartCanvasPatch,
        canvasForStorage,
        canvasId,
        cleanupDetachedRunInputRefs,
        clearCompletedNodeBusyStates,
        clearSmartNodeBusyState,
        clearSmartNodeTransientRunState,
        cloneSmartSettings,
        copyMediaSizeFields,
        focusSelectedNodesViewport,
        hideCompletedRunTimers,
        historyGroupForNode,
        imageNameLabel,
        isApiLikeEngine,
        isEditableTarget,
        isHistoryGroupNode,
        loadRecentSmartSettings,
        markSmartCanvasLogDirty,
        markSmartNodeComplete,
        mediaItemForStorage,
        mediaNodeDefaultScale,
        normalizeLegacySmartNode,
        normalizeSmartVideoModeSettings,
        openAssetNameDialog,
        params,
        persistSmartCanvasLog,
        playGenerationCompleteSound,
        rememberCanvasListProject,
        rememberLastCanvasLocation,
        render,
        repairOrphanedFailedPendingOutputs,
        restoreCanvasAssetLibrarySelection,
        restoreCanvasSmartChatState,
        restoreSmartCanvasMinimapVisibility,
        restoreSmartSurfaceState,
        resultMediaUrls,
        resumeSmartPendingTasks,
        safeScale,
        savePromptDraftForCurrent,
        selectedNodeIds,
        setSmartSaveStatus,
        setSmartStorageBaseline,
        settingsForStorage,
        sizeForRun,
        smartCanvasCanvasSyncClient,
        smartCanvasPatchHasChanges,
        smartCanvasState,
        smartCanvasTaskController,
        smartClientId,
        smartNodeHasDisplayResult,
        smartPendingTasks,
        smartRunPlatformLabel,
        smartRunRequestMeta,
        smartRunTaskLabel,
        sourceProjectId,
        startCanvasMetaPoll,
        stripImageGenerationMeta,
        syncSelectionUi,
        toast,
        tr,
        uid,
        updateProviderModels,
        viewport,
        viewportCenter
    } = ctx;

async function loadCanvas(){

    if(!canvasId) return;

    smartCanvasTaskController.setContext(canvasId);

    try {

        const canvasResult = await smartCanvasCanvasSyncClient.load({canvasId});

        if(!canvasResult.ok) return;

        const data = canvasResult.data;

        ctx.setCanvas(window.SmartCanvasDocumentPrimitives?.normalizeDocument

            ? SmartCanvasDocumentPrimitives.normalizeDocument(data.canvas)

            : data.canvas);

        restoreCanvasAssetLibrarySelection();
        restoreSmartCanvasMinimapVisibility();

        ctx.setSmartCanvasDocumentModel(window.SmartCanvasDocumentModel

            ? new SmartCanvasDocumentModel(ctx.canvas())

            : null);

        setSmartStorageBaseline(ctx.canvas());

        rememberCanvasListProject(ctx.canvas().project || 'default');
        rememberLastCanvasLocation(canvasId, ctx.canvas().project || sourceProjectId || 'default');

        ctx.setCanvasUsesConnections(Object.prototype.hasOwnProperty.call(ctx.canvas() || {}, 'connections'));

        document.title = ctx.canvas().title || tr('canvas.smartCanvas');

        ctx.setNodes((Array.isArray(ctx.canvas().nodes) ? ctx.canvas().nodes : []).map(normalizeLegacySmartNode).filter(Boolean));
        restoreCanvasSmartChatState();

        markSmartCanvasLogDirty({reset:true});
        restoreSmartSurfaceState();

        if(ctx.smartCanvasDocumentModel()){

            ctx.smartCanvasDocumentModel().replace({...ctx.canvas(), nodes: ctx.nodes()});

        }

        ctx.canvas().connections = Array.isArray(ctx.canvas().connections) ? ctx.canvas().connections : [];

        ctx.nodes().forEach(n => {

            const pendingTasks = smartPendingTasks(n);

            if(pendingTasks.length){

                n.pending = Math.max(pendingTasks.length, Number(n.pending || 0) || pendingTasks.length);

                n.running = false;

            } else if(smartNodeHasDisplayResult(n)){

                markSmartNodeComplete(n, {hideTimer:true});

            } else if(n.pending || n.queued){

                clearSmartNodeBusyState(n);

            }

        });

        const repairedOrphanOutputs = repairOrphanedFailedPendingOutputs();
        const cleanedCompletedState = clearCompletedNodeBusyStates();

        const hiddenCompletedTimers = hideCompletedRunTimers();

        const cleanedDetachedInputs = cleanupDetachedRunInputRefs();

        Object.assign(viewport, ctx.canvas().viewport || {});

        smartCanvasState.setViewport(viewport, {source:'document-load'});

        viewport.scale = safeScale(viewport.scale);

        if(ctx.canvas().settings) ctx.setSettings({...ctx.settings(), ...ctx.canvas().settings});

        normalizeSmartVideoModeSettings(ctx.settings(), true);

        ctx.nodes().forEach(node => {

            if(node.runSettings) normalizeSmartVideoModeSettings(node.runSettings, true);

        });

        ctx.setCanvasDefaultSmartSettings(cloneSmartSettings(ctx.settings()));

        loadRecentSmartSettings();

        updateProviderModels();

        applyViewport();

        render();

        const migratedIds = (params.get('migrated') || '').split(',').filter(id => ctx.nodes().some(node => node.id === id));
        if(migratedIds.length){
            selectedId = migratedIds[0];
            selectedIds = migratedIds.slice(1);
            syncSelectionUi();
            requestAnimationFrame(() => focusSelectedNodesViewport());
            const url = new URL(location.href);
            url.searchParams.delete('migrated');
            history.replaceState(null, '', url);
        }

        setSmartSaveStatus('saved');

        if(cleanedDetachedInputs || cleanedCompletedState || hiddenCompletedTimers || repairedOrphanOutputs) scheduleSave();

        resumeSmartPendingTasks();
        startCanvasMetaPoll();

    } catch(e) { toast(tr('smart.toastCanvasFail')); }

}

// SMART_CANVAS_PERFORMANCE_20260713: merge short consecutive interactions before serializing the complete canvas.

const SMART_CANVAS_SAVE_DEBOUNCE_MS = 900;

function scheduleSave(){

    setSmartSaveStatus('dirty');

    clearTimeout(ctx.saveTimer());

    ctx.setSaveTimer(setTimeout(saveCanvas, SMART_CANVAS_SAVE_DEBOUNCE_MS));

}

function flushSmartCanvasExitState(){
    if(!canvasId || !ctx.canvas() || typeof fetch !== 'function') return;
    if(ctx.canvasSyncInFlight() || navigator.onLine === false) return;

    const nextViewport = viewport && typeof viewport === 'object'
        ? {x:Number(viewport.x) || 0, y:Number(viewport.y) || 0, scale:Number(viewport.scale) > 0 ? Number(viewport.scale) : 1}
        : {x:0, y:0, scale:1};
    const nextUiState = ctx.canvas().ui_state && typeof ctx.canvas().ui_state === 'object' ? ctx.canvas().ui_state : {};

    const baseline = ctx.smartCanvasDocumentStore().getBaseline();
    const baselineViewport = baseline.viewport && typeof baseline.viewport === 'object' ? baseline.viewport : {x:0, y:0, scale:1};
    const baselineUiState = baseline.ui_state && typeof baseline.ui_state === 'object' ? baseline.ui_state : {};

    const viewportChanged = !ctx.smartCanvasDocumentStore().equal(nextViewport, baselineViewport);
    const uiStateChanged = !ctx.smartCanvasDocumentStore().equal(nextUiState, baselineUiState);
    if(!viewportChanged && !uiStateChanged) return;

    const body = {
        base_updated_at: Number(ctx.canvas().updated_at || baseline.updated_at || 0),
        base_revision: Number(ctx.canvas().revision || baseline.revision || 0),
        client_id: smartClientId,
        viewport: nextViewport,
        ui_state: nextUiState,
    };

    try {
        fetch(`/api/canvases/${encodeURIComponent(canvasId)}`, {
            method:'PATCH',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify(body),
            keepalive:true,
        });
    } catch(error) {
        // 离页兜底尽力而为，不更新保存状态
    }
}

// 退出兜底：直接注册 pagehide，绕过 eventManager 在 beforeunload 的统一清理
window.addEventListener('pagehide', flushSmartCanvasExitState, {passive:true});

async function saveCanvas(){

    if(!canvasId || !ctx.canvas()) return;

    if(ctx.canvasSyncInFlight()){

        ctx.setSaveQueuedAfterFlight(true);

        return;

    }

    savePromptDraftForCurrent();

    prepareSmartCanvasNodesForStorage();

    ctx.canvas().nodes = ctx.nodes();

    ctx.canvas().settings = settingsForStorage(ctx.canvasDefaultSmartSettings() || ctx.initialSmartSettings());

    ctx.canvas().viewport = {...viewport};

    const storageCanvas = canvasForStorage();

    const patch = buildSmartCanvasPatch(storageCanvas);

    if(!smartCanvasPatchHasChanges(patch)){

        setSmartSaveStatus('saved');

        return;

    }

    setSmartSaveStatus('saving');

    ctx.setCanvasSyncInFlight(true);
    let blockQueuedRetry = false;

    try {

        const saveResult = await smartCanvasCanvasSyncClient.save({
            canvasId,
            patch,
            fallbackPayload: buildSmartSaveFallbackPayload(storageCanvas, patch),
        });
        const res = saveResult.response;
        const data = saveResult.data;

        if(res.ok){

            applySmartSaveSuccess(data, storageCanvas);

        } else if(res.status === 409) {

            blockQueuedRetry = true;
            clearTimeout(ctx.saveTimer());
            setSmartSaveStatus('conflict', '检测到其他窗口修改，当前改动未覆盖远端版本');
            return;

        } else {

            const detail = typeof data.detail === 'string' ? data.detail : '服务器未接受保存请求';

            setSmartSaveStatus('error', detail);

        }

    } catch(e) {

        console.warn('[smart-canvas] save failed', e);

        setSmartSaveStatus(navigator.onLine === false ? 'offline' : 'error', navigator.onLine === false ? '当前离线，修改尚未保存' : '网络异常，修改尚未保存');

    } finally {

        ctx.setCanvasSyncInFlight(false);

        if(ctx.saveQueuedAfterFlight() && !blockQueuedRetry){

            ctx.setSaveQueuedAfterFlight(false);

            clearTimeout(ctx.saveTimer());

            ctx.setSaveTimer(setTimeout(saveCanvas, 120));

        }

    }

}

function prepareSmartCanvasNodesForStorage(){

    ctx.nodes().forEach(node => {

        node.images = (node.images || []).map(img => mediaItemForStorage(stripImageGenerationMeta(img)));

        if(node.runSettings) node.runSettings = settingsForStorage(node.runSettings);

    });

}

function buildSmartSaveFallbackPayload(storageCanvas, patch){

    return {
        title:storageCanvas.title || tr("smart.title"),
        icon:storageCanvas.icon || "sparkles",
        nodes:storageCanvas.nodes || [],
        connections:storageCanvas.connections || [],
        viewport:storageCanvas.viewport || {x:0,y:0,scale:1},
        settings:storageCanvas.settings,
        ui_state:storageCanvas.ui_state || {},
        base_updated_at:patch.base_updated_at,
        base_revision:patch.base_revision,
        client_id:smartClientId,
    };

}

function applySmartSaveSuccess(data, storageCanvas){

    if(data.canvas?.updated_at){

        ctx.canvas().updated_at = data.canvas.updated_at;

        storageCanvas.updated_at = data.canvas.updated_at;

    }

    if(data.canvas?.revision !== undefined){

        ctx.canvas().revision = data.canvas.revision;

        storageCanvas.revision = data.canvas.revision;

    }

    setSmartStorageBaseline(storageCanvas);

    setSmartSaveStatus('saved');

}

function inheritNodeMetaFromImage(node){

    if(!node) return;

    node.images = (node.images || []).map(img => stripImageGenerationMeta(img));

}

function executeSmartCanvasCommand(name, mutate, options={}){

    const apply = () => {

        const result = mutate();

        if(result === false) return false;

        if(!options.skipRender) render();

        if(!options.skipSave) scheduleSave();

        return result;

    };

    return options.skipUndo ? apply() : (ctx.smartCanvasCommandBus() || ctx.smartCanvasStore()).execute(name, apply);

}

function bindSmartCanvasTextEditTransaction(element, name, mutate){

    if(!element) return;

    let ownsTransaction = false;

    let dirty = false;

    const begin = () => {

        if(ownsTransaction || (ctx.smartCanvasCommandBus() ? ctx.smartCanvasCommandBus().pending : ctx.smartCanvasStore().pending)) return;

        ownsTransaction = (ctx.smartCanvasCommandBus() || ctx.smartCanvasStore()).begin({name});

    };

    const finish = () => {

        if(!ownsTransaction) return;

        if(dirty) (ctx.smartCanvasCommandBus() || ctx.smartCanvasStore()).commit();

        else (ctx.smartCanvasCommandBus() || ctx.smartCanvasStore()).discard();

        ownsTransaction = false;

        dirty = false;

    };

    element.addEventListener('focus', begin);

    element.addEventListener('input', event => {

        begin();

        if(mutate(event) !== false) dirty = true;

        scheduleSave();

    });

    element.addEventListener('blur', finish);

}

function createNode(x, y, images=[], options={}){

    return executeSmartCanvasCommand('create-image-node', () => {

        const nodeImages = (images || []).map(img => ({...img}));

        const node = {id:uid('smart'), type:'smart-image', x, y, title:nodeImages.length > 1 ? 'Group' : nodeImages.length ? 'Image' : tr('smart.createImportNode'), images:nodeImages, created_at:Date.now()};

        node.scale = nodeImages.length > 1 ? MEDIA_GROUP_DEFAULT_SCALE : mediaNodeDefaultScale(node);

        inheritNodeMetaFromImage(node);
        if(nodeImages.length) applyFixedSmartImageNodeSize(node);

        ctx.nodes().push(node);

        if(options.select !== false) selectedId = node.id;

        return node;

    }, options);

}

function cloneSmartNode(node, dx=0, dy=0){
    const copy = JSON.parse(JSON.stringify(node));
    copy.id = uid('smart');
    copy.x = (Number(node.x) || 0) + dx;
    copy.y = (Number(node.y) || 0) + dy;
    clearSmartNodeTransientRunState(copy, {clearRunHistory:true});
    return copy;
}

function copySelectedNodes(){

    if(!ctx.canvas() || isEditableTarget(document.activeElement)) return;

    const ids = selectedNodeIds();

    const copiedNodes = ids.map(id => ctx.nodes().find(n => n.id === id)).filter(Boolean);

    if(!copiedNodes.length) return;

    const idSet = new Set(copiedNodes.map(n => n.id));

    const copiedConnections = (ctx.canvas().connections || []).filter(c => idSet.has(c.from) && idSet.has(c.to));

    ctx.setNodeClipboard({

        nodes:JSON.parse(JSON.stringify(copiedNodes)),

        connections:JSON.parse(JSON.stringify(copiedConnections))

    });

    toast(`已复制 ${copiedNodes.length} 个节点`);

}

function pasteNodes(){

    if(!ctx.canvas() || !ctx.nodeClipboard()?.nodes?.length || isEditableTarget(document.activeElement)) return false;

    ctx.setLastNodePasteAt(Date.now());

    return executeSmartCanvasCommand('paste-nodes', () => {

        const sourceNodes = ctx.nodeClipboard().nodes;

        const xs = sourceNodes.map(n => Number(n.x) || 0);

        const ys = sourceNodes.map(n => Number(n.y) || 0);

        const cx = (Math.min(...xs) + Math.max(...xs)) / 2;

        const cy = (Math.min(...ys) + Math.max(...ys)) / 2;

        const p = ctx.lastMouseWorld() || viewportCenter();

        const dx = p.x - cx;

        const dy = p.y - cy;

        const idMap = new Map();

        const copies = sourceNodes.map(n => {

            const copy = cloneSmartNode(n, dx, dy);

            idMap.set(n.id, copy.id);

            return copy;

        });

        copies.forEach(copy => {

            if(Array.isArray(copy.inputNodeIds)){

                copy.inputNodeIds = copy.inputNodeIds.map(id => idMap.get(id)).filter(Boolean);

            }

            if(copy.sourceNodeId) copy.sourceNodeId = idMap.get(copy.sourceNodeId) || '';

        });

        const newConnections = (ctx.nodeClipboard().connections || []).map(conn => ({

            ...conn,

            from:idMap.get(conn.from),

            to:idMap.get(conn.to)

        })).filter(conn => conn.from && conn.to && conn.from !== conn.to);

        ctx.canvas().connections = [...(ctx.canvas().connections || []), ...newConnections];

        ctx.nodes().push(...copies);

        selectedId = copies.length === 1 ? copies[0].id : '';

        selectedIds = copies.length > 1 ? copies.map(n => n.id) : [];

        selectedImage = {nodeId:'', index:-1};

        return copies.length;

    });

}

function smartRunSnapshot(node, prompt, refs=[], kind='image', sourceSettings=ctx.settings()){

    const settingsSnapshot = cloneSmartSettings(sourceSettings);

    return {

        nodeId:node?.id || '',
        sourceNodeId:node?.id || '',
        targetNodeId:'',

        nodeType:node?.type || 'smart-image',

        kind,

        settings:settingsSnapshot,

        prompt:prompt || '',

        refs:(refs || []).map(ref => ({
            url:ref.url || '',
            name:ref.name || 'image',
            kind:ref.kind || '',
            nodeId:ref.nodeId || '',
            imageIndex:Number.isFinite(Number(ref.imageIndex)) ? Number(ref.imageIndex) : ''
        })).filter(ref => ref.url),

        size: kind === 'image' && isApiLikeEngine(settingsSnapshot.engine) ? sizeForRun(settingsSnapshot) : ''

    };

}

function addSmartGenerationLog({run, outputs=[], runMs=0, error=''}) {

    if(!ctx.canvas()) return;

    const outputItems = resultMediaUrls(outputs).map(item => {

        if(typeof item === 'string') return {url:item};

        if(!item || typeof item !== 'object') return null;

        const url = item.url || item.path || item.src || item.uri || '';

        if(!url) return null;

        return copyMediaSizeFields(item, {

            url,

            kind:item.kind || item.type || item.mediaKind || '',

            name:item.name || item.filename || ''

        });

    }).filter(item => item?.url);

    if(!error && outputItems.length) playGenerationCompleteSound();

    const entry = {

        id:uid('log'),

        createdAt:Date.now(),

        status:error ? 'failed' : 'success',

        platform:smartRunPlatformLabel(run),

        nodeId:run?.nodeId || '',
        sourceNodeId:run?.sourceNodeId || run?.nodeId || '',
        targetNodeId:run?.targetNodeId || '',

        nodeType:run?.nodeType || 'smart-image',

        model:smartRunTaskLabel(run),

        request:smartRunRequestMeta(run),

        prompt:run?.prompt || '',

        outputs:outputItems,

        refs:run?.refs || [],

        runMs:Number(runMs || 0),

        error:error ? String(error) : ''

    };

    ctx.setSmartCanvasLogsCache([entry, ...ctx.smartCanvasLogsCache()].slice(0, 500));
    ctx.setSmartCanvasLogsTotal(Math.max(ctx.smartCanvasLogsTotal() + 1, ctx.smartCanvasLogsCache().length));
    if(entry.status === 'failed') ctx.smartCanvasLogsSummary().failed += 1;
    else if(['running','pending','queued'].includes(entry.status)) ctx.smartCanvasLogsSummary().running += 1;
    else if(entry.status === 'success') ctx.smartCanvasLogsSummary().success += 1;

    persistSmartCanvasLog(entry);

    markSmartCanvasLogDirty();

    if(!error) render();

}

function deleteNode(id, options={}){

    const node = ctx.nodes().find(item => item.id === id);

    if(!node) return false;

    return executeSmartCanvasCommand('delete-node', () => {

        const deleteIds = new Set([id]);

        ctx.nodes().forEach(item => {

            if(isHistoryGroupNode(item) && item.historyFor === id) deleteIds.add(item.id);

        });

        ctx.setNodes(ctx.nodes().filter(item => !deleteIds.has(item.id)));

        if(ctx.canvas()) ctx.canvas().connections = (ctx.canvas().connections || []).filter(c => !deleteIds.has(c.from) && !deleteIds.has(c.to));

        ctx.nodes().forEach(item => {

            if(Array.isArray(item.inputNodeIds)) item.inputNodeIds = item.inputNodeIds.filter(inputId => !deleteIds.has(inputId));

        });

        if(selectedId === id) selectedId = '';

        selectedIds = selectedIds.filter(selected => !deleteIds.has(selected));

        if(deleteIds.has(selectedImage.nodeId)) selectedImage = {nodeId:'', index:-1};

        return true;

    }, options);

}

function clearNodeMediaBeforeDelete(id){

    const node = ctx.nodes().find(n => n.id === id);

    if(!node || (node.type && node.type !== 'smart-image')) return false;

    const hadMedia = Boolean((node.images || []).length || node.pending);

    if(!hadMedia) return false;

    return executeSmartCanvasCommand('clear-node-media', () => {

        node.images = [];

        node.pending = 0;

        node.running = false;

        node.title = tr('smart.createImportNode');

        delete node.w;

        delete node.h;

        const history = historyGroupForNode(node);

        if(history){

            ctx.setNodes(ctx.nodes().filter(n => n.id !== history.id));

            if(ctx.canvas()) ctx.canvas().connections = (ctx.canvas().connections || []).filter(c => c.from !== history.id && c.to !== history.id);

        }

        if(selectedImage.nodeId === id) selectedImage = {nodeId:'', index:-1};

        selectedId = id;

        selectedIds = [];

        return true;

    });

}

function deleteNodeFromButton(id){

    if(clearNodeMediaBeforeDelete(id)) return;

    deleteNode(id);

}

function deleteImage(id, imageIndex){

    const node = ctx.nodes().find(n => n.id === id);

    if(!node || imageIndex < 0) return;

    return executeSmartCanvasCommand('delete-node-image', () => {

        node.images = (node.images || []).filter((_, index) => index !== imageIndex);

        if(node.images.length <= 1) node.title = 'Image';

        if(selectedImage.nodeId === id) selectedImage = {nodeId:id, index:Math.min(selectedImage.index, node.images.length - 1)};

        if(selectedImage.index < 0) selectedImage = {nodeId:'', index:-1};

        return true;

    });

}

async function renameSmartNodeImage(nodeId, imageIndex){

    const node = ctx.nodes().find(n => n.id === nodeId);

    const index = Math.max(0, Number(imageIndex) || 0);

    const image = node?.images?.[index];

    if(!node || !image) return;

    const current = imageNameLabel(image);

    const name = await openAssetNameDialog({title:'重命名图片', value:current, placeholder:'图片名称', cancelValue:null});

    if(name === null) return;

    const next = String(name || '').trim();

    if(!next || next === current) return;

    executeSmartCanvasCommand('rename-node-image', () => {

        image.name = next;

        selectedId = node.id;

        selectedIds = [];

        selectedImage = {nodeId:node.id, index};

        return true;

    });

}

    return {
        loadCanvas,
        scheduleSave,
        saveCanvas,
        inheritNodeMetaFromImage,
        executeSmartCanvasCommand,
        bindSmartCanvasTextEditTransaction,
        createNode,
        cloneSmartNode,
        copySelectedNodes,
        pasteNodes,
        smartRunSnapshot,
        addSmartGenerationLog,
        deleteNode,
        deleteNodeFromButton,
        deleteImage,
        renameSmartNodeImage
    };

}
