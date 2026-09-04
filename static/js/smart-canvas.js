const { escapeAttr, escapeHtml, refreshIcons, tr, uid } = window.SmartCanvasUiUtils;

// ===== API 设置 iframe 域桥接（P2.10①）：实现在 smart-canvas-api-settings-view.js =====
const apiSettingsView = createApiSettingsView({
    applyTheme,
    handleAssetLibraryUpdatedMessage,
    handleCanvasTaskUpdatedMessage,
    handleCanvasUpdatedMessage,
    refreshIcons,
    refreshSmartConfigFromSettings,
});
function openSmartCanvasSettings(...args){ return apiSettingsView.openSmartCanvasSettings(...args); }

import { createDragController } from './smart-canvas-drag-controller.js';

import { createOverlayViews } from './smart-canvas-overlay-views.js';

import { createComposerView } from './smart-canvas-composer-view.js';
import { createPromptLibraryView } from './smart-canvas-prompt-library-view.js';
import { createReferenceGraph } from './smart-canvas-reference-graph.js';
import { createAssetPanelView } from './smart-canvas-asset-panel-view.js';
import { createParameterDomain } from './smart-canvas-parameter-domain.js';
import { createViewportDomain } from './smart-canvas-viewport-domain.js';
import { createLogStatus } from './smart-canvas-log-status.js';
import { createComposerSubject } from './smart-canvas-composer-subject.js';
import { createNodeModel } from './smart-canvas-node-model.js';
import { createMediaPreview } from './smart-canvas-media-preview-helpers.js';
import { createSelectionAlign } from './smart-canvas-selection-align.js';
import { createNodeHelpers } from './smart-canvas-node-helpers.js';
import { createWiring } from './smart-canvas-wiring.js';
import { createLoadSave } from './smart-canvas-load-save.js';
import { createKeyboardDomain } from './smart-canvas-keyboard-domain.js';
import { createConnectionsDomain } from './smart-canvas-connections-domain.js';
import { createUploadDrop } from './smart-canvas-upload-drop.js';
import { createMediaView } from './smart-canvas-media-view.js';
import { createApiSettingsView } from './smart-canvas-api-settings-view.js';
import { createRunPipeline } from './smart-canvas-run-pipeline.js';
import { createCanvasSyncDomain } from './smart-canvas-sync-domain.js';

const SmartCanvasShortcuts = window.SmartCanvasShortcuts;
const SmartCanvasPromptWorkbenchView = window.SmartCanvasPromptWorkbenchView;
const SmartCanvasAssetLibraryView = window.SmartCanvasAssetLibraryView;
const SmartCanvasVisualAssistantView = window.SmartCanvasVisualAssistantView;
const smartCanvasCommandMenuView = window.SmartCanvasCommandMenuView.create({escapeHtml});
let assetPickerController = null;
const params = new URLSearchParams(location.search);

const canvasId = params.get('id') || '';

const sourceProjectId = params.get('project') || '';

const CANVAS_LIST_PROJECT_KEY = 'canvasListCurrentProjectId';
const SMART_LAST_CANVAS_KEY = 'smartCanvas.lastCanvas.v1';
const SMART_CHAT_SELECT_TRIGGER_SELECTOR = '[data-smart-chat-select-trigger]';
const SMART_PREVIEW_IMAGE_SELECTOR = 'img.preview-media';

function rememberLastCanvasLocation(id, project='default'){
    if(!id) return;
    try { localStorage.setItem(SMART_LAST_CANVAS_KEY, JSON.stringify({id:String(id), project:project || 'default'})); } catch(e){}
}


const shell = document.getElementById('shell');

function resetShellNativeScroll(){
    if(!shell) return;
    if(shell.scrollLeft !== 0) shell.scrollLeft = 0;
    if(shell.scrollTop !== 0) shell.scrollTop = 0;
}

shell?.addEventListener('scroll', resetShellNativeScroll, {passive:true});
resetShellNativeScroll();

function normalizeSmartCanvasButtonHint(button){
    if(!(button instanceof HTMLButtonElement) || !button.hasAttribute('title')) return;
    if(button.closest('[data-native-title]')) return;
    const hint = String(button.getAttribute('title') || '').trim();
    if(hint && (!button.getAttribute('aria-label') || button.dataset.smartAriaFromTitle === '1')) {
        button.setAttribute('aria-label', hint);
        button.dataset.smartAriaFromTitle = '1';
    }
    button.removeAttribute('title');
}

function normalizeSmartCanvasButtonHints(root=document){
    if(root instanceof HTMLButtonElement) normalizeSmartCanvasButtonHint(root);
    root.querySelectorAll?.('button[title]').forEach(normalizeSmartCanvasButtonHint);
}

normalizeSmartCanvasButtonHints();
new MutationObserver(mutations => {
    mutations.forEach(mutation => {
        if(mutation.target.closest('#world')) return;
        if(mutation.type === 'attributes') {
            normalizeSmartCanvasButtonHint(mutation.target);
            return;
        }
        mutation.addedNodes.forEach(node => {
            if(node.nodeType === Node.ELEMENT_NODE && !node.closest?.('#world')) normalizeSmartCanvasButtonHints(node);
        });
    });
}).observe(document.body, {subtree:true, childList:true, attributes:true, attributeFilter:['title']});

const world = document.getElementById('world');

const composer = document.getElementById('composer');

const composerCollapseBtn = document.getElementById('composerCollapseBtn');
const composerTaskStatusSlot = document.getElementById('composerTaskStatusSlot');
const composerFocusUpstreamBtn = document.getElementById('composerFocusUpstreamBtn');

const createMenu = document.getElementById('createMenu');
const canvasCommandList = document.getElementById('canvasCommandList');

const promptInput = document.getElementById('promptInput');
const downstreamPromptLockBtn = document.getElementById('downstreamPromptLockBtn');

const mentionPicker = document.getElementById('mentionPicker');

const mentionPreview = document.getElementById('mentionPreview');

const dynamicParams = document.getElementById('dynamicParams');

const runBtn = document.getElementById('runBtn');

const fileInput = document.getElementById('fileInput');

const apiKindToggle = document.getElementById('apiKindToggle');

const inputThumbsRow = document.getElementById('inputThumbsRow');

const SMART_UPLOAD_MAX = 20;

const SMART_REFERENCE_IMAGE_MAX = 20;

const inputPromptPreview = document.getElementById('inputPromptPreview');

const minimap = document.getElementById('minimap');

const minimapContent = document.getElementById('minimapContent');const smartTaskStatus = document.getElementById('smartTaskStatus');

const smartTaskStatusText = document.getElementById('smartTaskStatusText');
const smartSaveStatus = document.getElementById('smartSaveStatus');

const smartTitle = document.getElementById('smartTitle');
const smartCanvasContextName = document.getElementById('smartCanvasContextName');
const smartCanvasNodeCount = document.getElementById('smartCanvasNodeCount');

const smartCanvasEmptyState = document.getElementById('smartCanvasEmptyState');

const smartViewportControls = document.getElementById('smartViewportControls');

const smartZoomOutBtn = document.getElementById('smartZoomOutBtn');

const smartZoomLabel = document.getElementById('smartZoomLabel');

const smartZoomInBtn = document.getElementById('smartZoomInBtn');

const smartShowAllBtn = document.getElementById('smartShowAllBtn');

const smartFocusSelectionBtn = document.getElementById('smartFocusSelectionBtn');
const smartAgentStatus = document.getElementById('smartAgentStatus');
const smartAgentStatusText = document.getElementById('smartAgentStatusText');
const smartSelectionDock = document.getElementById('smartSelectionDock');
const smartSelectionDockLabel = document.getElementById('smartSelectionDockLabel');
const smartCommandDock = document.getElementById('smartCommandDock');

const mediaPreviewModal = document.getElementById('mediaPreviewModal');

const previewStage = document.getElementById('previewStage');

const previewMediaHost = document.getElementById('previewMediaHost');
const previewResolution = document.getElementById('previewResolution');
const previewNavHint = document.getElementById('previewNavHint');
const previewLocateBtn = document.getElementById('previewLocateBtn');
const previewCloseBtn = document.getElementById('previewCloseBtn');
const previewPrevBtn = document.getElementById('previewPrevBtn');
const previewNextBtn = document.getElementById('previewNextBtn');

const smartLogModal = document.getElementById('smartLogModal');

const smartLogList = document.getElementById('smartLogList');

const smartLogSummary = document.getElementById('smartLogSummary');
const smartLogToggle = document.getElementById('smartLogToggle');
const smartChatToggle = document.getElementById('smartChatToggle');
const smartComposerToggle = document.getElementById('smartComposerToggle');
const smartChatPanel = document.getElementById('smartChatPanel');
const smartChatPanelBody = document.getElementById('smartChatPanelBody');
const smartChatPanelTitle = document.getElementById('smartChatPanelTitle');
const smartChatPanelMeta = document.getElementById('smartChatPanelMeta');

// The log can hold hundreds of entries. Keep its DOM until the underlying log
// changes so opening and closing the panel stays a pure surface transition.
let smartLogRenderVersion = 0;
let smartLogRenderedVersion = -1;
let smartLogRenderFrame = 0;
const SMART_LOG_INITIAL_RENDER_COUNT = 40;
const SMART_LOG_RENDER_STEP = 20;
let smartLogVisibleCount = 0;
let smartLogLoadingMore = false;
let smartLogServerLoaded = false;
let smartCanvasLogsCache = [];
let smartCanvasLogsTotal = 0;
let smartCanvasLogsSummary = {success:0, running:0, failed:0};

smartLogList?.addEventListener('scroll', () => {
    if(smartLogLoadingMore) return;
    if(smartLogServerLoaded && smartCanvasLogsCache.length >= smartCanvasLogsTotal) return;
    if(smartLogList.scrollTop + smartLogList.clientHeight < smartLogList.scrollHeight - 180) return;
    loadSmartCanvasLogs({offset: smartCanvasLogsCache.length, limit: SMART_LOG_RENDER_STEP});
}, {passive:true});

const smartShortcutModal = document.getElementById('smartShortcutModal');
const smartShortcutList = document.getElementById('smartShortcutList');
const smartShortcutToggle = document.getElementById('smartShortcutToggle');
const selectionBox = document.getElementById('selectionBox');
SmartCanvasShortcuts.renderHelp(smartShortcutList);

/* Settings now live on the homepage only; the canvas has no in-page settings surface. */

const SMART_ALIGNMENT_KEY_ACTIONS = Object.freeze({v:'left', e:'top', '8':'distribute-h', '3':'distribute-v'});
const SMART_NODE_SNAP_THRESHOLD_PX = 8;
const SMART_NODE_SNAP_RELEASE_PX = 12;


const assetToggle = document.getElementById('assetToggle');

const assetPanel = document.getElementById('assetPanel');

const assetCloseBtn = document.getElementById('assetCloseBtn');

const assetLibrarySelect = document.getElementById('assetLibrarySelect');

const assetCategorySelect = document.getElementById('assetCategorySelect');

const assetLibraryPickerButton = document.getElementById('assetLibraryPickerButton');
const assetLibraryPickerMenu = document.getElementById('assetLibraryPickerMenu');
const assetCategoryPickerButton = document.getElementById('assetCategoryPickerButton');
const assetCategoryPickerMenu = document.getElementById('assetCategoryPickerMenu');

const assetGrid = document.getElementById('assetGrid');

const assetDropZone = document.getElementById('assetDropZone');
const assetAddFilesInput = document.getElementById('assetAddFilesInput');

const assetImageControls = document.getElementById('assetImageControls');

const assetAddCategoryBtn = document.getElementById('assetAddCategoryBtn');

const assetRenameCategoryBtn = document.getElementById('assetRenameCategoryBtn');

const assetDialogBackdrop = document.getElementById('assetDialogBackdrop');

const assetDialogTitle = document.getElementById('assetDialogTitle');

const assetDialogInput = document.getElementById('assetDialogInput');

const assetDialogCancel = document.getElementById('assetDialogCancel');

const assetDialogOk = document.getElementById('assetDialogOk');

const promptPresetPanel = document.getElementById('promptPresetPanel');

const promptPresetClose = document.getElementById('promptPresetClose');

const promptPresetStatus = document.getElementById('promptPresetStatus');

const promptPresetSelect = document.getElementById('promptPresetSelect');

const promptPresetName = document.getElementById('promptPresetName');

const promptPresetText = document.getElementById('promptPresetText');

const promptPresetApply = document.getElementById('promptPresetApply');

const promptPresetDelete = document.getElementById('promptPresetDelete');

const promptPresetNew = document.getElementById('promptPresetNew');

const promptPresetSave = document.getElementById('promptPresetSave');

const promptTemplatePanel = document.getElementById('promptTemplatePanel');

const promptTemplateClose = document.getElementById('promptTemplateClose');

const promptTemplateSearch = document.getElementById('promptTemplateSearch');

const promptTemplateLibrarySelect = document.getElementById('promptTemplateLibrarySelect');

const promptTemplateCats = document.getElementById('promptTemplateCats');

const promptTemplateBody = document.getElementById('promptTemplateBody');

const composerTemplateBtn = document.getElementById('composerTemplateBtn');
const composerCopyPromptBtn = document.getElementById('composerCopyPromptBtn');
const composerPastePromptBtn = document.getElementById('composerPastePromptBtn');
const composerClearPromptBtn = document.getElementById('composerClearPromptBtn');

let minimapViewport = document.getElementById('minimapViewport');

let smartCanvasActionDispatcher = null;

const smartCanvasUploadClient = new SmartCanvasUploadClient();
const smartCanvasCanvasSyncClient = new SmartCanvasCanvasSyncClient();
const smartCanvasConfigClient = new SmartCanvasConfigClient();
const SMART_CANVAS_PROVIDER_CATALOG = window.SmartCanvasProviderCatalog;
const smartCanvasTaskClient = new SmartCanvasTaskClient();
const smartCanvasGenerationClient = new SmartCanvasGenerationClient();
const smartCanvasAssetClient = new SmartCanvasAssetClient();

