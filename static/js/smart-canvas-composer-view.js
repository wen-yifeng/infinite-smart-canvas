/*
 * smart-canvas-composer-view.js — Composer 域（Phase 2 P2.2，自 smart-canvas.js 迁入）。
 *
 * 职责：提示词草稿与编辑工具、updateComposer 编排、输入缩略图条（渲染/滚动/拖拽重排）。
 * 主文件经 createComposerView(ctx) 注入 DOM 元素、稳定函数与可变状态访问器；
 * 函数体逐行迁入，DOM 结构与类名零漂移，交互语义不变。
 */
export function createComposerView(ctx) {

    const {
        escapeHtml,
        tr,
        refreshIcons,
        activeComposerNode,
        bindSmartPreviewImageFallbacks,
        cloneSmartSettings,
        closeMentionPicker,
        collectPromptParts,
        composer,
        composerClearPromptBtn,
        composerCopyPromptBtn,
        composerPastePromptBtn,
        deleteImage,
        executeSmartCanvasCommand,
        handleFiles,
        imageNameLabel,
        imageResolutionLabel,
        inputNodesFor,
        inputPromptPreview,
        inputRefKey,
        inputThumbsRow,
        isSelfReferenceForNode,
        isSmartRunnableNode,
        isVideoMediaItem,
        manualReferenceImagesFor,
        mediaKindForFile,
        mediaKindForItem,
        originalPromptTextFromParts,
        pickReferenceImagesForSmartNode,
        primarySelectedNode,
        promptHtmlWithMentionTokens,
        promptInput,
        removeManualReferenceFromSelectedNode,
        scheduleDynamicParamsRefresh,
        selectedNodeIds,
        smartCanvasState,
        smartComposer,
        smartImageMode,
        smartPreviewImgHtml,
        smartSettingsForNode,
        smartVideoPreviewHtml,
        syncComposerDock,
        syncComposerTaskStatusPlacement,
        syncComposerViewportActions,
        syncDownstreamPromptLock,
        syncRunButtonState,
        toast,
        visibleReferenceImagesFor
    } = ctx;

function promptPlainText(){

    return originalPromptTextFromParts(collectPromptParts());

}

function setPromptInputLocked(locked){

    if(smartComposer){ smartComposer.setPromptLocked(locked); return; }

    promptInput.dataset.promptLocked = locked ? '1' : '0';

    promptInput.setAttribute('contenteditable', locked ? 'false' : 'true');

    promptInput.classList.toggle('prompt-input-locked', Boolean(locked));

    if(locked) closeMentionPicker();

}

function setPromptText(text){

    if(smartComposer){ smartComposer.setPromptText(text); return; }

    promptInput.textContent = text || '';

}

function composerPromptActionsEditable(){
    const node = activeComposerNode();
    return Boolean(node && promptInput?.dataset?.promptLocked !== '1');
}

function syncComposerPromptActions(){
    const disabled = !composerPromptActionsEditable();
    [composerCopyPromptBtn, composerPastePromptBtn, composerClearPromptBtn].filter(Boolean).forEach(button => {
        button.disabled = disabled;
        button.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    });
}

function replaceComposerPromptText(text, commandName){
    const subject = activeComposerNode();
    if(!subject || !composerPromptActionsEditable()) return false;
    const value = String(text ?? '');
    return executeSmartCanvasCommand(commandName, () => {
        setPromptText(value);
        savePromptDraftForCurrent();
        closeMentionPicker();
        return true;
    });
}

function clearPromptInput(options={}){

    if(smartComposer) smartComposer.clearPrompt(options);

    else {

        if(options.preserveDraft) promptInput.dataset.preserveDraftOnce = '1';

        else promptInput.textContent = '';

        closeMentionPicker();

    }

    if(!options.preserveDraft && ctx.activeComposerSubject()){

        ctx.activeComposerSubject().promptDraftHtml = '';

        ctx.activeComposerSubject().promptDraftText = '';

    }

}

function savePromptDraftForCurrent(){

    if(promptInput?.dataset?.promptLocked === '1') return;

    const subject = activeComposerNode();

    if(!subject) return;

    if(promptInput?.dataset?.preserveDraftOnce === '1' && subject.promptDraftHtml){

        delete promptInput.dataset.preserveDraftOnce;

        return;

    }

    subject.promptDraftHtml = promptInput.innerHTML;

    subject.promptDraftText = promptPlainText();

    subject.runSettings = cloneSmartSettings(ctx.settings());

}

function loadPromptDraft(subject){

    if(subject?.promptDraftHtml){

        const hasToken = String(subject.promptDraftHtml || '').includes('mention-image-token');

        promptInput.innerHTML = hasToken

            ? subject.promptDraftHtml

            : (promptHtmlWithMentionTokens(subject.runPrompt || subject.promptDraftText || '', subject.runPromptRefs || []) || subject.promptDraftHtml);

    } else if(typeof subject?.runPrompt === 'string'){

        const rebuilt = promptHtmlWithMentionTokens(subject.runPrompt, subject.runPromptRefs || []);

        if(rebuilt) promptInput.innerHTML = rebuilt;

        else setPromptText(subject.runPrompt);

    } else {

        setPromptText('');

    }

}

function positionComposerForNode(node){

    if(!composer) return;

    composer.dataset.anchorNodeId = node?.id || '';

}

let composerUpdateTimer = 0;

let composerUpdateSeq = 0;

function scheduleComposerUpdate(delay=120){

    if(composerUpdateTimer){

        clearTimeout(composerUpdateTimer);

        composerUpdateTimer = 0;

    }

    const seq = ++composerUpdateSeq;

    composerUpdateTimer = setTimeout(() => {

        composerUpdateTimer = 0;

        if(seq !== composerUpdateSeq) return;

        updateComposer();

    }, Math.max(0, Number(delay) || 0));

}

function updateComposer(){

    if(composerUpdateTimer){

        clearTimeout(composerUpdateTimer);

        composerUpdateTimer = 0;

    }

    composerUpdateSeq++;

    const selected = primarySelectedNode();
    const hasVisualSelection = selectedNodeIds().length > 0;
    // A blank-ctx.canvas() click clears only the visual selection. Keep the Composer bound
    // to the retained runnable target until the user selects a different node or deletes it.
    const node = isSmartRunnableNode(selected)
        ? selected
        : (!hasVisualSelection ? activeComposerNode() : null);

    syncRunButtonState(node);

    composer.classList.toggle('open', Boolean(node) || !smartCanvasState.ui.composerDockCollapsed);

    if(!isSmartRunnableNode(node)){

        savePromptDraftForCurrent();

        if(smartCanvasState.ui.composerDockCollapsed) composer.classList.remove('open');

        ctx.setActiveComposerSubject(null);

        ctx.setLastComposerNodeId('');
        ctx.setDownstreamPromptUnlockedNodeId('');
        setPromptInputLocked(false);
        syncDownstreamPromptLock(null);
        syncComposerPromptActions();
        syncComposerViewportActions();
        syncComposerTaskStatusPlacement();

        if(!node){

            setPromptText('');

            renderInputThumbsRow(null);

            renderInputPromptPreview(null);

        }

        return;

    }

    // composer 只绑定节点本身：图片只是素材/结果，不携带提示词或参数状态。

    const subject = node;
    ctx.setLastComposerRunnableNodeId(node.id);
    const composerKey = `${node.id}:node`;

    const switchedNode = ctx.lastComposerNodeId() !== composerKey;

    if(switchedNode) savePromptDraftForCurrent();

    ctx.setLastComposerNodeId(composerKey);
    ctx.setActiveComposerSubject(subject);

    syncComposerDock();

    if(switchedNode){

        ctx.setSettings(smartSettingsForNode(subject));

        loadPromptDraft(subject);

    }

    setPromptInputLocked(false);
    syncDownstreamPromptLock(subject, {switchedNode});
    syncComposerPromptActions();
    syncComposerViewportActions();
    syncComposerTaskStatusPlacement();

    positionComposerForNode(node);

    renderInputThumbsRow(node);

    renderInputPromptPreview(node);

    scheduleDynamicParamsRefresh(140);

}

function renderInputPromptPreview(node){

    if(!inputPromptPreview) return;

    const text = '';

    inputPromptPreview.classList.toggle('has-text', Boolean(text));

    inputPromptPreview.innerHTML = text

        ? `<div class="input-prompt-preview-label">${escapeHtml(tr('smart.inputUpstream'))}</div><div class="input-prompt-preview-text">${escapeHtml(text)}</div>`

        : '';

}

function buildInputThumbItemHtml(img, i, node, manualRefKeys, manualRefUrls){

        const isVid = isVideoMediaItem(img);

        const kind = mediaKindForItem(img);

        const isSelf = node ? isSelfReferenceForNode(node, img) : false;

        const hoverName = imageNameLabel(img, tr('smart.inputNum').replace('{n}', String(i + 1)));
        const hoverResolution = imageResolutionLabel(img).replace(' x ', ' × ');
        const hoverTitle = [hoverName, hoverResolution].filter(Boolean).join('\n');

        const inner = kind === 'audio'

            ? `<div class="input-thumb-audio"><i data-lucide="file-audio"></i></div>`

            : isVid

            ? smartVideoPreviewHtml(img, 256, 'draggable="false" alt=""')

            : smartPreviewImgHtml(img, 256, 'draggable="false"');

        const label = String(i + 1);

        const sourceUrl = img.originalLocalUrl || img.url || '';

        const key = inputRefKey(img);

        const removableManual = manualRefKeys.has(key) || manualRefUrls.has(img.url);
        const removableSelf = isSelf && Number.isInteger(Number(img.imageIndex));
        const removeKind = removableManual ? 'manual' : removableSelf ? 'self' : '';
        const removeBtn = removeKind
            ? `<button class="input-thumb-remove" type="button" data-input-remove-kind="${removeKind}" data-input-remove-reference="${escapeHtml(key)}" data-input-remove-node="${escapeHtml(node.id)}" data-input-remove-index="${Number(img.imageIndex)}" title="删除素材" aria-label="删除素材">×</button>`
            : '';

        return `<div class="input-thumb ${isSelf ? 'input-self' : ''} ${removableManual ? 'input-manual-ref' : ''}" draggable="false" data-thumb-index="${i}" data-node-id="${escapeHtml(img.nodeId || '')}" data-image-index="${img.imageIndex ?? ''}" data-url="${escapeHtml(img.url || '')}" data-source-url="${escapeHtml(sourceUrl)}" title="${escapeHtml(hoverTitle)}">${inner}<span class="input-thumb-label">${escapeHtml(label)}</span>${removeBtn}</div>`;


}

function buildInputThumbStripHtml(count, addButton, primaryMarker, thumbsHtml){

    const hasOverflowInputItems = count > 3;

    return `<div class="input-thumb-section-label">输入素材</div><div class="input-thumb-strip ${hasOverflowInputItems ? 'has-thumb-navigation' : ''}" data-input-thumb-count="${count}"><div class="input-thumb-scroll-region">${primaryMarker}<button class="input-thumb-nav input-thumb-nav-left" type="button" data-input-thumb-scroll="-1" title="上一张" aria-label="上一张" ${hasOverflowInputItems ? '' : 'hidden'}><i data-lucide="chevron-left"></i></button><div class="input-thumb-list" tabindex="0" data-input-thumb-count="${count}">${thumbsHtml}</div><button class="input-thumb-nav input-thumb-nav-right" type="button" data-input-thumb-scroll="1" title="下一张" aria-label="下一张" ${hasOverflowInputItems ? '' : 'hidden'}><i data-lucide="chevron-right"></i></button></div>${addButton}</div>`;

}

function renderInputThumbsRow(node){

    if(!inputThumbsRow) return;
const dedup = node ? visibleReferenceImagesFor(node) : [];

    const manualReferences = manualReferenceImagesFor(node);
    const manualRefKeys = new Set(manualReferences.map(img => inputRefKey(img)));
    const manualRefUrls = new Set(manualReferences.map(img => img.url).filter(Boolean));
    const selected = selectedNodeIds();
    // The Composer remains bound to its last node after visual deselection.
    const canAddReference = Boolean(node && activeComposerNode()?.id === node.id);
    const showPrimaryMarker = Boolean(node && selected.length > 1 && primarySelectedNode()?.id === node.id);

    // 仅当参考图集合/状态真正变化时才重建缩略图 DOM。否则每敲一个字都重建并重新解码所有图片，

    // 参考图多时会让输入框打字明显卡顿。

    const thumbsSignature = JSON.stringify({

        node: node?.id || '',

        items: dedup.map(img => `${inputRefKey(img)}@${img.url || ''}`),

        manual: [...manualRefKeys],

        canAdd: canAddReference,
        primary: showPrimaryMarker,

        mode: node ? smartImageMode(node) : ''

    });

    if(inputThumbsRow.dataset.thumbsSig === thumbsSignature) return;

    inputThumbsRow.dataset.thumbsSig = thumbsSignature;

    // Each rendered list owns its observer. Disconnect the previous list before replacing its DOM
    // so repeated reference changes do not leave old observers scheduling extra slider sync frames.
    inputThumbsRow.querySelector('.input-thumb-list')?._smartThumbResizeObserver?.disconnect();

    inputThumbsRow.classList.toggle('has-items', Boolean(node));

    if(!node){ inputThumbsRow.innerHTML = ''; return; }

    const addButton = `<div class="input-thumb-add-tray"><button class="input-thumb-add input-thumb-add-card" type="button" data-input-add-reference="${escapeHtml(node.id)}" title="添加素材" aria-label="添加素材" ${canAddReference ? '' : 'disabled aria-disabled="true"'}><i data-lucide="image-plus"></i></button></div>`;
    const primaryMarker = showPrimaryMarker ? '<span class="composer-primary-marker"><i data-lucide="target"></i><span>主节点</span></span>' : '';

    const thumbsHtml = dedup.map((img, i) => buildInputThumbItemHtml(img, i, node, manualRefKeys, manualRefUrls)).join('');

    inputThumbsRow.innerHTML = buildInputThumbStripHtml(dedup.length, addButton, primaryMarker, thumbsHtml);

    bindSmartPreviewImageFallbacks(inputThumbsRow);

    bindInputThumbsDrag(node, dedup, manualRefKeys);

    bindInputThumbReferenceActions();
    bindInputThumbScrollbar();

    refreshIcons();

}

function bindInputThumbScrollbar(){
    const list = inputThumbsRow?.querySelector('.input-thumb-list');
    const buttons = [...(inputThumbsRow?.querySelectorAll('[data-input-thumb-scroll]') || [])];
    if(!list) return;

    let syncFrame = 0;
    let lastScrollDirection = 1;
    let previousScrollLeft = list.scrollLeft;
    const update = () => {
        syncFrame = 0;
        const max = Math.max(0, list.scrollWidth - list.clientWidth);
        const hasMultipleInputItems = Number(list.dataset.inputThumbCount || 0) > 1;
        const atStart = list.scrollLeft <= 2;
        const atEnd = list.scrollLeft >= max - 2;
        const visibleDirection = atStart ? 1 : atEnd ? -1 : lastScrollDirection;
        buttons.forEach(button => {
            const direction = Number(button.dataset.inputThumbScroll || 0);
            button.hidden = !hasMultipleInputItems || max <= 2 || direction !== visibleDirection;
        });
    };
    const queueUpdate = () => {
        if(!syncFrame) syncFrame = requestAnimationFrame(update);
    };
    buttons.forEach(button => button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const direction = Number(button.dataset.inputThumbScroll || 0);
        lastScrollDirection = direction < 0 ? -1 : 1;
        list.focus({preventScroll:true});
        list.scrollBy({left:direction * Math.max(96, list.clientWidth * .72), behavior:'smooth'});
    }));
    list.addEventListener('pointerdown', () => list.focus({preventScroll:true}), {passive:true});
    list.addEventListener('wheel', event => {
        const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
        if(!delta || list.scrollWidth <= list.clientWidth) return;
        event.preventDefault();
        lastScrollDirection = delta < 0 ? -1 : 1;
        list.scrollLeft += delta;
    }, {passive:false});
    list.addEventListener('scroll', () => {
        const movement = list.scrollLeft - previousScrollLeft;
        if(Math.abs(movement) > .5) lastScrollDirection = movement < 0 ? -1 : 1;
        previousScrollLeft = list.scrollLeft;
        queueUpdate();
    }, {passive:true});
    if(typeof ResizeObserver === 'function'){
        const observer = new ResizeObserver(queueUpdate);
        observer.observe(list);
        list._smartThumbResizeObserver = observer;
    }
    requestAnimationFrame(update);
}

