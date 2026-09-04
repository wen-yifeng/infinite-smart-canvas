/*
 * smart-canvas-drag-controller.js — 交互/拖拽域（Phase 2 P2.3，自 smart-canvas.js 迁入）。
 *
 * 职责：port/resize/节点拖拽启动器、框选与中键平移、createMenu/命令菜单/迁移选择器、
 * shell 事件处理器、window.onmousemove/onmouseup 拖拽状态机、小地图与视口控件绑定。
 * 交互状态由 smartCanvasState.interaction 持有；可变共享状态经 ctx 访问器读写；
 * selectedId/selectedIds/selectedImage 经 window 别名直达。分支顺序、preventDefault
 * 位置与快捷键手感逐行保留；DOM 结构与类名零漂移。
 */
export function createDragController(ctx) {

    const {
        shell,
        world,
        minimap,
        selectionBox,
        createMenu,
        canvasCommandList,
        fileInput,
        smartSelectionDock,
        smartCommandDock,
        smartFocusSelectionBtn,
        smartShowAllBtn,
        smartViewportControls,
        smartZoomInBtn,
        smartZoomLabel,
        smartZoomOutBtn,
        smartCanvasState,
        viewport,
        smartDropFeedback,
        smartCanvasCommandMenuView,
        SMART_CANVAS_MANUAL_CONNECTIONS_ENABLED,
        canvasId,
        escapeHtml,
        tr,
        refreshIcons,
        toast,
        nodeRect,
        screenToWorld,
        minimapEventToWorld,
        viewportCenter,
        applyViewport,
        setViewportScaleAtScreenPoint,
        centerViewportOnWorldPoint,
        focusSelectedNodesViewport,
        showAllNodesViewport,
        exitZoomPreview,
        exitZoomPreviewToNode,
        runViewShortcut,
        invalidateShellRectCache,
        render,
        scheduleSave,
        syncSelectionUi,
        selectedNodeIds,
        updateComposer,
        activeComposerNode,
        clearSelection,
        capturePendingUndo,
        commitPendingUndo,
        discardPendingUndo,
        executeSmartCanvasCommand,
        scheduleConnectionLayerRefresh,
        renderCommandDock,
        moveNodeElementsDuringDrag,
        updateNodeElementDuringResize,
        smartNodeDragSnapOffset,
        clearSmartNodeSnapGuides,
        startSmartNodeDrag,
        resetSingleImageAspect,
        singleImageAspectRatio,
        rectOverlapNode,
        canAutoConnectDraggedNode,
        dragConnectTargetFor,
        restoreDraggedNodePosition,
        clearDropHighlight,
        setDropHighlight,
        connectInputNode,
        hasConnectionBetween,
        appendImagesToSmartNode,
        handleFiles,
        handleSmartImageDropPayload,
        resolveSmartImageDropPayload,
        hasSmartImageDropData,
        hasSmartAssetDrag,
        setSmartDropCopyEffect,
        addUrlToAssetLibrary,
        assetNodeImageFromItem,
        setAssetDragOver,
        assetPanel,
        isSmartImageNode,
        isSmartChatNode,
        mediaKindForFile,
        mergeImageNodesIntoGroup,
        groupSelectedNodes,
        ungroupNode,
        arrangeSelectedSmartNodes,
        normalizeSelectedSmartImageHeights,
        selectedHeightNormalizableNodes,
        createImageNodeAt,
        createEmptyUploadNodeAt,
        duplicateForAltDrag,
        clearImageClickTimer,
        downloadPreviewFile,
        runSmartSelectionDockAction,
        cancelActiveCanvasInteraction,
        smartNodeToolbarMediaItem
    } = ctx;

function ensurePortDragPathElement(){

    const svg = world.querySelector('svg.connection-layer');

    if(!svg) return null;

    let path = svg.querySelector('path.port-drag-temp');

    if(!path){

        path = document.createElementNS('http://www.w3.org/2000/svg', 'path');

        path.setAttribute('class', 'port-drag-temp conn-pending');

        path.setAttribute('stroke', 'rgba(100,116,139,0.92)');

        path.setAttribute('stroke-width', '1.9');

        path.setAttribute('fill', 'none');

        path.setAttribute('stroke-linecap', 'round');

        svg.appendChild(path);

    }

    return path;

}

function clearPortDragVisual(){

    world.querySelector('path.port-drag-temp')?.remove();

    world.querySelectorAll('.node-port.is-active').forEach(el => el.classList.remove('is-active'));

    world.querySelectorAll('.image-node.port-hover').forEach(el => el.classList.remove('port-hover'));

}

function updatePortDragVisual(){

    if(!smartCanvasState.interaction.portDrag) return;

    const fromNode = ctx.nodes().find(n => n.id === smartCanvasState.interaction.portDrag.fromId);

    if(!fromNode) return;

    const fr = nodeRect(fromNode);

    const isOut = smartCanvasState.interaction.portDrag.fromPort === 'out';

    const fx = isOut ? fr.x + fr.width : fr.x;

    const fy = fr.y + fr.height / 2;

    const tx = smartCanvasState.interaction.portDrag.currentWorld.x;

    const ty = smartCanvasState.interaction.portDrag.currentWorld.y;

    const dx = Math.max(50, Math.abs(tx - fx) * 0.45);

    const sign = isOut ? 1 : -1;

    const path = ensurePortDragPathElement();

    if(path) path.setAttribute('d', `M${fx} ${fy} C ${fx + dx * sign} ${fy}, ${tx - dx * sign} ${ty}, ${tx} ${ty}`);

    world.querySelectorAll('.node-port.is-active').forEach(el => el.classList.remove('is-active'));

    world.querySelectorAll('.image-node.port-hover').forEach(el => el.classList.remove('port-hover'));

    if(smartCanvasState.interaction.portDrag.hoverTargetId){

        const targetNodeEl = world.querySelector(`.image-node[data-id="${smartCanvasState.interaction.portDrag.hoverTargetId}"]`);

        targetNodeEl?.classList.add('port-hover');

        targetNodeEl?.querySelector(`.node-port[data-port="${smartCanvasState.interaction.portDrag.hoverPort}"]`)?.classList.add('is-active');

    }

}

function handlePortDrop(drag, e){
    if(!SMART_CANVAS_MANUAL_CONNECTIONS_ENABLED){
        discardPendingUndo();
        clearPortDragVisual();
        return false;
    }

    const {targetId, targetPort, hit} = (() => {

        const hitEl = document.elementFromPoint(e.clientX, e.clientY);

        const portEl = hitEl?.closest?.('.node-port');

        const nodeEl = portEl?.closest?.('.image-node') || hitEl?.closest?.('.image-node');

        let id = '', port = '';

        if(nodeEl && nodeEl.dataset.id && nodeEl.dataset.id !== drag.fromId){

            id = nodeEl.dataset.id;

            if(portEl){

                port = portEl.dataset.port;

            } else {

                const rect = nodeEl.getBoundingClientRect();

                port = (e.clientX - rect.left) < rect.width / 2 ? 'in' : 'out';

            }

        }

        return {targetId:id, targetPort:port, hit:hitEl};

    })();

    if(targetId){

        const compatible = (drag.fromPort === 'out' && targetPort === 'in') || (drag.fromPort === 'in' && targetPort === 'out');

        if(!compatible){ discardPendingUndo(); render(); return; }

        const fromId = drag.fromPort === 'out' ? drag.fromId : targetId;

        const toId = drag.fromPort === 'out' ? targetId : drag.fromId;

        if(connectInputNode(fromId, toId)){

            commitPendingUndo();

            render();

            scheduleSave();

        } else {

            discardPendingUndo();

            render();

        }

        return;

    }

    if(!drag.moved){ discardPendingUndo(); render(); return; }

    if(hit?.closest?.('.smart-canvas-api-settings-modal,.composer,.smart-chat-panel,.smart-utility-cluster,.smart-back,.asset-panel,.asset-toggle,.smart-log-toggle,.smart-shortcut-toggle,.log-modal,.shortcut-modal,.media-preview-modal,.smart-minimap')){

        discardPendingUndo(); render(); return;

    }

    const p = screenToWorld(e);

    ctx.setUndoSuppressed( true);

    const newNode = createImageNodeAt(p, [], {select:true, skipUndo:true});

    ctx.setUndoSuppressed( false);

    const fromId = drag.fromPort === 'out' ? drag.fromId : newNode.id;

    const toId = drag.fromPort === 'out' ? newNode.id : drag.fromId;

    connectInputNode(fromId, toId);

    commitPendingUndo();

    render();

    scheduleSave();

}

function pickMediaForSmartNode(nodeId){

    const input = document.createElement('input');

    input.type = 'file';

    input.accept = 'image/*,video/*,audio/*';

    input.multiple = true;

    input.onchange = () => {

        if(input.files?.length) handleFiles(input.files, nodeId);

        input.remove();

    };

    input.style.position = 'fixed';

    input.style.left = '-9999px';

    input.style.top = '-9999px';

    input.style.opacity = '0';

    document.body.appendChild(input);

    input.click();

}

function pickReferenceImagesForSmartNode(nodeId){
    const active = activeComposerNode();
    if(active?.id !== nodeId) return false;

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = async () => {
        const files = [...(input.files || [])].filter(file => mediaKindForFile(file) === 'image');
        input.remove();
        if(!files.length) return;
        await handleFiles(files, nodeId);
    };
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.style.top = '-9999px';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.click();
    return true;
}

function pickSingleReferenceImageForSmartNode(nodeId){
    const node = ctx.nodes().find(candidate => candidate.id === nodeId);
    if(!node || (node.images || []).length !== 1) return false;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = false;
    input.onchange = async () => {
        const file = [...(input.files || [])].find(candidate => mediaKindForFile(candidate) === 'image');
        input.remove();
        if(!file) return;
        await handleFiles([file], nodeId, {replaceSingleInput:true});
    };
    input.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
    document.body.appendChild(input);
    input.click();
    return true;
}

function beginSmartThumbnailDrag(event, nodeId, item){
    const node = ctx.nodes().find(candidate => candidate.id === nodeId);
    const refNodeId = item?.dataset?.refNodeId || '';
    if((refNodeId && refNodeId !== nodeId) || !node || (node.images || []).length <= 1) return false;
    event.preventDefault();
    event.stopPropagation();
    smartCanvasState.beginInteraction('thumbDrag', {
        nodeId,
        imgIndex:Number(item.dataset.imageIndex || 0),
        startX:event.clientX,
        startY:event.clientY,
        detached:false,
    }, {source:'thumbnail-drag'});
    capturePendingUndo();
    return true;
}

function resetSmartNodeAspect(nodeId){
    const node = ctx.nodes().find(candidate => candidate.id === nodeId);
    if(singleImageAspectRatio(node) <= 0) return false;
    return executeSmartCanvasCommand('reset-single-image-aspect', () => {
        if(!resetSingleImageAspect(node)) return false;
        updateNodeElementDuringResize(node);
        return true;
    }, {skipRender:true});
}

function beginSmartNodeResize(event, nodeId){
    invalidateShellRectCache();
    const node = ctx.nodes().find(candidate => candidate.id === nodeId);
    if(!node) return false;
    const rect = nodeRect(node);
    smartCanvasState.beginInteraction('resize', {
        id:nodeId,
        startX:event.clientX,
        startY:event.clientY,
        startW:rect.width,
        startH:rect.height,
        aspectRatio:singleImageAspectRatio(node),
        nodeMap:new Map(ctx.nodes().map(item => [item.id, item])),
        elementMap:new Map([...world.querySelectorAll('.image-node')].map(item => [item.dataset.id, item])),
    }, {source:'node-resize'});
    document.body.classList.add('smart-node-resize');
    capturePendingUndo();
    return true;
}

function beginSmartNodeDrag(event, nodeId){
    window.getSelection?.()?.removeAllRanges?.();
    document.activeElement?.blur?.();
    let node = ctx.nodes().find(candidate => candidate.id === nodeId);
    if(!node) return false;
    const altDuplicated = Boolean(event.altKey);
    if(altDuplicated){
        capturePendingUndo();
        node = duplicateForAltDrag(node, event.shiftKey, {skipRender:true, skipSave:true});
        render();
    }
    return startSmartNodeDrag(node, event, {
        ctrlGroup:Boolean(event.ctrlKey),
        captureUndo:!altDuplicated,
    });
}

function beginSmartPortDrag(event, nodeId, port){
    if(!SMART_CANVAS_MANUAL_CONNECTIONS_ENABLED){
        clearPortDragVisual();
        shell.classList.remove('port-dragging');
        return false;
    }
    const currentWorld = screenToWorld(event);
    smartCanvasState.beginInteraction('portDrag', {
        fromId:nodeId,
        fromPort:port?.dataset?.port || '',
        currentWorld,
        hoverTargetId:'',
        hoverPort:'',
        moved:false,
    }, {source:'port-drag'});
    shell.classList.add('port-dragging');
    capturePendingUndo();
    ensurePortDragPathElement();
    updatePortDragVisual();
    return true;
}

async function handleSmartNodeDrop(event, nodeId){
    clearSmartExternalDropPreview();
    const assetRaw = event.dataTransfer?.getData('application/x-smart-asset');
    if(assetRaw){
        try {
            const asset = JSON.parse(assetRaw);
            if(asset?.url){
                appendImagesToSmartNode([assetNodeImageFromItem(asset)], nodeId);
                return true;
            }
        } catch {}
    }
    const payload = await resolveSmartImageDropPayload(event.dataTransfer);
    if(payload.type === 'none') return false;
    await handleSmartImageDropPayload(payload, nodeId);
    return true;
}

function updateSelectionBox(event){

    if(!smartCanvasState.interaction.selection) return;

    const sx = smartCanvasState.interaction.selection.startScreen.x, sy = smartCanvasState.interaction.selection.startScreen.y;

    const x = Math.min(sx, event.clientX), y = Math.min(sy, event.clientY);

    selectionBox.style.display = 'block';

    selectionBox.style.left = `${x}px`;

    selectionBox.style.top = `${y}px`;

    selectionBox.style.width = `${Math.abs(event.clientX - sx)}px`;

    selectionBox.style.height = `${Math.abs(event.clientY - sy)}px`;

}

function finishSelection(event){

    if(!smartCanvasState.interaction.selection) return;

    const a = smartCanvasState.interaction.selection.startWorld;

    const b = screenToWorld(event);

    const selectionRect = SmartCanvasSelectionPrimitives.rectFromPoints(a, b);

    const next = SmartCanvasSelectionPrimitives.applyRect(

        {primaryId:selectedId, ids:smartCanvasState.interaction.selection.initialSelectedIds},

        ctx.nodes(),

        selectionRect,

        {toggle:smartCanvasState.interaction.selection.toggle, initialSelectedIds:smartCanvasState.interaction.selection.initialSelectedIds, rectForNode:nodeRect}

    );

    selectedId = next.primaryId;

    selectedIds = next.ids;

    selectedImage = next.image;

    smartCanvasState.endInteraction('selection', {source:'selection-finish'});

    shell.classList.remove('selecting');

    ctx.setSelectionJustFinished( true);

    selectionBox.style.display = 'none';

    syncSelectionUi();

    updateComposer();

    setTimeout(() => { ctx.setSelectionJustFinished( false); }, 0);

}

function startBlankSelection(event){

    event.preventDefault();

    invalidateShellRectCache();

    smartCanvasState.interaction.didPan = false;

    smartCanvasState.beginInteraction('selection', {

        startScreen:{x:event.clientX, y:event.clientY},

        startWorld:screenToWorld(event),

        toggle:event.shiftKey,

        initialSelectedIds:selectedNodeIds()

    }, {source:'blank-selection'});

    updateSelectionBox(event);

}

function shouldBlockMiddlePan(target){

    return !!target?.closest?.('.smart-canvas-api-settings-modal,.composer,.smart-chat-panel,.smart-utility-cluster,.smart-selection-dock,.smart-viewport-controls,.log-modal,.shortcut-modal,.media-preview-modal,.prompt-template-panel,.prompt-preset-edit,.asset-dialog-backdrop,.smart-minimap');

}

function startMiddlePan(event){

    if(event.button !== 1 || shouldBlockMiddlePan(event.target)) return false;

    event.preventDefault();

    event.stopPropagation();

    event.stopImmediatePropagation?.();

    invalidateShellRectCache();

    closeCreateMenu();

    smartCanvasState.interaction.didPan = false;

    smartCanvasState.beginInteraction('pan', {button:event.button, startX:event.clientX, startY:event.clientY, ox:viewport.x, oy:viewport.y}, {source:'middle-pan'});

    shell.classList.add('panning');

    return true;

}

function closeCreateMenu(){

    createMenu?.classList.remove('open');
    ctx.setCanvasCommandActiveIndex( 0);

}

function smartExternalDropCount(dataTransfer, knownAsset=false){
    const fileCount = Number(dataTransfer?.files?.length || 0);
    if(fileCount) return fileCount;
    if(knownAsset) return 1;
    return hasSmartAssetDrag(dataTransfer) || hasSmartImageDropData(dataTransfer) ? 1 : 0;
}

function clearSmartExternalDropPreview(){
    world.querySelectorAll('.smart-external-drop-target').forEach(element => {
        element.classList.remove('smart-external-drop-target');
        delete element.dataset.dropFeedback;
    });
    smartDropFeedback.hidden = true;
    ctx.setSmartExternalDragPoint( null);
    if(ctx.smartExternalDragRaf()){ cancelAnimationFrame(ctx.smartExternalDragRaf()); ctx.setSmartExternalDragRaf( 0); }
}

function setSmartNodeDropPreview(event, nodeId, active){
    const nodeElement = world.querySelector(`.image-node[data-id="${CSS.escape(nodeId)}"]`);
    if(!nodeElement) return;
    if(!active){
        nodeElement.classList.remove('smart-external-drop-target');
        delete nodeElement.dataset.dropFeedback;
        return;
    }
    const isAssetDrag = hasSmartAssetDrag(event.dataTransfer);
    const count = Math.max(1, smartExternalDropCount(event.dataTransfer, isAssetDrag));
    world.querySelectorAll('.smart-external-drop-target').forEach(element => {
        if(element !== nodeElement){ element.classList.remove('smart-external-drop-target'); delete element.dataset.dropFeedback; }
    });
    nodeElement.dataset.dropFeedback = `追加 ${count} 张`;
    nodeElement.classList.add('smart-external-drop-target');
    smartDropFeedback.hidden = true;
}

function updateSmartExternalDragPreview(event){
    const isAssetDrag = hasSmartAssetDrag(event.dataTransfer);
    if(!isAssetDrag && !hasSmartImageDropData(event.dataTransfer)) return;
    ctx.setSmartExternalDragPoint({
        x:event.clientX,
        y:event.clientY,
        overNode:Boolean(event.target?.closest?.('.image-node')),
        count:Math.max(1, smartExternalDropCount(event.dataTransfer, isAssetDrag))
    });
    if(ctx.smartExternalDragRaf()) return;
    ctx.setSmartExternalDragRaf(requestAnimationFrame(() => {
        ctx.setSmartExternalDragRaf(0);
        const point = ctx.smartExternalDragPoint();
        if(!point) return;
        if(!point.overNode){
            const left = Math.min(window.innerWidth - 150, point.x + 14);
            const top = Math.min(window.innerHeight - 42, point.y + 14);
            const label = `松开创建节点 · ${point.count} 张`;
            if(smartDropFeedback.hidden || smartDropFeedback.textContent !== label || smartDropFeedback.style.left !== `${left}px` || smartDropFeedback.style.top !== `${top}px`){
                smartDropFeedback.textContent = label;
                smartDropFeedback.style.left = `${left}px`;
                smartDropFeedback.style.top = `${top}px`;
                smartDropFeedback.hidden = false;
            }
        } else if(!smartDropFeedback.hidden){
            smartDropFeedback.hidden = true;
        }
        const edge = 64;
        const maxSpeed = 18;
        const xRatio = point.x < edge ? (edge - point.x) / edge : point.x > shell.clientWidth - edge ? -(point.x - (shell.clientWidth - edge)) / edge : 0;
        const yRatio = point.y < edge ? (edge - point.y) / edge : point.y > shell.clientHeight - edge ? -(point.y - (shell.clientHeight - edge)) / edge : 0;
        if(!xRatio && !yRatio) return;
        viewport.x += Math.max(-maxSpeed, Math.min(maxSpeed, xRatio * maxSpeed));
        viewport.y += Math.max(-maxSpeed, Math.min(maxSpeed, yRatio * maxSpeed));
        applyViewport();
    }));
}

const SMART_CANVAS_COMMANDS = Object.freeze([
    {id:'download', label:'下载', icon:'download', unavailableHint:'请先选择要下载的节点', available:() => selectedNodeIds().length > 0},
    {id:'upload', label:'上传素材', icon:'upload-cloud', available:() => true},
    {id:'create-empty', label:'创建空白节点', icon:'square-plus', available:() => true},
    {id:'migrate', label:'迁移', icon:'move-right', unavailableHint:'请先选择要迁移的节点', available:() => selectedNodeIds().length > 0},
    {id:'connect', label:'连线', icon:'link-2', unavailableHint:'需要选中两个图片节点且未连线', available:() => {
        const ids = selectedNodeIds();
        return ids.length === 2
            && ids.every(id => isSmartImageNode(ctx.nodes().find(n => n.id === id)))
            && !hasConnectionBetween(ids[0], ids[1]);
    }},
    {id:'arrange', label:'整理选中节点', icon:'workflow', unavailableHint:'请先选中节点', available:() => selectedNodeIds().length > 0},
    {id:'group', label:'组合', icon:'combine', unavailableHint:'需要至少选中两个节点', available:() => selectedNodeIds().length > 1},
    {id:'ungroup', label:'解散', icon:'ungroup', unavailableHint:'选中节点中没有可解散的组合', available:() => selectedNodeIds().some(id => (ctx.nodes().find(node => node.id === id)?.images || []).length > 1)},
    {id:'focus', label:'聚焦选中', icon:'focus', unavailableHint:'请先选中节点', available:() => selectedNodeIds().length > 0},
    {id:'show-all', label:'显示全部节点', icon:'scan', unavailableHint:'画布中暂无节点', available:() => ctx.nodes().length > 0},
    {id:'normalize-height', label:'统一高度', icon:'move-vertical', unavailableHint:'没有可统一高度的选中节点', available:() => selectedHeightNormalizableNodes().length > 0}
]);

function renderCanvasCommandMenu(query=''){
    if(!canvasCommandList) return;
    const needle = String(query || '').trim().toLocaleLowerCase('zh-CN');
    const matches = SMART_CANVAS_COMMANDS.filter(command => !needle || command.label.toLocaleLowerCase('zh-CN').includes(needle));
    ctx.setCanvasCommandActiveIndex( Math.max(0, Math.min(ctx.canvasCommandActiveIndex(), Math.max(0, matches.length - 1))));
    const commandItems = matches.map(command => ({
        id:command.id,
        label:command.label,
        icon:command.icon,
        available:command.available()
    }));
    canvasCommandList.innerHTML = smartCanvasCommandMenuView.html(commandItems, ctx.canvasCommandActiveIndex());
    refreshIcons(canvasCommandList);
}

function downloadSelectedNodeMedia(){

    const ids = selectedNodeIds();

    if(!ids.length){ toast('请先选择要下载的节点'); return; }

    const batchLimit = 30;

    const targets = [];

    for(const id of ids){

        const node = ctx.nodes().find(n => n.id === id);

        if(!node || isSmartChatNode(node)) continue;

        const item = smartNodeToolbarMediaItem(node);

        if(!item) continue;

        targets.push(item);

    }

    const skipped = ids.length - targets.length;

    if(!targets.length){ toast('没有可下载的图片节点'); return; }

    const queue = targets.length > batchLimit ? targets.slice(0, batchLimit) : targets;

    if(targets.length > batchLimit) toast(`本次仅下载前 ${batchLimit} 个，其余请分批下载`);

    queue.forEach((item, index) => {

        setTimeout(() => {

            downloadPreviewFile(item);

            if(index === queue.length - 1){

                toast(skipped > 0 ? `已下载 ${queue.length} 个文件，跳过 ${skipped} 个无图/无效节点` : `已下载 ${queue.length} 个文件`);

            }

        }, index * 200);

    });

}

function runCanvasCommand(commandId){
    const command = SMART_CANVAS_COMMANDS.find(item => item.id === commandId);
    if(!command?.available()) return false;
    closeCreateMenu();
    if(commandId === 'download'){
        downloadSelectedNodeMedia();
        return true;
    }
    if(commandId === 'upload'){
        ctx.setPendingGroupUploadPoint( {...ctx.createMenuPoint()});
        ctx.setUploadTargetId( '');
        fileInput?.click();
        return true;
    }
    if(commandId === 'create-empty'){
        createEmptyUploadNodeAt({...ctx.createMenuPoint()}, {select:true});
        return true;
    }
    if(commandId === 'migrate'){
        openCanvasMigrationPicker();
        return true;
    }
    if(commandId === 'arrange') return arrangeSelectedSmartNodes();
    if(commandId === 'group') return groupSelectedNodes();
    if(commandId === 'ungroup'){
        const group = selectedNodeIds().map(id => ctx.nodes().find(node => node.id === id)).find(node => (node?.images || []).length > 1);
        return group ? ungroupNode(group.id) : false;
    }
    if(commandId === 'focus') return runViewShortcut(() => focusSelectedNodesViewport());
    if(commandId === 'show-all') return runViewShortcut(() => showAllNodesViewport());
   if(commandId === 'normalize-height') return normalizeSelectedSmartImageHeights();
    if(commandId === 'connect'){
        const ids = selectedNodeIds();
        if(ids.length !== 2) return false;
        return executeSmartCanvasCommand('connect-ctx.nodes()', () => {
            const from = ctx.nodes().find(n => n.id === ids[0]);
            const to = ctx.nodes().find(n => n.id === ids[1]);
            if(!from || !to || !isSmartImageNode(from) || !isSmartImageNode(to)) return false;
            connectInputNode(from.id, to.id);
            return true;
        });
    }
    return false;
}

let canvasMigrationPicker = null;

function closeCanvasMigrationPicker(){
    if(canvasMigrationPicker?._closeOnEscape) document.removeEventListener('keydown', canvasMigrationPicker._closeOnEscape, true);
    canvasMigrationPicker?.remove();
    canvasMigrationPicker = null;
}

async function openCanvasMigrationPicker(){
    const selected = selectedNodeIds();
    if(!canvasId || !selected.length){
        toast('请先选中要迁移的节点');
        return;
    }
    closeCanvasMigrationPicker();
    const dialog = document.createElement('div');
    dialog.className = 'canvas-migration-picker';
    dialog.innerHTML = `<section class="canvas-migration-panel" role="dialog" aria-modal="true" aria-label="迁移节点">
        <header><div><strong>迁移节点</strong><span>将迁移完整上下游与分支关系</span></div><button type="button" data-migration-close title="关闭" aria-label="关闭"><i data-lucide="x"></i></button></header>
        <div class="canvas-migration-list"><div class="canvas-migration-loading">正在加载目标画布...</div></div>
    </section>`;
    document.body.appendChild(dialog);
    canvasMigrationPicker = dialog;
    dialog._closeOnEscape = event => { if(event.key === 'Escape') closeCanvasMigrationPicker(); };
    document.addEventListener('keydown', dialog._closeOnEscape, true);
    dialog.addEventListener('click', event => { if(event.target === dialog) closeCanvasMigrationPicker(); });
    dialog.querySelector('[data-migration-close]')?.addEventListener('click', closeCanvasMigrationPicker);
    refreshIcons(dialog);
    try {
        const response = await fetch('/api/canvases');
        if(!response.ok) throw new Error('load failed');
        const data = await response.json();
        const targets = (data.canvases || []).filter(item => item?.id && item.id !== canvasId);
        const list = dialog.querySelector('.canvas-migration-list');
        if(!targets.length){
            list.innerHTML = '<div class="canvas-migration-empty">暂无可迁移的目标画布</div>';
            return;
        }
        list.innerHTML = targets.map(item => `<button class="canvas-migration-target" type="button" data-target-id="${escapeHtml(item.id)}"><i data-lucide="layers"></i><span><strong>${escapeHtml(item.title || '未命名画布')}</strong><small>${Number(item.node_count || 0)} 个节点</small></span><i data-lucide="arrow-down-right"></i></button>`).join('');
        refreshIcons(list);
        list.querySelectorAll('[data-target-id]').forEach(button => button.addEventListener('click', async () => {
            if(button.disabled) return;
            button.disabled = true;
            button.classList.add('is-loading');
            try {
                const response = await fetch('/api/canvas-migrations', {
                    method:'POST',
                    headers:{'Content-Type':'application/json'},
                    body:JSON.stringify({source_canvas_id:canvasId, target_canvas_id:button.dataset.targetId, selected_node_ids:selected})
                });
                const data = await response.json().catch(() => ({}));
                if(!response.ok) throw new Error(data.detail || '迁移失败');
                const params = new URLSearchParams({id:data.target_canvas_id, project:targets.find(item => item.id === data.target_canvas_id)?.project || 'default', migrated:(data.moved_node_ids || []).join(',')});
                location.href = `/static/smart-canvas.html?${params.toString()}`;
            } catch(error) {
                button.disabled = false;
                button.classList.remove('is-loading');
                toast(error.message || '迁移失败');
            }
        }));
    } catch(error) {
        const list = dialog.querySelector('.canvas-migration-list');
        if(list) list.innerHTML = '<div class="canvas-migration-empty">加载目标画布失败</div>';
    }
}

function openCreateMenu(event){

    if(!createMenu) return;

    ctx.setCreateMenuPoint( screenToWorld(event));

    const w = 280;

    const h = 440;

    const left = Math.max(14, Math.min(window.innerWidth - w - 14, event.clientX + 8));

    const top = Math.max(14, Math.min(window.innerHeight - h - 14, event.clientY + 8));

    createMenu.style.left = `${left}px`;

    createMenu.style.top = `${top}px`;

    ctx.setCanvasCommandActiveIndex( 0);
    renderCanvasCommandMenu('');
    createMenu.classList.add('open');

    refreshIcons();

}

eventManager.addGlobal(window, 'mousedown', e => {
    const drag = smartCanvasState.interaction.drag;
    if(!drag?.keyboardMove) return;
    if(e.button === 2){
        ctx.setSuppressKeyboardMoveContextMenu( true);
        e.preventDefault();
        e.stopImmediatePropagation();
        cancelActiveCanvasInteraction();
        return;
    }
    if(e.button === 0){
        ctx.setSuppressKeyboardMoveClick( true);
        e.preventDefault();
        e.stopImmediatePropagation();
    }
}, true);
eventManager.addGlobal(window, 'click', e => {
    if(!ctx.suppressKeyboardMoveClick()) return;
    ctx.setSuppressKeyboardMoveClick( false);
    e.preventDefault();
    e.stopImmediatePropagation();
}, true);
eventManager.addGlobal(window, 'contextmenu', e => {
    if(!ctx.suppressKeyboardMoveContextMenu()) return;
    ctx.setSuppressKeyboardMoveContextMenu( false);
    e.preventDefault();
    e.stopImmediatePropagation();
}, true);
shell.addEventListener('mousedown', invalidateShellRectCache, {capture:true});

shell.addEventListener('mousedown', e => {

    if(!smartCanvasState.interaction.zoomPreview) return;

    if(e.button !== 0) return;

    if(e.target.closest('.smart-canvas-api-settings-modal,.composer,.smart-chat-panel,.smart-utility-cluster,.smart-selection-dock,.smart-viewport-controls,.smart-back,.asset-panel,.asset-toggle,.smart-log-toggle,.smart-shortcut-toggle,.log-modal,.shortcut-modal,.media-preview-modal,.create-menu,.smart-minimap')) return;

    e.preventDefault();

    e.stopPropagation();

}, true);

shell.addEventListener('click', e => {

    if(!smartCanvasState.interaction.zoomPreview) return;

    if(e.button !== 0) return;

    if(e.target.closest('.smart-canvas-api-settings-modal,.composer,.smart-chat-panel,.smart-utility-cluster,.smart-selection-dock,.smart-viewport-controls,.smart-back,.asset-panel,.asset-toggle,.smart-log-toggle,.smart-shortcut-toggle,.log-modal,.shortcut-modal,.media-preview-modal,.create-menu,.smart-minimap')) return;

    e.preventDefault();

    e.stopPropagation();

    const nodeEl = e.target.closest('.image-node');

    if(nodeEl?.dataset?.id) exitZoomPreviewToNode(nodeEl.dataset.id);

    else exitZoomPreview(screenToWorld(e));

}, true);

shell.addEventListener('mousedown', e => {

    startMiddlePan(e);

}, true);

shell.addEventListener('auxclick', e => {

    if(e.button === 1 && !shouldBlockMiddlePan(e.target)){

        e.preventDefault();

        e.stopPropagation();

    }

}, true);shell.onmousedown = e => {

    if(smartCanvasState.interaction.zoomPreview && e.button === 0 && !e.target.closest('.smart-canvas-api-settings-modal,.composer,.smart-chat-panel,.smart-utility-cluster,.smart-back,.asset-panel,.asset-toggle,.smart-log-toggle,.smart-shortcut-toggle,.log-modal,.shortcut-modal,.media-preview-modal,.create-menu,.smart-minimap')) return;

    if(e.target.closest('.image-node,.smart-canvas-api-settings-modal,.composer,.smart-chat-panel,.smart-utility-cluster,.smart-back,.asset-panel,.asset-toggle,.smart-log-toggle,.smart-shortcut-toggle,.log-modal,.shortcut-modal,.create-menu,.smart-minimap')) return;

    closeCreateMenu();

    if(e.button === 0){

        startBlankSelection(e);

        return;

    }

    startMiddlePan(e);

};

shell.oncontextmenu = e => {

    if(e.ctrlKey || e.metaKey){

        e.preventDefault();

        e.stopPropagation();

        return;

    }

    if(smartCanvasState.interaction.didPan || e.target.closest('.smart-canvas-api-settings-modal,.composer,.smart-chat-panel,.smart-utility-cluster,.smart-back,.asset-panel,.asset-toggle,.smart-log-toggle,.smart-shortcut-toggle,.log-modal,.shortcut-modal,.media-preview-modal,.create-menu,.smart-minimap')) return;

    if(document.getElementById('mediaPreviewModal')?.classList.contains('open')) return;

    e.preventDefault();

    e.stopPropagation();

    openCreateMenu(e);

};

shell.onclick = e => {

    if(ctx.selectionJustFinished()) return;

    if(smartCanvasState.interaction.didPan || e.target.closest('.image-node,.smart-canvas-api-settings-modal,.composer,.smart-chat-panel,.smart-utility-cluster,.smart-back,.asset-panel,.asset-toggle,.smart-log-toggle,.smart-shortcut-toggle,.log-modal,.shortcut-modal,.media-preview-modal,.create-menu')) return;

    if(document.getElementById('mediaPreviewModal')?.classList.contains('open')) return;

    closeCreateMenu();

    clearSelection();

    syncSelectionUi();

    updateComposer();

};

minimap?.addEventListener('mousedown', e => {

    if(e.button !== 0) return;

    e.preventDefault();

    e.stopPropagation();

    smartCanvasState.beginInteraction('minimap', true, {source:'minimap'});

    centerViewportOnWorldPoint(minimapEventToWorld(e));

});

[smartViewportControls].filter(Boolean).forEach(el => {

    el.addEventListener('mousedown', e => e.stopPropagation());

    el.addEventListener('dblclick', e => e.stopPropagation());

    el.addEventListener('contextmenu', e => e.stopPropagation());

});

smartZoomOutBtn?.addEventListener('click', e => {

    e.preventDefault();

    e.stopPropagation();

    setViewportScaleAtScreenPoint(viewport.scale / 1.2);

});

smartZoomInBtn?.addEventListener('click', e => {

    e.preventDefault();

    e.stopPropagation();

    setViewportScaleAtScreenPoint(viewport.scale * 1.2);

});

smartZoomLabel?.addEventListener('click', e => {

    e.preventDefault();

    e.stopPropagation();

    setViewportScaleAtScreenPoint(1);

});

smartShowAllBtn?.addEventListener('click', e => {

    e.preventDefault();

    e.stopPropagation();

    showAllNodesViewport();

});

smartSelectionDock?.addEventListener('mousedown', event => event.stopPropagation());
smartSelectionDock?.addEventListener('click', event => {
    event.stopPropagation();
    const button = event.target.closest('[data-selection-action]');
    if(!button || button.disabled) return;
    runSmartSelectionDockAction(button.dataset.selectionAction);
});

smartCommandDock?.addEventListener('mousedown', event => event.stopPropagation());
smartCommandDock?.addEventListener('contextmenu', event => event.stopPropagation());
smartCommandDock?.addEventListener('click', event => {
    event.stopPropagation();
    const button = event.target.closest('[data-canvas-command]');
    if(!button || button.disabled) return;
    ctx.setCreateMenuPoint( viewportCenter());
    runCanvasCommand(button.dataset.canvasCommand || '');
});

smartFocusSelectionBtn?.addEventListener('click', e => {

    e.preventDefault();

    e.stopPropagation();

    focusSelectedNodesViewport();

});

window.onmousemove = e => {

    ctx.setLastMouseClient( {x:e.clientX, y:e.clientY});

    ctx.setLastMouseWorld( screenToWorld(e));

    if(smartCanvasState.interaction.minimapDrag){

        e.preventDefault();

        centerViewportOnWorldPoint(minimapEventToWorld(e));

        return;

    }

    if(smartCanvasState.interaction.portDrag){

        e.preventDefault();

        const p = screenToWorld(e);

        smartCanvasState.interaction.portDrag.currentWorld = p;

        smartCanvasState.interaction.portDrag.moved = true;

        const hitEl = document.elementFromPoint(e.clientX, e.clientY);

        const portEl = hitEl?.closest?.('.node-port');

        const nodeEl = portEl?.closest?.('.image-node') || hitEl?.closest?.('.image-node');

        let targetId = '', targetPort = '';

        if(nodeEl && nodeEl.dataset.id && nodeEl.dataset.id !== smartCanvasState.interaction.portDrag.fromId){

            targetId = nodeEl.dataset.id;

            if(portEl){

                targetPort = portEl.dataset.port;

            } else {

                const rect = nodeEl.getBoundingClientRect();

                targetPort = (e.clientX - rect.left) < rect.width / 2 ? 'in' : 'out';

            }

            const compatible = (smartCanvasState.interaction.portDrag.fromPort === 'out' && targetPort === 'in') || (smartCanvasState.interaction.portDrag.fromPort === 'in' && targetPort === 'out');

            if(!compatible){ targetId = ''; targetPort = ''; }

        }

        smartCanvasState.interaction.portDrag.hoverTargetId = targetId;

        smartCanvasState.interaction.portDrag.hoverPort = targetPort;

        updatePortDragVisual();

        return;

    }

    if(smartCanvasState.interaction.selection){

        e.preventDefault();

        updateSelectionBox(e);

        return;

    }

if(smartCanvasState.interaction.resize){
        const node = ctx.nodes().find(item => item.id === smartCanvasState.interaction.resize.id);
        if(!node) return;
        const dx = (e.clientX - smartCanvasState.interaction.resize.startX) / viewport.scale;
        const dy = (e.clientY - smartCanvasState.interaction.resize.startY) / viewport.scale;
        const minW = 48;
        const minH = 48;
        if(smartCanvasState.interaction.resize.aspectRatio > 0){
            const ratio = smartCanvasState.interaction.resize.aspectRatio;
            const useWidth = Math.abs(dx / Math.max(1, smartCanvasState.interaction.resize.startW)) >= Math.abs(dy / Math.max(1, smartCanvasState.interaction.resize.startH));
            const desiredW = useWidth ? smartCanvasState.interaction.resize.startW + dx : (smartCanvasState.interaction.resize.startH + dy) * ratio;
            const lockedMinW = Math.max(minW, minH * ratio);
            node.w = Math.max(lockedMinW, Math.round(desiredW));
            node.h = Math.max(minH, Math.round(node.w / ratio));
        } else {
            node.w = Math.max(minW, Math.round(smartCanvasState.interaction.resize.startW + dx));
            node.h = Math.max(minH, Math.round(smartCanvasState.interaction.resize.startH + dy));
        }
        node.scale = 1;
        updateNodeElementDuringResize(node);
        return;
    }

    if(smartCanvasState.interaction.thumbDrag){

        const dx = e.clientX - smartCanvasState.interaction.thumbDrag.startX;

        const dy = e.clientY - smartCanvasState.interaction.thumbDrag.startY;

        const source = ctx.nodes().find(n => n.id === smartCanvasState.interaction.thumbDrag.nodeId);

        if(!smartCanvasState.interaction.thumbDrag.detached && Math.abs(dx) + Math.abs(dy) > 6){

            if(source){

                clearImageClickTimer();

                ctx.setSuppressImageClickUntil( Date.now() + 260);

                // Preserve an existing multi-selection when dragging from a multi-image thumbnail.
                const dragSelectionIds = selectedNodeIds();
                const preserveMultiSelection = dragSelectionIds.length > 1 && dragSelectionIds.includes(source.id);
                if(!preserveMultiSelection){
                    selectedId = source.id;
                    selectedIds = [];
                    selectedImage = {nodeId:'', index:-1};
                }

                startSmartNodeDrag(source, e, {startX:smartCanvasState.interaction.thumbDrag.startX, startY:smartCanvasState.interaction.thumbDrag.startY, ctrlGroup:false});

            }

            smartCanvasState.endInteraction('thumbDrag', {source:'thumbnail-detach'});

        }

        if(smartCanvasState.interaction.thumbDrag) return;

    }

    if(smartCanvasState.interaction.pan){

        const dx = e.clientX - smartCanvasState.interaction.pan.startX;

        const dy = e.clientY - smartCanvasState.interaction.pan.startY;

        const distance = Math.hypot(dx, dy);

        if(smartCanvasState.interaction.pan.source === 'left' && !smartCanvasState.interaction.pan.moved && distance <= 5) return;

        if(distance > 0){ smartCanvasState.interaction.pan.moved = true; smartCanvasState.interaction.didPan = true; }

        viewport.x = smartCanvasState.interaction.pan.ox + dx;

        viewport.y = smartCanvasState.interaction.pan.oy + dy;

        applyViewport();

        return;

    }

    if(!smartCanvasState.interaction.drag) return;

    const node = smartCanvasState.interaction.drag.nodeMap?.get(smartCanvasState.interaction.drag.id) || ctx.nodes().find(n => n.id === smartCanvasState.interaction.drag.id);

    if(!node) return;

    const rawMoveDx = (e.clientX - smartCanvasState.interaction.drag.startX) / viewport.scale;

    const rawMoveDy = (e.clientY - smartCanvasState.interaction.drag.startY) / viewport.scale;

    const snappedMove = smartNodeDragSnapOffset(smartCanvasState.interaction.drag, rawMoveDx, rawMoveDy);
    const moveDx = snappedMove.dx;
    const moveDy = snappedMove.dy;

    (smartCanvasState.interaction.drag.group || [{id:smartCanvasState.interaction.drag.id, ox:smartCanvasState.interaction.drag.ox, oy:smartCanvasState.interaction.drag.oy}]).forEach(item => {

        const n = smartCanvasState.interaction.drag.nodeMap?.get(item.id) || ctx.nodes().find(x => x.id === item.id);

        if(!n) return;

        n.x = item.ox + moveDx;

        n.y = item.oy + moveDy;

    });

    if(ctx.assetLibraryOpen()){

        const hit = document.elementFromPoint(e.clientX, e.clientY);

        if(hit && assetPanel?.contains(hit)){

            setAssetDragOver(true);

            clearDropHighlight();
            clearSmartNodeSnapGuides();

            return;

        }

        setAssetDragOver(false);

    }

    const draggedRect = nodeRect(node);

    const rawTarget = smartCanvasState.interaction.drag.ctrlGroup
        ? rectOverlapNode(node.id, draggedRect.x, draggedRect.y, draggedRect.width, draggedRect.height, smartCanvasState.interaction.drag.groupIds)
        : null;

    const target = rawTarget;

    setDropHighlight(target?.id || '');

    moveNodeElementsDuringDrag();

};

window.onmouseup = e => {

    document.body.classList.remove('smart-node-drag');

    document.body.classList.remove('smart-node-resize');

    if(smartCanvasState.interaction.portDrag){

        const drag = smartCanvasState.interaction.portDrag;

        smartCanvasState.endInteraction('portDrag', {source:'port-finish'});

        shell.classList.remove('port-dragging');

        clearPortDragVisual();

        handlePortDrop(drag, e);

        return;

    }

    if(smartCanvasState.interaction.selection) finishSelection(e);

    if(smartCanvasState.interaction.resize){

        const node = ctx.nodes().find(n => n.id === smartCanvasState.interaction.resize.id);

        const rect = node ? nodeRect(node) : null;

        const changed = rect && (Math.abs(rect.width - smartCanvasState.interaction.resize.startW) > 1 || Math.abs(rect.height - smartCanvasState.interaction.resize.startH) > 1);

        if(changed){

            commitPendingUndo();

        } else { discardPendingUndo(); }

        smartCanvasState.endInteraction('resize', {source:'resize-finish'});

        if(changed) render();

        scheduleSave();

    }

    if(smartCanvasState.interaction.thumbDrag){

        if(!smartCanvasState.interaction.thumbDrag.detached) discardPendingUndo();

        smartCanvasState.endInteraction('thumbDrag', {source:'thumbnail-finish'});

    }

    if(smartCanvasState.interaction.pan) {

        smartCanvasState.endInteraction('pan', {source:'pan-finish'});

        shell.classList.remove('panning');

        scheduleSave();

        setTimeout(() => { smartCanvasState.interaction.didPan = false; }, 0);

    }

    if(smartCanvasState.interaction.minimapDrag){

        smartCanvasState.endInteraction('minimap', {source:'minimap-finish'});

    }

    if(smartCanvasState.interaction.drag){

        const draggedNode = ctx.nodes().find(n => n.id === smartCanvasState.interaction.drag.id);

        let stateChanged = false;

        const hit = document.elementFromPoint(e.clientX, e.clientY);

        const droppedOnAssetPanel = ctx.assetLibraryOpen() && hit && assetPanel?.contains(hit);

        if(droppedOnAssetPanel && draggedNode && (draggedNode.images || []).length){

            const imagesToSave = (draggedNode.images || []).filter(img => img?.url);

            imagesToSave.forEach(img => addUrlToAssetLibrary(img.url, img.name || draggedNode.title || 'image'));

            (smartCanvasState.interaction.drag.group || [{id:smartCanvasState.interaction.drag.id, ox:smartCanvasState.interaction.drag.ox, oy:smartCanvasState.interaction.drag.oy}]).forEach(item => {

                const n = ctx.nodes().find(x => x.id === item.id);

                if(n){ n.x = item.ox; n.y = item.oy; }

            });

            setAssetDragOver(false);

            discardPendingUndo();

            clearDropHighlight();
            clearSmartNodeSnapGuides();

            smartCanvasState.endInteraction('drag', {source:'drag-cancelled-drop'});

            document.body.classList.remove('smart-node-drag');

            render();

            scheduleSave();

            return;

        }

        const autoTarget = draggedNode && smartCanvasState.interaction.drag.ctrlGroup ? dragConnectTargetFor(draggedNode, screenToWorld(e)) : null;

        const draggedRect = draggedNode ? nodeRect(draggedNode) : null;

        const groupTarget = draggedNode && (draggedNode.images || []).length && (smartCanvasState.interaction.drag.group || []).length <= 1 && draggedRect

            ? rectOverlapNode(draggedNode.id, draggedRect.x, draggedRect.y, draggedRect.width, draggedRect.height, smartCanvasState.interaction.drag.groupIds)

            : null;

        if(
            groupTarget &&

            smartCanvasState.interaction.drag.ctrlGroup &&

            (groupTarget.images || []).length > 1 &&

            mergeImageNodesIntoGroup(draggedNode.id, groupTarget.id)

        ){

            stateChanged = true;

            render();

        } else if(

            draggedNode &&

            autoTarget &&

            smartCanvasState.interaction.drag.ctrlGroup &&

            (smartCanvasState.interaction.drag.group || []).length <= 1 &&

            canAutoConnectDraggedNode(draggedNode, autoTarget) &&

            connectInputNode(draggedNode.id, autoTarget.id)

        ){

            stateChanged = true;

            restoreDraggedNodePosition();

            if(selectedId === draggedNode.id) selectedId = '';

            render();

        } else if(draggedNode && (draggedNode.images || []).length && (smartCanvasState.interaction.drag.group || []).length <= 1){

            const r = nodeRect(draggedNode);

            const target = rectOverlapNode(draggedNode.id, r.x, r.y, r.width, r.height, smartCanvasState.interaction.drag.groupIds);

            if(target && smartCanvasState.interaction.drag.ctrlGroup && canAutoConnectDraggedNode(draggedNode, target)){

                stateChanged = true;

                connectInputNode(draggedNode.id, target.id);

                if(!smartCanvasState.interaction.drag.thumbDetached) restoreDraggedNodePosition();

                if(selectedId === draggedNode.id) selectedId = '';

                render();

            } else if((smartCanvasState.interaction.drag.group || []).some(item => {

                const n = ctx.nodes().find(x => x.id === item.id);

                return n && (Math.abs((Number(n.x) || 0) - item.ox) > 1 || Math.abs((Number(n.y) || 0) - item.oy) > 1);

            })){

                stateChanged = true;

            }

        } else if((smartCanvasState.interaction.drag.group || []).some(item => {

            const n = ctx.nodes().find(x => x.id === item.id);

            return n && (Math.abs((Number(n.x) || 0) - item.ox) > 1 || Math.abs((Number(n.y) || 0) - item.oy) > 1);

        }) || (draggedNode && (Math.abs((draggedNode.x || 0) - smartCanvasState.interaction.drag.ox) > 1 || Math.abs((draggedNode.y || 0) - smartCanvasState.interaction.drag.oy) > 1))){

            stateChanged = true;

        }

        if(smartCanvasState.interaction.drag.thumbDetached) stateChanged = true;

        if(stateChanged) commitPendingUndo();

        else discardPendingUndo();

        if(stateChanged || smartCanvasState.interaction.drag.thumbDetached) ctx.setSuppressNodeClickUntil( Date.now() + 180);

        clearDropHighlight();
        clearSmartNodeSnapGuides();

        smartCanvasState.endInteraction('drag', {source:'drag-finish'});

        if(stateChanged){
            scheduleSave();
            scheduleConnectionLayerRefresh();
        }

    }

};

    return {
        ensurePortDragPathElement,
        clearPortDragVisual,
        updatePortDragVisual,
        handlePortDrop,
        pickMediaForSmartNode,
        pickReferenceImagesForSmartNode,
        pickSingleReferenceImageForSmartNode,
        beginSmartThumbnailDrag,
        resetSmartNodeAspect,
        beginSmartNodeResize,
        beginSmartNodeDrag,
        beginSmartPortDrag,
        handleSmartNodeDrop,
        updateSelectionBox,
        finishSelection,
        startBlankSelection,
        shouldBlockMiddlePan,
        startMiddlePan,
        closeCreateMenu,
        smartExternalDropCount,
        clearSmartExternalDropPreview,
        setSmartNodeDropPreview,
        updateSmartExternalDragPreview,
        renderCanvasCommandMenu,
        downloadSelectedNodeMedia,
        runCanvasCommand,
        closeCanvasMigrationPicker,
        openCanvasMigrationPicker,
        openCreateMenu,
        SmartCanvasCommands: SMART_CANVAS_COMMANDS
    };

}
