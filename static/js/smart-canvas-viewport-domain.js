/*
 * smart-canvas-viewport-domain.js — 视口/渲染域（Phase 2 P2.8，自 smart-canvas.js 迁入）。
 *
 * ES module 工厂 `createViewportDomain(ctx)`；可变共享状态经 ctx 访问器读写，
 * window 别名与 window 挂载名裸引用直达。DOM 结构与类名零漂移，函数体逐行保留
 * （仅可变绑定读写经 AST 引导精确改写为访问器调用）。
 * 域内包含：视口缩放/平移基元与控件同步、canvasLayer 脏刷新调度、shellRect 缓存、
 * 小地图渲染与交互、fit/focus/zoom-preview 视口系列、虚拟化挂载判定（逐行保留）与
 * 渲染主流程 renderCanvasNodes/render/renderFull。
 */
export function createViewportDomain(ctx) {

    const {
        SMART_LOG_PREVIEW_NODE_ID,
        ZOOM_PREVIEW_NODE_DEFAULT_SCALE,
        ZOOM_PREVIEW_NODE_MAX_SCALE,
        assetPanel,
        bindNodeEvents,
        bindSmartPreviewImageFallbacks,
        captureMediaPlaybackStates,
        composer,
        escapeHtml,
        imageLayout,
        isMultiMediaHoverEnabled,
        isNodeSelected,
        measureSmartNodeImages,
        minimapContent,
        nodeBodyHtml,
        nodeMetaHtml,
        nodeRect,
        nodeScale,
        normalizeSmartCanvasButtonHints,
        primarySelectedNode,
        refreshConnectionLayer,
        refreshIcons,
        refreshRunTimerPills,
        refreshSelectedConnectionScope,
        rememberInlineVideoActivations,
        renderConnections,
        renderSmartChatPanel,
        restoreMediaPlaybackStates,
        runTimePillHtml,
        safeScale,
        scheduleSave,
        selectedNodeIds,
        shell,
        smartCanvasConnectionRenderer,
        smartCanvasEmptyState,
        smartCanvasNodeRenderPipeline,
        smartCanvasNodeRenderer,
        smartCanvasState,
        smartChatPanel,
        smartLogModal,
        smartNodeHasFailedTask,
        smartNodeInFlight,
        smartPreviewImgHtml,
        smartShortcutModal,
        smartVideoPreviewHtml,
        smartZoomLabel,
        syncComposerPromptEditingIndicator,
        syncRunButtonState,
        syncSelectionContextVisuals,
        syncSelectionDockUi,
        syncSmartCanvasContext,
        syncSmartNodeOutcomeVisuals,
        syncSmartSelectedImageResolution,
        toast,
        tr,
        transplantSmartMediaElements,
        updateComposer,
        upstreamNodesForKinds,
        viewport,
        world
    } = ctx;

function viewportZoomLevel(scale=viewport.scale){
    return scale < 0.35 ? 'far' : 'close';

}

function syncViewportControls(){

    const level = viewportZoomLevel();

    if(world.dataset.zoomLevel !== level) world.dataset.zoomLevel = level;

    shell.dataset.zoomLevel = level;

    if(smartZoomLabel) smartZoomLabel.textContent = `${Math.round(viewport.scale * 100)}%`;

}

function setViewportScaleAtScreenPoint(nextScale, sx=shell.clientWidth / 2, sy=shell.clientHeight / 2){

    const next = window.SmartCanvasViewportPrimitives?.zoomAtScreenPoint

        ? SmartCanvasViewportPrimitives.zoomAtScreenPoint(viewport, nextScale, {x:sx, y:sy}, {minScale:0.06, maxScale:4})

        : (() => {

            const before = {x:(sx - viewport.x) / viewport.scale, y:(sy - viewport.y) / viewport.scale};

            const scale = safeScale(nextScale);

            return {x:sx - before.x * scale, y:sy - before.y * scale, scale};

        })();

    Object.assign(viewport, next);

    applyViewport();

    scheduleSave();

}

function applyViewport(){

    world.style.transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`;
    world.style.setProperty('--canvas-scale', String(Math.max(0.06, Number(viewport.scale) || 1)));

    // world 被 transform:scale 缩放后，其内部带 backdrop-filter 的卡片（参数设置/合成卡等）

    // 会被部分浏览器（Chrome/Edge 等 Blink 内核）当作独立合成层先按 1x 栅格化、再整体缩放，

    // 缩小时位图被降采样 → 组件发虚。缩放态下关闭这些 backdrop-filter（底色本身已接近不透明，

    // 观感几乎无差），让卡片随矢量重新栅格化，保持清晰。

    world.classList.toggle('canvas-scaled', Math.abs(viewport.scale - 1) > 0.001);

    syncViewportControls();

    // The workspace grid is deliberately screen-fixed, matching the launcher.
    // It must not inherit canvas zoom or pan state.
    delete shell.dataset.gridDensity;
    shell.style.removeProperty('background-size');
    shell.style.removeProperty('background-position');

    scheduleMinimapRender();

    const multiMediaMode = isMultiMediaHoverEnabled() ? 'expanded' : 'summary';
    const multiMediaModeChanged = world.dataset.multiMediaMode !== multiMediaMode;
    world.dataset.multiMediaMode = multiMediaMode;
    if(multiMediaModeChanged) scheduleSmartCanvasNodesRender({refreshConnections:false, refreshMinimap:false, refreshComposer:false});
    else scheduleSmartCanvasRenderForViewport();

}

// SMART_CANVAS_PERFORMANCE_20260713: all canvas side layers share one frame boundary.

// The world transform remains immediate; connection SVG and minimap DOM work is coalesced.

let canvasLayerRaf = 0;
let canvasLayerNeedsConnections = false;
let canvasLayerNeedsMinimap = false;
let canvasLayerConnectionNodeIds = new Set();
let canvasLayerNeedsFullConnectionRefresh = false;

function flushCanvasLayerRefresh(){
    const perfToken = window.smartCanvasPerformance?.start('canvas-layer-refresh');
    canvasLayerRaf = 0;
    const needsConnections = canvasLayerNeedsConnections;
    const needsMinimap = canvasLayerNeedsMinimap;
    const connectionNodeIds = canvasLayerNeedsFullConnectionRefresh ? null : new Set(canvasLayerConnectionNodeIds);
    canvasLayerNeedsConnections = false;
    canvasLayerNeedsMinimap = false;
    canvasLayerConnectionNodeIds.clear();
    canvasLayerNeedsFullConnectionRefresh = false;
    if(needsConnections) refreshConnectionLayer({nodeIds:connectionNodeIds});
    if(needsMinimap){
        if(!updateMinimapViewportRect()) renderMinimap();
    }
    window.smartCanvasPerformance?.end(perfToken, {connections:needsConnections, minimap:needsMinimap});
}

function scheduleCanvasLayerRefresh({connections=false, minimap=false, connectionNodeIds=null}={}){
    if(connections){
        canvasLayerNeedsConnections = true;
        const ids = connectionNodeIds instanceof Set ? connectionNodeIds : Array.isArray(connectionNodeIds) ? connectionNodeIds : [];
        if(ids.length || ids.size){
            ids.forEach(id => { if(id) canvasLayerConnectionNodeIds.add(String(id)); });
        } else {
            canvasLayerNeedsFullConnectionRefresh = true;
        }
    }
    canvasLayerNeedsMinimap = canvasLayerNeedsMinimap || Boolean(minimap);
    if(canvasLayerRaf) return;
    canvasLayerRaf = requestAnimationFrame(flushCanvasLayerRefresh);
}

function scheduleMinimapRender(){

    scheduleCanvasLayerRefresh({minimap:true});

}

const smartCanvasRenderer = new SmartCanvasRenderScheduler(() => render());

function smartCanvasViewportRenderKey(){
    if(window.SmartCanvasViewportPrimitives?.viewportKey){
        return SmartCanvasViewportPrimitives.viewportKey(viewport, {
            overviewScale:SMART_CANVAS_OVERVIEW_SCALE,
            compactScale:SMART_CANVAS_COMPACT_SCALE,
            overviewCell:SMART_CANVAS_VIRTUAL_OVERSCAN,
            fullCell:SMART_CANVAS_VIRTUAL_OVERSCAN
        });
    }
    const cell = SMART_CANVAS_VIRTUAL_OVERSCAN;
    return ['full', Math.floor((-viewport.x / viewport.scale) / cell), Math.floor((-viewport.y / viewport.scale) / cell)].join(':');
}

// Keep pan/zoom feedback on the compositor.  Mounting/unmounting virtualized cards
// is deferred until the gesture settles, so crossing an overscan cell cannot stall a wheel or drag frame.
let smartCanvasViewportRenderTimer = 0;
let smartCanvasViewportRenderPendingKey = '';
function scheduleSmartCanvasRenderForViewport(){
    const key = smartCanvasViewportRenderKey();
    if(key === smartCanvasRenderer.lastViewportKey) return;
    smartCanvasViewportRenderPendingKey = key;
    if(smartCanvasViewportRenderTimer) clearTimeout(smartCanvasViewportRenderTimer);
    smartCanvasViewportRenderTimer = setTimeout(() => {
        smartCanvasViewportRenderTimer = 0;
        smartCanvasRenderer.scheduleForViewport(smartCanvasViewportRenderPendingKey);
    }, 100);
}

function scheduleSmartCanvasRender(){
    if(smartCanvasViewportRenderTimer){
        clearTimeout(smartCanvasViewportRenderTimer);
        smartCanvasViewportRenderTimer = 0;
    }
    smartCanvasRenderer.schedule();
}

let smartCanvasNodesRenderFrame = 0;
let smartCanvasNodesRenderOptions = null;
function scheduleSmartCanvasNodesRender(options={}){
    const next = {
        refreshConnections:options.refreshConnections !== false,
        refreshMinimap:options.refreshMinimap !== false,
        refreshComposer:options.refreshComposer !== false,
        refreshChat:Boolean(options.refreshChat),
    };
    smartCanvasNodesRenderOptions = smartCanvasNodesRenderOptions
        ? {
            refreshConnections:smartCanvasNodesRenderOptions.refreshConnections || next.refreshConnections,
            refreshMinimap:smartCanvasNodesRenderOptions.refreshMinimap || next.refreshMinimap,
            refreshComposer:smartCanvasNodesRenderOptions.refreshComposer || next.refreshComposer,
            refreshChat:smartCanvasNodesRenderOptions.refreshChat || next.refreshChat,
        }
        : next;
    if(smartCanvasNodesRenderFrame) return;
    smartCanvasNodesRenderFrame = requestAnimationFrame(() => {
        smartCanvasNodesRenderFrame = 0;
        const renderOptions = smartCanvasNodesRenderOptions || next;
        smartCanvasNodesRenderOptions = null;
        render({scope:'nodes', ...renderOptions});
    });
}

let smartCanvasStatusRenderFrame = 0;
let smartCanvasStatusNodeIds = new Set();
function scheduleSmartCanvasStatusRender(nodeIds=[]){
    (Array.isArray(nodeIds) ? nodeIds : [nodeIds]).forEach(id => {
        const value = String(id || '').trim();
        if(value) smartCanvasStatusNodeIds.add(value);
    });
    if(smartCanvasStatusRenderFrame) return;
    smartCanvasStatusRenderFrame = requestAnimationFrame(() => {
        smartCanvasStatusRenderFrame = 0;
        const ids = Array.from(smartCanvasStatusNodeIds);
        smartCanvasStatusNodeIds.clear();
        render({scope:'status', nodeIds:ids});
    });
}

let smartNodeImageMeasureHandle = 0;
function scheduleSmartNodeImageMeasure(){
    if(smartNodeImageMeasureHandle) return;
    const run = () => {
        smartNodeImageMeasureHandle = 0;
        measureSmartNodeImages();
    };
    if(typeof window.requestIdleCallback === 'function') smartNodeImageMeasureHandle = window.requestIdleCallback(run, {timeout:600});
    else smartNodeImageMeasureHandle = window.setTimeout(run, 120);
}

let shellRectCache = null;

function invalidateShellRectCache(){ shellRectCache = null; }

function currentShellRect(){

    if(!shellRectCache) shellRectCache = shell.getBoundingClientRect();

    return shellRectCache;

}

const shellRectResizeObserver = typeof ResizeObserver === 'function'

    ? new ResizeObserver(invalidateShellRectCache)

    : null;

shellRectResizeObserver?.observe(shell);

function screenToWorld(event){

    const rect = currentShellRect();

    if(window.SmartCanvasViewportPrimitives?.screenToWorld){

        return SmartCanvasViewportPrimitives.screenToWorld(

            {x:event?.clientX, y:event?.clientY}, viewport, rect

        );

    }

    return {

        x:(event.clientX - rect.left - viewport.x) / viewport.scale,

        y:(event.clientY - rect.top - viewport.y) / viewport.scale

    };

}

function viewportCenter(){

    if(window.SmartCanvasViewportPrimitives?.viewportCenter){

        return SmartCanvasViewportPrimitives.viewportCenter(viewport, {width:shell.clientWidth, height:shell.clientHeight});

    }

    return {

        x:(shell.clientWidth / 2 - viewport.x) / viewport.scale,

        y:(shell.clientHeight / 2 - viewport.y) / viewport.scale

    };

}

function renderMinimap(){

    if(!minimapContent || !ctx.minimapViewport()) return;

    const width = minimapContent.clientWidth || 170;

    const height = minimapContent.clientHeight || 108;

    const viewW = shell.clientWidth / viewport.scale;

    const viewH = shell.clientHeight / viewport.scale;

    const viewX = -viewport.x / viewport.scale;

    const viewY = -viewport.y / viewport.scale;

    const minimapNodes = ctx.nodes()

        .filter(node => node.id !== SMART_LOG_PREVIEW_NODE_ID)

        .map(node => ({node, rect:nodeRect(node)}));

    const rects = minimapNodes.map(item => item.rect);

    rects.push({x:viewX, y:viewY, width:viewW, height:viewH});

    let minX = -200, minY = -200, maxX = viewX + viewW + 200, maxY = viewY + viewH + 200;
    for(let i = 0; i < rects.length; i++){
        const r = rects[i];
        if(r.x < minX) minX = r.x;
        if(r.y < minY) minY = r.y;
        const rx = r.x + r.width;
        const ry = r.y + r.height;
        if(rx > maxX) maxX = rx;
        if(ry > maxY) maxY = ry;
    }

    const scale = Math.min(width / Math.max(1, maxX - minX), height / Math.max(1, maxY - minY));

    const offsetX = (width - (maxX - minX) * scale) / 2;

    const offsetY = (height - (maxY - minY) * scale) / 2;

    smartCanvasState.interaction.minimap = {minX, minY, maxX, maxY, scale, offsetX, offsetY, width, height, view:{x:viewX, y:viewY, width:viewW, height:viewH}};

    const project = r => ({

        left:offsetX + (r.x - minX) * scale,

        top:offsetY + (r.y - minY) * scale,

        width:Math.max(4, r.width * scale),

        height:Math.max(4, r.height * scale)

    });

    const primaryId = primarySelectedNode()?.id || '';
    const showTrail = !shell.classList.contains('navigator-collapsed');
    const recentCutoff = Date.now() - 1000 * 60 * 12;

    const nodeHtml = minimapNodes.map(({node, rect}) => {

        const p = project(rect);

        const failed = smartNodeHasFailedTask(node);
        const recent = showTrail && Number(node?.runFinishedAt || node?.runStartedAt || 0) >= recentCutoff;

        const classes = [

            'minimap-node',

            isNodeSelected(node.id) ? 'is-selected' : '',

            primaryId === node.id ? 'is-primary' : '',

            smartNodeInFlight(node) ? 'is-running' : '',

            failed ? 'is-failed' : '',

            recent ? 'is-recent' : ''

        ].filter(Boolean).join(' ');

        return `<div class="${classes}" style="left:${p.left}px;top:${p.top}px;width:${p.width}px;height:${p.height}px"></div>`;

    }).join('');

    const view = project({x:viewX, y:viewY, width:viewW, height:viewH});

    minimapContent.innerHTML = `${nodeHtml}<div id="minimapViewport" class="smart-minimap-viewport" style="left:${view.left}px;top:${view.top}px;width:${view.width}px;height:${view.height}px"></div>`;

    ctx.setMinimapViewport(document.getElementById('minimapViewport'));

}

function updateMinimapViewportRect(){

    const state = smartCanvasState.interaction.minimap;

    if(!state || !ctx.minimapViewport()?.isConnected) return false;

    const viewW = shell.clientWidth / viewport.scale;

    const viewH = shell.clientHeight / viewport.scale;

    const viewX = -viewport.x / viewport.scale;

    const viewY = -viewport.y / viewport.scale;

    if(viewX < state.minX || viewY < state.minY || viewX + viewW > state.maxX || viewY + viewH > state.maxY) return false;

    // 适配边界包含视口矩形，只会随视口变大而膨胀；视口明显缩回时也必须重算，
    // 否则缩小再放大后小地图会一直停在塌缩比例上。

    const fitView = state.view;

    if(fitView && viewW < fitView.width * 0.5 && viewH < fitView.height * 0.5) return false;

    const left = state.offsetX + (viewX - state.minX) * state.scale;

    const top = state.offsetY + (viewY - state.minY) * state.scale;

    ctx.minimapViewport().style.left = `${left}px`;

    ctx.minimapViewport().style.top = `${top}px`;

    ctx.minimapViewport().style.width = `${Math.max(4, viewW * state.scale)}px`;

    ctx.minimapViewport().style.height = `${Math.max(4, viewH * state.scale)}px`;

    return true;

}

function minimapEventToWorld(event){

    if(!smartCanvasState.interaction.minimap) renderMinimap();

    const state = smartCanvasState.interaction.minimap;

    if(!state) return viewportCenter();

    const rect = minimapContent.getBoundingClientRect();

    const mx = event.clientX - rect.left;

    const my = event.clientY - rect.top;

    return {

        x:state.minX + (mx - state.offsetX) / Math.max(0.0001, state.scale),

        y:state.minY + (my - state.offsetY) / Math.max(0.0001, state.scale)

    };

}

function centerViewportOnWorldPoint(point){

    viewport.x = shell.clientWidth / 2 - point.x * viewport.scale;

    viewport.y = shell.clientHeight / 2 - point.y * viewport.scale;

    applyViewport();

    scheduleSave();

}

function fitAllNodesViewport(){

    const visibleNodes = ctx.nodes().filter(node => node.id !== SMART_LOG_PREVIEW_NODE_ID);

    if(!visibleNodes.length){

        viewport.scale = 0.45;

        const focusBounds = smartViewportFocusBounds();
        viewport.x = focusBounds.centerX;
        viewport.y = focusBounds.centerY;

        applyViewport();

        scheduleSave();

        return;

    }

    const rects = visibleNodes.map(nodeRect);

    const minX = Math.min(...rects.map(r => r.x));

    const minY = Math.min(...rects.map(r => r.y));

    const maxX = Math.max(...rects.map(r => r.x + r.width));

    const maxY = Math.max(...rects.map(r => r.y + r.height));

    // Keep the viewport inset in screen pixels. A world-space pad plus a 6% floor
    // could make an exceptionally large canvas impossible to frame completely.
    const screenInset = 24;

    const width = Math.max(1, maxX - minX);

    const height = Math.max(1, maxY - minY);

    const focusBounds = smartViewportFocusBounds();
    const nextScale = Math.min(
        0.82,
        Math.max(1, focusBounds.width - screenInset * 2) / width,
        Math.max(1, focusBounds.height - screenInset * 2) / height
    );

    const cx = (minX + maxX) / 2;

    const cy = (minY + maxY) / 2;

    viewport.scale = nextScale;

    viewport.x = focusBounds.centerX - cx * viewport.scale;
    viewport.y = focusBounds.centerY - cy * viewport.scale;

    applyViewport();

    scheduleSave();

}

function smartViewportFocusBounds(){
    const shellRect = shell?.getBoundingClientRect();
    const width = Math.max(1, shellRect?.width || shell?.clientWidth || 1);
    const height = Math.max(1, shellRect?.height || shell?.clientHeight || 1);
    const visiblePanelRect = (element, open=false) => {
        if(!element || !open) return null;
        const style = window.getComputedStyle(element);
        if(style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 0) <= .01) return null;
        const rect = element.getBoundingClientRect();
        return rect.width > 1 && rect.height > 1 ? rect : null;
    };
    const sidePanels = [
        visiblePanelRect(composer, composer?.classList.contains('open') && !composer.classList.contains('collapsed')),
        visiblePanelRect(assetPanel, assetPanel?.classList.contains('open')),
        visiblePanelRect(smartLogModal, smartLogModal?.classList.contains('open')),
        visiblePanelRect(smartShortcutModal, smartShortcutModal?.classList.contains('open')),
        visiblePanelRect(smartChatPanel, smartChatPanel?.classList.contains('open'))
    ].filter(Boolean);

    // Side cards reserve their full vertical lanes; the minimap does not affect shortcut viewport fitting.
    const inset = 24;
    const gap = 18;
    const intervals = sidePanels.map(rect => ({
        left:Math.max(inset, Math.min(width - inset, rect.left - shellRect.left - gap)),
        right:Math.max(inset, Math.min(width - inset, rect.right - shellRect.left + gap))
    })).filter(interval => interval.right > interval.left).sort((a, b) => a.left - b.left);
    const merged = [];
    intervals.forEach(interval => {
        const previous = merged[merged.length - 1];
        if(previous && interval.left <= previous.right){ previous.right = Math.max(previous.right, interval.right); }
        else merged.push(interval);
    });

    let cursor = inset;
    const lanes = [];
    merged.forEach(interval => {
        if(interval.left > cursor) lanes.push({left:cursor, right:interval.left});
        cursor = Math.max(cursor, interval.right);
    });
    if(cursor < width - inset) lanes.push({left:cursor, right:width - inset});
    const lane = lanes.sort((a, b) => (b.right - b.left) - (a.right - a.left))[0]
        || {left:inset, right:width - inset};
    const topToolbarBottom = ['smartWorkspaceRail','smartUtilityCluster','smartStatusRail']
        .reduce((max, id) => {
            const el = document.getElementById(id);
            if(!el) return max;
            const rect = el.getBoundingClientRect();
            return rect.width > 1 && rect.height > 1 ? Math.max(max, rect.bottom - shellRect.top) : max;
        }, 0);
    const topInset = Math.max(inset, topToolbarBottom + gap);
    const base = {left:lane.left, right:lane.right, top:topInset, bottom:height - inset};
    let focusRect = base;

    const usableWidth = Math.max(1, focusRect.right - focusRect.left);
    const usableHeight = Math.max(160, focusRect.bottom - focusRect.top);
    return {
        width:usableWidth,
        height:usableHeight,
        centerX:focusRect.left + usableWidth / 2,
        centerY:focusRect.top + usableHeight / 2
    };
}

// SMART_CANVAS_INTERACTION_REFINEMENTS_20260713: F focuses the current selection; Shift+F shows the whole canvas.

function fitNodeIdsViewport(ids){

    const targets = Array.from(new Set(ids || [])).map(id => ctx.nodes().find(n => n.id === id)).filter(Boolean);

    if(!targets.length) return false;

    const rects = targets.map(nodeRect);

    const minX = Math.min(...rects.map(r => r.x));

    const minY = Math.min(...rects.map(r => r.y));

    const maxX = Math.max(...rects.map(r => r.x + r.width));

    const maxY = Math.max(...rects.map(r => r.y + r.height));

    const pad = targets.length === 1 ? 110 : 140;

    const width = Math.max(1, maxX - minX + pad * 2);

    const height = Math.max(1, maxY - minY + pad * 2);

    const focusBounds = smartViewportFocusBounds();
    viewport.scale = Math.max(0.06, Math.min(1.15, focusBounds.width / width, focusBounds.height / height));
    viewport.x = focusBounds.centerX - ((minX + maxX) / 2) * viewport.scale;
    viewport.y = focusBounds.centerY - ((minY + maxY) / 2) * viewport.scale;

    smartCanvasState.interaction.zoomPreview = null;

    shell.classList.remove('zoom-preview');

    applyViewport();

    scheduleSave();

    return true;

}

function focusSelectedNodesViewport(){

    const ids = selectedNodeIds();

    if(!ids.length){ toast('请先选择要定位的节点'); return false; }

    return fitNodeIdsViewport(ids);

}

function showAllNodesViewport(){

    smartCanvasState.interaction.zoomPreview = null;

    shell.classList.remove('zoom-preview');

    return fitAllNodesViewport();

}

function directDownstreamNodeIds(node){
    if(!node?.id) return [];
    const connectionIds = SmartCanvasConnectionPrimitives.outgoingConnections(node.id, ctx.canvas()?.connections || [], ['input','flow'])
        .map(connection => connection.to);
    const legacyIds = ctx.canvasUsesConnections() ? [] : ctx.nodes()
        .filter(candidate => (candidate?.inputNodeIds || []).includes(node.id))
        .map(candidate => candidate.id);
    return [...new Set([...connectionIds, ...legacyIds])].filter(id => ctx.nodes().some(item => item.id === id));
}

function relatedNodeIds(nodesToFocus){
    const queue = nodesToFocus.filter(Boolean);
    if(!queue.length) return [];
    const ids = new Set(queue.map(node => node.id));
    while(queue.length){
        const current = queue.shift();
        const related = [
            ...upstreamNodesForKinds(current, ['input','flow']),
            ...directDownstreamNodeIds(current).map(id => ctx.nodes().find(item => item.id === id)).filter(Boolean)
        ];
        related.forEach(item => {
            if(ids.has(item.id)) return;
            ids.add(item.id);
            queue.push(item);
        });
    }
    return [...ids];
}

function focusSelectedNodeRelationsViewport(){
    const selectedNodes = selectedNodeIds().map(id => ctx.nodes().find(node => node.id === id)).filter(Boolean);
    return fitNodeIdsViewport(relatedNodeIds(selectedNodes));
}

let zViewportCycleSignature = '';
let zViewportCycleStep = 0;

function cycleZViewport(){
    const selectedIds = selectedNodeIds().slice().sort();
    if(!selectedIds.length){
        zViewportCycleSignature = '';
        zViewportCycleStep = 0;
        return showAllNodesViewport();
    }
    const signature = selectedIds.join('|');
    if(signature !== zViewportCycleSignature){
        zViewportCycleSignature = signature;
        zViewportCycleStep = 0;
    }
    const result = zViewportCycleStep === 0
        ? focusSelectedNodesViewport()
        : focusSelectedNodeRelationsViewport();
    zViewportCycleStep = (zViewportCycleStep + 1) % 2;
    return result;
}

function exitZoomPreview(point=null){

    if(!smartCanvasState.interaction.zoomPreview) return false;

    const prev = smartCanvasState.interaction.zoomPreview;

    smartCanvasState.interaction.zoomPreview = null;

    shell.classList.remove('zoom-preview');

    viewport.scale = prev.scale;

    if(point){

        viewport.x = shell.clientWidth / 2 - point.x * viewport.scale;

        viewport.y = shell.clientHeight / 2 - point.y * viewport.scale;

    } else {

        viewport.x = prev.x;

        viewport.y = prev.y;

    }

    applyViewport();

    scheduleSave();

    return true;

}

function exitZoomPreviewToNode(nodeId){

    if(!smartCanvasState.interaction.zoomPreview) return false;

    const node = ctx.nodes().find(n => n.id === nodeId);

    if(!node) return exitZoomPreview();

    const prev = smartCanvasState.interaction.zoomPreview;

    const rect = nodeRect(node);

    const cx = rect.x + rect.width / 2;

    const cy = rect.y + rect.height / 2;

    const fitW = Math.max(1, shell.clientWidth - 160);

    const fitH = Math.max(1, shell.clientHeight - 160);

    const fitScale = Math.min(

        ZOOM_PREVIEW_NODE_MAX_SCALE,

        fitW / Math.max(1, rect.width),

        fitH / Math.max(1, rect.height)

    );

    const readableScale = Math.min(ZOOM_PREVIEW_NODE_MAX_SCALE, Math.max(ZOOM_PREVIEW_NODE_DEFAULT_SCALE, fitScale));

    smartCanvasState.interaction.zoomPreview = null;

    shell.classList.remove('zoom-preview');

    viewport.scale = Math.max(safeScale(prev.scale), readableScale);

    viewport.x = shell.clientWidth / 2 - cx * viewport.scale;

    viewport.y = shell.clientHeight / 2 - cy * viewport.scale;

    applyViewport();

    scheduleSave();

    return true;

}

const SMART_CANVAS_OVERVIEW_SCALE = 0;

const SMART_CANVAS_COMPACT_SCALE = SMART_CANVAS_OVERVIEW_SCALE;

const SMART_CANVAS_VIRTUAL_OVERSCAN = 240;

function smartCanvasNodeRenderMode(node){
    // Keep one stable DOM representation through the entire supported zoom range.
    // Swapping render tiers at low zoom caused the 13% flicker.
    return "full";
}

function shouldMountSmartCanvasNode(node){

    if(node.id === SMART_LOG_PREVIEW_NODE_ID) return false;

    if(smartCanvasNodeRenderMode(node) !== "full") return true;

    const rect = nodeRect(node);

    const overscan = SMART_CANVAS_VIRTUAL_OVERSCAN;

    const left = viewport.x + (rect.x - overscan) * viewport.scale;

    const top = viewport.y + (rect.y - overscan) * viewport.scale;

    const right = viewport.x + (rect.x + rect.width + overscan) * viewport.scale;

    const bottom = viewport.y + (rect.y + rect.height + overscan) * viewport.scale;

    return right >= 0 && bottom >= 0 && left <= shell.clientWidth && top <= shell.clientHeight;

}

function smartCompactNodePreviewHtml(node, mode){

    const items = (node.images || []).filter(item => item?.url);

    if(!items.length) return '';

    const visible = items.slice(0, mode === 'overview' ? 1 : Math.min(4, items.length));

    const cells = visible.map(item => {

        const kind = mediaKindForItem(item);

        if(kind === 'image' || kind === 'video'){

            return kind === 'video'

                ? smartVideoPreviewHtml(item, 320, 'alt="" draggable="false"')

                : smartPreviewImgHtml(item, 320, 'alt="" draggable="false"');

        }

        const label = kind === 'audio' ? 'AUDIO' : kind === 'text' ? 'TEXT' : 'FILE';

        return '<span class="smart-compact-node-placeholder">' + escapeHtml(label) + '</span>';

    }).join('');

    return '<div class="smart-compact-node-preview count-' + visible.length + '">' + cells + '</div>';

}

function smartCompactNodeHtml(node, layout, mode, title, isPending){
    const count = (node.images || []).length;
    const kind = count ? String(count) + ' 项' : '空节点';
    const status = node.running ? '运行中' : isPending ? '排队中' : '就绪';
    const classes = ['image-node', 'smart-node-compact', mode === 'overview' ? 'smart-node-overview' : '', isNodeSelected(node.id) ? 'selected' : '', node.running ? 'node-running' : '', isPending ? 'node-pending' : ''].filter(Boolean).join(' ');
    const preview = smartCompactNodePreviewHtml(node, mode);
    return '<div class="' + classes + '" data-id="' + escapeHtml(node.id) + '" style="left:' + (node.x || 0) + 'px;top:' + (node.y || 0) + 'px;width:' + layout.width + 'px;height:' + layout.height + 'px"><div class="smart-compact-node-card' + (preview ? ' has-preview' : '') + '">' + preview + '<div class="smart-compact-node-meta"><span class="smart-compact-node-kind">' + escapeHtml(kind) + '</span><strong class="smart-compact-node-title">' + escapeHtml(title) + '</strong><span class="smart-compact-node-status">' + escapeHtml(status) + '</span></div></div></div>';
}

function renderSmartCanvasEmptyState(){

    if(!smartCanvasEmptyState) return;

    // 创建入口点击后暂时隐藏引导；当用户把画布清空时恢复入口，避免留下不可见的空状态。

    if(ctx.nodes().length === 0) delete smartCanvasEmptyState.dataset.dismissed;

    const visible = ctx.nodes().length === 0 && !smartCanvasEmptyState.dataset.dismissed;

    smartCanvasEmptyState.hidden = !visible;

    if(visible && typeof refreshIcons === 'function') refreshIcons(smartCanvasEmptyState);

}

function renderCanvasNodes({refreshConnections=true, refreshMinimap=true, refreshComposer=true, refreshChat=false}={}){
    const perfToken = window.smartCanvasPerformance?.start('render-nodes', {nodes:ctx.nodes().length});
    const nodeHtmlEntries = smartCanvasNodeRenderPipeline.buildEntries(ctx.nodes(), {
        shouldMount:shouldMountSmartCanvasNode,
        emptyTitle:tr('smart.createImportNode'),
        primaryId:primarySelectedNode()?.id || '',
        isSelected:id => isNodeSelected(id),
        isDragging:item => Boolean(smartCanvasState.interaction.drag?.groupIds?.includes(item.id) || smartCanvasState.interaction.drag?.id === item.id),
        renderMode:item => smartCanvasNodeRenderMode(item),
        nodeScale,
        imageLayout,
        nodeBodyHtml,
        nodeMetaHtml,
        smartCompactNodeHtml,
        escapeHtml,
        tr,
        runTimePillHtml,
    });
    if(refreshConnections) smartCanvasConnectionRenderer.mount(renderConnections());
    const nodeMountResult = smartCanvasNodeRenderer.mount({
        entries:nodeHtmlEntries,
        transplant:transplantSmartMediaElements,
        captureMediaStates:captureMediaPlaybackStates,
        restoreMediaStates:restoreMediaPlaybackStates
    });
    syncComposerPromptEditingIndicator();
    syncSelectionContextVisuals({refreshConnections:false});
    syncSmartNodeOutcomeVisuals();
    if(nodeMountResult.changed){ bindNodeEvents(); normalizeSmartCanvasButtonHints(world); }
    if(refreshComposer) updateComposer();
    if(refreshChat) renderSmartChatPanel();
    syncSelectionDockUi();
    if(refreshMinimap) renderMinimap();
    if(nodeMountResult.changed){
        refreshIcons(world);
        bindSmartPreviewImageFallbacks(world);
        scheduleSmartNodeImageMeasure();
    }
    syncSmartSelectedImageResolution(world);
    refreshRunTimerPills();
    window.smartCanvasPerformance?.end(perfToken, {mounted:nodeHtmlEntries.length, changed:Boolean(nodeMountResult.changed)});
}

function renderStatusPartial(nodeIds=[]){
    syncSmartNodeOutcomeVisuals(nodeIds?.length ? nodeIds : null);
    syncSelectionContextVisuals({refreshConnections:false});
    syncRunButtonState();
    syncSmartCanvasContext();
    syncSelectionDockUi();
    refreshRunTimerPills();
}

function render(options={}){
    const scope = typeof options === 'string' ? options : String(options.scope || 'full');
    if(scope === 'nodes') return renderCanvasNodes(options);
    if(scope === 'status') return renderStatusPartial(options.nodeIds || []);
    return renderFull();
}

function renderFull(){
    const perfToken = window.smartCanvasPerformance?.start('render', {nodes:ctx.nodes().length});

    renderSmartCanvasEmptyState();

    rememberInlineVideoActivations();

    refreshSelectedConnectionScope();

    world.classList.toggle('smart-multi-selected', selectedNodeIds().length > 1);

    const nodeHtmlEntries = smartCanvasNodeRenderPipeline.buildEntries(ctx.nodes(), {

        shouldMount:shouldMountSmartCanvasNode,

        emptyTitle:tr('smart.createImportNode'),

        primaryId:primarySelectedNode()?.id || '',

        isSelected:id => isNodeSelected(id),

        isDragging:item => Boolean(smartCanvasState.interaction.drag?.groupIds?.includes(item.id) || smartCanvasState.interaction.drag?.id === item.id),

        renderMode:item => smartCanvasNodeRenderMode(item),

        nodeScale,

        imageLayout,

        nodeBodyHtml,

        nodeMetaHtml,

        smartCompactNodeHtml,

        escapeHtml,

        tr,

        runTimePillHtml,

    });
    refreshConnectionLayer();
    const nodeMountResult = smartCanvasNodeRenderer.mount({
        entries:nodeHtmlEntries,
        transplant:transplantSmartMediaElements,
        captureMediaStates:captureMediaPlaybackStates,
        restoreMediaStates:restoreMediaPlaybackStates
    });

    // Viewport virtualisation can replace a node while its composer prompt still owns focus.
    // Restore the editor indicator from state without restarting an already-running animation.
    syncComposerPromptEditingIndicator();
    syncSelectionContextVisuals({refreshConnections:false});
    syncSmartNodeOutcomeVisuals();

    bindNodeEvents();
    normalizeSmartCanvasButtonHints(world);

    updateComposer();
    renderSmartChatPanel();

    // render() is also the initial-load path; keep the persistent action dock in sync
    // even before a user selection event occurs.
    syncSelectionDockUi();

    if(!updateMinimapViewportRect()) renderMinimap();
    if(nodeMountResult.changed){
        refreshIcons(world);
        bindSmartPreviewImageFallbacks(world);
        scheduleSmartNodeImageMeasure();
    }
    syncSmartSelectedImageResolution(world);

    refreshRunTimerPills();

    window.smartCanvasPerformance?.end(perfToken, {mounted:nodeHtmlEntries.length, changed:Boolean(nodeMountResult.changed)});

}

    return {
        setViewportScaleAtScreenPoint,
        applyViewport,
        scheduleCanvasLayerRefresh,
        scheduleSmartCanvasRender,
        scheduleSmartCanvasNodesRender,
        scheduleSmartCanvasStatusRender,
        invalidateShellRectCache,
        currentShellRect,
        screenToWorld,
        viewportCenter,
        minimapEventToWorld,
        centerViewportOnWorldPoint,
        fitNodeIdsViewport,
        focusSelectedNodesViewport,
        showAllNodesViewport,
        cycleZViewport,
        exitZoomPreview,
        exitZoomPreviewToNode,
        render
    };

}
