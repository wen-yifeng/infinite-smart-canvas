/*
 * smart-canvas-prompt-library-view.js — Prompt 预设/模板域（Phase 2 P2.5，自 smart-canvas.js 迁入）。
 *
 * ES module 工厂 `createPromptLibraryView(ctx)`；可变共享状态经 ctx 访问器读写，
 * window 别名与 window 挂载名裸引用直达。DOM 结构与类名零漂移，函数体逐行保留
 * （仅可变绑定读写经 AST 引导精确改写为访问器调用）。
 */
export function createPromptLibraryView(ctx) {

    const {
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
        world
    } = ctx;

    // —— 域内状态声明（剩余主文件零引用，随域内迁） ——
    const PROMPT_PRESETS_KEY = 'smart_canvas_prompt_presets_v1';
    const PROMPT_TEMPLATE_GROUPS_KEY = 'smart_canvas_prompt_template_groups_v1';
    const PROMPT_TEMPLATE_OVERRIDES_KEY = 'smart_canvas_prompt_template_overrides_v1';
    let builtinPromptTemplates = [];
    let promptTemplateGroups = [];
    let promptTemplateOverrides = {hiddenBuiltinIds:[], editedBuiltins:{}};

function loadPromptPresets(){

    try {

        const list = JSON.parse(localStorage.getItem(PROMPT_PRESETS_KEY) || '[]');

        ctx.setPromptPresets(Array.isArray(list) ? list.filter(p => p?.id && typeof p.text === 'string') : []);

    } catch(e) {

        ctx.setPromptPresets([]);

    }

}

function savePromptPresets(){

    localStorage.setItem(PROMPT_PRESETS_KEY, JSON.stringify(ctx.promptPresets()));

}

function defaultPromptTemplateGroups(){

    return [

        {id:'view', name:tr('smart.tplCatView')},

        {id:'storyboard', name:tr('smart.tplCatStoryboard')},

        {id:'character', name:tr('smart.tplCatCharacter')},

        {id:'product', name:tr('smart.tplCatProduct')},

        {id:'lighting', name:tr('smart.tplCatLighting')},

        {id:'mine', name:tr('smart.tplCatMine')}

    ];

}

function loadPromptTemplateGroups(){

    try {

        const list = JSON.parse(localStorage.getItem(PROMPT_TEMPLATE_GROUPS_KEY) || '[]');

        const valid = Array.isArray(list) ? list.filter(g => g?.id && g?.name) : [];

        const defaults = defaultPromptTemplateGroups();

        promptTemplateGroups = defaults.map(group => valid.find(g => g.id === group.id) || group);

        valid.filter(g => !promptTemplateGroups.some(x => x.id === g.id)).forEach(g => promptTemplateGroups.push(g));

    } catch(e) {

        promptTemplateGroups = defaultPromptTemplateGroups();

    }

}

function savePromptTemplateGroups(){

    localStorage.setItem(PROMPT_TEMPLATE_GROUPS_KEY, JSON.stringify(promptTemplateGroups));

}

function loadPromptTemplateOverrides(){

    try {

        const data = JSON.parse(localStorage.getItem(PROMPT_TEMPLATE_OVERRIDES_KEY) || '{}');

        promptTemplateOverrides = {

            hiddenBuiltinIds:Array.isArray(data.hiddenBuiltinIds) ? data.hiddenBuiltinIds : [],

            editedBuiltins:data.editedBuiltins && typeof data.editedBuiltins === 'object' ? data.editedBuiltins : {}

        };

    } catch(e) {

        promptTemplateOverrides = {hiddenBuiltinIds:[], editedBuiltins:{}};

    }

}

function savePromptTemplateOverrides(){

    localStorage.setItem(PROMPT_TEMPLATE_OVERRIDES_KEY, JSON.stringify(promptTemplateOverrides));

}

async function loadPromptTemplates(){

    try {

        const data = await smartCanvasPromptLibraryClient.listLibraries().catch(() => ({library:{libraries:[]}}));

        ctx.setPromptLibraries(Array.isArray(data.library?.libraries) ? data.library.libraries : []);

        if(!ctx.promptLibraries().length) {

            const fallback = await smartCanvasPromptLibraryClient.listBuiltinTemplates().catch(() => ({templates:[]}));

            builtinPromptTemplates = Array.isArray(fallback.templates) ? fallback.templates.filter(t => t?.id && t?.positive) : [];

            ctx.setPromptLibraries([{id:'system', name:'系统提示词库', readonly:true, items:builtinPromptTemplates}]);

        } else {

            const system = ctx.promptLibraries().find(lib => lib.id === 'system') || ctx.promptLibraries()[0];

            builtinPromptTemplates = Array.isArray(system?.items) ? system.items.filter(t => t?.id && t?.positive) : [];

        }

        if(!ctx.promptLibraries().some(lib => lib.id === ctx.activePromptLibraryId())) ctx.setActivePromptLibraryId(ctx.promptLibraries()[0]?.id || 'system');

        renderPromptLibrarySelect();

    } catch(e) {

        builtinPromptTemplates = [];

        ctx.setPromptLibraries([]);

    }

}

function activePromptLibrary(){

    return ctx.promptLibraries().find(lib => lib.id === ctx.activePromptLibraryId()) || ctx.promptLibraries()[0] || {id:'system', name:'系统提示词库', readonly:true, items:builtinPromptTemplates};

}

function renderPromptLibrarySelect(){

    if(!promptTemplateLibrarySelect) return;

    promptTemplateLibrarySelect.innerHTML = ctx.promptLibraries().map(lib => `<option value="${escapeAttr(lib.id)}" ${lib.id === ctx.activePromptLibraryId() ? 'selected' : ''}>${escapeHtml(lib.name || '提示词库')}</option>`).join('');

}

function promptTemplateItems(){

    const activeLibrary = activePromptLibrary();

    if(activeLibrary.id !== 'system'){

        return (activeLibrary.items || []).filter(t => t?.id && t?.positive).map(t => ({

            ...t,

            sourceId:t.id,

            builtin:false,

            remote:true,

            libraryId:activeLibrary.id

        }));

    }

    // 系统库的条目同样走后端（/api/prompt-libraries），与素材库管理共用一套数据。

    // 这样画布里修改/删除系统提示词会实时同步，不再依赖各端不互通的 localStorage 覆盖。

    // 仍保留 builtin:true 用于“内置”标签与完整提示词（含负向/参数）的展示。

    const source = Array.isArray(activeLibrary.items) && activeLibrary.items.length ? activeLibrary.items : builtinPromptTemplates;

    const builtins = source

        .filter(t => t?.id && t?.positive)

        .map(t => ({...t, sourceId:t.id, builtin:true, remote:true, libraryId:'system'}));

    const mine = ctx.promptPresets().map(p => ({

        id:`mine:${p.id}`,

        sourceId:p.id,

        name:p.name || tr('smart.promptPresetUnnamed'),

        // 系统库分组以后端为准（custom=“我的”），本地旧预设归到 custom 分组下展示，避免无对应标签。

        category:(p.category && p.category !== 'mine') ? p.category : 'custom',

        scene:'我的提示词预设',

        positive:p.text || '',

        negative:'',

        params:{},

        builtin:false

    }));

    return [...builtins, ...mine];

}

function promptTemplateText(template, mode='positive'){

    const positive = String(template?.positive || '').trim();

    if(mode === 'positive' || !template?.builtin) return positive;

    const negative = String(template?.negative || '').trim();

    const params = Object.entries(template?.params || {})

        .map(([key, value]) => `${key}: ${value}`)

        .join('\n');

    return [positive, negative ? `Negative prompt:\n${negative}` : '', params ? `Params:\n${params}` : ''].filter(Boolean).join('\n\n');

}

function promptTemplateName(template){

    if(window.StudioI18n?.lang?.() === 'en' && template?.name_en) return template.name_en;

    return template?.name || '';

}

function promptTemplateScene(template){

    if(window.StudioI18n?.lang?.() === 'en' && template?.scene_en) return template.scene_en;

    return template?.scene || '';

}

function promptTemplateSearchText(template){

    return [

        template?.name,

        template?.name_en,

        template?.scene,

        template?.scene_en,

        template?.positive,

        template?.negative

    ].join(' ').toLowerCase();

}

function activePromptTemplateGroups(){

    const lib = activePromptLibrary();

    // 系统库的分组也以后端 categories 为准，与素材库管理共用同一份分组数据（可重命名/删除并同步）。

    const fromLib = Array.isArray(lib?.categories) ? lib.categories.filter(c => c?.id && c?.name) : [];

    if(fromLib.length) return fromLib;

    if(!lib || lib.id === 'system') return promptTemplateGroups;

    return [];

}

function promptTemplateCategoryLabel(category){

    if(category === 'all') return tr('smart.tplAll');

    // 分组名优先以后端 categories 为准（含内置分组重命名），保证两端显示一致。

    const fromGroups = activePromptTemplateGroups().find(g => g.id === category)?.name;

    if(fromGroups) return fromGroups;

    const builtin = {

        view:tr('smart.tplCatView'),

        storyboard:tr('smart.tplCatStoryboard'),

        character:tr('smart.tplCatCharacter'),

        product:tr('smart.tplCatProduct'),

        lighting:tr('smart.tplCatLighting'),

        custom:tr('smart.tplCatMine'),

        mine:tr('smart.tplCatMine')

    };

    return builtin[category] || promptTemplateGroups.find(g => g.id === category)?.name || category;

}

function promptTemplateSelectedItem(){

    return promptTemplateItems().find(item => item.id === ctx.promptTemplateSelectedId()) || promptTemplateItems()[0] || null;

}

function currentPromptPreset(id){

    return ctx.promptPresets().find(p => p.id === id) || null;

}

function defaultPromptPresetName(text){

    return (String(text || '').trim().split(/\r?\n/)[0] || tr('smart.promptPresetDefault')).slice(0, 28);

}

function promptPresetPanelNode(){

    return ctx.nodes().find(n => n.id === promptPresetPanel?.dataset.nodeId) || null;

}

function setPromptPresetStatus(text='', tone=''){

    if(!promptPresetStatus) return;

    promptPresetStatus.textContent = text;

    promptPresetStatus.classList.toggle('warn', tone === 'warn');

    promptPresetStatus.classList.toggle('ok', tone === 'ok');

}

function resetPromptPresetDeleteState(){

    ctx.setPromptPresetDeleteArmed(false);

    if(promptPresetDelete){

        promptPresetDelete.textContent = tr('common.delete');

        promptPresetDelete.classList.remove('confirm-danger');

    }

}

function createPromptPresetFromNode(node, {openPanel=true, openTemplatePanel=false}={}){

    const text = String(node?.text || '').trim();

    if(!text){ toast(tr('smart.promptPresetEmpty')); return null; }

    const preset = {id:uid('preset'), name:defaultPromptPresetName(text), text, createdAt:Date.now(), updatedAt:Date.now()};

    ctx.promptPresets().unshift(preset);

    savePromptPresets();

    if(node) node.promptPresetId = preset.id;

    render();

    scheduleSave();

    if(openPanel) openPromptPresetPanel(node?.id || '', preset.id, {status:tr('smart.promptPresetSavedNew'), tone:'ok'});

    if(openTemplatePanel) {

        ctx.setPromptTemplateCategory('mine');

        ctx.setPromptTemplateSelectedId(`mine:${preset.id}`);

        ctx.setPromptTemplateEditing(true);

        openPromptTemplatePanel(node?.id || '', ctx.promptTemplateSelectedId());

    }

    return preset;

}

function renderPromptPresetPanel(selectedId='', message=''){

    if(!promptPresetSelect) return;

    resetPromptPresetDeleteState();

    promptPresetSelect.innerHTML = ctx.promptPresets().length

        ? ctx.promptPresets().map(p => `<option value="${escapeHtml(p.id)}" ${p.id === selectedId ? 'selected' : ''}>${escapeHtml(p.name || tr('smart.promptPresetUnnamed'))}</option>`).join('')

        : `<option value="">${escapeHtml(tr('smart.promptPresetNone'))}</option>`;

    const preset = currentPromptPreset(selectedId) || ctx.promptPresets()[0] || null;

    if(preset && promptPresetSelect.value !== preset.id) promptPresetSelect.value = preset.id;

    promptPresetName.value = preset?.name || '';

    promptPresetText.value = preset?.text || '';

    const hasPreset = Boolean(preset);

    const nodeHasText = Boolean(String(promptPresetPanelNode()?.text || '').trim());

    promptPresetApply.disabled = !hasPreset;

    promptPresetDelete.disabled = !hasPreset;

    promptPresetSave.disabled = !hasPreset;

    if(promptPresetNew) promptPresetNew.disabled = !nodeHasText;

    setPromptPresetStatus(message || (hasPreset ? tr('smart.promptPresetPanelHint') : tr('smart.promptPresetPanelEmpty')));

}

function openPromptPresetPanel(nodeId='', presetId='', options={}){

    if(!promptPresetPanel) return;

    promptPresetPanel.dataset.nodeId = nodeId || '';

    const node = ctx.nodes().find(n => n.id === nodeId);

    const preferred = presetId || node?.promptPresetId || ctx.promptPresets()[0]?.id || '';

    renderPromptPresetPanel(preferred, options.status || '');

    if(options.tone) setPromptPresetStatus(options.status || '', options.tone);

    const nodeEl = nodeId ? world.querySelector(`.image-node[data-id="${CSS.escape(nodeId)}"]`) : null;

    const rect = nodeEl?.getBoundingClientRect();

    const shellRect = shell.getBoundingClientRect();

    const maxLeft = Math.max(18, shellRect.width - 410);

    const maxTop = Math.max(18, shellRect.height - 330);

    const left = rect ? Math.min(maxLeft, Math.max(18, rect.right - shellRect.left + 12)) : 80;

    const top = rect ? Math.min(maxTop, Math.max(18, rect.top - shellRect.top)) : 80;

    promptPresetPanel.style.left = `${left}px`;

    promptPresetPanel.style.top = `${top}px`;

    openSmartSurface('preset');

    refreshIcons();

}

function closePromptPresetPanel(){

    closeSmartSurface('preset');

    resetPromptPresetDeleteState();

}

function promptTemplateScrollSnapshot(){
    return SmartCanvasPromptWorkbenchView.snapshotScroll(promptTemplatePanel);
}

function restorePromptTemplateScroll(snapshot){
    SmartCanvasPromptWorkbenchView.restoreScroll(promptTemplatePanel, snapshot);
}

function buildPromptTemplateCatsHtml(categories, activeGroups, groupCounts){
    return SmartCanvasPromptWorkbenchView.buildCategoryTabs({
        categories,
        activeGroups,
        groupCounts,
        groupEditMode:ctx.promptTemplateGroupEditMode(),
        activeCategory:ctx.promptTemplateCategory(),
        categoryLabel:promptTemplateCategoryLabel
    });
}

function buildPromptTemplateBodyHtml(items, selected, editMode, canEditCurrentLibrary, selectedPreset, activeGroups){
    return SmartCanvasPromptWorkbenchView.buildBody({
        items,
        selected,
        editMode,
        canEditCurrentLibrary,
        selectedPreset,
        activeGroups,
        categoryLabel:promptTemplateCategoryLabel,
        templateName:promptTemplateName,
        templateScene:promptTemplateScene
    });
}

function renderPromptTemplatePanel(options={}){

    if(!promptTemplatePanel || !promptTemplateBody || !promptTemplateCats) return;

    renderPromptLibrarySelect();

    const scrollSnapshot = options.preserveScroll === false ? null : promptTemplateScrollSnapshot();

    const query = String(promptTemplateSearch?.value || '').trim().toLowerCase();

    const allTemplates = promptTemplateItems();

    const activeGroups = activePromptTemplateGroups();

    // 防御：若当前分类筛选不属于当前词库（例如刚切换词库或分类已被删除），回到“全部”，避免列表被过滤为空。

    if(ctx.promptTemplateCategory() !== 'all' && !activeGroups.some(g => g.id === ctx.promptTemplateCategory())) ctx.setPromptTemplateCategory('all');

    const categories = [{id:'all', name:tr('smart.tplAll')}, ...activeGroups.map(group => ({...group, name:promptTemplateCategoryLabel(group.id)}))];

    const groupCounts = allTemplates.reduce((map, item) => {

        map[item.category || 'mine'] = (map[item.category || 'mine'] || 0) + 1;

        return map;

    }, {all:allTemplates.length});

    promptTemplateCats.innerHTML = buildPromptTemplateCatsHtml(categories, activeGroups, groupCounts);

    const items = allTemplates.filter(item => {

        if(ctx.promptTemplateCategory() !== 'all' && item.category !== ctx.promptTemplateCategory()) return false;

        if(!query) return true;

        return promptTemplateSearchText(item).includes(query);

    });

    if(items.length && !items.some(item => item.id === ctx.promptTemplateSelectedId())) ctx.setPromptTemplateSelectedId(items[0].id);

    const selected = items.find(item => item.id === ctx.promptTemplateSelectedId()) || items[0] || null;

    const selectedPreset = selected?.builtin || selected?.remote

        ? {id:selected.id, name:selected.name || '', text:selected.positive || '', category:selected.category || 'storyboard', builtin:Boolean(selected.builtin)}

        : (selected ? currentPromptPreset(selected.sourceId) : null);

    const target = promptTemplatePanel.dataset.target || 'node';

    const node = ctx.nodes().find(n => n.id === promptTemplatePanel.dataset.nodeId);

    const activeLibrary = activePromptLibrary();

    // 系统库 readonly=false，其条目也可编辑/删除（经后端持久化），因此只看 readonly。

    const canEditCurrentLibrary = !activeLibrary.readonly;

    const editMode = Boolean(ctx.promptTemplateEditing() && selectedPreset);

    promptTemplateBody.innerHTML = buildPromptTemplateBodyHtml(items, selected, editMode, canEditCurrentLibrary, selectedPreset, activeGroups);

    refreshIcons(promptTemplatePanel);

    restorePromptTemplateScroll(scrollSnapshot);

}

function syncComposerTemplateButton(){

    if(!composerTemplateBtn || !promptTemplatePanel) return;

    const active = promptTemplatePanel.classList.contains('open') && promptTemplatePanel.dataset.target === 'composer';

    composerTemplateBtn.classList.toggle('active', active);

    composerTemplateBtn.setAttribute('aria-pressed', active ? 'true' : 'false');

}

async function openPromptTemplatePanel(nodeId='', templateId='', options={}){

    if(!promptTemplatePanel) return;

    const target = options.target === 'composer' ? 'composer' : 'node';

    promptTemplatePanel.dataset.target = target;

    promptTemplatePanel.dataset.nodeId = nodeId || '';

    if(promptTemplatePanel.parentElement !== shell) shell.appendChild(promptTemplatePanel);

    if(templateId) ctx.setPromptTemplateSelectedId(templateId);

    openSmartSurface('template');

    // 每次打开都从后端拉取最新提示词库，确保素材库管理里的新增/修改/删除实时反映到画布（同根同源）。

    try { await loadPromptTemplates(); } catch(e){}

    if(!ctx.promptTemplateSelectedId() || !promptTemplateItems().some(it => it.id === ctx.promptTemplateSelectedId())){

        ctx.setPromptTemplateSelectedId(promptTemplateItems()[0]?.id || '');

    }

    renderPromptTemplatePanel();

    if(target === 'node' && nodeId){

        selectedId = nodeId;

        selectedIds = [];

        selectedImage = {nodeId:'', index:-1};

    }

    render();

    syncComposerTemplateButton();

    promptTemplateSearch?.focus();

}

function closePromptTemplatePanel(){

    closeSmartSurface('template');

    syncComposerTemplateButton();

}

function applyPromptTemplateToNode(mode='positive'){

    const template = promptTemplateItems().find(item => item.id === ctx.promptTemplateSelectedId());

    if(!template) return;

    if(promptTemplatePanel?.dataset.target === 'composer'){

        const text = promptTemplateText(template, mode);

        executeSmartCanvasCommand('apply-prompt-template', () => {

            setPromptText(text);

            delete promptInput.dataset.preserveDraftOnce;

            savePromptDraftForCurrent();

            renderInputThumbsRow(selectedNode());

            return true;

        }, {skipRender:true});

        closePromptTemplatePanel();

        return;

    }

    const node = ctx.nodes().find(n => n.id === promptTemplatePanel?.dataset.nodeId);

    if(!node) return;

    executeSmartCanvasCommand('apply-prompt-template', () => {

        node.text = promptTemplateText(template, mode);

        node.promptPresetId = template.builtin ? '' : template.sourceId || '';

        return true;

    }, {skipRender:true});

    closePromptTemplatePanel();

}

async function saveCurrentPromptAsTemplate(){

    const library = activePromptLibrary();

    // 系统库 readonly=false，也允许新增条目（走后端，与素材库管理同步）。

    if(library.readonly){ toast('请选择可编辑的提示词库'); return; }

    const text = promptTemplatePanel?.dataset.target === 'composer'

        ? promptPlainText()

        : String(ctx.nodes().find(n => n.id === promptTemplatePanel?.dataset.nodeId)?.text || '').trim();

    if(!text){ toast(tr('smart.promptPresetEmpty')); return; }

    try {

        const data = await smartCanvasPromptLibraryClient.createItem({
            library_id:library.id,
            name:defaultPromptPresetName(text),
            category:ctx.promptTemplateCategory() === 'all' ? 'custom' : ctx.promptTemplateCategory(),
            positive:text,
            scene:'我的提示词预设'
        });

        ctx.setPromptLibraries(data.library?.libraries || ctx.promptLibraries());

        ctx.setActivePromptLibraryId(library.id);

        ctx.setPromptTemplateCategory(data.item?.category || 'custom');

        ctx.setPromptTemplateSelectedId(data.item?.id || '');

        ctx.setPromptTemplateEditing(true);

        renderPromptTemplatePanel({preserveScroll:false});

    } catch(err) {

        toast(err.message || '保存失败');

    }

}

async function createBlankPromptTemplate(){

    const library = activePromptLibrary();

    // 系统库 readonly=false，也允许新建空白条目（走后端，与素材库管理同步）。

    if(library.readonly){ toast('请选择可编辑的提示词库'); return; }

    const category = ctx.promptTemplateCategory() && ctx.promptTemplateCategory() !== 'all' ? ctx.promptTemplateCategory() : 'custom';

    try {

        const data = await smartCanvasPromptLibraryClient.createItem({
            library_id:library.id,
            name:tr('smart.tplNewTemplateName'),
            category,
            positive:'新提示词',
            scene:'我的提示词预设'
        });

        ctx.setPromptLibraries(data.library?.libraries || ctx.promptLibraries());

        ctx.setActivePromptLibraryId(library.id);

        ctx.setPromptTemplateCategory(category);

        ctx.setPromptTemplateSelectedId(data.item?.id || '');

        ctx.setPromptTemplateEditing(true);

        renderPromptTemplatePanel({preserveScroll:false});

    } catch(err) {

        toast(err.message || '创建失败');

    }

}

async function savePromptTemplateEdit(){

    const item = promptTemplateSelectedItem();

    if(!item) return;

    const name = promptTemplatePanel.querySelector('[data-template-edit-name]')?.value?.trim() || '';

    const text = promptTemplatePanel.querySelector('[data-template-edit-text]')?.value?.trim() || '';

    const category = promptTemplatePanel.querySelector('[data-template-edit-category]')?.value || 'mine';

    if(!name || !text){ toast(tr('smart.tplRequired')); return; }

    if(item.remote){

        try {

            const data = await smartCanvasPromptLibraryClient.updateItem(item.id, {
                library_id:item.libraryId || activePromptLibrary().id,
                name,
                category,
                positive:text,
                scene:item.scene || '',
                negative:item.negative || ''
            });

            ctx.setPromptLibraries(data.library?.libraries || ctx.promptLibraries());

            ctx.setPromptTemplateSelectedId(data.item?.id || item.id);

        } catch(err) {

            toast(err.message || '保存失败');

            return;

        }

    } else if(item.builtin){

        promptTemplateOverrides.editedBuiltins = promptTemplateOverrides.editedBuiltins || {};

        promptTemplateOverrides.editedBuiltins[item.id] = {

            ...(promptTemplateOverrides.editedBuiltins[item.id] || {}),

            name,

            positive:text,

            category

        };

        savePromptTemplateOverrides();

    } else {

        const preset = currentPromptPreset(item.sourceId);

        if(!preset) return;

        const idx = ctx.promptPresets().findIndex(p => p.id === preset.id);

        if(idx >= 0) ctx.promptPresets()[idx] = {...ctx.promptPresets()[idx], name, text, category, updatedAt:Date.now()};

        savePromptPresets();

        ctx.nodes().forEach(node => { if(node.promptPresetId === preset.id) node.text = text; });

    }

    ctx.setPromptTemplateEditing(false);

    renderPromptTemplatePanel();

    render();

    scheduleSave();

}

async function deletePromptTemplate(){

    const item = promptTemplateSelectedItem();

    if(!item) return;

    if(item.remote){

        try {

            const data = await smartCanvasPromptLibraryClient.deleteItem(item.id);

            ctx.setPromptLibraries(data.library?.libraries || ctx.promptLibraries());

        } catch(err) {

            toast(err.message || '删除失败');

            return;

        }

    } else if(item.builtin){

        promptTemplateOverrides.hiddenBuiltinIds = [...new Set([...(promptTemplateOverrides.hiddenBuiltinIds || []), item.id])];

        savePromptTemplateOverrides();

    } else {

        ctx.setPromptPresets(ctx.promptPresets().filter(p => p.id !== item.sourceId));

        ctx.nodes().forEach(node => { if(node.promptPresetId === item.sourceId) node.promptPresetId = ''; });

        savePromptPresets();

    }

    ctx.setPromptTemplateSelectedId('');

    ctx.setPromptTemplateEditing(false);

    renderPromptTemplatePanel({preserveScroll:false});

    render();

    scheduleSave();

}

async function createPromptTemplateGroup(){

    const name = window.prompt(tr('smart.tplNewGroupPrompt'), tr('smart.tplNewGroupDefault'));

    if(!String(name || '').trim()) return;

    const lib = activePromptLibrary();

    // 系统库（readonly=false）也走后端新增分组，与素材库管理同步。

    if(lib && !lib.readonly){

        try {

            const data = await smartCanvasPromptLibraryClient.createCategory({
                name:String(name).trim().slice(0, 24),
                library_id:lib.id
            });

            ctx.setPromptLibraries(data.library?.libraries || ctx.promptLibraries());

            ctx.setPromptTemplateCategory(data.category?.id || ctx.promptTemplateCategory());

            renderPromptTemplatePanel({preserveScroll:false});

        } catch(err){ /* setStatus 已不存在：守卫在 classic/module 下均恒为假，保持静默 */ }

        return;

    }

    const group = {id:uid('tpl_group'), name:String(name).trim().slice(0, 24)};

    promptTemplateGroups.push(group);

    savePromptTemplateGroups();

    ctx.setPromptTemplateCategory(group.id);

    renderPromptTemplatePanel({preserveScroll:false});

}

async function renamePromptTemplateGroup(groupId){

    const lib = activePromptLibrary();

    const group = activePromptTemplateGroups().find(g => g.id === groupId);

    if(!group) return;

    const name = window.prompt(tr('smart.tplGroupNamePrompt'), group.name || '');

    if(!String(name || '').trim()) return;

    // 系统库的内置分组也走后端重命名（后端已放开内置分组限制），两端同步。

    if(lib && !lib.readonly){

        try {

            const data = await smartCanvasPromptLibraryClient.renameCategory(groupId, {
                name:String(name).trim().slice(0, 24),
                library_id:lib.id
            });

            ctx.setPromptLibraries(data.library?.libraries || ctx.promptLibraries());

            renderPromptTemplatePanel();

        } catch(err){ /* setStatus 已不存在：守卫恒为假，保持静默 */ }

        return;

    }

    group.name = String(name).trim().slice(0, 24);

    savePromptTemplateGroups();

    renderPromptTemplatePanel();

}

async function deletePromptTemplateGroup(groupId){

    const lib = activePromptLibrary();

    // 系统库的内置分组也走后端删除（后端已放开限制并把孤立条目改挂到剩余分组），两端同步。

    if(lib && !lib.readonly){

        if(!window.confirm(tr('smart.tplDeleteGroupConfirm'))) return;

        try {

            const data = await smartCanvasPromptLibraryClient.deleteCategory(groupId);

            ctx.setPromptLibraries(data.library?.libraries || ctx.promptLibraries());

            if(ctx.promptTemplateCategory() === groupId) ctx.setPromptTemplateCategory('all');

            renderPromptTemplatePanel({preserveScroll:false});

        } catch(err){ /* setStatus 已不存在：守卫恒为假，保持静默 */ }

        return;

    }

    if(!window.confirm(tr('smart.tplDeleteGroupConfirm'))) return;

    promptTemplateGroups = promptTemplateGroups.filter(g => g.id !== groupId);

    ctx.setPromptPresets(ctx.promptPresets().map(p => p.category === groupId ? {...p, category:'mine'} : p));

    Object.entries(promptTemplateOverrides.editedBuiltins || {}).forEach(([id, item]) => {

        if(item?.category === groupId) promptTemplateOverrides.editedBuiltins[id] = {...item, category:'mine'};

    });

    if(ctx.promptTemplateCategory() === groupId) ctx.setPromptTemplateCategory('all');

    savePromptTemplateGroups();

    savePromptPresets();

    savePromptTemplateOverrides();

    renderPromptTemplatePanel({preserveScroll:false});

}

    return {
        loadPromptPresets,
        savePromptPresets,
        loadPromptTemplateGroups,
        loadPromptTemplateOverrides,
        loadPromptTemplates,
        renderPromptLibrarySelect,
        currentPromptPreset,
        promptPresetPanelNode,
        setPromptPresetStatus,
        resetPromptPresetDeleteState,
        createPromptPresetFromNode,
        renderPromptPresetPanel,
        closePromptPresetPanel,
        renderPromptTemplatePanel,
        openPromptTemplatePanel,
        closePromptTemplatePanel,
        applyPromptTemplateToNode,
        saveCurrentPromptAsTemplate,
        createBlankPromptTemplate,
        savePromptTemplateEdit,
        deletePromptTemplate,
        createPromptTemplateGroup,
        renamePromptTemplateGroup,
        deletePromptTemplateGroup
    };

}
