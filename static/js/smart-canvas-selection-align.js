/*
 * smart-canvas-selection-align.js — 选择/对齐/贴靠域（Phase 2 P2.10⑥，自 smart-canvas.js 迁入）。
 *
 * ES module 工厂 `createSelectionAlign(ctx)`；可变共享状态经 ctx 访问器读写，
 * window 别名与 window 挂载名裸引用直达。DOM 结构与类名零漂移，函数体逐行保留
 * （仅可变绑定读写经 AST 引导精确改写为访问器调用）。
 * 域内包含：选择 UI 状态与节点结果视觉态（outcome visuals）、选择/命令/composer
 * dock 同步、syncSelectionUi 全链、选择操作（delete/toggle/primary）、
 * 节点贴靠引导层与 snap 几何、startSmartNodeDrag 拖拽启动、节点几何基元
 * （nodeRect/smartNodeGeometryOptions/fixedSmartImageNodeSize）、连接簇排列与
 * 对齐（arrangeSmartIdsByConnections/applySmartNodeAlignment）、
 * arrangeSelectedSmartNodes/normalizeSelectedSmartImageHeights。
 */
export function createSelectionAlign(ctx) {

    const {
        SMART_CANVAS_COMMANDS,
        SMART_IMAGE_NODE_FIXED_HEIGHT,
        SMART_IMAGE_NODE_MAX_WIDTH,
        SMART_IMAGE_NODE_MIN_WIDTH,
        SMART_LOG_PREVIEW_NODE_ID,
        SMART_NODE_SNAP_RELEASE_PX,
        SMART_NODE_SNAP_THRESHOLD_PX,
        addUrlToAssetLibrary,
        capturePendingUndo,
        closeSmartSurface,
        composer,
        deleteNode,
        downloadPreviewFile,
        executeSmartCanvasCommand,
        fitNodeIdsViewport,
        imageLayout,
        invalidateShellRectCache,
        isHistoryGroupNode,
        isSmartImageNode,
        isSmartRunnableNode,
        mediaLayoutSize,
        nodeScale,
        nowMs,
        openSmartSurface,
        promptInput,
        querySmartImageTaskNow,
        refreshConnectionLayer,
        refreshIcons,
        refreshSelectedConnectionScope,
        render,
        savePromptDraftForCurrent,
        scheduleConnectionLayerRefresh,
        scheduleSave,
        selectedNode,
        setSmartSelectionState,
        shell,
        smartCanvasContextName,
        smartCanvasNodeCount,
        smartCanvasState,
        smartCommandDock,
        smartComposer,
        smartFocusSelectionBtn,
        smartNodeElementsByIds,
        smartPendingTasks,
        smartRecoverableImageTask,
        smartSelectionDock,
        smartSelectionDockLabel,
        smartTitle,
        syncComposerTaskStatusPlacement,
        syncComposerViewportActions,
        syncRunButtonState,
        syncSmartSelectedImageResolution,
        toast,
        updateComposer,
        upstreamNodesForKinds,
        viewport,
        world
    } = ctx;

let smartSelectionUiNodeIds = new Set();

let smartSelectionUiImage = {nodeId:'', index:-1};

const SMART_NODE_OUTCOME_VISUAL_MS = 1100;
const smartNodeOutcomeVisuals = new Map();

function markSmartNodeOutcomeVisual(nodeOrId, state='success'){
    const nodeId = String(nodeOrId?.id || nodeOrId || '').trim();
    const visualState = state === 'error' ? 'error' : 'success';
    if(!nodeId) return;
    const token = `${visualState}:${nowMs()}:${Math.random()}`;
    smartNodeOutcomeVisuals.set(nodeId, {state:visualState, token, expiresAt:nowMs() + SMART_NODE_OUTCOME_VISUAL_MS});
    syncSmartNodeOutcomeVisuals([nodeId]);
    setTimeout(() => {
        const current = smartNodeOutcomeVisuals.get(nodeId);
        if(!current || current.token !== token) return;
        smartNodeOutcomeVisuals.delete(nodeId);
        const el = world.querySelector(`.image-node[data-id="${CSS.escape(nodeId)}"]`);
        el?.classList.remove('node-success-pulse', 'node-error-pulse');
    }, SMART_NODE_OUTCOME_VISUAL_MS + 80);
}

function syncSmartNodeOutcomeVisuals(nodeIds=null){
    const now = nowMs();
    smartNodeOutcomeVisuals.forEach((entry, nodeId) => {
        if(!entry || entry.expiresAt <= now) smartNodeOutcomeVisuals.delete(nodeId);
    });
    const ids = nodeIds == null
        ? null
        : Array.from(new Set((Array.isArray(nodeIds) ? nodeIds : [nodeIds]).map(id => String(id || '').trim()).filter(Boolean)));
    const elements = ids == null
        ? world.querySelectorAll('.image-node')
        : ids.map(id => world.querySelector(`.image-node[data-id="${CSS.escape(id)}"]`)).filter(Boolean);
    elements.forEach(el => {
        const entry = smartNodeOutcomeVisuals.get(el.dataset.id || '');
        el.classList.toggle('node-success-pulse', entry?.state === 'success');
        el.classList.toggle('node-error-pulse', entry?.state === 'error');
    });
}

function syncSmartCanvasContext(){
    if(smartCanvasContextName) smartCanvasContextName.textContent = String(ctx.canvas()?.title || '').trim() || '当前画布';
    if(smartCanvasNodeCount) smartCanvasNodeCount.textContent = `${ctx.nodes().filter(node => node.id !== SMART_LOG_PREVIEW_NODE_ID).length} 个节点`;
}

function primarySelectedMediaItem(){
    const node = primarySelectedNode();
    if(!node) return {node:null, item:null};
    const preferred = selectedImage.nodeId === node.id ? node.images?.[Number(selectedImage.index || 0)] : null;
    return {node, item:preferred || node.images?.[0] || null};
}

async function runSmartSelectionDockAction(action){
    const node = primarySelectedNode();
    if(!node){ toast('请先选择节点'); return; }
    if(action === 'upstream'){
        const upstream = upstreamNodesForKinds(node, ['input','flow']);
        if(!upstream.length){ toast('当前节点没有可定位的上游'); return; }
        setSmartSelectionState({primaryId:upstream[0].id, ids:upstream.slice(1).map(item => item.id), image:{nodeId:'', index:-1}}, {source:'selection-dock-upstream'});
        syncSelectionUi();
        updateComposer();
        fitNodeIdsViewport(upstream.map(item => item.id));
        return;
    }
    if(action === 'edit-prompt'){
        openSmartSurface('composer');
        requestAnimationFrame(() => promptInput?.focus());
        return;
    }
    const media = primarySelectedMediaItem();
    if(action === 'download'){
        if(!media.item?.url){ toast('当前节点没有可下载媒体'); return; }
        downloadPreviewFile(media.item);
        return;
    }
    if(action === 'save-asset'){
        if(!media.item?.url){ toast('当前节点没有可保存媒体'); return; }
        try { await addUrlToAssetLibrary(media.item.url, media.item.name || node.title || 'canvas-asset'); }
        catch(error){ toast(String(error?.message || error || '保存失败')); }
        return;
    }
    if(action === 'query-task'){
        const task = smartRecoverableImageTask(node);
        if(!task){ toast('当前节点没有可查询的失败任务'); return; }
        await querySmartImageTaskNow(node.id, task.taskId);
    }
}

function syncSelectionDockUi(){
    const ids = selectedNodeIds();
    const primary = primarySelectedNode();
    syncSmartCanvasContext();
    if(smartTitle){
        smartTitle.hidden = ids.length === 0;
        smartTitle.textContent = ids.length ? `已选择 ${ids.length} 个节点` : '';
    }
    if(smartFocusSelectionBtn) smartFocusSelectionBtn.disabled = ids.length < 1;
    if(smartSelectionDock){
        smartSelectionDock.hidden = ids.length === 0;
        if(smartSelectionDockLabel) smartSelectionDockLabel.textContent = ids.length > 1 ? `已选择 ${ids.length} 个节点` : String(primary?.title || primary?.name || '已选择节点');
        const media = primarySelectedMediaItem();
        smartSelectionDock.querySelector('[data-selection-action="download"]')?.toggleAttribute('disabled', !media.item?.url);
        smartSelectionDock.querySelector('[data-selection-action="save-asset"]')?.toggleAttribute('disabled', !media.item?.url);
        smartSelectionDock.querySelector('[data-selection-action="query-task"]')?.toggleAttribute('disabled', !smartRecoverableImageTask(primary));
    }
    syncCommandDockUi();
}

function syncCommandDockUi(){
    if(!smartCommandDock) return;
    for(const command of SMART_CANVAS_COMMANDS){
        const button = smartCommandDock.querySelector(`[data-canvas-command="${command.id}"]`);
        if(!button) continue;
        const available = Boolean(command.available());
        button.disabled = !available;
        button.title = available ? command.label : `${command.label}：${command.unavailableHint || '当前不可用'}`;
    }
}

function renderCommandDock(){
    if(!smartCommandDock) return;
    smartCommandDock.innerHTML = SMART_CANVAS_COMMANDS.map(command =>
        `<button type="button" data-canvas-command="${command.id}" aria-label="${command.label}" title="${command.label}"><i data-lucide="${command.icon}"></i></button>`
    ).join('');
    refreshIcons(smartCommandDock);
    syncCommandDockUi();
}

function syncComposerDock(){
    const collapsed = Boolean(smartCanvasState.ui.composerDockCollapsed);
    if(smartComposer){
        smartComposer.syncDock({collapsed});
        composer?.classList.toggle('open', !collapsed || composer.classList.contains('open'));
        syncComposerTaskStatusPlacement();
        return;
    }
    composer?.classList.toggle('collapsed', collapsed);
    composer?.classList.toggle('screen-docked', true);
    composer?.classList.toggle('open', !collapsed || composer.classList.contains('open'));
    syncComposerTaskStatusPlacement();
}

function toggleComposerDock(){
    if(smartCanvasState.ui.composerDockCollapsed) openSmartSurface('composer');
    else closeSmartSurface('composer');
}

function syncComposerPromptEditingIndicator(){
    const editingNodeId = ctx.composerPromptEditingNodeId();
    world.querySelectorAll('.image-node.composer-prompt-editing').forEach(el => {
        if(!editingNodeId || el.dataset.id !== editingNodeId) el.classList.remove('composer-prompt-editing');
    });
    if(editingNodeId){
        const editingNode = world.querySelector(`.image-node[data-id="${CSS.escape(editingNodeId)}"]`);
        if(editingNode && !editingNode.classList.contains('composer-prompt-editing')){
            editingNode.classList.add('composer-prompt-editing');
        }
    }
}
function syncSelectionUi(){

    const ids = selectedNodeIds();

    const nextIds = new Set(ids);

    const primaryId = primarySelectedNode()?.id || '';
    if(primaryId && isSmartRunnableNode(ctx.nodes().find(node => node.id === primaryId))) ctx.setLastComposerRunnableNodeId(primaryId);

    const touchedIds = new Set([...smartSelectionUiNodeIds, ...nextIds]);

    if(smartSelectionUiImage.nodeId) touchedIds.add(smartSelectionUiImage.nodeId);

    if(selectedImage.nodeId) touchedIds.add(selectedImage.nodeId);

    world.classList.toggle('smart-multi-selected', ids.length > 1);

    smartNodeElementsByIds(touchedIds).forEach(el => {

        const id = el.dataset.id || '';

        el.classList.toggle('selected', isNodeSelected(id));

        el.classList.toggle('primary-selected', Boolean(primaryId) && id === primaryId);

        el.querySelectorAll('.thumb-item,.image-wrap').forEach(item => {

            const targetNodeId = item.dataset.refNodeId || id;

            const index = Number(item.dataset.refImageIndex ?? item.dataset.imageIndex ?? 0);

            item.classList.toggle('image-selected', selectedImage.nodeId === targetNodeId && selectedImage.index === index);

        });

    });

    syncComposerPromptEditingIndicator();

    smartSelectionUiNodeIds = nextIds;

    smartSelectionUiImage = {nodeId:selectedImage.nodeId || '', index:Number(selectedImage.index ?? -1)};

    syncSmartSelectedImageResolution(world);

    syncRunButtonState();

    syncSelectionDockUi();

    syncComposerDock();
    syncComposerViewportActions();

    refreshSelectedConnectionScope();
    syncSelectionContextVisuals();

}

// Temporary selection context makes a chain legible without introducing a focus mode.
function syncSelectionContextVisuals(options={}){
    const roots = new Set(selectedNodeIds());
    const active = roots.size > 0 && ctx.smartSelectedConnectionScopeIds().size > 0;
    world.classList.toggle('selection-context-active', active);
    world.querySelectorAll('.image-node').forEach(el => {
        const id = el.dataset.id || '';
        const upstream = active && !roots.has(id) && ctx.smartSelectedUpstreamIds().has(id);
        const downstream = active && !roots.has(id) && ctx.smartSelectedDownstreamIds().has(id);
        el.classList.toggle('context-related', active && ctx.smartSelectedConnectionScopeIds().has(id));
        el.classList.toggle('context-muted', active && !ctx.smartSelectedConnectionScopeIds().has(id));
        el.classList.toggle('context-upstream', upstream && !downstream);
        el.classList.toggle('context-downstream', downstream && !upstream);
        el.classList.toggle('context-bridge', upstream && downstream);
    });
    if(options.refreshConnections !== false) refreshConnectionLayer();
}

function isNodeSelected(id){

    return selectedId === id || selectedIds.includes(id);

}

function selectedNodeIds(){

    return SmartCanvasSelectionPrimitives.nodeIds({primaryId:selectedId, ids:selectedIds}, ctx.nodes());

}

function deleteSelectedSmartNodes(){

    const ids = selectedNodeIds();

    if(!ids.length) return false;

    return (ctx.smartCanvasCommandBus() || ctx.smartCanvasStore()).execute('delete-selected', () => {

        ids.forEach(id => deleteNode(id, {skipUndo:true, skipRender:true, skipSave:true}));

        render();

        scheduleSave();

        return true;

    });

}

function primarySelectedNode(){

    const direct = selectedNode();

    if(direct) return direct;

    return selectedIds.map(id => ctx.nodes().find(node => node.id === id)).find(Boolean) || null;

}

function toggleSmartNodeSelection(nodeId){ // SMART_CANVAS_SHIFT_MULTI_UPLOAD_HEIGHT_20260714

    if(!nodeId || !ctx.nodes().some(node => node.id === nodeId)) return false;

    savePromptDraftForCurrent();

    const current = selectedNodeIds();

    const removing = current.includes(String(nodeId));

    const next = SmartCanvasSelectionPrimitives.toggleNode({primaryId:selectedId, ids:current}, nodeId, ctx.nodes());

    setSmartSelectionState(next, {source:'toggle-selection'});

    return !removing;

}

function isHeightNormalizableUploadNode(node){

    if(!isSmartImageNode(node) || isHistoryGroupNode(node)) return false;

    const images = node.images || [];

    if(images.length > 0) return true;

    return !node.pending && !node.queued && !node.running && !node.pendingOutputPlaceholder && !smartPendingTasks(node).length;

}

function selectedHeightNormalizableNodes(){

    return selectedNodeIds()

        .map(id => ctx.nodes().find(node => node.id === id))

        .filter(isHeightNormalizableUploadNode);

}

let smartNodeSnapGuideLayer = null;

function ensureSmartNodeSnapGuides(){
    if(smartNodeSnapGuideLayer?.isConnected) return smartNodeSnapGuideLayer;
    const layer = document.createElement('div');
    layer.className = 'smart-node-snap-guides';
    layer.hidden = true;
    ['vertical', 'horizontal'].forEach(axis => {
        const guide = document.createElement('span');
        guide.className = `smart-node-snap-guide smart-node-snap-guide-${axis}`;
        guide.dataset.axis = axis;
        guide.hidden = true;
        layer.appendChild(guide);
    });
    shell.appendChild(layer);
    smartNodeSnapGuideLayer = layer;
    return layer;
}

function clearSmartNodeSnapGuides(){
    if(!smartNodeSnapGuideLayer) return;
    smartNodeSnapGuideLayer.hidden = true;
    smartNodeSnapGuideLayer.querySelectorAll('.smart-node-snap-guide').forEach(guide => {
        guide.hidden = true;
    });
}

function smartNodeDragBounds(groupItems){
    if(!groupItems?.length) return null;
    const left = Math.min(...groupItems.map(item => item.ox));
    const top = Math.min(...groupItems.map(item => item.oy));
    const right = Math.max(...groupItems.map(item => item.ox + item.width));
    const bottom = Math.max(...groupItems.map(item => item.oy + item.height));
    return {left, top, right, bottom, centerX:(left + right) / 2, centerY:(top + bottom) / 2};
}

function smartNodeSnapViewportBounds(){
    const scale = Math.max(0.06, Number(viewport.scale) || 1);
    return {
        left:-viewport.x / scale,
        top:-viewport.y / scale,
        right:(shell.clientWidth - viewport.x) / scale,
        bottom:(shell.clientHeight - viewport.y) / scale
    };
}

function smartNodeSnapCandidates(nodeMap, excludedIds, visibleBounds){
    const excluded = new Set(excludedIds || []);
    const candidates = {x:[], y:[]};
    nodeMap.forEach((candidate, id) => {
        if(excluded.has(id)) return;
        const rect = nodeRect(candidate);
        const x = Number(rect.x) || 0;
        const y = Number(rect.y) || 0;
        const width = Number(rect.width) || 0;
        const height = Number(rect.height) || 0;
        if(!(width > 0) || !(height > 0)) return;
        if(
            visibleBounds &&
            (x + width < visibleBounds.left || x > visibleBounds.right || y + height < visibleBounds.top || y > visibleBounds.bottom)
        ) return;
        candidates.x.push(
            {value:x, start:y, end:y + height, kind:'start'},
            {value:x + width / 2, start:y, end:y + height, kind:'center'},
            {value:x + width, start:y, end:y + height, kind:'end'}
        );
        candidates.y.push(
            {value:y, start:x, end:x + width, kind:'start'},
            {value:y + height / 2, start:x, end:x + width, kind:'center'},
            {value:y + height, start:x, end:x + width, kind:'end'}
        );
    });
    return candidates;
}

function closestSmartNodeSnap(anchors, candidates, threshold, releaseThreshold, previous){
    if(previous){
        const anchor = anchors.find(item => item.kind === previous.anchorKind);
        if(anchor){
            const delta = previous.candidate.value - anchor.value;
            if(Math.abs(delta) <= releaseThreshold) return {...previous, delta};
        }
    }
    let best = null;
    anchors.forEach(anchor => {
        candidates.forEach(candidate => {
            if(candidate.kind !== anchor.kind) return;
            const delta = candidate.value - anchor.value;
            const distance = Math.abs(delta);
            if(distance > threshold || (best && distance >= best.distance)) return;
            best = {candidate, anchorKind:anchor.kind, delta, distance};
        });
    });
    return best;
}

function renderSmartNodeSnapGuides(drag, snapX, snapY, moveDx, moveDy){
    if(!snapX && !snapY){
        clearSmartNodeSnapGuides();
        return;
    }
    const layer = ensureSmartNodeSnapGuides();
    const vertical = layer.querySelector('[data-axis="vertical"]');
    const horizontal = layer.querySelector('[data-axis="horizontal"]');
    const bounds = drag.groupBounds;
    const scale = Math.max(0.06, Number(viewport.scale) || 1);
    layer.hidden = false;

    if(snapX){
        const top = Math.min(bounds.top + moveDy, snapX.candidate.start);
        const bottom = Math.max(bounds.bottom + moveDy, snapX.candidate.end);
        vertical.style.left = `${viewport.x + snapX.candidate.value * scale}px`;
        vertical.style.top = `${viewport.y + top * scale}px`;
        vertical.style.height = `${Math.max(1, (bottom - top) * scale)}px`;
        vertical.hidden = false;
    } else {
        vertical.hidden = true;
    }

    if(snapY){
        const left = Math.min(bounds.left + moveDx, snapY.candidate.start);
        const right = Math.max(bounds.right + moveDx, snapY.candidate.end);
        horizontal.style.left = `${viewport.x + left * scale}px`;
        horizontal.style.top = `${viewport.y + snapY.candidate.value * scale}px`;
        horizontal.style.width = `${Math.max(1, (right - left) * scale)}px`;
        horizontal.hidden = false;
    } else {
        horizontal.hidden = true;
    }
}

function smartNodeDragSnapOffset(drag, rawDx, rawDy){
    if(!drag) return {dx:rawDx, dy:rawDy};
    if(!drag.groupBounds || drag.ctrlGroup){
        drag.snapState = {x:null, y:null};
        clearSmartNodeSnapGuides();
        return {dx:rawDx, dy:rawDy};
    }
    const scale = Math.max(0.06, Number(viewport.scale) || 1);
    const threshold = SMART_NODE_SNAP_THRESHOLD_PX / scale;
    const releaseThreshold = SMART_NODE_SNAP_RELEASE_PX / scale;
    const bounds = drag.groupBounds;
    const xAnchors = [
        {kind:'start', value:bounds.left + rawDx},
        {kind:'center', value:bounds.centerX + rawDx},
        {kind:'end', value:bounds.right + rawDx}
    ];
    const yAnchors = [
        {kind:'start', value:bounds.top + rawDy},
        {kind:'center', value:bounds.centerY + rawDy},
        {kind:'end', value:bounds.bottom + rawDy}
    ];
    const snapX = closestSmartNodeSnap(xAnchors, drag.snapCandidates?.x || [], threshold, releaseThreshold, drag.snapState?.x);
    const snapY = closestSmartNodeSnap(yAnchors, drag.snapCandidates?.y || [], threshold, releaseThreshold, drag.snapState?.y);
    const dx = rawDx + (snapX?.delta || 0);
    const dy = rawDy + (snapY?.delta || 0);
    drag.snapState = {x:snapX, y:snapY};
    renderSmartNodeSnapGuides(drag, snapX, snapY, dx, dy);
    return {dx, dy};
}

function startSmartNodeDrag(node, event, options={}){

    if(!node) return false;

    invalidateShellRectCache();
    clearSmartNodeSnapGuides();

    const nodeMap = new Map(ctx.nodes().map(item => [item.id, item]));

    const elementMap = new Map([...world.querySelectorAll('.image-node')].map(el => [el.dataset.id, el]));

    const selectedDragIds = selectedNodeIds();
    const dragIds = selectedDragIds.includes(node.id) ? selectedDragIds : [node.id];

    const group = dragIds.map(dragId => {

        const n = nodeMap.get(dragId);

        if(!n) return null;
        const rect = nodeRect(n);
        return {
            id:n.id,
            ox:Number(n.x) || 0,
            oy:Number(n.y) || 0,
            width:Number(rect.width) || 0,
            height:Number(rect.height) || 0
        };

    }).filter(Boolean);

    smartCanvasState.beginInteraction('drag', {

        id:node.id,

        startX:Number.isFinite(Number(options.startX)) ? Number(options.startX) : event.clientX,

        startY:Number.isFinite(Number(options.startY)) ? Number(options.startY) : event.clientY,

        ox:Number(node.x) || 0,

        oy:Number(node.y) || 0,

        group,

        groupIds:group.map(item => item.id),

        ctrlGroup:Boolean(options.ctrlGroup),

        keyboardMove:Boolean(options.keyboardMove),

        nodeMap,

        elementMap,

        groupBounds:smartNodeDragBounds(group),

        snapCandidates:smartNodeSnapCandidates(nodeMap, group.map(item => item.id), smartNodeSnapViewportBounds()),

        snapState:{x:null, y:null}

    }, {source:'node-drag'});

    document.body.classList.add('smart-node-drag');

    if(options.captureUndo !== false) capturePendingUndo();

    return true;

}

function beginSelectedSmartNodeMove(){
    if(smartCanvasState.interaction.drag) return false;
    const selected = selectedNodeIds();
    const node = ctx.nodes().find(candidate => selected.includes(candidate.id));
    if(!node) return false;
    const rect = shell.getBoundingClientRect();
    const pointer = ctx.lastMouseClient() || {x:rect.left + rect.width / 2, y:rect.top + rect.height / 2};
    return startSmartNodeDrag(node, {clientX:pointer.x, clientY:pointer.y}, {
        ctrlGroup:false,
        keyboardMove:true
    });
}

function fixedSmartImageNodeSize(node, rectOverride=null){
    if(!window.SmartCanvasNodeSizing) return {width:Math.max(SMART_IMAGE_NODE_MIN_WIDTH, Math.round(Number(node?.w) || SMART_IMAGE_NODE_FIXED_HEIGHT)), height:SMART_IMAGE_NODE_FIXED_HEIGHT};
    return SmartCanvasNodeSizing.fixedSize(node, {
        height:SMART_IMAGE_NODE_FIXED_HEIGHT,
        minWidth:SMART_IMAGE_NODE_MIN_WIDTH,
        maxWidth:SMART_IMAGE_NODE_MAX_WIDTH,
        mediaSize:mediaLayoutSize,
        rectForNode:() => rectOverride || nodeRect(node)
    });
}

function applyFixedSmartImageNodeSize(node, rectOverride=null){
    if(!node || !isSmartImageNode(node)) return false;
    if(window.SmartCanvasNodeSizing){
        return SmartCanvasNodeSizing.applyFixedSize(node, {
            height:SMART_IMAGE_NODE_FIXED_HEIGHT,
            minWidth:SMART_IMAGE_NODE_MIN_WIDTH,
            maxWidth:SMART_IMAGE_NODE_MAX_WIDTH,
            mediaSize:mediaLayoutSize,
            rectForNode:() => rectOverride || nodeRect(node)
        });
    }
    const next = fixedSmartImageNodeSize(node, rectOverride);
    node.w = next.width;
    node.h = next.height;
    node.scale = 1;
    return true;
}

function nodeRect(node){
    return SmartCanvasNodeGeometryPrimitives.nodeRect(
        node,
        current => imageLayout(current?.images || [], nodeScale(current), current)
    );
}

function smartNodeGeometryOptions(){
    return {
        isSmartImageNode,
        isHistoryGroupNode,
        mediaKindForItem,
        mediaLayoutSize,
        rectForNode:nodeRect
    };
}

// SMART_CANVAS_SINGLE_IMAGE_ASPECT_LOCK_20260713: single-image input and output nodes keep the source image ratio while scaling.

function singleImageAspectRatio(node){
    return SmartCanvasNodeGeometryPrimitives.singleImageAspectRatio(node, smartNodeGeometryOptions());
}

function resetSingleImageAspect(node){
    return SmartCanvasNodeGeometryPrimitives.resetSingleImageAspect(node, smartNodeGeometryOptions());
}

function connectedSmartClusterIds(seedId){
    return SmartCanvasNodeGeometryPrimitives.connectedClusterIds(seedId, ctx.nodes(), ctx.canvas()?.connections || []);
}

function smartArrangeAtomicIds(ids){
    return SmartCanvasNodeGeometryPrimitives.existingNodeIds(ids, ctx.nodes());
}

function translateSmartNodeWithMembers(node, dx, dy, seen=new Set()){

    if(!node || seen.has(node.id)) return;

    seen.add(node.id);

    node.x = Math.round((Number(node.x) || 0) + dx);

    node.y = Math.round((Number(node.y) || 0) + dy);

}

function moveSmartNodeAtom(node, x, y){

    const dx = Math.round(x - (Number(node.x) || 0));

    const dy = Math.round(y - (Number(node.y) || 0));

    translateSmartNodeWithMembers(node, dx, dy);

}

function arrangeSmartIdsByConnections(ids){
    const moves = SmartCanvasNodeGeometryPrimitives.arrangeByConnections(
        ids,
        ctx.nodes(),
        ctx.canvas()?.connections || [],
        nodeRect,
        {preFiltered: true}
    );
    if(!moves.length) return false;
    const nodesById = new Map(ctx.nodes().map(node => [node.id, node]));
    moves.forEach(move => moveSmartNodeAtom(nodesById.get(move.id), move.x, move.y));
    return true;
}

function selectedSmartAlignmentNodes(){

    const ids = smartArrangeAtomicIds(selectedNodeIds().filter(id => ctx.nodes().some(node => node.id === id)));

    return ids.map(id => ctx.nodes().find(node => node.id === id)).filter(Boolean);

}

function applySmartNodeAlignment(mode){
    const selected = selectedSmartAlignmentNodes();
    const connections = ctx.canvas()?.connections || [];
    const alignmentGroupCount = SmartCanvasNodeGeometryPrimitives.alignmentGroupCount(selected, connections);
    const minimum = SmartCanvasNodeGeometryPrimitives.minimumAlignmentSelection(mode);
    if(alignmentGroupCount < minimum){
        toast(mode.startsWith('distribute') ? '请至少选择 3 个节点或整体进行等距分布' : '请至少选择 2 个节点或整体进行对齐');
        return false;
    }
    const moves = SmartCanvasNodeGeometryPrimitives.alignmentMoves(
        mode, selected, nodeRect, connections);
    if(!moves.length) return false;
    const nodesById = new Map(selected.map(node => [node.id, node]));
    const changed = executeSmartCanvasCommand(`align-${mode}`, () => {
        moves.forEach(move => moveSmartNodeAtom(nodesById.get(move.id), move.x, move.y));
        return true;
    });
    if(changed === false) return false;
    scheduleConnectionLayerRefresh();
    toast({left:'已按最顶节点/整体左对齐', top:'已按最左节点/整体顶部对齐', 'distribute-h':'已横向等距分布', 'distribute-v':'已纵向等距分布'}[mode] || '已调整节点位置');
    return true;
}

function arrangeSelectedSmartNodes(){

    if(!ctx.canvas()) return false;

    const explicit = selectedNodeIds()
        .map(id => ctx.nodes().find(node => node.id === id))
        .filter(node => node && !isHistoryGroupNode(node))
        .map(node => node.id);

    if(!explicit.length) return false;

    const ids = smartArrangeAtomicIds(explicit.length > 1 ? explicit : connectedSmartClusterIds(explicit[0]));

    if(ids.length < 2) return false;

    const changed = executeSmartCanvasCommand('arrange-selected-nodes', () => arrangeSmartIdsByConnections(ids));

    if(changed === false) return false;

    toast('已整理选中节点');

    return true;

}

function normalizeSelectedSmartImageHeights(){ // SMART_CANVAS_BATCH_TOOLS_20260714

    const selected = selectedHeightNormalizableNodes();

    if(selected.length < 1){

        toast('请选择至少 1 个图片或上传节点');

        return false;

    }

    const targetHeight = SMART_IMAGE_NODE_FIXED_HEIGHT;

    const changed = executeSmartCanvasCommand('normalize-selected-image-heights', () => {

        selected.forEach(node => {

            const rect = nodeRect(node);
            applyFixedSmartImageNodeSize(node, rect);

        });

        return true;

    });

    if(changed === false) return false;

    toast(`已将 ${selected.length} 个图片或上传节点统一为 ${targetHeight}px 高`);

    return true;

}

    return {
        markSmartNodeOutcomeVisual,
        syncSmartNodeOutcomeVisuals,
        syncSmartCanvasContext,
        runSmartSelectionDockAction,
        syncSelectionDockUi,
        renderCommandDock,
        syncComposerDock,
        toggleComposerDock,
        syncComposerPromptEditingIndicator,
        syncSelectionUi,
        syncSelectionContextVisuals,
        isNodeSelected,
        selectedNodeIds,
        deleteSelectedSmartNodes,
        primarySelectedNode,
        toggleSmartNodeSelection,
        selectedHeightNormalizableNodes,
        clearSmartNodeSnapGuides,
        smartNodeDragSnapOffset,
        startSmartNodeDrag,
        beginSelectedSmartNodeMove,
        fixedSmartImageNodeSize,
        applyFixedSmartImageNodeSize,
        nodeRect,
        singleImageAspectRatio,
        resetSingleImageAspect,
        smartArrangeAtomicIds,
        selectedSmartAlignmentNodes,
        applySmartNodeAlignment,
        arrangeSelectedSmartNodes,
        normalizeSelectedSmartImageHeights
    };

}
