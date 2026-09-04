/*
 * smart-canvas-connections-domain.js — 连线/合并域（Phase 2 P2.9，自 smart-canvas.js 迁入）。
 *
 * ES module 工厂 `createConnectionsDomain(ctx)`；可变共享状态经 ctx 访问器读写，
 * window 别名与 window 挂载名裸引用直达。DOM 结构与类名零漂移，函数体逐行保留
 * （仅可变绑定读写经 AST 引导精确改写为访问器调用）。
 * 域内包含：素材收件箱（localStorage 暂存粘贴）、Alt 拖拽复制、连线选择作用域、
 * 连线渲染与图层刷新、拖拽/缩放期间的节点 DOM 移动器、Ctrl 合并/分组/解组。
 */
export function createConnectionsDomain(ctx) {

    const {
        MEDIA_NODE_DEFAULT_SCALE,
        applyFixedSmartImageNodeSize,
        applyThumbDisplaySizeToElement,
        assetNodeImageFromItem,
        clearDetachedRunInputRefs,
        cloneSmartNode,
        createImageNodeAt,
        executeSmartCanvasCommand,
        imageLayout,
        inheritNodeMetaFromImage,
        isHistoryGroupNode,
        isNodeSelected,
        isSmartImageNode,
        nodeRect,
        nodeScale,
        positionComposerForNode,
        primarySelectedNode,
        render,
        scheduleCanvasLayerRefresh,
        scheduleSave,
        selectedNode,
        selectedNodeIds,
        setSmartSelectionState,
        smartCanvasConnectionRenderer,
        smartCanvasNodeRenderer,
        smartCanvasState,
        smartNodeHasFailedTask,
        smartNodeInFlight,
        stripImageGenerationMeta,
        thumbDisplaySize,
        toast,
        uid,
        viewportCenter,
        world
    } = ctx;

const SMART_CANVAS_ASSET_INBOX_KEY = 'smart_canvas_asset_inbox';

function readAssetInbox(){

    try {

        const data = JSON.parse(localStorage.getItem(SMART_CANVAS_ASSET_INBOX_KEY) || 'null');

        const items = Array.isArray(data?.items) ? data.items.filter(it => it && it.url) : [];

        if(!items.length) return null;

        if(data.ts && (Date.now() - Number(data.ts)) > 30 * 60 * 1000) return null; // 30 分钟内有效

        return items;

    } catch(e){ return null; }

}

function pasteAssetsFromInbox(){

    const items = readAssetInbox();

    if(!items) return false;

    const center = ctx.lastMouseWorld() || viewportCenter();

    const cell = 260; // 网格间距（世界坐标）

    const cols = Math.max(1, Math.min(items.length, Math.ceil(Math.sqrt(items.length))));

    const rows = Math.ceil(items.length / cols);

    const startX = center.x - (cols - 1) * cell / 2;

    const startY = center.y - (rows - 1) * cell / 2;

    const changed = executeSmartCanvasCommand('paste-assets-from-inbox', () => {

        const created = [];

        items.forEach((it, i) => {

            const r = Math.floor(i / cols), c = i % cols;

            const p = {x: startX + c * cell, y: startY + r * cell};

            const node = createImageNodeAt(p, [assetNodeImageFromItem(it)], {skipUndo:true, select:false});

            if(node) created.push(node.id);

        });

        selectedId = created.length === 1 ? created[0] : '';

        selectedIds = created.length > 1 ? created : [];

        selectedImage = {nodeId:'', index:-1};

        ctx.setLastNodePasteAt(Date.now());

        try { localStorage.removeItem(SMART_CANVAS_ASSET_INBOX_KEY); } catch(e){}

        return created.length;

    });

    toast(`已粘贴 ${changed || 0} 个素材到画布`);

    return changed !== false;

}

function duplicateForAltDrag(node, preserveConnections=false, options={}){

    const ids = (isNodeSelected(node.id) ? selectedNodeIds() : [node.id]);

    const sourceNodes = ids.map(id => ctx.nodes().find(n => n.id === id)).filter(Boolean);

    if(!sourceNodes.length) return node;

    const idMap = new Map();

    const copies = sourceNodes.map(n => {

        const copy = cloneSmartNode(n, Number(options.offsetX) || 0, Number(options.offsetY) || 0);

        idMap.set(n.id, copy.id);

        return copy;

    });

    copies.forEach(copy => {

        if(Array.isArray(copy.inputNodeIds)){

            copy.inputNodeIds = preserveConnections

                ? copy.inputNodeIds.map(id => idMap.get(id) || id).filter(Boolean)

                : [];

        }

        if(copy.sourceNodeId) copy.sourceNodeId = preserveConnections ? (idMap.get(copy.sourceNodeId) || copy.sourceNodeId) : '';

    });

    if(preserveConnections){

        const idSet = new Set(sourceNodes.map(n => n.id));

        const newConnections = (ctx.canvas().connections || [])

            .filter(conn => idSet.has(conn.to))

            .map(conn => ({...conn, from:idMap.get(conn.from) || conn.from, to:idMap.get(conn.to) || conn.to}))

            .filter(conn => conn.from && conn.to && conn.from !== conn.to);

        const nextConnections = [...(ctx.canvas().connections || [])];

        newConnections.forEach(conn => {

            const kind = conn.kind || 'flow';

            if(nextConnections.some(c => c.from === conn.from && c.to === conn.to && (c.kind || 'flow') === kind)) return;

            nextConnections.push(conn);

            const toNode = ctx.nodes().find(n => n.id === conn.to) || copies.find(n => n.id === conn.to);

            if(toNode && (conn.kind || 'flow') === 'input'){

                toNode.inputNodeIds = Array.from(new Set([...(toNode.inputNodeIds || []), conn.from]));

            }

        });

        ctx.canvas().connections = nextConnections;

    }

    ctx.nodes().push(...copies);

    selectedId = '';

    selectedIds = [];

    selectedImage = {nodeId:'', index:-1};

    const dragCopy = copies.find(c => c.id === idMap.get(node.id)) || copies[0];

    if(!options.skipRender) render();

    if(!options.skipSave) scheduleSave();

    return dragCopy;

}

function refreshSelectedConnectionScope(){
    const roots = selectedNodeIds();
    if(!roots.length){
        ctx.setSmartSelectedConnectionScopeIds(new Set());
        ctx.setSmartSelectedUpstreamIds(new Set());
        ctx.setSmartSelectedDownstreamIds(new Set());
        return ctx.smartSelectedConnectionScopeIds();
    }

    const rootSet = new Set(roots);
    const incoming = new Map();
    const outgoing = new Map();
    (ctx.canvas()?.connections || []).forEach(conn => {
        const kind = conn.kind || 'flow';
        if(kind === 'history' || !conn.from || !conn.to || conn.from === conn.to) return;
        if(!incoming.has(conn.to)) incoming.set(conn.to, new Set());
        if(!outgoing.has(conn.from)) outgoing.set(conn.from, new Set());
        incoming.get(conn.to).add(conn.from);
        outgoing.get(conn.from).add(conn.to);
    });

    const walk = adjacency => {
        const result = new Set();
        const seen = new Set(roots);
        const queue = roots.slice();
        while(queue.length){
            const id = queue.shift();
            (adjacency.get(id) || []).forEach(next => {
                if(seen.has(next)) return;
                seen.add(next);
                result.add(next);
                queue.push(next);
            });
        }
        rootSet.forEach(id => result.delete(id));
        return result;
    };

    ctx.setSmartSelectedUpstreamIds(walk(incoming));
    const selectedRootsAreUpstream = roots.every(id => !(incoming.get(id)?.size));
    ctx.setSmartSelectedDownstreamIds(selectedRootsAreUpstream ? new Set() : walk(outgoing));
    ctx.setSmartSelectedConnectionScopeIds(new Set([...roots, ...ctx.smartSelectedUpstreamIds(), ...ctx.smartSelectedDownstreamIds()]));
    return ctx.smartSelectedConnectionScopeIds();
}

function smartConnectionSelectionClasses(item){
    const roots = new Set(selectedNodeIds());
    if(!roots.size || !ctx.smartSelectedConnectionScopeIds().size || item.kind === 'history') return [];
    const targets = new Set([item.toId, ...(item.targets || [])].filter(Boolean));
    const itemIds = new Set([item.from, ...targets].filter(Boolean));
    const related = [...itemIds].some(id => ctx.smartSelectedConnectionScopeIds().has(id));
    if(!related) return ['conn-unrelated'];

    const touchesSelected = roots.has(item.from) || [...targets].some(id => roots.has(id));
    const upstream = ctx.smartSelectedUpstreamIds().has(item.from)
        && [...targets].some(id => ctx.smartSelectedUpstreamIds().has(id) || roots.has(id));
    const downstream = (roots.has(item.from) || ctx.smartSelectedDownstreamIds().has(item.from))
        && [...targets].some(id => ctx.smartSelectedDownstreamIds().has(id));
    const classes = ['conn-related'];
    if(touchesSelected) classes.push('conn-selected');
    if(upstream && downstream) classes.push('conn-context-bridge');
    else if(upstream) classes.push('conn-context-upstream');
    else if(downstream) classes.push('conn-context-downstream');
    return classes;
}

function smartConnectionRenderItems(){
    const nodeMap = new Map(ctx.nodes().map(node => [node.id, node]));
    const items = window.SmartCanvasConnectionPrimitives?.buildRenderItems
        ? SmartCanvasConnectionPrimitives.buildRenderItems(ctx.canvas()?.connections || [], {nodeMap}).items
        : [];
    return {nodeMap, items};
}

function smartConnectionItemKey(item){
    return encodeURIComponent([item.from, item.toId, item.kind, (item.indices || []).join(',')].join('\u001f'));
}

function smartConnectionItemMarkup(item, nodeMap){
    const fromNode = nodeMap.get(item.from);
    const toNode = nodeMap.get(item.toId);
    if(!fromNode || !toNode) return '';
    const fr = nodeRect(fromNode), tr = nodeRect(toNode);
    const kind = item.kind;
    const isHistory = kind === 'history';
    const isPendingLine = item.targets.some(target => smartNodeInFlight(nodeMap.get(target)));
    const isRunningLine = smartNodeInFlight(fromNode) || item.targets.some(target => smartNodeInFlight(nodeMap.get(target)));
    const isFailedLine = smartNodeHasFailedTask(fromNode) || item.targets.some(target => smartNodeHasFailedTask(nodeMap.get(target)));
    const curveData = window.SmartCanvasConnectionPrimitives?.curveFor
        ? SmartCanvasConnectionPrimitives.curveFor(fr, tr, kind)
        : {fx:isHistory ? fr.x + fr.width / 2 : fr.x + fr.width, fy:isHistory ? fr.y + fr.height : fr.y + fr.height / 2, tx:isHistory ? tr.x + tr.width / 2 : tr.x, ty:isHistory ? tr.y : tr.y + tr.height / 2};
    const {fx, fy, tx, ty} = curveData;
    const dx = Math.max(50, Math.abs(tx - fx) * .45);
    const dy = Math.max(36, Math.abs(ty - fy) * .45);
    const curve = curveData.curve || (isHistory
        ? `M${fx} ${fy} C ${fx} ${fy+dy}, ${tx} ${ty-dy}, ${tx} ${ty}`
        : `M${fx} ${fy} C ${fx+dx} ${fy}, ${tx-dx} ${ty}, ${tx} ${ty}`);
    const selectionClasses = smartConnectionSelectionClasses(item);
    const cls = [
        isPendingLine ? 'conn-pending' : '', isRunningLine ? 'conn-running' : '',
        isFailedLine ? 'conn-failed' : '', isHistory ? 'conn-history' : '',
        ...selectionClasses
    ].filter(Boolean).join(' ');
    const energyContextClass = selectionClasses.find(name => name.startsWith('conn-context-')) || '';
    const color = isHistory ? 'rgba(132,143,151,.42)' : kind === 'input' ? 'rgba(142,154,164,.54)' : 'rgba(164,174,183,.56)';
    const opacity = isFailedLine ? '.66' : isPendingLine ? '.82' : '1';
    const energyMarkup = isRunningLine && !isFailedLine
        ? `<path class="conn-energy-tail ${energyContextClass}" d="${curve}" fill="none" vector-effect="non-scaling-stroke"></path><path class="conn-energy-head ${energyContextClass}" d="${curve}" fill="none" vector-effect="non-scaling-stroke"></path>`
        : '';
    return `<path class="${cls}" d="${curve}" stroke="${color}" stroke-width="4.4" fill="none" opacity="${opacity}" vector-effect="non-scaling-stroke"></path>${energyMarkup}`;
}

function smartConnectionItemInvolves(item, nodeIds){
    return nodeIds.has(item.from) || nodeIds.has(item.toId) || item.targets.some(target => nodeIds.has(target));
}

function renderConnections(){
    const {nodeMap, items} = smartConnectionRenderItems();
    const paths = items.map(item => {
        const markup = smartConnectionItemMarkup(item, nodeMap);
        return markup ? `<g data-smart-connection-key="${smartConnectionItemKey(item)}">${markup}</g>` : '';
    }).join('');
    return `<svg class="connection-layer" width="6000" height="4000" viewBox="0 0 6000 4000" xmlns="http://www.w3.org/2000/svg">${paths}</svg>`;
}

function refreshConnectionLayer(options={}){
    const layer = world.querySelector(':scope > svg.connection-layer');
    const nodeIds = options.nodeIds instanceof Set ? options.nodeIds : new Set(options.nodeIds || []);
    if(!layer){
        smartCanvasConnectionRenderer.mount(renderConnections());
        return;
    }
    const {nodeMap, items} = smartConnectionRenderItems();
    const existing = new Map();
    layer.querySelectorAll(':scope > [data-smart-connection-key]').forEach(group => existing.set(group.dataset.smartConnectionKey, group));
    if(existing.size !== items.length || items.some(item => !existing.has(smartConnectionItemKey(item)))){
        smartCanvasConnectionRenderer.mount(renderConnections());
        return;
    }
    const refreshAll = !nodeIds.size;
    items.forEach(item => {
        if(!refreshAll && !smartConnectionItemInvolves(item, nodeIds)) return;
        const group = existing.get(smartConnectionItemKey(item));
        if(group) group.innerHTML = smartConnectionItemMarkup(item, nodeMap);
    });
}

function scheduleConnectionLayerRefresh(){

    scheduleCanvasLayerRefresh({connections:true});

}

function scheduleInteractionLayerRefresh(connectionNodeIds=null){
    scheduleCanvasLayerRefresh({connections:true, minimap:true, connectionNodeIds});
}

function moveNodeElementsDuringDrag(){

    if(!smartCanvasState.interaction.drag) return;

    const groupItems = smartCanvasState.interaction.drag.group || [{id:smartCanvasState.interaction.drag.id}];

    groupItems.map(item => item.id).forEach(id => {

        const n = smartCanvasState.interaction.drag.nodeMap?.get(id) || ctx.nodes().find(x => x.id === id);

        let el = smartCanvasState.interaction.drag.elementMap?.get(id);

        if(!el?.isConnected || el.parentElement !== world){
            el = world.querySelector(`.image-node[data-id="${CSS.escape(id)}"]`);
            if(el) smartCanvasState.interaction.drag.elementMap?.set(id, el);
        }

        if(n && el){

            el.style.left = `${n.x || 0}px`;

            el.style.top = `${n.y || 0}px`;

        }

    });

    // Box selection keeps selectedId empty; the composer follows the primary item in selectedIds.

    const active = primarySelectedNode();

    if(active && (smartCanvasState.interaction.drag.group || [{id:smartCanvasState.interaction.drag.id}]).some(item => item.id === active.id)){

        positionComposerForNode(active);

    }
    const movedIds = groupItems.map(item => item.id);
    // Direct drag writes bypass the renderer's HTML cache. Invalidate the moved
    // entries so cancel/undo or an async running-state render cannot retain stale DOM.
    smartCanvasNodeRenderer.invalidate(movedIds);
    scheduleInteractionLayerRefresh(movedIds);

}

function updateNodeElementDuringResize(node){

    if(!node) return;

    const el = smartCanvasState.interaction.resize?.elementMap?.get(node.id)

        || smartCanvasState.interaction.drag?.elementMap?.get(node.id)

        || world.querySelector(`.image-node[data-id="${CSS.escape(node.id)}"]`);

    if(!el){

        render();

        return;

    }

    const imgs = node.images || [];

    const layout = imageLayout(imgs, nodeScale(node), node);

    el.style.width = `${layout.width}px`;

    el.style.height = `${layout.height}px`;

    const body = el.querySelector('.node-body');

    if(body){

        const loadingSingle = body.querySelector('.loading-cell.single');

        if(loadingSingle){

            loadingSingle.style.width = `${layout.width}px`;

            loadingSingle.style.height = `${layout.height}px`;

        }

        const loadingGrid = body.querySelector('.loading-skeleton');

        if(loadingGrid){

            const count = Math.max(1, Number(node.pending) || 1);

            const cols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(count))));

            const rows = Math.ceil(count / cols);

            loadingGrid.style.width = `${layout.width}px`;

            loadingGrid.style.height = `${layout.height}px`;

            loadingGrid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;

            loadingGrid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;

        }
        const grid = body.querySelector('.thumb-grid');

        if(grid){

            grid.style.setProperty('--thumb-size', `${layout.thumb}px`);

            grid.style.setProperty('--thumb-overlap', `${Number(layout.overlap || 0)}px`);

            grid.classList.toggle('is-overlap', Boolean(layout.stacked || Number(layout.overlap) > 0));

            grid.querySelectorAll('.thumb-item').forEach((itemEl, index) => {

                applyThumbDisplaySizeToElement(itemEl, imgs[index], layout.thumb);

            });

        }

        const wrap = body.querySelector('.image-wrap');

        if(wrap){

            // 分组单图卡片含 16px 内边距（PAD=32），图片按内边距内的尺寸显示，避免溢出边框。

            const wrapW = layout.width;

            const wrapH = layout.height;

            wrap.style.setProperty('--node-img-w', `${wrapW}px`);

            wrap.style.setProperty('--node-img-h', `${wrapH}px`);

        }

        const media = body.querySelector('.node-img');

        if(media){

            const mediaW = layout.width;

            const mediaH = layout.height;

            media.style.width = `${mediaW}px`;

            media.style.height = `${mediaH}px`;

        }

    }

    const active = selectedNode();

    if(active?.id === node.id) positionComposerForNode(active);
    scheduleInteractionLayerRefresh([node.id]);

}