function bindInputThumbReferenceActions(){

    inputThumbsRow?.querySelectorAll('[data-input-add-reference]').forEach(btn => {

        btn.addEventListener('click', event => {

            event.preventDefault();

            event.stopPropagation();
            const nodeId = btn.dataset.inputAddReference || '';
            if(btn.disabled || activeComposerNode()?.id !== nodeId) return;
            closeMentionPicker();
            pickReferenceImagesForSmartNode(nodeId);

        });

        const canReceiveDroppedReference = () => {
            return !btn.disabled && activeComposerNode()?.id === nodeId;
        };
        const isFileDrag = event => Array.from(event.dataTransfer?.types || []).includes('Files');
        btn.addEventListener('dragenter', event => {
            if(!isFileDrag(event) || !canReceiveDroppedReference()) return;
            event.preventDefault();
            event.stopPropagation();
            btn.classList.add('drop-active');
        });
        btn.addEventListener('dragover', event => {
            if(!isFileDrag(event) || !canReceiveDroppedReference()) return;
            event.preventDefault();
            event.stopPropagation();
            btn.classList.add('drop-active');
        });
        btn.addEventListener('dragleave', () => btn.classList.remove('drop-active'));
        btn.addEventListener('drop', async event => {
            btn.classList.remove('drop-active');
            if(!isFileDrag(event) || !canReceiveDroppedReference()) return;
            event.preventDefault();
            event.stopPropagation();
            const files = [...(event.dataTransfer?.files || [])].filter(file => mediaKindForFile(file) === 'image');
            if(!files.length){
                toast('请拖入图片文件');
                return;
            }
            await handleFiles(files, nodeId);
        });

    });

    inputThumbsRow?.querySelectorAll('[data-input-remove-kind]').forEach(btn => {

        // Stop the parent thumbnail drag/click handlers from claiming the delete control.
        btn.addEventListener('pointerdown', event => {
            event.stopPropagation();
        });

        btn.addEventListener('click', event => {

            event.preventDefault();

            event.stopPropagation();
            const removeKind = btn.dataset.inputRemoveKind || '';
            const nodeId = btn.dataset.inputRemoveNode || '';
            if(removeKind === 'manual'){
                removeManualReferenceFromSelectedNode(btn.dataset.inputRemoveReference || '', nodeId);
                return;
            }
            if(removeKind === 'self'){
                const imageIndex = Number(btn.dataset.inputRemoveIndex);
                if(nodeId && Number.isInteger(imageIndex)) deleteImage(nodeId, imageIndex);
            }

        });

    });

}