// ===== 参数面板域（settings/recent/参数面板）桥接（P2.7）：实现在 smart-canvas-parameter-domain.js =====
const parameterDomain = createParameterDomain({
    SMART_CANVAS_PROVIDER_CATALOG,
    activeComposerNode,
    activeSettingsSubject,
    apiProviderById,
    buildPromptRequest,
    cloneSmartSettings,
    composerParameterNoticeCount,
    defaultSmartApiResolution,
    dynamicParams,
    escapeAttr,
    escapeHtml,
    executeSmartCanvasCommand,
    imageProviders,
    imagesForNode,
    inputThumbsRow,
    isGptImageAutoSizeModel,
    isRemoteVideoReferenceUrl,
    isSmartRunnableNode,
    localDisplayUrlForMediaItem,
    normalizeSmartVideoModeSettings,
    openAssetNameDialog,
    persistActiveSmartSettings,
    primarySelectedNode,
    promptInput,
    providerImageModels,
    refreshIcons,
    refreshNodeProviderMeta,
    render,
    restoreComposerNodeSelection,
    savePromptDraftForCurrent,
    scheduleSave,
    selectedNode,
    selectedNodeIds,
    settingsForStorage,
    showComposerParameterChange,
    showComposerParameterNotice,
    smartCanvasAssetClient,
    smartCanvasConfigClient,
    smartSettingsForNode,
    stripOutpaintDisplaySettings,
    syncApiKindToggleVisibility,
    toast,
    tr,
    validOutpaintSize,
    settings: () => settings,
    setSettings: value => { settings = value; },
    apiProviders: () => apiProviders,
    setApiProviders: value => { apiProviders = value; },
    lastConfigRefreshAt: () => lastConfigRefreshAt,
    setLastConfigRefreshAt: value => { lastConfigRefreshAt = value; },
    transientSmartCloudLinks: () => transientSmartCloudLinks,
    setTransientSmartCloudLinks: value => { transientSmartCloudLinks = value; },
    nodes: () => nodes,
    videoParamsExpanded: () => videoParamsExpanded,
    videoOptionSectionState: () => videoOptionSectionState,
});
function loadRecentSmartSettings(...args){ return parameterDomain.loadRecentSmartSettings(...args); }
function recentSmartSettingsForMode(...args){ return parameterDomain.recentSmartSettingsForMode(...args); }
function rememberRecentSmartSettings(...args){ return parameterDomain.rememberRecentSmartSettings(...args); }
function applyRecentSmartSettingsForCurrentMode(...args){ return parameterDomain.applyRecentSmartSettingsForCurrentMode(...args); }
function modelscopeImageModels(...args){ return parameterDomain.modelscopeImageModels(...args); }
function videoProviderById(...args){ return parameterDomain.videoProviderById(...args); }
function parseSizeValue(...args){ return parameterDomain.parseSizeValue(...args); }
function apiImageSize(...args){ return parameterDomain.apiImageSize(...args); }
function updateProviderModels(...args){ return parameterDomain.updateProviderModels(...args); }
function scheduleDynamicParamsRefresh(...args){ return parameterDomain.scheduleDynamicParamsRefresh(...args); }
function renderDynamicParams(...args){ return parameterDomain.renderDynamicParams(...args); }
function applyUploadedUrlsToSmartRefs(...args){ return parameterDomain.applyUploadedUrlsToSmartRefs(...args); }
function manualSmartVideoLink(...args){ return parameterDomain.manualSmartVideoLink(...args); }
function manualSmartMediaLinks(...args){ return parameterDomain.manualSmartMediaLinks(...args); }
function closeAllSmartPopovers(...args){ return parameterDomain.closeAllSmartPopovers(...args); }
function loadConfig(...args){ return parameterDomain.loadConfig(...args); }


const smartCanvasPromptLibraryClient = new SmartCanvasPromptLibraryClient();

// ===== Prompt 预设/模板域桥接（P2.5）：实现在 smart-canvas-prompt-library-view.js =====
const promptLibraryView = createPromptLibraryView({
    SmartCanvasPromptWorkbenchView,
    closeSmartSurface,
    composerTemplateBtn,
    escapeAttr,
    escapeHtml,
    executeSmartCanvasCommand,
    openSmartSurface,
    promptInput,
    promptPlainText,
    promptPresetApply,
    promptPresetDelete,
    promptPresetName,
    promptPresetNew,
    promptPresetPanel,
    promptPresetSave,
    promptPresetSelect,
    promptPresetStatus,
    promptPresetText,
    promptTemplateBody,
    promptTemplateCats,
    promptTemplateLibrarySelect,
    promptTemplatePanel,
    promptTemplateSearch,
    refreshIcons,
    render,
    renderInputThumbsRow,
    savePromptDraftForCurrent,
    scheduleSave,
    selectedNode,
    setPromptText,
    shell,
    smartCanvasPromptLibraryClient,
    toast,
    tr,
    uid,
    world,
    promptPresets: () => promptPresets,
    setPromptPresets: value => { promptPresets = value; },
    promptLibraries: () => promptLibraries,
    setPromptLibraries: value => { promptLibraries = value; },
    activePromptLibraryId: () => activePromptLibraryId,
    setActivePromptLibraryId: value => { activePromptLibraryId = value; },
    promptTemplateCategory: () => promptTemplateCategory,
    setPromptTemplateCategory: value => { promptTemplateCategory = value; },
    promptTemplateSelectedId: () => promptTemplateSelectedId,
    setPromptTemplateSelectedId: value => { promptTemplateSelectedId = value; },
    promptTemplateEditing: () => promptTemplateEditing,
    setPromptTemplateEditing: value => { promptTemplateEditing = value; },
    promptPresetDeleteArmed: () => promptPresetDeleteArmed,
    setPromptPresetDeleteArmed: value => { promptPresetDeleteArmed = value; },
    promptTemplateGroupEditMode: () => promptTemplateGroupEditMode,
    nodes: () => nodes,
});
function loadPromptPresets(...args){ return promptLibraryView.loadPromptPresets(...args); }
function savePromptPresets(...args){ return promptLibraryView.savePromptPresets(...args); }
function loadPromptTemplateGroups(...args){ return promptLibraryView.loadPromptTemplateGroups(...args); }
function loadPromptTemplateOverrides(...args){ return promptLibraryView.loadPromptTemplateOverrides(...args); }
function loadPromptTemplates(...args){ return promptLibraryView.loadPromptTemplates(...args); }
function renderPromptLibrarySelect(...args){ return promptLibraryView.renderPromptLibrarySelect(...args); }
function currentPromptPreset(...args){ return promptLibraryView.currentPromptPreset(...args); }
function promptPresetPanelNode(...args){ return promptLibraryView.promptPresetPanelNode(...args); }
function setPromptPresetStatus(...args){ return promptLibraryView.setPromptPresetStatus(...args); }
function resetPromptPresetDeleteState(...args){ return promptLibraryView.resetPromptPresetDeleteState(...args); }
function createPromptPresetFromNode(...args){ return promptLibraryView.createPromptPresetFromNode(...args); }
function renderPromptPresetPanel(...args){ return promptLibraryView.renderPromptPresetPanel(...args); }
function closePromptPresetPanel(...args){ return promptLibraryView.closePromptPresetPanel(...args); }
function renderPromptTemplatePanel(...args){ return promptLibraryView.renderPromptTemplatePanel(...args); }
function openPromptTemplatePanel(...args){ return promptLibraryView.openPromptTemplatePanel(...args); }
function closePromptTemplatePanel(...args){ return promptLibraryView.closePromptTemplatePanel(...args); }
function applyPromptTemplateToNode(...args){ return promptLibraryView.applyPromptTemplateToNode(...args); }
function saveCurrentPromptAsTemplate(...args){ return promptLibraryView.saveCurrentPromptAsTemplate(...args); }
function createBlankPromptTemplate(...args){ return promptLibraryView.createBlankPromptTemplate(...args); }
function savePromptTemplateEdit(...args){ return promptLibraryView.savePromptTemplateEdit(...args); }
function deletePromptTemplate(...args){ return promptLibraryView.deletePromptTemplate(...args); }
function createPromptTemplateGroup(...args){ return promptLibraryView.createPromptTemplateGroup(...args); }
function renamePromptTemplateGroup(...args){ return promptLibraryView.renamePromptTemplateGroup(...args); }
function deletePromptTemplateGroup(...args){ return promptLibraryView.deletePromptTemplateGroup(...args); }

// ===== Mention/引用域桥接（P2.5）：实现在 smart-canvas-reference-graph.js =====
const referenceGraph = createReferenceGraph({
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
    tr,
    activeAssetCategoryId: () => activeAssetCategoryId,
    setActiveAssetCategoryId: value => { activeAssetCategoryId = value; },
    mentionSource: () => mentionSource,
    setMentionSource: value => { mentionSource = value; },
    mentionAssetCategoryId: () => mentionAssetCategoryId,
    setMentionAssetCategoryId: value => { mentionAssetCategoryId = value; },
    canvas: () => canvas,
    nodes: () => nodes,
    assetLibrary: () => assetLibrary,
    canvasUsesConnections: () => canvasUsesConnections,
    settings: () => settings,
});
function promptHtmlWithMentionTokens(...args){ return referenceGraph.promptHtmlWithMentionTokens(...args); }
function snapshotRunMeta(...args){ return referenceGraph.snapshotRunMeta(...args); }
function attachRunMeta(...args){ return referenceGraph.attachRunMeta(...args); }
function stripRunInputMeta(...args){ return referenceGraph.stripRunInputMeta(...args); }
function stripImageGenerationMeta(...args){ return referenceGraph.stripImageGenerationMeta(...args); }
function addConnection(...args){ return referenceGraph.addConnection(...args); }
function connectInputNode(...args){ return referenceGraph.connectInputNode(...args); }
function hasConnectionBetween(...args){ return referenceGraph.hasConnectionBetween(...args); }
function upstreamNodesForKinds(...args){ return referenceGraph.upstreamNodesForKinds(...args); }
function inputNodesFor(...args){ return referenceGraph.inputNodesFor(...args); }
function clearDetachedRunInputRefs(...args){ return referenceGraph.clearDetachedRunInputRefs(...args); }
function cleanupDetachedRunInputRefs(...args){ return referenceGraph.cleanupDetachedRunInputRefs(...args); }
function imagesForNode(...args){ return referenceGraph.imagesForNode(...args); }
function isSelfReferenceForNode(...args){ return referenceGraph.isSelfReferenceForNode(...args); }
function inputRefKey(...args){ return referenceGraph.inputRefKey(...args); }
function blockedInputRefKeys(...args){ return referenceGraph.blockedInputRefKeys(...args); }
function manualReferenceImagesFor(...args){ return referenceGraph.manualReferenceImagesFor(...args); }
function defaultReferenceImagesFor(...args){ return referenceGraph.defaultReferenceImagesFor(...args); }
function uniqueReferenceImages(...args){ return referenceGraph.uniqueReferenceImages(...args); }
function visibleReferenceImagesFor(...args){ return referenceGraph.visibleReferenceImagesFor(...args); }
function closeMentionPicker(...args){ return referenceGraph.closeMentionPicker(...args); }
function saveMentionRange(...args){ return referenceGraph.saveMentionRange(...args); }
function renderMentionPicker(...args){ return referenceGraph.renderMentionPicker(...args); }
function removeManualReferenceFromSelectedNode(...args){ return referenceGraph.removeManualReferenceFromSelectedNode(...args); }
function maybeOpenMentionPicker(...args){ return referenceGraph.maybeOpenMentionPicker(...args); }


let canvas = null;

let smartCanvasDocumentStore = null;

let smartCanvasDocumentModel = null;

const smartCanvasState = new SmartCanvasStateStore();
smartCanvasState.installLegacySelectionAliases(window, {primaryId:'selectedId', ids:'selectedIds', image:'selectedImage'});

const smartComposer = typeof SmartCanvasComposer === 'function' ? new SmartCanvasComposer({

    root: composer,

    collapseButton: composerCollapseBtn,

    promptInput,

    apiKindToggle,

    translate: key => typeof tr === 'function' ? tr(key) : key,

    refreshIcons: root => { if(typeof refreshIcons === 'function') refreshIcons(root); },

    onToggleDock: () => toggleComposerDock(),

    onApiKindChange: kind => {

        if(!kind || kind === settings.apiKind) return;

        settings.apiKind = kind;

        applyRecentSmartSettingsForCurrentMode();

        syncApiKindToggleVisibility();

        renderDynamicParams();

        persistActiveSmartSettings();

        scheduleSave();

    },

    onCloseMentionPicker: () => closeMentionPicker(),

}) : null;