function mergeImageNodesIntoGroup(sourceId, targetId){

    const source = ctx.nodes().find(n => n.id === sourceId);

    const target = ctx.nodes().find(n => n.id === targetId);

    if(!source || !target || source.id === target.id) return false;

    if(!(source.images || []).length || !(target.images || []).length) return false;

    const targetRect = nodeRect(target);

    const sourceImages = (source.images || []).map(img => stripImageGenerationMeta({...img}));

    target.images = [...(target.images || []).map(img => stripImageGenerationMeta(img)), ...sourceImages];

    target.title = 'Group';

    applyFixedSmartImageNodeSize(target, targetRect);

    ctx.canvas().connections = (ctx.canvas().connections || []).map(c => {

        if(c.from === source.id) return {...c, from:target.id};

        if(c.to === source.id) return {...c, to:target.id};

        return c;

    }).filter((c, index, arr) => c.from !== c.to && arr.findIndex(x => x.from === c.from && x.to === c.to && (x.kind || 'flow') === (c.kind || 'flow')) === index);

    ctx.nodes().forEach(node => {

        if(Array.isArray(node.inputNodeIds)){

            node.inputNodeIds = Array.from(new Set(node.inputNodeIds.map(id => id === source.id ? target.id : id).filter(id => id !== node.id)));

        }

    });

    ctx.setNodes(ctx.nodes().filter(n => n.id !== source.id));

    selectedIds = [];

    selectedId = target.id;

    selectedImage = {nodeId:'', index:-1};

    return true;

}