function inputThumbDragFromEvent(e, dragState){
    const rawFrom = e.dataTransfer.getData('application/x-smart-input-thumb');
    const from = rawFrom === '' ? dragState.index : Number(rawFrom);
    if(!Number.isFinite(from) || from < 0) return -1;
    return from;
}

function markInputThumbDropTarget(el, e){
    const placement = inputThumbDropPlacement(el, e);
    el.dataset.dropPlacement = placement;
    el.classList.add(placement === 'before' ? 'drop-before' : 'drop-after');
}

function handleInputThumbDragover(e, el, index, key, dragState, node, items, manualRefKeys){
    const manualFromKey = e.dataTransfer.getData('application/x-smart-manual-ref');
    if(manualFromKey){
        if(!manualRefKeys.has(key) || manualFromKey === key) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        clearInputThumbDropMarkers();
        markInputThumbDropTarget(el, e);
        return;
    }
    const from = inputThumbDragFromEvent(e, dragState);
    if(from < 0 || from === index || !items[index]?.nodeId) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    clearInputThumbDropMarkers();
    markInputThumbDropTarget(el, e);
}

function handleInputThumbDrop(e, el, index, key, dragState, node, items, manualRefKeys){
    const manualFromKey = e.dataTransfer.getData('application/x-smart-manual-ref');
    if(manualFromKey){
        if(!manualRefKeys.has(key) || manualFromKey === key) return;
        e.preventDefault();
        e.stopPropagation();
        const placement = inputThumbDropPlacement(el, e);
        clearInputThumbDropMarkers();
        reorderManualInputRefs(node, manualFromKey, key, placement);
        return;
    }
    const from = inputThumbDragFromEvent(e, dragState);
    if(from < 0 || from === index || !items[index]?.nodeId) return;
    e.preventDefault();
    e.stopPropagation();
    const placement = inputThumbDropPlacement(el, e);
    clearInputThumbDropMarkers();
    reorderInputThumb(node, items, from, index, placement);
}

