/*
 * smart-canvas-parameter-domain.js — 参数面板域（settings/recent/参数面板）（Phase 2 P2.7，自 smart-canvas.js 迁入）。
 *
 * ES module 工厂 `createParameterDomain(ctx)`；可变共享状态经 ctx 访问器读写，
 * window 别名与 window 挂载名裸引用直达。DOM 结构与类名零漂移，函数体逐行保留
 * （仅可变绑定读写经 AST 引导精确改写为访问器调用）。
 * 域内包含：recent 运行设置记忆、参数面板动态渲染/绑定/事件、Provider 目录与
 * 尺寸基元消费、媒体引用/上传链接簇（含 setCurrentSmartManualVideoUrl）。
 */
export function createParameterDomain(ctx) {

    const {
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
        validOutpaintSize
    } = ctx;

    // —— 域内状态声明（剩余主文件零引用，随域内迁） ——
    const RECENT_SMART_SETTINGS_KEY = 'smart_canvas_recent_run_settings_v1';

let recentSmartSettingsByMode = {};

function smartSettingsModeKey(source=ctx.settings()){

    return `api:${source?.apiKind === 'video' ? 'video' : 'image'}`;

}

function loadRecentSmartSettings(){

    try {

        const data = JSON.parse(localStorage.getItem(RECENT_SMART_SETTINGS_KEY) || '{}');

        recentSmartSettingsByMode = data && typeof data === 'object' ? data : {};

    } catch(e) {

        recentSmartSettingsByMode = {};

    }

}

function saveRecentSmartSettings(){

    localStorage.setItem(RECENT_SMART_SETTINGS_KEY, JSON.stringify(recentSmartSettingsByMode));

}

function recentSmartSettingsForMode(modeKey=''){

    const key = modeKey || recentSmartSettingsByMode.__lastKey || smartSettingsModeKey(ctx.settings());

    const saved = recentSmartSettingsByMode[key];

    return saved && typeof saved === 'object' ? cloneSmartSettings(saved) : {};

}

function rememberRecentSmartSettings(source=ctx.settings(), node=null){

    const clean = stripOutpaintDisplaySettings(settingsForStorage(source), node);

    sanitizeSmartApiSelection(clean);

    if(clean.outpaintResolutionLocked === true && clean.resolution === 'custom'){

        clean.resolution = '1k';

        clean.ratio = clean.ratio || 'square';

        clean.customWidth = '';

        clean.customHeight = '';

        clean.customSize = '';

    }

    delete clean.outpaintResolutionLocked;

    const key = smartSettingsModeKey(clean);

    recentSmartSettingsByMode[key] = settingsForStorage(clean);

    recentSmartSettingsByMode.__lastKey = key;

    saveRecentSmartSettings();

}

function applyRecentSmartSettingsForCurrentMode(){

    const requestedApiKind = ctx.settings().apiKind === 'video' ? 'video' : 'image';

    const key = smartSettingsModeKey(ctx.settings());

    const saved = recentSmartSettingsForMode(key);

    if(!Object.keys(saved).length){

        ctx.settings().engine = 'api';

        ctx.settings().apiKind = requestedApiKind;

        clearVolcengineSelectionOutsideVolcengine(ctx.settings());

        sanitizeSmartApiSelection(ctx.settings());

        return;

    }

    ctx.setSettings({...ctx.settings(), ...saved, engine:'api', apiKind:requestedApiKind});

    clearVolcengineSelectionOutsideVolcengine(ctx.settings());

    sanitizeSmartApiSelection(ctx.settings());

}

function clearVolcengineSelectionOutsideVolcengine(target=ctx.settings()){

    if(!target || typeof target !== 'object' || target.engine === 'volcengine') return target;

    if(target.provider_id === 'volcengine') target.provider_id = '';

    if(target.videoProvider === 'volcengine') target.videoProvider = '';

    return target;

}

function sanitizeSmartApiSelection(target=ctx.settings()){

    if(!target || typeof target !== 'object') return target;

    // 输出张数按用户选择保留；每个本地任务仍固定向上游请求一张，避免平台默认批量扣费。
    target.count = Math.max(1, Math.min(8, Math.round(Number(target.count) || 1)));

    if(target.engine === 'volcengine'){

        if(target.apiKind === 'video'){

            target.videoProvider = 'volcengine';

            const models = volcengineVideoModels();

            if(!models.includes(target.videoModel)) target.videoModel = models[0] || '';

        } else {

            target.provider_id = 'volcengine';

            const models = providerImageModels('volcengine');

            if(!models.includes(target.model)) target.model = models[0] || '';

        }

        return target;

    }

    clearVolcengineSelectionOutsideVolcengine(target);

    if(target.provider_id){

        const models = providerImageModels(target.provider_id);

        if(models.length && !models.includes(target.model)) target.model = models[0] || '';

    }

    if((target.engine || 'api') === 'api' && (target.apiKind || 'image') !== 'video'){

        const allowAuto = isGptImageAutoSizeModel(target.model);

        if(!target.resolution) target.resolution = allowAuto ? defaultSmartApiResolution(target.model) : '1k';

        if(!allowAuto && target.resolution === 'auto') target.resolution = '1k';

    }

    if(target.videoProvider){

        const models = providerVideoModels(target.videoProvider);

        if(models.length && !models.includes(target.videoModel)) target.videoModel = models[0] || '';

    }

    return target;

}


function modelscopeImageModels(){
    return SMART_CANVAS_PROVIDER_CATALOG.modelscopeImageModels(ctx.apiProviders());
}

const DEFAULT_VIDEO_MODELS = ['veo3-fast','veo3','sora','runway','kling','pika','minimax-video','wan-v2','seedance-1.0-pro'];

function videoApiProviders(){
    return SMART_CANVAS_PROVIDER_CATALOG.videoProviders(ctx.apiProviders(), DEFAULT_VIDEO_MODELS);
}

function videoProviderById(providerId){
    return SMART_CANVAS_PROVIDER_CATALOG.findVideoProvider(ctx.apiProviders(), providerId, DEFAULT_VIDEO_MODELS);
}

function providerVideoModels(providerId){
    return SMART_CANVAS_PROVIDER_CATALOG.videoModels(ctx.apiProviders(), providerId, DEFAULT_VIDEO_MODELS);
}

function volcengineVideoModels(){
    return SMART_CANVAS_PROVIDER_CATALOG.volcengineVideoModels(ctx.apiProviders(), DEFAULT_VIDEO_MODELS);
}

function smartParameterViewDeps(){
    return {
        escapeHtml,
        escapeAttr,
        tr,
        videoAspectIconClass,
        defaultResolution:defaultSmartApiResolution,
        isAutoSizeModel:isGptImageAutoSizeModel,
        sourceImageRatioLabel,
        ratioLabel,
        resolutionLabel,
        apiImageSize
    };
}
// 可信素材模式：打开后可选择素材来源——素材库认证链接 / 自行上传云端 / 自行输入网址。
function optionHtml(value, label, selected){
    return SmartCanvasParameterView.optionHtml(value, label, selected, smartParameterViewDeps());
}

function parseSizeValue(value){
    return SmartCanvasSizePrimitives.parseSizeValue(value);
}

function apiImageSize(ratioValue, resolutionValue, customRatioValue='', customSizeValue=''){
    return SmartCanvasSizePrimitives.apiImageSize(ratioValue, resolutionValue, customRatioValue, customSizeValue);
}

function normalizeApiSizeSettings(prefix=''){
    const allowAuto = !prefix && ctx.settings().engine === 'api' && ctx.settings().apiKind !== 'video' && isGptImageAutoSizeModel(ctx.settings().model);
    return SmartCanvasSizePrimitives.normalizeApiSizeSettings(ctx.settings(), prefix, {
        allowAuto,
        defaultResolution:allowAuto ? defaultSmartApiResolution(ctx.settings().model) : '1k'
    });
}

function updateProviderModels(){ renderDynamicParams(); }

const smartParameterPanelController = new SmartCanvasParameterPanelController({
    root:dynamicParams,
    render:() => renderDynamicParams()
});

function scheduleDynamicParamsRefresh(delay=120){
    return smartParameterPanelController.schedule(delay);
}


// 记住重渲染前哪个控件的弹层是打开的：pinned=点击药丸锁定，interacting=悬浮打开后点了里面的参数。

// 重渲染会重建 DOM、丢掉这两个状态，所以渲染后要按原样恢复，否则点一下就收起来了。

function openControlState(){
    return smartParameterPanelController.captureOpenControl();
}

function restoreOpenControl(state){
    return smartParameterPanelController.restoreOpenControl(state);
}

function dynamicParamsScrollSnapshot(){
    return smartParameterPanelController.captureScroll();
}

function restoreDynamicParamsScroll(snapshot){
    return smartParameterPanelController.restoreScroll(snapshot);
}

let dynamicParamsRenderSig = '';

function renderDynamicParams(){

    if(!dynamicParams) return;

    ctx.settings().engine = 'api';

    ctx.settings().apiKind = ctx.settings().apiKind === 'video' ? 'video' : 'image';

    clearVolcengineSelectionOutsideVolcengine(ctx.settings());

    syncApiKindToggleVisibility();

    const html = ctx.settings().apiKind === 'video' ? buildApiVideoParamsHtml() : buildApiParamsHtml();

    const renderSig = `${ctx.settings().apiKind}\u0000${html}`;

    if(dynamicParamsRenderSig === renderSig){

        updatePromptPlaceholder();

        persistActiveSmartSettings();

        return;

    }

    dynamicParamsRenderSig = renderSig;

    const keepOpen = openControlState();

    const scrollState = dynamicParamsScrollSnapshot();

    dynamicParams.innerHTML = html;

    bindDynamicParams();

    restoreOpenControl(keepOpen);

    restoreDynamicParamsScroll(scrollState);

    updatePromptPlaceholder();

    persistActiveSmartSettings();

    refreshIcons(dynamicParams);

}

function buildApiParamsHtml(){

    const providers = imageProviders();

    if(!ctx.settings().provider_id || !providers.some(p => p.id === ctx.settings().provider_id)) ctx.settings().provider_id = providers[0]?.id || '';

    const models = providerImageModels(ctx.settings().provider_id);

    if(!ctx.settings().model || !models.includes(ctx.settings().model)) ctx.settings().model = models[0] || '';

    // 切换平台/模型时保留用户已选的分辨率（记忆），normalizeApiSizeSettings 只会修正非法的 auto。

    normalizeApiSizeSettings('');

    return `

        <div class="param-line param-line-provider">${SmartCanvasParameterView.renderProviderControl(providers, ctx.settings(), (providers || []).find(provider => provider.id === ctx.settings().provider_id) || apiProviderById(ctx.settings().provider_id), smartParameterViewDeps())}</div>
        <div class="param-line param-line-model">${SmartCanvasParameterView.renderModelControl(models, ctx.settings(), smartParameterViewDeps())}</div>
        <div class="param-line param-line-size-quality">${renderImageSizeQualityControl()}</div>

    `;

}

function buildApiVideoParamsHtml(){

    const providers = videoApiProviders();

    if(!ctx.settings().videoProvider || !providers.some(p => p.id === ctx.settings().videoProvider)) ctx.settings().videoProvider = providers[0]?.id || 'comfly';

    const models = providerVideoModels(ctx.settings().videoProvider);

    if(!ctx.settings().videoModel || !models.includes(ctx.settings().videoModel)) ctx.settings().videoModel = models[0] || 'veo3-fast';

    const videoResolutionOptions = [['', tr('smart.videoResAuto')], ['480p', '480P'], ['720p', '720P'], ['1080p', '1080P']];
    const sourceRatio = sourceImageRatioLabel();
    const videoAspectOptions = [
        ['16:9', '16:9'], ['9:16', '9:16'], ['1:1', '1:1'], ['4:3', '4:3'], ['3:4', '3:4'],
        ['21:9', '21:9'], ['9:21', '9:21'], ['keep_ratio', sourceRatio ? `${tr('smart.videoAspectKeep')} ${sourceRatio}` : tr('smart.videoAspectKeep'), !sourceRatio], ['adaptive', tr('smart.videoAspectAdaptive')]
    ];
    const videoDuration = Math.max(1, Math.min(60, Number(ctx.settings().videoDuration) || 5));
    const videoDurationOptions = [3, 4, 5, 6, 8, 10, 12, 15];
    const videoResolutionLabel = ctx.settings().videoResolution ? ctx.settings().videoResolution.toUpperCase() : tr('smart.videoResAuto');
    const videoAspectLabel = ctx.settings().videoAspect === 'keep_ratio' && sourceRatio ? `${tr('smart.videoAspectKeep')} ${sourceRatio}` : (videoAspectOptions.find(([value]) => value === (ctx.settings().videoAspect || '16:9'))?.[1] || '16:9');
    const renderVideoOptionsSection = (key, title, content, forceOpen=false) => {
        const open = forceOpen || ctx.videoOptionSectionState()[key] !== false;
        return `<section class="video-options-section ${open ? 'is-open' : ''}" data-video-options-section="${key}"><button type="button" class="video-options-section-toggle" data-video-options-section-toggle="${key}" aria-expanded="${open ? 'true' : 'false'}"><span>${title}</span><i data-lucide="chevron-down"></i></button><div class="video-options-section-body">${content}</div></section>`;
    };

    return `

        <div class="param-line param-line-provider">${SmartCanvasParameterView.renderVideoProviderControl(providers, ctx.settings(), (providers || []).find(provider => provider.id === ctx.settings().videoProvider) || apiProviderById(ctx.settings().videoProvider), smartParameterViewDeps())}</div>
        <div class="param-line param-line-model">${SmartCanvasParameterView.renderVideoModelControl(models, ctx.settings(), smartParameterViewDeps())}</div>
        <div class="param-line param-line-video-options-toggle">
            <div class="video-options-control ${ctx.videoParamsExpanded() ? 'open' : ''}">
                <button class="smart-pill video-options-toggle" type="button" data-video-options-toggle aria-expanded="${ctx.videoParamsExpanded() ? 'true' : 'false'}">
                    <i data-lucide="sliders-horizontal"></i><span class="video-options-toggle-title">视频参数</span><span class="video-options-summary">${escapeHtml(videoResolutionLabel)} · ${escapeHtml(videoAspectLabel)} · ${videoDuration}s</span><i class="provider-switch-caret" data-lucide="chevrons-up-down"></i>
                </button>
                <div class="smart-popover video-options-popover">
                    <div class="video-options-popover-head"><span>视频参数</span></div>
                    <div class="video-options-scroll">
                        ${renderVideoOptionsSection('output', '输出规格', `
                            <div class="video-options-section-title">分辨率</div>
                            <div class="video-resolution-grid">
                                ${videoResolutionOptions.map(([value, label]) => `<button type="button" class="video-direct-option ${(ctx.settings().videoResolution || '') === value ? 'active' : ''}" data-smart-param="videoResolution" data-smart-value="${escapeHtml(value)}">${escapeHtml(label)}</button>`).join('')}
                            </div>
                            <div class="video-options-section-title">比例</div>
                            <div class="video-aspect-grid">
                                ${videoAspectOptions.map(([value, label, disabled]) => `<button type="button" class="video-direct-option ${(ctx.settings().videoAspect || '16:9') === value ? 'active' : ''}" data-smart-param="videoAspect" data-smart-value="${escapeHtml(value)}" ${disabled ? 'disabled aria-disabled="true" title="需要当前节点含有参考图"' : ''}>${escapeHtml(label)}</button>`).join('')}
                            </div>
                            <div class="video-options-section-title">时长</div>
                            <div class="video-duration-grid">
                                ${videoDurationOptions.map(value => `<button type="button" class="video-direct-option ${videoDuration === value ? 'active' : ''}" data-smart-param="videoDuration" data-smart-value="${value}">${value}s</button>`).join('')}
                                <label class="video-duration-custom"><span>自定义</span><input type="number" min="1" max="60" step="1" data-param="videoDuration" value="${videoDuration}"><em>s</em></label>
                            </div>
                        `)}
                        ${renderVideoOptionsSection('effects', '生成效果', `<div class="video-options-grid">
                            ${SmartCanvasParameterView.renderVideoToggleControl('videoEnhancePrompt', tr('smart.videoEnhancePrompt'))}
                            ${SmartCanvasParameterView.renderVideoToggleControl('videoEnableUpsample', tr('smart.videoUpsample'))}
                            ${SmartCanvasParameterView.renderVideoToggleControl('videoGenerateAudio', tr('smart.videoGenerateAudio'))}
                        </div>`)}
        ${renderVideoOptionsSection('reference', '镜头与参考', `<div class="video-options-grid">
                            ${SmartCanvasParameterView.renderVideoToggleControl('videoCameraFixed', tr('smart.videoCameraFixed'))}
                            ${SmartCanvasParameterView.renderVideoToggleControl('videoMultimodal', tr('smart.videoMultimodal'))}
                            <div class="video-option-trusted">${SmartCanvasParameterView.renderVideoTrustedAssetControl(ctx.settings(), smartParameterViewDeps())}</div>
                        </div>`, ctx.settings().videoTrustedAsset === true)}
                        ${renderVideoOptionsSection('advanced', '更多设置', `<div class="video-options-grid">
                            ${SmartCanvasParameterView.renderVideoToggleControl('videoWatermark', tr('smart.videoWatermark'))}
                            ${SmartCanvasParameterView.renderVideoToggleControl('videoUseFrameRoles', tr('smart.videoUseFrameRoles'))}
                        </div>`)}
                    </div>
                </div>
            </div>
        </div>

    `;

}

function ratioLabel(prefix=''){
    const ratioKey = prefix ? `${prefix}Ratio` : 'ratio';

    const customKey = prefix ? `${prefix}CustomRatio` : 'customRatio';

    const sourceLabel = sourceImageRatioLabel(prefix) || tr('smart.imageRatio');

    const map = {square:'1:1', portrait:'2:3', landscape:'3:2', portrait43:'3:4', landscape43:'4:3', story:'9:16', wide:'16:9', ultrawide:'21:9', ultratall:'9:21', source:sourceLabel, custom:ctx.settings()[customKey] || tr('smart.custom')};

    return map[ctx.settings()[ratioKey] || 'square'] || '1:1';

}

function imageSizeForRatio(img){
    return SmartCanvasSizePrimitives.imageSizeForRatio(img);
}

function sourceRatioImageForNode(node){

    const images = (node?.images || []).filter(img => img?.url && !isAudioMediaItem(img));

    if(!images.length) return null;

    if(selectedImage.nodeId === node?.id && selectedImage.index >= 0 && imagesForNode(node)[selectedImage.index]){

        const selected = imagesForNode(node)[selectedImage.index];

        if(imageSizeForRatio(selected)) return selected;

    }

    return images.find(img => imageSizeForRatio(img)) || images[0];

}

function reducedRatioForImage(img){
    return SmartCanvasSizePrimitives.reducedRatioForImage(img);
}

function sourceImageRatioLabel(prefix=''){

    const node = activeComposerNode() || selectedNode();

    const ratio = reducedRatioForImage(sourceRatioImageForNode(node));

    if(!ratio) return '';

    return `${ratio.w}:${ratio.h}`;

}

function applySourceRatioToSettings(prefix='', sourceNode=null){

    const ratioKey = prefix ? `${prefix}Ratio` : 'ratio';

    if(ctx.settings()[ratioKey] !== 'source') return;

    const ratio = reducedRatioForImage(sourceRatioImageForNode(sourceNode || activeComposerNode() || selectedNode()));

    if(!ratio) return;

    const customKey = prefix ? `${prefix}CustomRatio` : 'customRatio';

    const wKey = prefix ? `${prefix}CustomRatioWidth` : 'customRatioWidth';

    const hKey = prefix ? `${prefix}CustomRatioHeight` : 'customRatioHeight';

    ctx.settings()[wKey] = ratio.w;

    ctx.settings()[hKey] = ratio.h;

    ctx.settings()[customKey] = `${ratio.w}:${ratio.h}`;

}

function resolutionLabel(prefix=''){

    const resKey = prefix ? `${prefix}Resolution` : 'resolution';

    const sizeKey = prefix ? `${prefix}CustomSize` : 'customSize';

    const value = ctx.settings()[resKey] || ((!prefix && ctx.settings().engine === 'api') ? defaultSmartApiResolution(ctx.settings().model) : '1k');

    if(value === 'auto') return '自动';

    return value === 'custom' ? (ctx.settings()[sizeKey] || tr('smart.custom')) : value.toUpperCase();

}

function videoAspectIconClass(value){
    return SmartCanvasSizePrimitives.videoAspectIconClass(value);
}

function sizePickerDefaultResolution(prefix=''){
    return SmartCanvasParameterView.sizePickerDefaultResolution(prefix, ctx.settings(), smartParameterViewDeps());
}

function renderImageSizeQualityControl(){
    return SmartCanvasParameterView.renderImageSizeQualityControl(ctx.settings(), smartParameterViewDeps());
}

function updatePromptPlaceholder(){

    if(!promptInput) return;

    promptInput.dataset.placeholder = tr('smart.promptPlaceholder');

}

function tempShUploadedUrlFor(url, sourceSettings=ctx.settings()){

    const source = String(url || '');

    const manualLinks = ((sourceSettings || ctx.settings()).videoTempShLinks || []).filter(item => item?.manual === true);

    const links = [...(ctx.transientSmartCloudLinks() || []), ...manualLinks];

    const match = links.find(item =>

        item?.url && (item?.source === source || item?.originalLocalUrl === source || item?.url === source)

    );

    return match?.url || url;

}

function mediaRefSourceUrl(ref){

    return localDisplayUrlForMediaItem(ref) || ref?.sourceUrl || ref?.originalLocalUrl || ref?.url || '';

}

function applyUploadedUrlsToSmartRefs(refs, sourceSettings=ctx.settings()){

    return (refs || []).map(ref => {

        if(!ref?.url) return ref;

        const sourceUrl = mediaRefSourceUrl(ref);

        const url = tempShUploadedUrlFor(sourceUrl, sourceSettings);

        return url && url !== ref.url ? {...ref, url, originalLocalUrl:ref.originalLocalUrl || ref.url} : ref;

    });

}

function manualSmartVideoLink(sourceSettings=ctx.settings()){

    return ((sourceSettings || ctx.settings()).videoTempShLinks || []).find(item => item?.manual === true && item?.url) || null;

}

function manualSmartMediaLinks(sourceSettings=ctx.settings()){

    return ((sourceSettings || ctx.settings()).videoTempShLinks || []).filter(item => item?.manual === true && item?.url);

}

function renderedInputMediaRefs(){

    if(!inputThumbsRow) return [];

    return [...inputThumbsRow.querySelectorAll('.input-thumb')].map((el, index) => ({

        url:el.dataset.url || '',

        sourceUrl:el.dataset.sourceUrl || el.dataset.url || '',

        nodeId:el.dataset.nodeId || '',

        imageIndex:Number.isFinite(Number(el.dataset.imageIndex)) ? Number(el.dataset.imageIndex) : index,

        name:tr('smart.inputNum').replace('{n}', String(index + 1)),

        role:`image_${index + 1}`

    })).filter(ref => ref.url);

}

function currentSmartMediaRefs(node){

    if(!node) return [];

    const request = buildPromptRequest(node, null, true, null);

    return (request.refs || []).filter(ref => ref?.url && ['image','video'].includes(mediaKindForItem(ref)));

}

function currentUploadMediaRefs(node){

    const rendered = renderedInputMediaRefs();

    if(rendered.length) return rendered;

    return currentSmartMediaRefs(node);

}

function currentSmartMediaLinks(node=null){

    return currentUploadMediaRefs(node || activeSettingsSubject()).map(ref => {

        const sourceUrl = mediaRefSourceUrl(ref);

        const uploaded = tempShUploadedUrlFor(sourceUrl);

        return uploaded && uploaded !== sourceUrl ? uploaded : '';

    }).filter(Boolean);

}

function clearManualSmartVideoUrl(){

    ctx.settings().videoTempShLinks = (ctx.settings().videoTempShLinks || []).filter(item => item?.manual !== true);

}

function splitManualMediaUrls(text){

    return String(text || '')

        .split(/[\s,，]+/)

        .map(url => url.trim())

        .filter(Boolean);

}

async function uploadMediaRefToCloud(ref){

    const kind = mediaKindForItem(ref);

    const sourceUrl = mediaRefSourceUrl(ref);

    if(!sourceUrl) throw new Error('没有可上传的媒体');

    const existing = tempShUploadedUrlFor(sourceUrl);

    if(existing && existing !== sourceUrl) return existing;

    if(/^https?:\/\//i.test(sourceUrl)) return sourceUrl;

    const data = await smartCanvasAssetClient.uploadCloudVideo(sourceUrl, 'auto');

    const uploadedUrl = data.url || '';

    if(!uploadedUrl) throw new Error('云端没有返回链接');

    ctx.setTransientSmartCloudLinks([

        ...(ctx.transientSmartCloudLinks() || []).filter(item => item?.source !== sourceUrl),

        {source:sourceUrl, url:uploadedUrl, expires:data.expires || '3 days', kind}

    ]);

    return uploadedUrl;

}

function applyManualVideoUrlToSmartRef(ref, manualUrl){

    if(!manualUrl) return;

    const sourceUrl = mediaRefSourceUrl(ref) || manualUrl;

    ctx.settings().videoTempShLinks = [

        ...(ctx.settings().videoTempShLinks || []).filter(item => item?.source !== sourceUrl),

        {source:sourceUrl, url:manualUrl, manual:true}

    ];

}

async function setCurrentSmartManualVideoUrl(){

    const node = activeSettingsSubject();

    if(!node) return '';

    savePromptDraftForCurrent();

    const refs = currentUploadMediaRefs(node);

    const firstLocal = refs.find(ref => ref?.url && !isRemoteVideoReferenceUrl(ref.url));

    const firstAny = firstLocal || refs[0] || null;

    const linkedUrls = currentSmartMediaLinks(node);

    const currentLinks = linkedUrls.length ? linkedUrls : (firstAny ? [tempShUploadedUrlFor(mediaRefSourceUrl(firstAny))] : []);

    const value = await openAssetNameDialog({

        title:refs.length > 1 ? `输入 ${refs.length} 个媒体网址 / 火山素材 URI` : '输入媒体网址 / 火山素材 URI',

        value:currentLinks.filter(isRemoteVideoReferenceUrl).join('\n'),

        placeholder:refs.length > 1 ? '每行一个链接，按图1/图2顺序对应' : 'https://example.com/media 或 asset://asset-xxx',

        cancelValue:null,

        multiline:refs.length > 1

    });

    if(value === null) return '';

    const urls = splitManualMediaUrls(value);

    if(!urls.length){

        clearManualSmartVideoUrl();

        persistActiveSmartSettings();

        scheduleSave();

        render();

        toast('已清除手动网址');

        return '';

    }

    const invalid = urls.find(url => !isRemoteVideoReferenceUrl(url));

    if(invalid){

        toast('请输入 http/https 媒体网址或 asset:// 火山素材 URI');

        return '';

    }

    clearManualSmartVideoUrl();

    const targets = refs.length ? refs : [firstAny].filter(Boolean);

    urls.forEach((url, index) => {

        const target = targets[index] || targets[targets.length - 1] || {url};

        applyManualVideoUrlToSmartRef(target, url);

    });

    persistActiveSmartSettings();

    scheduleSave();

    render();

    toast(`已设置 ${urls.length} 个媒体网址`);

    return urls[0] || '';

}

async function uploadCurrentSmartVideosToCloud(){

    const node = activeSettingsSubject();

    if(!node) return [];

    savePromptDraftForCurrent();

    const refs = currentUploadMediaRefs(node);

    const localRefs = refs.filter(ref => {

        const sourceUrl = ref?.sourceUrl || ref?.originalLocalUrl || ref?.url || '';

        if(!sourceUrl) return false;

        const uploaded = tempShUploadedUrlFor(sourceUrl);

        return uploaded !== sourceUrl || !isRemoteVideoReferenceUrl(sourceUrl);

    });

    if(!localRefs.length){

        toast('当前输入图片或视频已是云端链接');

        return [];

    }

    const btn = dynamicParams?.querySelector('[data-trusted-source="cloud"]') || inputThumbsRow?.querySelector('[data-temp-sh-upload-video]');

    if(btn) btn.disabled = true;

    toast(`正在上传 ${localRefs.length} 个媒体文件到云端...`);

    try {

        const urls = [];

        for(const ref of localRefs){

            urls.push(await uploadMediaRefToCloud(ref));

        }

        toast(`云端上传完成：${urls.length} 个媒体文件`);

        return urls;

    } finally {

        if(btn) btn.disabled = false;

    }

}

function setDynamicSetting(key, value, options={}){

    restoreComposerNodeSelection();

    const numericKeys = new Set(['count','width','height','videoDuration','enhanceStrength','enhanceUpscaleRes','editUpscaleRes','customRatioWidth','customRatioHeight','customWidth','customHeight','msCustomRatioWidth','msCustomRatioHeight','msCustomWidth','msCustomHeight']);

    const layoutKeys = new Set(['provider_id','model','resolution','ratio','msgenModel','msCustomModel','msResolution','msRatio','videoProvider','videoModel','videoAspect','videoResolution','quality','count','enhanceUpscaleRes','editUpscaleRes']);

    ctx.settings()[key] = numericKeys.has(key) && value !== '' ? Number(value) : value;

    if(key === 'provider_id') ctx.settings().model = '';

    if(key === 'videoProvider') ctx.settings().videoModel = '';

    if(key === 'videoMultimodal') ctx.settings()._videoMultimodalUserSet = true;

    if(key === 'videoMultimodal' && ctx.settings().videoMultimodal) ctx.settings().videoUseFrameRoles = false;

    normalizeSmartVideoModeSettings(ctx.settings(), key === 'videoUseFrameRoles');

    if(key === 'resolution'){

        if(ctx.settings().resolution === 'custom') ctx.settings().ratio = '';

        else if(!ctx.settings().ratio) ctx.settings().ratio = 'square';

    }

    if(key === 'ratio') applySourceRatioToSettings('', options.subject);

    if(key === 'msResolution'){

        if(ctx.settings().msResolution === 'custom') ctx.settings().msRatio = '';

        else if(!ctx.settings().msRatio) ctx.settings().msRatio = 'square';

    }

    if(key === 'msRatio') applySourceRatioToSettings('ms', options.subject);

    if(key === 'customRatioWidth' || key === 'customRatioHeight'){

        ctx.settings().customRatio = ctx.settings().customRatioWidth && ctx.settings().customRatioHeight ? `${ctx.settings().customRatioWidth}:${ctx.settings().customRatioHeight}` : '';

        ctx.settings().ratio = 'custom';

    }

    if(key === 'msCustomRatioWidth' || key === 'msCustomRatioHeight'){

        ctx.settings().msCustomRatio = ctx.settings().msCustomRatioWidth && ctx.settings().msCustomRatioHeight ? `${ctx.settings().msCustomRatioWidth}:${ctx.settings().msCustomRatioHeight}` : '';

        ctx.settings().msRatio = 'custom';

    }

    if(key === 'customWidth' || key === 'customHeight'){

        ctx.settings().customSize = ctx.settings().customWidth && ctx.settings().customHeight ? `${ctx.settings().customWidth}x${ctx.settings().customHeight}` : '';

        ctx.settings().resolution = 'custom';

    }

    if(key === 'msCustomWidth' || key === 'msCustomHeight'){

        ctx.settings().msCustomSize = ctx.settings().msCustomWidth && ctx.settings().msCustomHeight ? `${ctx.settings().msCustomWidth}x${ctx.settings().msCustomHeight}` : '';

        ctx.settings().msResolution = 'custom';

    }

    const sizeKeys = new Set(['resolution','ratio','customRatio','customRatioWidth','customRatioHeight','customWidth','customHeight','customSize']);

    const unlockOutpaintSize = ctx.settings().outpaintResolutionLocked && sizeKeys.has(key);

    if(unlockOutpaintSize){

        delete ctx.settings().outpaintResolutionLocked;

        const subject = options.subject || activeSettingsSubject();

        if(subject) delete subject.outpaintSize;

    }

    const subject = options.subject || activeSettingsSubject();

    if(!options.skipPersist) persistActiveSmartSettings();

    if(!options.skipRemember) rememberRecentSmartSettings(ctx.settings(), subject);

    if(!options.skipRender && layoutKeys.has(key)) renderDynamicParams();

    if(!options.skipSave) scheduleSave();

}

function applySelectedSmartParameterGroup(commandName, group, mutateSubject){
    const batchUtils = window.SmartCanvasParameterBatchUtils;
    const subject = primarySelectedNode();
    const selected = selectedNodeIds().map(id => ctx.nodes().find(node => node.id === id)).filter(isSmartRunnableNode);
    if(!batchUtils || !group || !subject || selected.length < 2) return null;

    const clearOutpaintSize = group === 'imageSize';
    const changed = executeSmartCanvasCommand(commandName, () => {
        ctx.setSettings(smartSettingsForNode(subject));
        if(mutateSubject(subject) === false) return false;

        const needsUpdate = selected.some(node => {
            if(clearOutpaintSize && validOutpaintSize(node)) return true;
            return !batchUtils.groupEquals(ctx.settings(), smartSettingsForNode(node), group);
        });
        if(!needsUpdate) return false;

        selected.forEach(node => {
            const next = node.id === subject.id ? ctx.settings() : smartSettingsForNode(node);
            batchUtils.copyGroup(ctx.settings(), next, group);
            if(clearOutpaintSize){
                delete next.outpaintResolutionLocked;
                delete node.outpaintSize;
            }
            node.runSettings = settingsForStorage(next);
        });
        ctx.setSettings(smartSettingsForNode(subject));
        rememberRecentSmartSettings(ctx.settings(), subject);
        return true;
    }, {skipRender:true});

    if(changed === false) return false;
    renderDynamicParams();
    return true;
}

function setSelectedDynamicSetting(key, value, options={}){
    restoreComposerNodeSelection();
    const noticeCount = composerParameterNoticeCount();
    const group = window.SmartCanvasParameterBatchUtils?.groupForParameter(key) || '';
    const batchResult = applySelectedSmartParameterGroup(`apply-selected-${group || 'parameter'}`, group, subject => {
        setDynamicSetting(key, value, {
            subject,
            skipPersist:true,
            skipRemember:true,
            skipRender:true,
            skipSave:true
        });
        return true;
    });
    if(batchResult !== null){
        if(batchResult && options.notify !== false) showComposerParameterChange(key, value, noticeCount);
        return batchResult;
    }
    const previous = ctx.settings()[key];
    setDynamicSetting(key, value);
    const changed = String(previous ?? '') !== String(ctx.settings()[key] ?? '');
    if(changed && options.notify !== false) showComposerParameterChange(key, value, noticeCount);
    return changed;
}

function closeAllSmartPopovers(){

    document.querySelectorAll('.smart-control.pinned, .smart-control.interacting').forEach(c => c.classList.remove('pinned', 'interacting'));

}

// 悬浮打开弹层后点了里面的参数：标记 interacting，让它熬过重渲染不收起；鼠标真正离开该控件时才关闭。

function markControlInteracting(el){

    const ctrl = el?.closest?.('.smart-control');

    if(ctrl && !ctrl.classList.contains('pinned')) ctrl.classList.add('interacting');

}

function recentModelForSmartProvider(providerId, scope){

    const isVideo = scope === 'video';

    const models = isVideo ? providerVideoModels(providerId) : providerImageModels(providerId);

    if(!models.length) return '';

    const recent = recentSmartSettingsForMode(isVideo ? 'api:video' : 'api:image');

    const recentProvider = isVideo ? recent.videoProvider : recent.provider_id;

    const recentModel = isVideo ? recent.videoModel : recent.model;

    if(recentProvider === providerId && models.includes(recentModel)) return recentModel;

    const prior = ctx.nodes()

        .filter(node => node?.runSettings)

        .slice()

        .sort((a, b) => Number(b.runAt || b.created_at || 0) - Number(a.runAt || a.created_at || 0))

        .map(node => node.runSettings)

        .find(saved => (isVideo ? saved.videoProvider : saved.provider_id) === providerId && models.includes(isVideo ? saved.videoModel : saved.model));

    return (prior ? (isVideo ? prior.videoModel : prior.model) : '') || models[0];

}

function syncSelectedProviderControlPreview(scope, target){
    const control = dynamicParams?.querySelector(`.provider-control[data-provider-scope="${scope}"]`);
    if(!control || !target) return;
    const label = control.querySelector(':scope > .smart-pill .sub');
    if(label) label.textContent = target.name || target.id;
    control.querySelectorAll('[data-smart-param]').forEach(button => {
        button.classList.toggle('active', button.dataset.smartValue === target.id);
    });
}

function applySelectedSmartProvider(scope, providerId, options={}){ // SMART_CANVAS_SELECTION_PLATFORM_CLICK_20260714

    const isVideo = scope === 'video';

    const providers = isVideo ? videoApiProviders() : imageProviders();

    const target = providers.find(provider => provider.id === providerId);

    if(!target) return false;

    const visualSubject = primarySelectedNode();
    const subject = isSmartRunnableNode(visualSubject) ? visualSubject : activeComposerNode();

    if(!subject) return false;

    const selectedNodes = selectedNodeIds().map(id => ctx.nodes().find(node => node.id === id)).filter(isSmartRunnableNode);

    // With no visual selection, apply the change to the Composer's retained target.
    const selected = selectedNodes.length ? selectedNodes : [subject];

    const fallbackModel = recentModelForSmartProvider(target.id, scope);

    let resetModels = 0;

    const changed = executeSmartCanvasCommand('apply-selected-provider', () => {

        selected.forEach(node => {

            const next = smartSettingsForNode(node);

            next.engine = 'api';

            next.apiKind = isVideo ? 'video' : 'image';

            if(isVideo){

                const models = providerVideoModels(target.id);

                next.videoProvider = target.id;

                if(!models.includes(next.videoModel)){

                    next.videoModel = fallbackModel;

                    resetModels++;

                }

            } else {

                const models = providerImageModels(target.id);

                next.provider_id = target.id;

                if(!models.includes(next.model)){

                    next.model = fallbackModel;

                    resetModels++;

                }

            }

            sanitizeSmartApiSelection(next);

            node.runSettings = settingsForStorage(next);

        });

        ctx.setSettings(smartSettingsForNode(subject));

        rememberRecentSmartSettings(ctx.settings(), subject);

        return true;

    }, {skipRender:true, skipUndo:options.skipUndo, skipSave:options.skipSave});

    if(changed === false) return false;

    selected.forEach(refreshNodeProviderMeta);

    if(options.deferRender) syncSelectedProviderControlPreview(scope, target);
    else renderDynamicParams();

    const skipped = selectedNodeIds().length - selected.length;

    const details = [resetModels ? `重置 ${resetModels} 个模型` : '', skipped ? `跳过 ${skipped} 个非运行节点` : ''].filter(Boolean).join('，');

    if(!options.silent) showComposerParameterNotice(`已将 ${selected.length} 个节点切换到 ${target.name || target.id}${details ? `，${details}` : ''}`, 'parameter-success');

    return true;

}

function updateParameterSizeScopeSettings(target, prefix='', scope=''){
    const resolutionKey = prefix ? `${prefix}Resolution` : 'resolution';
    const ratioKey = prefix ? `${prefix}Ratio` : 'ratio';
    const allowAuto = !prefix && target.engine === 'api' && target.apiKind !== 'video' && isGptImageAutoSizeModel(target.model);
    if(scope === 'auto'){
        if(!allowAuto) return false;
        target[resolutionKey] = 'auto';
        if(!target[ratioKey]) target[ratioKey] = 'square';
    } else if(scope === 'custom'){
        target[resolutionKey] = 'custom';
    } else {
        target[resolutionKey] = ['1k', '2k', '4k'].includes(target[resolutionKey])
            ? target[resolutionKey]
            : SmartCanvasParameterView.sizePickerDefaultResolution(prefix, target, smartParameterViewDeps());
        if(!target[ratioKey] || target[ratioKey] === 'custom') target[ratioKey] = 'square';
    }
    return true;
}

function handleParameterSizeScope({prefix='', scope=''}){
    const group = prefix ? 'modelscopeSize' : 'imageSize';
    const noticeCount = composerParameterNoticeCount();
    const batchResult = applySelectedSmartParameterGroup(`apply-selected-${group}`, group, () => {
        return updateParameterSizeScopeSettings(ctx.settings(), prefix, scope);
    });
    if(batchResult !== null){
        if(batchResult) showComposerParameterNotice(`已更新 ${noticeCount} 个节点的尺寸：${{auto:'自动', preset:'系统参数', custom:'自定义'}[scope] || scope}`, 'parameter-success');
        return batchResult;
    }
    if(!updateParameterSizeScopeSettings(ctx.settings(), prefix, scope)) return false;
    persistActiveSmartSettings();
    rememberRecentSmartSettings(ctx.settings(), activeSettingsSubject());
    renderDynamicParams();
    scheduleSave();
    if(noticeCount) showComposerParameterNotice(`已更新 ${noticeCount} 个节点的尺寸：${{auto:'自动', preset:'系统参数', custom:'自定义'}[scope] || scope}`, 'parameter-success');
    return true;
}

function handleParameterToggle({key}){
    ctx.settings()[key] = !ctx.settings()[key];
    if(key === 'videoMultimodal') ctx.settings()._videoMultimodalUserSet = true;
    if(key === 'videoMultimodal' && ctx.settings().videoMultimodal) ctx.settings().videoUseFrameRoles = false;
    normalizeSmartVideoModeSettings(ctx.settings(), key === 'videoUseFrameRoles');
    persistActiveSmartSettings();
    renderDynamicParams();
    scheduleSave();
}

async function handleParameterTrustedSource({source}){
    const normalized = ['library', 'cloud', 'manual'].includes(source) ? source : 'library';
    ctx.settings().videoTrustedSource = normalized;
    persistActiveSmartSettings();
    renderDynamicParams();
    scheduleSave();
    try {
        if(normalized === 'cloud') await uploadCurrentSmartVideosToCloud();
        else if(normalized === 'manual') await setCurrentSmartManualVideoUrl();
    } catch(e) {
        toast((e.message || '操作失败').slice(0, 180));
    }
}

const smartParameterBindings = new SmartCanvasParameterBindings({
    root:dynamicParams,
    callbacks:{
        closeAllPopovers:() => closeAllSmartPopovers(),
        markInteracting:({element}) => markControlInteracting(element),
        providerSelect:({scope, providerId}) => applySelectedSmartProvider(scope, providerId),
        smartParam:({key, value}) => {
            setSelectedDynamicSetting(key, value);
            if(key === 'videoDuration') renderDynamicParams();
        },
        sizeScope:handleParameterSizeScope,
        input:({key, value, event}) => {
            setSelectedDynamicSetting(key, value, {notify:event?.type === 'change'});
            if(key === 'videoDuration' && event?.type === 'change') renderDynamicParams();
        },
        toggle:handleParameterToggle,
        trustedSource:handleParameterTrustedSource
    }
});

function bindDynamicParams(){
    return smartParameterBindings.bind(dynamicParams);
}

async function loadConfig(){
    try {
        const cfg = await smartCanvasConfigClient.load();
        ctx.setApiProviders(Array.isArray(cfg.api_providers) ? cfg.api_providers : []);
        sanitizeSmartApiSelection(ctx.settings());
        updateProviderModels();
        ctx.setLastConfigRefreshAt(Date.now());
    } catch(e) {
        toast(tr('smart.toastApiSettingsFail'));
    }
}

    return {
        loadRecentSmartSettings,
        recentSmartSettingsForMode,
        rememberRecentSmartSettings,
        applyRecentSmartSettingsForCurrentMode,
        modelscopeImageModels,
        videoProviderById,
        parseSizeValue,
        apiImageSize,
        updateProviderModels,
        scheduleDynamicParamsRefresh,
        renderDynamicParams,
        applyUploadedUrlsToSmartRefs,
        manualSmartVideoLink,
        manualSmartMediaLinks,
        closeAllSmartPopovers,
        loadConfig
    };

}
