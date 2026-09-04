/*
 * smart-canvas-overlay-views.js — 聊天面板 + 媒体预览模态域（Phase 2 P2.4，自 smart-canvas.js 迁入）。
 *
 * 聊天域：SmartCanvasVisualAssistantView 接线、会话归一化与持久化、面板渲染、
 * 发送/停止/变体/审阅动作、事件绑定。预览域：媒体预览模态（缩放/平移/切换/定位）。
 * 可变共享状态经 ctx 访问器读写；selectedId/selectedIds/selectedImage 经 window
 * 别名直达。DOM 结构与类名零漂移，行为逐行保留。
 */
export function createOverlayViews(ctx) {

    const {
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
        world
    } = ctx;

const SMART_CHAT_UI_STATE_KEY = 'visual_assistant';
const SMART_CHAT_SESSION_ID = 'visual-assistant';
const smartChatControllers = new Map();
let smartChatEventsBound = false;

const smartChatView = SmartCanvasVisualAssistantView.createView({
    panel:smartChatPanel,
    latestOptimizedMessage:smartChatLatestOptimizedMessage,
    targetForNode:smartChatTargetNode,
    nodePrompt:smartChatNodePrompt,
    findNode:nodeId => ctx.nodes().find(candidate => candidate.id === nodeId)
});

const SMART_CHAT_ATTACHMENT_ROLES = Object.freeze([
    {id:'product', label:'这是要改的图', hint:'助手会重点分析它的问题并给出修改建议'},
    {id:'result', label:'这是刚生成的结果', hint:'助手会检查它和提示词是否一致，指出需要返工的地方'},
    {id:'style', label:'照它的风格来', hint:'助手只参考它的色调、光影和质感，不照搬产品'},
    {id:'competitor', label:'照它的做法来', hint:'助手会对比构图和卖点表达，找出可借鉴之处'},
    {id:'negative', label:'不要做成这样', hint:'助手会把它当成要避开的反面例子'}
]);

// One explicit task per run. The old panel exposed three send buttons with no
// stated difference; the task is now a named choice that also drives the run
// button label, the placeholder and the write-back affordances.
const SMART_CHAT_TASK_MODES = Object.freeze([
    {id:'chat', icon:'message-square-text', label:'看图找问题', hint:'读懂画面，按优先级列出可以改的地方。只回文字建议。', run:'开始看图', needImages:false,
        example:'请分析这张图的构图、光影、产品展示和文字信息，按优先级列出需要改进的地方。'},
    {id:'optimize', icon:'wand-sparkles', label:'写生图提示词', hint:'产出一段可直接写回节点的提示词，写回前能先对比差异。', run:'生成提示词', needImages:true,
        example:'把这张图优化成干净专业的电商主图：保留产品主体，改进构图、背景、光影和留白。'},
    {id:'review', icon:'list-checks', label:'逐张审片', hint:'每张图单独给出问题清单和对应提示词，可以逐张写回。', run:'逐张审片', needImages:true,
        example:'请逐张检查产品结构、比例、材质、文字和画面错误，并给出每张图可直接使用的改进提示词。'}
]);

function smartChatTaskMode(node){
    const selected = String(node?.chatTaskMode || 'chat');
    return SMART_CHAT_TASK_MODES.some(item => item.id === selected) ? selected : 'chat';
}

function smartChatProviders(){
    return (Array.isArray(ctx.apiProviders()) ? ctx.apiProviders() : []).filter(provider => {
        const models = Array.isArray(provider?.chat_models) ? provider.chat_models.filter(Boolean) : [];
        return provider && provider.enabled !== false && models.length;
    });
}

function smartChatProviderById(providerId){
    return smartChatProviders().find(provider => provider.id === providerId) || null;
}

function smartChatModelsForProvider(providerId){
    const provider = smartChatProviderById(providerId);
    return Array.isArray(provider?.chat_models) ? provider.chat_models.filter(Boolean) : [];
}

function defaultSmartChatSession({linkSelected=false}={}){
    const provider = smartChatProviders()[0] || null;
    const models = provider ? smartChatModelsForProvider(provider.id) : [];
    const linkedIds = linkSelected
        ? selectedNodeIds().map(id => ctx.nodes().find(node => node.id === id)).filter(isSmartImageNode).map(node => node.id)
        : [];
    return {
        id:SMART_CHAT_SESSION_ID,
        type:'smart-chat-session',
        title:'AI助手',
        inputNodeIds:[...new Set(linkedIds)],
        chatAttachmentRoles:Object.fromEntries(linkedIds.map(id => [id, 'result'])),
        chatProviderId:provider?.id || '',
        chatModel:models[0] || '',
        chatModelByProvider:{},
        chatDraft:'',
        chatTaskMode:'chat',
        chatTargetNodeId:linkedIds[0] || '',
        messages:[],
        promptHistory:[],
    };
}

function normalizeSmartChatReviewItems(value){
    if(!Array.isArray(value)) return [];
    return value.map(item => {
        if(!item || typeof item !== 'object') return null;
        return {
            node_id:String(item.node_id || item.nodeId || ''),
            title:String(item.title || ''),
            issues:String(item.issues || ''),
            optimized_prompt:String(item.optimized_prompt || item.optimizedPrompt || ''),
        };
    }).filter(item => item && item.node_id);
}

function normalizeSmartChatSession(source={}){
    const base = defaultSmartChatSession();
    const inputNodeIds = [...new Set((Array.isArray(source?.inputNodeIds) ? source.inputNodeIds : []).map(String).filter(Boolean))];
    const sourceRoles = source?.chatAttachmentRoles && typeof source.chatAttachmentRoles === 'object' ? source.chatAttachmentRoles : {};
    const chatAttachmentRoles = {};
    inputNodeIds.forEach(id => {
        const role = String(sourceRoles[id] || 'product');
        chatAttachmentRoles[id] = SMART_CHAT_ATTACHMENT_ROLES.some(item => item.id === role) ? role : 'product';
    });
    const messages = (Array.isArray(source?.messages) ? source.messages : []).slice(-40).map(message => ({
        id:String(message?.id || uid('chat-msg')),
        role:message?.role === 'assistant' ? 'assistant' : 'user',
        text:String(message?.text || ''),
        optimizedPrompt:String(message?.optimizedPrompt || message?.optimized_prompt || ''),
        reviewItems:normalizeSmartChatReviewItems(message?.reviewItems || message?.review_items),
        error:Boolean(message?.error),
        createdAt:Number(message?.createdAt || message?.created_at || Date.now()),
    }));
    const promptHistory = (Array.isArray(source?.promptHistory) ? source.promptHistory : []).slice(-20).map(entry => ({

        id:String(entry?.id || uid('prompt-version')),
        targetNodeId:String(entry?.targetNodeId || ''),
        previousPrompt:String(entry?.previousPrompt || ''),
        nextPrompt:String(entry?.nextPrompt || ''),
        createdAt:Number(entry?.createdAt || Date.now()),
    })).filter(entry => entry.targetNodeId);
    const providerId = String(source?.chatProviderId || base.chatProviderId || '');
    const models = smartChatModelsForProvider(providerId);
    const requestedModel = String(source?.chatModel || '');
    const hasExplicitTarget = Object.prototype.hasOwnProperty.call(source || {}, 'chatTargetNodeId');
    // 平台级模型记忆：只保留仍在对应平台模型列表内的记录，失效项静默丢弃。
    const rawModelMap = source?.chatModelByProvider && typeof source.chatModelByProvider === 'object' ? source.chatModelByProvider : {};
    const chatModelByProvider = {};
    Object.entries(rawModelMap).forEach(([rememberedProviderId, rememberedModel]) => {
        if(typeof rememberedModel !== 'string' || !rememberedModel) return;
        if(smartChatModelsForProvider(String(rememberedProviderId)).includes(rememberedModel)) chatModelByProvider[String(rememberedProviderId)] = rememberedModel;
    });
    return {
        ...base,
        id:SMART_CHAT_SESSION_ID,
        type:'smart-chat-session',
        title:'AI助手',
        inputNodeIds,
        chatAttachmentRoles,
        chatProviderId:providerId,
        chatModel:models.includes(requestedModel) ? requestedModel : (requestedModel || models[0] || ''),
        chatModelByProvider,
        chatDraft:String(source?.chatDraft || ''),
        chatTaskMode:SMART_CHAT_TASK_MODES.some(item => item.id === String(source?.chatTaskMode || '')) ? String(source.chatTaskMode) : 'chat',
        chatTargetNodeId:hasExplicitTarget ? String(source?.chatTargetNodeId || '') : (inputNodeIds[0] || ''),
        messages,
        promptHistory,
    };
}

function canvasSmartChatState(){
    const state = ctx.canvas()?.ui_state?.[SMART_CHAT_UI_STATE_KEY];
    return state && typeof state === 'object' ? state : null;
}

function smartChatSessionForId(sessionId=''){
    if(sessionId && sessionId !== SMART_CHAT_SESSION_ID) return null;
    if(!ctx.smartChatSession()) ctx.setSmartChatSession( normalizeSmartChatSession(canvasSmartChatState() || {}));
    return ctx.smartChatSession();
}

function rememberCanvasSmartChatState({schedule=true}={}){
    if(!ctx.canvas() || !canvasId || !ctx.smartChatSession()) return;
    const before = JSON.stringify(ctx.canvas().ui_state || {});
    ctx.canvas().ui_state = {
        ...(ctx.canvas().ui_state && typeof ctx.canvas().ui_state === 'object' ? ctx.canvas().ui_state : {}),
        [SMART_CHAT_UI_STATE_KEY]: JSON.parse(JSON.stringify(ctx.smartChatSession())),
    };
    if(schedule && JSON.stringify(ctx.canvas().ui_state) !== before) scheduleSave();
}

function restoreCanvasSmartChatState(){
    const saved = canvasSmartChatState();
    const legacySessions = ctx.nodes().filter(isSmartChatNode);
    const legacy = legacySessions.at(-1) || null;
    const legacyIds = new Set(legacySessions.map(node => node.id));
    const source = saved || legacy || {};
    const restored = normalizeSmartChatSession(source);
    const validImageIds = new Set(ctx.nodes().filter(isSmartImageNode).map(node => node.id));
    restored.inputNodeIds = restored.inputNodeIds.filter(id => validImageIds.has(id));
    restored.chatAttachmentRoles = Object.fromEntries(Object.entries(restored.chatAttachmentRoles).filter(([id]) => restored.inputNodeIds.includes(id)));
    if(restored.chatTargetNodeId && !restored.inputNodeIds.includes(restored.chatTargetNodeId)) restored.chatTargetNodeId = restored.inputNodeIds[0] || '';
    restored.promptHistory = restored.promptHistory.filter(entry => validImageIds.has(entry.targetNodeId));
    ctx.setSmartChatSession( restored);
    ctx.setSmartChatRenderedSignature( '');
    if(legacyIds.size){
        ctx.setNodes( ctx.nodes().filter(node => !legacyIds.has(node.id)));
        if(Array.isArray(ctx.canvas()?.connections)) ctx.canvas().connections = ctx.canvas().connections.filter(connection => !legacyIds.has(connection.from) && !legacyIds.has(connection.to));
    }
    const normalizedChanged = Boolean(saved) && JSON.stringify(saved) !== JSON.stringify(restored);
    if(saved || legacyIds.size) rememberCanvasSmartChatState({schedule:false});
    if(legacyIds.size || normalizedChanged) scheduleSave();
}

function smartChatLinkedNodes(node){
    const ids = Array.isArray(node?.inputNodeIds) ? node.inputNodeIds : [];
    return ids.map(id => ctx.nodes().find(item => item.id === id)).filter(item => isSmartImageNode(item));
}

function smartChatAttachmentRole(node, nodeId){
    const selected = String(node?.chatAttachmentRoles?.[nodeId] || 'product');
    return SMART_CHAT_ATTACHMENT_ROLES.some(item => item.id === selected) ? selected : 'product';
}

function smartChatAttachmentRoleLabel(role){
    return SMART_CHAT_ATTACHMENT_ROLES.find(item => item.id === role)?.label || '这是要改的图';
}

function smartChatLatestOptimizedMessage(node){
    return [...(Array.isArray(node?.messages) ? node.messages : [])].reverse().find(message => String(message?.optimizedPrompt || '').trim()) || null;
}

function smartChatLatestReviewMessage(node){
    return [...(Array.isArray(node?.messages) ? node.messages : [])].reverse().find(message => Array.isArray(message?.reviewItems) && message.reviewItems.length) || null;
}

function smartChatLatestReviewItem(node, targetNodeId){
    const message = smartChatLatestReviewMessage(node);
    if(!message) return null;
    return (message.reviewItems || []).find(item => item.node_id === targetNodeId) || null;
}

function smartChatLatestOptimizedPrompt(node){
    return String(smartChatLatestOptimizedMessage(node)?.optimizedPrompt || '');
}

function smartChatTargetNode(node){
    const linked = smartChatLinkedNodes(node);
    const hasExplicitTarget = Object.prototype.hasOwnProperty.call(node || {}, 'chatTargetNodeId');
    const targetId = String(node?.chatTargetNodeId || '');
    if(hasExplicitTarget && !targetId) return null;
    return linked.find(item => item.id === targetId) || linked[0] || null;
}

function smartChatNodePrompt(node){
    return String(node?.promptDraftText || node?.runPrompt || '').trim();
}

function smartChatTargetPayload(node){
    const target = smartChatTargetNode(node);
    if(!target) return null;
    return {
        node_id:String(target.id || ''),
        title:String(target.title || ''),
        current_prompt:smartChatNodePrompt(target).slice(0, 12000),
    };
}

function smartChatImageAttachments(node){
    const result = [];
    smartChatLinkedNodes(node).forEach(source => {
        const role = smartChatAttachmentRole(node, source.id);
        (Array.isArray(source.images) ? source.images : []).forEach((image, index) => {
            if(result.length >= 8 || !image?.url || mediaKindForItem(image) !== 'image') return;
            result.push({
                url:String(image.url),
                name:String(image.name || image.alias || `节点 ${source.title || source.id} / 图片 ${index + 1}`),
                node_id:String(source.id),
                image_index:index,
                title:String(source.title || ''),
                prompt:String(source.promptDraftText || source.runPrompt || '').slice(0, 4000),
                role,
                role_label:smartChatAttachmentRoleLabel(role),
            });
        });
    });
    return result;
}

// 平台/模型 popover 打开态与向下翻转态：跨 force 重渲染保持（视频参数同款体验）。
let smartChatParamsOpen = false;
let smartChatParamsDropDown = false;
function syncSmartChatParamsOpenState(){
    smartChatParamsOpen = Boolean(smartChatPanel?.querySelector('.smart-chat-params.is-open'));
    smartChatParamsDropDown = Boolean(smartChatPanel?.querySelector('.smart-chat-params.drop-down'));
}

function smartChatSelectApply(field, value, nodeId){
    const node = smartChatSessionForId(nodeId);
    if(!node || smartChatControllers.has(node.id)) return;
    if(field === 'provider'){
        // 记住当前平台正在使用的模型，切回时恢复（视频链路同款记忆语义）
        const previous = node.chatProviderId;
        if(previous && node.chatModel){
            node.chatModelByProvider = {...(node.chatModelByProvider || {}), [previous]:node.chatModel};
        }
        node.chatProviderId = value || '';
        const models = smartChatModelsForProvider(node.chatProviderId);
        const remembered = node.chatModelByProvider?.[value || ''];
        node.chatModel = (remembered && models.includes(remembered)) ? remembered : (models[0] || '');
    } else if(field === 'model'){
        node.chatModel = value || '';
        node.chatModelByProvider = {...(node.chatModelByProvider || {}), [node.chatProviderId || '']:value || ''};
    }
    else return;
    rememberCanvasSmartChatState();
    renderSmartChatPanel({force:true});
}

function smartChatPanelBodyHtml(node){
    const providers = smartChatProviders();
    const currentProvider = smartChatProviderById(node.chatProviderId) || providers[0] || null;
    const providerId = currentProvider?.id || '';
    const models = smartChatModelsForProvider(providerId);
    const currentModel = models.includes(node.chatModel) ? node.chatModel : (models[0] || '');
    const linked = smartChatLinkedNodes(node);
    const attachments = smartChatImageAttachments(node);
    const messages = Array.isArray(node.messages) ? node.messages.slice(-40) : [];
    const controller = smartChatControllers.get(node.id);
    const busy = Boolean(controller);
    const noModels = !providers.length;
    
    // 对话式界面：根据是否有图片调整 placeholder；hasImages 供空态文案使用
    const hasImages = attachments.length > 0;
    const draftPlaceholder = hasImages 
        ? '反推 / 润色提示词，或分析画面'
        : '有什么想法都可以抛给我';
    
    const visionHint = smartChatView.visionHint(currentProvider, currentModel, attachments.length);
    
    const providerOptions = providers.length
        ? providers.map(provider => ({value:provider.id, label:provider.name || provider.id}))
        : [{value:'', label:'请先配置聊天模型'}];
    const modelOptions = models.length
        ? models.map(model => ({value:model, label:model}))
        : [{value:'', label:'未配置'}];
    
    // 图片缩略图区域（可选，可删除）
    const linkedHtml = linked.length
        ? `<div class="smart-chat-image-attachments">${linked.map(source => smartChatView.imageThumbnailHtml(node, source)).join('')}</div>`
        : '';
    
    // 关联图片按钮状态：选中数决定提示语，已关联数显示徽标，无选中时降亮
    const selectedImageCount = smartChatSelectedImageNodes().length;
    const linkTitle = busy ? '添加已选图片' : (selectedImageCount > 0 ? `关联选中的 ${selectedImageCount} 张图片` : '未选中图片：先在画布选中图片节点，或把图片拖到输入框');
    const linkBadge = attachments.length ? `<span class="smart-chat-link-badge" aria-hidden="true">${attachments.length}</span>` : '';
    const linkAria = attachments.length ? `关联图片，已关联 ${attachments.length} 张` : '关联图片';
    
    // 对话消息历史（busy 时已至少含一条 user 消息，不渲染空态）
    const messageHtml = messages.length || busy
        ? messages.map(message => smartChatView.messageHtml(node, message)).join('')
        : `<div class="smart-chat-empty-state"><i data-lucide="message-circle"></i><strong>AI助手</strong><span>我可以帮你反推图片提示词、优化现有提示词、分析画面问题。${hasImages ? '已选图片，随时可以开始。' : '如需分析图片，请拖入或选中图片节点后点"添加图片"。'}</span></div>`;

    // 思考状态 → 消息流末位气泡；配置警告 → composer 小字行
    const busyStatus = busy ? (controller.status || '正在思考…') : '';
    const composerStatus = (!busy && noModels) ? '还没有聊天模型：先到设置里配置一个' : '';
    
    const runDisabled = smartChatRunDisabled(node);
    
    return `<div class="smart-chat-card smart-chat-panel-card smart-chat-conversational">
        <div class="smart-chat-messages" data-thumb-scroll="1" data-chat-node-id="${escapeAttr(node.id)}">${messageHtml}${busy ? smartChatView.thinkingHtml(busyStatus) : ''}</div>
        <div class="smart-chat-composer">
            ${linkedHtml}
            ${composerStatus ? `<div class="smart-chat-status" data-chat-status="${escapeAttr(node.id)}">${escapeHtml(composerStatus)}</div>` : ''}
            <div class="smart-chat-input-row">
                <div class="smart-chat-input-box">
                    <button type="button" class="smart-chat-link-button${selectedImageCount > 0 ? '' : ' no-target'}" data-smart-node-action="chat-link-selected" data-node-id="${escapeAttr(node.id)}" ${busy ? 'disabled' : ''} title="${escapeAttr(linkTitle)}" aria-label="${escapeAttr(linkAria)}">${linkBadge}<i data-lucide="plus"></i></button>
                    <textarea data-smart-chat-field="draft" data-node-id="${escapeAttr(node.id)}" rows="1" placeholder="${escapeAttr(draftPlaceholder)}" ${busy ? 'disabled' : ''}>${escapeHtml(node.chatDraft || '')}</textarea>
                    <button type="button" class="smart-chat-action smart-chat-send-btn" data-smart-node-action="chat-send" data-node-id="${escapeAttr(node.id)}" ${runDisabled ? 'disabled' : ''} title="发送 (Ctrl+Enter)" aria-label="发送消息"><i data-lucide="arrow-right"></i></button>
                </div>
            </div>
            <div class="smart-chat-config-row">
                ${smartChatView.paramsHtml({nodeId:node.id, providers:providerOptions, providerId, models:modelOptions, model:currentModel, disabled:busy || noModels, open:smartChatParamsOpen, dropDown:smartChatParamsDropDown})}
                <div class="smart-chat-capability ${attachments.length ? 'with-attachments' : ''}"><i data-lucide="eye"></i><span>${escapeHtml(visionHint)}</span></div>
            </div>
            <div class="smart-chat-bottom-actions"><span>Ctrl + Enter 发送</span><button type="button" class="smart-chat-text-button" data-smart-node-action="chat-stop" data-node-id="${escapeAttr(node.id)}" ${busy ? '' : 'disabled'}><i data-lucide="square"></i><span>停止</span></button><button type="button" class="smart-chat-text-button danger" data-smart-node-action="chat-clear" data-node-id="${escapeAttr(node.id)}" ${busy ? 'disabled' : ''}><i data-lucide="trash-2"></i><span>清空</span></button></div>
        </div>
    </div>`;
}

function smartChatRenderSignature(node){
    const linked = smartChatLinkedNodes(node).map(item => ({id:item.id, title:item.title || '', prompt:smartChatNodePrompt(item), images:(item.images || []).map(image => image?.url || '')}));
    const controller = smartChatControllers.get(node.id);
    return JSON.stringify({
        provider:node.chatProviderId || '', model:node.chatModel || '', inputNodeIds:node.inputNodeIds || [], roles:node.chatAttachmentRoles || {}, target:node.chatTargetNodeId || '', taskMode:smartChatTaskMode(node),
        messages:node.messages || [], promptHistory:node.promptHistory || [], linked, busy:Boolean(controller), status:controller?.status || '',
        providers:smartChatProviders().map(provider => ({id:provider.id, name:provider.name || '', models:provider.chat_models || [], vision:provider.supports_vision ?? provider.chat_vision ?? null})),
    });
}

function smartChatRunDisabled(node){
    const busy = smartChatControllers.has(node.id);
    const providers = smartChatProviders();
    const provider = smartChatProviderById(node.chatProviderId) || providers[0];
    const models = provider ? smartChatModelsForProvider(provider.id) : [];
    const currentModel = models.includes(node.chatModel) ? node.chatModel : (models[0] || '');
    return busy || !providers.length || !currentModel || !String(node.chatDraft || '').trim();
}

function renderSmartChatPanel({force=false}={}){
    if(!smartChatPanelBody) return;
    const node = smartChatSessionForId();
    if(smartChatPanelTitle) smartChatPanelTitle.textContent = 'AI助手';
    const messageCount = (node.messages || []).length;
    const attachmentCount = smartChatImageAttachments(node).length;
    if(smartChatPanelMeta) smartChatPanelMeta.textContent = (messageCount || attachmentCount) ? `${messageCount} 条消息 · ${attachmentCount} 张图片` : '看懂图片 · 优化提示词 · 不自动生成';
    const active = document.activeElement;
    const draftFocused = Boolean(active?.matches?.('[data-smart-chat-field="draft"]'));
    if(draftFocused && !force) return;
    const signature = smartChatRenderSignature(node);
    if(!force && signature === ctx.smartChatRenderedSignature()) return;
    const selection = draftFocused ? {start:active.selectionStart, end:active.selectionEnd} : null;
    // 重渲染前从现有 DOM 同步 popover 打开态：直选按钮点击后保持打开，外点/Escape 关闭后不被误恢复。
    syncSmartChatParamsOpenState();
    smartChatPanelBody.innerHTML = smartChatPanelBodyHtml(node);
    ctx.setSmartChatRenderedSignature( signature);
    if(smartChatPanel.classList.contains('open')) refreshIcons(smartChatPanel);
    if(selection){
        requestAnimationFrame(() => {
            const field = smartChatPanelBody.querySelector('[data-smart-chat-field="draft"]');
            if(!field || field.disabled) return;
            field.focus();
            try { field.setSelectionRange(selection.start, selection.end); } catch(e) {}
        });
    }
}

function openSmartChatPanel(){
    const node = smartChatSessionForId();
    if(node && !smartChatLinkedNodes(node).length && !(node.messages || []).length) linkSelectedSmartChat(node, {silent:true});
    openSmartSurface('chat');
    renderSmartChatPanel({force:true});
    return true;
}

function closeSmartChatPanel(){
    closeSmartSurface('chat');
}

function createNewSmartChatSession(){
    const current = smartChatSessionForId();
    if(((current.messages || []).length || (current.promptHistory || []).length) && !window.confirm('新建对话会清空当前消息与提示词版本记录，确定继续吗？')) return false;
    stopSmartChat(current.id);
    ctx.setSmartChatSession( defaultSmartChatSession({linkSelected:true}));
    ctx.setSmartChatRenderedSignature( '');
    rememberCanvasSmartChatState();
    openSmartSurface('chat');
    renderSmartChatPanel({force:true});
    toast(ctx.smartChatSession().inputNodeIds.length ? '已新建对话并加入选中的图片' : '已新建AI助手对话');
    return true;
}

function toggleSmartChatPanel(){
    if(smartChatPanel?.classList.contains('open')) closeSmartChatPanel();
    else openSmartChatPanel();
}

function scrollSmartChatToBottom(nodeId){
    requestAnimationFrame(() => {
        const selector = `.smart-chat-messages[data-chat-node-id="${CSS.escape(nodeId)}"],.image-node[data-id="${CSS.escape(nodeId)}"] .smart-chat-messages`;
        const list = smartChatPanel?.querySelector(selector) || world?.querySelector(selector);
        if(list) list.scrollTop = list.scrollHeight;
    });
}

async function sendSmartChat(nodeId){
    const node = smartChatSessionForId(nodeId);
    if(!node || smartChatControllers.has(node.id)) return;
    const provider = smartChatProviderById(node.chatProviderId) || smartChatProviders()[0];
    const models = provider ? smartChatModelsForProvider(provider.id) : [];
    const model = models.includes(node.chatModel) ? node.chatModel : (models[0] || '');
    const text = (node.chatDraft || '').trim();
    if(!provider || !model){ toast('请先在 API 设置中配置聊天模型'); return; }
    if(!text){ toast('请输入要讨论的问题'); return; }
    // [已移除基于 mode 的图片验证]
    node.chatProviderId = provider.id;
    node.chatModel = model;
    const userMessage = {id:uid('chat-msg'), role:'user', text, optimizedPrompt:'', error:false, createdAt:Date.now()};
    node.messages = [...(Array.isArray(node.messages) ? node.messages : []), userMessage].slice(-40);
    node.chatDraft = '';
    const abortController = new AbortController();
    const attachmentCount = smartChatImageAttachments(node).length;
    // [已移除基于 mode 的图片验证]
    const mode = smartChatTaskMode(node);
    const controller = {abortController, status:mode === 'review' ? `正在审片 ${attachmentCount} 张图片…` : (mode === 'optimize' ? (attachmentCount ? `正在分析 ${attachmentCount} 张图片并生成提示词…` : '正在生成优化提示词…') : '正在思考…')};
    smartChatControllers.set(node.id, controller);
    rememberCanvasSmartChatState();
    renderSmartChatPanel({force:true});
    scrollSmartChatToBottom(node.id);
    try {
        const response = await fetch('/api/ctx.canvas()-chat', {method:'POST', headers:{'Content-Type':'application/json'}, signal:abortController.signal, body:JSON.stringify({provider_id:provider.id, model, mode, messages:node.messages.slice(-24), target:smartChatTargetPayload(node), attachments:smartChatImageAttachments(node)})});
        const data = await response.json().catch(() => ({}));
        if(!response.ok) throw new Error(data.detail || data.error || `请求失败（${response.status}）`);
        const reply = String(data.text || '').trim() || '接口返回了空回复。';
        node.messages = [...node.messages, {id:uid('chat-msg'), role:'assistant', text:reply, optimizedPrompt:String(data.optimized_prompt || '').trim(), reviewItems:normalizeSmartChatReviewItems(data.review_items || data.reviewItems), error:false, createdAt:Date.now()}].slice(-40);
    } catch(error) {
        if(error?.name !== 'AbortError') node.messages = [...node.messages, {id:uid('chat-msg'), role:'assistant', text:`请求失败：${error?.message || error}`, optimizedPrompt:'', error:true, createdAt:Date.now()}].slice(-40);
    } finally {
        smartChatControllers.delete(node.id);
        rememberCanvasSmartChatState();
        renderSmartChatPanel({force:true});
        scrollSmartChatToBottom(node.id);
    }
}

// Switching task is a pure UI choice: it never sends a request or spends money.
function stopSmartChat(nodeId){
    const controller = smartChatControllers.get(nodeId);
    if(controller) controller.abortController.abort();
}

function smartChatSelectedImageNodes(){
    return selectedNodeIds().map(id => ctx.nodes().find(item => item.id === id)).filter(isSmartImageNode);
}

function linkSmartChatImageNodeRefs(node, items, {silent=false}={}){
    const merged = [...smartChatLinkedNodes(node), ...items].filter((item, index, all) => all.findIndex(candidate => candidate.id === item.id) === index);
    const accepted = [];
    let count = 0;
    merged.forEach(item => {
        const imageCount = Math.max(1, (item.images || []).filter(image => image?.url && mediaKindForItem(image) === 'image').length);
        if(count >= 8 || (count && count + imageCount > 8)) return;
        accepted.push(item.id);
        count += imageCount;
    });
    node.inputNodeIds = accepted;
    node.chatAttachmentRoles = node.chatAttachmentRoles && typeof node.chatAttachmentRoles === 'object' ? node.chatAttachmentRoles : {};
    items.forEach(item => { if(node.inputNodeIds.includes(item.id) && !node.chatAttachmentRoles[item.id]) node.chatAttachmentRoles[item.id] = 'result'; });
    if(!node.chatTargetNodeId || !node.inputNodeIds.includes(node.chatTargetNodeId)) node.chatTargetNodeId = node.inputNodeIds[0] || '';
    rememberCanvasSmartChatState();
    renderSmartChatPanel({force:true});
    if(!silent) toast(`已使用 ${smartChatImageAttachments(node).length} 张图片`);
}

function linkSelectedSmartChat(node, {silent=false}={}){
    const selected = smartChatSelectedImageNodes();
    if(!selected.length){ if(!silent) toast('未选中图片：请先在画布中选中图片节点，或将图片拖入输入框'); return; }
    linkSmartChatImageNodeRefs(node, selected, {silent});
}

function unlinkSmartChatNode(node, linkedNodeId){
    node.inputNodeIds = (node.inputNodeIds || []).filter(id => id !== linkedNodeId);
    if(node.chatAttachmentRoles) delete node.chatAttachmentRoles[linkedNodeId];
    if(node.chatTargetNodeId === linkedNodeId) node.chatTargetNodeId = node.inputNodeIds[0] || '';
    rememberCanvasSmartChatState();
    renderSmartChatPanel({force:true});
}

function applySmartChatPrompt(node){
    const prompt = String(smartChatLatestOptimizedPrompt(node) || '').trim();
    const target = smartChatTargetNode(node);
    if(!prompt || !target){ toast('没有可应用的优化提示词或保存位置'); return; }
    executeSmartCanvasCommand('apply-chat-prompt', () => {
        const previousPrompt = smartChatNodePrompt(target);
        node.promptHistory = [...(Array.isArray(node.promptHistory) ? node.promptHistory : []), {id:uid('prompt-version'), targetNodeId:target.id, previousPrompt, nextPrompt:prompt, createdAt:Date.now()}].slice(-20);
        target.promptDraftText = prompt;
        target.promptDraftHtml = escapeHtml(prompt).replace(/\r?\n/g, '<br>');
        return true;
    });
    if(primarySelectedNode()?.id === target.id) updateComposer();
    toast(`已把优化提示词应用到「${target.title || target.id}」；可撤销`);
}

function undoSmartChatPrompt(node){
    const history = Array.isArray(node.promptHistory) ? node.promptHistory : [];
    const entry = history.at(-1);
    const target = entry ? ctx.nodes().find(item => item.id === entry.targetNodeId) : null;
    if(!entry || !target){ toast('没有可撤销的应用记录'); return; }
    executeSmartCanvasCommand('undo-chat-prompt', () => {
        target.promptDraftText = entry.previousPrompt || '';
        target.promptDraftHtml = escapeHtml(entry.previousPrompt || '').replace(/\r?\n/g, '<br>');
        node.promptHistory = history.slice(0, -1);
        return true;
    });
    if(primarySelectedNode()?.id === target.id) updateComposer();
    toast(`已恢复「${target.title || target.id}」的上一版提示词`);
}

function dismissSmartChatPrompt(node){
    const message = smartChatLatestOptimizedMessage(node);
    if(!message) return;
    executeSmartCanvasCommand('dismiss-chat-prompt', () => { message.optimizedPrompt = ''; return true; });
}

async function copySmartChatMessage(node, messageId){
    const message = (node.messages || []).find(item => item.id === messageId);
    if(!message) return;
    toast(await copyTextToClipboard(message.text || '') ? '已复制消息' : '复制失败');
}

async function copySmartChatPrompt(node){
    const prompt = smartChatLatestOptimizedPrompt(node);
    if(!prompt){ toast('没有可复制的优化提示词'); return; }
    toast(await copyTextToClipboard(prompt) ? '已复制优化提示词' : '复制失败');
}

async function copySmartChatReviewPrompt(node, targetNodeId){
    const item = smartChatLatestReviewItem(node, targetNodeId);
    const prompt = String(item?.optimized_prompt || '').trim();
    if(!prompt){ toast('没有可复制的审片提示词'); return; }
    toast(await copyTextToClipboard(prompt) ? '已复制审片提示词' : '复制失败');
}

function applySmartChatReviewItem(node, targetNodeId){
    const item = smartChatLatestReviewItem(node, targetNodeId);
    const target = ctx.nodes().find(candidate => candidate.id === targetNodeId);
    const prompt = String(item?.optimized_prompt || '').trim();
    if(!prompt || !target){ toast('没有可应用的审片结果'); return; }
    executeSmartCanvasCommand('apply-chat-prompt', () => {
        const previousPrompt = smartChatNodePrompt(target);
        node.promptHistory = [...(Array.isArray(node.promptHistory) ? node.promptHistory : []), {id:uid('prompt-version'), targetNodeId:target.id, previousPrompt, nextPrompt:prompt, createdAt:Date.now()}].slice(-20);
        target.promptDraftText = prompt;
        target.promptDraftHtml = escapeHtml(prompt).replace(/\r?\n/g, '<br>');
        return true;
    });
    if(primarySelectedNode()?.id === target.id) updateComposer();
    toast(`已把审片结果应用到「${target.title || target.id}」；可撤销`);
}

function createSmartChatReviewVariant(node, targetNodeId){
    const item = smartChatLatestReviewItem(node, targetNodeId);
    const target = ctx.nodes().find(candidate => candidate.id === targetNodeId);
    const prompt = String(item?.optimized_prompt || '').trim();
    if(!prompt || !target){ toast('没有可创建变体的审片结果'); return; }
    if(!window.confirm(`将复制「${target.title || target.id}」为新节点并写入审片优化提示词，不会自动运行。继续吗？`)) return;
    const offset = 54 / Math.max(.25, Number(viewport.scale) || 1);
    const copy = executeSmartCanvasCommand('create-chat-prompt-variant', () => {
        const created = cloneSmartNode(target, offset, offset);
        created.title = `${target.title || '图片节点'} · AI 审片`;
        created.promptDraftText = prompt;
        created.promptDraftHtml = escapeHtml(prompt).replace(/\r?\n/g, '<br>');
        created.created_at = Date.now();
        ctx.nodes().push(created);
        selectedId = created.id;
        selectedIds = [];
        selectedImage = {nodeId:'', index:-1};
        return created;
    });
    if(copy){ syncSelectionUi(); toast('已创建审片变体节点；尚未执行生成'); }
}

function createAllSmartChatReviewVariants(node){
    const message = smartChatLatestReviewMessage(node);
    const items = (message?.reviewItems || []).filter(item => {
        const prompt = String(item?.optimized_prompt || '').trim();
        return prompt && ctx.nodes().find(candidate => candidate.id === item.node_id);
    });
    if(!items.length){ toast('没有可批量创建变体的审片结果'); return; }
    if(!window.confirm(`将为 ${items.length} 个图片节点各创建一个变体，不会自动运行。继续吗？`)) return;
    const baseOffset = 54 / Math.max(.25, Number(viewport.scale) || 1);
    let createdCount = 0;
    items.forEach((item, index) => {
        const target = ctx.nodes().find(candidate => candidate.id === item.node_id);
        if(!target) return;
        const offset = baseOffset + index * 24;
        const copy = executeSmartCanvasCommand('create-chat-prompt-variant', () => {
            const created = cloneSmartNode(target, offset, offset);
            created.title = `${target.title || '图片节点'} · AI 审片`;
            created.promptDraftText = String(item.optimized_prompt || '').trim();
            created.promptDraftHtml = escapeHtml(created.promptDraftText).replace(/\r?\n/g, '<br>');
            created.created_at = Date.now();
            ctx.nodes().push(created);
            selectedId = created.id;
            selectedIds = [];
            selectedImage = {nodeId:'', index:-1};
            return created;
        });
        if(copy) createdCount += 1;
    });
    if(createdCount){ syncSelectionUi(); toast(`已创建 ${createdCount} 个审片变体节点；尚未执行生成`); }
}

function retrySmartChatMessage(node, messageId){
    if(smartChatControllers.has(node.id)) return;
    const messages = Array.isArray(node.messages) ? node.messages : [];
    let index = messages.findIndex(item => item.id === messageId);
    if(index < 0) index = messages.length - 1;
    let text = messages[index]?.role === 'user' ? messages[index].text : '';
    for(let cursor = index - 1; !text && cursor >= 0; cursor--){
        if(messages[cursor]?.role === 'user') text = messages[cursor].text;
    }
    if(!String(text || '').trim()){ toast('找不到可重试的用户消息'); return; }
    node.chatDraft = String(text || '');
    sendSmartChat(node.id);
}

function createSmartChatVariant(node){
    const prompt = smartChatLatestOptimizedPrompt(node);
    const target = smartChatTargetNode(node);
    if(!prompt || !target){ toast('没有可创建变体的提示词或保存位置'); return; }
    if(!window.confirm(`将复制「${target.title || target.id}」为新节点并写入优化后的提示词，不会自动运行。继续吗？`)) return;
    const offset = 54 / Math.max(.25, Number(viewport.scale) || 1);
    const copy = executeSmartCanvasCommand('create-chat-prompt-variant', () => {
        const created = cloneSmartNode(target, offset, offset);
        created.title = `${target.title || '图片节点'} · AI 变体`;
        created.promptDraftText = prompt;
        created.promptDraftHtml = escapeHtml(prompt).replace(/\r?\n/g, '<br>');
        created.created_at = Date.now();
        ctx.nodes().push(created);
        selectedId = created.id;
        selectedIds = [];
        selectedImage = {nodeId:'', index:-1};
        return created;
    });
    if(copy){ syncSelectionUi(); toast('已创建提示词变体节点；尚未执行生成'); }
}

function openSmartChatTargetComposer(node){
    const target = smartChatTargetNode(node);
    if(!target){ toast('请先选择优化结果保存位置'); return; }
    setSmartSelectionState({primaryId:target.id, ids:[target.id], image:{nodeId:'', index:-1}}, {source:'chat-target-composer'});
    openSmartSurface('composer');
    updateComposer();
    requestAnimationFrame(() => promptInput?.focus());
}

function selectSmartChatImageOnCanvas(node){
    closeSmartChatPanel();
    toast('请在画布点击一张图片；选中后重新打开AI助手会自动加入');
}

function clearSmartChat(node){
    if((node.messages || []).length && !window.confirm('确定清空当前AI助手对话记录吗？关联图片和提示词版本记录会保留。')) return;
    stopSmartChat(node.id);
    node.messages = [];
    node.chatDraft = '';
    rememberCanvasSmartChatState();
    renderSmartChatPanel({force:true});
}

function fillSmartChatDraftFromExample(node, value){
    const draft = String(value || '').trim();
    if(!draft) return;
    node.chatDraft = draft;
    rememberCanvasSmartChatState();
    renderSmartChatPanel({force:true});
    requestAnimationFrame(() => {
        const field = smartChatPanelBody?.querySelector('[data-smart-chat-field="draft"]');
        if(!field || field.disabled) return;
        field.focus();
        try { field.setSelectionRange(field.value.length, field.value.length); } catch(e) {}
    });
}

function handleSmartChatAction(node, action, control=null){
    if(!node || node.id !== SMART_CHAT_SESSION_ID) return;
    if(action === 'chat-run' || action === 'chat-send') return sendSmartChat(node.id);
    if(action === 'chat-stop') return stopSmartChat(node.id);
    if(action === 'chat-link-selected') return linkSelectedSmartChat(node);
    if(action === 'chat-select-on-ctx.canvas()') return selectSmartChatImageOnCanvas(node);
    if(action === 'chat-open-settings') return openHomeSettings();
    if(action === 'chat-fill-example') return fillSmartChatDraftFromExample(node, control?.dataset?.smartChatExample || '');
    if(action === 'chat-unlink') return unlinkSmartChatNode(node, control?.dataset?.sourceId || control?.dataset?.refNodeId || '');
    if(action === 'chat-focus-linked') return focusSmartLogNode(control?.dataset?.refNodeId || '', '定位图片');
    if(action === 'chat-clear') return clearSmartChat(node);
    if(action === 'chat-apply-prompt') return applySmartChatPrompt(node);
    if(action === 'chat-apply-review') return applySmartChatReviewItem(node, control?.dataset?.refNodeId || '');
    if(action === 'chat-copy-prompt') return copySmartChatPrompt(node);
    if(action === 'chat-copy-review') return copySmartChatReviewPrompt(node, control?.dataset?.refNodeId || '');
    if(action === 'chat-dismiss-prompt') return dismissSmartChatPrompt(node);
    if(action === 'chat-undo-prompt') return undoSmartChatPrompt(node);
    if(action === 'chat-copy-message') return copySmartChatMessage(node, control?.dataset?.messageId || '');
    if(action === 'chat-retry-message') return retrySmartChatMessage(node, control?.dataset?.messageId || '');
    if(action === 'chat-create-variant') return createSmartChatVariant(node);
    if(action === 'chat-create-review-variant') return createSmartChatReviewVariant(node, control?.dataset?.refNodeId || '');
    if(action === 'chat-create-all-review-variants') return createAllSmartChatReviewVariants(node);
    if(action === 'chat-open-target-composer') return openSmartChatTargetComposer(node);
}


function bindSmartChatEvents(){
    if(smartChatEventsBound) return;
    smartChatEventsBound = true;
    smartChatPanel?.addEventListener('pointerdown', event => event.stopPropagation());
    smartChatPanel?.addEventListener('mousedown', event => event.stopPropagation());
    smartChatPanel?.addEventListener('wheel', event => event.stopPropagation(), {passive:true});
    smartChatPanel?.addEventListener('input', event => {
        const field = event.target?.closest?.('[data-smart-chat-field="draft"]');
        if(!field || !smartChatPanel.contains(field)) return;
        const node = smartChatSessionForId(field.dataset.nodeId);
        if(!node) return;
        node.chatDraft = field.value || '';
        rememberCanvasSmartChatState();
        // 发送按钮随输入内容实时点亮/灰置（不重建 DOM，避免输入失焦）
        smartChatPanelBody?.querySelectorAll(`.smart-chat-send-btn[data-node-id="${CSS.escape(field.dataset.nodeId)}"]`).forEach(btn => {
            btn.disabled = smartChatRunDisabled(node);
        });
    });
    smartChatPanel?.addEventListener('dragover', event => {
        const box = event.target?.closest?.('.smart-chat-input-box');
        if(!box || !smartChatPanel.contains(box)) return;
        if(!smartChatInputDropCandidates(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        box.classList.add('drop-active');
    });
    smartChatPanel?.addEventListener('dragleave', event => {
        const box = event.target?.closest?.('.smart-chat-input-box');
        if(!box || !smartChatPanel.contains(box)) return;
        if(box.contains(event.relatedTarget)) return;
        box.classList.remove('drop-active');
    });
    smartChatPanel?.addEventListener('drop', async event => {
        const box = event.target?.closest?.('.smart-chat-input-box');
        if(!box || !smartChatPanel.contains(box)) return;
        box.classList.remove('drop-active');
        const node = smartChatSessionForId(box.querySelector('[data-smart-chat-field="draft"]')?.dataset?.nodeId || '');
        if(!node) return;
        const payload = await resolveSmartImageDropPayload(event.dataTransfer);
        if(payload.type === 'none') return;
        event.preventDefault();
        event.stopPropagation();
        clearSmartExternalDropPreview();
        if(smartChatControllers.has(node.id)) return;
        const created = await handleSmartImageDropPayload(payload, '', {forceNew:true});
        if(created?.id) linkSmartChatImageNodeRefs(node, [created], {silent:true});
    });
    smartChatPanel?.addEventListener('click', event => {
        const trigger = event.target?.closest?.(SMART_CHAT_SELECT_TRIGGER_SELECTOR);
        if(trigger && smartChatPanel.contains(trigger)){
            event.preventDefault();
            event.stopPropagation();
            const select = trigger.closest('[data-smart-chat-select]');
            if(select?.classList.contains('is-open')) smartChatView.close(select);
            else smartChatView.open(select);
            return;
        }
        const option = event.target?.closest?.('[data-smart-chat-option]');
        if(option && smartChatPanel.contains(option)){
            event.preventDefault();
            event.stopPropagation();
            smartChatSelectApply(option.dataset.smartChatOption || '', option.dataset.smartChatValue || '', option.dataset.nodeId || '');
            return;
        }
    });
    smartChatPanel?.addEventListener('keydown', event => {
        const trigger = event.target?.closest?.(SMART_CHAT_SELECT_TRIGGER_SELECTOR);
        const option = event.target?.closest?.('[data-smart-chat-option]');
        if(trigger || option){
            const select = event.target.closest('[data-smart-chat-select]');
            if(event.key === 'ArrowDown' || event.key === 'ArrowRight'){
                event.preventDefault();
                smartChatView.open(select, 0);
                return;
            }
            if(event.key === 'ArrowUp' || event.key === 'ArrowLeft'){
                event.preventDefault();
                const options = [...select.querySelectorAll('[data-smart-chat-option]')];
                smartChatView.open(select, Math.max(0, options.length - 1));
                return;
            }
            if(event.key === 'Escape'){
                event.preventDefault();
                smartChatView.close(select);
                select.querySelector(SMART_CHAT_SELECT_TRIGGER_SELECTOR)?.focus();
                return;
            }
            if((event.key === 'Enter' || event.key === ' ') && trigger){
                event.preventDefault();
                smartChatView.open(select);
                return;
            }
            if(option && (event.key === 'Enter' || event.key === ' ')){
                event.preventDefault();
                smartChatSelectApply(option.dataset.smartChatOption || '', option.dataset.smartChatValue || '', option.dataset.nodeId || '');
                return;
            }
            if(option && event.key === 'Tab') smartChatView.close(select);
            if(option && event.key === 'ArrowDown'){
                event.preventDefault();
                smartChatView.moveFocus(select, 1);
                return;
            }
            if(option && event.key === 'ArrowUp'){
                event.preventDefault();
                smartChatView.moveFocus(select, -1);
                return;
            }
        }
        if(!(event.target instanceof HTMLTextAreaElement) || !event.target.matches('[data-smart-chat-field="draft"]')) return;
        if((event.ctrlKey || event.metaKey) && event.key === 'Enter'){
            event.preventDefault();
            event.stopPropagation();
            const node = smartChatSessionForId(event.target.dataset.nodeId);
            if(node) sendSmartChat(node.id, smartChatTaskMode(node));
        }
    });
    smartChatPanel?.addEventListener('focusout', event => {
        const select = event.target?.closest?.('[data-smart-chat-select]');
        if(!select) return;
        window.setTimeout(() => {
            if(!select.contains(document.activeElement)) smartChatView.close(select);
        }, 0);
    });
    smartChatPanel?.addEventListener('click', event => {
        const control = event.target?.closest?.('[data-smart-node-action]');
        if(!control || !smartChatPanel.contains(control)) return;
        event.preventDefault();
        event.stopPropagation();
        const node = smartChatSessionForId(control.dataset.nodeId);
        handleSmartChatAction(node, control.dataset.smartNodeAction || '', control);
    });
}

function smartChatInputDropCandidates(dataTransfer){
    const types = smartDropDataTypes(dataTransfer);
    if(types.includes('Files')) return true;
    return types.some(type => /^image\//.test(type) || type === 'text/uri-list' || type === 'application/x-smart-asset' || type === 'application/x-smart-ctx.canvas()-image');
}


function updatePreviewResolution(media, item={}){
    if(!previewResolution) return;
    const width = Number(media?.naturalWidth || item?.natural_w || item?.width || 0);
    const height = Number(media?.naturalHeight || item?.natural_h || item?.height || 0);
    previewResolution.hidden = !(width > 0 && height > 0);
    previewResolution.textContent = width > 0 && height > 0 ? `${Math.round(width)} × ${Math.round(height)}` : '';
}

function previewActualScale(){
    const media = previewMediaHost?.querySelector(SMART_PREVIEW_IMAGE_SELECTOR);
    if(!media?.naturalWidth || !media?.naturalHeight || !media.clientWidth || !media.clientHeight) return 1;
    return Math.max(1, Math.min(8, Math.max(media.naturalWidth / media.clientWidth, media.naturalHeight / media.clientHeight)));
}

function fitPreviewMedia(){
    resetPreviewTransform();
}

function showPreviewActualSize(){
    const scale = previewActualScale();
    smartCanvasPreviewState.scale = scale;
    smartCanvasPreviewState.offsetX = 0;
    smartCanvasPreviewState.offsetY = 0;
    applyPreviewTransform();
}

function togglePreviewFitActual(){
    if(Number(smartCanvasPreviewState.scale) > 1.001) fitPreviewMedia();
    else showPreviewActualSize();
}

function previewSiblingIndexes(node){
    return (node?.images || []).map((item, index) => imageForDisplay(item)?.url ? index : -1).filter(index => index >= 0);
}

function cyclePreviewMedia(direction){
    const node = ctx.nodes().find(item => item.id === smartCanvasPreviewState.nodeId);
    const indexes = previewSiblingIndexes(node);
    if(indexes.length < 2) return;
    const current = indexes.indexOf(Number(smartCanvasPreviewState.index));
    const nextIndex = current >= 0
        ? indexes[(current + direction + indexes.length) % indexes.length]
        : indexes[direction > 0 ? 0 : indexes.length - 1];
    if(nextIndex === undefined || nextIndex === smartCanvasPreviewState.index) return;
    smartCanvasPreviewState.index = nextIndex;
    smartCanvasPreviewState.count = indexes.length;
    selectedImage = {nodeId:node.id, index:nextIndex};
    resetPreviewTransform();
    renderCurrentPreviewMedia();
}

function syncPreviewUtilityControls(node){
    const indexes = previewSiblingIndexes(node);
    const hasMultiple = indexes.length > 1;
    if(previewNavHint) previewNavHint.hidden = !hasMultiple;
    if(previewPrevBtn){
        previewPrevBtn.hidden = !hasMultiple;
        previewPrevBtn.disabled = !hasMultiple;
    }
    if(previewNextBtn){
        previewNextBtn.hidden = !hasMultiple;
        previewNextBtn.disabled = !hasMultiple;
    }
}

function renderCurrentPreviewMedia(){
    const host = previewMediaHost;
    const node = ctx.nodes().find(item => item.id === smartCanvasPreviewState.nodeId);
    const source = node?.images?.[smartCanvasPreviewState.index];
    const item = imageForDisplay(source);
    if(!host || !item?.url) return;
    host.replaceChildren();
    const kind = mediaKindForItem(item);
    let media;
    if(kind === 'video'){
        media = document.createElement('video');
        media.controls = true;
        media.autoplay = false;
        media.preload = 'metadata';
        media.playsInline = true;
        media.src = displayMediaUrl(item);
    } else {
        media = document.createElement('img');
        media.alt = item.name || node?.title || '图片预览';
        media.decoding = 'async';
        media.src = displayMediaUrl(item);
        media.addEventListener('load', () => { updatePreviewResolution(media, item); applyPreviewTransform(); });
        updatePreviewResolution(media, item);
        const fallbacks = [proxiedMediaUrl(item), smartMediaPreviewUrl(item, 2048)]
            .filter(Boolean)
            .filter((url, index, all) => url !== media.src && all.indexOf(url) === index);
        media.onerror = () => {
            const next = fallbacks.shift();
            if(next) media.src = next;
        };
    }
    media.className = 'preview-media';
    host.appendChild(media);
    applyPreviewTransform();
    syncPreviewUtilityControls(node);
    refreshIcons(mediaPreviewModal || document);
}

function resetPreviewTransform(){
    smartCanvasPreviewState.scale = 1;
    smartCanvasPreviewState.offsetX = 0;
    smartCanvasPreviewState.offsetY = 0;
    smartCanvasPreviewState.pan = null;
    previewStage?.classList.remove('is-panning');
    applyPreviewTransform();
}

let previewTransformRAF = null;
function applyPreviewTransform(){
    if(previewTransformRAF) return;
    previewTransformRAF = requestAnimationFrame(() => {
        previewTransformRAF = null;
        applyPreviewTransformImmediate();
    });
}

function applyPreviewTransformImmediate(){
    const media = [...(previewMediaHost?.querySelectorAll('.preview-media') || [])];
    const scale = Math.max(1, Math.min(8, Number(smartCanvasPreviewState.scale) || 1));
    const isZoomed = scale > 1.001;
    previewStage?.classList.toggle('is-zoomed', isZoomed);
    if(!media.length) return;
    const offsetX = Number(smartCanvasPreviewState.offsetX) || 0;
    const offsetY = Number(smartCanvasPreviewState.offsetY) || 0;
    media.forEach(item => {
        item.style.transform = `translate3d(${offsetX}px, ${offsetY}px, 0) scale(${scale})`;
        item.style.transformOrigin = 'center center';
    });
}

const previewFrameRect = () => previewStage?.querySelector('.preview-image-frame')?.getBoundingClientRect();

function handlePreviewWheel(event){
    if(!mediaPreviewModal?.classList.contains('open') || !previewMediaHost?.querySelector(SMART_PREVIEW_IMAGE_SELECTOR)) return;
    event.preventDefault();
    event.stopPropagation();
    if(!event.deltaY) return;

    const rect = previewFrameRect() || previewStage?.getBoundingClientRect();
    if(!rect?.width || !rect?.height) return;
    const previousScale = Math.max(1, Math.min(8, Number(smartCanvasPreviewState.scale) || 1));
    const nextScale = Math.max(1, Math.min(8, previousScale * Math.exp(-event.deltaY * 0.0015)));
    if(Math.abs(nextScale - previousScale) < 0.001) return;

    if(nextScale <= 1.001){
        smartCanvasPreviewState.scale = 1;
        smartCanvasPreviewState.offsetX = 0;
        smartCanvasPreviewState.offsetY = 0;
        applyPreviewTransformImmediate();
        return;
    }

    const pointerX = event.clientX - (rect.left + rect.width / 2);
    const pointerY = event.clientY - (rect.top + rect.height / 2);
    const ratio = nextScale / previousScale;
    const nextX = pointerX - (pointerX - smartCanvasPreviewState.offsetX) * ratio;
    const nextY = pointerY - (pointerY - smartCanvasPreviewState.offsetY) * ratio;
    const maxX = rect.width * (nextScale - 1) / 2;
    const maxY = rect.height * (nextScale - 1) / 2;

    smartCanvasPreviewState.scale = nextScale;
    smartCanvasPreviewState.offsetX = Math.max(-maxX, Math.min(maxX, nextX));
    smartCanvasPreviewState.offsetY = Math.max(-maxY, Math.min(maxY, nextY));
    applyPreviewTransform();
}

function openImagePreview(nodeId, imageIndex=0){
    openMediaPreview(nodeId, imageIndex);
}

function openImagePreviewSmart(nodeId, imageIndex=0){
    openImagePreview(nodeId, imageIndex);
}

function openMediaPreview(nodeId, imageIndex=0){
    const node = ctx.nodes().find(item => item.id === nodeId);
    const source = node?.images?.[imageIndex];
    const item = imageForDisplay(source);
    if(!item?.url) return;
    const kind = mediaKindForItem(item);
    if(kind !== 'image'){
        downloadPreviewFile(item);
        return;
    }
    selectedId = nodeId;
    selectedIds = [];
    selectedImage = {nodeId, index:imageIndex};
    smartCanvasPreviewState.nodeId = nodeId;
    smartCanvasPreviewState.index = imageIndex;
    smartCanvasPreviewState.count = previewSiblingIndexes(node).length;
    resetPreviewTransform();
    mediaPreviewModal?.classList.add('open');
    renderCurrentPreviewMedia();
}

function closeMediaPreview(){
    const media = previewMediaHost?.querySelector('video');
    media?.pause?.();
    previewMediaHost?.replaceChildren();
    if(previewResolution){ previewResolution.hidden = true; previewResolution.textContent = ''; }
    resetPreviewTransform();
    smartCanvasState.endInteraction('previewPan', {source:'preview-close'});
    mediaPreviewModal?.classList.remove('open');
}

previewStage?.addEventListener('wheel', handlePreviewWheel, {passive:false});
previewStage?.addEventListener('pointerdown', event => {
    if(event.button !== 0 || Number(smartCanvasPreviewState.scale) <= 1.001 || !previewMediaHost?.querySelector(SMART_PREVIEW_IMAGE_SELECTOR)) return;
    if(!event.target.closest('.preview-image-frame') || event.target.closest('.image-preview-top-actions')) return;
    event.preventDefault();
    smartCanvasPreviewState.pan = {
        pointerId:event.pointerId,
        startX:event.clientX,
        startY:event.clientY,
        offsetX:Number(smartCanvasPreviewState.offsetX) || 0,
        offsetY:Number(smartCanvasPreviewState.offsetY) || 0
    };
    smartCanvasState.beginInteraction('previewPan', null, {source:'preview-pointer'});
    previewStage.classList.add('is-panning');
    previewStage.setPointerCapture?.(event.pointerId);
});
previewStage?.addEventListener('pointermove', event => {
    const pan = smartCanvasPreviewState.pan;
    if(!pan || pan.pointerId !== event.pointerId) return;
    const rect = previewFrameRect() || previewStage.getBoundingClientRect();
    const scale = Math.max(1, Math.min(8, Number(smartCanvasPreviewState.scale) || 1));
    const maxX = rect.width * (scale - 1) / 2;
    const maxY = rect.height * (scale - 1) / 2;
    smartCanvasPreviewState.offsetX = Math.max(-maxX, Math.min(maxX, pan.offsetX + event.clientX - pan.startX));
    smartCanvasPreviewState.offsetY = Math.max(-maxY, Math.min(maxY, pan.offsetY + event.clientY - pan.startY));
    applyPreviewTransform();
});
const finishPreviewPan = event => {
    const pan = smartCanvasPreviewState.pan;
    if(!pan || (event?.pointerId !== undefined && pan.pointerId !== event.pointerId)) return;
    smartCanvasPreviewState.pan = null;
    previewStage?.classList.remove('is-panning');
    smartCanvasState.endInteraction('previewPan', {source:'preview-pointer'});
};
previewStage?.addEventListener('pointerup', finishPreviewPan);
previewStage?.addEventListener('pointercancel', finishPreviewPan);
previewStage?.addEventListener('dblclick', event => {
    if(event.target.closest('button,a,input,textarea,select')) return;
    if(!previewMediaHost?.querySelector(SMART_PREVIEW_IMAGE_SELECTOR)) return;
    event.preventDefault();
    togglePreviewFitActual();
});

// CODEX 2026.08.13: 与日志预览一致，面板外遮罩区域的滚轮同样进入预览缩放
mediaPreviewModal?.addEventListener('wheel', event => {
    if(event.target.closest('#previewStage')) return;
    handlePreviewWheel(event);
}, {passive:false});

previewPrevBtn?.addEventListener('click', event => {
    event.preventDefault();
    cyclePreviewMedia(-1);
});

previewNextBtn?.addEventListener('click', event => {
    event.preventDefault();
    cyclePreviewMedia(1);
});

previewLocateBtn?.addEventListener('click', event => {
    event.preventDefault();
    const nodeId = smartCanvasPreviewState.nodeId || '';
    closeMediaPreview();
    focusSmartLogNode(nodeId, '生成节点');
});

previewCloseBtn?.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    closeMediaPreview();
});

    return {
        normalizeSmartChatSession,
        rememberCanvasSmartChatState,
        restoreCanvasSmartChatState,
        renderSmartChatPanel,
        closeSmartChatPanel,
        createNewSmartChatSession,
        toggleSmartChatPanel,
        handleSmartChatAction,
        bindSmartChatEvents,
        cyclePreviewMedia,
        openImagePreviewSmart,
        closeMediaPreview,
        SmartChatView: smartChatView
    };

}