function bindInputThumbsDrag(node, items, manualRefKeys=new Set()){

    if(!inputThumbsRow) return;

    const dragState = {index:-1};

    inputThumbsRow.querySelectorAll('.input-thumb').forEach(el => {

        const index = Number(el.dataset.thumbIndex || -1);

        const item = items[index];

        const key = inputRefKey(item);

        const canReorderManual = items.length > 1 && manualRefKeys.has(key);

        const canReorderSource = items.length > 1 && Boolean(item?.nodeId);

        el.draggable = canReorderManual || canReorderSource;

        el.addEventListener('click', e => {

            e.preventDefault();

            e.stopPropagation();

        });

        if(!el.draggable) return;

        el.addEventListener('dragstart', e => {

            e.stopPropagation();

            dragState.index = index;

            el.classList.add('dragging');

            e.dataTransfer.effectAllowed = 'move';

            if(canReorderManual) e.dataTransfer.setData('application/x-smart-manual-ref', key);

            else e.dataTransfer.setData('application/x-smart-input-thumb', String(index));

        });

        el.addEventListener('dragend', e => {

            e.stopPropagation();

            dragState.index = -1;

            clearInputThumbDropMarkers();

            el.classList.remove('dragging');

        });

        el.addEventListener('dragover', e => handleInputThumbDragover(e, el, index, key, dragState, node, items, manualRefKeys));

        el.addEventListener('dragleave', e => {

            if(el.contains(e.relatedTarget)) return;

            delete el.dataset.dropPlacement;

            el.classList.remove('drop-before', 'drop-after');

        });

        el.addEventListener('drop', e => handleInputThumbDrop(e, el, index, key, dragState, node, items, manualRefKeys));

    });

}

