/*
 * smart-canvas-keyboard-domain.js — 键盘总装域（Phase 2 P2.9，自 smart-canvas.js 迁入）。
 *
 * ES module 工厂 `createKeyboardDomain(ctx)`；可变共享状态经 ctx 访问器读写，
 * window 别名与 window 挂载名裸引用直达。DOM 结构与类名零漂移，函数体逐行保留
 * （仅可变绑定读写经 AST 引导精确改写为访问器调用）。
 * 域内包含：视图历史与位置快捷键、全选/复制/粘贴/预览/运行选中、对齐排列、
 * 快捷键阻断守卫、交互取消、document/window 键盘与 blur 监听总装。
 */
export function createKeyboardDomain(ctx) {

    const {
        SMART_ALIGNMENT_KEY_ACTIONS,
        SMART_LOG_PREVIEW_NODE_ID,
        SmartCanvasShortcuts,
        applySmartNodeAlignment,
        applyViewport,
        arrangeSelectedSmartNodes,
        backToCanvasList,
        beginSelectedSmartNodeMove,
        clearComposerPromptEditing,
        clearDropHighlight,
        clearPortDragVisual,
        clearSelection,
        clearSmartNodeSnapGuides,
        closeAllSmartPopovers,
        closeCreateMenu,
        closeMediaPreview,
        closePromptPresetPanel,
        closePromptTemplatePanel,
        closeSmartCanvasLog,
        closeSmartCanvasShortcuts,
        closeSmartChatPanel,
        closeSmartLogLightbox,
        copySelectedNodes,
        cyclePreviewMedia,
        cycleZViewport,
        deleteSelectedSmartNodes,
        discardPendingUndo,
        duplicateForAltDrag,
        groupSelectedNodes,
        isEditableTarget,
        isSelectableSmartImageGroupMember,
        isSmartRunnableNode,
        mediaPreviewModal,
        openImagePreviewSmart,
        openSmartCanvasSettings,
        pasteNodes,
        performRedo,
        performUndo,
        previewStage,
        render,
        restoreUndoSnapshot,
        runGeneration,
        savePromptDraftForCurrent,
        selectedNodeIds,
        selectedSmartAlignmentNodes,
        selectionBox,
        shell,
        shouldBlockMiddlePan,
        smartArrangeAtomicIds,
        smartCanvasPreviewState,
        smartCanvasState,
        smartNodeInFlight,
        syncSelectionUi,
        toast,
        toggleAssetLibrary,
        toggleComposerDock,
        toggleSmartCanvasLog,
        toggleSmartCanvasMinimap,
        toggleSmartCanvasShortcuts,
        toggleSmartChatPanel,
        ungroupNode,
        updateComposer,
        viewport
    } = ctx;

const smartViewHistory = [];

let smartViewHistoryIndex = -1;

function smartViewSnapshot(){ return {x:viewport.x, y:viewport.y, scale:viewport.scale}; }

function smartViewSame(a, b){

    return Boolean(a && b && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.scale - b.scale) < 0.0005);

}

function rememberSmartViewPosition(view=smartViewSnapshot()){

    if(smartViewSame(smartViewHistory[smartViewHistoryIndex], view)) return;

    if(smartViewHistoryIndex < smartViewHistory.length - 1) smartViewHistory.splice(smartViewHistoryIndex + 1);

    smartViewHistory.push({...view});

    if(smartViewHistory.length > 40) smartViewHistory.shift();

    smartViewHistoryIndex = smartViewHistory.length - 1;

}

function runViewShortcut(action){

    rememberSmartViewPosition();

    const result = action();

    rememberSmartViewPosition();

    return result;

}

function selectAllSmartNodes(){

    const ids = smartArrangeAtomicIds(ctx.nodes().filter(n => n.id !== SMART_LOG_PREVIEW_NODE_ID).map(n => n.id));

    selectedIds = ids;

    selectedId = ids.length === 1 ? ids[0] : '';

    selectedImage = {nodeId:'', index:-1};

    syncSelectionUi();

    updateComposer();

}

