/*
 * smart-canvas-reference-graph.js — Mention/引用域（Phase 2 P2.5，自 smart-canvas.js 迁入）。
 *
 * ES module 工厂 `createReferenceGraph(ctx)`；可变共享状态经 ctx 访问器读写，
 * window 别名与 window 挂载名裸引用直达。DOM 结构与类名零漂移，函数体逐行保留
 * （仅可变绑定读写经 AST 引导精确改写为访问器调用）。
 */
export function createReferenceGraph(ctx) {

    const {
        SMART_REFERENCE_IMAGE_MAX,
        activeComposerNode,
        assetCategories,
        assetCategoryForMention,
        assetLibraries,
        assetMediaKind,
        bindSmartPreviewImageFallbacks,
        cloneSmartSettings,
        collectPromptParts,
        escapeHtml,
        executeSmartCanvasCommand,
        imageForDisplay,
        inputThumbsRow,
        isSmartImageNode,
        mentionPicker,
        promptInput,
        promptPlainText,
        refreshIcons,
        rememberCanvasAssetLibrarySelection,
        renderAssetLibrary,
        renderInputThumbsRow,
        selectedNode,
        smartPreviewImgHtml,
        smartVideoPreviewHtml,
        tr
    } = ctx;

    // —— 域内状态声明（剩余主文件零引用，随域内迁） ——
    let mentionRange = null;
    let mentionAnchorEl = null;
    let mentionInsertMode = 'token';

function mentionTokenHtml(img){

    if(!img?.url) return '';

    const kind = mediaKindForItem(img);

    const name = img.alias || img.name || smartMediaKindLabel(kind);

    const media = mentionTokenMediaHtml(img, kind);

    return `<span class="mention-image-token" contenteditable="false" data-url="${escapeHtml(img.url)}" data-kind="${escapeHtml(kind)}" data-name="${escapeHtml(name)}" data-node-id="${escapeHtml(img.nodeId || '')}" data-image-index="${escapeHtml(img.imageIndex ?? '')}">${media}<span>${escapeHtml(name)}</span></span>`;

}

function mentionTokenMediaHtml(img, kind=mediaKindForItem(img)){

    if(kind === 'audio'){

        return `<div class="mention-audio-thumb"><i data-lucide="file-audio"></i></div>`;

    }

    if(kind === 'video'){

        return smartVideoPreviewHtml(img, 256, 'alt=""');

    }

    return smartPreviewImgHtml(img, 256, 'alt=""');

}

function mentionOptionMediaHtml(img){

    const kind = mediaKindForItem(img);

    if(kind === 'audio'){

        return `<div class="media-thumb audio-thumb mention-option-audio"><i data-lucide="file-audio"></i><span>${escapeHtml(img.alias || img.name || 'Audio')}</span></div>`;

    }

    return kind === 'video' ? smartVideoPreviewHtml(img, 256, 'alt=""') : smartPreviewImgHtml(img, 256, 'alt=""');

}

function promptHtmlWithMentionTokens(text, refs=[]){

    const value = String(text || '');

    const items = (refs || []).filter(ref => ref?.url && ref?.name).sort((a, b) => String(b.name || '').length - String(a.name || '').length);

    if(!value || !items.length || !value.includes('@')) return '';

    let html = '';

    let index = 0;

    while(index < value.length){

        if(value[index] === '@'){

            const hit = items.find(ref => value.slice(index + 1, index + 1 + String(ref.name || '').length) === String(ref.name || ''));

            if(hit){

                html += mentionTokenHtml(hit);

                index += 1 + String(hit.name || '').length;

                continue;

            }

        }

        html += escapeHtml(value[index]);

        index += 1;

    }

    return html;

}

function snapshotRunMeta(prompt, sourceId, displayPrompt='', refs=[], sourceSettings=ctx.settings(), sourceNode=null){

    const useLivePrompt = activeComposerNode()?.id === sourceNode?.id;

    const promptText = useLivePrompt ? promptPlainText() : (sourceNode?.promptDraftText || displayPrompt || prompt);

    const promptHtml = useLivePrompt ? (promptInput?.innerHTML || '') : (sourceNode?.promptDraftHtml || escapeHtml(promptText));

    return {

        prompt,

        displayPrompt:displayPrompt || promptText || prompt,

        promptHtml,

        promptText,

        promptRefs:(refs || []).map(ref => ({url:ref.url || '', name:ref.name || '', nodeId:ref.nodeId || '', imageIndex:ref.imageIndex ?? ''})).filter(ref => ref.url),

        inputRefs:(refs || []).map(ref => ({url:ref.url || '', name:ref.name || '', nodeId:ref.nodeId || '', imageIndex:ref.imageIndex ?? '', kind:ref.kind || ''})).filter(ref => ref.url),

        sourceNodeId:sourceId,

        settings:cloneSmartSettings(sourceSettings),

        createdAt:Date.now()

    };

}

function attachRunMeta(targetNode, meta){

    if(!targetNode || !meta) return;

    targetNode.runPrompt = meta.displayPrompt || meta.promptText || meta.prompt;

    targetNode.runModelPrompt = meta.prompt;

    targetNode.runPromptRefs = meta.promptRefs || [];

    targetNode.runInputRefs = (meta.inputRefs || meta.promptRefs || []).map(ref => ({

        url:ref.url || '',

        name:ref.name || '',

        nodeId:ref.nodeId || '',

        imageIndex:ref.imageIndex ?? '',

        kind:ref.kind || ''

    })).filter(ref => ref.url);

    targetNode.runSettings = meta.settings;

    if(meta.sourceNodeId) targetNode.sourceNodeId = meta.sourceNodeId;

    else delete targetNode.sourceNodeId;

    targetNode.runAt = meta.createdAt;

    // 保存可编辑的 @-提及表单到草稿字段，方便点输出节点时还原原始可编辑形式

    if(meta.promptHtml != null){

        const htmlHasToken = String(meta.promptHtml || '').includes('mention-image-token');

        const rebuiltHtml = htmlHasToken ? '' : promptHtmlWithMentionTokens(meta.displayPrompt || meta.promptText || '', meta.promptRefs || []);

        targetNode.promptDraftHtml = htmlHasToken ? meta.promptHtml : (rebuiltHtml || meta.promptHtml);

        targetNode.promptDraftText = meta.promptText || '';

    }

    targetNode.images = (targetNode.images || []).map(img => stripImageGenerationMeta(img));

}

function stripRunInputMeta(meta){
    return SmartCanvasRunDataPrimitives.stripRunInputMeta(meta, escapeHtml);
}

function stripImageGenerationMeta(img){
    return SmartCanvasRunDataPrimitives.stripImageGenerationMeta(img);
}

function addConnection(fromId, toId, kind='flow'){

    if(!fromId || !toId || fromId === toId) return;

    ctx.canvas().connections = ctx.canvas().connections || [];

    if(ctx.canvas().connections.some(c => c.from === fromId && c.to === toId && (c.kind || 'flow') === kind)) return;

    ctx.canvas().connections.push({from:fromId, to:toId, kind});

}

function connectInputNode(fromId, toId){
    const from = ctx.nodes().find(node => node.id === fromId);
    const to = ctx.nodes().find(node => node.id === toId);
    if(!from || !to || from.id === to.id || !isSmartImageNode(from) || !isSmartImageNode(to)) return false;
    to.inputNodeIds = Array.from(new Set([...(to.inputNodeIds || []), from.id]));
    addConnection(from.id, to.id, 'input');
    return true;
}

function hasConnectionBetween(fromId, toId){
    const pair = new Set([fromId, toId]);
    const hasLine = (ctx.canvas()?.connections || []).some(c => pair.has(c.from) && pair.has(c.to));
    const legacy = (ctx.nodes().find(n => n.id === fromId)?.inputNodeIds || []).includes(toId)
        || (ctx.nodes().find(n => n.id === toId)?.inputNodeIds || []).includes(fromId);
    return hasLine || legacy;
}

function upstreamNodesForKinds(node, kinds=['input']){
    if(!node) return [];
    return SmartCanvasConnectionPrimitives.incomingNodeIds(node, ctx.canvas()?.connections || [], kinds, {
        useConnections:ctx.canvasUsesConnections(),
        legacyInputNodeIds:node.inputNodeIds || []
    }).map(id => ctx.nodes().find(item => item.id === id)).filter(Boolean);
}

function inputNodesFor(node){

    return upstreamNodesForKinds(node, ['input']);

}

// Upstream image sources can be linked as explicit input or regular flow connections.

function clearDetachedRunInputRefs(node){

    if(!node) return;

    const hasUpstream = Boolean((ctx.canvas()?.connections || []).some(conn => conn.to === node.id && ['input','flow'].includes(conn.kind || 'flow')));

    if(hasUpstream || (!ctx.canvasUsesConnections() && Array.isArray(node.inputNodeIds) && node.inputNodeIds.some(id => ctx.nodes().some(n => n.id === id)))) return;

    delete node.runInputRefs;

    delete node.runPromptRefs;

    delete node.sourceNodeId;

}

function cleanupDetachedRunInputRefs(){

    if(!ctx.canvasUsesConnections()) return false;

    let changed = false;

    ctx.nodes().forEach(node => {

        const hadRefs = Array.isArray(node?.runInputRefs) && node.runInputRefs.length;

        const hadPromptRefs = Array.isArray(node?.runPromptRefs) && node.runPromptRefs.length;

        const hadSource = Boolean(node?.sourceNodeId);

        clearDetachedRunInputRefs(node);

        if(hadRefs !== (Array.isArray(node?.runInputRefs) && node.runInputRefs.length)

            || hadPromptRefs !== (Array.isArray(node?.runPromptRefs) && node.runPromptRefs.length)

            || hadSource !== Boolean(node?.sourceNodeId)){

            changed = true;

        }

    });

    return changed;

}

function imagesForNode(node){
    return (node?.images || []).map((img, index) => ({...imageForDisplay(img), nodeId:node.id, imageIndex:index}));
}

function isSelfReferenceForNode(node, img){

    return Boolean(node?.id && img?.nodeId === node.id);

}


function outputImagesForNode(node){
    return imagesForNode(node).filter(img => img?.url);
}

function selfReferenceImagesForNode(node){
    return outputImagesForNode(node);
}

function inputImagesFor(node, consume=false, ctx=null){

    return inputNodesFor(node).flatMap(input => outputImagesForNode(input, consume, ctx));

}

function inputRefKey(img){
    return SmartCanvasRunDataPrimitives.inputRefKey(img);
}

function blockedInputRefKeys(node){
    return SmartCanvasRunDataPrimitives.blockedInputRefKeys(node);
}

function manualReferenceImagesFor(node){

    if(!node || !Array.isArray(node.manualInputRefs)) return [];

    return node.manualInputRefs.filter(img => img?.url).map((img, index) => ({

        ...img,

        kind:img.kind || mediaKindForItem(img),

        name:img.name || `图${index + 1}`,

        imageIndex:Number.isFinite(Number(img.imageIndex)) ? Number(img.imageIndex) : index,

        manualAdded:true

    }));

}


function defaultReferenceImagesFor(node, consume=false, ctx=null){

    if(!node) return [];

    const self = selfReferenceImagesForNode(node, consume, ctx).filter(img => img?.url);

    const upstream = inputImagesFor(node, consume, ctx)

        .filter(img => img?.url);

    const manual = manualReferenceImagesFor(node);

    if(self.length) return uniqueReferenceImages([...self, ...upstream, ...manual]);

    return uniqueReferenceImages([...upstream, ...manual]);

}

function lineConnectionsFor(node){
    return node ? SmartCanvasConnectionPrimitives.connectionsForKinds(ctx.canvas()?.connections || [], ['input', 'flow']) : [];
}

function upstreamLineNodeIds(node){
    return node ? [...SmartCanvasConnectionPrimitives.upstreamNodeIds(node.id, lineConnectionsFor(node)), node.id] : [];
}

function lineImagesFor(node){

    const ids = upstreamLineNodeIds(node);

    return ids.flatMap(id => {

        const source = ctx.nodes().find(n => n.id === id);

        return imagesForNode(source);

    }).filter(img => img?.url);

}

function collectMentionedImagesFromPrompt(){

    const images = [];

    collectPromptParts().forEach(part => {

        if(part.type === 'image' && part.url) images.push(part);

    });

    return images;

}

function uniqueReferenceImages(images){
    return SmartCanvasRunDataPrimitives.uniqueReferenceImages(images, SMART_REFERENCE_IMAGE_MAX);
}

function visibleReferenceImagesFor(node){

    const base = defaultReferenceImagesFor(node);

    return uniqueReferenceImages([...base, ...collectMentionedImagesFromPrompt()]);

}

function inputMentionCandidateImages(node){

    const current = node ? [...lineImagesFor(node), ...manualReferenceImagesFor(node)] : [];

    const seen = new Set();

    return current.filter(img => {

        if(!img?.url || seen.has(img.url)) return false;

        seen.add(img.url);

        return true;

    }).map((img, index) => ({

        ...img,

        mentionId:`mention_${index}_${Math.random().toString(36).slice(2, 7)}`,

        alias:img.name || `图片${index + 1}`

    }));

}

// 一个素材可注册到多个平台：收集所有「已通过」的 asset:// 地址，按平台映射。

function assetRegisteredUris(item){

    const regs = (item && item.registrations && typeof item.registrations === 'object') ? item.registrations : {};

    const out = {};

    Object.keys(regs).forEach(platform => {

        const reg = regs[platform];

        if(reg && reg.status === 'Active' && reg.asset_uri) out[platform] = reg.asset_uri;

    });

    return out;

}

function assetMentionCandidateImages(categoryId=''){

    const cats = assetCategories('image');

    const cat = cats.find(c => c.id === categoryId) || assetCategoryForMention();

    if(!cat) return [];

    ctx.setMentionAssetCategoryId(cat.id);

    const items = (cat.items || []).map(item => ({...item, categoryName:cat.name || '', categoryId:cat.id}));

    const seen = new Set();

    return items.filter(item => {

        if(!item?.url || seen.has(item.url)) return false;

        seen.add(item.url);

        return true;

    }).map((item, index) => ({

        url:item.url,

        kind:assetMediaKind(item),

        name:item.name || `资产${index + 1}`,

        alias:item.name || `资产${index + 1}`,

        role:'asset',

        categoryName:item.categoryName || '',

        asset_uris:assetRegisteredUris(item),

        mentionId:`asset_${index}_${Math.random().toString(36).slice(2, 7)}`

    }));

}

function closeMentionPicker(){

    mentionPicker.classList.remove('open');

    mentionPicker.innerHTML = '';

    mentionAnchorEl = null;

    mentionInsertMode = 'token';

    if(selectedNode()) renderInputThumbsRow(selectedNode());

}

function saveMentionRange(){

    const sel = window.getSelection();

    if(sel && sel.rangeCount && promptInput.contains(sel.anchorNode)){

        mentionRange = sel.getRangeAt(0).cloneRange();

    }

}

function textBeforeCaret(){

    const sel = window.getSelection();

    if(!sel || !sel.rangeCount || !promptInput.contains(sel.anchorNode)) return '';

    const range = sel.getRangeAt(0).cloneRange();

    range.selectNodeContents(promptInput);

    range.setEnd(sel.anchorNode, sel.anchorOffset);

    return range.toString();

}

function buildMentionPickerBodyHtml(candidates){

    return candidates.length ? `<div class="mention-option-grid">${candidates.map((img, i) => `
            <button class="mention-option" type="button" data-mention-index="${i}">

                ${mentionOptionMediaHtml(img)}

                <span>${escapeHtml(img.alias)}</span>

            </button>

        `).join('')}</div>` : `<div class="mention-empty">${escapeHtml(tr('smart.mentionEmpty'))}</div>`;

}

function buildMentionLibrarySelectHtml(assetLibs, activeAssetLibraryId){

    return `<label class="mention-library-row"><span>${escapeHtml(tr('smart.assetLibrary'))}</span><select class="mention-library-select" data-mention-library>${assetLibs.map(lib => `<option value="${escapeHtml(lib.id)}" ${lib.id === activeAssetLibraryId ? 'selected' : ''}>${escapeHtml(lib.name || '资产库')}</option>`).join('')}</select></label>`;

}

function buildMentionFolderChipsHtml(nextAssetCats, mentionAssetCategoryId){

    return nextAssetCats.map(cat => {

            const label = cat.name || tr('smart.assetFolder');

            return `<button class="mention-folder-chip ${cat.id === mentionAssetCategoryId ? 'active' : ''}" type="button" data-mention-folder="${escapeHtml(cat.id)}" title="${escapeHtml(label)}">${escapeHtml(label)}</button>`;

          }).join('');

}

function buildMentionPickerShellHtml(mentionSource, hasInput, hasAssets, librarySelect, folderChips, body){

    return `
        <div class="mention-picker-shell">

            <div class="mention-source-tabs">

                <button class="mention-source-tab ${mentionSource === 'input' ? 'active' : ''}" type="button" data-mention-source="input" title="${escapeHtml(tr('smart.mentionInput'))}" ${hasInput ? '' : 'disabled'}>

                    <i data-lucide="image"></i><span>${escapeHtml(tr('smart.mentionInput'))}</span>

                </button>

                <button class="mention-source-tab ${mentionSource === 'asset' ? 'active' : ''}" type="button" data-mention-source="asset" title="${escapeHtml(tr('smart.mentionAssets'))}" ${hasAssets ? '' : 'disabled'}>

                    <i data-lucide="library"></i><span>${escapeHtml(tr('smart.mentionAssets'))}</span>

                </button>

            </div>

            ${librarySelect}

            <div class="mention-folder-chips ${folderChips ? '' : 'hidden'}">

                ${folderChips}

            </div>

            <div class="mention-content">

                ${body}

            </div>

        </div>

    `;

}

function renderMentionPicker(source){

    const node = selectedNode();

    const inputItems = inputMentionCandidateImages(node);

    const assetLibs = assetLibraries();

    if(!activeAssetLibraryId || !assetLibs.some(lib => lib.id === activeAssetLibraryId)) activeAssetLibraryId = ctx.assetLibrary().active_library_id || assetLibs[0]?.id || '';

    const libraryWithMentionAssets = assetLibs.find(lib => (lib.categories || []).some(cat => (cat.type || 'image') === 'image' && (cat.items || []).some(item => item?.url)));

    const assetCats = assetCategories('image');

    const hasInput = inputItems.length > 0;

    const hasAssets = Boolean(libraryWithMentionAssets);

    ctx.setMentionSource(source || (hasInput ? 'input' : 'asset'));

    if(ctx.mentionSource() === 'asset' && hasAssets && !assetCats.some(cat => (cat.items || []).some(item => item?.url)) && libraryWithMentionAssets){

        activeAssetLibraryId = libraryWithMentionAssets.id;

        ctx.setActiveAssetCategoryId('');

        ctx.setMentionAssetCategoryId('');

    }

    if(ctx.mentionSource() === 'input' && !hasInput && hasAssets) ctx.setMentionSource('asset');

    if(ctx.mentionSource() === 'asset' && !hasAssets && hasInput) ctx.setMentionSource('input');

    if(!hasInput && !hasAssets){ closeMentionPicker(); return; }

    const nextAssetCats = assetCategories('image');

    const currentAssetCat = assetCategoryForMention();

    const assetItems = assetMentionCandidateImages(currentAssetCat?.id || '');

    const candidates = (ctx.mentionSource() === 'asset' ? assetItems : inputItems).slice(0, 36);

    const body = buildMentionPickerBodyHtml(candidates);

    const librarySelect = (ctx.mentionSource() === 'asset' && assetLibs.length) ? buildMentionLibrarySelectHtml(assetLibs, activeAssetLibraryId) : '';

    const folderChips = (ctx.mentionSource() === 'asset' && nextAssetCats.length) ? buildMentionFolderChipsHtml(nextAssetCats, ctx.mentionAssetCategoryId()) : '';

    mentionPicker.innerHTML = buildMentionPickerShellHtml(ctx.mentionSource(), hasInput, hasAssets, librarySelect, folderChips, body);

    mentionPicker._items = candidates;

    bindSmartPreviewImageFallbacks(mentionPicker);

    if(mentionInsertMode === 'manual-ref'){

        placeMentionPickerInComposerCard();

        renderInputThumbsRow(selectedNode());

        mentionAnchorEl = inputThumbsRow?.querySelector('[data-input-add-reference]') || inputThumbsRow;

    } else {

        placeMentionPickerInPromptRow();

    }

    positionMentionPickerAtCaret();

    mentionPicker.classList.add('open');

    bindMentionPickerEvents();
    refreshIcons();

}

function bindMentionPickerEvents(){
    mentionPicker.querySelectorAll('[data-mention-source]').forEach(btn => {
        btn.addEventListener('mousedown', e => {
            e.preventDefault(); e.stopPropagation();
            if(btn.disabled) return;
            renderMentionPicker(btn.dataset.mentionSource);
        });
    });
    mentionPicker.querySelectorAll('[data-mention-library]').forEach(select => {
        select.addEventListener('mousedown', e => e.stopPropagation());
        select.addEventListener('change', e => {
            activeAssetLibraryId = e.target.value || '';
            ctx.setActiveAssetCategoryId('');
            ctx.setMentionAssetCategoryId('');
            renderAssetLibrary();
            rememberCanvasAssetLibrarySelection();
            renderMentionPicker('asset');
        });
    });
    mentionPicker.querySelectorAll('[data-mention-folder]').forEach(btn => {
        btn.addEventListener('mousedown', e => {
            e.preventDefault(); e.stopPropagation();
            ctx.setMentionAssetCategoryId(btn.dataset.mentionFolder || '');
            renderMentionPicker('asset');
        });
    });
    mentionPicker.querySelectorAll('[data-mention-index]').forEach(btn => {
        btn.addEventListener('mousedown', e => {
            e.preventDefault(); e.stopPropagation();
            const item = mentionPicker._items[Number(btn.dataset.mentionIndex)];
            if(mentionInsertMode === 'manual-ref') addManualReferenceToSelectedNode(item);
            else insertMentionToken(item);
        });
    });
}

function showMentionPicker(){

    const node = selectedNode();

    const hasInput = inputMentionCandidateImages(node).length > 0;

    mentionInsertMode = 'token';

    mentionAnchorEl = null;

    placeMentionPickerInPromptRow();

    ctx.setMentionSource(hasInput ? 'input' : 'asset');

    renderMentionPicker(ctx.mentionSource());

}

function addManualReferenceToNode(nodeId, img){

    const node = ctx.nodes().find(item => item.id === nodeId);

    if(!node || !img?.url) return false;

    const kind = img.kind || mediaKindForItem(img);

    const ref = {

        url:img.url,

        name:img.alias || img.name || smartMediaKindLabel(kind),

        kind,

        nodeId:img.nodeId || '',

        imageIndex:Number.isFinite(Number(img.imageIndex)) ? Number(img.imageIndex) : '',

        asset_uris:img.asset_uris || {},

        manualAdded:true

    };

    if(img.originalLocalUrl) ref.originalLocalUrl = img.originalLocalUrl;

    const refs = Array.isArray(node.manualInputRefs) ? node.manualInputRefs.slice() : [];

    const key = inputRefKey(ref);

    const exists = refs.some(item => inputRefKey(item) === key || item.url === ref.url);

    if(exists){

        closeMentionPicker();

        return false;

    }

    const changed = executeSmartCanvasCommand('add-manual-reference', () => {

        refs.push(ref);

        node.manualInputRefs = refs;

        return true;

    }, {skipRender:true});

    closeMentionPicker();

    if(changed !== false) renderInputThumbsRow(node);

    return changed;

}

function addManualReferenceToSelectedNode(img){ return addManualReferenceToNode(activeComposerNode()?.id || '', img); }

function removeManualReferenceFromSelectedNode(key, nodeId=''){

    const node = (nodeId && ctx.nodes().find(n => n.id === nodeId)) || activeComposerNode();

    if(!node || !key || !Array.isArray(node.manualInputRefs)) return false;

    const refs = node.manualInputRefs.slice();

    const index = refs.findIndex(ref => inputRefKey(ref) === key || ref?.url === key.replace(/^url\|/, ''));

    if(index < 0) return false;

    const changed = executeSmartCanvasCommand('remove-manual-reference', () => {

        refs.splice(index, 1);

        node.manualInputRefs = refs;

        if(!refs.length) delete node.manualInputRefs;

        return true;

    }, {skipRender:true});

    if(changed !== false){
        if(inputThumbsRow) delete inputThumbsRow.dataset.thumbsSig;
        renderInputThumbsRow(node);
    }

    return changed;

}

function placeMentionPickerInPromptRow(){

    const row = promptInput?.closest?.('.prompt-row');

    if(row && mentionPicker.parentElement !== row) row.appendChild(mentionPicker);

}

function placeMentionPickerInComposerCard(){

    const card = promptInput?.closest?.('.composer-card');

    if(card && mentionPicker.parentElement !== card) card.appendChild(mentionPicker);

}

function mentionPickerPositionScale(element){

    const rect = element?.getBoundingClientRect?.();

    const logicalWidth = Number(element?.offsetWidth) || 0;

    const logicalHeight = Number(element?.offsetHeight) || 0;

    return {

        x: rect?.width > 0 && logicalWidth > 0 ? rect.width / logicalWidth : 1,

        y: rect?.height > 0 && logicalHeight > 0 ? rect.height / logicalHeight : 1

    };

}

function positionMentionPickerAtCaret(){

    const row = promptInput.closest('.prompt-row');

    const rowRect = row.getBoundingClientRect();

    if(mentionAnchorEl){

        const anchorRect = mentionAnchorEl.getBoundingClientRect();

        const pickerWidth = mentionPicker.offsetWidth || 340;

        const base = mentionPicker.offsetParent || mentionPicker.parentElement || row;

        const scale = mentionPickerPositionScale(base);

        const baseRect = base.getBoundingClientRect();

        const baseLogicalWidth = baseRect.width / scale.x;

        const rawLeft = (anchorRect.right - baseRect.left) / scale.x - pickerWidth;

        const rawTop = (anchorRect.bottom - baseRect.top) / scale.y + 2;

        const left = Math.max(4, Math.min(rawLeft, Math.max(4, baseLogicalWidth - pickerWidth - 4)));

        mentionPicker.style.left = `${left}px`;

        mentionPicker.style.top = `${Math.max(2, rawTop)}px`;

        return;

    }

    let caretRect = null;

    const sel = window.getSelection();

    if(sel && sel.rangeCount){

        const range = sel.getRangeAt(0).cloneRange();

        caretRect = range.getClientRects()[0] || range.getBoundingClientRect();

    }

    const inputRect = promptInput.getBoundingClientRect();

    // 按当前容器的真实视觉缩放换算坐标：画布内编辑器可能跟随 world 缩放，

    // screen-docked 编辑器则保持 1:1，不能直接套用 viewport.scale。

    const scale = mentionPickerPositionScale(row);

    const rowLogicalWidth = rowRect.width / scale.x;

    const pickerWidth = mentionPicker.offsetWidth || 340;

    const maxLeft = Math.max(4, rowLogicalWidth - pickerWidth - 4);

    const rawLeft = ((caretRect?.left || inputRect.left) - rowRect.left) / scale.x - 6;

    const rawTop = ((caretRect?.bottom || inputRect.top + 24) - rowRect.top) / scale.y + 2;

    const left = Math.max(4, Math.min(rawLeft, maxLeft));

    const top = Math.max(2, rawTop);

    mentionPicker.style.left = `${left}px`;

    mentionPicker.style.top = `${top}px`;

}

function maybeOpenMentionPicker(){

    saveMentionRange();

    const before = textBeforeCaret();

    if(/@$/.test(before)) showMentionPicker();

    else closeMentionPicker();

}

function insertMentionToken(img){

    if(!img?.url) return;

    promptInput.focus();

    const sel = window.getSelection();

    if(mentionRange){

        sel.removeAllRanges();

        sel.addRange(mentionRange);

    }

    const range = sel.rangeCount ? sel.getRangeAt(0) : document.createRange();

    let removedAt = false;

    if(range.startContainer?.nodeType === Node.TEXT_NODE && range.startOffset > 0){

        const text = range.startContainer.textContent || '';

        if(text[range.startOffset - 1] === '@'){

            range.setStart(range.startContainer, range.startOffset - 1);

            range.deleteContents();

            removedAt = true;

        }

    }

    if(!removedAt) {

        const walker = document.createTreeWalker(promptInput, NodeFilter.SHOW_TEXT);

        let lastText = null;

        while(walker.nextNode()) lastText = walker.currentNode;

        if(lastText && /@$/.test(lastText.textContent || '')) {

            lastText.textContent = lastText.textContent.slice(0, -1);

            range.selectNodeContents(promptInput);

            range.collapse(false);

        }

    }

    const token = document.createElement('span');

    token.className = 'mention-image-token';

    token.contentEditable = 'false';

    token.dataset.url = img.url;

    token.dataset.kind = mediaKindForItem(img);

    token.dataset.name = img.alias || img.name || smartMediaKindLabel(token.dataset.kind);

    token.dataset.nodeId = img.nodeId || '';

    token.dataset.imageIndex = String(img.imageIndex ?? '');

    token.dataset.assetUris = JSON.stringify(img.asset_uris || {});

    token.innerHTML = `${mentionTokenMediaHtml(img, token.dataset.kind)}<span>${escapeHtml(token.dataset.name)}</span>`;

    range.insertNode(token);

    bindSmartPreviewImageFallbacks(token);

    const spacer = document.createTextNode(' ');

    token.after(spacer);

    range.setStartAfter(spacer);

    range.collapse(true);

    sel.removeAllRanges();

    sel.addRange(range);

    closeMentionPicker();

    promptInput.focus();

    renderInputThumbsRow(selectedNode());

}

    return {
        promptHtmlWithMentionTokens,
        snapshotRunMeta,
        attachRunMeta,
        stripRunInputMeta,
        stripImageGenerationMeta,
        addConnection,
        connectInputNode,
        hasConnectionBetween,
        upstreamNodesForKinds,
        inputNodesFor,
        clearDetachedRunInputRefs,
        cleanupDetachedRunInputRefs,
        imagesForNode,
        isSelfReferenceForNode,
        inputRefKey,
        blockedInputRefKeys,
        manualReferenceImagesFor,
        defaultReferenceImagesFor,
        uniqueReferenceImages,
        visibleReferenceImagesFor,
        closeMentionPicker,
        saveMentionRange,
        renderMentionPicker,
        removeManualReferenceFromSelectedNode,
        maybeOpenMentionPicker
    };

}
