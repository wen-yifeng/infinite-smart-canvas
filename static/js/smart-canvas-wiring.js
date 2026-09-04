/*
 * smart-canvas-wiring.js — 事件总装/静态动作域（Phase 2 P2.9，自 smart-canvas.js 迁入）。
 *
 * ES module 工厂 `createWiring(ctx)`；可变共享状态经 ctx 访问器读写，
 * window 别名与 window 挂载名裸引用直达。DOM 结构与类名零漂移，函数体逐行保留
 * （仅可变绑定读写经 AST 引导精确改写为访问器调用）。
 * 域内包含：shell 滚轮/拖放/粘贴事件、运行与上传控件接线、素材与提示词面板
 * 全部 DOM 监听、composer 编辑态与 mention/模板按钮、媒体预览模态监听、
 * window resize/focus/studio 事件、bindSmartCanvasStaticActions、
 * bindAuroraGlassPointerRefraction（视觉系统指针折射）。
 */
export function createWiring(ctx) {

    const {
        SmartCanvasAssetLibraryView,
        activeAssetTabCategory,
        activeComposerNode,
        addFilesToActiveAssetLibrary,
        apiKindToggle,
        applyPromptTemplateToNode,
        applyTheme,
        applyViewport,
        assetAddCategoryBtn,
        assetAddFilesInput,
        assetCategoryPickerButton,
        assetCategoryPickerMenu,
        assetCategorySelect,
        assetCloseBtn,
        assetDialogBackdrop,
        assetGrid,
        assetLibraryIsLocal,
        assetLibraryPickerButton,
        assetLibraryPickerMenu,
        assetLibrarySelect,
        assetNodeImageFromItem,
        assetPanel,
        assetRenameCategoryBtn,
        assetToggle,
        backToCanvasList,
        bindAssetItemEvents,
        bindSmartCanvasTextEditTransaction,
        clearSmartExternalDropPreview,
        closeAllSmartPopovers,
        closeAssetPickers,
        closeMediaPreview,
        closeMentionPicker,
        closePromptPresetPanel,
        closePromptTemplatePanel,
        closeSmartCanvasLog,
        closeSmartCanvasShortcuts,
        closeSmartChatPanel,
        composer,
        composerClearPromptBtn,
        composerCopyPromptBtn,
        composerFocusUpstreamBtn,
        composerPastePromptBtn,
        composerPromptActionsEditable,
        composerTemplateBtn,
        copyTextToClipboard,
        createBlankPromptTemplate,
        createImageNodeAt,
        createNewSmartChatSession,
        createPromptPresetFromNode,
        createPromptTemplateGroup,
        currentPromptPreset,
        currentShellRect,
        deletePromptTemplate,
        deletePromptTemplateGroup,
        downloadPreviewImage,
        downstreamPromptLockBtn,
        dynamicParams,
        executeSmartCanvasCommand,
        fileInput,
        handleAssetLibraryUpdatedMessage,
        handleCanvasTaskUpdatedMessage,
        handleCanvasUpdatedMessage,
        handleFiles,
        handleSmartImageDropPayload,
        invalidateShellRectCache,
        isEditableTarget,
        isSupportedUploadFile,
        loadPromptTemplates,
        localAssetFolderPath,
        maybeOpenMentionPicker,
        mediaPreviewModal,
        mentionPicker,
        mentionPreview,
        openAssetNameDialog,
        openPromptTemplatePanel,
        openSmartCanvasSettings,
        pasteAssetsFromInbox,
        pasteNodes,
        primarySelectedNode,
        promptInput,
        promptPlainText,
        promptPresetApply,
        promptPresetClose,
        promptPresetDelete,
        promptPresetName,
        promptPresetNew,
        promptPresetPanel,
        promptPresetPanelNode,
        promptPresetSave,
        promptPresetSelect,
        promptPresetText,
        promptTemplateClose,
        promptTemplateLibrarySelect,
        promptTemplatePanel,
        promptTemplateSearch,
        readTextFromClipboard,
        refreshSmartConfigFromSettings,
        rememberCanvasAssetLibrarySelection,
        renamePromptTemplateGroup,
        render,
        renderAssetLibrary,
        renderDynamicParams,
        renderInputThumbsRow,
        renderPromptLibrarySelect,
        renderPromptPresetPanel,
        renderPromptTemplatePanel,
        replaceComposerPromptText,
        resetPromptPresetDeleteState,
        resolveSmartImageDropPayload,
        restoreComposerNodeSelection,
        runBtn,
        runGeneration,
        safeScale,
        saveCurrentPromptAsTemplate,
        saveMentionRange,
        savePromptDraftForCurrent,
        savePromptPresets,
        savePromptTemplateEdit,
        scheduleSave,
        screenToWorld,
        selectedNode,
        setAssetLibraryFromResponse,
        setLocalAssetLibraryFromResponse,
        setPromptPresetStatus,
        setSmartDropCopyEffect,
        setVideoOptionSectionOpen,
        shell,
        showComposerButtonFeedback,
        showDownstreamPromptLockAttention,
        smartCanvasAssetClient,
        smartCanvasState,
        smartChatPanel,
        smartChatView,
        smartComposer,
        switchComposerToUpstreamNode,
        syncSelectionUi,
        toast,
        toggleAssetLibrary,
        toggleComposerDock,
        toggleSmartCanvasLog,
        toggleSmartCanvasShortcuts,
        toggleSmartChatPanel,
        tr,
        unlockDownstreamPrompt,
        updateSmartExternalDragPreview,
        viewport
    } = ctx;

const promptTextWheelTarget = target => {

    const element = target instanceof Element ? target : target?.parentElement;

    return Boolean(element?.closest('#promptInput'));

};

const smartCanvasOverlayWheelTarget = target => {

    const element = target instanceof Element ? target : target?.parentElement;

    return Boolean(element?.closest('.smart-canvas-api-settings-modal,.composer,.smart-chat-panel,.smart-utility-cluster,.smart-selection-dock,.smart-viewport-controls,.smart-back,.media-preview-modal,.asset-panel,.asset-toggle,.smart-log-toggle,.smart-shortcut-toggle,.log-modal,.shortcut-modal,.prompt-preset-panel,.prompt-template-panel,.create-menu,.mention-picker,.provider-control .smart-popover,.size-picker-control .smart-popover'));

};

shell.addEventListener('wheel', e => {

    // Middle-button panning owns the gesture until release; wheel movement during it must never zoom.
    if(smartCanvasState.interaction.pan?.button === 1){
        e.preventDefault();
        e.stopPropagation();
        return;
    }

    // 智能画布统一在捕获阶段缩放：任意节点、图片及内部控件均生效；顶部提示词文本框、API 平台和尺寸选择弹层保留原生上下滚动。

    if(e.altKey && !e.ctrlKey && !e.metaKey && e.target?.closest?.('.provider-control[data-provider-scope] > .smart-pill')) return;

    if(promptTextWheelTarget(e.target) || smartCanvasOverlayWheelTarget(e.target)) return;

    e.preventDefault();

    e.stopPropagation();

    const rect = currentShellRect();

    const sx = e.clientX - rect.left;

    const sy = e.clientY - rect.top;

    const before = {x:(sx - viewport.x) / viewport.scale, y:(sy - viewport.y) / viewport.scale};

    const factor = Math.exp(-e.deltaY * 0.001);

    viewport.scale = safeScale(viewport.scale * factor);

    viewport.x = sx - before.x * viewport.scale;

    viewport.y = sy - before.y * viewport.scale;

    applyViewport();

    scheduleSave();

}, {passive:false, capture:true});

shell.ondragover = e => {
    setSmartDropCopyEffect(e, true);
    updateSmartExternalDragPreview(e);
};
shell.addEventListener('dragleave', event => {
    if(event.relatedTarget || (event.clientX > 0 && event.clientY > 0 && event.clientX < window.innerWidth && event.clientY < window.innerHeight)) return;
    clearSmartExternalDropPreview();
});

shell.ondrop = async e => {

    e.preventDefault();
    clearSmartExternalDropPreview();

    if(e.target.closest('.image-node')) return;

    const p = screenToWorld(e);

    const assetRaw = e.dataTransfer.getData('application/x-smart-asset');

    if(assetRaw){

        try {

            const asset = JSON.parse(assetRaw);

            if(asset?.url) {

                const created = executeSmartCanvasCommand('drop-asset-to-canvas', () => createImageNodeAt(p, [assetNodeImageFromItem(asset)], {skipUndo:true, skipRender:true, skipSave:true}), {skipRender:true, skipSave:true});
                if(created){
                    render({scope:'nodes', refreshConnections:false, refreshMinimap:true, refreshComposer:true});
                    scheduleSave();
                }

            }

            return;

        } catch {}

    }

    const payload = await resolveSmartImageDropPayload(e.dataTransfer);

    if(payload.type === 'none') return;

    await handleSmartImageDropPayload(payload, '', {point:p, forceNew:true});

};

eventManager.addGlobal(window, 'paste', e => {

    const files = [...(e.clipboardData?.files || [])].filter(isSupportedUploadFile);

    if(files.length){

        ctx.setLastImagePasteAt(Date.now());

        handleFiles(files, selectedId);

        return;

    }

    // 素材库管理页「复制到画布」过来的素材：Ctrl+V 批量粘贴成图片节点

    if(!isEditableTarget(e.target) && pasteAssetsFromInbox()){

        e.preventDefault();

        return;

    }

    if(ctx.nodeClipboard()?.nodes?.length && !isEditableTarget(e.target)){

        e.preventDefault();

        pasteNodes();

    }

});

// SMART_CANVAS_KEYBOARD_PACK_20260713


function syncApiKindToggleVisibility(){

    if(smartComposer){ smartComposer.syncApiKind(ctx.settings().apiKind || 'image'); return; }

    if(!apiKindToggle) return;

    apiKindToggle.style.display = 'inline-flex';

    apiKindToggle.querySelectorAll('[data-kind]').forEach(btn => btn.classList.toggle('active', btn.dataset.kind === (ctx.settings().apiKind || 'image')));

}

runBtn.onclick = () => runGeneration();

fileInput.onchange = () => {

    const groupPoint = ctx.pendingGroupUploadPoint();

    if(!fileInput.files?.length){

        ctx.setPendingGroupUploadPoint(null);

        ctx.setUploadTargetId('');

        return;

    }

    const targetId = groupPoint ? '' : (ctx.uploadTargetId() || selectedId);

    handleFiles(fileInput.files, targetId, groupPoint ? {point:groupPoint} : {});

    ctx.setPendingGroupUploadPoint(null);

    ctx.setUploadTargetId('');

    fileInput.value = '';

};

assetAddFilesInput?.addEventListener('change', async () => {
    const files = [...(assetAddFilesInput.files || [])];
    assetAddFilesInput.value = '';
    if(!files.length) return;
    try {
        await addFilesToActiveAssetLibrary(files);
    } catch(err) {
        toast(err.message || tr('smart.assetAddFail'));
    }
});

if(assetToggle) assetToggle.onclick = () => toggleAssetLibrary();

if(assetCloseBtn) assetCloseBtn.onclick = () => toggleAssetLibrary(false);

assetPanel?.addEventListener('pointerdown', e => e.stopPropagation());
assetPanel?.addEventListener('mousedown', e => e.stopPropagation());
assetPanel?.addEventListener('click', e => e.stopPropagation());
assetPanel?.addEventListener('wheel', e => {
    e.stopPropagation();
    const scroller = e.target.closest?.('.asset-grid') || assetGrid;
    if(!scroller || getComputedStyle(scroller).display === 'none') return;
    const canScroll = scroller.scrollHeight > scroller.clientHeight || scroller.scrollWidth > scroller.clientWidth;
    if(!canScroll) return;
    e.preventDefault();
    scroller.scrollTop += e.deltaY;
    scroller.scrollLeft += e.deltaX;
}, {passive:false, capture:true});

assetDialogBackdrop?.addEventListener('pointerdown', e => e.stopPropagation());

assetDialogBackdrop?.addEventListener('mousedown', e => e.stopPropagation());

assetDialogBackdrop?.addEventListener('click', e => e.stopPropagation());

promptPresetPanel?.addEventListener('pointerdown', e => e.stopPropagation());

promptPresetPanel?.addEventListener('mousedown', e => e.stopPropagation());

promptPresetPanel?.addEventListener('click', e => e.stopPropagation());

promptTemplatePanel?.addEventListener('pointerdown', e => e.stopPropagation());

promptTemplatePanel?.addEventListener('mousedown', e => e.stopPropagation());

promptTemplatePanel?.addEventListener('wheel', e => e.stopPropagation(), {passive:false});

promptTemplatePanel?.addEventListener('click', e => {

    e.stopPropagation();

    const apply = e.target.closest('[data-template-apply]');

    if(apply){ applyPromptTemplateToNode(apply.dataset.templateApply || 'positive'); return; }

    if(e.target.closest('[data-template-save-current]')){ saveCurrentPromptAsTemplate(); return; }

    if(e.target.closest('[data-template-new]')){ createBlankPromptTemplate(); return; }

    if(e.target.closest('[data-template-edit]')) { ctx.setPromptTemplateEditing(true); renderPromptTemplatePanel(); return; }

    if(e.target.closest('[data-template-edit-cancel]')) { ctx.setPromptTemplateEditing(false); renderPromptTemplatePanel(); return; }

    if(e.target.closest('[data-template-edit-save]')){ savePromptTemplateEdit(); return; }

    if(e.target.closest('[data-template-delete]')){ deletePromptTemplate(); return; }

    const cat = e.target.closest('[data-template-cat]');

    if(cat){

        ctx.setPromptTemplateCategory(cat.dataset.templateCat || 'all');

        ctx.setPromptTemplateSelectedId('');

        ctx.setPromptTemplateEditing(false);

        renderPromptTemplatePanel({preserveScroll:false});

        return;

    }

    const catEdit = e.target.closest('[data-template-cat-edit]');

    if(catEdit){

        const id = catEdit.dataset.templateCatEdit || '';

        renamePromptTemplateGroup(id);

        return;

    }

    const catDelete = e.target.closest('[data-template-cat-delete]');

    if(catDelete){

        deletePromptTemplateGroup(catDelete.dataset.templateCatDelete || '');

        return;

    }

    if(e.target.closest('[data-template-group-edit]')){

        ctx.setPromptTemplateGroupEditMode(!ctx.promptTemplateGroupEditMode());

        renderPromptTemplatePanel({preserveScroll:false});

        return;

    }

    if(e.target.closest('[data-template-cat-new]')) { createPromptTemplateGroup(); return; }

    const card = e.target.closest('[data-template-id]');

    if(card){

        ctx.setPromptTemplateSelectedId(card.dataset.templateId || '');

        ctx.setPromptTemplateEditing(false);

        renderPromptTemplatePanel();

        return;

    }

});

if(promptPresetClose) promptPresetClose.onclick = closePromptPresetPanel;

if(promptTemplateClose) promptTemplateClose.onclick = closePromptTemplatePanel;

let promptTemplateSearchTimer = 0;

if(promptTemplateSearch) promptTemplateSearch.oninput = () => {
    if(promptTemplateSearchTimer) clearTimeout(promptTemplateSearchTimer);
    promptTemplateSearchTimer = setTimeout(() => {
        promptTemplateSearchTimer = 0;
        renderPromptTemplatePanel({preserveScroll:false});
    }, 150);
};

if(promptTemplateLibrarySelect) promptTemplateLibrarySelect.onchange = async () => {

    ctx.setActivePromptLibraryId(promptTemplateLibrarySelect.value || 'system');

    ctx.setPromptTemplateSelectedId('');

    // 切换词库必须重置分类筛选，否则上一个库的分类（如系统的“视角”）会把新库内容过滤为空。

    ctx.setPromptTemplateCategory('all');

    ctx.setPromptTemplateEditing(false);

    // 拉取最新数据，确保素材库管理里新建/新增的词库与提示词在画布即时可见。

    const want = ctx.activePromptLibraryId();

    try { await loadPromptTemplates(); } catch(e){}

    if(ctx.promptLibraries().some(lib => lib.id === want)) ctx.setActivePromptLibraryId(want);

    renderPromptLibrarySelect();

    renderPromptTemplatePanel({preserveScroll:false});

};

if(composerFocusUpstreamBtn){
    composerFocusUpstreamBtn.onclick = event => {
        event.preventDefault();
        event.stopPropagation();
        // Switching editor target must not move the viewport or show an error-style feedback state.
        switchComposerToUpstreamNode();
    };
}

if(composerTemplateBtn) composerTemplateBtn.onclick = event => {

    event.preventDefault();

    event.stopPropagation();

    if(promptTemplatePanel?.classList?.contains('open') && promptTemplatePanel.dataset.target === 'composer'){

        closePromptTemplatePanel();

        return;

    }

    openPromptTemplatePanel(activeComposerNode()?.id || selectedNode()?.id || '', ctx.promptTemplateSelectedId(), {target:'composer'});

};

if(composerCopyPromptBtn) composerCopyPromptBtn.onclick = async event => {
    event.preventDefault();
    event.stopPropagation();
    const feedbackButton = event.currentTarget;
    if(!composerPromptActionsEditable()) return;
    const text = promptPlainText();
    if(!text){
        showComposerButtonFeedback(feedbackButton, '无内容', 'error');
        return;
    }
    const copied = await copyTextToClipboard(text);
    showComposerButtonFeedback(feedbackButton, copied ? '已复制' : '复制失败', copied ? 'success' : 'error');
};

if(composerPastePromptBtn) composerPastePromptBtn.onclick = async event => {
    event.preventDefault();
    event.stopPropagation();
    const feedbackButton = event.currentTarget;
    if(!composerPromptActionsEditable()) return;
    const clipboard = await readTextFromClipboard();
    if(!clipboard.ok){
        showComposerButtonFeedback(feedbackButton, '无权限', 'error');
        return;
    }
    if(!clipboard.text.trim()){
        showComposerButtonFeedback(feedbackButton, '剪贴板空', 'error');
        return;
    }
    if(replaceComposerPromptText(clipboard.text, 'paste-composer-prompt')) showComposerButtonFeedback(feedbackButton, '已粘贴', 'success');
};

if(composerClearPromptBtn) composerClearPromptBtn.onclick = event => {
    event.preventDefault();
    event.stopPropagation();
    const feedbackButton = event.currentTarget;
    if(!composerPromptActionsEditable()) return;
    if(!promptPlainText()){
        showComposerButtonFeedback(feedbackButton, '已为空', 'neutral');
        return;
    }
    if(replaceComposerPromptText('', 'clear-composer-prompt')) showComposerButtonFeedback(feedbackButton, '已清空', 'success');
};

if(promptPresetSelect) promptPresetSelect.onchange = () => renderPromptPresetPanel(promptPresetSelect.value);

[promptPresetName, promptPresetText].forEach(input => {

    input?.addEventListener('input', () => {

        resetPromptPresetDeleteState();

        setPromptPresetStatus(tr('smart.promptPresetEditing'));

    });

});

if(promptPresetApply) promptPresetApply.onclick = () => {

    const preset = currentPromptPreset(promptPresetSelect.value);

    const node = promptPresetPanelNode();

    if(!preset || !node) return;

    executeSmartCanvasCommand('apply-prompt-preset', () => {

        node.promptPresetId = preset.id;

        node.text = preset.text || '';

        return true;

    }, {skipRender:true});

    closePromptPresetPanel();

};

if(promptPresetSave) promptPresetSave.onclick = () => {

    const preset = currentPromptPreset(promptPresetSelect.value);

    if(!preset) return;

    const name = promptPresetName.value.trim();

    const text = promptPresetText.value.trim();

    if(!name || !text){ setPromptPresetStatus(tr('smart.promptPresetRequired'), 'warn'); return; }

    const idx = ctx.promptPresets().findIndex(p => p.id === preset.id);

    if(idx >= 0) ctx.promptPresets()[idx] = {...ctx.promptPresets()[idx], name, text, updatedAt:Date.now()};

    savePromptPresets();

    const node = promptPresetPanelNode();

    if(node?.promptPresetId === preset.id){

        executeSmartCanvasCommand('edit-prompt-preset-node', () => {

            node.text = text;

            return true;

        }, {skipRender:true});

    }

    renderPromptPresetPanel(preset.id, tr('smart.promptPresetSaved'));

    setPromptPresetStatus(tr('smart.promptPresetSaved'), 'ok');

    render();

};

if(promptPresetNew) promptPresetNew.onclick = () => {

    const node = promptPresetPanelNode();

    const preset = createPromptPresetFromNode(node, {openPanel:false});

    if(!preset) return;

    renderPromptPresetPanel(preset.id, tr('smart.promptPresetSavedNew'));

    setPromptPresetStatus(tr('smart.promptPresetSavedNew'), 'ok');

    promptPresetName?.focus();

    promptPresetName?.select();

};

if(promptPresetDelete) promptPresetDelete.onclick = () => {

    const preset = currentPromptPreset(promptPresetSelect.value);

    if(!preset) return;

    if(!ctx.promptPresetDeleteArmed()){

        ctx.setPromptPresetDeleteArmed(true);

        promptPresetDelete.textContent = tr('smart.promptPresetDeleteAgain');

        promptPresetDelete.classList.add('confirm-danger');

        setPromptPresetStatus(tr('smart.promptPresetDeleteConfirm').replace('{name}', preset.name || tr('smart.promptPresetUnnamed')), 'warn');

        return;

    }

    ctx.setPromptPresets(ctx.promptPresets().filter(p => p.id !== preset.id));

    const linkedNodes = ctx.nodes().filter(node => node.promptPresetId === preset.id);

    if(linkedNodes.length){

        executeSmartCanvasCommand('unlink-deleted-prompt-preset', () => {

            linkedNodes.forEach(node => { node.promptPresetId = ''; });

            return true;

        }, {skipRender:true});

    }

    savePromptPresets();

    renderPromptPresetPanel(ctx.promptPresets()[0]?.id || '', tr('smart.promptPresetDeleted'));

    setPromptPresetStatus(tr('smart.promptPresetDeleted'), 'ok');

    render();

};

if(assetLibrarySelect) assetLibrarySelect.onchange = () => {
    ctx.setActiveAssetLibraryId(assetLibrarySelect.value || '');
    ctx.setActiveAssetCategoryId('');
    ctx.setMentionAssetCategoryId('');
    renderAssetLibrary();
    rememberCanvasAssetLibrarySelection();
};

if(assetCategorySelect) assetCategorySelect.onchange = () => {
    ctx.setActiveAssetCategoryId(assetCategorySelect.value);
    renderAssetLibrary();
    rememberCanvasAssetLibrarySelection();
};

ctx.setAssetPickerController(SmartCanvasAssetLibraryView.createPickerController([
    {select:assetLibrarySelect, button:assetLibraryPickerButton, menu:assetLibraryPickerMenu},
    {select:assetCategorySelect, button:assetCategoryPickerButton, menu:assetCategoryPickerMenu}
]));
ctx.assetPickerController().bindAll();
bindAssetItemEvents();

if(assetAddCategoryBtn) assetAddCategoryBtn.onclick = async () => {
    const fallbackName = tr('smart.assetFolder');
    const name = await openAssetNameDialog({title:tr('smart.assetNewFolder'), value:fallbackName, placeholder:fallbackName});
    if(!name) return;
    if(assetLibraryIsLocal()){
        const data = await smartCanvasAssetClient.createLocalFolder(localAssetFolderPath(), name);
        setLocalAssetLibraryFromResponse(data);
        ctx.setActiveAssetCategoryId(data.folder?.path || ctx.activeAssetCategoryId());
        renderAssetLibrary();
        return;
    }
    const data = await smartCanvasAssetClient.createCategory({library_id:ctx.activeAssetLibraryId(), name, type:'image'});
    ctx.setActiveAssetCategoryId(data.category?.id || '');
    setAssetLibraryFromResponse(data);
};

if(assetRenameCategoryBtn) assetRenameCategoryBtn.onclick = async () => {

    const cat = activeAssetTabCategory();

    if(!cat) return;

    const name = await openAssetNameDialog({title:tr('smart.assetRenameFolder'), value:cat.name || '', placeholder:tr('smart.assetFolder')});

    if(!name) return;

    if(assetLibraryIsLocal()){

        const data = await smartCanvasAssetClient.renameLocalFolder(cat.id || '', name);

        setLocalAssetLibraryFromResponse(data);

        ctx.setActiveAssetCategoryId(data.folder?.path || ctx.activeAssetCategoryId());

        renderAssetLibrary();

        return;

    }

    const data = await smartCanvasAssetClient.renameCategory(cat.id, name);

    setAssetLibraryFromResponse(data);

};


function clearComposerPromptEditing(){
    if(!ctx.composerPromptEditingNodeId() && document.activeElement !== promptInput) return;
    ctx.setComposerPromptEditingNodeId('');
    closeMentionPicker();
    if(document.activeElement === promptInput) promptInput.blur();
    syncSelectionUi();
}

function activateComposerPromptEditing(){
    restoreComposerNodeSelection();
    const node = primarySelectedNode() || activeComposerNode();
    if(!node) return false;
    ctx.setComposerPromptEditingNodeId(node.id);
    syncSelectionUi();
    return true;
}

function exitComposerPromptEditing(event){
    if(!ctx.composerPromptEditingNodeId() && document.activeElement !== promptInput) return;
    const target = event?.target;
    // A pointer inside the Composer may move focus; the prompt blur handler clears this state.
    if(target instanceof Element && (composer.contains(target) || mentionPicker?.contains(target))) return;
    clearComposerPromptEditing();
}

function handleSmartCanvasDocumentPointerDown(event){
    if(!event.target.closest?.('.asset-select-shell')) closeAssetPickers();
    exitComposerPromptEditing(event);
    if(ctx.videoParamsExpanded() && !event.target.closest?.('.video-options-control')){
        ctx.setVideoParamsExpanded(false);
        const control = dynamicParams?.querySelector('.video-options-control');
        control?.classList.remove('open');
        control?.querySelector('[data-video-options-toggle]')?.setAttribute('aria-expanded', 'false');
    }
    if(!smartChatPanel?.contains(event.target)) smartChatView.closeAll();
}

eventManager.addGlobal(document, 'pointerdown', handleSmartCanvasDocumentPointerDown, true);

composer.addEventListener('pointerdown', event => {
    // Keep ordinary Composer controls isolated from canvas clicks without marking the node as prompt-editing.
    event.stopPropagation();
});

composer.addEventListener('mousedown', event => event.stopPropagation());

dynamicParams?.addEventListener('pointerdown', event => {
    if(event.target.closest('.param-line-provider,.param-line-model,.param-line-size-quality')) restoreComposerNodeSelection();
}, true);

composer.addEventListener('click', event => {

    const videoSectionToggle = event.target.closest('[data-video-options-section-toggle]');
    if(videoSectionToggle){
        event.preventDefault();
        const section = videoSectionToggle.dataset.videoOptionsSectionToggle || '';
        const open = videoSectionToggle.getAttribute('aria-expanded') !== 'true';
        setVideoOptionSectionOpen(section, open);
        const sectionElement = videoSectionToggle.closest('[data-video-options-section]');
        sectionElement?.classList.toggle('is-open', open);
        videoSectionToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        event.stopPropagation();
        return;
    }

    const videoOptionsToggle = event.target.closest('[data-video-options-toggle]');
    if(videoOptionsToggle){
        event.preventDefault();
        ctx.setVideoParamsExpanded(!ctx.videoParamsExpanded());
        const control = videoOptionsToggle.closest('.video-options-control');
        control?.classList.toggle('open', ctx.videoParamsExpanded());
        videoOptionsToggle.setAttribute('aria-expanded', ctx.videoParamsExpanded() ? 'true' : 'false');
        event.stopPropagation();
        return;
    }

    // 点「生成」按钮不要收起已展开的参数栏:否则每生成一次参数栏就被收起,需重新点开。

    // 参数控件(.smart-control)内部点击本就不关;运行按钮也排除,让参数栏熬过生成与重渲染。

    if(!event.target.closest('.smart-control') && !event.target.closest('#runBtn')) closeAllSmartPopovers();

    event.stopPropagation();

});

promptInput.addEventListener('input', maybeOpenMentionPicker);

promptInput.addEventListener('focus', () => {
    activateComposerPromptEditing();
});

promptInput.addEventListener('click', event => {
    if(promptInput.dataset.downstreamPromptLocked !== '1') return;
    event.preventDefault();
    showDownstreamPromptLockAttention();
});

downstreamPromptLockBtn?.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    unlockDownstreamPrompt();
});