function duplicateSelectedSmartNodes(){

    const ids = selectedNodeIds();

    const source = ids.map(id => ctx.nodes().find(n => n.id === id)).find(Boolean);

    if(!source) return false;

    const before = new Set(ctx.nodes().map(n => n.id));

    const offset = 36 / Math.max(.25, Number(viewport.scale) || 1);
    duplicateForAltDrag(source, false, {offsetX:offset, offsetY:offset});

    const copiedIds = ctx.nodes().filter(n => !before.has(n.id)).map(n => n.id);

    selectedIds = copiedIds;

    selectedId = copiedIds.length === 1 ? copiedIds[0] : '';

    selectedImage = {nodeId:'', index:-1};

    render();

    return copiedIds.length > 0;

}

function previewSelectedSmartNode(){
    const ids = selectedNodeIds();
    if(ids.length !== 1) return false;
    const node = ctx.nodes().find(item => item.id === ids[0]);
    if(!node) return false;
    const images = (node.images || []).filter(img => img?.url && mediaKindForItem(img) === 'image');
    if(!images.length) return false;
    const index = selectedImage.nodeId === node.id && selectedImage.index >= 0 ? selectedImage.index : 0;
    openImagePreviewSmart(node.id, Math.min(index, images.length - 1));
    return true;
}

async function runSelectedSmartNodes(){ // SMART_CANVAS_BATCH_TOOLS_20260714

    savePromptDraftForCurrent();

    const selected = selectedNodeIds().map(id => ctx.nodes().find(node => node.id === id)).filter(Boolean);

    const runnable = selected.filter(node => isSmartRunnableNode(node) && !smartNodeInFlight(node));

    if(!runnable.length){

        toast(selected.length ? '选中节点均不可运行或正在运行' : '请先选择要运行的节点');

        return false;

    }

    if(runnable.length > 1 && !window.confirm(`将并行运行 ${runnable.length} 个节点，是否继续？`)) return false;

    const results = await Promise.all(runnable.map(node => runGeneration(node)));

    const succeeded = results.filter(Boolean).length;

    const failed = results.length - succeeded;

    toast(failed ? `批量运行完成：成功 ${succeeded}，失败 ${failed}` : `已完成 ${succeeded} 个节点`);

    return failed === 0;

}

function smartCanvasTransientOverlayOpen(){

    return Boolean(document.querySelector('.smart-canvas-api-settings-modal.open,.media-preview-modal.open,.log-modal.open,.shortcut-modal.open,.prompt-template-panel.open,.prompt-preset-panel.open,.prompt-preset-edit.open,.asset-panel.open,.asset-dialog-backdrop.open,.create-menu.open,.mention-picker.open'));

}

// Typing surfaces own their keystrokes, so single-key canvas commands and canvas undo/redo
// never fire while an input, textarea, select, or editable region has focus.
function shouldBlockCanvasShortcut(event){
    return Boolean(event?.isComposing) || isEditableTarget(event?.target);
}

function shouldBlockSurfaceSwitchShortcut(event){
    return Boolean(event?.isComposing) || isEditableTarget(event?.target);
}

function cancelActiveCanvasInteraction(){
    const active = smartCanvasState.interaction.active || 'idle';
    if(active === 'idle') return false;
    if(active === 'pan'){
        const pan = smartCanvasState.interaction.pan;
        if(pan){ viewport.x = pan.ox; viewport.y = pan.oy; applyViewport(); }
    }
    if(active === 'selection'){
        selectionBox.style.display = 'none';
        shell.classList.remove('selecting');
    }
    if(active === 'portDrag'){
        clearPortDragVisual();
        shell.classList.remove('port-dragging');
    }
    if(active === 'previewPan'){
        smartCanvasPreviewState.pan = null;
        previewStage?.classList.remove('is-panning');
    }
    if(['drag', 'resize', 'thumbDrag', 'portDrag'].includes(active)){
        const snapshot = ctx.smartCanvasStore().pending?.snapshot;
        discardPendingUndo();
        if(snapshot) restoreUndoSnapshot(snapshot);
    }
    document.body.classList.remove('smart-node-drag', 'smart-node-resize');
    clearDropHighlight();
    clearSmartNodeSnapGuides();
    smartCanvasState.endInteraction(active, {source:'escape'});
    return true;
}

