/*
 * smart-canvas-composer-subject.js — composer 主体/提示反馈/音效域（Phase 2 P2.10⑨，自 smart-canvas.js 迁入）。
 *
 * ES module 工厂 `createComposerSubject(ctx)`；可变共享状态经 ctx 访问器读写，
 * window 别名与 window 挂载名裸引用直达。DOM 结构与类名零漂移，函数体逐行保留
 * （仅可变绑定读写经 AST 引导精确改写为访问器调用）。
 * 域内包含：活动 settings 主体与 composer 节点解析、recent 设置持久化、
 * 画布列表导航、主题应用、toast、composer 参数提示反馈簇、完成音效、
 * 选择恢复与点击计时清理。
 */
export function createComposerSubject(ctx) {

    const {
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
        upstreamNodesForKinds
    } = ctx;

function activeSettingsSubject(){

    const active = ctx.activeComposerSubject()?.id

        ? (ctx.nodes().find(n => n.id === ctx.activeComposerSubject().id) || ctx.activeComposerSubject())

        : primarySelectedNode();

    return isSmartRunnableNode(active) ? active : null;

}

function activeComposerNode(){

    if(!ctx.lastComposerNodeId()) return null;

    const id = String(ctx.lastComposerNodeId()).split(':')[0] || '';

    const node = ctx.nodes().find(n => n.id === id);

    return isSmartRunnableNode(node) ? node : null;

}

function composerUpstreamNodeIds(node=activeComposerNode()){
    return upstreamNodesForKinds(node, ['input','flow']).map(item => item.id);
}

/* DOWNSTREAM_PROMPT_LOCK_20260731
   UI-only manual-edit lock. Toolbar actions continue through the existing command path. */
function downstreamPromptImageUpstreamIds(node){
    if(!isSmartRunnableNode(node)) return [];
    return upstreamNodesForKinds(node, ['input','flow'])
        .filter(isSmartImageNode)
        .map(item => item.id)
        .sort();
}

function isDownstreamPromptNode(node){
    return downstreamPromptImageUpstreamIds(node).length > 0;
}

function syncDownstreamPromptLock(node=activeComposerNode(), options={}){
    const nodeId = node?.id || '';
    const upstreamIds = downstreamPromptImageUpstreamIds(node);
    const switchedNode = Boolean(options.switchedNode || ctx.downstreamPromptTopologyNodeId() !== nodeId);

    if(!nodeId){
        ctx.setDownstreamPromptUnlockedNodeId('');
        ctx.setDownstreamPromptTopologyNodeId('');
        ctx.setDownstreamPromptUpstreamSnapshot([]);
    } else if(switchedNode){
        ctx.setDownstreamPromptUnlockedNodeId('');
        ctx.setDownstreamPromptTopologyNodeId(nodeId);
        ctx.setDownstreamPromptUpstreamSnapshot(upstreamIds);
    } else {
        const previous = new Set(ctx.downstreamPromptUpstreamSnapshot());
        if(upstreamIds.some(id => !previous.has(id))) ctx.setDownstreamPromptUnlockedNodeId('');
        if(upstreamIds.length === 0 && ctx.downstreamPromptUnlockedNodeId() === nodeId) ctx.setDownstreamPromptUnlockedNodeId('');
        ctx.setDownstreamPromptUpstreamSnapshot(upstreamIds);
    }

    const eligible = upstreamIds.length > 0;
    const locked = Boolean(eligible && ctx.downstreamPromptUnlockedNodeId() !== nodeId);
    const genericLocked = promptInput?.dataset?.promptLocked === '1';

    if(promptInput){
        promptInput.dataset.downstreamPromptLocked = locked ? '1' : '0';
        promptInput.setAttribute('contenteditable', genericLocked || locked ? 'false' : 'true');
        promptInput.classList.toggle('downstream-prompt-readonly', locked);
        if(locked) promptInput.setAttribute('aria-readonly', 'true');
        else promptInput.removeAttribute('aria-readonly');
    }
    const shell = promptInput?.closest?.('.prompt-input-shell');
    shell?.classList.toggle('downstream-prompt-locked', locked);
    if(downstreamPromptLockBtn){
        const keepUnlockFeedback = downstreamPromptLockBtn.classList.contains('unlock-success')
            && downstreamPromptLockBtn.dataset.feedbackNodeId === nodeId;
        if(!keepUnlockFeedback){
            downstreamPromptLockBtn.classList.remove('unlock-success', 'unlock-success-fade');
            delete downstreamPromptLockBtn.dataset.feedbackNodeId;
        }
        downstreamPromptLockBtn.hidden = !(locked || keepUnlockFeedback);
    }
    if(locked) closeMentionPicker();
    return locked;
}

function showDownstreamPromptLockAttention(){
    if(!downstreamPromptLockBtn || downstreamPromptLockBtn.hidden) return;
    clearTimeout(ctx.downstreamPromptLockFeedbackTimer());
    downstreamPromptLockBtn.classList.remove('unlock-success', 'unlock-success-fade', 'lock-attention');
    delete downstreamPromptLockBtn.dataset.feedbackNodeId;
    void downstreamPromptLockBtn.offsetWidth;
    downstreamPromptLockBtn.classList.add('lock-attention');
    ctx.setDownstreamPromptLockFeedbackTimer(window.setTimeout(() => {
        downstreamPromptLockBtn.classList.remove('lock-attention');
    }, 450));
}

function focusPromptInputAtEnd(){
    promptInput?.focus();
    const selection = window.getSelection?.();
    if(!selection || !promptInput) return;
    const range = document.createRange();
    range.selectNodeContents(promptInput);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    saveMentionRange();
}

function unlockDownstreamPrompt(){
    const node = activeComposerNode();
    if(!isDownstreamPromptNode(node)){
        syncDownstreamPromptLock(node);
        return false;
    }
    const nodeId = node.id;
    const lockButton = downstreamPromptLockBtn;
    clearTimeout(ctx.downstreamPromptLockFeedbackTimer());
    if(lockButton){
        lockButton.classList.remove('lock-attention', 'unlock-success-fade');
        lockButton.dataset.feedbackNodeId = nodeId;
        lockButton.classList.add('unlock-success');
    }
    ctx.setDownstreamPromptUnlockedNodeId(nodeId);
    syncDownstreamPromptLock(node);
    focusPromptInputAtEnd();
    requestAnimationFrame(() => {
        if(activeComposerNode()?.id === nodeId && lockButton?.dataset.feedbackNodeId === nodeId){
            lockButton.classList.add('unlock-success-fade');
        }
    });
    ctx.setDownstreamPromptLockFeedbackTimer(window.setTimeout(() => {
        if(lockButton?.dataset.feedbackNodeId === nodeId){
            lockButton.classList.remove('unlock-success', 'unlock-success-fade');
            delete lockButton.dataset.feedbackNodeId;
        }
        syncDownstreamPromptLock(activeComposerNode());
    }, 220));
    return true;
}

function syncComposerViewportActions(){
    const node = activeComposerNode();
    const upstreamIds = composerUpstreamNodeIds(node);
    if(!composerFocusUpstreamBtn) return;
    const disabled = upstreamIds.length === 0;
    composerFocusUpstreamBtn.disabled = disabled;
    composerFocusUpstreamBtn.hidden = disabled;
    composerFocusUpstreamBtn.setAttribute('aria-disabled', disabled ? 'true' : 'false');
}

function switchComposerToUpstreamNode(){
    // incomingNodeIds preserves the current canvas connection order, so the first id is the requested target.
    const upstreamId = composerUpstreamNodeIds()[0] || '';
    if(!upstreamId) return false;
    // Clear the old prompt-editing marker before changing the selected Composer target.
    ctx.setComposerPromptEditingNodeId('');
    closeMentionPicker();
    setSmartSelectionState({primaryId:upstreamId, ids:[], image:{nodeId:'', index:-1}}, {source:'composer-switch-upstream'});
    syncSelectionUi();
    updateComposer();
    return true;
}

function persistActiveSmartSettings(){

    if(!composer?.classList?.contains('open')) return;

    const subject = activeComposerNode();

    if(!subject) return;

    subject.runSettings = settingsForStorage(ctx.settings());

    rememberRecentSmartSettings(ctx.settings(), subject);

}

function rememberCanvasListProject(projectId){

    const pid = projectId || 'default';

    try { localStorage.setItem(CANVAS_LIST_PROJECT_KEY, pid); } catch(e){}

    return pid;

}

function canvasListUrlForProject(projectId){

    const pid = rememberCanvasListProject(projectId);

    return `/static/canvas-list.html?project=${encodeURIComponent(pid)}`;

}

function backToCanvasList(){

    savePromptDraftForCurrent();
    rememberCanvasSmartChatState({schedule:false});

    window.location.href = canvasListUrlForProject(ctx.canvas()?.project || sourceProjectId || 'default');

}

/* Settings now live only on the launcher home page. The canvas hands off to it
   instead of hosting a second copy of the API settings surface. */
function openHomeSettings(){
    savePromptDraftForCurrent();
    rememberCanvasSmartChatState({schedule:false});
    const base = canvasListUrlForProject(ctx.canvas()?.project || sourceProjectId || 'default');
    const separator = base.includes('?') ? '&' : '?';
    window.location.href = `${base}${separator}settings=1`;
}


function applyTheme(theme){

    const dark = theme === 'dark';

    document.documentElement.classList.toggle('theme-dark', dark);

    document.documentElement.classList.toggle('studio-theme-dark', dark);

    document.body?.classList.toggle('theme-dark', dark);

    document.body?.classList.toggle('studio-theme-dark', dark);

}

function toast(text, tone='default'){

    const el = document.getElementById('toast');

    el.textContent = text;
    el.classList.toggle('is-parameter-success', tone === 'parameter-success');

    el.classList.add('show');

    clearTimeout(toast._timer);

    toast._timer = setTimeout(() => el.classList.remove('show'), 1800);

}

function showComposerParameterNotice(text, tone='default'){
    toast(text, tone);
}

function composerParameterNoticeCount(){
    const selected = selectedNodeIds().map(id => ctx.nodes().find(node => node.id === id)).filter(isSmartRunnableNode);
    if(selected.length) return selected.length;
    return isSmartRunnableNode(activeSettingsSubject()) ? 1 : 0;
}

function composerParameterNoticeDetail(key, value){
    const ratioLabels = {square:'1:1', portrait:'2:3', landscape:'3:2', portrait43:'3:4', landscape43:'4:3', story:'9:16', wide:'16:9', ultrawide:'21:9', ultratall:'9:21', source:'原图', custom:'自定义'};
    const qualityLabels = {auto:'自动', low:'低', medium:'中', high:'高'};
    const resolutionLabels = {auto:'自动', custom:'自定义'};
    const valueText = String(value ?? '');
    if(key === 'model' || key === 'videoModel') return `模型：${valueText || '默认'}`;
    if(key === 'ratio' || key === 'msRatio') return `比例：${ratioLabels[valueText] || valueText}`;
    if(key === 'resolution' || key === 'msResolution') return `清晰度：${resolutionLabels[valueText] || valueText.toUpperCase()}`;
    if(key === 'quality') return `图片质量：${qualityLabels[valueText] || valueText}`;
    if(key === 'customWidth' || key === 'customHeight') return `自定义尺寸：${ctx.settings().customSize || '待补全'}`;
    if(key === 'customRatioWidth' || key === 'customRatioHeight') return `自定义比例：${ctx.settings().customRatio || '待补全'}`;
    if(key === 'msCustomWidth' || key === 'msCustomHeight') return `自定义尺寸：${ctx.settings().msCustomSize || '待补全'}`;
    if(key === 'msCustomRatioWidth' || key === 'msCustomRatioHeight') return `自定义比例：${ctx.settings().msCustomRatio || '待补全'}`;
    if(key === 'videoAspect') return `画面比例：${{keep_ratio:'保持原比例', adaptive:'自适应'}[valueText] || valueText}`;
    if(key === 'videoResolution') return `视频清晰度：${valueText ? valueText.toUpperCase() : '自动'}`;
    return '';
}

const COMPOSER_OUTPUT_PARAMETER_NOTICE_KEYS = new Set([
    'ratio', 'msRatio', 'resolution', 'msResolution', 'quality',
    'customWidth', 'customHeight', 'customRatioWidth', 'customRatioHeight',
    'msCustomWidth', 'msCustomHeight', 'msCustomRatioWidth', 'msCustomRatioHeight',
    'videoAspect', 'videoResolution'
]);

function showComposerParameterChange(key, value, count=composerParameterNoticeCount()){
    const detail = composerParameterNoticeDetail(key, value);
    if(!detail || !count) return;
    const tone = COMPOSER_OUTPUT_PARAMETER_NOTICE_KEYS.has(key) ? 'parameter-success' : 'default';
    showComposerParameterNotice(`已更新 ${count} 个节点的${detail}`, tone);
}

function showComposerButtonFeedback(button, text, state='success'){
    const label = button?.querySelector?.('span');
    if(!label) return;
    clearTimeout(button._composerFeedbackTimer);
    if(!button.dataset.composerDefaultLabel) button.dataset.composerDefaultLabel = label.textContent || '';
    label.textContent = text;
    button.classList.remove('is-action-success', 'is-action-error', 'is-action-neutral');
    button.classList.add(`is-action-${state}`);
    button._composerFeedbackTimer = setTimeout(() => {
        label.textContent = button.dataset.composerDefaultLabel || label.textContent;
        delete button.dataset.composerDefaultLabel;
        button.classList.remove('is-action-success', 'is-action-error', 'is-action-neutral');
    }, 720);
}

let generationCompleteSoundAt = 0;

function playGenerationCompleteSound(){

    const now = Date.now();

    if(now - generationCompleteSoundAt < 1200) return;

    generationCompleteSoundAt = now;

    try {

        const AudioCtx = window.AudioContext || window.webkitAudioContext;

        if(!AudioCtx) return;

        const ctx = playGenerationCompleteSound._ctx || (playGenerationCompleteSound._ctx = new AudioCtx());

        const play = () => {

            const start = ctx.currentTime + 0.015;

            [

                {freq:660, at:0, duration:0.12},

                {freq:880, at:0.12, duration:0.16}

            ].forEach(tone => {

                const osc = ctx.createOscillator();

                const gain = ctx.createGain();

                osc.type = 'sine';

                osc.frequency.setValueAtTime(tone.freq, start + tone.at);

                gain.gain.setValueAtTime(0.0001, start + tone.at);

                gain.gain.exponentialRampToValueAtTime(0.075, start + tone.at + 0.018);

                gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.at + tone.duration);

                osc.connect(gain).connect(ctx.destination);

                osc.start(start + tone.at);

                osc.stop(start + tone.at + tone.duration + 0.02);

            });

        };

        if(ctx.state === 'suspended') ctx.resume().then(play).catch(() => {});

        else play();

    } catch(e) {}

}