function reorderManualInputRefs(currentNode, fromKey, targetKey, placement='before'){

    if(!currentNode || !fromKey || !targetKey || fromKey === targetKey) return false;

    const refs = Array.isArray(currentNode.manualInputRefs) ? currentNode.manualInputRefs.slice() : [];

    const from = refs.findIndex(item => inputRefKey(item) === fromKey);

    const target = refs.findIndex(item => inputRefKey(item) === targetKey);

    if(from < 0 || target < 0 || from === target) return false;

    const changed = executeSmartCanvasCommand('reorder-manual-references', () => {

        const [moved] = refs.splice(from, 1);

        let insertAt = refs.findIndex(item => inputRefKey(item) === targetKey);

        if(insertAt < 0) return false;

        if(placement === 'after') insertAt += 1;

        refs.splice(insertAt, 0, moved);

        currentNode.manualInputRefs = refs;

        return true;

    }, {skipRender:true});

    if(changed !== false){

        if(inputThumbsRow) delete inputThumbsRow.dataset.thumbsSig;

        renderInputThumbsRow(currentNode);

    }

    return changed;

}

function inputThumbDropPlacement(el, event){

    const rect = el.getBoundingClientRect();

    return event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';

}

function clearInputThumbDropMarkers(){

    inputThumbsRow?.querySelectorAll('.input-thumb.drop-before,.input-thumb.drop-after,.input-thumb.dragging')

        .forEach(el => {

            delete el.dataset.dropPlacement;

            el.classList.remove('drop-before', 'drop-after', 'dragging');

        });

}