eventManager.addGlobal(document, 'keydown', event => {

    if(mediaPreviewModal?.classList.contains('open') && !isEditableTarget(event.target)){
        if(event.key === 'ArrowLeft' || event.key === 'ArrowRight'){
            event.preventDefault();
            event.stopPropagation();
            cyclePreviewMedia(event.key === 'ArrowRight' ? 1 : -1);
            return;
        }
    }

    if(event.key !== 'Escape') return;

    const editableTarget = isEditableTarget(event.target);

    if(!editableTarget && mediaPreviewModal?.classList.contains('open')){
        event.preventDefault();
        event.stopPropagation();
        closeMediaPreview();
        return;
    }

    if(!editableTarget && document.getElementById('smartLogLightbox')?.classList.contains('open')){
        event.preventDefault();
        event.stopPropagation();
        closeSmartLogLightbox();
        return;
    }

    if(!editableTarget && cancelActiveCanvasInteraction()){
        event.preventDefault();
        event.stopPropagation();
        return;
    }

    const transientOverlayOpen = smartCanvasTransientOverlayOpen();
    clearComposerPromptEditing();
    closeAllSmartPopovers();
    closeCreateMenu();
    closeSmartCanvasLog();
    closeSmartCanvasShortcuts();
    closeSmartChatPanel();
    closePromptPresetPanel();
    closePromptTemplatePanel();
    if(transientOverlayOpen){
        event.preventDefault();
        event.stopPropagation();
        return;
    }

    if(editableTarget || !selectedNodeIds().length) return;

    event.preventDefault();

    event.stopPropagation();

    clearSelection();

    syncSelectionUi();

    updateComposer();

}, true);