promptInput.addEventListener('beforeinput', () => {
    activateComposerPromptEditing();
});

// The downstream-editing state is strictly tied to the prompt field, not other Composer controls.
promptInput.addEventListener('blur', clearComposerPromptEditing);

bindSmartCanvasTextEditTransaction(promptInput, 'edit-composer-prompt', () => {

    restoreComposerNodeSelection();
    delete promptInput.dataset.preserveDraftOnce;

    savePromptDraftForCurrent();

    renderInputThumbsRow(activeComposerNode());

    return true;

});

promptInput.addEventListener('keyup', maybeOpenMentionPicker);

promptInput.addEventListener('mouseup', saveMentionRange);

promptInput.addEventListener('focus', saveMentionRange);

promptInput.addEventListener('keydown', event => {

    if(event.key === 'Escape') clearComposerPromptEditing();

});

promptInput.addEventListener('mouseover', event => {

    const token = event.target.closest?.('.mention-image-token');

    if(!token) return;

    // 音频没有可预览的图像，不能把音频 URL 塞进 <img>（会显示破损图标），直接不弹悬浮预览。

    if(token.dataset.kind === 'audio'){ mentionPreview.style.display = 'none'; return; }

    let media = mentionPreview.querySelector('img,video');

    const isVideo = token.dataset.kind === 'video' || isVideoMediaItem({url:token.dataset.url, kind:token.dataset.kind});

    if(isVideo && media?.tagName?.toLowerCase() !== 'video'){

        media?.replaceWith(document.createElement('video'));

        media = mentionPreview.querySelector('video');

    } else if(!isVideo && media?.tagName?.toLowerCase() !== 'img'){

        media?.replaceWith(document.createElement('img'));

        media = mentionPreview.querySelector('img');

    }

    if(isVideo){

        media.muted = true;

        media.loop = true;

        media.playsInline = true;

        media.preload = 'metadata';

        media.disablePictureInPicture = true;

        media.setAttribute('disablepictureinpicture', '');

        media.setAttribute('controlslist', 'nodownload noplaybackrate noremoteplayback');

        media.src = token.dataset.url || '';

        media.play?.().catch(() => {});

    } else {

        media.src = token.dataset.url || '';

        media.alt = 'preview';

    }

    const rect = token.getBoundingClientRect();

    mentionPreview.style.left = `${Math.min(window.innerWidth - 236, rect.left)}px`;

    mentionPreview.style.top = `${Math.min(window.innerHeight - 236, rect.bottom + 8)}px`;

    mentionPreview.style.display = 'block';

});

