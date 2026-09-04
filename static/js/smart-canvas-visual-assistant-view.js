/**
 * Visual-assistant presentation and accessible select helpers.
 *
 * The canvas entry provides state lookup and command handlers. This module only
 * builds its DOM markup and maintains the custom select's interaction state.
 */
(function () {
    'use strict';

    const { escapeHtml, escapeAttr } = window.SmartCanvasUiUtils;

    function createView({panel, latestOptimizedMessage, targetForNode, nodePrompt, findNode}){
function smartChatTextHtml(value){
    return escapeHtml(String(value || '')).replace(/\r?\n/g, '<br>');
}

function smartChatVisionHint(provider, model, attachmentCount){
    if(!attachmentCount) return '未关联图片：可文字提问；关联图片后可分析画面。';
    const declaredModels = [
        ...(Array.isArray(provider?.vision_models) ? provider.vision_models : []),
        ...(Array.isArray(provider?.vision_chat_models) ? provider.vision_chat_models : [])
    ].map(String);
    if(provider?.supports_vision === false || provider?.chat_vision === false) return '当前平台声明不支持视觉输入，关联图片可能无法读取。';
    if(provider?.supports_vision === true || provider?.chat_vision === true || declaredModels.includes(String(model || ''))) return `将随请求发送 ${attachmentCount} 张图片。`;
    return `将随请求发送 ${attachmentCount} 张图片；平台未声明视觉能力，是否可读取取决于所选模型。`;
}

function smartChatCandidateHtml(node, message){
    const prompt = String(message?.optimizedPrompt || '').trim();
    if(!prompt) return '';
    const latest = latestOptimizedMessage(node);
    const active = latest?.id === message.id;
    const target = targetForNode(node);
    const currentPrompt = target ? nodePrompt(target) : '';
    const previous = (Array.isArray(node.promptHistory) ? node.promptHistory : []).at(-1);
    return `<section class="smart-chat-optimized ${active ? 'active' : ''}">
        <div class="smart-chat-optimized-label"><span>优化后的提示词</span><em>${target ? escapeHtml(target.title || target.id) : '未选择保存位置'}</em></div>
        <details class="smart-chat-optimized-text-details"><summary>查看优化后的提示词</summary><pre class="smart-chat-optimized-text">${escapeHtml(prompt)}</pre></details>
        ${active ? smartChatCandidateActiveHtml(node, prompt, currentPrompt, previous, target) : ''}
    </section>`;
}

function smartChatCandidateActiveHtml(node, prompt, currentPrompt, previous, target){
    return `<details class="smart-chat-prompt-diff"><summary>查看与当前提示词的区别</summary>`
        + `<div class="smart-chat-prompt-columns"><div><label>当前</label><pre>${escapeHtml(currentPrompt || '（空）')}</pre></div>`
        + `<div class="candidate"><label>优化后</label><pre>${escapeHtml(prompt)}</pre></div></div></details>`
        + smartChatCandidateActionsHtml(node, target, previous);
}

function smartChatCandidateActionsHtml(node, target, previous){
    const nid = escapeAttr(node.id);
    const hasTarget = !!target;
    return `<div class="smart-chat-prompt-actions">`
        + `<button type="button" data-smart-node-action="chat-apply-prompt" data-node-id="${nid}" ${hasTarget ? '' : 'disabled'}><i data-lucide="check"></i><span>写入提示词</span></button>`
        + `<button type="button" data-smart-node-action="chat-create-variant" data-node-id="${nid}" ${hasTarget ? '' : 'disabled'}><i data-lucide="copy-plus"></i><span>创建变体</span></button>`
        + `<details class="smart-chat-prompt-more"><summary>更多操作</summary><div class="smart-chat-prompt-more-actions">`
        + `<button type="button" data-smart-node-action="chat-copy-prompt" data-node-id="${nid}"><i data-lucide="copy"></i><span>复制</span></button>`
        + `<button type="button" data-smart-node-action="chat-dismiss-prompt" data-node-id="${nid}"><i data-lucide="x"></i><span>放弃这次结果</span></button>`
        + (previous ? `<button type="button" data-smart-node-action="chat-undo-prompt" data-node-id="${nid}"><i data-lucide="undo-2"></i><span>撤销应用</span></button>` : '')
        + (hasTarget ? `<button type="button" data-smart-node-action="chat-open-target-composer" data-node-id="${nid}"><i data-lucide="panel-right-open"></i><span>在提示词工作台编辑</span></button>` : '')
        + `</div></details><div class="smart-chat-safe-note"><i data-lucide="info"></i><span>写入节点提示词，可撤销；不会自动生成图片</span></div></div>`;
}

function smartChatReviewItemHtml(node, item, index){
    const target = findNode(item.node_id);
    const title = String(item.title || target?.title || item.node_id);
    const issues = String(item.issues || '未返回问题摘要');
    const prompt = String(item.optimized_prompt || '').trim();
    return `<div class="smart-chat-review-item" data-review-node-id="${escapeAttr(item.node_id)}">
        <div class="smart-chat-review-item-head">
            <span class="smart-chat-review-index">${index + 1}</span>
            <strong title="${escapeAttr(title)}">${escapeHtml(title)}</strong>
            <button type="button" class="smart-chat-review-focus" data-smart-node-action="chat-focus-linked" data-node-id="${escapeAttr(node.id)}" data-ref-node-id="${escapeAttr(item.node_id)}" title="定位图片" aria-label="定位图片"><i data-lucide="locate-fixed"></i></button>
        </div>
        <div class="smart-chat-review-issues">${smartChatTextHtml(issues)}</div>
        ${prompt ? `<details class="smart-chat-optimized-text-details"><summary>查看优化提示词</summary><pre class="smart-chat-optimized-text">${escapeHtml(prompt)}</pre></details>` : '<div class="smart-chat-review-empty-prompt">未返回优化提示词</div>'}
        <div class="smart-chat-prompt-actions smart-chat-review-actions">
            <button type="button" data-smart-node-action="chat-apply-review" data-node-id="${escapeAttr(node.id)}" data-ref-node-id="${escapeAttr(item.node_id)}" ${target && prompt ? '' : 'disabled'}><i data-lucide="check"></i><span>写入提示词</span></button>
            <button type="button" data-smart-node-action="chat-create-review-variant" data-node-id="${escapeAttr(node.id)}" data-ref-node-id="${escapeAttr(item.node_id)}" ${target && prompt ? '' : 'disabled'}><i data-lucide="copy-plus"></i><span>创建变体</span></button>
            <button type="button" data-smart-node-action="chat-copy-review" data-node-id="${escapeAttr(node.id)}" data-ref-node-id="${escapeAttr(item.node_id)}" ${prompt ? '' : 'disabled'}><i data-lucide="copy"></i><span>复制</span></button>
        </div>
    </div>`;
}

function smartChatReviewHtml(node, message){
    const items = Array.isArray(message?.reviewItems) ? message.reviewItems.filter(item => item?.node_id) : [];
    if(!items.length) return '';
    return `<section class="smart-chat-review">
        <div class="smart-chat-review-head"><span>逐张检查结果</span><em>${items.length} 项 · 不会自动生成图片</em></div>
        <div class="smart-chat-safe-note"><i data-lucide="info"></i><span>逐项写入提示词，可撤销；不会自动生成图片</span></div>
        ${items.length > 1 ? `<button type="button" class="smart-chat-review-batch" data-smart-node-action="chat-create-all-review-variants" data-node-id="${escapeAttr(node.id)}"><i data-lucide="copy-plus"></i><span>全部创建变体</span></button>` : ''}
        ${items.map((item, index) => smartChatReviewItemHtml(node, item, index)).join('')}
    </section>`;
}

function smartChatMessageHtml(node, message){
    const assistant = message.role === 'assistant';
    const retryable = Boolean(message.error || assistant);
    return `<article class="smart-chat-message ${assistant ? 'assistant' : 'user'} ${message.error ? 'error' : ''}" data-message-id="${escapeAttr(message.id || '')}">
        <div class="smart-chat-message-head"><span class="smart-chat-message-role">${assistant ? 'AI助手' : '你'}</span><span class="smart-chat-message-actions"><button type="button" data-smart-node-action="chat-copy-message" data-node-id="${escapeAttr(node.id)}" data-message-id="${escapeAttr(message.id || '')}" title="复制消息"><i data-lucide="copy"></i></button>${retryable ? `<button type="button" data-smart-node-action="chat-retry-message" data-node-id="${escapeAttr(node.id)}" data-message-id="${escapeAttr(message.id || '')}" title="重新发送"><i data-lucide="rotate-cw"></i></button>` : ''}</span></div>
        <div class="smart-chat-message-text">${smartChatTextHtml(message.text)}</div>
        ${assistant ? smartChatReviewHtml(node, message) + smartChatCandidateHtml(node, message) : ''}
    </article>`;
}

function smartChatThinkingHtml(status){
    return `<div class="smart-chat-thinking" role="status"><span>${escapeHtml(String(status || '正在思考…'))}</span><i class="smart-chat-thinking-dot"></i><i class="smart-chat-thinking-dot"></i><i class="smart-chat-thinking-dot"></i></div>`;
}

function chatThumbnailSrc(url){
    const text = String(url || '');
    if(!text || text.startsWith('data:') || text.startsWith('blob:')) return text;
    if(!text.startsWith('/output/') && !text.startsWith('/assets/')) return text;
    if(!/\.(png|jpe?g|webp|gif|bmp|avif|tiff?|mp4|webm|mov|m4v|avi|mkv)(\?|#|$)/i.test(text)) return text;
    return `/api/media-preview?w=160&url=${encodeURIComponent(text)}`;
}

function smartChatImageThumbnailHtml(node, source){
    const attachmentIndex = (node.inputNodeIds || []).indexOf(source.id);
    const thumb = chatThumbnailSrc(source.images?.[0]?.url);
    return `<div class="smart-chat-thumbnail" data-source-id="${escapeAttr(source.id)}">
        <img src="${escapeAttr(thumb)}" alt="${escapeHtml(source.title || '')}" loading="lazy">
        <button type="button" class="smart-chat-thumbnail-remove" data-smart-node-action="chat-unlink" data-node-id="${escapeAttr(node.id)}" data-source-id="${escapeAttr(source.id)}" title="移除"><i data-lucide="x"></i></button>
    </div>`;
}

// The task list is the core of the redesign: one visible row per task, each row
// stating what it produces, so the run button never needs a guess.

function smartChatSelectHtml({field, nodeId, options, value, disabled=false}){
    const list = Array.isArray(options) && options.length ? options : [{value:'', label:'未配置'}];
    const selected = list.find(option => String(option.value) === String(value)) || list[0];
    const selectId = `smart-chat-${field}-${String(nodeId || '').replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    const optionHtml = list.map((option, index) => {
        const optionValue = String(option.value ?? '');
        const isSelected = optionValue === String(selected.value ?? '');
        return `<button type="button" class="smart-chat-select-option${isSelected ? ' selected' : ''}" role="option" aria-selected="${isSelected ? 'true' : 'false'}" data-smart-chat-option="${escapeAttr(field)}" data-smart-chat-value="${escapeAttr(optionValue)}" data-node-id="${escapeAttr(nodeId)}" tabindex="-1"><span>${escapeHtml(option.label ?? optionValue)}</span>${isSelected ? '<i data-lucide="check"></i>' : ''}</button>`;
    }).join('');
    return `<div class="smart-chat-select" data-smart-chat-select="${escapeAttr(field)}" data-node-id="${escapeAttr(nodeId)}"><button type="button" class="smart-chat-select-trigger" aria-haspopup="listbox" aria-expanded="false" aria-controls="${escapeAttr(selectId)}" data-smart-chat-select-trigger="${escapeAttr(field)}" data-node-id="${escapeAttr(nodeId)}" ${disabled ? 'disabled' : ''}><span>${escapeHtml(selected.label ?? selected.value ?? '')}</span><i data-lucide="chevron-down"></i></button><div id="${escapeAttr(selectId)}" class="smart-chat-select-menu" role="listbox" aria-label="${escapeAttr(field === 'provider' ? '平台' : '聊天模型')}" hidden>${optionHtml}</div></div>`;
}

// 平台/模型合并胶囊（视频参数形态）：trigger 常驻不动、摘要显示当前选择，
// popover 向上弹出、内部分「平台」「聊天模型」两组直选按钮，点选后不关闭。
// 复用 data-smart-chat-select 基建（开合/外点关闭/键盘）与 data-smart-chat-option
// 委托（smartChatSelectApply），零新增事件绑定。
function smartChatParamsHtml({nodeId, providers, providerId, models, model, disabled=false, open=false, dropDown=false}){
    const providerList = Array.isArray(providers) && providers.length ? providers : [{value:'', label:'未配置'}];
    const modelList = Array.isArray(models) && models.length ? models : [{value:'', label:'未配置'}];
    const providerLabel = (providerList.find(option => String(option.value) === String(providerId ?? '')) || {}).label || providerId || '';
    const modelLabel = (modelList.find(option => String(option.value) === String(model ?? '')) || {}).label || model || '';
    const summary = providerLabel && modelLabel ? `${providerLabel} · ${modelLabel}` : (providerLabel || modelLabel || '未配置');
    const renderOptions = (field, list, value) => list.map(option => {
        const optionValue = String(option.value ?? '');
        const isSelected = optionValue === String(value ?? '');
        return `<button type="button" class="smart-chat-param-option${isSelected ? ' selected' : ''}" role="option" aria-selected="${isSelected ? 'true' : 'false'}" data-smart-chat-option="${escapeAttr(field)}" data-smart-chat-value="${escapeAttr(optionValue)}" data-node-id="${escapeAttr(nodeId)}" tabindex="-1" ${disabled ? 'disabled' : ''}><span>${escapeHtml(option.label ?? optionValue)}</span>${isSelected ? '<i data-lucide="check"></i>' : ''}</button>`;
    }).join('');
    return `<div class="smart-chat-select smart-chat-params${open ? ' is-open' : ''}${dropDown ? ' drop-down' : ''}" data-smart-chat-select="params" data-node-id="${escapeAttr(nodeId)}"><button type="button" class="smart-chat-select-trigger smart-chat-params-trigger" aria-haspopup="listbox" aria-expanded="${open ? 'true' : 'false'}" data-smart-chat-select-trigger="params" data-node-id="${escapeAttr(nodeId)}" ${disabled ? 'disabled' : ''}><span class="smart-chat-params-title">平台 / 模型</span><span class="smart-chat-params-summary">${escapeHtml(summary)}</span><i data-lucide="chevrons-up-down"></i></button><div class="smart-chat-select-menu smart-chat-params-menu" role="listbox" aria-label="平台与聊天模型" ${open ? '' : 'hidden'}><div class="smart-chat-params-section" role="group" aria-label="选择平台"><div class="smart-chat-params-section-title">平台</div><div class="smart-chat-params-grid">${renderOptions('provider', providerList, providerId)}</div></div><div class="smart-chat-params-section" role="group" aria-label="选择聊天模型"><div class="smart-chat-params-section-title">聊天模型</div><div class="smart-chat-params-grid smart-chat-params-grid-list">${renderOptions('model', modelList, model)}</div></div></div></div>`;
}

function smartChatSelectCloseAll(except=null){
    panel?.querySelectorAll('.smart-chat-select.is-open').forEach(select => {
        if(select !== except) smartChatSelectClose(select);
    });
}

function smartChatSelectClose(select){
    if(!select) return;
    const trigger = select.querySelector('.smart-chat-select-trigger');
    const menu = select.querySelector('.smart-chat-select-menu');
    select.classList.remove('is-open');
    trigger?.setAttribute('aria-expanded', 'false');
    if(menu) menu.hidden = true;
}

function smartChatSelectOpen(select, focusIndex=null){
    if(!select || select.querySelector('.smart-chat-select-trigger')?.disabled) return;
    smartChatSelectCloseAll(select);
    const trigger = select.querySelector('.smart-chat-select-trigger');
    const menu = select.querySelector('.smart-chat-select-menu');
    if(!trigger || !menu) return;
    select.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
    menu.hidden = false;
    // 平台/模型 popover 默认向上弹：可视空间不足（超出视口顶部）时翻转向下，避免被裁剪。
    if(select.classList.contains('smart-chat-params')){
        select.classList.toggle('drop-down', menu.getBoundingClientRect().top < 0);
    }
    const options = [...menu.querySelectorAll('[data-smart-chat-option]')];
    const current = options.findIndex(option => option.getAttribute('aria-selected') === 'true');
    const index = focusIndex == null ? (current >= 0 ? current : 0) : Math.max(0, Math.min(options.length - 1, focusIndex));
    options[index]?.focus();
}

function smartChatSelectMoveFocus(select, delta){
    const options = [...select?.querySelectorAll('[data-smart-chat-option]') || []];
    if(!options.length) return;
    const current = options.indexOf(document.activeElement);
    const fallback = options.findIndex(option => option.getAttribute('aria-selected') === 'true');
    const next = Math.max(0, Math.min(options.length - 1, (current >= 0 ? current : fallback >= 0 ? fallback : 0) + delta));
    options[next]?.focus();
}

        return Object.freeze({
            textHtml:smartChatTextHtml,
            visionHint:smartChatVisionHint,
            candidateHtml:smartChatCandidateHtml,
            reviewItemHtml:smartChatReviewItemHtml,
            reviewHtml:smartChatReviewHtml,
            messageHtml:smartChatMessageHtml,
            thinkingHtml:smartChatThinkingHtml,
            imageThumbnailHtml:smartChatImageThumbnailHtml,
            selectHtml:smartChatSelectHtml,
            paramsHtml:smartChatParamsHtml,
            closeAll:smartChatSelectCloseAll,
            close:smartChatSelectClose,
            open:smartChatSelectOpen,
            moveFocus:smartChatSelectMoveFocus
        });
    }

    window.SmartCanvasVisualAssistantView = Object.freeze({createView});
}());