function movedBeforeAfterIds(ids, movedId, targetId, placement='before'){

    const list = (ids || []).filter(Boolean);

    const from = list.indexOf(movedId);

    const target = list.indexOf(targetId);

    if(from < 0 || target < 0 || movedId === targetId) return list;

    const [moved] = list.splice(from, 1);

    let insertAt = list.indexOf(targetId);

    if(insertAt < 0) return ids || [];

    if(placement === 'after') insertAt += 1;

    list.splice(insertAt, 0, moved);

    return list;

}

function sameOrderedIds(a, b){

    if((a || []).length !== (b || []).length) return false;

    return (a || []).every((id, index) => id === b[index]);

}

function reorderInputSourceNodes(currentNode, movedId, targetId, placement='before'){

    if(!currentNode || !movedId || !targetId || movedId === targetId) return false;

    const sourceNodes = inputNodesFor(currentNode);

    const sourceIds = sourceNodes.map(n => n.id).filter(Boolean);

    if(!sourceIds.includes(movedId) || !sourceIds.includes(targetId)) return false;

    const nextIds = movedBeforeAfterIds(sourceIds, movedId, targetId, placement);

    if(sameOrderedIds(sourceIds, nextIds)) return false;

    const oldExplicitIds = Array.isArray(currentNode.inputNodeIds) ? currentNode.inputNodeIds.filter(Boolean) : [];

    currentNode.inputNodeIds = [

        ...nextIds.filter(id => oldExplicitIds.includes(id)),

        ...oldExplicitIds.filter(id => !nextIds.includes(id))

    ];

    if(ctx.canvas() && Array.isArray(ctx.canvas().connections)){

        const order = new Map(nextIds.map((id, index) => [id, index]));

        const relevantSlots = new Set();

        const relevant = [];

        ctx.canvas().connections.forEach((conn, index) => {

            const kind = conn?.kind || 'flow';

            if(conn?.to === currentNode.id && ['input', 'flow'].includes(kind) && order.has(conn.from)){

                relevantSlots.add(index);

                relevant.push({conn, index});

            }

        });

        if(relevant.length){

            relevant.sort((a, b) => (order.get(a.conn.from) - order.get(b.conn.from)) || (a.index - b.index));

            let cursor = 0;

            ctx.canvas().connections = ctx.canvas().connections.map((conn, index) => relevantSlots.has(index) ? relevant[cursor++].conn : conn);

        }

    }

    return true;

}