promptInput.addEventListener('mouseout', event => {

    if(event.target.closest?.('.mention-image-token')){

        mentionPreview.style.display = 'none';

        const media = mentionPreview.querySelector('img,video');

        media?.pause?.();

        media?.removeAttribute('src');

        media?.load?.();

    }

});

mentionPicker.addEventListener('mousedown', event => event.stopPropagation());

eventManager.addGlobal(document, 'click', event => {

    if(!event.target.closest('.smart-control')) closeAllSmartPopovers();

    if(!event.target.closest('.mention-picker') && !event.target.closest('#promptInput') && !event.target.closest('[data-input-add-reference]')) closeMentionPicker();

    if(!event.target.closest('.prompt-preset-panel') && !event.target.closest('.prompt-preset-edit') && !event.target.closest('.prompt-preset-save')) closePromptPresetPanel();

    if(!event.target.closest('.prompt-template-panel') && !event.target.closest('.prompt-preset-edit') && !event.target.closest('#composerTemplateBtn')) closePromptTemplatePanel();

});

// CODEX 2026.08.09: 改用 pointerdown/up 配合，避免拖拽后误触关闭
let mediaPreviewPointerDownTarget = null;
mediaPreviewModal?.addEventListener('pointerdown', event => {
    mediaPreviewPointerDownTarget = event.target;
});
mediaPreviewModal?.addEventListener('pointerup', event => {
    const downOnBlank = mediaPreviewPointerDownTarget && !mediaPreviewPointerDownTarget.closest('.preview-image-frame');
    const upOnBlank = event.target && !event.target.closest('.preview-image-frame');
    if (downOnBlank && upOnBlank) {
        closeMediaPreview();
    }
    mediaPreviewPointerDownTarget = null;
});