function selectedNode(){ return ctx.nodes().find(n => n.id === selectedId) || null; }

function restoreComposerNodeSelection(){
    if(selectedNodeIds().length) return false;
    const node = ctx.nodes().find(item => item.id === ctx.lastComposerRunnableNodeId() && isSmartRunnableNode(item)) || activeComposerNode();
    if(!node) return false;
    ctx.setLastComposerRunnableNodeId(node.id);
    setSmartSelectionState({primaryId:node.id, ids:[], image:{nodeId:'', index:-1}}, {source:'composer-restore-selection'});
    syncSelectionUi();
    return true;
}

function clearSelection(){

    savePromptDraftForCurrent();

    setSmartSelectionState({primaryId:'', ids:[], image:{nodeId:'', index:-1}}, {source:'clear-selection'});

}

function clearImageClickTimer(){

    if(ctx.imageClickTimer()){

        clearTimeout(ctx.imageClickTimer());

        ctx.setImageClickTimer(null);

    }

}

    return {
        activeSettingsSubject,
        activeComposerNode,
        syncDownstreamPromptLock,
        showDownstreamPromptLockAttention,
        unlockDownstreamPrompt,
        syncComposerViewportActions,
        switchComposerToUpstreamNode,
        persistActiveSmartSettings,
        rememberCanvasListProject,
        backToCanvasList,
        openHomeSettings,
        applyTheme,
        toast,
        showComposerParameterNotice,
        composerParameterNoticeCount,
        showComposerParameterChange,
        showComposerButtonFeedback,
        playGenerationCompleteSound,
        selectedNode,
        restoreComposerNodeSelection,
        clearSelection,
        clearImageClickTimer
    };

}