eventManager.addGlobal(window, 'keydown', e => {

    const key = String(e.key || '').toLowerCase();

    const canvasShortcutBlocked = shouldBlockCanvasShortcut(e);

    if(SmartCanvasShortcuts.matches(e, 'toggle-composer') && !canvasShortcutBlocked){

        if(e.repeat) return;

        toggleComposerDock();

        e.preventDefault();

        e.stopPropagation();

        return;

    }

    if(SmartCanvasShortcuts.matches(e, 'arrange-selected') && !canvasShortcutBlocked){

        if(e.repeat || !selectedNodeIds().length) return;

        e.preventDefault();

        e.stopPropagation();

        arrangeSelectedSmartNodes();

        return;

    }

    if(SmartCanvasShortcuts.matches(e, 'move-selected') && !canvasShortcutBlocked){
        if(e.repeat || isEditableTarget(e.target) || !selectedNodeIds().length) return;
        e.preventDefault();
        e.stopPropagation();
        beginSelectedSmartNodeMove();
        return;
    }

    if(SmartCanvasShortcuts.matches(e, 'back-to-canvas-list') && !canvasShortcutBlocked){
        if(e.repeat || isEditableTarget(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        backToCanvasList();
        return;
    }
    if(SmartCanvasShortcuts.matches(e, 'toggle-settings') && !canvasShortcutBlocked){
        if(e.repeat || isEditableTarget(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        openSmartCanvasSettings();
        return;
    }

    if(SmartCanvasShortcuts.matches(e, 'run-selected')){

        if(canvasShortcutBlocked || e.repeat || shouldBlockMiddlePan(e.target) || !selectedNodeIds().length) return;

        e.preventDefault();

        e.stopPropagation();

        runSelectedSmartNodes();

        return;

    }

    if(SmartCanvasShortcuts.matches(e, 'toggle-visual-assistant') && !shouldBlockSurfaceSwitchShortcut(e)){
        if(e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
        e.preventDefault();
        e.stopPropagation();
        toggleSmartChatPanel();
        return;
    }

    if(SmartCanvasShortcuts.matches(e, 'toggle-log') && !shouldBlockSurfaceSwitchShortcut(e)){

        if(e.repeat) return;

        e.preventDefault();

        toggleSmartCanvasLog();

        return;

    }

if(SmartCanvasShortcuts.matches(e, 'toggle-shortcuts') && !shouldBlockSurfaceSwitchShortcut(e)){

        if(e.repeat) return;

        e.preventDefault();

        toggleSmartCanvasShortcuts();

        return;

    }

    if(SmartCanvasShortcuts.matches(e, 'toggle-assets') && !shouldBlockSurfaceSwitchShortcut(e)){
        if(e.repeat) return;
        e.preventDefault();
        toggleAssetLibrary();
        return;
    }

    if(SmartCanvasShortcuts.matches(e, 'toggle-minimap') && !canvasShortcutBlocked){

        if(e.repeat) return;

        e.preventDefault();

        toggleSmartCanvasMinimap();

        return;

    }

    if(!canvasShortcutBlocked && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey){

        const action = SMART_ALIGNMENT_KEY_ACTIONS[key];

        if(action && selectedSmartAlignmentNodes().length >= 2){

            e.preventDefault();

            applySmartNodeAlignment(action);

            return;

        }

    }

    if(!canvasShortcutBlocked){

        if(SmartCanvasShortcuts.matches(e, 'preview-selected')){

            if(e.repeat) return;

            if(previewSelectedSmartNode()) { e.preventDefault(); return; }

        }

        if(e.key === ' ' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey){

            if(e.repeat) return;

            e.preventDefault();

            runViewShortcut(() => cycleZViewport());

            return;

        }

    }

    if(SmartCanvasShortcuts.matches(e, 'select-all') && !canvasShortcutBlocked){

        e.preventDefault();

        selectAllSmartNodes();

        return;

    }

    if(SmartCanvasShortcuts.matches(e, 'duplicate') && !canvasShortcutBlocked){

        if(e.repeat) return;

        e.preventDefault();

        duplicateSelectedSmartNodes();

        return;

    }

    if(SmartCanvasShortcuts.matches(e, 'copy') && !canvasShortcutBlocked){

        const selectionText = window.getSelection?.().toString() || '';

        if(selectionText) return;

        e.preventDefault();

        copySelectedNodes();

        return;

    }

    if(SmartCanvasShortcuts.matches(e, 'paste') && !canvasShortcutBlocked && ctx.nodeClipboard()?.nodes?.length){

        const requestedAt = Date.now();

        setTimeout(() => {

            if(ctx.lastImagePasteAt() >= requestedAt || ctx.lastNodePasteAt() >= requestedAt) return;

            pasteNodes();

        }, 90);

        return;

    }

    if(SmartCanvasShortcuts.matches(e, 'undo') && !canvasShortcutBlocked){

        e.preventDefault();

        performUndo();

        return;

    }

    if(SmartCanvasShortcuts.matches(e, 'redo') && !canvasShortcutBlocked){

        e.preventDefault();

        performRedo();

        return;

    }

    if((SmartCanvasShortcuts.matches(e, 'delete') || (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.key === 'Delete')) && !canvasShortcutBlocked){

        if(e.repeat || !deleteSelectedSmartNodes()) return;

        e.preventDefault();

        e.stopPropagation();

        return;

    }

    if(SmartCanvasShortcuts.matches(e, 'ungroup-selected') && !canvasShortcutBlocked){

        if(e.repeat) return;

        const group = selectedNodeIds().map(id => ctx.nodes().find(node => node.id === id)).find(node => isSelectableSmartImageGroupMember(node) && node.images.length > 1);

        if(!group) return;

        e.preventDefault();

        e.stopPropagation();

        ungroupNode(group.id);

        return;

    }

    if(SmartCanvasShortcuts.matches(e, 'group-selected') && !canvasShortcutBlocked){

        if(e.repeat) return;

        e.preventDefault();

        e.stopPropagation();

        groupSelectedNodes();

        return;

    }

});

eventManager.addGlobal(window, 'blur', () => {

    if(smartCanvasState.interaction.pan){

        smartCanvasState.endInteraction('pan', {source:'window-blur'});

        shell.classList.remove('panning');

        smartCanvasState.interaction.didPan = false;

    }

    shell.classList.remove('selecting');

});

    return {
        runViewShortcut,
        cancelActiveCanvasInteraction
    };

}
