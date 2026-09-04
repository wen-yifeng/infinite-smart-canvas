/*
 * smart-canvas-node-model.js — 节点存储/归一化/outpaint 域（Phase 2 P2.10⑧，自 smart-canvas.js 迁入）。
 *
 * ES module 工厂 `createNodeModel(ctx)`；可变共享状态经 ctx 访问器读写，
 * window 别名与 window 挂载名裸引用直达。DOM 结构与类名零漂移，函数体逐行保留
 * （仅可变绑定读写经 AST 引导精确改写为访问器调用）。
 * 域内包含：settings 克隆/存储形状、存储基线与画布补丁、节点瞬态运行态清理、
 * 节点类型判断与旧格式归一化、outpaint 显示设置、smartSettingsForNode。
 */
export function createNodeModel(ctx) {

    const {
        SMART_LOG_PREVIEW_NODE_ID,
        recentSmartSettingsForMode,
        smartClientId,
        stripImageGenerationMeta,
        tr
    } = ctx;

function cloneSmartSettings(source=ctx.settings()){

    return SmartCanvasStoragePrimitives.cloneSmartSettings(source);

}

function settingsForStorage(source=ctx.settings()){

    return SmartCanvasStoragePrimitives.settingsForStorage(source);

}

function normalizeSmartVideoModeSettings(target, preferMultimodal=false){

    return SmartCanvasStoragePrimitives.normalizeSmartVideoModeSettings(target, preferMultimodal);

}

function isApiLikeEngine(engine){

    return SmartCanvasStoragePrimitives.isApiLikeEngine(engine);

}

function isGptImageAutoSizeModel(model){

    return SmartCanvasStoragePrimitives.isGptImageAutoSizeModel(model);

}

function defaultSmartApiResolution(model){

    return SmartCanvasStoragePrimitives.defaultSmartApiResolution(model);

}

function mediaItemForStorage(item){

    return SmartCanvasStoragePrimitives.mediaItemForStorage(item);

}

function canvasForStorage(){

    return SmartCanvasStoragePrimitives.buildCanvasForStorage({

        canvas: ctx.canvas(),

        canvasDefaultSmartSettings: ctx.canvasDefaultSmartSettings(),

        initialSmartSettings: ctx.initialSmartSettings(),

        smartLogPreviewNodeId:SMART_LOG_PREVIEW_NODE_ID,

        normalizeDocument:window.SmartCanvasDocumentPrimitives?.normalizeDocument,

    });

}

function setSmartStorageBaseline(storageCanvas){

    ctx.smartCanvasDocumentStore().setBaseline(storageCanvas);

}

function buildSmartCanvasPatch(storageCanvas){

    return ctx.smartCanvasDocumentStore().buildPatch(storageCanvas, {

        clientId: smartClientId,

        fallbackUpdatedAt: ctx.canvas()?.updated_at || 0

    });

}

function smartCanvasPatchHasChanges(patch){

    return ctx.smartCanvasDocumentStore().hasChanges(patch);

}

function clearSmartNodeTransientRunState(node, options={}){

    if(!node) return node;

    node.running = false;

    node.pending = 0;

    node.queued = false;
    delete node.pendingTasks;

    delete node._runMetaTargetId;

    if(options.clearRunHistory){

        delete node.runStartedAt;

        delete node.runFinishedAt;

        delete node.runElapsedMs;

        delete node.runTimerHidden;

    }

    return node;

}


function isSmartImageNode(node){

    return Boolean(node && (node.type === 'smart-image' || !node.type));

}

function isSmartChatNode(node){
    return Boolean(node && node.type === 'smart-chat');
}

function isSmartRunnableNode(node){

    return isSmartImageNode(node);

}

function isHistoryGroupNode(node){

    return Boolean(isSmartImageNode(node) && (node.isHistoryGroup || node.historyFor));

}

function smartImageMode(node){

    return 'self';

}

function normalizeLegacySmartNode(node){

    if(!node || typeof node !== 'object') return node;

    const rawType = String(node.type || '');
    if(rawType === 'smart-chat' && window.SmartCanvasDocumentPrimitives?.normalizeNode){
        return SmartCanvasDocumentPrimitives.normalizeNode(node) || node;
    }
    if(rawType !== 'smart-container' && window.SmartCanvasDocumentPrimitives?.normalizeNode){
        node = SmartCanvasDocumentPrimitives.normalizeNode(node) || node;
    }
    if(node.type === 'smart-container'){

        const fallbackImage = node.inputImage?.url ? stripImageGenerationMeta({

            url:node.inputImage.url,

            name:node.inputImage.name || 'image',

            kind:node.inputImage.kind || mediaKindForItem(node.inputImage),

            natural_w:Number(node.inputImage.natural_w || 0),

            natural_h:Number(node.inputImage.natural_h || 0)

        }) : null;

        const images = Array.isArray(node.images) && node.images.length

            ? node.images

            : (fallbackImage ? [fallbackImage] : []);

        const normalized = {

            ...node,

            type:'smart-image',

            title:images.length > 1 ? 'Group' : (images.length ? 'Image' : tr('smart.createImportNode')),

            images

        };

        delete normalized.imageMode;

        delete normalized.inputImage;

        delete normalized.steps;

        delete normalized.resultGrouping;

        return normalized;

    }

    if(!node.type) node.type = 'smart-image';

    if(node.type === 'smart-image') delete node.imageMode;

    if(node.type === 'smart-image' && node.historyFor) node.isHistoryGroup = true;

    return node;

}

function validOutpaintSize(node){

    const w = Math.round(Number(node?.outpaintSize?.width || 0));

    const h = Math.round(Number(node?.outpaintSize?.height || 0));

    return w > 0 && h > 0 ? {width:w, height:h} : null;

}

function withOutpaintDisplaySettings(node, baseSettings){

    const size = validOutpaintSize(node);

    if(!size) return baseSettings;

    const engine = ['api','volcengine','modelscope'].includes(baseSettings?.engine) ? baseSettings.engine : 'api';

    const next = {

        ...baseSettings,

        resolution:'custom',

        ratio:'',

        customWidth:size.width,

        customHeight:size.height,

        customSize:`${size.width}x${size.height}`,

        outpaintResolutionLocked:true

    };

    if(isApiLikeEngine(engine)) next.apiKind = 'image';

    if(engine === 'modelscope'){

        next.msResolution = 'custom';

        next.msRatio = '';

        next.msCustomWidth = size.width;

        next.msCustomHeight = size.height;

        next.msCustomSize = `${size.width}x${size.height}`;

    }

    return next;

}

function stripOutpaintDisplaySettings(settingsObj, node=null){

    const clean = cloneSmartSettings(settingsObj);

    const size = validOutpaintSize(node);

    const matchesOutpaintSize = size && clean.resolution === 'custom' && String(clean.customSize || '') === `${size.width}x${size.height}`;

    if(matchesOutpaintSize){

        clean.resolution = '1k';

        clean.ratio = clean.ratio || 'square';

        clean.customWidth = '';

        clean.customHeight = '';

        clean.customSize = '';

    }

    const matchesMsOutpaintSize = size && clean.msResolution === 'custom' && String(clean.msCustomSize || '') === `${size.width}x${size.height}`;

    if(matchesMsOutpaintSize){

        clean.msResolution = '1k';

        clean.msRatio = clean.msRatio || 'square';

        clean.msCustomWidth = '';

        clean.msCustomHeight = '';

        clean.msCustomSize = '';

    }

    if(size && Number(clean.width) === size.width && Number(clean.height) === size.height){

        clean.width = 1024;

        clean.height = 1024;

    }

    delete clean.outpaintResolutionLocked;

    return clean;

}

function smartSettingsForNode(node){

    const nodeSettings = stripOutpaintDisplaySettings(node?.runSettings || {}, node);

    const recentSettings = Object.keys(nodeSettings).length ? {} : recentSmartSettingsForMode();

    const base = {

        ...cloneSmartSettings(ctx.canvasDefaultSmartSettings() || ctx.initialSmartSettings()),

        ...recentSettings,

        ...nodeSettings

    };

    normalizeSmartVideoModeSettings(base, true);

    return withOutpaintDisplaySettings(node, base);

}

    return {
        cloneSmartSettings,
        settingsForStorage,
        normalizeSmartVideoModeSettings,
        isApiLikeEngine,
        isGptImageAutoSizeModel,
        defaultSmartApiResolution,
        mediaItemForStorage,
        canvasForStorage,
        setSmartStorageBaseline,
        buildSmartCanvasPatch,
        smartCanvasPatchHasChanges,
        clearSmartNodeTransientRunState,
        isSmartImageNode,
        isSmartChatNode,
        isSmartRunnableNode,
        isHistoryGroupNode,
        smartImageMode,
        normalizeLegacySmartNode,
        validOutpaintSize,
        stripOutpaintDisplaySettings,
        smartSettingsForNode
    };

}