function clearPortDragVisual(...args){ return dragController.clearPortDragVisual(...args); }
function pickMediaForSmartNode(...args){ return dragController.pickMediaForSmartNode(...args); }
function pickReferenceImagesForSmartNode(...args){ return dragController.pickReferenceImagesForSmartNode(...args); }
function pickSingleReferenceImageForSmartNode(...args){ return dragController.pickSingleReferenceImageForSmartNode(...args); }
function beginSmartThumbnailDrag(...args){ return dragController.beginSmartThumbnailDrag(...args); }
function resetSmartNodeAspect(...args){ return dragController.resetSmartNodeAspect(...args); }
function beginSmartNodeResize(...args){ return dragController.beginSmartNodeResize(...args); }
function beginSmartNodeDrag(...args){ return dragController.beginSmartNodeDrag(...args); }
function beginSmartPortDrag(...args){ return dragController.beginSmartPortDrag(...args); }
function handleSmartNodeDrop(...args){ return dragController.handleSmartNodeDrop(...args); }
function shouldBlockMiddlePan(...args){ return dragController.shouldBlockMiddlePan(...args); }
function closeCreateMenu(...args){ return dragController.closeCreateMenu(...args); }
function clearSmartExternalDropPreview(...args){ return dragController.clearSmartExternalDropPreview(...args); }
function setSmartNodeDropPreview(...args){ return dragController.setSmartNodeDropPreview(...args); }
function updateSmartExternalDragPreview(...args){ return dragController.updateSmartExternalDragPreview(...args); }
function runCanvasCommand(...args){ return dragController.runCanvasCommand(...args); }
function openCreateMenu(...args){ return dragController.openCreateMenu(...args); }
// ===== Composer 域桥接（P2.2）：实现在 smart-canvas-composer-view.js，此处仅注入与包装 =====
const composerView = createComposerView({
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
    visibleReferenceImagesFor,
    canvas: () => canvas,
    nodes: () => nodes,
    settings: () => settings,
    setSettings: value => { settings = value; },
    activeComposerSubject: () => activeComposerSubject,
    setActiveComposerSubject: value => { activeComposerSubject = value; },
    lastComposerNodeId: () => lastComposerNodeId,
    setLastComposerNodeId: value => { lastComposerNodeId = value; },
    setLastComposerRunnableNodeId: value => { lastComposerRunnableNodeId = value; },
    setDownstreamPromptUnlockedNodeId: value => { downstreamPromptUnlockedNodeId = value; }
});
function promptPlainText(...args){ return composerView.promptPlainText(...args); }
function setPromptText(...args){ return composerView.setPromptText(...args); }
function composerPromptActionsEditable(...args){ return composerView.composerPromptActionsEditable(...args); }
function replaceComposerPromptText(...args){ return composerView.replaceComposerPromptText(...args); }
function clearPromptInput(...args){ return composerView.clearPromptInput(...args); }
function savePromptDraftForCurrent(...args){ return composerView.savePromptDraftForCurrent(...args); }
function positionComposerForNode(...args){ return composerView.positionComposerForNode(...args); }
function updateComposer(...args){ return composerView.updateComposer(...args); }
function renderInputThumbsRow(...args){ return composerView.renderInputThumbsRow(...args); }
function scheduleComposerUpdate(...args){ return composerView.scheduleComposerUpdate(...args); }

let canvasUsesConnections = true;

// MANUAL_CONNECTIONS_DISABLED_20260722: persisted connections stay visible/removable; terminal drags never create new ones.
const SMART_CANVAS_MANUAL_CONNECTIONS_ENABLED = false;
const SMART_MULTI_MEDIA_HOVER_THRESHOLD = 0.2;
function isMultiMediaHoverEnabled(scale=viewport?.scale){ return Number(scale) > SMART_MULTI_MEDIA_HOVER_THRESHOLD; }

let nodes = [];

// Canvas-level mutable UI state. Keep these declarations together: callbacks run
// before async config/canvas loading completes, so relying on later assignments
// would raise ReferenceError and leave Composer/asset/prompt UI half-initialized.
let selectionJustFinished = false;
let uploadTargetId = '';
let pendingGroupUploadPoint = null;
let saveTimer = null;
let saveQueuedAfterFlight = false;
let apiProviders = [];
let smartChatSession = null;
let smartChatRenderedSignature = '';
let assetLibrary = {categories:[]};
let assetLibraryOpen = false;
let smartSurface = '';
let activeAssetCategoryId = '';
let activeAssetLibraryId = '';
const SMART_SURFACE_UI_STATE_KEY = 'surface';
let mentionSource = 'input';
let mentionAssetCategoryId = '';
const SMART_COMPOSER_COLLAPSED_KEY = 'smart_canvas_composer_collapsed_v1';
let promptPresets = [];
let promptLibraries = [];
let activePromptLibraryId = 'system';
let promptTemplateCategory = 'all';
let promptTemplateSelectedId = '';
let promptTemplateEditing = false;
let promptTemplateGroupEditMode = false;
let promptPresetDeleteArmed = false;
let createMenuPoint = {x:0, y:0};
let canvasCommandActiveIndex = 0;
let smartExternalDragRaf = 0;
let smartExternalDragPoint = null;
const smartDropFeedback = (() => {
    const element = document.createElement('div');
    element.className = 'smart-drop-feedback';
    element.hidden = true;
    document.body.appendChild(element);
    return element;
})();
let nodeClipboard = null;
let imageClickTimer = null;
let suppressImageClickUntil = 0;
let lastMouseWorld = null;
let lastMouseClient = null;
let suppressKeyboardMoveContextMenu = false;
let suppressKeyboardMoveClick = false;
let lastConfigRefreshAt = 0;
let runTimerRaf = 0;
let runTimerLast = 0;
function scheduleRunTimerRaf(){
    if(runTimerRaf) return;
    runTimerRaf = requestAnimationFrame((now) => {
        runTimerRaf = 0;
        if(!runTimerLast || now - runTimerLast >= 1000){
            runTimerLast = now;
            refreshRunTimerPills();
        }
        if(world.querySelector('.run-time-pill:not(.done)')) scheduleRunTimerRaf();
    });
}
let transientSmartCloudLinks = [];
let smartRunStateToken = 0;
let lastComposerNodeId = '';
let downstreamPromptUnlockedNodeId = '';
let downstreamPromptTopologyNodeId = '';
let downstreamPromptUpstreamSnapshot = [];
let downstreamPromptLockFeedbackTimer = 0;
let lastComposerRunnableNodeId = '';
let composerPromptEditingNodeId = '';
let activeComposerSubject = null;
let videoParamsExpanded = false;
const VIDEO_OPTION_SECTION_STATE_KEY = 'smartCanvasVideoOptionSections.v1';
const VIDEO_OPTION_SECTION_DEFAULTS = Object.freeze({output:true, effects:false, reference:false, advanced:false});
let videoOptionSectionState = (() => {
    try {
        const stored = JSON.parse(localStorage.getItem(VIDEO_OPTION_SECTION_STATE_KEY) || '{}');
        return {...VIDEO_OPTION_SECTION_DEFAULTS, ...(stored && typeof stored === 'object' ? stored : {})};
    } catch(e){
        return {...VIDEO_OPTION_SECTION_DEFAULTS};
    }
})();

shell?.classList.remove('navigator-collapsed');


try {
    const storedComposerState = localStorage.getItem(SMART_COMPOSER_COLLAPSED_KEY);
    const initialComposerCollapsed = storedComposerState === null ? true : storedComposerState === '1';
    smartCanvasState.setComposerDockCollapsed(initialComposerCollapsed, {source:'local-storage'});
    smartComposer?.syncDock({collapsed:initialComposerCollapsed});
} catch(e) {}

// 任务生命周期由独立控制器持有；旧变量名保留为兼容边界。

const activeSmartTaskPolls = smartCanvasState.run.activePolls;

// WS 事件只用于唤醒任务查询；完整结果始终从任务接口读取。

const smartCanvasTaskEvents = smartCanvasState.run.taskEvents;

const smartCanvasTaskController = new SmartCanvasTaskController({

    context: canvasId,

    events: smartCanvasTaskEvents,

    activePolls: activeSmartTaskPolls,

    onStateChange: event => renderSmartTaskStatus(event)

});

let smartTaskStatusHideTimer = null;
let smartTaskStatusSessionActive = false;


eventManager.addGlobal(window, 'online', () => {
    if(!['offline', 'error'].includes(smartCanvasState.sync?.status)) return;
    setSmartSaveStatus('dirty');
    scheduleSave();
});

eventManager.addGlobal(window, 'offline', () => setSmartSaveStatus('offline', '当前离线，修改尚未保存'));



smartCanvasEmptyState?.addEventListener('click', event => {

    const button = event.target.closest('[data-empty-command]');

    if(!button) return;

    const commandId = button.dataset.emptyCommand;

    if(commandId !== 'upload' && commandId !== 'create-empty') return;

    createMenuPoint = viewportCenter();

    if(commandId === 'create-empty') smartCanvasEmptyState.dataset.dismissed = '1';

    runCanvasCommand(commandId);

});

const smartNodeRunTokens = new Map();

let lastImagePasteAt = 0;

let lastNodePasteAt = 0;

let suppressNodeClickUntil = 0;

const UNDO_LIMIT = 20;

let undoSuppressed = false;

let smartCanvasStore = null;

let smartCanvasCommandBus = null;function setSmartSelectionState(next={}, meta={}){

    return smartCanvasState.setSelection({
        primaryId: next.primaryId === undefined ? selectedId : next.primaryId,
        ids: next.ids === undefined ? selectedIds : next.ids,
        image: next.image === undefined ? selectedImage : next.image
    }, meta);

}

function syncSmartSelectionStateFromLegacy(meta={}){

    return setSmartSelectionState({primaryId:selectedId, ids:selectedIds, image:selectedImage}, meta);

}

function snapshotForUndo(){

    const selection = syncSmartSelectionStateFromLegacy({source:'undo-snapshot'});

    return {nodes:JSON.parse(JSON.stringify(nodes)), connections:JSON.parse(JSON.stringify(canvas?.connections || [])), visualAssistant:JSON.parse(JSON.stringify(smartChatSession || null)), selectedId:selection.primaryId, selectedIds:selection.ids.slice(), selectedImage:{...selection.image}};

}

function restoreUndoSnapshot(snap){

    nodes = snap.nodes;

    if(canvas) canvas.connections = snap.connections;
    smartChatSession = normalizeSmartChatSession(snap.visualAssistant || smartChatSession || {});
    smartChatRenderedSignature = '';
    rememberCanvasSmartChatState({schedule:false});

    setSmartSelectionState({primaryId:snap.selectedId, ids:snap.selectedIds, image:snap.selectedImage}, {source:'undo-restore'});

    activeComposerSubject = null;

    lastComposerNodeId = '';

    render();

    scheduleSave();

}

smartCanvasStore = new SmartCanvasStore({limit:UNDO_LIMIT, snapshot:snapshotForUndo, restore:restoreUndoSnapshot, isSuppressed:() => undoSuppressed});

smartCanvasCommandBus = typeof SmartCanvasCommandBus === 'function' ? new SmartCanvasCommandBus({store:smartCanvasStore}) : null;

smartCanvasDocumentStore = new SmartCanvasDocumentStore();

function capturePendingUndo(){ (smartCanvasCommandBus || smartCanvasStore).begin({name:'pointer-gesture'}); }

function commitPendingUndo(){ (smartCanvasCommandBus || smartCanvasStore).commit(); }

function discardPendingUndo(){ (smartCanvasCommandBus || smartCanvasStore).discard(); }

function performUndo(){

    if(!smartCanvasStore.undoStack.length){ toast(tr('smart.toastNoUndo')); return; }

    undoSuppressed = true;

    (smartCanvasCommandBus || smartCanvasStore).undo();

    undoSuppressed = false;

    toast(tr('smart.toastUndone'));

}

function performRedo(){

    if(!smartCanvasStore.redoStack.length){ toast('没有可恢复的操作'); return; }

    undoSuppressed = true;

    (smartCanvasCommandBus || smartCanvasStore).redo();

    undoSuppressed = false;

    toast('已恢复操作');

}

const viewport = smartCanvasState.view.viewport;


// ===== 聊天/预览域桥接（P2.4）：实现在 smart-canvas-overlay-views.js =====
const smartCanvasPreviewState = {nodeId:'', index:0, count:0, scale:1, offsetX:0, offsetY:0, pan:null};
const overlayViews = createOverlayViews({
    SMART_CHAT_SELECT_TRIGGER_SELECTOR,
    SMART_PREVIEW_IMAGE_SELECTOR,
    canvasId,
    clearSmartExternalDropPreview,
    cloneSmartNode,
    closeSmartSurface,
    copyTextToClipboard,
    displayMediaUrl,
    downloadPreviewFile,
    escapeAttr,
    escapeHtml,
    executeSmartCanvasCommand,
    focusSmartLogNode,
    handleSmartImageDropPayload,
    imageForDisplay,
    isSmartChatNode,
    isSmartImageNode,
    mediaPreviewModal,
    openHomeSettings,
    openSmartSurface,
    previewCloseBtn,
    previewLocateBtn,
    previewMediaHost,
    previewNavHint,
    previewNextBtn,
    previewPrevBtn,
    previewResolution,
    previewStage,
    primarySelectedNode,
    promptInput,
    proxiedMediaUrl,
    refreshIcons,
    resolveSmartImageDropPayload,
    scheduleSave,
    selectedNodeIds,
    setSmartSelectionState,
    smartCanvasPreviewState,
    smartCanvasState,
    smartChatPanel,
    smartChatPanelBody,
    smartChatPanelMeta,
    smartChatPanelTitle,
    smartDropDataTypes,
    smartMediaPreviewUrl,
    syncSelectionUi,
    toast,
    uid,
    updateComposer,
    viewport,
    world,
    canvas: () => canvas,
    apiProviders: () => apiProviders,
    nodes: () => nodes,
    setNodes: value => { nodes = value; },
    smartChatSession: () => smartChatSession,
    setSmartChatSession: value => { smartChatSession = value; },
    smartChatRenderedSignature: () => smartChatRenderedSignature,
    setSmartChatRenderedSignature: value => { smartChatRenderedSignature = value; },
});
const smartChatView = overlayViews.SmartChatView;
function normalizeSmartChatSession(...args){ return overlayViews.normalizeSmartChatSession(...args); }
function rememberCanvasSmartChatState(...args){ return overlayViews.rememberCanvasSmartChatState(...args); }
function restoreCanvasSmartChatState(...args){ return overlayViews.restoreCanvasSmartChatState(...args); }
function renderSmartChatPanel(...args){ return overlayViews.renderSmartChatPanel(...args); }
function closeSmartChatPanel(...args){ return overlayViews.closeSmartChatPanel(...args); }
function createNewSmartChatSession(...args){ return overlayViews.createNewSmartChatSession(...args); }
function toggleSmartChatPanel(...args){ return overlayViews.toggleSmartChatPanel(...args); }
function handleSmartChatAction(...args){ return overlayViews.handleSmartChatAction(...args); }
function bindSmartChatEvents(...args){ return overlayViews.bindSmartChatEvents(...args); }
function cyclePreviewMedia(...args){ return overlayViews.cyclePreviewMedia(...args); }
function openImagePreviewSmart(...args){ return overlayViews.openImagePreviewSmart(...args); }
function closeMediaPreview(...args){ return overlayViews.closeMediaPreview(...args); }