function isSelectableSmartImageGroupMember(node){

    return Boolean(isSmartImageNode(node) && !isHistoryGroupNode(node) && Array.isArray(node.images) && node.images.length);

}

function groupSelectedNodes(){

    const selected = selectedNodeIds().map(id => ctx.nodes().find(node => node.id === id)).filter(Boolean);

    if(selected.length < 2 || selected.some(node => !isSelectableSmartImageGroupMember(node))){

        toast('请选择至少两个有图片的节点');

        return false;

    }

    const target = selected.find(node => node.id === selectedId) || selected[0];

    const changed = executeSmartCanvasCommand('group-selected-nodes', () => {

        selected.filter(node => node.id !== target.id).forEach(source => {

            const liveSource = ctx.nodes().find(node => node.id === source.id);

            if(liveSource) mergeImageNodesIntoGroup(liveSource.id, target.id);

        });

        setSmartSelectionState({primaryId:target.id, ids:[], image:{nodeId:'', index:-1}}, {source:'group-selected-nodes'});

        return true;

    });

    if(changed) toast(`已组合 ${selected.length} 个图片节点`);

    return Boolean(changed);

}

function ungroupNode(groupId){

    const group = ctx.nodes().find(node => node.id === groupId);

    if(!isSelectableSmartImageGroupMember(group) || group.images.length < 2) return false;

    return executeSmartCanvasCommand('ungroup-node', () => {

        const layout = imageLayout(group.images, nodeScale(group), group);

        const pad = 16;

        const gap = 8;

        const cell = Math.max(28, Math.round(layout.thumb || 96));

        const cols = Math.max(1, layout.cols || 1);

        const created = group.images.map((image, index) => {

            const col = index % cols;

            const row = Math.floor(index / cols);

            const size = thumbDisplaySize(image, cell);

            const node = {

                id:uid('smart'),

                type:'smart-image',

                x:Math.round(Number(group.x || 0) + pad + col * (cell + gap) + Math.max(0, (cell - size.width) / 2)),

                y:Math.round(Number(group.y || 0) + pad + row * (cell + gap) + Math.max(0, (cell - size.height) / 2)),

                w:size.width,

                h:size.height,

                title:'Image',

                images:[stripImageGenerationMeta({...image})],

                scale:MEDIA_NODE_DEFAULT_SCALE,

                created_at:Date.now(),

            };

            applyFixedSmartImageNodeSize(node, {width:size.width, height:size.height});

            inheritNodeMetaFromImage(node);

            clearDetachedRunInputRefs(node);

            return node;

        });

        ctx.setNodes(ctx.nodes().filter(node => node.id !== group.id));

        ctx.nodes().push(...created);

        if(ctx.canvas()) ctx.canvas().connections = (ctx.canvas().connections || []).filter(connection => connection.from !== group.id && connection.to !== group.id);

        ctx.nodes().forEach(node => {

            if(Array.isArray(node.inputNodeIds)) node.inputNodeIds = node.inputNodeIds.filter(id => id !== group.id);

        });

        setSmartSelectionState({primaryId:'', ids:created.map(node => node.id), image:{nodeId:'', index:-1}}, {source:'ungroup-node'});

        toast(`已解散图片组，恢复 ${created.length} 个节点`);

        return true;

    });

}

    return {
        pasteAssetsFromInbox,
        duplicateForAltDrag,
        refreshSelectedConnectionScope,
        renderConnections,
        refreshConnectionLayer,
        scheduleConnectionLayerRefresh,
        moveNodeElementsDuringDrag,
        updateNodeElementDuringResize,
        mergeImageNodesIntoGroup,
        isSelectableSmartImageGroupMember,
        groupSelectedNodes,
        ungroupNode
    };

}
