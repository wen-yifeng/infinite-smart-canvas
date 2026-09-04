/*
 * smart-canvas-sync-domain.js — 画布同步域（Phase 2 P2.9，自 smart-canvas.js 迁入）。
 *
 * ES module 工厂 `createCanvasSyncDomain(ctx)`；可变共享状态经 ctx 访问器读写，
 * window 别名与 window 挂载名裸引用直达。DOM 结构与类名零漂移，函数体逐行保留
 * （仅可变绑定读写经 AST 引导精确改写为访问器调用）。
 * 域内包含：smartNode 忙碌/完成态助手、图片列表与节点/连线合并、服务端画布应用、
 * 合并重载调度、WS canvas_updated/canvas_task_updated 处理、canvas meta 轮询与
 * 可见性暂停（性能红线：handleCanvasMetaPollVisibilityChange 逐行保留）。
 */
export function createCanvasSyncDomain(ctx) {

    const {
        canvasId,
        downstreamImageTargetsFor,
        isSmartRunnableNode,
        markSmartNodeOutcomeVisual,
        normalizeLegacySmartNode,
        nowMs,
        primarySelectedNode,
        render,
        resumeSmartPendingTasks,
        runBtn,
        scheduleConnectionLayerRefresh,
        scheduleSave,
        setSmartSaveStatus,
        smartCanvasCanvasSyncClient,
        smartCanvasState,
        smartCanvasTaskController,
        smartClientId,
        smartNodeRunTokens,
        smartPendingTasks,
        tr
    } = ctx;


let canvasSyncTimer = null;

let canvasMetaPollTimer = null;

function mergeSmartImageLists(localImgs, remoteImgs){

    const out = [];

    const seen = new Set();

    (localImgs || []).forEach(img => {

        const u = img && img.url;

        if(u && seen.has(u)) return;

        if(u) seen.add(u);

        out.push(img);

    });

    (remoteImgs || []).forEach(img => {

        const u = img && img.url;

        if(!u || seen.has(u)) return;

        seen.add(u);

        out.push(img);

    });

    return out;

}

function smartNodeInFlight(node){

    if(smartNodeHasCompletedResult(node)) return false;

    return Boolean(node && (node.running || node.pending || node.queued || smartPendingTasks(node).length));

}

function smartNodeHasFailedTask(node){
    return smartPendingTasks(node).some(task => task?.failed || ['failed','stale','cancelled'].includes(String(task?.status || '').toLowerCase()));
}

function smartNodeHasDisplayResult(node){

    return Boolean((node?.images || []).some(img => img?.url));

}

function smartNodeHasCompletedResult(node){

    if(!smartNodeHasDisplayResult(node)) return false;

    if(node?.runFinishedAt) return true;

    return !smartPendingTasks(node).length && !Number(node?.pending || 0) && !node?.queued;

}

function clearSmartNodeBusyState(node){

    if(!node) return node;

    smartNodeRunTokens.delete(node.id);

    node.running = false;

    node.pending = 0;

    node.queued = false;
    delete node.pendingTasks;

    return node;

}

function markSmartNodeComplete(node, meta=null){
    if(!node) return node;
    const shouldPulse = meta?.hideTimer !== true && Boolean(node.running || node.pending || node.queued || smartPendingTasks(node).length);
    const keepHidden = node.runTimerHidden === true;
    clearSmartNodeBusyState(node);
    node.runFinishedAt = Number(node.runFinishedAt || 0) || nowMs();
    if(!node.runStartedAt) node.runStartedAt = meta?.createdAt || node.runFinishedAt;
    node.runElapsedMs = Math.max(0, Number(node.runFinishedAt || nowMs()) - Number(node.runStartedAt || node.runFinishedAt || nowMs()));
    node.runTimerHidden = meta?.hideTimer === true || keepHidden;
    if(shouldPulse) markSmartNodeOutcomeVisual(node, 'success');
    return node;
}

function completedDownstreamOutputForNode(sourceNode){

    if(!sourceNode?.id) return null;

    const startedAt = Number(sourceNode.runStartedAt || 0);

    return downstreamImageTargetsFor(sourceNode).find(target => {

        if(!smartNodeHasCompletedResult(target)) return false;

        if(target.sourceNodeId && target.sourceNodeId !== sourceNode.id) return false;

        const finishedAt = Number(target.runFinishedAt || 0);

        return !startedAt || !finishedAt || finishedAt >= startedAt;

    }) || null;

}

function clearSourceBusyStateIfDownstreamDone(sourceNode, options={}){

    if(!sourceNode || !smartNodeInFlight(sourceNode)) return false;

    if(smartPendingTasks(sourceNode).length) return false;

    if(!completedDownstreamOutputForNode(sourceNode)) return false;

    clearSmartNodeBusyState(sourceNode);

    if(!sourceNode.runFinishedAt){

        sourceNode.runFinishedAt = nowMs();

        if(!sourceNode.runStartedAt) sourceNode.runStartedAt = sourceNode.runFinishedAt;

        sourceNode.runElapsedMs = Math.max(0, sourceNode.runFinishedAt - Number(sourceNode.runStartedAt || sourceNode.runFinishedAt));

        sourceNode.runTimerHidden = options.hideTimer === true || sourceNode.runTimerHidden === true;

    }

    return true;

}

function clearCompletedSourceBusyStates(){

    let changed = false;

    (ctx.nodes() || []).forEach(node => {

        if(clearSourceBusyStateIfDownstreamDone(node)) changed = true;

    });

    return changed;

}

function hideCompletedRunTimers(){

    let changed = false;

    (ctx.nodes() || []).forEach(node => {

        if(!node) return;

        if(node.pending || node.running || !node.runFinishedAt || node.runTimerHidden) return;

        node.runTimerHidden = true;

        changed = true;

    });

    return changed;

}

function clearCompletedNodeBusyStates(){

    let changed = false;

    (ctx.nodes() || []).forEach(node => {

        if(!node || !smartNodeHasCompletedResult(node) || !smartNodeInFlight(node)) return;

        markSmartNodeComplete(node);

        changed = true;

    });

    if(clearCompletedSourceBusyStates()) changed = true;

    return changed;

}

function completeSmartNodeWithImages(node, images){

    const copy = {...node, images};

    if(smartNodeHasDisplayResult(copy)) markSmartNodeComplete(copy);

    return copy;

}

function syncRunButtonState(node=primarySelectedNode()){
    if(!runBtn) return;

    const label = runBtn.querySelector('span');
    if(label) label.textContent = tr('smart.run');
    runBtn.removeAttribute('data-progress');

    runBtn.disabled = !isSmartRunnableNode(node) || smartNodeInFlight(node);
}

function mergeSmartNode(local, remote){

    const images = mergeSmartImageLists(local.images, remote.images);

    const localDone = smartNodeHasCompletedResult(local);

    const remoteDone = smartNodeHasCompletedResult(remote);

    const localBusy = smartNodeInFlight(local);

    const remoteBusy = smartNodeInFlight(remote);

    if(localDone && remoteBusy && !remoteDone) return completeSmartNodeWithImages(local, images);

    if(remoteDone && localBusy && !localDone) return completeSmartNodeWithImages(remote, images);

    if(localDone && remoteDone){

        const localFinished = Number(local.runFinishedAt || 0);

        const remoteFinished = Number(remote.runFinishedAt || 0);

        return completeSmartNodeWithImages(remoteFinished >= localFinished ? remote : local, images);

    }

    // 本地正在生成/排队的节点完全以本地为准，只把对方可能多出来的图并进来，绝不被对方旧状态冲掉

    if(smartNodeInFlight(local)){

        return {...local, images};

    }

    // 否则以对方（最新保存方）的布局/标题/设置为基底，但图片取并集——双方生成结果都不丢

    const merged = {...remote, images};

    return smartNodeHasDisplayResult(merged) && (merged.pending || merged.queued || smartPendingTasks(merged).length)

        ? completeSmartNodeWithImages(merged, images)

        : merged;

}

function mergeSmartNodeLists(localNodes, remoteNodes){

    const localById = new Map((localNodes || []).map(n => [n.id, n]));

    const remoteById = new Map((remoteNodes || []).map(n => [n.id, n]));

    const order = [];

    const seen = new Set();

    (localNodes || []).forEach(n => { if(!seen.has(n.id)){ seen.add(n.id); order.push(n.id); } });

    (remoteNodes || []).forEach(n => { if(!seen.has(n.id)){ seen.add(n.id); order.push(n.id); } });

    return order.map(id => {

        const local = localById.get(id);

        const remote = remoteById.get(id);

        if(local && !remote) return local;     // 仅本地存在：保留（我新建的节点；对方删了也宁可复活也不丢结果）

        if(remote && !local) return remote;     // 仅对方存在：加入对方新建的节点

        return mergeSmartNode(local, remote);

    }).filter(Boolean);

}

function mergeSmartConnections(localConns, remoteConns, nodeIds){

    const out = [];

    const seen = new Set();

    [...(localConns || []), ...(remoteConns || [])].forEach(c => {

        if(!c || !nodeIds.has(c.from) || !nodeIds.has(c.to)) return;

        const key = `${c.from}->${c.to}:${c.kind || 'flow'}`;

        if(seen.has(key)) return;

        seen.add(key);

        out.push(c);

    });

    return out;

}

function applyMergedServerCanvas(serverCanvas){

    if(!serverCanvas || !ctx.canvas()) return false;

    const remoteNodes = (Array.isArray(serverCanvas.nodes) ? serverCanvas.nodes : []).map(normalizeLegacySmartNode).filter(Boolean);

    const mergedNodes = mergeSmartNodeLists(ctx.nodes(), remoteNodes);

    const nodeIds = new Set(mergedNodes.map(n => n.id));

    ctx.setNodes(mergedNodes);

    ctx.canvas().connections = mergeSmartConnections(ctx.canvas().connections, serverCanvas.connections, nodeIds);

    const cleanedState = clearCompletedNodeBusyStates();

    ctx.canvas().updated_at = Number(serverCanvas.updated_at || ctx.canvas().updated_at || 0);

    ctx.canvas().revision = Number(serverCanvas.revision || ctx.canvas().revision || 0);

    if(ctx.canvas().title !== serverCanvas.title && serverCanvas.title){

        ctx.canvas().title = serverCanvas.title;

    }

    render('nodes'); // P2b: 远端合并只需刷新节点，不需要 full render

    if(typeof scheduleConnectionLayerRefresh === 'function') scheduleConnectionLayerRefresh();

    if(cleanedState) scheduleSave();

    resumeSmartPendingTasks();
    return true;

}

async function mergeReloadCanvasNow(){

    if(!canvasId) return;
    if(['dirty', 'saving', 'conflict', 'offline', 'error'].includes(smartCanvasState.sync?.status)){
        setSmartSaveStatus('conflict', '检测到远端版本更新，当前改动未自动合并');
        return;
    }

    if(smartCanvasState.interaction.drag || smartCanvasState.interaction.selection){

        // 用户正在拖拽/框选，稍后再合并，别打断操作

        scheduleCanvasMergeReload(600);

        return;

    }

    try {

        const canvasResult = await smartCanvasCanvasSyncClient.load({canvasId});

        if(!canvasResult.ok) return;

        const data = canvasResult.data;

        if(data && data.canvas) applyMergedServerCanvas(data.canvas);

    } catch(e) {}

}

function scheduleCanvasMergeReload(delay=200){

    clearTimeout(canvasSyncTimer);

    canvasSyncTimer = setTimeout(() => { mergeReloadCanvasNow(); }, delay);

}

function handleCanvasUpdatedMessage(data={}){

    if(!data || data.type !== 'canvas_updated') return;

    if(!canvasId || data.canvas_id !== canvasId) return;

    if(data.client_id && data.client_id === smartClientId) return; // 自己发的，忽略

    if(ctx.canvasSyncInFlight()) return; // 我正在保存，保存完成/409 合并会处理
    if(['dirty', 'conflict', 'offline', 'error'].includes(smartCanvasState.sync?.status)){
        setSmartSaveStatus('conflict', '检测到其他窗口修改，当前改动未自动合并');
        return;
    }

    const remoteUpdatedAt = Number(data.updated_at || 0);

    if(remoteUpdatedAt && remoteUpdatedAt <= Number(ctx.canvas()?.updated_at || 0)) return;

    scheduleCanvasMergeReload(200);

}

function handleCanvasTaskUpdatedMessage(data={}){

    const task = data?.type === 'canvas_task_updated' ? data.task : null;

    if(!task?.id) return;

    smartCanvasTaskController.notifyEvent(task);

}

function handleCanvasMetaPollVisibilityChange(){
    if(document.hidden){
        document.documentElement.classList.add('canvas-suspended');
        if(canvasMetaPollTimer){
            clearTimeout(canvasMetaPollTimer);
            canvasMetaPollTimer = null;
        }
        return;
    }
    document.documentElement.classList.remove('canvas-suspended');
    canvasMetaPollDelay = 8000;
    scheduleCanvasMetaPoll(0);
}

function startCanvasMetaPoll(){
    // WS / iframe 转发不可靠时的兜底：仅在前台轮询 updated_at，空闲时逐步退避。
    if(!window.__smartCanvasMetaPollVisibilityBound){
        window.__smartCanvasMetaPollVisibilityBound = true;
        eventManager.addGlobal(document, 'visibilitychange', handleCanvasMetaPollVisibilityChange, {passive:true});
    }
    if(document.hidden){
        document.documentElement.classList.add('canvas-suspended');
        if(canvasMetaPollTimer){
            clearTimeout(canvasMetaPollTimer);
            canvasMetaPollTimer = null;
        }
        return;
    }
    document.documentElement.classList.remove('canvas-suspended');
    if(canvasMetaPollTimer) return;
    scheduleCanvasMetaPoll(canvasMetaPollDelay);
}

let canvasMetaPollDelay = 8000;
function scheduleCanvasMetaPoll(delay=canvasMetaPollDelay){
    if(document.hidden) return;
    if(canvasMetaPollTimer) clearTimeout(canvasMetaPollTimer);
    canvasMetaPollTimer = setTimeout(runCanvasMetaPoll, Math.max(0, Number(delay) || 0));
}

async function runCanvasMetaPoll(){
    canvasMetaPollTimer = null;
    if(document.hidden) return;
    if(!canvasId || !ctx.canvas()){
        scheduleCanvasMetaPoll(canvasMetaPollDelay);
        return;
    }
    if(ctx.canvasSyncInFlight() || smartCanvasState.interaction.drag || smartCanvasState.interaction.selection){
        canvasMetaPollDelay = Math.min(30000, Math.max(8000, Math.round(canvasMetaPollDelay * 1.25)));
        scheduleCanvasMetaPoll(canvasMetaPollDelay);
        return;
    }

    let changed = false;
    try {
        const metaResult = await smartCanvasCanvasSyncClient.loadMeta({canvasId});
        if(metaResult.ok){
            const meta = metaResult.data;
            changed = Number(meta.updated_at || 0) > Number(ctx.canvas().updated_at || 0);
            if(changed) await mergeReloadCanvasNow();
        }
    } catch(e) {}

    canvasMetaPollDelay = changed ? 8000 : Math.min(30000, Math.max(8000, Math.round(canvasMetaPollDelay * 1.5)));
    scheduleCanvasMetaPoll(canvasMetaPollDelay);
}

    return {
        smartNodeInFlight,
        smartNodeHasFailedTask,
        smartNodeHasDisplayResult,
        clearSmartNodeBusyState,
        markSmartNodeComplete,
        hideCompletedRunTimers,
        clearCompletedNodeBusyStates,
        syncRunButtonState,
        handleCanvasUpdatedMessage,
        handleCanvasTaskUpdatedMessage,
        startCanvasMetaPoll
    };

}