// ===== 交互/拖拽域桥接（P2.3）：实现在 smart-canvas-drag-controller.js =====
const dragController = createDragController({
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
    smartNodeToolbarMediaItem,
    undoSuppressed: () => undoSuppressed,
    selectionJustFinished: () => selectionJustFinished,
    canvasCommandActiveIndex: () => canvasCommandActiveIndex,
    smartExternalDragPoint: () => smartExternalDragPoint,
    smartExternalDragRaf: () => smartExternalDragRaf,
    pendingGroupUploadPoint: () => pendingGroupUploadPoint,
    uploadTargetId: () => uploadTargetId,
    createMenuPoint: () => createMenuPoint,
    suppressKeyboardMoveContextMenu: () => suppressKeyboardMoveContextMenu,
    suppressKeyboardMoveClick: () => suppressKeyboardMoveClick,
    lastMouseClient: () => lastMouseClient,
    lastMouseWorld: () => lastMouseWorld,
    suppressImageClickUntil: () => suppressImageClickUntil,
    suppressNodeClickUntil: () => suppressNodeClickUntil,
    nodes: () => nodes,
    assetLibraryOpen: () => assetLibraryOpen,
    setUndoSuppressed: value => { undoSuppressed = value; },
    setSelectionJustFinished: value => { selectionJustFinished = value; },
    setCanvasCommandActiveIndex: value => { canvasCommandActiveIndex = value; },
    setSmartExternalDragPoint: value => { smartExternalDragPoint = value; },
    setSmartExternalDragRaf: value => { smartExternalDragRaf = value; },
    setPendingGroupUploadPoint: value => { pendingGroupUploadPoint = value; },
    setUploadTargetId: value => { uploadTargetId = value; },
    setCreateMenuPoint: value => { createMenuPoint = value; },
    setSuppressKeyboardMoveContextMenu: value => { suppressKeyboardMoveContextMenu = value; },
    setSuppressKeyboardMoveClick: value => { suppressKeyboardMoveClick = value; },
    setLastMouseClient: value => { lastMouseClient = value; },
    setLastMouseWorld: value => { lastMouseWorld = value; },
    setSuppressImageClickUntil: value => { suppressImageClickUntil = value; },
    setSuppressNodeClickUntil: value => { suppressNodeClickUntil = value; },
});
const SMART_CANVAS_COMMANDS = dragController.SmartCanvasCommands;
let settings = {

    engine:'api',

    apiKind:'image',

    provider_id:'',

    model:'',

    ratio:'square',

    resolution:'4k',

    customRatio:'',

    customRatioWidth:'',

    customRatioHeight:'',

    customSize:'',

    customWidth:'',

    customHeight:'',

    quality:'auto',

    count:1,

    videoProvider:'',

    videoModel:'',

    videoDuration:5,

    videoAspect:'16:9',

    videoResolution:'',

    videoEnhancePrompt:false,

    videoEnableUpsample:false,

    videoWatermark:false,

    videoCameraFixed:false,

    videoGenerateAudio:false,

    videoMultimodal:true,

    _videoMultimodalUserSet:false,

    videoUseFrameRoles:false,

    videoTrustedAsset:false,

    videoTrustedSource:'library',

    videoTempShLinks:[],

    msgenModel:'zimage',

    msCustomModel:'',

    msRatio:'square',

    msResolution:'1k',

    msCustomRatio:'',

    msCustomRatioWidth:'',

    msCustomRatioHeight:'',

    msCustomSize:'',

    msCustomWidth:'',

    msCustomHeight:'',

    width:1024,

    height:1024,

    enhanceStrength:0.5,

    enhanceUpscale:false,

    enhanceUpscaleRes:2048,

    editUpscale:false,

    editUpscaleRes:2048,

    promptH:124

};

let initialSmartSettings = null;
let canvasDefaultSmartSettings = null;

const MS_GEN_MODELS = {

    zimage: { label:'ZImage', modelId:'Tongyi-MAI/Z-Image-Turbo', supportsImage:false, endpoint:'/generate' },

    qwen_edit: { label:'Qwen Edit', modelId:'Qwen/Qwen-Image-Edit-2511', supportsImage:true, endpoint:'/api/angle/generate' },

    klein_edit: { label:'Klein', modelId:'black-forest-labs/FLUX.2-klein-9B', supportsImage:true, endpoint:'/api/ms/generate' },

    custom: { label:tr('smart.custom') || '自定义', modelId:'', acceptsImage:true, endpoint:'/api/ms/generate' }

};

// ===== 媒体显示/HTML 域桥接（P2.10②媒体HTML）：实现在 smart-canvas-media-view.js =====
const mediaView = createMediaView({
    MS_GEN_MODELS,
    SMART_REFERENCE_IMAGE_MAX,
    escapeAttr,
    escapeHtml,
    fileNameFromUrl,
    mediaLayoutSize,
    smartPreviewImgHtml,
    smartVideoPlayerHtml,
    smartVideoPreviewHtml,
    world,
});
function localDisplayUrlForMediaItem(...args){ return mediaView.localDisplayUrlForMediaItem(...args); }
function imageForDisplay(...args){ return mediaView.imageForDisplay(...args); }
function resultMediaUrls(...args){ return mediaView.resultMediaUrls(...args); }
function imageRefsOnly(...args){ return mediaView.imageRefsOnly(...args); }
function videoRefsOnly(...args){ return mediaView.videoRefsOnly(...args); }
function isRemoteVideoReferenceUrl(...args){ return mediaView.isRemoteVideoReferenceUrl(...args); }
function audioRefsOnly(...args){ return mediaView.audioRefsOnly(...args); }
function thumbMediaHtml(...args){ return mediaView.thumbMediaHtml(...args); }
function imageResolutionLabel(...args){ return mediaView.imageResolutionLabel(...args); }
function imageResolutionBadgeHtml(...args){ return mediaView.imageResolutionBadgeHtml(...args); }
function imageNameLabel(...args){ return mediaView.imageNameLabel(...args); }
function imageNameBadgeHtml(...args){ return mediaView.imageNameBadgeHtml(...args); }
function thumbDisplaySize(...args){ return mediaView.thumbDisplaySize(...args); }
function applyThumbDisplaySizeToElement(...args){ return mediaView.applyThumbDisplaySizeToElement(...args); }
function updateImageResolutionBadgeElement(...args){ return mediaView.updateImageResolutionBadgeElement(...args); }
function singleMediaHtml(...args){ return mediaView.singleMediaHtml(...args); }
function multiMediaSummaryHtml(...args){ return mediaView.multiMediaSummaryHtml(...args); }
function transplantSmartMediaElements(...args){ return mediaView.transplantSmartMediaElements(...args); }
function captureMediaPlaybackStates(...args){ return mediaView.captureMediaPlaybackStates(...args); }
function restoreMediaPlaybackStates(...args){ return mediaView.restoreMediaPlaybackStates(...args); }
function smartRunTaskLabel(...args){ return mediaView.smartRunTaskLabel(...args); }
function outputUrlLooksVideo(...args){ return mediaView.outputUrlLooksVideo(...args); }
function proxiedMediaUrl(...args){ return mediaView.proxiedMediaUrl(...args); }
function displayMediaUrl(...args){ return mediaView.displayMediaUrl(...args); }
function bindImageProxyFallback(...args){ return mediaView.bindImageProxyFallback(...args); }
function safeExportFileName(...args){ return mediaView.safeExportFileName(...args); }


const SIZE_MAP = SmartCanvasSizePrimitives.SIZE_MAP;
const RES_LONG_SIDE = SmartCanvasSizePrimitives.RES_LONG_SIDE;
const RES_PIXEL_LIMIT = SmartCanvasSizePrimitives.RES_PIXEL_LIMIT;

// ===== 媒体预览/高分辨率同步辅助域桥接（P2.10⑦媒体预览）：实现在 smart-canvas-media-preview-helpers.js =====
const mediaPreviewHelpers = createMediaPreview({
    displayMediaUrl,
    escapeAttr,
    escapeHtml,
    isNodeSelected,
    mediaPreviewModal,
    selectedNodeIds,
    world,
    nodes: () => nodes,
});

// ===== composer 主体/提示反馈/音效域桥接（P2.10⑨composer主体）：实现在 smart-canvas-composer-subject.js =====
const composerSubject = createComposerSubject({
    CANVAS_LIST_PROJECT_KEY,
    closeMentionPicker,
    composer,
    composerFocusUpstreamBtn,
    downstreamPromptLockBtn,
    isSmartImageNode,
    isSmartRunnableNode,
    primarySelectedNode,
    promptInput,
    rememberCanvasSmartChatState,
    rememberRecentSmartSettings,
    saveMentionRange,
    savePromptDraftForCurrent,
    selectedNodeIds,
    setSmartSelectionState,
    settingsForStorage,
    sourceProjectId,
    syncSelectionUi,
    updateComposer,
    upstreamNodesForKinds,
    imageClickTimer: () => imageClickTimer,
    setImageClickTimer: value => (imageClickTimer = value),
    lastComposerRunnableNodeId: () => lastComposerRunnableNodeId,
    setLastComposerRunnableNodeId: value => (lastComposerRunnableNodeId = value),
    composerPromptEditingNodeId: () => composerPromptEditingNodeId,
    setComposerPromptEditingNodeId: value => (composerPromptEditingNodeId = value),
    downstreamPromptLockFeedbackTimer: () => downstreamPromptLockFeedbackTimer,
    setDownstreamPromptLockFeedbackTimer: value => (downstreamPromptLockFeedbackTimer = value),
    downstreamPromptTopologyNodeId: () => downstreamPromptTopologyNodeId,
    setDownstreamPromptTopologyNodeId: value => (downstreamPromptTopologyNodeId = value),
    downstreamPromptUnlockedNodeId: () => downstreamPromptUnlockedNodeId,
    setDownstreamPromptUnlockedNodeId: value => (downstreamPromptUnlockedNodeId = value),
    downstreamPromptUpstreamSnapshot: () => downstreamPromptUpstreamSnapshot,
    setDownstreamPromptUpstreamSnapshot: value => (downstreamPromptUpstreamSnapshot = value),
    settings: () => settings,
    nodes: () => nodes,
    activeComposerSubject: () => activeComposerSubject,
    canvas: () => canvas,
    lastComposerNodeId: () => lastComposerNodeId,
});
function activeSettingsSubject(...args){ return composerSubject.activeSettingsSubject(...args); }
function activeComposerNode(...args){ return composerSubject.activeComposerNode(...args); }
function syncDownstreamPromptLock(...args){ return composerSubject.syncDownstreamPromptLock(...args); }
function showDownstreamPromptLockAttention(...args){ return composerSubject.showDownstreamPromptLockAttention(...args); }
function unlockDownstreamPrompt(...args){ return composerSubject.unlockDownstreamPrompt(...args); }
function syncComposerViewportActions(...args){ return composerSubject.syncComposerViewportActions(...args); }
function switchComposerToUpstreamNode(...args){ return composerSubject.switchComposerToUpstreamNode(...args); }
function persistActiveSmartSettings(...args){ return composerSubject.persistActiveSmartSettings(...args); }
function rememberCanvasListProject(...args){ return composerSubject.rememberCanvasListProject(...args); }
function backToCanvasList(...args){ return composerSubject.backToCanvasList(...args); }
function openHomeSettings(...args){ return composerSubject.openHomeSettings(...args); }
function applyTheme(...args){ return composerSubject.applyTheme(...args); }
function toast(...args){ return composerSubject.toast(...args); }
function showComposerParameterNotice(...args){ return composerSubject.showComposerParameterNotice(...args); }
function composerParameterNoticeCount(...args){ return composerSubject.composerParameterNoticeCount(...args); }
function showComposerParameterChange(...args){ return composerSubject.showComposerParameterChange(...args); }
function showComposerButtonFeedback(...args){ return composerSubject.showComposerButtonFeedback(...args); }
function playGenerationCompleteSound(...args){ return composerSubject.playGenerationCompleteSound(...args); }
function selectedNode(...args){ return composerSubject.selectedNode(...args); }
function restoreComposerNodeSelection(...args){ return composerSubject.restoreComposerNodeSelection(...args); }
function clearSelection(...args){ return composerSubject.clearSelection(...args); }
function clearImageClickTimer(...args){ return composerSubject.clearImageClickTimer(...args); }

function smartMediaPreviewUrl(...args){ return mediaPreviewHelpers.smartMediaPreviewUrl(...args); }
function smartPreviewImgHtml(...args){ return mediaPreviewHelpers.smartPreviewImgHtml(...args); }
function smartVideoPreviewHtml(...args){ return mediaPreviewHelpers.smartVideoPreviewHtml(...args); }
function smartVideoFallbackHtml(...args){ return mediaPreviewHelpers.smartVideoFallbackHtml(...args); }
function smartVideoPlayerHtml(...args){ return mediaPreviewHelpers.smartVideoPlayerHtml(...args); }
function isSmartPreviewImage(...args){ return mediaPreviewHelpers.isSmartPreviewImage(...args); }
function loadSmartOriginalImageDimensions(...args){ return mediaPreviewHelpers.loadSmartOriginalImageDimensions(...args); }
function smartActivateVideoPreview(...args){ return mediaPreviewHelpers.smartActivateVideoPreview(...args); }
function bindSmartPreviewImageFallbacks(...args){ return mediaPreviewHelpers.bindSmartPreviewImageFallbacks(...args); }
function smartNodeElementsByIds(...args){ return mediaPreviewHelpers.smartNodeElementsByIds(...args); }
function syncSmartSelectedImageResolution(...args){ return mediaPreviewHelpers.syncSmartSelectedImageResolution(...args); }







let smartSelectedConnectionScopeIds = new Set();
let smartSelectedUpstreamIds = new Set();
let smartSelectedDownstreamIds = new Set();
function isEditableTarget(target){

    const el = target || document.activeElement;

    return !!el?.closest?.('input, textarea, select, option, [contenteditable="true"], .prompt-input');

}

