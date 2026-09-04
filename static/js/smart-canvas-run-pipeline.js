/*
 * smart-canvas-run-pipeline.js — 运行管线域（Phase 2 P2.9，自 smart-canvas.js 迁入）。
 *
 * ES module 工厂 `createRunPipeline(ctx)`；可变共享状态经 ctx 访问器读写，
 * window 别名与 window 挂载名裸引用直达。DOM 结构与类名零漂移，函数体逐行保留
 * （仅可变绑定读写经 AST 引导精确改写为访问器调用）。
 * 域内包含：提示词组装（collectPromptParts/buildPromptRequest）、pending 占位与
 * 失败恢复、运行视觉状态机、四条生成路径（runGeneration/api/video/modelscope）、
 * 任务轮询/终态分派/重试调度/断线恢复（幂等键与重试语义逐行保留）。
 */
export function createRunPipeline(ctx) {

    const {
        MEDIA_NODE_DEFAULT_SCALE,
        MS_GEN_MODELS,
        SMART_IMAGE_NODE_FIXED_HEIGHT,
        SMART_REFERENCE_IMAGE_MAX,
        activeComposerNode,
        addConnection,
        addSmartGenerationLog,
        apiImageSize,
        applyFixedSmartImageNodeSize,
        applyUploadedUrlsToSmartRefs,
        attachRunMeta,
        audioRefsOnly,
        blockedInputRefKeys,
        canvasId,
        clearPromptInput,
        cloneSmartSettings,
        connectInputNode,
        copyMediaSizeFields,
        defaultReferenceImagesFor,
        fixedSmartImageNodeSize,
        imageRefsOnly,
        inputRefKey,
        isApiLikeEngine,
        isHistoryGroupNode,
        isSmartImageNode,
        isSmartRunnableNode,
        manualSmartMediaLinks,
        manualSmartVideoLink,
        markSmartNodeOutcomeVisual,
        modelscopeImageModels,
        nodeRect,
        nowMs,
        parseSizeValue,
        pendingBoxSize,
        primarySelectedNode,
        promptHtmlWithMentionTokens,
        promptInput,
        rememberRecentSmartSettings,
        render,
        resultMediaUrls,
        saveCanvas,
        scheduleSave,
        scheduleSmartCanvasNodesRender,
        scheduleSmartCanvasStatusRender,
        setPromptText,
        sizeForRun,
        smartCanvasGenerationClient,
        smartCanvasTaskClient,
        smartCanvasTaskController,
        smartNodeHasDisplayResult,
        smartNodeInFlight,
        smartNodeRunTokens,
        smartRecoverableImageTask,
        smartRunNeedsPrompt,
        smartRunSnapshot,
        smartSettingsForNode,
        snapshotRunMeta,
        stripImageGenerationMeta,
        stripRunInputMeta,
        syncRunButtonState,
        toast,
        tr,
        uid,
        uniqueReferenceImages,
        videoProviderPlatform,
        videoRefsOnly
    } = ctx;

function collectPromptParts(){

    const parts = [];

    const walk = node => {

        if(node.nodeType === Node.TEXT_NODE){

            if(node.textContent) parts.push({type:'text', text:node.textContent});

            return;

        }

        if(node.nodeType !== Node.ELEMENT_NODE) return;

        if(node.classList?.contains('mention-image-token')){

            let assetUris = {};

            try { assetUris = JSON.parse(node.dataset.assetUris || '{}') || {}; } catch(e) { assetUris = {}; }

            const kind = node.dataset.kind || 'image';

            parts.push({type:'image', kind, url:node.dataset.url || '', name:node.dataset.name || smartMediaKindLabel(kind), nodeId:node.dataset.nodeId || '', imageIndex:Number(node.dataset.imageIndex || 0), asset_uris:assetUris});

            return;

        }

        if(node.tagName === 'BR'){

            parts.push({type:'text', text:'\n'});

            return;

        }

        const blockTags = new Set(['DIV','P','LI','SECTION','ARTICLE','HEADER','FOOTER','BLOCKQUOTE']);

        const isBlock = node !== promptInput && blockTags.has(node.tagName);

        if(isBlock && parts.length && parts[parts.length - 1]?.text && !/\n$/.test(parts[parts.length - 1].text)) parts.push({type:'text', text:'\n'});

        node.childNodes.forEach(walk);

        if(isBlock) parts.push({type:'text', text:'\n'});

    };

    promptInput.childNodes.forEach(walk);

    return parts;

}

function originalPromptTextFromParts(parts){

    let text = '';

    (parts || []).forEach(part => {

        if(part.type === 'text'){

            text += part.text || '';

            return;

        }

        if(part.type === 'image') text += `@${part.name || '图片'}`;

    });

    return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

}

function buildPromptRequest(node, overrideDefaultImages=null, consumeDefault=false, ctx=null, sourceSettings=ctx.settings()){

    const parts = collectPromptParts();

    const originalPrompt = originalPromptTextFromParts(parts);

    const blockedRefs = blockedInputRefKeys(node);

    const hasOverrideImages = Array.isArray(overrideDefaultImages);

    const filteredDefaultImages = (hasOverrideImages ? overrideDefaultImages : defaultReferenceImagesFor(node, consumeDefault, ctx))

        .filter(img => !blockedRefs.has(inputRefKey(img)));

    const defaultRefs = uniqueReferenceImages(filteredDefaultImages);

    const refs = defaultRefs.map((img, index) => ({...img, role:`image_${index + 1}`}));

    let hasMentionToken = false;

    const refMap = new Map();

    refs.forEach((img, index) => refMap.set(img.url, index + 1));

    let body = '';

    parts.forEach(part => {

        if(part.type === 'text'){

            body += part.text;

            return;

        }

        if(!part.url) return;

        hasMentionToken = true;

        const mentionedKey = inputRefKey(part);

        if(blockedRefs.has(mentionedKey)){

            body += `@${part.name || '图片'}`;

            return;

        }

        if(!refMap.has(part.url)){

            if(refs.length >= SMART_REFERENCE_IMAGE_MAX){

                body += `@${part.name || '图片'}`;

                return;

            }

            refMap.set(part.url, refs.length + 1);

            refs.push({url:part.url, name:part.name || `图${refs.length + 1}`, nodeId:part.nodeId, imageIndex:part.imageIndex, kind:part.kind || 'image', asset_uris:part.asset_uris || {}, role:`image_${refs.length + 1}`});

        }

        body += `图${refMap.get(part.url)}`;

    });

    body = body.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

    const displayPrompt = originalPrompt || body;

    if(hasMentionToken && refs.length){

        const mapText = refs.map((img, i) => `图${i + 1}：${img.name || `图片${i + 1}`}`).join('\n');

        return {

            prompt:`${tr('smart.refMapHeader')}\n${mapText}\n\n${tr('smart.refUserNeed')}\n${body}`,

            displayPrompt,

            refs:refs.map((img, index) => ({url:img.url, name:img.name || `图${index + 1}`, kind:img.kind || mediaKindForItem(img), asset_uris:img.asset_uris || {}, role:`image_${index + 1}`})),

            mentioned:true

        };

    }

    return {

        prompt:body,

        displayPrompt,

        refs:refs.map((img, index) => ({url:img.url, name:img.name || `图${index + 1}`, kind:img.kind || mediaKindForItem(img), asset_uris:img.asset_uris || {}, role:`image_${index + 1}`})),

        mentioned:false

    };

}

function nextOutputPositionForSource(sourceNode, pendingBox, options={}){
    if(!sourceNode) return {x:0, y:0};
    const sourceRect = nodeRect(sourceNode);
    const fallback = {x:(sourceRect.x || 0) + sourceRect.width + 80, y:sourceRect.y || 0};
    if(
        typeof SmartCanvasNodeGeometryPrimitives?.connectedClusterIds !== 'function'
        || typeof SmartCanvasNodeGeometryPrimitives?.arrangeByConnections !== 'function'
    ) return fallback;

    // Plan the pending child with the same graph layout used by D, but apply
    // only the new node's move so existing hand-positioned nodes stay put.
    const pendingId = options.nodeId || `pending-layout-${Date.now()}`;
    const pendingCreatedAt = Number(options.createdAt) || Date.now();
    const pendingRect = {
        x:(sourceRect.x || 0) + (sourceRect.width || 0) + 160,
        y:sourceRect.y || 0,
        width:Number(pendingBox?.w) || 260,
        height:Number(pendingBox?.h) || 260
    };
    const pendingNode = {
        id:pendingId,
        type:'smart-image',
        x:pendingRect.x,
        y:pendingRect.y,
        w:pendingRect.width,
        h:pendingRect.height,
        images:[],
        created_at:pendingCreatedAt,
        pendingOutputPlaceholder:true
    };
    const plannedNodes = [...ctx.nodes(), pendingNode];
    const plannedConnections = [...(ctx.canvas()?.connections || []), {from:sourceNode.id, to:pendingId, kind:'flow'}];
    const scopeIds = SmartCanvasNodeGeometryPrimitives.connectedClusterIds(
        sourceNode.id, plannedNodes, plannedConnections);
    const moves = SmartCanvasNodeGeometryPrimitives.arrangeByConnections(
        scopeIds,
        plannedNodes,
        plannedConnections,
        node => node.id === pendingId ? pendingRect : nodeRect(node),
        {preFiltered:true}
    );
    const placement = moves.find(move => move.id === pendingId);
    return Number.isFinite(Number(placement?.x)) && Number.isFinite(Number(placement?.y))
        ? {x:placement.x, y:placement.y}
        : fallback;
}

function createPendingOutputFromSource(sourceNode, expectedCount, meta, options={}){

    const pendingBox = pendingBoxSize(expectedCount, {sourceNode, refs:options.refs || meta?.promptRefs || []});
    const outputId = uid('smart');
    const createdAt = Date.now();

    const pos = nextOutputPositionForSource(sourceNode, pendingBox, {nodeId:outputId, createdAt});

    const output = {

        id:outputId,

        type:'smart-image',

        x:pos.x,

        y:pos.y,

        title:'Image',

        images:[],

        pending:Math.max(1, Number(expectedCount) || 1),

        runStartedAt:nowMs(),

        runTimerHidden:false,

        w:pendingBox.w,

        h:pendingBox.h,

        scale:MEDIA_NODE_DEFAULT_SCALE,

        created_at:createdAt,

        pendingOutputPlaceholder:true

    };

    applyFixedSmartImageNodeSize(output, {width:pendingBox.w, height:pendingBox.h});

    output._selectAfterRunId = options.selectOutput ? output.id : sourceNode.id;

    ctx.nodes().push(output);

    if(options.connectSource === false) addConnection(sourceNode.id, output.id, 'flow');

    else connectInputNode(sourceNode.id, output.id);

    attachRunMeta(output, options.stripInputMeta ? stripRunInputMeta(meta) : meta);

    selectedId = sourceNode.id;

    selectedImage = {nodeId:'', index:-1};

    return output;

}

function removeFailedPendingOutputNode(node){

    if(!node || (node.images || []).length) return false;

    if(!node.pendingOutputPlaceholder && node._selectAfterRunId !== node.id) return false;

    const incoming = (ctx.canvas()?.connections || []).find(conn => conn.to === node.id && (conn.kind || 'flow') !== 'history');

    const fallbackId = incoming?.from && ctx.nodes().some(item => item.id === incoming.from) ? incoming.from : '';

    ctx.setNodes(ctx.nodes().filter(item => item.id !== node.id));

    if(ctx.canvas()) ctx.canvas().connections = (ctx.canvas().connections || []).filter(conn => conn.from !== node.id && conn.to !== node.id);

    if(selectedId === node.id) selectedId = fallbackId;

    selectedIds = selectedIds.filter(id => id !== node.id);

    if(selectedImage.nodeId === node.id) selectedImage = {nodeId:'', index:-1};

    return true;

}

function clearFailedPendingOutputPlaceholder(node){
    if(!node) return false;
    delete node.pendingOutputPlaceholder;
    if(node._selectAfterRunId === node.id) delete node._selectAfterRunId;
    return true;
}

function isOrphanedFailedPendingOutput(node){
    return Boolean(
        node
        && !smartNodeHasDisplayResult(node)
        && (node.pendingOutputPlaceholder || node._selectAfterRunId === node.id)
        && !smartPendingTasks(node).length
        && !Number(node.pending || 0)
        && !node.queued
        && !node.running
    );
}

function repairOrphanedFailedPendingOutputs(){
    const orphanIds = (ctx.nodes() || []).filter(isOrphanedFailedPendingOutput).map(node => node.id);
    let removed = 0;
    orphanIds.forEach(id => {
        const node = ctx.nodes().find(item => item.id === id);
        if(node && removeFailedPendingOutputNode(node)) removed += 1;
    });
    return removed;
}

function downstreamImageTargetsFor(node){

    if(!node?.id) return [];

    return SmartCanvasConnectionPrimitives.outgoingConnections(node.id, ctx.canvas()?.connections || [], ['input', 'flow'])

        .filter(conn => conn.from === node.id && ['input','flow'].includes(conn.kind || 'flow'))

        .map(conn => ctx.nodes().find(n => n.id === conn.to))

        .filter(n => isSmartImageNode(n) && !isHistoryGroupNode(n))

        .sort((a, b) => {

            const ax = Number(a.x) || 0, bx = Number(b.x) || 0;

            if(ax !== bx) return ax - bx;

            return (Number(a.y) || 0) - (Number(b.y) || 0);

        });

}

function coolNodeRunningState(node, ms=2000){

    if(!node) return 0;

    const token = ctx.setSmartRunStateToken(ctx.smartRunStateToken() + 1);

    smartNodeRunTokens.set(node.id, token);

    node.running = true;

    setTimeout(() => {

        if(smartNodeRunTokens.get(node.id) !== token) return;

        smartNodeRunTokens.delete(node.id);

        const current = ctx.nodes().find(n => n.id === node.id);

        if(current){

            current.running = false;

            render();

        }

    }, ms);

    return token;

}

function clearNodeRunningState(node){

    if(!node) return;

    smartNodeRunTokens.delete(node.id);

    node.running = false;

}


function cleanHistoryImages(images=[]){
    return SmartCanvasRunDataPrimitives.cleanHistoryImages(images);
}

function hasHistoryConnection(nodeId, groupId){

    return Boolean(nodeId && groupId && (ctx.canvas()?.connections || []).some(conn => conn.from === nodeId && conn.to === groupId && (conn.kind || 'flow') === 'history'));

}

function demoteHistoryGroupNode(group){

    if(!group) return;

    delete group.historyFor;

    delete group.isHistoryGroup;

    if(group.title === '历史分组'){

        const count = (group.images || []).length;

        group.title = count > 1 ? 'Group' : count === 1 ? 'Image' : tr('smart.createImportNode');

    }

}

function historyGroupForNode(node){

    if(!node?.id) return null;

    let matched = null;

    ctx.nodes().forEach(n => {

        if(!isHistoryGroupNode(n) || n.historyFor !== node.id) return;

        if(hasHistoryConnection(node.id, n.id)){

            if(!matched) matched = n;

        } else {

            demoteHistoryGroupNode(n);

        }

    });

    return matched;

}

function loadNodePromptDraftToInput(node){

    if(node?.promptDraftHtml) {

        const hasToken = String(node.promptDraftHtml || '').includes('mention-image-token');

        promptInput.innerHTML = hasToken

            ? node.promptDraftHtml

            : (promptHtmlWithMentionTokens(node.runPrompt || node.promptDraftText || '', node.runPromptRefs || []) || node.promptDraftHtml);

    } else {

        const rebuilt = promptHtmlWithMentionTokens(node?.runPrompt || '', node?.runPromptRefs || []);

        if(rebuilt) promptInput.innerHTML = rebuilt;

        else setPromptText(node?.runPrompt || '');

    }

}

const smartGenerationSubmissionLocks = new Map();

function lockSmartGenerationSubmission(node){

    const nodeId = String(node?.id || '');

    if(!nodeId || smartGenerationSubmissionLocks.has(nodeId)) return null;

    const token = {nodeId, startedAt:nowMs()};

    smartGenerationSubmissionLocks.set(nodeId, token);

    return token;

}

function unlockSmartGenerationSubmission(token){

    if(!token?.nodeId || smartGenerationSubmissionLocks.get(token.nodeId) !== token) return;

    smartGenerationSubmissionLocks.delete(token.nodeId);

}

function smartTaskRunKey(prefix='run'){

    return smartCanvasTaskController.generateRunKey(prefix);

}

function smartTaskIdempotencyKey(base, index=0){

    return smartCanvasTaskController.idempotencyKey(base, index);

}

function buildPromptRequestForNode(node, defaultImages, ctx=null, sourceSettings=ctx.settings()){
    const oldHtml = promptInput.innerHTML;
    loadNodePromptDraftToInput(node);
    try {
        return buildPromptRequest(node, defaultImages, false, ctx, sourceSettings);
    } finally {
        promptInput.innerHTML = oldHtml;
    }
}

function restoreSourceVisualState(node, snapshot){
    if(!node || !snapshot) return node;
    node.images = Array.isArray(snapshot.images) ? snapshot.images.map(image => ({...image})) : [];
    for(const key of ['title', 'w', 'h', 'scale', 'outputKind']){
        if(snapshot[key] === undefined) delete node[key];
        else node[key] = snapshot[key];
    }
    return node;
}

function buildRunGenerationRequest(node, explicitNode, runSettings){
    const request = explicitNode
        ? buildPromptRequestForNode(node, null, null, runSettings)
        : buildPromptRequest(node, null, true, null, runSettings);
    return {
        request,
        prompt:(request.prompt || '').trim(),
        refs:request.refs || []
    };
}

function buildRunGenerationOutpaintSize(node){
    return node?.outpaintSize && Number(node.outpaintSize.width) > 0 && Number(node.outpaintSize.height) > 0
        ? {width:Math.round(Number(node.outpaintSize.width)), height:Math.round(Number(node.outpaintSize.height))}
        : null;
}

function snapshotRunSourceVisualState(node){
    const nodeHasImages = (node.images || []).some(img => img?.url);
    return {
        nodeHasImages,
        sourceVisualState: isSmartImageNode(node) && nodeHasImages ? {
            images:(node.images || []).map(img => ({...img})),
            title:node.title,
            w:node.w,
            h:node.h,
            scale:node.scale,
            outputKind:node.outputKind
        } : null
    };
}

function applyPendingRunNodeState(pendingNode, expectedCount, node, refs, pendingMeta){
    pendingNode.pending = Math.max(1, Number(expectedCount) || 1);
    pendingNode.runStartedAt = nowMs();
    delete pendingNode.runFinishedAt;
    delete pendingNode.runElapsedMs;
    pendingNode.runTimerHidden = false;
    const pendingBox = pendingBoxSize(pendingNode.pending, {sourceNode:node, refs});
    pendingNode.w = fixedSmartImageNodeSize(pendingNode, {width:pendingBox.w, height:pendingBox.h}).width;
    pendingNode.h = SMART_IMAGE_NODE_FIXED_HEIGHT;
    pendingNode.scale = 1;
    attachRunMeta(pendingNode, pendingMeta);
}

function applyRunVisualState(pendingNode, apiConcurrentRun){
    if(apiConcurrentRun){
        coolNodeRunningState(pendingNode, 2000);
        syncRunButtonState();
    } else {
        pendingNode.running = true;
        syncRunButtonState();
    }
}
async function handleSmartVideoRun(node, pendingNode, prompt, refs, runSettings, pendingMeta, sourceVisualState, runLog, runLogStart){
    if(!(isApiLikeEngine(runSettings.engine) && runSettings.apiKind === 'video')) return false;
    const outVideos = await runApiVideoGeneration(prompt, refs, runSettings);

    if(!outVideos.length) throw new Error(tr('smart.errNoOutVideos'));

    finalizePendingNode(pendingNode, outVideos, pendingMeta, 'video');
    markSmartNodeOutcomeVisual(pendingNode, 'success');

    if(sourceVisualState) restoreSourceVisualState(node, sourceVisualState);

    addSmartGenerationLog({run:runLog, outputs:outVideos, runMs:nowMs() - runLogStart});

    clearPromptInput({preserveDraft:true});

    scheduleSave();

    return true;
}
async function handleSmartApiLikeImageRun(node, pendingNode, outImages, runSettings, sourceVisualState, outpaintSize, runLog, runLogStart){
    const taskIds = Array.isArray(outImages?.taskIds) ? outImages.taskIds : [];

    if(!taskIds.length) throw new Error(tr('smart.errRunFailed'));

    pendingNode.pendingTasks = SmartCanvasGenerationRunPrimitives.pendingTaskRecords(taskIds, {
        kind:'image', providerId:outImages.providerId, model:outImages.model
    });

    pendingNode.pending = Math.max(taskIds.length, Number(pendingNode.pending || 0) || taskIds.length);

    pendingNode.runStartedAt = nowMs();

    pendingNode.runTimerHidden = false;

    pendingNode.running = false;

    render();

    scheduleSave();

    await saveCanvas();

    const pendingLogContext = {run:runLog, runLogStart};

    await resumeSmartPendingNode(pendingNode, pendingLogContext);

    if(smartRecoverableImageTask(pendingNode)){

        if(sourceVisualState) restoreSourceVisualState(node, sourceVisualState);

        clearPromptInput({preserveDraft:true});

        scheduleSave();

        return true;

    }

    if(smartPendingTasks(pendingNode).length){

        if(sourceVisualState) restoreSourceVisualState(node, sourceVisualState);

        clearPromptInput({preserveDraft:true});

        scheduleSave();

        return true;

    }

    if(!(pendingNode.images || []).length) throw new Error(tr('smart.errNoOutImages'));

    if(outpaintSize) delete node.outpaintSize;

    if(sourceVisualState) restoreSourceVisualState(node, sourceVisualState);

    addSmartPendingSuccessLog(pendingNode, pendingLogContext);

    clearPromptInput({preserveDraft:true});

    scheduleSave();

    return true;
}
function finalizeSmartDirectRun(node, pendingNode, outImages, pendingMeta, sourceVisualState, outpaintSize, runLog, runLogStart){
    if(!outImages.length) throw new Error(tr('smart.errNoOutImages'));

    if(outpaintSize) delete node.outpaintSize;

    finalizePendingNode(pendingNode, outImages, pendingMeta);
    markSmartNodeOutcomeVisual(pendingNode, 'success');

    if(sourceVisualState) restoreSourceVisualState(node, sourceVisualState);

    addSmartGenerationLog({run:runLog, outputs:outImages, runMs:nowMs() - runLogStart});

    clearPromptInput({preserveDraft:true});

    scheduleSave();

    return true;
}
function handleSmartRunFailure(node, branchNode, pendingNode, extracted, runLog, runLogStart, error){
    pendingNode.pending = 0;

    if(branchNode){

        removeFailedPendingOutputNode(branchNode);

        selectedId = node.id;

    } else {

        pendingNode.pending = 0;

        pendingNode.running = false;

        if(!(pendingNode.images || []).length){

            delete pendingNode.w;

            delete pendingNode.h;

        }

    }

    if(extracted) restoreFromExtraction(node, extracted);

    delete pendingNode._runMetaTargetId;

    markSmartNodeOutcomeVisual(branchNode ? node : pendingNode, 'error');

    if(!error?.smartGenerationLogged) addSmartGenerationLog({run:runLog, outputs:[], runMs:nowMs() - runLogStart, error:error.message || String(error)});

    toast((error.message || tr('smart.errRunFailed')).slice(0, 160));

    return false;
}
function finishSmartRunCleanup(runSubmissionLock, pendingNode, apiConcurrentRun){
    unlockSmartGenerationSubmission(runSubmissionLock);

    if(!apiConcurrentRun){

        clearNodeRunningState(pendingNode);

        syncRunButtonState();

    }

    render();
}
async function runGeneration(targetNode=null){ // SMART_CANVAS_BATCH_TOOLS_20260714: explicit node + isolated settings enable parallel multi-run.

    const explicitNode = targetNode?.id ? targetNode : null;

    const node = explicitNode || primarySelectedNode() || activeComposerNode();

    if(!node || !isSmartRunnableNode(node) || smartNodeInFlight(node)) return false;

    let runSettings = cloneSmartSettings(smartSettingsForNode(node));

    const {request, prompt, refs} = buildRunGenerationRequest(node, explicitNode, runSettings);
    if(!prompt && smartRunNeedsPrompt(runSettings)){

        toast(tr('smart.toastNeedPrompt'));

        return false;

    }

    const outpaintSize = buildRunGenerationOutpaintSize(node);
    const apiLikeRun = isApiLikeEngine(runSettings.engine);
    runSettings = SmartCanvasGenerationRunPrimitives.applyOutpaintSettings(runSettings, outpaintSize, apiLikeRun);

    const runPlan = SmartCanvasGenerationRunPrimitives.buildRunPlan(runSettings, {apiLike:apiLikeRun});

    const meta = snapshotRunMeta(prompt, node.id, request.displayPrompt, refs, runSettings, node);

    const logKind = runPlan.kind;

    const runLog = smartRunSnapshot(node, prompt, refs, logKind, runSettings);

    rememberRecentSmartSettings(runSettings, node);

    const runLogStart = nowMs();

    const runIdempotencyBase = `${canvasId}:${node.id}:${runLogStart}:${smartTaskRunKey('run')}`;

    const expectedCount = runPlan.expectedCount;

    const apiConcurrentRun = runPlan.concurrent;

    const {nodeHasImages, sourceVisualState} = snapshotRunSourceVisualState(node);
    ctx.smartCanvasStore().checkpoint({name:'run-generation'});

    let extracted = null;

    let branchNode = null;

    const shouldCreateBranchOutput = nodeHasImages;

    const pendingMeta = shouldCreateBranchOutput ? stripRunInputMeta(meta) : meta;

    ctx.setUndoSuppressed(true);

    if(shouldCreateBranchOutput) branchNode = createPendingOutputFromSource(node, expectedCount, pendingMeta, {connectSource:false, selectOutput:true, refs});

    ctx.setUndoSuppressed(false);

    const pendingNode = branchNode || node;
    runLog.targetNodeId = pendingNode.id;

    if(extracted) pendingNode._runMetaTargetId = extracted.id;

    if(!branchNode) applyPendingRunNodeState(pendingNode, expectedCount, node, refs, pendingMeta);
    applyRunVisualState(pendingNode, apiConcurrentRun);
    render();

    const runSubmissionLock = lockSmartGenerationSubmission(node);

    if(!runSubmissionLock){

        toast('该节点正在提交或生成中');

        return false;

    }

    try {

        if(await handleSmartVideoRun(node, pendingNode, prompt, refs, runSettings, pendingMeta, sourceVisualState, runLog, runLogStart)) return true;

        const outImages = runSettings.engine === 'modelscope'
            ? await runModelscopeGeneration(prompt, refs, runSettings)
            : await runApiGeneration(prompt, refs, runSettings, {idempotencyBase:runIdempotencyBase});

        if(isApiLikeEngine(runSettings.engine)){

            await handleSmartApiLikeImageRun(node, pendingNode, outImages, runSettings, sourceVisualState, outpaintSize, runLog, runLogStart);

            return true;

        }

        return finalizeSmartDirectRun(node, pendingNode, outImages, pendingMeta, sourceVisualState, outpaintSize, runLog, runLogStart);

    } catch(e) {

        return handleSmartRunFailure(node, branchNode, pendingNode, extracted, runLog, runLogStart, e);

    } finally {

        finishSmartRunCleanup(runSubmissionLock, pendingNode, apiConcurrentRun);

    }

}

async function runApiGeneration(prompt, refs, runSettings=ctx.settings(), taskOptions={}){

    if(!runSettings.provider_id || !runSettings.model) throw new Error(tr('smart.errNoApiModel'));

    const count = Math.max(1, Math.min(8, Math.round(Number(runSettings.count) || 1)));

    const payload = SmartCanvasGenerationRunPrimitives.imageTaskPayload({
        prompt,
        settings:runSettings,
        size:sizeForRun(runSettings),
        referenceImages:imageRefsOnly(refs),
        maxReferences:SMART_REFERENCE_IMAGE_MAX
    });

    const base = taskOptions.idempotencyBase || smartTaskRunKey('image');

    const tasks = await Promise.all(Array.from({length:count}, (_, index) => {

        const idempotencyKey = smartTaskIdempotencyKey(base, index);

        const create = () => {

            const headers = {'Content-Type':'application/json', 'X-Idempotency-Key':idempotencyKey};

            return smartCanvasTaskClient.createImageTask(payload, idempotencyKey, tr('smart.errRunFailed'));

        };

        return smartCanvasTaskController.createOnce(`image:${idempotencyKey}`, create);

    }));

    return {taskIds:tasks.map(task => task.task_id).filter(Boolean), count, providerId:payload.provider_id, model:payload.model};

}

async function runApiVideoGeneration(prompt, refs, runSettings=ctx.settings()){

    if(!runSettings.videoModel) throw new Error(tr('smart.errNoVideoModel'));

    try {

        const uploadedRefs = applyUploadedUrlsToSmartRefs(refs, runSettings);

        const trustedMode = Boolean(runSettings.videoTrustedAsset);

        const trustedSource = trustedMode ? (['library','cloud','manual'].includes(runSettings.videoTrustedSource) ? runSettings.videoTrustedSource : 'library') : 'none';

        // 仅「素材库链接」来源才走 asset:// 认证地址 + 后端可信素材路由；上传云端/手动网址走普通直链。

        const useAssetUris = trustedSource === 'library';

        const targetPlatform = videoProviderPlatform(runSettings.videoProvider || 'comfly');

        let mismatchedAsset = false;

        const effUrl = ref => {

            const uris = (ref && ref.asset_uris && typeof ref.asset_uris === 'object') ? ref.asset_uris : null;

            if(useAssetUris && uris && Object.keys(uris).length){

                // asset:// 与平台绑定：取当前视频平台对应的认证地址；该素材没注册到这个平台就回退本地 url

                if(targetPlatform && uris[targetPlatform]) return uris[targetPlatform];

                mismatchedAsset = true;

            }

            return ref?.url;

        };

        const refImages = imageRefsOnly(uploadedRefs).map((ref, i) => {

            const item = {url:effUrl(ref), name:ref.name || `图${i + 1}`};

            if(runSettings.videoUseFrameRoles){

                if(i === 0) item.role = 'first_frame';

                else if(i === 1) item.role = 'last_frame';

            }

            return item;

        });

        const manualVideo = manualSmartVideoLink(runSettings)?.url || '';

        const refVideos = manualVideo ? manualSmartMediaLinks(runSettings).map(item => item.url).filter(Boolean) : videoRefsOnly(uploadedRefs).map(ref => effUrl(ref)).filter(Boolean);

        const refAudios = audioRefsOnly(uploadedRefs).map(ref => effUrl(ref)).filter(Boolean).slice(0, 3);

        if(mismatchedAsset) toast('部分认证素材属于其它平台，已回退为普通素材。切换到对应平台的视频接口才能用 asset:// 认证地址。');

        const payload = SmartCanvasGenerationRunPrimitives.videoTaskPayload({
            prompt,
            settings:runSettings,
            images:refImages,
            videos:refVideos,
            audios:refAudios,
            trustedAsset:useAssetUris
        });

        const result = await smartCanvasTaskClient.createVideo(payload, tr('smart.errRunFailed'));
return resultMediaUrls(result);

    } finally {

        ctx.setTransientSmartCloudLinks([]);

    }

}

async function runModelscopeGeneration(prompt, refs, runSettings=ctx.settings()){

    refs = imageRefsOnly(refs);

    const modelKey = runSettings.msgenModel || 'zimage';

    const msModel = MS_GEN_MODELS[modelKey] || MS_GEN_MODELS.zimage;

    if(msModel.supportsImage && !refs.length) throw new Error(tr('smart.errMsNeedRefs'));

    const size = apiImageSize(runSettings.msRatio || 'square', runSettings.msResolution || '1k', runSettings.msCustomRatio || '', runSettings.msCustomSize || '');

    const parsed = parseSizeValue(size);

    const width = Number(parsed?.width) || 1024;

    const height = Number(parsed?.height) || 1024;

    const imageUrls = [];

    if(msModel.supportsImage || msModel.acceptsImage){

        for(const ref of refs.slice(0, SMART_REFERENCE_IMAGE_MAX)){

            if(ref.url) imageUrls.push(await urlToBase64(ref.url).catch(() => ref.url));

        }

    }

    const count = 1;

    const submit = async () => {

        const body = SmartCanvasGenerationRunPrimitives.modelscopeTaskBody({
            modelKey,
            model:msModel,
            settings:runSettings,
            prompt,
            imageUrls,
            width,
            height,
            fallbackModel:modelscopeImageModels()[0]
        });

        const data = await smartCanvasGenerationClient.postJson(msModel.endpoint, body);

        return data.url || data.images?.[0] || '';

    };

    const results = await Promise.all(Array.from({length:count}, submit));

    return results.filter(Boolean);

}

async function urlToBase64(url){

    const res = await fetch(url);

    if(!res.ok) throw new Error(tr('smart.errImageRead'));

    const blob = await res.blob();

    return new Promise((resolve, reject) => {

        const reader = new FileReader();

        reader.onload = () => resolve(reader.result);

        reader.onerror = reject;

        reader.readAsDataURL(blob);

    });

}

function smartPendingTasks(node){
    return SmartCanvasRunDataPrimitives.smartPendingTasks(node);
}

const ImageTaskRecoverSignal = SmartCanvasRunDataPrimitives.ImageTaskRecoverSignal;

function extractUpstreamTaskId(text){
    return SmartCanvasRunDataPrimitives.extractUpstreamTaskId(text);
}

function providerIdForSmartTask(node, task){
    return SmartCanvasRunDataPrimitives.providerIdForSmartTask(node, task, ctx.settings().provider_id);
}

async function fetchImageTaskQuery(providerId, taskId){

    return smartCanvasTaskClient.queryImageTask(providerId, taskId);

}

async function querySmartImageTaskNow(nodeId, localTaskId){

    const node = ctx.nodes().find(n => n.id === nodeId);

    if(!node) return;

    const task = smartPendingTasks(node).find(item => item.taskId === localTaskId) || smartRecoverableImageTask(node);

    if(!task || task.querying) return;

    const recoverTaskId = task.recoverTaskId || extractUpstreamTaskId(task.error || '');

    if(!recoverTaskId){

        toast('没有任务 ID，无法查询');

        return;

    }

    task.querying = true;

    task.recoverTaskId = recoverTaskId;

    render();

    try {

        const data = await fetchImageTaskQuery(providerIdForSmartTask(node, task), recoverTaskId);

        if(data.status === 'succeeded'){

            task.failed = false;

            task.querying = false;

            finalizeSmartPendingTask(node, task.taskId, resultMediaUrls(data.image_items?.length ? data.image_items : (data.images?.length ? data.images : data)), task.kind || 'image');

            if(!smartPendingTasks(node).length && !task.recoverySuccessLogged){
                task.recoverySuccessLogged = true;
                const logContext = buildSmartResumeLogContext(node);
                addSmartPendingSuccessLog(node, logContext);
            }

            render();

            scheduleSave();

            return;

        }

        if(data.status === 'failed'){

            task.error = data.error || tr('smart.errRunFailed');
            markSmartNodeOutcomeVisual(node, 'error');

            if(!task.recoveryFailedLogged){
                task.recoveryFailedLogged = true;
                const logContext = buildSmartResumeLogContext(node);
                addSmartPendingFailureLog(data.error || task.error, logContext);
            }

            toast(task.error.slice(0, 160));

        } else {

            task.error = data.message || '任务仍在生成中，请稍后再查询';

            toast(task.error);

        }

    } catch(e){

        task.error = e.message || '查询失败';

        toast(task.error.slice(0, 160));

    } finally {

        const latest = smartPendingTasks(node).find(item => item.taskId === localTaskId);

        if(latest) latest.querying = false;

        render();

        scheduleSave();

    }

}

async function pollSmartCanvasTask(taskId){

    if(!taskId) throw new Error(tr('smart.errRunFailed'));

    return smartCanvasTaskController.poll(taskId, {

        scope:'image',

        pollInterval:2000,

        maxAttempts:900,

        fetchTask: async (id, {signal}={}) => smartCanvasTaskClient.getImageTask(id, signal, tr('smart.errRunFailed')),

        classify: task => {

            const status = normalizeSmartCanvasTaskStatus(task?.status);

            if(status === 'succeeded') return {done:true, value:task.result || {}};
if(status === 'failed'){

                const recoverTaskId = task.upstream_task_id || extractUpstreamTaskId(task.error || '');

                if(recoverTaskId) throw new ImageTaskRecoverSignal({

                    taskId, recoverTaskId, providerId:task.provider_id, kind:'image', message:task.error || tr('smart.errRunFailed')

                });

                const error = new Error(task.error || tr('smart.errRunFailed'));

                error.smartTaskTerminal = true;

                error.smartTaskStatus = status;

                throw error;

            }

            if(['cancelled', 'stale', 'interrupted'].includes(status)){

                const error = new Error(task.error || '任务状态已失效，请确认上游结果后重新发起');

                error.smartTaskTerminal = true;

                error.smartTaskStatus = status;

                throw error;

            }

            return {done:false};

        }

    });

}

function settleSmartPendingNode(node, kind='image'){

    if(!node || node.pending || smartPendingTasks(node).length) return false;

    delete node.pendingTasks;

    node.running = false;

    if(!(node.images || []).length){

        delete node.w;

        delete node.h;

        if(!node.pendingOutputPlaceholder) clearFailedPendingOutputPlaceholder(node);

        markSmartNodeOutcomeVisual(node, 'error');

        return false;

    }

    node.runFinishedAt = nowMs();

    if(!node.runStartedAt) node.runStartedAt = node.runFinishedAt;

    node.runElapsedMs = Math.max(0, node.runFinishedAt - Number(node.runStartedAt || node.runFinishedAt));

    node.runTimerHidden = false;

    markSmartNodeOutcomeVisual(node, 'success');

    node.title = SmartCanvasGenerationRunPrimitives.outputTitle(node.images.length, kind);

    applyFixedSmartImageNodeSize(node, nodeRect(node));

    delete node._selectAfterRunId;

    delete node.pendingOutputPlaceholder;

    return true;

}

function finalizeSmartPendingTask(node, taskId, images, kind='image'){

    if(!node || !taskId) return;

    node.pendingTasks = smartPendingTasks(node).filter(task => task.taskId !== taskId);

    node.pending = Math.max(0, Number(node.pending || 0) - 1);

    const ext = SmartCanvasGenerationRunPrimitives.outputExtension(kind);

    const mediaItems = resultMediaUrls(images);

    const existing = cleanHistoryImages(node.images || []);

    const seen = new Set(existing.map(img => `${img.kind || ''}|${img.url || ''}`));

    const additions = cleanHistoryImages((mediaItems || []).map((item, i) => {

        const url = typeof item === 'string' ? item : item?.url || '';

        const itemKind = (typeof item === 'object' && item.kind) || kind;

        return stripImageGenerationMeta(copyMediaSizeFields(item, {url, name:(typeof item === 'object' && item.name) || `output-${i + 1}.${ext}`, kind:itemKind, generatedResult:true}));

    }).filter(item => item.url)).filter(item => {

        const key = `${item.kind || ''}|${item.url || ''}`;

        if(seen.has(key)) return false;

        seen.add(key);

        return true;

    });

    node.images = [...existing, ...additions];

    if(additions.length) node.outputKind = kind;

    settleSmartPendingNode(node, kind);

}

const smartPendingNodeRetryTimers = new Map();
const SMART_PENDING_TASK_RETRY_MS = 5000;

function addSmartPendingSuccessLog(node, logContext={}){

    if(!logContext?.run || logContext.successLogged || !(node?.images || []).length) return false;

    logContext.successLogged = true;

    addSmartGenerationLog({

        run:logContext.run,

        outputs:node.images || [],

        runMs:Math.max(0, nowMs() - Number(logContext.runLogStart || nowMs()))

    });

    return true;

}

function addSmartPendingFailureLog(error, logContext={}){

    if(!logContext?.run || logContext.failureLogged) return false;

    logContext.failureLogged = true;

    addSmartGenerationLog({

        run:logContext.run,

        outputs:[],

        runMs:Math.max(0, nowMs() - Number(logContext.runLogStart || nowMs())),

        error:error?.message || String(error || tr('smart.errRunFailed'))

    });

    return true;

}

function scheduleSmartPendingNodeRetry(node, logContext={}){

    const nodeId = String(node?.id || '');

    if(!nodeId || smartPendingNodeRetryTimers.has(nodeId)) return;

    const timer = setTimeout(async () => {

        smartPendingNodeRetryTimers.delete(nodeId);

        const current = ctx.nodes().find(item => item?.id === nodeId);

        if(!current || !smartPendingTasks(current).length || smartRecoverableImageTask(current)) return;

        try {

            await resumeSmartPendingNode(current, logContext);

            if(!smartPendingTasks(current).length) addSmartPendingSuccessLog(current, logContext);

        } catch(error) {

            addSmartPendingFailureLog(error, logContext);

        }

    }, SMART_PENDING_TASK_RETRY_MS);

    smartPendingNodeRetryTimers.set(nodeId, timer);

}

async function pollAndFinalizeSmartTask(node, task){
    const result = await pollSmartCanvasTask(task.taskId);

    finalizeSmartPendingTask(node, task.taskId, resultMediaUrls(result?.image_items?.length ? result.image_items : (result?.images?.length ? result.images : result)), task.kind || 'image');

    scheduleSmartCanvasNodesRender({refreshConnections:false, refreshMinimap:false});

    scheduleSave();
}

function handleSmartTaskRecoverable(node, task, error, logContext={}){
    task.failed = true;

    task.querying = false;

    task.recoverTaskId = error.recoverTaskId;

    task.providerId = error.providerId || task.providerId || providerIdForSmartTask(node, task);

    task.error = error.message || tr('smart.errRunFailed');

    markSmartNodeOutcomeVisual(node, 'error');

    node.running = false;

    node.pending = Math.max(1, smartPendingTasks(node).length);

    addSmartPendingFailureLog(error, logContext);
    toast('任务未丢失，可稍后手动查询结果');

    scheduleSmartCanvasStatusRender([node.id]);

    scheduleSave();

}

function handleSmartTaskRetry(node, task, error, logContext){
    task.querying = false;

    task.error = error?.message || tr('smart.errRunFailed');

    task.retrying = true;

    node.running = false;

    node.pending = Math.max(1, smartPendingTasks(node).length);

    toast('任务查询暂时异常，正在自动继续查询');

    scheduleSmartCanvasStatusRender([node.id]);

    scheduleSave();

    scheduleSmartPendingNodeRetry(node, logContext);

}

function handleSmartTaskTerminal(node, task, error, failures){
    node.pendingTasks = smartPendingTasks(node).filter(item => item.taskId !== task.taskId);

    node.pending = Math.max(0, Number(node.pending || 0) - 1);

    task.error = error.message || tr('smart.errRunFailed');

    const settledWithOutput = settleSmartPendingNode(node, task.kind || 'image');

    if(!settledWithOutput) markSmartNodeOutcomeVisual(node, 'error');

    failures.push(error);

    toast(task.error.slice(0, 160));

    scheduleSmartCanvasStatusRender([node.id]);

    scheduleSave();
}
async function resumeSmartPendingNode(node, logContext={}){

    const tasks = smartPendingTasks(node);

    if(!node || !tasks.length){
        if(isOrphanedFailedPendingOutput(node)) removeFailedPendingOutputNode(node);
        return {pending:false, completed:Boolean((node?.images || []).length)};
    }

    node.pending = Math.max(tasks.length, Number(node.pending || 0) || tasks.length);

    node.running = false;

    scheduleSmartCanvasStatusRender([node.id]);

    const failures = [];

    await Promise.all(tasks.map(async task => {

        if(task.failed && task.recoverTaskId) return;

        try {

            await pollAndFinalizeSmartTask(node, task);

        } catch(error) {

            if(error?.imageTaskRecover && error.recoverTaskId){

                handleSmartTaskRecoverable(node, task, error, logContext);

                return;

            }

            if(!error?.smartTaskTerminal){

                handleSmartTaskRetry(node, task, error, logContext);

                return;

            }

            handleSmartTaskTerminal(node, task, error, failures);

        }

    }));

    if(failures.length && !(node.images || []).length){

        const removed = removeFailedPendingOutputNode(node);

        if(removed){

            scheduleSmartCanvasNodesRender({refreshConnections:false, refreshMinimap:false});

            scheduleSave();

        }

        throw failures[0];

    }

    return {

        pending:Boolean(smartPendingTasks(node).length),

        completed:Boolean((node.images || []).length) && !smartPendingTasks(node).length

    };

}

function buildSmartResumeLogContext(node){
    // 节点经 attachRunMeta 已持久化以下字段，存储清洗不删除它们；
    // 返回列表/页面卸载后重进画布时，据此重建日志写入所需的 run 快照与起始时间。
    const prompt = node?.runPrompt || node?.runModelPrompt || '';
    const refs = (Array.isArray(node?.runInputRefs) && node.runInputRefs.length)
        ? node.runInputRefs
        : (Array.isArray(node?.runPromptRefs) ? node.runPromptRefs : []);
    const kind = node?.outputKind || (node?.runSettings?.apiKind === 'video' ? 'video' : 'image');
    const settingsSnapshot = cloneSmartSettings(node?.runSettings || ctx.settings());
    const run = smartRunSnapshot(node, prompt, refs, kind, settingsSnapshot);
    run.targetNodeId = node?.id || '';
    if(node?.sourceNodeId) run.sourceNodeId = node.sourceNodeId;
    const runLogStart = Number(node?.runAt || node?.runStartedAt || 0);
    return {run, runLogStart};
}

function resumeSmartPendingTaskWithLog(node){
    if(!node || !smartPendingTasks(node).length) return;
    const logContext = buildSmartResumeLogContext(node);
    resumeSmartPendingNode(node, logContext)
        .then(result => {
            if(result && !result.pending && result.completed) addSmartPendingSuccessLog(node, logContext);
        })
        .catch(error => addSmartPendingFailureLog(error, logContext));
}

function resumeSmartPendingTasks(){

    ctx.nodes().filter(node => smartPendingTasks(node).length).forEach(node => {

        resumeSmartPendingTaskWithLog(node);

    });

}

    return {
        collectPromptParts,
        originalPromptTextFromParts,
        buildPromptRequest,
        repairOrphanedFailedPendingOutputs,
        downstreamImageTargetsFor,
        historyGroupForNode,
        runGeneration,
        smartPendingTasks,
        querySmartImageTaskNow,
        resumeSmartPendingTasks
    };

}