function reorderInputThumb(currentNode, items, from, to, placement='before'){

    // items are already sourced from inputImagesFor → multiple source ctx.nodes() possible.

    // Reorder within a source group's images first; separate input ctx.nodes() use the

    // current node's input order, with a visual-position swap as a final fallback.

    if(from < 0 || to < 0 || from >= items.length || to >= items.length) return false;

    const fromImg = items[from];

    const toImg = items[to];

    if(!fromImg || !toImg) return false;

    const changed = executeSmartCanvasCommand('reorder-input-thumbnail', () => {

        if(fromImg.nodeId === toImg.nodeId){

            const src = ctx.nodes().find(n => n.id === fromImg.nodeId);

            if(!src) return false;

            const fi = Number(fromImg.imageIndex);

            const ti = Number(toImg.imageIndex);

            if(!Number.isFinite(fi) || !Number.isFinite(ti) || !(src.images || [])[fi]) return false;

            const arr = src.images;

            let insertAt = Math.max(0, Math.min(arr.length, ti + (placement === 'after' ? 1 : 0)));

            const item = arr.splice(fi, 1)[0];

            if(fi < insertAt) insertAt -= 1;

            arr.splice(Math.max(0, Math.min(arr.length, insertAt)), 0, item);

            if(inputThumbsRow) delete inputThumbsRow.dataset.thumbsSig;

            return true;

        }

        const canReorderSources = currentNode && fromImg.nodeId && toImg.nodeId;

        const a = ctx.nodes().find(n => n.id === fromImg.nodeId);

        const b = ctx.nodes().find(n => n.id === toImg.nodeId);

        if(!canReorderSources || !a || !b) return false;

        if(reorderInputSourceNodes(currentNode, fromImg.nodeId, toImg.nodeId, placement)){

            if(inputThumbsRow) delete inputThumbsRow.dataset.thumbsSig;

            return true;

        }

        const ax = a.x, ay = a.y;

        a.x = b.x; a.y = b.y;

        b.x = ax; b.y = ay;

        if(inputThumbsRow) delete inputThumbsRow.dataset.thumbsSig;

        return true;

    });

    return changed;

}

    return {
        promptPlainText,
        setPromptInputLocked,
        setPromptText,
        composerPromptActionsEditable,
        syncComposerPromptActions,
        replaceComposerPromptText,
        clearPromptInput,
        savePromptDraftForCurrent,
        loadPromptDraft,
        positionComposerForNode,
        scheduleComposerUpdate,
        updateComposer,
        renderInputPromptPreview,
        renderInputThumbsRow,
        bindInputThumbScrollbar,
        bindInputThumbReferenceActions,
        inputThumbDragFromEvent,
        markInputThumbDropTarget,
        handleInputThumbDragover,
        handleInputThumbDrop,
        bindInputThumbsDrag,
        reorderManualInputRefs,
        inputThumbDropPlacement,
        clearInputThumbDropMarkers,
        movedBeforeAfterIds,
        sameOrderedIds,
        reorderInputSourceNodes,
        reorderInputThumb
    };

}