function safeScale(value){

    return window.SmartCanvasViewportPrimitives?.safeScale

        ? SmartCanvasViewportPrimitives.safeScale(value, 1)

        : (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 1);

}

function nodeScale(node){

    const v = Number(node?.scale);

    if((node?.images || []).length > 1 && v === MEDIA_GROUP_PREVIOUS_DEFAULT_SCALE) return MEDIA_GROUP_DEFAULT_SCALE;

    return Number.isFinite(v) && v > 0 ? v : 1;

}

const MEDIA_NODE_DEFAULT_SCALE = 2;

const MEDIA_GROUP_PREVIOUS_DEFAULT_SCALE = 1.6;

const MEDIA_GROUP_DEFAULT_SCALE = 0.8;

// ===== 上传/拖放域桥接（P2.10②上传拖放）：实现在 smart-canvas-upload-drop.js =====
const uploadDrop = createUploadDrop({
    MEDIA_GROUP_DEFAULT_SCALE,
    MEDIA_GROUP_PREVIOUS_DEFAULT_SCALE,
    MEDIA_NODE_DEFAULT_SCALE,
    SMART_UPLOAD_MAX,
    applyFixedSmartImageNodeSize,
    createImageNodeAt,
    dataTransferItemEntry,
    executeSmartCanvasCommand,
    filesFromEntry,
    isSmartImageNode,
    isSupportedUploadFile,
    render,
    scheduleSave,
    selectedNode,
    smartCanvasAssetClient,
    smartCanvasUploadClient,
    toast,
    tr,
    viewportCenter,
    nodes: () => nodes,
});
function smartDropDataTypes(...args){ return uploadDrop.smartDropDataTypes(...args); }
function smartImageNameFromUrl(...args){ return uploadDrop.smartImageNameFromUrl(...args); }
function resolveSmartImageDropPayload(...args){ return uploadDrop.resolveSmartImageDropPayload(...args); }
function hasSmartImageDropData(...args){ return uploadDrop.hasSmartImageDropData(...args); }
function hasSmartAssetDrag(...args){ return uploadDrop.hasSmartAssetDrag(...args); }
function setSmartDropCopyEffect(...args){ return uploadDrop.setSmartDropCopyEffect(...args); }
function uploadFiles(...args){ return uploadDrop.uploadFiles(...args); }
function appendImagesToSmartNode(...args){ return uploadDrop.appendImagesToSmartNode(...args); }
function handleFiles(...args){ return uploadDrop.handleFiles(...args); }
function importSmartLocalImages(...args){ return uploadDrop.importSmartLocalImages(...args); }
function handleSmartImageDropPayload(...args){ return uploadDrop.handleSmartImageDropPayload(...args); }


const ZOOM_PREVIEW_NODE_DEFAULT_SCALE = 1;

const ZOOM_PREVIEW_NODE_MAX_SCALE = 1.15;

const MEDIA_GROUP_THUMB_BASE = 224;

const MEDIA_GROUP_MAX_VISIBLE_ROWS = 3;

const EMPTY_UPLOAD_NODE_WIDTH = 316;

const EMPTY_UPLOAD_NODE_HEIGHT = 440;


function smartMediaLayoutOptions(){
    return {
        nodeDefaultScale: MEDIA_NODE_DEFAULT_SCALE,
        multiDefaultScale: MEDIA_GROUP_DEFAULT_SCALE,
        multiThumbBase: MEDIA_GROUP_THUMB_BASE,
        maxVisibleRows: MEDIA_GROUP_MAX_VISIBLE_ROWS,
        emptyWidth: EMPTY_UPLOAD_NODE_WIDTH,
        emptyHeight: EMPTY_UPLOAD_NODE_HEIGHT,
        isAudioMediaItem
    };
}

function mediaNodeDefaultScale(node){
    return SmartCanvasMediaLayoutPrimitives.mediaNodeDefaultScale(node, smartMediaLayoutOptions());
}

function createImageNodeAt(point, images=[], options={}){

    const layout = imageLayout(images || [], mediaNodeDefaultScale({type:'smart-image', images:images || []}), {type:'smart-image', images:images || []});

    const node = createNode((point?.x || 0) - Math.round(layout.width / 2), (point?.y || 0) - Math.round(layout.height / 2), images, options);
    if(node && (images || []).length){
        const rect = nodeRect(node);
        node.x = (point?.x || 0) - Math.round(rect.width / 2);
        node.y = (point?.y || 0) - Math.round(rect.height / 2);
    }
    return node;

}

function visibleWorldBounds(){
    const scale = Math.max(0.06, Number(viewport?.scale) || 1);
    return {left:(-Number(viewport?.x || 0)) / scale, top:(-Number(viewport?.y || 0)) / scale, width:(Number(shell?.clientWidth) || 0) / scale, height:(Number(shell?.clientHeight) || 0) / scale};
}
function clampEmptyUploadPointToViewport(point, layout){
    const bounds = visibleWorldBounds(), margin = 18, halfW = Number(layout?.width || EMPTY_UPLOAD_NODE_WIDTH) / 2, halfH = Number(layout?.height || EMPTY_UPLOAD_NODE_HEIGHT) / 2, fallback = viewportCenter();
    const x = Number.isFinite(Number(point?.x)) ? Number(point.x) : fallback.x, y = Number.isFinite(Number(point?.y)) ? Number(point.y) : fallback.y;
    const minX = bounds.left + halfW + margin, maxX = bounds.left + bounds.width - halfW - margin, minY = bounds.top + halfH + margin, maxY = bounds.top + bounds.height - halfH - margin;
    return {x:minX <= maxX ? Math.min(maxX, Math.max(minX, x)) : bounds.left + bounds.width / 2, y:minY <= maxY ? Math.min(maxY, Math.max(minY, y)) : bounds.top + bounds.height / 2};
}
function emptyUploadRectAt(point, layout){ return {x:point.x - Number(layout?.width || EMPTY_UPLOAD_NODE_WIDTH) / 2, y:point.y - Number(layout?.height || EMPTY_UPLOAD_NODE_HEIGHT) / 2, width:Number(layout?.width || EMPTY_UPLOAD_NODE_WIDTH), height:Number(layout?.height || EMPTY_UPLOAD_NODE_HEIGHT)}; }
function isEmptyUploadRectFullyCovered(rect){
    return nodes.some(node => { const existing = nodeRect(node); return existing.x <= rect.x && existing.y <= rect.y && existing.x + existing.width >= rect.x + rect.width && existing.y + existing.height >= rect.y + rect.height; });
}
function emptyUploadPlacementPoint(point){
    const layout = imageLayout([], mediaNodeDefaultScale({type:'smart-image', images:[]}), {type:'smart-image', images:[]}), base = clampEmptyUploadPointToViewport(point, layout);
    if(!isEmptyUploadRectFullyCovered(emptyUploadRectAt(base, layout))) return base;
    for(const [dx, dy] of [[36,0],[-36,0],[0,36],[0,-36],[72,0],[-72,0],[0,72],[0,-72]]){
        const candidate = clampEmptyUploadPointToViewport({x:base.x + dx, y:base.y + dy}, layout);
        if(!isEmptyUploadRectFullyCovered(emptyUploadRectAt(candidate, layout))) return candidate;
    }
    return base;
}
function createEmptyUploadNodeAt(point, options={}){ return createImageNodeAt(emptyUploadPlacementPoint(point), [], options); }

function mediaLayoutSize(img){
    return SmartCanvasMediaLayoutPrimitives.mediaLayoutSize(img);
}

function copyMediaSizeFields(source, target={}){
    return SmartCanvasMediaLayoutPrimitives.copyMediaSizeFields(source, target);
}

function singleImageLayout(image, node, scale){
    return SmartCanvasMediaLayoutPrimitives.singleImageLayout(image, node, scale, smartMediaLayoutOptions());
}


function imageLayout(images, scale=1, node=null){
    return SmartCanvasMediaLayoutPrimitives.imageLayout(images, scale, node, smartMediaLayoutOptions());
}

const SMART_IMAGE_NODE_FIXED_HEIGHT = 440;

// ===== 运行管线域桥接（P2.9）：实现在 smart-canvas-run-pipeline.js =====
const runPipeline = createRunPipeline({
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
    videoRefsOnly,
    nodes: () => nodes,
    setNodes: value => (nodes = value),
    smartRunStateToken: () => smartRunStateToken,
    setSmartRunStateToken: value => (smartRunStateToken = value),
    transientSmartCloudLinks: () => transientSmartCloudLinks,
    setTransientSmartCloudLinks: value => (transientSmartCloudLinks = value),
    undoSuppressed: () => undoSuppressed,
    setUndoSuppressed: value => (undoSuppressed = value),
    canvas: () => canvas,
    settings: () => settings,
    smartCanvasStore: () => smartCanvasStore,
});
function collectPromptParts(...args){ return runPipeline.collectPromptParts(...args); }
function originalPromptTextFromParts(...args){ return runPipeline.originalPromptTextFromParts(...args); }
function buildPromptRequest(...args){ return runPipeline.buildPromptRequest(...args); }
function repairOrphanedFailedPendingOutputs(...args){ return runPipeline.repairOrphanedFailedPendingOutputs(...args); }
function downstreamImageTargetsFor(...args){ return runPipeline.downstreamImageTargetsFor(...args); }
function historyGroupForNode(...args){ return runPipeline.historyGroupForNode(...args); }
function runGeneration(...args){ return runPipeline.runGeneration(...args); }
function smartPendingTasks(...args){ return runPipeline.smartPendingTasks(...args); }
function querySmartImageTaskNow(...args){ return runPipeline.querySmartImageTaskNow(...args); }
function resumeSmartPendingTasks(...args){ return runPipeline.resumeSmartPendingTasks(...args); }

const SMART_IMAGE_NODE_MIN_WIDTH = 220;
const SMART_IMAGE_NODE_MAX_WIDTH = 880;


function toggleSmartCanvasLog(){

    if(smartLogModal?.classList.contains('open')) closeSmartCanvasLog();

    else openSmartCanvasLog();

}

function toggleSmartCanvasShortcuts(){
    if(smartShortcutModal?.classList.contains('open')) closeSmartSurface('shortcut');
    else openSmartSurface('shortcut');

}

function toggleSmartCanvasMinimap(){
    if(!shell) return;
    const hidden = shell.classList.toggle('minimap-hidden');
    try { localStorage.setItem(smartMinimapVisibilityKey(), hidden ? 'hidden' : 'visible'); } catch(e){}
}



function imageProviders(){
    return SMART_CANVAS_PROVIDER_CATALOG.imageProviders(apiProviders);
}


function smartRunNeedsPrompt(sourceSettings=settings){

    sourceSettings = sourceSettings || settings;

    return true;

}

function apiProviderById(providerId){
    return SMART_CANVAS_PROVIDER_CATALOG.findImageProvider(apiProviders, providerId);
}

// 认证素材 asset:// 是平台绑定的：返回某 provider 所属的认证平台键（与后端一致）

function videoProviderPlatform(providerId){
    return SMART_CANVAS_PROVIDER_CATALOG.providerPlatform(apiProviders, providerId);
}

function providerImageModels(providerId){
    return SMART_CANVAS_PROVIDER_CATALOG.imageModels(apiProviders, providerId);
}

// Ids stay stable because they are persisted on nodes; only the visible wording
// explains what the assistant should do with each image.

async function refreshSmartConfigFromSettings(){

    await loadConfig();

    renderDynamicParams();

}



// 多人协作同步：一个稳定的客户端 id，既用于 WS 连接，也随 saveCanvas 上报，

// 服务器广播 canvas_updated 时带回 client_id，自己发的就忽略，避免自我刷新。