eventManager.addGlobal(window, 'resize', () => {

    invalidateShellRectCache();

});

eventManager.addGlobal(window, 'studio-theme-change', event => applyTheme(event.detail?.theme || 'dark'));

try {

    const apiChannel = new BroadcastChannel('studio-api');

    apiChannel.onmessage = async event => {

        if(event.data?.type === 'providers-changed'){

            await refreshSmartConfigFromSettings();

        }

        if(event.data?.type === 'asset_library_updated') handleAssetLibraryUpdatedMessage(event.data);

        if(event.data?.type === 'canvas_updated') handleCanvasUpdatedMessage(event.data);

        if(event.data?.type === 'canvas_task_updated') handleCanvasTaskUpdatedMessage(event.data);

    };

} catch(e) {}

eventManager.addGlobal(window, 'focus', () => {

    if(Date.now() - ctx.lastConfigRefreshAt() > 1200) refreshSmartConfigFromSettings();

});

eventManager.addGlobal(window, 'studio-lang-change', () => {

    renderDynamicParams();

    renderInputThumbsRow(selectedNode());

    renderAssetLibrary();
if(promptTemplatePanel?.classList?.contains('open')) renderPromptTemplatePanel();

    render();

});

function bindSmartCanvasStaticActions(){

    if(ctx.smartCanvasActionDispatcher() || typeof SmartCanvasActionDispatcher !== 'function') return;

    const root = document.getElementById('smartCanvasUiOverlay') || document;

    ctx.setSmartCanvasActionDispatcher(new SmartCanvasActionDispatcher({root}));

    ctx.smartCanvasActionDispatcher().registerMany({

        'back-to-canvas-list': () => backToCanvasList(),

        'open-settings': () => openSmartCanvasSettings(),

        'open-shortcuts': () => toggleSmartCanvasShortcuts(),

        'open-log': () => toggleSmartCanvasLog(),

        'toggle-chat': () => toggleSmartChatPanel(),
        'toggle-composer-surface': () => toggleComposerDock(),
        'close-chat': () => closeSmartChatPanel(),
        'new-chat': () => createNewSmartChatSession(),

        'close-log': () => closeSmartCanvasLog(),

        'scroll-log-top': () => {
            const list = document.getElementById('smartLogList');
            if(list) list.scrollTo({ top: 0, behavior: 'smooth' });
        },

        'close-shortcuts': () => closeSmartCanvasShortcuts(),

        'download-preview': () => downloadPreviewImage(),

    });

    ctx.smartCanvasActionDispatcher().start();

}