const smartClientId = `canvas_smart_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;

// ===== 加载/保存/复制粘贴域桥接（P2.10④加载保存）：实现在 smart-canvas-load-save.js =====
const loadSave = createLoadSave({
    MEDIA_GROUP_DEFAULT_SCALE,
    applyFixedSmartImageNodeSize,
    applyViewport,
    buildSmartCanvasPatch,
    canvasForStorage,
    canvasId,
    cleanupDetachedRunInputRefs,
    clearCompletedNodeBusyStates,
    clearSmartNodeBusyState,
    clearSmartNodeTransientRunState,
    cloneSmartSettings,
    copyMediaSizeFields,
    focusSelectedNodesViewport,
    hideCompletedRunTimers,
    historyGroupForNode,
    imageNameLabel,
    initialSmartSettings: () => initialSmartSettings,
    isApiLikeEngine,
    isEditableTarget,
    isHistoryGroupNode,
    loadRecentSmartSettings,
    markSmartCanvasLogDirty,
    markSmartNodeComplete,
    mediaItemForStorage,
    mediaNodeDefaultScale,
    normalizeLegacySmartNode,
    normalizeSmartVideoModeSettings,
    openAssetNameDialog,
    params,
    persistSmartCanvasLog,
    playGenerationCompleteSound,
    rememberCanvasListProject,
    rememberLastCanvasLocation,
    render,
    repairOrphanedFailedPendingOutputs,
    restoreCanvasAssetLibrarySelection,
    restoreCanvasSmartChatState,
    restoreSmartCanvasMinimapVisibility,
    restoreSmartSurfaceState,
    resultMediaUrls,
    resumeSmartPendingTasks,
    safeScale,
    savePromptDraftForCurrent,
    selectedNodeIds,
    setSmartSaveStatus,
    setSmartStorageBaseline,
    settingsForStorage,
    sizeForRun,
    smartCanvasCanvasSyncClient,
    smartCanvasPatchHasChanges,
    smartCanvasState,
    smartCanvasTaskController,
    smartClientId,
    smartNodeHasDisplayResult,
    smartPendingTasks,
    smartRunPlatformLabel,
    smartRunRequestMeta,
    smartRunTaskLabel,
    sourceProjectId,
    startCanvasMetaPoll,
    stripImageGenerationMeta,
    syncSelectionUi,
    toast,
    tr,
    uid,
    updateProviderModels,
    viewport,
    viewportCenter,
    canvas: () => canvas,
    setCanvas: value => (canvas = value),
    canvasDefaultSmartSettings: () => canvasDefaultSmartSettings,
    setCanvasDefaultSmartSettings: value => (canvasDefaultSmartSettings = value),
    canvasSyncInFlight: () => canvasSyncInFlight,
    setCanvasSyncInFlight: value => (canvasSyncInFlight = value),
    nodeClipboard: () => nodeClipboard,
    setNodeClipboard: value => (nodeClipboard = value),
    nodes: () => nodes,
    setNodes: value => (nodes = value),
    saveQueuedAfterFlight: () => saveQueuedAfterFlight,
    setSaveQueuedAfterFlight: value => (saveQueuedAfterFlight = value),
    saveTimer: () => saveTimer,
    setSaveTimer: value => (saveTimer = value),
    settings: () => settings,
    setSettings: value => (settings = value),
    smartCanvasDocumentModel: () => smartCanvasDocumentModel,
    setSmartCanvasDocumentModel: value => (smartCanvasDocumentModel = value),
    smartCanvasLogsCache: () => smartCanvasLogsCache,
    setSmartCanvasLogsCache: value => (smartCanvasLogsCache = value),
    smartCanvasLogsTotal: () => smartCanvasLogsTotal,
    setSmartCanvasLogsTotal: value => (smartCanvasLogsTotal = value),
    smartCanvasCommandBus: () => smartCanvasCommandBus,
    setSmartCanvasCommandBus: value => (smartCanvasCommandBus = value),
    lastNodePasteAt: () => lastNodePasteAt,
    setLastNodePasteAt: value => (lastNodePasteAt = value),
    canvasUsesConnections: () => canvasUsesConnections,
    setCanvasUsesConnections: value => (canvasUsesConnections = value),
    lastMouseWorld: () => lastMouseWorld,
    setLastMouseWorld: value => (lastMouseWorld = value),
    smartCanvasDocumentStore: () => smartCanvasDocumentStore,
    smartCanvasLogsSummary: () => smartCanvasLogsSummary,
    smartCanvasStore: () => smartCanvasStore,
});
function loadCanvas(...args){ return loadSave.loadCanvas(...args); }
function scheduleSave(...args){ return loadSave.scheduleSave(...args); }
function saveCanvas(...args){ return loadSave.saveCanvas(...args); }
function inheritNodeMetaFromImage(...args){ return loadSave.inheritNodeMetaFromImage(...args); }
function executeSmartCanvasCommand(...args){ return loadSave.executeSmartCanvasCommand(...args); }
function bindSmartCanvasTextEditTransaction(...args){ return loadSave.bindSmartCanvasTextEditTransaction(...args); }
function createNode(...args){ return loadSave.createNode(...args); }
function cloneSmartNode(...args){ return loadSave.cloneSmartNode(...args); }
function copySelectedNodes(...args){ return loadSave.copySelectedNodes(...args); }
function pasteNodes(...args){ return loadSave.pasteNodes(...args); }
function smartRunSnapshot(...args){ return loadSave.smartRunSnapshot(...args); }
function addSmartGenerationLog(...args){ return loadSave.addSmartGenerationLog(...args); }
function deleteNode(...args){ return loadSave.deleteNode(...args); }
function deleteNodeFromButton(...args){ return loadSave.deleteNodeFromButton(...args); }
function deleteImage(...args){ return loadSave.deleteImage(...args); }
function renameSmartNodeImage(...args){ return loadSave.renameSmartNodeImage(...args); }


// ===== 画布同步域桥接（P2.10①）：实现在 smart-canvas-sync-domain.js =====
const canvasSyncDomain = createCanvasSyncDomain({
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
    tr,
    nodes: () => nodes,
    setNodes: value => (nodes = value),
    canvasSyncInFlight: () => canvasSyncInFlight,
    setCanvasSyncInFlight: value => (canvasSyncInFlight = value),
    canvas: () => canvas,
});
function smartNodeInFlight(...args){ return canvasSyncDomain.smartNodeInFlight(...args); }
function smartNodeHasFailedTask(...args){ return canvasSyncDomain.smartNodeHasFailedTask(...args); }
function smartNodeHasDisplayResult(...args){ return canvasSyncDomain.smartNodeHasDisplayResult(...args); }
function clearSmartNodeBusyState(...args){ return canvasSyncDomain.clearSmartNodeBusyState(...args); }
function markSmartNodeComplete(...args){ return canvasSyncDomain.markSmartNodeComplete(...args); }
function hideCompletedRunTimers(...args){ return canvasSyncDomain.hideCompletedRunTimers(...args); }
function clearCompletedNodeBusyStates(...args){ return canvasSyncDomain.clearCompletedNodeBusyStates(...args); }
function syncRunButtonState(...args){ return canvasSyncDomain.syncRunButtonState(...args); }
function handleCanvasUpdatedMessage(...args){ return canvasSyncDomain.handleCanvasUpdatedMessage(...args); }
function handleCanvasTaskUpdatedMessage(...args){ return canvasSyncDomain.handleCanvasTaskUpdatedMessage(...args); }
function startCanvasMetaPoll(...args){ return canvasSyncDomain.startCanvasMetaPoll(...args); }


// ===== 素材库面板域桥接（P2.6）：实现在 smart-canvas-asset-panel-view.js =====
const assetPanelView = createAssetPanelView({
    SmartCanvasAssetLibraryView,
    assetAddCategoryBtn,
    assetAddFilesInput,
    assetCategorySelect,
    assetDialogBackdrop,
    assetDialogCancel,
    assetDialogInput,
    assetDialogOk,
    assetDialogTitle,
    assetDropZone,
    assetGrid,
    assetImageControls,
    assetLibrarySelect,
    assetPanel,
    assetRenameCategoryBtn,
    assetToggle,
    canvasId,
    closeSmartSurface,
    copyMediaSizeFields,
    createMenu,
    escapeHtml,
    handleCanvasTaskUpdatedMessage,
    handleCanvasUpdatedMessage,
    hasSmartImageDropData,
    importSmartLocalImages,
    isSupportedUploadFile,
    mentionPicker,
    openSmartSurface,
    refreshIcons,
    render,
    renderMentionPicker,
    resolveSmartImageDropPayload,
    runCanvasCommand,
    scheduleSave,
    smartCanvasAssetClient,
    smartCanvasTaskController,
    smartClientId,
    smartImageNameFromUrl,
    smartPreviewImgHtml,
    smartVideoFallbackHtml,
    smartVideoPreviewHtml,
    toast,
    tr,
    uploadFiles,
    assetLibrary: () => assetLibrary,
    setAssetLibrary: value => { assetLibrary = value; },
    activeAssetCategoryId: () => activeAssetCategoryId,
    setActiveAssetCategoryId: value => { activeAssetCategoryId = value; },
    activeAssetLibraryId: () => activeAssetLibraryId,
    setActiveAssetLibraryId: value => { activeAssetLibraryId = value; },
    mentionAssetCategoryId: () => mentionAssetCategoryId,
    setMentionAssetCategoryId: value => { mentionAssetCategoryId = value; },
    assetLibraryOpen: () => assetLibraryOpen,
    assetPickerController: () => assetPickerController,
    mentionSource: () => mentionSource,
    nodes: () => nodes,
    canvas: () => canvas,
});
function assetCategories(...args){ return assetPanelView.assetCategories(...args); }
function assetLibraries(...args){ return assetPanelView.assetLibraries(...args); }
function assetLibraryIsLocal(...args){ return assetPanelView.assetLibraryIsLocal(...args); }
function rememberCanvasAssetLibrarySelection(...args){ return assetPanelView.rememberCanvasAssetLibrarySelection(...args); }
function restoreCanvasAssetLibrarySelection(...args){ return assetPanelView.restoreCanvasAssetLibrarySelection(...args); }
function activeAssetTabCategory(...args){ return assetPanelView.activeAssetTabCategory(...args); }
function loadAssetLibrary(...args){ return assetPanelView.loadAssetLibrary(...args); }
function handleAssetLibraryUpdatedMessage(...args){ return assetPanelView.handleAssetLibraryUpdatedMessage(...args); }
function connectAssetLibrarySyncSocket(...args){ return assetPanelView.connectAssetLibrarySyncSocket(...args); }
function setAssetLibraryFromResponse(...args){ return assetPanelView.setAssetLibraryFromResponse(...args); }
function toggleAssetLibrary(...args){ return assetPanelView.toggleAssetLibrary(...args); }
function assetCategoryForMention(...args){ return assetPanelView.assetCategoryForMention(...args); }
function assetMediaKind(...args){ return assetPanelView.assetMediaKind(...args); }
function assetNodeImageFromItem(...args){ return assetPanelView.assetNodeImageFromItem(...args); }
function closeAssetPickers(...args){ return assetPanelView.closeAssetPickers(...args); }
function renderAssetLibrary(...args){ return assetPanelView.renderAssetLibrary(...args); }
function openAssetNameDialog(...args){ return assetPanelView.openAssetNameDialog(...args); }
function bindAssetItemEvents(...args){ return assetPanelView.bindAssetItemEvents(...args); }
function addUrlToAssetLibrary(...args){ return assetPanelView.addUrlToAssetLibrary(...args); }
function localAssetFolderPath(...args){ return assetPanelView.localAssetFolderPath(...args); }
function setLocalAssetLibraryFromResponse(...args){ return assetPanelView.setLocalAssetLibraryFromResponse(...args); }
function addFilesToActiveAssetLibrary(...args){ return assetPanelView.addFilesToActiveAssetLibrary(...args); }
function setAssetDragOver(...args){ return assetPanelView.setAssetDragOver(...args); }


let canvasSyncInFlight = false;


// 迁移旧数据：早期把图片节点作为成员（items[]）放进分组的画布，统一把这些图片吸收进 group.images，

// 让它们显示为卡片内的缩略图网格（新模型）。一次性、幂等。


// 跨页"素材库 → 画布"剪贴板：素材库管理页把所选素材写进这个 localStorage key，

// 画布里按 Ctrl+V 读取并批量生成图片节点（网格平铺），用完即清空（一次性）。





const SMART_LOG_PREVIEW_NODE_ID = '__smart_log_preview__';

// ===== 节点存储/归一化/outpaint 域桥接（P2.10⑧节点模型）：实现在 smart-canvas-node-model.js =====
const nodeModel = createNodeModel({
    SMART_LOG_PREVIEW_NODE_ID,
    initialSmartSettings: () => initialSmartSettings,
    recentSmartSettingsForMode,
    smartClientId,
    stripImageGenerationMeta,
    tr,
    canvas: () => canvas,
    canvasDefaultSmartSettings: () => canvasDefaultSmartSettings,
    settings: () => settings,
    smartCanvasDocumentStore: () => smartCanvasDocumentStore,
});
function cloneSmartSettings(...args){ return nodeModel.cloneSmartSettings(...args); }
function settingsForStorage(...args){ return nodeModel.settingsForStorage(...args); }
function normalizeSmartVideoModeSettings(...args){ return nodeModel.normalizeSmartVideoModeSettings(...args); }
function isApiLikeEngine(...args){ return nodeModel.isApiLikeEngine(...args); }
function isGptImageAutoSizeModel(...args){ return nodeModel.isGptImageAutoSizeModel(...args); }
function defaultSmartApiResolution(...args){ return nodeModel.defaultSmartApiResolution(...args); }
function mediaItemForStorage(...args){ return nodeModel.mediaItemForStorage(...args); }
function canvasForStorage(...args){ return nodeModel.canvasForStorage(...args); }
function setSmartStorageBaseline(...args){ return nodeModel.setSmartStorageBaseline(...args); }
function buildSmartCanvasPatch(...args){ return nodeModel.buildSmartCanvasPatch(...args); }
function smartCanvasPatchHasChanges(...args){ return nodeModel.smartCanvasPatchHasChanges(...args); }
function clearSmartNodeTransientRunState(...args){ return nodeModel.clearSmartNodeTransientRunState(...args); }
function isSmartImageNode(...args){ return nodeModel.isSmartImageNode(...args); }
function isSmartChatNode(...args){ return nodeModel.isSmartChatNode(...args); }
function isSmartRunnableNode(...args){ return nodeModel.isSmartRunnableNode(...args); }
function isHistoryGroupNode(...args){ return nodeModel.isHistoryGroupNode(...args); }
function smartImageMode(...args){ return nodeModel.smartImageMode(...args); }
function normalizeLegacySmartNode(...args){ return nodeModel.normalizeLegacySmartNode(...args); }
function validOutpaintSize(...args){ return nodeModel.validOutpaintSize(...args); }
function stripOutpaintDisplaySettings(...args){ return nodeModel.stripOutpaintDisplaySettings(...args); }
function smartSettingsForNode(...args){ return nodeModel.smartSettingsForNode(...args); }

initialSmartSettings = cloneSmartSettings(settings);
canvasDefaultSmartSettings = cloneSmartSettings(initialSmartSettings);


// ===== 选择/对齐/贴靠域桥接（P2.10⑥选择对齐）：实现在 smart-canvas-selection-align.js =====
const selectionAlign = createSelectionAlign({
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
    world,
    nodes: () => nodes,
    setNodes: value => (nodes = value),
    lastComposerRunnableNodeId: () => lastComposerRunnableNodeId,
    setLastComposerRunnableNodeId: value => (lastComposerRunnableNodeId = value),
    smartSelectedConnectionScopeIds: () => smartSelectedConnectionScopeIds,
    smartSelectedUpstreamIds: () => smartSelectedUpstreamIds,
    smartSelectedDownstreamIds: () => smartSelectedDownstreamIds,
    canvas: () => canvas,
    composerPromptEditingNodeId: () => composerPromptEditingNodeId,
    lastMouseClient: () => lastMouseClient,
    smartCanvasCommandBus: () => smartCanvasCommandBus,
    smartCanvasStore: () => smartCanvasStore,
});
function markSmartNodeOutcomeVisual(...args){ return selectionAlign.markSmartNodeOutcomeVisual(...args); }
function syncSmartNodeOutcomeVisuals(...args){ return selectionAlign.syncSmartNodeOutcomeVisuals(...args); }
function syncSmartCanvasContext(...args){ return selectionAlign.syncSmartCanvasContext(...args); }
function runSmartSelectionDockAction(...args){ return selectionAlign.runSmartSelectionDockAction(...args); }
function syncSelectionDockUi(...args){ return selectionAlign.syncSelectionDockUi(...args); }
function renderCommandDock(...args){ return selectionAlign.renderCommandDock(...args); }
function syncComposerDock(...args){ return selectionAlign.syncComposerDock(...args); }
function toggleComposerDock(...args){ return selectionAlign.toggleComposerDock(...args); }
function syncComposerPromptEditingIndicator(...args){ return selectionAlign.syncComposerPromptEditingIndicator(...args); }
function syncSelectionUi(...args){ return selectionAlign.syncSelectionUi(...args); }
function syncSelectionContextVisuals(...args){ return selectionAlign.syncSelectionContextVisuals(...args); }
function isNodeSelected(...args){ return selectionAlign.isNodeSelected(...args); }
function selectedNodeIds(...args){ return selectionAlign.selectedNodeIds(...args); }
function deleteSelectedSmartNodes(...args){ return selectionAlign.deleteSelectedSmartNodes(...args); }
function primarySelectedNode(...args){ return selectionAlign.primarySelectedNode(...args); }
function toggleSmartNodeSelection(...args){ return selectionAlign.toggleSmartNodeSelection(...args); }
function selectedHeightNormalizableNodes(...args){ return selectionAlign.selectedHeightNormalizableNodes(...args); }
function clearSmartNodeSnapGuides(...args){ return selectionAlign.clearSmartNodeSnapGuides(...args); }
function smartNodeDragSnapOffset(...args){ return selectionAlign.smartNodeDragSnapOffset(...args); }
function startSmartNodeDrag(...args){ return selectionAlign.startSmartNodeDrag(...args); }
function beginSelectedSmartNodeMove(...args){ return selectionAlign.beginSelectedSmartNodeMove(...args); }
function fixedSmartImageNodeSize(...args){ return selectionAlign.fixedSmartImageNodeSize(...args); }
function applyFixedSmartImageNodeSize(...args){ return selectionAlign.applyFixedSmartImageNodeSize(...args); }
function nodeRect(...args){ return selectionAlign.nodeRect(...args); }
function singleImageAspectRatio(...args){ return selectionAlign.singleImageAspectRatio(...args); }
function resetSingleImageAspect(...args){ return selectionAlign.resetSingleImageAspect(...args); }
function smartArrangeAtomicIds(...args){ return selectionAlign.smartArrangeAtomicIds(...args); }
function selectedSmartAlignmentNodes(...args){ return selectionAlign.selectedSmartAlignmentNodes(...args); }
function applySmartNodeAlignment(...args){ return selectionAlign.applySmartNodeAlignment(...args); }
function arrangeSelectedSmartNodes(...args){ return selectionAlign.arrangeSelectedSmartNodes(...args); }
function normalizeSelectedSmartImageHeights(...args){ return selectionAlign.normalizeSelectedSmartImageHeights(...args); }

renderCommandDock(); // 原 createMenu 域的一次性初始渲染（P2.3 时序等价重排；P2.10⑥ 随选择对齐域桥接后再执行）


// ===== 键盘总装域桥接（P2.10③键盘总装）：实现在 smart-canvas-keyboard-domain.js =====
const keyboardDomain = createKeyboardDomain({
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
    viewport,
    nodes: () => nodes,
    nodeClipboard: () => nodeClipboard,
    lastImagePasteAt: () => lastImagePasteAt,
    lastNodePasteAt: () => lastNodePasteAt,
    smartCanvasStore: () => smartCanvasStore,
});

// 移除临时预览节点并还原选中态。供 closeMediaPreview 调用。

const smartCanvasLogView = SmartCanvasLogView.create({
    escapeHtml,
    escapeAttr,
    tr,
    refreshIcons,
    getNodes:() => nodes,
    focusNode:focusSmartLogNode,
    copyMediaSizeFields,
    upstreamNodesForKinds,
    isSmartImageNode,
    parseSizeValue,
    imageResolutionLabel,
    outputUrlLooksVideo,
    smartPreviewImgHtml,
    smartVideoPreviewHtml,
    bindSmartPreviewImageFallbacks,
    copyTextToClipboard,
    smartMediaPreviewUrl,
    displayMediaUrl,
    fileNameFromUrl,
    downloadPreviewFile,
    formatRunDuration,
    nodeMediaSelector:() => SMART_PREVIEW_IMAGE_SELECTOR
});

// ===== surface 开合/任务状态/剪贴板/下载/日志视图域桥接（P2.10⑩日志状态）：实现在 smart-canvas-log-status.js =====
const logStatus = createLogStatus({
    SMART_COMPOSER_COLLAPSED_KEY,
    SMART_LOG_INITIAL_RENDER_COUNT,
    SMART_SURFACE_UI_STATE_KEY,
    VIDEO_OPTION_SECTION_DEFAULTS,
    VIDEO_OPTION_SECTION_STATE_KEY,
    apiProviderById,
    assetPanel,
    assetToggle,
    canvasId,
    composer,
    fitNodeIdsViewport,
    keyboardDomain,
    promptPresetPanel,
    promptTemplatePanel,
    safeExportFileName,
    scheduleSave,
    setSmartSelectionState,
    shell,
    smartCanvasCanvasSyncClient,
    smartCanvasLogView,
    smartCanvasPreviewState,
    smartCanvasState,
    smartCanvasTaskController,
    smartChatPanel,
    smartChatToggle,
    smartComposerToggle,
    smartLogList,
    smartLogModal,
    smartLogSummary,
    smartLogToggle,
    smartSaveStatus,
    smartShortcutModal,
    smartShortcutToggle,
    smartTaskStatus,
    smartTaskStatusText,
    syncComposerDock,
    toast,
    toggleAssetLibrary,
    updateComposer,
    videoProviderById,
    videoOptionSectionState: () => videoOptionSectionState,
    setVideoOptionSectionState: value => (videoOptionSectionState = value),
    smartTaskStatusHideTimer: () => smartTaskStatusHideTimer,
    setSmartTaskStatusHideTimer: value => (smartTaskStatusHideTimer = value),
    smartTaskStatusSessionActive: () => smartTaskStatusSessionActive,
    setSmartTaskStatusSessionActive: value => (smartTaskStatusSessionActive = value),
    assetLibraryOpen: () => assetLibraryOpen,
    setAssetLibraryOpen: value => (assetLibraryOpen = value),
    smartCanvasLogsCache: () => smartCanvasLogsCache,
    setSmartCanvasLogsCache: value => (smartCanvasLogsCache = value),
    smartCanvasLogsTotal: () => smartCanvasLogsTotal,
    setSmartCanvasLogsTotal: value => (smartCanvasLogsTotal = value),
    smartCanvasLogsSummary: () => smartCanvasLogsSummary,
    setSmartCanvasLogsSummary: value => (smartCanvasLogsSummary = value),
    smartLogLoadingMore: () => smartLogLoadingMore,
    setSmartLogLoadingMore: value => (smartLogLoadingMore = value),
    smartLogRenderFrame: () => smartLogRenderFrame,
    setSmartLogRenderFrame: value => (smartLogRenderFrame = value),
    smartLogRenderVersion: () => smartLogRenderVersion,
    setSmartLogRenderVersion: value => (smartLogRenderVersion = value),
    smartLogRenderedVersion: () => smartLogRenderedVersion,
    setSmartLogRenderedVersion: value => (smartLogRenderedVersion = value),
    smartLogServerLoaded: () => smartLogServerLoaded,
    setSmartLogServerLoaded: value => (smartLogServerLoaded = value),
    smartLogVisibleCount: () => smartLogVisibleCount,
    setSmartLogVisibleCount: value => (smartLogVisibleCount = value),
    smartSurface: () => smartSurface,
    setSmartSurface: value => (smartSurface = value),
    nodes: () => nodes,
    settings: () => settings,
    canvas: () => canvas,
});
function smartMinimapVisibilityKey(...args){ return logStatus.smartMinimapVisibilityKey(...args); }
function restoreSmartCanvasMinimapVisibility(...args){ return logStatus.restoreSmartCanvasMinimapVisibility(...args); }
function setVideoOptionSectionOpen(...args){ return logStatus.setVideoOptionSectionOpen(...args); }
function syncSmartSurfaceState(...args){ return logStatus.syncSmartSurfaceState(...args); }
function restoreSmartSurfaceState(...args){ return logStatus.restoreSmartSurfaceState(...args); }
function openSmartSurface(...args){ return logStatus.openSmartSurface(...args); }
function closeSmartSurface(...args){ return logStatus.closeSmartSurface(...args); }
function setSmartSaveStatus(...args){ return logStatus.setSmartSaveStatus(...args); }
function renderSmartTaskStatus(...args){ return logStatus.renderSmartTaskStatus(...args); }
function syncComposerTaskStatusPlacement(...args){ return logStatus.syncComposerTaskStatusPlacement(...args); }
function readTextFromClipboard(...args){ return logStatus.readTextFromClipboard(...args); }
function copyTextToClipboard(...args){ return logStatus.copyTextToClipboard(...args); }
function fileNameFromUrl(...args){ return logStatus.fileNameFromUrl(...args); }
function downloadPreviewImage(...args){ return logStatus.downloadPreviewImage(...args); }
function downloadPreviewFile(...args){ return logStatus.downloadPreviewFile(...args); }
function smartRunPlatformLabel(...args){ return logStatus.smartRunPlatformLabel(...args); }
function smartRunRequestMeta(...args){ return logStatus.smartRunRequestMeta(...args); }
function runViewShortcut(...args){ return logStatus.runViewShortcut(...args); }
function cancelActiveCanvasInteraction(...args){ return logStatus.cancelActiveCanvasInteraction(...args); }
function focusSmartLogNode(...args){ return logStatus.focusSmartLogNode(...args); }
function closeSmartLogLightbox(...args){ return logStatus.closeSmartLogLightbox(...args); }
function markSmartCanvasLogDirty(...args){ return logStatus.markSmartCanvasLogDirty(...args); }
function loadSmartCanvasLogs(...args){ return logStatus.loadSmartCanvasLogs(...args); }
function persistSmartCanvasLog(...args){ return logStatus.persistSmartCanvasLog(...args); }
function openSmartCanvasLog(...args){ return logStatus.openSmartCanvasLog(...args); }
function closeSmartCanvasLog(...args){ return logStatus.closeSmartCanvasLog(...args); }
function closeSmartCanvasShortcuts(...args){ return logStatus.closeSmartCanvasShortcuts(...args); }
syncSmartSurfaceState();



const smartCanvasImageRenderer = SmartCanvasImageRenderer.create({
    escapeHtml,
    escapeAttr,
    tr,
    imageForDisplay,
    getSelectedImage:() => selectedImage,
    getMaxVisibleRows:() => MEDIA_GROUP_MAX_VISIBLE_ROWS,

    smartRecoverableImageTask,
    imageTaskRecoverBodyHtml,
    mediaKindForItem,
    thumbMediaHtml,
    singleMediaHtml,
    shouldSimplifyMultiMedia:() => !isMultiMediaHoverEnabled(),
    multiMediaSummaryHtml,
    imageNameBadgeHtml,
    imageResolutionBadgeHtml
});

function smartImageBodyHtml(node, layout){
    return smartCanvasImageRenderer.render(node, layout);
}

const smartCanvasNodeRenderPipeline = SmartCanvasNodeRenderPipeline.create();

const smartCanvasConnectionRenderer = new SmartCanvasConnectionRenderer(world);

const smartCanvasNodeRenderer = new SmartCanvasNodeRenderer(world);

// ===== 连线/合并域桥接（P2.10③连线合并）：实现在 smart-canvas-connections-domain.js =====
const connectionsDomain = createConnectionsDomain({
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
    world,
    nodes: () => nodes,
    setNodes: value => (nodes = value),
    smartSelectedConnectionScopeIds: () => smartSelectedConnectionScopeIds,
    setSmartSelectedConnectionScopeIds: value => (smartSelectedConnectionScopeIds = value),
    smartSelectedUpstreamIds: () => smartSelectedUpstreamIds,
    setSmartSelectedUpstreamIds: value => (smartSelectedUpstreamIds = value),
    smartSelectedDownstreamIds: () => smartSelectedDownstreamIds,
    setSmartSelectedDownstreamIds: value => (smartSelectedDownstreamIds = value),
    lastNodePasteAt: () => lastNodePasteAt,
    setLastNodePasteAt: value => (lastNodePasteAt = value),
    canvas: () => canvas,
    lastMouseWorld: () => lastMouseWorld,
});
function pasteAssetsFromInbox(...args){ return connectionsDomain.pasteAssetsFromInbox(...args); }
function duplicateForAltDrag(...args){ return connectionsDomain.duplicateForAltDrag(...args); }
function refreshSelectedConnectionScope(...args){ return connectionsDomain.refreshSelectedConnectionScope(...args); }
function renderConnections(...args){ return connectionsDomain.renderConnections(...args); }
function refreshConnectionLayer(...args){ return connectionsDomain.refreshConnectionLayer(...args); }
function scheduleConnectionLayerRefresh(...args){ return connectionsDomain.scheduleConnectionLayerRefresh(...args); }
function moveNodeElementsDuringDrag(...args){ return connectionsDomain.moveNodeElementsDuringDrag(...args); }
function updateNodeElementDuringResize(...args){ return connectionsDomain.updateNodeElementDuringResize(...args); }
function mergeImageNodesIntoGroup(...args){ return connectionsDomain.mergeImageNodesIntoGroup(...args); }
function isSelectableSmartImageGroupMember(...args){ return connectionsDomain.isSelectableSmartImageGroupMember(...args); }
function groupSelectedNodes(...args){ return connectionsDomain.groupSelectedNodes(...args); }
function ungroupNode(...args){ return connectionsDomain.ungroupNode(...args); }


// ===== 视口/渲染域桥接（P2.8）：实现在 smart-canvas-viewport-domain.js =====
const viewportDomain = createViewportDomain({
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
    world,
    minimapViewport: () => minimapViewport,
    setMinimapViewport: value => { minimapViewport = value; },
    nodes: () => nodes,
    canvas: () => canvas,
    canvasUsesConnections: () => canvasUsesConnections,
});

// ===== 节点交互/渲染杂项域桥接（P2.10⑤节点杂项）：实现在 smart-canvas-node-helpers.js =====
const nodeHelpers = createNodeHelpers({
    MEDIA_NODE_DEFAULT_SCALE,
    SMART_CANVAS_MANUAL_CONNECTIONS_ENABLED,
    SMART_IMAGE_NODE_FIXED_HEIGHT,
    activeComposerNode,
    apiImageSize,
    apiProviderById,
    applyThumbDisplaySizeToElement,
    beginSmartNodeDrag,
    beginSmartNodeResize,
    beginSmartPortDrag,
    beginSmartThumbnailDrag,
    bindImageProxyFallback,
    bindSmartChatEvents,
    clearImageClickTimer,
    currentShellRect,
    defaultSmartApiResolution,
    deleteImage,
    deleteNodeFromButton,
    downloadPreviewFile,
    escapeAttr,
    escapeHtml,
    fixedSmartImageNodeSize,
    handleSmartChatAction,
    handleSmartNodeDrop,
    imageForDisplay,
    isApiLikeEngine,
    isGptImageAutoSizeModel,
    isHistoryGroupNode,
    isNodeSelected,
    isSmartChatNode,
    isSmartImageNode,
    isSmartPreviewImage,
    loadSmartOriginalImageDimensions,
    mediaNodeDefaultScale,
    nodeRect,
    openCreateMenu,
    openImagePreviewSmart,
    parseSizeValue,
    pickMediaForSmartNode,
    pickSingleReferenceImageForSmartNode,
    querySmartImageTaskNow,
    renameSmartNodeImage,
    renderSmartTaskStatus,
    resetSmartNodeAspect,
    scheduleComposerUpdate,
    scheduleRunTimerRaf,
    scheduleSave,
    scheduleSmartCanvasRender,
    setSmartDropCopyEffect,
    setSmartNodeDropPreview,
    singleImageAspectRatio,
    singleImageLayout,
    smartActivateVideoPreview,
    smartCanvasState,
    smartCanvasTaskController,
    smartImageBodyHtml,
    smartPendingTasks,
    smartSettingsForNode,
    smartTaskStatus,
    syncSelectionUi,
    toggleSmartNodeSelection,
    updateComposer,
    updateImageResolutionBadgeElement,
    updateNodeElementDuringResize,
    videoProviderById,
    world,
    imageClickTimer: () => imageClickTimer,
    setImageClickTimer: value => (imageClickTimer = value),
    suppressImageClickUntil: () => suppressImageClickUntil,
    setSuppressImageClickUntil: value => (suppressImageClickUntil = value),
    pendingGroupUploadPoint: () => pendingGroupUploadPoint,
    setPendingGroupUploadPoint: value => (pendingGroupUploadPoint = value),
    uploadTargetId: () => uploadTargetId,
    setUploadTargetId: value => (uploadTargetId = value),
    runTimerRaf: () => runTimerRaf,
    setRunTimerRaf: value => (runTimerRaf = value),
    runTimerLast: () => runTimerLast,
    setRunTimerLast: value => (runTimerLast = value),
    suppressNodeClickUntil: () => suppressNodeClickUntil,
    nodes: () => nodes,
    settings: () => settings,
});
function nodeBodyHtml(...args){ return nodeHelpers.nodeBodyHtml(...args); }
function nodeMetaHtml(...args){ return nodeHelpers.nodeMetaHtml(...args); }
function refreshNodeProviderMeta(...args){ return nodeHelpers.refreshNodeProviderMeta(...args); }
function smartRecoverableImageTask(...args){ return nodeHelpers.smartRecoverableImageTask(...args); }
function imageTaskRecoverBodyHtml(...args){ return nodeHelpers.imageTaskRecoverBodyHtml(...args); }
function smartNodeToolbarMediaItem(...args){ return nodeHelpers.smartNodeToolbarMediaItem(...args); }
function nowMs(...args){ return nodeHelpers.nowMs(...args); }
function formatRunDuration(...args){ return nodeHelpers.formatRunDuration(...args); }
function runTimePillHtml(...args){ return nodeHelpers.runTimePillHtml(...args); }
function refreshRunTimerPills(...args){ return nodeHelpers.refreshRunTimerPills(...args); }
function rememberInlineVideoActivations(...args){ return nodeHelpers.rememberInlineVideoActivations(...args); }
function measureSmartNodeImages(...args){ return nodeHelpers.measureSmartNodeImages(...args); }
function bindNodeEvents(...args){ return nodeHelpers.bindNodeEvents(...args); }
function rectOverlapNode(...args){ return nodeHelpers.rectOverlapNode(...args); }
function dragConnectTargetFor(...args){ return nodeHelpers.dragConnectTargetFor(...args); }
function canAutoConnectDraggedNode(...args){ return nodeHelpers.canAutoConnectDraggedNode(...args); }
function restoreDraggedNodePosition(...args){ return nodeHelpers.restoreDraggedNodePosition(...args); }
function clearDropHighlight(...args){ return nodeHelpers.clearDropHighlight(...args); }
function setDropHighlight(...args){ return nodeHelpers.setDropHighlight(...args); }
function isSupportedUploadFile(...args){ return nodeHelpers.isSupportedUploadFile(...args); }
function dataTransferItemEntry(...args){ return nodeHelpers.dataTransferItemEntry(...args); }
function filesFromEntry(...args){ return nodeHelpers.filesFromEntry(...args); }
function sizeForRun(...args){ return nodeHelpers.sizeForRun(...args); }
function pendingBoxSize(...args){ return nodeHelpers.pendingBoxSize(...args); }

function setViewportScaleAtScreenPoint(...args){ return viewportDomain.setViewportScaleAtScreenPoint(...args); }
function applyViewport(...args){ return viewportDomain.applyViewport(...args); }
function scheduleCanvasLayerRefresh(...args){ return viewportDomain.scheduleCanvasLayerRefresh(...args); }
function scheduleSmartCanvasRender(...args){ return viewportDomain.scheduleSmartCanvasRender(...args); }
function scheduleSmartCanvasNodesRender(...args){ return viewportDomain.scheduleSmartCanvasNodesRender(...args); }
function scheduleSmartCanvasStatusRender(...args){ return viewportDomain.scheduleSmartCanvasStatusRender(...args); }
function invalidateShellRectCache(...args){ return viewportDomain.invalidateShellRectCache(...args); }
function currentShellRect(...args){ return viewportDomain.currentShellRect(...args); }
function screenToWorld(...args){ return viewportDomain.screenToWorld(...args); }
function viewportCenter(...args){ return viewportDomain.viewportCenter(...args); }
function minimapEventToWorld(...args){ return viewportDomain.minimapEventToWorld(...args); }
function centerViewportOnWorldPoint(...args){ return viewportDomain.centerViewportOnWorldPoint(...args); }
function fitNodeIdsViewport(...args){ return viewportDomain.fitNodeIdsViewport(...args); }
function focusSelectedNodesViewport(...args){ return viewportDomain.focusSelectedNodesViewport(...args); }
function showAllNodesViewport(...args){ return viewportDomain.showAllNodesViewport(...args); }
function cycleZViewport(...args){ return viewportDomain.cycleZViewport(...args); }
function exitZoomPreview(...args){ return viewportDomain.exitZoomPreview(...args); }
function exitZoomPreviewToNode(...args){ return viewportDomain.exitZoomPreviewToNode(...args); }
function render(...args){ return viewportDomain.render(...args); }



// ===== 事件总装/静态动作域桥接（P2.10④b事件总装）：实现在 smart-canvas-wiring.js =====
const wiring = createWiring({
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
    viewport,
    activeAssetCategoryId: () => activeAssetCategoryId,
    setActiveAssetCategoryId: value => (activeAssetCategoryId = value),
    activeAssetLibraryId: () => activeAssetLibraryId,
    setActiveAssetLibraryId: value => (activeAssetLibraryId = value),
    activePromptLibraryId: () => activePromptLibraryId,
    setActivePromptLibraryId: value => (activePromptLibraryId = value),
    promptPresetDeleteArmed: () => promptPresetDeleteArmed,
    setPromptPresetDeleteArmed: value => (promptPresetDeleteArmed = value),
    promptPresets: () => promptPresets,
    setPromptPresets: value => (promptPresets = value),
    promptTemplateGroupEditMode: () => promptTemplateGroupEditMode,
    setPromptTemplateGroupEditMode: value => (promptTemplateGroupEditMode = value),
    promptTemplateSelectedId: () => promptTemplateSelectedId,
    setPromptTemplateSelectedId: value => (promptTemplateSelectedId = value),
    composerPromptEditingNodeId: () => composerPromptEditingNodeId,
    setComposerPromptEditingNodeId: value => (composerPromptEditingNodeId = value),
    pendingGroupUploadPoint: () => pendingGroupUploadPoint,
    setPendingGroupUploadPoint: value => (pendingGroupUploadPoint = value),
    uploadTargetId: () => uploadTargetId,
    setUploadTargetId: value => (uploadTargetId = value),
    videoParamsExpanded: () => videoParamsExpanded,
    setVideoParamsExpanded: value => (videoParamsExpanded = value),
    assetPickerController: () => assetPickerController,
    setAssetPickerController: value => (assetPickerController = value),
    smartCanvasActionDispatcher: () => smartCanvasActionDispatcher,
    setSmartCanvasActionDispatcher: value => (smartCanvasActionDispatcher = value),
    promptTemplateCategory: () => promptTemplateCategory,
    setPromptTemplateCategory: value => (promptTemplateCategory = value),
    promptTemplateEditing: () => promptTemplateEditing,
    setPromptTemplateEditing: value => (promptTemplateEditing = value),
    mentionAssetCategoryId: () => mentionAssetCategoryId,
    setMentionAssetCategoryId: value => (mentionAssetCategoryId = value),
    lastImagePasteAt: () => lastImagePasteAt,
    setLastImagePasteAt: value => (lastImagePasteAt = value),
    nodes: () => nodes,
    settings: () => settings,
    lastConfigRefreshAt: () => lastConfigRefreshAt,
    promptLibraries: () => promptLibraries,
    nodeClipboard: () => nodeClipboard,
});
function syncApiKindToggleVisibility(...args){ return wiring.syncApiKindToggleVisibility(...args); }
function clearComposerPromptEditing(...args){ return wiring.clearComposerPromptEditing(...args); }
function bindSmartCanvasStaticActions(...args){ return wiring.bindSmartCanvasStaticActions(...args); }
function bindAuroraGlassPointerRefraction(...args){ return wiring.bindAuroraGlassPointerRefraction(...args); }







// 把一个或多个被拖动的节点批量加入目标分组（支持多选拖入）。入组后只整理一次并选中目标分组。



window.SmartCanvasRuntime = Object.freeze({
    getSessionSnapshot(){
        if(!canvasId || !canvas) return null;
        return {
            canvas_id:canvasId,
            revision:Number(canvas.revision || 0),
            updated_at:Number(canvas.updated_at || 0),
            selection:{
                primary_node_id:primarySelectedNode()?.id || '',
                node_ids:selectedNodeIds(),
                image:selectedImage?.nodeId ? {node_id:selectedImage.nodeId, index:Number(selectedImage.index || 0)} : null
            }
        };
    },
    focusNodes(nodeIds=[]){
        const ids = Array.from(new Set(nodeIds.map(value => String(value || '')).filter(id => nodes.some(node => node.id === id))));
        if(!ids.length) return false;
        setSmartSelectionState({primaryId:ids[0], ids:ids.slice(1), image:{nodeId:'', index:-1}}, {source:'smart-canvas-agent'});
        syncSelectionUi();
        updateComposer();
        return fitNodeIdsViewport(ids);
    },
    async reloadCanvas(){
        await loadCanvas();
        render();
        return this.getSessionSnapshot();
    }
});

// E2E/自动化桥：tests/e2e 以裸全局名读写主文件内部绑定；主文件模块化后词法绑定
// 私有，经 window 访问器保活（nodes/viewport 会被重绑定，必须走 getter）。
// 调整 tests/e2e 的引用面前不得删除对应项。
Object.defineProperties(window, {
    smartCanvasState: {value: smartCanvasState},
    nodes: {get: () => nodes},
    viewport: {get: () => viewport},
    viewportCenter: {value: viewportCenter},
    createImageNodeAt: {value: createImageNodeAt},
    applyViewport: {value: applyViewport},
    render: {value: render},
    openSmartSurface: {value: openSmartSurface},
    scheduleSave: {value: scheduleSave},
    capturePendingUndo: {value: capturePendingUndo},
    createEmptyUploadNodeAt: {value: createEmptyUploadNodeAt},
    runGeneration: {value: runGeneration}
});

window.onload = async () => {

    bindSmartCanvasStaticActions();

    bindAuroraGlassPointerRefraction();

    applyTheme(localStorage.getItem('studio_theme') || localStorage.getItem('canvas_theme') || 'dark');

    loadPromptPresets();

    loadPromptTemplateGroups();

    loadPromptTemplateOverrides();

    await loadPromptTemplates();

    if(window.StudioI18n) window.StudioI18n.apply();

    if(window.lucide) lucide.createIcons();

    connectAssetLibrarySyncSocket();

    await loadConfig();

    await loadAssetLibrary();

    await loadCanvas();

    syncApiKindToggleVisibility();

    render();

};