/* AURORA_GLASS_POINTER_REFRACTION_PHASE3_20260728
   One delegated pointer tracker updates only the optical control under the pointer. */
function bindAuroraGlassPointerRefraction(){
    const selector = [
        'button:not(.downstream-prompt-lock):not([data-av-interaction="top"])',
        '.log-item',
        '.prompt-template-card',
        '.direct-option',
        '.size-picker-option',
        '.provider-picker-option',
        '.provider-option'
    ].join(',');
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let activeTarget = null;
    let activeTargetRect = null;
    let pendingPointer = null;
    let pointerFrame = 0;

    const clearActiveTarget = () => {
        if(activeTarget){
            activeTarget.style.removeProperty('--av-glass-x');
            activeTarget.style.removeProperty('--av-glass-y');
        }
        activeTarget = null;
        activeTargetRect = null;
        pendingPointer = null;
        if(pointerFrame){
            cancelAnimationFrame(pointerFrame);
            pointerFrame = 0;
        }
    };

    const invalidateTargetRect = () => {
        activeTargetRect = null;
        if(activeTarget){
            activeTarget.style.removeProperty('--av-glass-x');
            activeTarget.style.removeProperty('--av-glass-y');
        }
    };

    const pointerRefractionSuspended = () => Boolean(
        document.hidden
        || reducedMotion?.matches
        || document.body.classList.contains('smart-node-drag')
        || document.body.classList.contains('smart-node-resize')
        || shell?.classList.contains('panning')
        || shell?.classList.contains('zoom-preview')
    );

    const paintPointerRefraction = () => {
        pointerFrame = 0;
        const pointer = pendingPointer;
        pendingPointer = null;
        if(!pointer || pointerRefractionSuspended()) {
            clearActiveTarget();
            return;
        }
        const origin = pointer.target instanceof Element ? pointer.target : null;
        const target = origin?.closest?.(selector);
        if(!target || target.matches(':disabled')) {
            clearActiveTarget();
            return;
        }
        if(activeTarget !== target) {
            if(activeTarget){
                activeTarget.style.removeProperty('--av-glass-x');
                activeTarget.style.removeProperty('--av-glass-y');
            }
            activeTarget = target;
            activeTargetRect = null;
        }
        const rect = activeTargetRect || (activeTargetRect = target.getBoundingClientRect());
        if(rect.width <= 0 || rect.height <= 0) {
            clearActiveTarget();
            return;
        }
        const x = Math.max(0, Math.min(rect.width, pointer.clientX - rect.left));
        const y = Math.max(0, Math.min(rect.height, pointer.clientY - rect.top));
        target.style.setProperty('--av-glass-x', `${x.toFixed(1)}px`);
        target.style.setProperty('--av-glass-y', `${y.toFixed(1)}px`);
    };

    eventManager.addGlobal(document, 'pointermove', event => {
        if(event.pointerType && event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
        if(pointerRefractionSuspended()) {
            if(activeTarget) clearActiveTarget();
            return;
        }
        const origin = event.target instanceof Element ? event.target : null;
        const target = origin?.closest?.(selector);
        if(!target || target.matches(':disabled')) {
            if(!activeTarget) return;
        }
        pendingPointer = event;
        if(!pointerFrame) pointerFrame = requestAnimationFrame(paintPointerRefraction);
    }, {passive:true});
    eventManager.addGlobal(document, 'pointerleave', clearActiveTarget, {passive:true});
    eventManager.addGlobal(document, 'pointercancel', clearActiveTarget, {passive:true});
    eventManager.addGlobal(window, 'blur', clearActiveTarget, {passive:true});
    eventManager.addGlobal(window, 'resize', invalidateTargetRect, {passive:true});
    eventManager.addGlobal(window, 'scroll', invalidateTargetRect, {passive:true, capture:true});
    function handlePointerRefractionVisibilityChange(){
        if(document.hidden) clearActiveTarget();
    }
    eventManager.addGlobal(document, 'visibilitychange', handlePointerRefractionVisibilityChange, {passive:true});
    reducedMotion?.addEventListener?.('change', clearActiveTarget);
}

    return {
        syncApiKindToggleVisibility,
        clearComposerPromptEditing,
        bindSmartCanvasStaticActions,
        bindAuroraGlassPointerRefraction
    };

}
