/*
 * smart-canvas-asset-panel-view.js — 素材库面板域（Phase 2 P2.6，自 smart-canvas.js 迁入）。
 *
 * ES module 工厂 `createAssetPanelView(ctx)`；可变共享状态经 ctx 访问器读写，
 * window 别名与 window 挂载名裸引用直达。DOM 结构与类名零漂移，函数体逐行保留
 * （仅可变绑定读写经 AST 引导精确改写为访问器调用）。
 */
export function createAssetPanelView(ctx) {

    const {
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
        uploadFiles
    } = ctx;

    // —— 域内状态声明（剩余主文件零引用，随域内迁） ——
    let assetTab = 'image';
    const LOCAL_ASSET_LIBRARY_ID = '__local_assets__';
    const ASSET_LIBRARY_UI_STATE_KEY = 'asset_library';
    let localAssetLibrary = {items:[], tree:null};
    let assetLibraryUpdatedAt = 0;
    let assetLibraryRefreshTimer = null;
    const ASSET_SMART_CATEGORY_PREFIX = '__smart_class__::';

function assetCategories(type='image'){

    const library = activeAssetLibrary();

    return (library?.categories || ctx.assetLibrary().categories || []).filter(cat => (cat.type || 'image') === type);

}

function assetSmartClassKey(entry){

    if(!entry?.dimension || !entry?.tag) return '';

    return `${String(entry.dimension)}::${String(entry.tag)}`;

}

function assetSmartClassOptionId(entry){

    const key = assetSmartClassKey(entry);

    return key ? `${ASSET_SMART_CATEGORY_PREFIX}${key}` : '';

}

function parseAssetSmartClassId(id=''){

    const value = String(id || '');

    if(!value.startsWith(ASSET_SMART_CATEGORY_PREFIX)) return null;

    const raw = value.slice(ASSET_SMART_CATEGORY_PREFIX.length);

    const index = raw.indexOf('::');

    if(index < 0) return null;

    return {dimension:raw.slice(0, index), tag:raw.slice(index + 2)};

}

let assetSmartClassIndex = null;

function invalidateAssetSmartClassIndex(){
    assetSmartClassIndex = null;
}

function getAssetSmartClassIndex(){
    const libraryId = ctx.activeAssetLibraryId() || ctx.assetLibrary().active_library_id || assetLibraries()[0]?.id || '';
    if(assetSmartClassIndex && assetSmartClassIndex.libraryId === libraryId) return assetSmartClassIndex;
    const groups = new Map();
    const byKey = new Map();
    assetCategories('image').forEach(cat => {
        (cat.items || []).forEach(item => {
            const flat = Array.isArray(item?.classification?.flat) ? item.classification.flat : [];
            flat.forEach(entry => {
                const key = assetSmartClassKey(entry);
                if(!key) return;
                let group = groups.get(key);
                if(!group){
                    group = {
                        id:assetSmartClassOptionId(entry),
                        dimension:String(entry.dimension || ''),
                        label:String(entry.label || entry.dimension || '分类'),
                        tag:String(entry.tag || ''),
                        count:0
                    };
                    groups.set(key, group);
                }
                group.count += 1;
                let ids = byKey.get(key);
                if(!ids){ ids = []; byKey.set(key, ids); }
                ids.push(item);
            });
        });
    });
    const entries = [...groups.values()].sort((a, b) => {
        if(a.label !== b.label) return a.label.localeCompare(b.label, 'zh-CN');
        return b.count - a.count || a.tag.localeCompare(b.tag, 'zh-CN');
    });
    assetSmartClassIndex = {libraryId, byKey, entries};
    return assetSmartClassIndex;
}

function assetSmartClassEntries(){
    return getAssetSmartClassIndex().entries;
}

function itemsForAssetSmartClass(optionId=''){
    const parsed = parseAssetSmartClassId(optionId);
    if(!parsed) return [];
    const key = assetSmartClassKey({dimension:parsed.dimension, tag:parsed.tag});
    return getAssetSmartClassIndex().byKey.get(key) || [];
}

function assetLibraries(){

    return Array.isArray(ctx.assetLibrary().libraries) && ctx.assetLibrary().libraries.length ? ctx.assetLibrary().libraries : [{id:'default', name:'默认资产库', categories:ctx.assetLibrary().categories || []}];

}

function localAssetFolderCategories(){

    const result = [];

    const walk = node => {

        if(!node) return;

        const isRoot = (node.id || node.path || '__root__') === '__root__';

        result.push({

            id: node.id || (node.path ? node.path : '__root__'),

            name: node.name || (node.path ? node.path.split('/').pop() : '全部上传'),

            type: 'image',

            items: (isRoot ? (localAssetLibrary.items || []) : (node.items || [])).filter(item => assetMediaKind(item) === 'image'),

            readonly: true,

            source: 'local',

        });

        (node.children || []).forEach(walk);

    };

    walk(localAssetLibrary.tree || {id:'__root__', name:'全部上传', items:localAssetLibrary.items || [], children:[]});

    return result;

}

function assetLibraryIsLocal(){

    return ctx.activeAssetLibraryId() === LOCAL_ASSET_LIBRARY_ID;

}

function currentAssetSourceLibraries(){

    return [

        ...assetLibraries(),

        {id:LOCAL_ASSET_LIBRARY_ID, name:'本地素材', categories:localAssetFolderCategories(), readonly:true, source:'local'}

    ];

}

function activeAssetLibrary(){

    if(assetLibraryIsLocal()) return currentAssetSourceLibraries().find(lib => lib.id === LOCAL_ASSET_LIBRARY_ID);

    const libs = assetLibraries();

    return libs.find(lib => lib.id === ctx.activeAssetLibraryId()) || libs[0] || null;

}

function canvasAssetLibraryState(){
    const state = ctx.canvas()?.ui_state?.[ASSET_LIBRARY_UI_STATE_KEY];
    return state && typeof state === 'object' ? state : null;
}

function rememberCanvasAssetLibrarySelection({schedule=true}={}){
    if(!ctx.canvas() || !canvasId) return;
    const before = JSON.stringify(ctx.canvas().ui_state || {});
    ctx.canvas().ui_state = {
        ...(ctx.canvas().ui_state && typeof ctx.canvas().ui_state === 'object' ? ctx.canvas().ui_state : {}),
        [ASSET_LIBRARY_UI_STATE_KEY]: {
            library_id: ctx.activeAssetLibraryId() || '',
            category_id: ctx.activeAssetCategoryId() || '',
        },
    };
    if(schedule && JSON.stringify(ctx.canvas().ui_state) !== before) scheduleSave();
}

function restoreCanvasAssetLibrarySelection(){
    const saved = canvasAssetLibraryState();
    if(!saved) return;
    const libs = currentAssetSourceLibraries();
    if(saved.library_id && libs.some(lib => lib.id === saved.library_id)){
        ctx.setActiveAssetLibraryId(saved.library_id);
    }
    const cats = assetCategories('image');
    ctx.setActiveAssetCategoryId(saved.category_id && cats.some(cat => cat.id === saved.category_id)
        ? saved.category_id
        : '');
}

function activeAssetCategory(){

    const cats = assetCategories('image');

    if(parseAssetSmartClassId(ctx.activeAssetCategoryId())) return null;

    if(!cats.length) return null;

    return cats.find(cat => cat.id === ctx.activeAssetCategoryId()) || cats[0];

}

function activeAssetTabCategory(){ return activeAssetCategory(); }

async function loadAssetLibrary(){

    try {

        const [data, localData] = await Promise.all([

            smartCanvasAssetClient.listLibrary(),

            smartCanvasAssetClient.listLocalAssets().catch(() => ({items:[], tree:null}))

        ]);

        localAssetLibrary = {items:Array.isArray(localData.items) ? localData.items : [], tree:localData.tree || null};

        setAssetLibraryFromResponse(data, {render:false});

        renderAssetLibrary();

    } catch(e) {

        toast(tr('smart.assetLoadFail'));

    }

}

function refreshAssetLibrarySoon(delay=120){

    clearTimeout(assetLibraryRefreshTimer);

    assetLibraryRefreshTimer = setTimeout(async () => {

        await loadAssetLibrary();

        if(mentionPicker?.classList?.contains('open') && ctx.mentionSource() === 'asset') renderMentionPicker('asset');

    }, delay);

}

function handleAssetLibraryUpdatedMessage(data={}){

    const remoteUpdatedAt = Number(data.updated_at || 0);

    if(remoteUpdatedAt && remoteUpdatedAt <= Number(assetLibraryUpdatedAt || 0)) return;

    refreshAssetLibrarySoon();

}

function connectAssetLibrarySyncSocket(){

    if(window.parent && window.parent !== window) return;

    const host = window.location.host;

    if(!host) return;

    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';

    const clientId = smartClientId;

    let socket;

    let retryTimer = null;

    const connect = () => {

        try {

            socket = new WebSocket(`${protocol}://${host}/ws/stats?client_id=${clientId}`);

        } catch(e) {

            retryTimer = setTimeout(connect, 3000);

            return;

        }

        socket.onmessage = event => {

            try {

                const data = JSON.parse(event.data);

                if(data?.type === 'asset_library_updated') handleAssetLibraryUpdatedMessage(data);

                if(data?.type === 'canvas_updated') handleCanvasUpdatedMessage(data);

                if(data?.type === 'canvas_task_updated') handleCanvasTaskUpdatedMessage(data);

            } catch(e) {}

        };

        socket.onclose = () => {

            retryTimer = setTimeout(connect, 3000);

        };

        socket.onerror = () => {

            try { socket.close(); } catch(e) {}

        };

    };

    eventManager.addGlobal(window, 'beforeunload', () => {

        clearTimeout(retryTimer);

        smartCanvasTaskController.destroy('page-unload');

        try { socket?.close(); } catch(e) {}

    });

    connect();

}

function setAssetLibraryFromResponse(data, options={}){

    ctx.setAssetLibrary(data.library || ctx.assetLibrary());

    invalidateAssetSmartClassIndex();

    assetLibraryUpdatedAt = Number(ctx.assetLibrary().updated_at || assetLibraryUpdatedAt || 0);

    const libs = assetLibraries();

    if(!ctx.activeAssetLibraryId()) ctx.setActiveAssetLibraryId(ctx.assetLibrary().active_library_id || libs[0]?.id || '');

    if(ctx.activeAssetLibraryId() && ctx.activeAssetLibraryId() !== LOCAL_ASSET_LIBRARY_ID && !libs.some(lib => lib.id === ctx.activeAssetLibraryId())) ctx.setActiveAssetLibraryId(libs[0]?.id || '');

    const cats = assetCategories('image');

    if(ctx.activeAssetCategoryId() && !cats.some(cat => cat.id === ctx.activeAssetCategoryId())) ctx.setActiveAssetCategoryId('');

    if(!ctx.activeAssetCategoryId()) ctx.setActiveAssetCategoryId(activeAssetCategory()?.id || '');

    if(ctx.mentionAssetCategoryId() && !cats.some(cat => cat.id === ctx.mentionAssetCategoryId())) ctx.setMentionAssetCategoryId('');

    if(!ctx.mentionAssetCategoryId()) ctx.setMentionAssetCategoryId(ctx.activeAssetCategoryId());

    if(options.render !== false) {

        renderAssetLibrary();

        if(mentionPicker?.classList?.contains('open') && ctx.mentionSource() === 'asset') renderMentionPicker('asset');

    }

}

function toggleAssetLibrary(open=!ctx.assetLibraryOpen()){

    if(!assetPanel || !assetToggle) return;

    if(open) openSmartSurface('asset');
    else closeSmartSurface('asset');

    if(!ctx.assetLibraryOpen()) closeAssetPickers();
    if(ctx.assetLibraryOpen()) loadAssetLibrary();

}

function assetCategoryForMention(){

    const cats = assetCategories('image');

    if(!cats.length) return null;

    return cats.find(cat => cat.id === ctx.mentionAssetCategoryId())

        || cats.find(cat => cat.id === ctx.activeAssetCategoryId())

        || cats.find(cat => (cat.items || []).length)

        || cats[0];

}

function assetMediaKind(item){
    if(!item) return 'image';
    if(item.kind === 'video' || item.type === 'video') return 'video';
    if(item.kind === 'audio' || item.type === 'audio') return 'audio';
    const url = String(item.url || item.thumbnail || '').toLowerCase().split('?')[0];
    const name = String(item.name || '').toLowerCase();
    if(/.(mp4|webm|mov|m4v|avi|mkv)$/.test(url) || /.(mp4|webm|mov|m4v|avi|mkv)$/.test(name)) return 'video';
    if(/.(mp3|wav|m4a|aac|ogg|flac)$/.test(url) || /.(mp3|wav|m4a|aac|ogg|flac)$/.test(name)) return 'audio';
    return 'image';
}

function assetNodeImageFromItem(item, fallbackName='asset'){

    const image = {

        url:item?.url || '',

        name:item?.name || fallbackName,

        kind:item?.kind || assetMediaKind(item)

    };

    copyMediaSizeFields(item, image);

    if(item?.asset_uris && typeof item.asset_uris === 'object') image.asset_uris = {...item.asset_uris};

    return image;

}

function assetThumbHtml(item){
    const thumb = item.thumbnail || item.thumb || item.preview || item.url || '';
    const kind = assetMediaKind(item);
    if(kind === 'video') return `<div class="asset-thumb-wrap">${smartVideoPreviewHtml(item, 192, 'class="asset-thumb" loading="lazy" decoding="async" alt=""')}<span class="asset-video-badge"><i data-lucide="film"></i>VIDEO</span></div>`;
    if(kind === 'audio') return `<div class="asset-thumb-wrap media-thumb audio-thumb asset-thumb"><i data-lucide="file-audio"></i><span>${escapeHtml(item.name || 'Audio')}</span></div>`;
    return smartPreviewImgHtml({...item, url:thumb}, 192, 'class="asset-thumb" loading="lazy" decoding="async" alt=""');
}

function closeAssetPickers(exceptButton=null){
    ctx.assetPickerController()?.closeAll(exceptButton);
}

function syncAssetPickers(){
    ctx.assetPickerController()?.syncAll();
}

function syncAssetLibraryControls(){
    if(!assetPanel || !assetGrid || !assetCategorySelect) return null;
    assetTab = 'image';
    document.querySelectorAll('[data-asset-tab]').forEach(btn => btn.classList.toggle('active', btn.dataset.assetTab === 'image'));
    const libs = currentAssetSourceLibraries();
    if(!ctx.activeAssetLibraryId() || !libs.some(lib => lib.id === ctx.activeAssetLibraryId())) ctx.setActiveAssetLibraryId(ctx.assetLibrary().active_library_id || assetLibraries()[0]?.id || LOCAL_ASSET_LIBRARY_ID);
    if(assetLibrarySelect) assetLibrarySelect.innerHTML = libs.map(lib => `<option value="${escapeHtml(lib.id)}" ${lib.id === ctx.activeAssetLibraryId() ? 'selected' : ''}>${escapeHtml(lib.name || '资产库')}</option>`).join('');
    if(assetImageControls) assetImageControls.style.display = 'block';
    const localMode = assetLibraryIsLocal();
    if(assetDropZone) assetDropZone.style.display = 'flex';
    assetGrid.style.display = 'grid';
    const baseCats = assetCategories('image');
    const smartClassCats = localMode ? [] : assetSmartClassEntries().map(entry => ({...entry, id:entry.id, name:`${entry.label} / ${entry.tag} (${entry.count})`, type:'image', smartClass:true, items:[]}));
    const cats = [...baseCats, ...smartClassCats];
    if(!cats.some(cat => cat.id === ctx.activeAssetCategoryId())) ctx.setActiveAssetCategoryId(cats[0]?.id || '');
    assetCategorySelect.innerHTML = cats.map(cat => `<option value="${escapeHtml(cat.id)}" ${cat.id === ctx.activeAssetCategoryId() ? 'selected' : ''}>${escapeHtml(cat.name || tr('smart.assetFolder'))}</option>`).join('');
    syncAssetPickers();
    const cat = activeAssetCategory();
    const smartClass = parseAssetSmartClassId(ctx.activeAssetCategoryId());
    const items = smartClass ? itemsForAssetSmartClass(ctx.activeAssetCategoryId()) : (cat?.items || []);
    if(assetAddCategoryBtn) assetAddCategoryBtn.disabled = Boolean(smartClass);
    if(assetRenameCategoryBtn) assetRenameCategoryBtn.disabled = !cat || Boolean(smartClass) || (localMode && (cat.id === '__root__' || !cat.id));
    return {items, localMode, smartClass};
}

function renderAssetGridOnly(items, localMode, smartClass){
    assetGrid.innerHTML = SmartCanvasAssetLibraryView.buildAssetGrid({
        items,
        localMode,
        smartClass,
        thumbnailHtml:assetThumbHtml,
        mediaKind:assetMediaKind,
        deleteTitle:tr('common.delete')
    });
    refreshIcons(assetGrid);
}

function buildAssetCardHtml(items, localMode){
    return SmartCanvasAssetLibraryView.buildAssetCards({
        items,
        localMode,
        thumbnailHtml:assetThumbHtml,
        mediaKind:assetMediaKind,
        deleteTitle:tr('common.delete')
    });
}

function removeAssetCard(itemId){
    const card = [...assetGrid.querySelectorAll('.asset-item')].find(el => el.dataset.assetId === itemId);
    card?.remove();
}

function insertAssetCards(items, localMode){
    if(!items.length) return;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = buildAssetCardHtml(items, localMode);
    refreshIcons(wrapper);
    const frag = document.createDocumentFragment();
    Array.from(wrapper.childNodes).forEach(node => frag.appendChild(node));
    const firstItem = assetGrid.querySelector('.asset-item');
    assetGrid.insertBefore(frag, firstItem);
}

function syncAssetGridAfterMutation({insertItems=null, removeIds=[]}={}){
    (removeIds || []).forEach(removeAssetCard);
    if(insertItems && insertItems.length) insertAssetCards(insertItems, assetLibraryIsLocal());
    syncAssetLibraryControls();
}

function renderAssetLibrary(){
    const context = syncAssetLibraryControls();
    if(!context) return;
    renderAssetGridOnly(context.items, context.localMode, context.smartClass);
}

function openAssetNameDialog({title='', value='', placeholder='', cancelValue='', multiline=false }={}){

    if(!assetDialogBackdrop || !assetDialogInput || !assetDialogOk || !assetDialogCancel) return Promise.resolve(cancelValue);

    return new Promise(resolve => {

        assetDialogTitle.textContent = title || tr('smart.assetRename');

        assetDialogInput.value = value || '';

        assetDialogInput.placeholder = placeholder || '';

        assetDialogInput.classList.toggle('is-multiline', Boolean(multiline));

        assetDialogInput.rows = multiline ? 5 : 1;

        assetDialogBackdrop.hidden = false;

        assetDialogBackdrop.classList.add('open');

        assetDialogInput.focus();

        assetDialogInput.select();

        const cleanup = result => {

            assetDialogBackdrop.classList.remove('open');

            assetDialogBackdrop.hidden = true;

            assetDialogOk.onclick = null;

            assetDialogCancel.onclick = null;

            assetDialogInput.onkeydown = null;

            assetDialogBackdrop.onmousedown = null;

            assetDialogInput.classList.remove('is-multiline');

            assetDialogInput.rows = 1;

            resolve(result);

        };

        assetDialogOk.onclick = () => cleanup(assetDialogInput.value.trim());

        assetDialogCancel.onclick = () => cleanup(cancelValue);

        assetDialogInput.onkeydown = event => {

            if(event.key === 'Enter' && !multiline) cleanup(assetDialogInput.value.trim());

            if(event.key === 'Enter' && multiline && (event.ctrlKey || event.metaKey)) cleanup(assetDialogInput.value.trim());

            if(event.key === 'Escape') cleanup(cancelValue);

        };

        assetDialogBackdrop.onmousedown = event => {

            if(event.target === assetDialogBackdrop) cleanup(cancelValue);

        };

    });

}

function createAssetRenameInput(previousName){
    const input = document.createElement('input');
    input.className = 'asset-rename-input';
    input.type = 'text';
    input.value = previousName;
    input.setAttribute('aria-label', tr('smart.assetRename'));
    return input;
}

async function applyAssetLocalRename(item, name){
    const data = await smartCanvasAssetClient.renameLocalItem(item.file || item.id, name);

    localAssetLibrary = {items:Array.isArray(data.items) ? data.items : localAssetLibrary.items, tree:data.tree || localAssetLibrary.tree};

    ctx.setActiveAssetCategoryId(data.item?.folder || ctx.activeAssetCategoryId());

    if(data.old_path && data.item?.url){

        const oldUrl = `/assets/uploads/${String(data.old_path).split('/').map(encodeURIComponent).join('/')}`;

        ctx.nodes().forEach(node => (node.images || []).forEach(img => {

            if(img?.url !== oldUrl) return;

            img.url = data.item.url;

            img.name = data.item.name || img.name;

            copyMediaSizeFields(data.item, img);

        }));

        scheduleSave();

    }

    renderAssetLibrary();

    render();

    toast('已重命名本地素材，反推提示词和分类索引已同步');
}

function bindAssetRenameInputEvents(input, finish){
    input.addEventListener('keydown', event => {

        event.stopPropagation();

        if(event.key === 'Enter'){

            event.preventDefault();

            finish(true);

        } else if(event.key === 'Escape'){

            event.preventDefault();

            finish(false);

        }

    });

    input.addEventListener('pointerdown', event => event.stopPropagation());

    input.addEventListener('mousedown', event => event.stopPropagation());

    input.addEventListener('click', event => event.stopPropagation());

    input.addEventListener('blur', () => finish(true));
}
function beginAssetInlineRename(assetId){

    const item = (activeAssetCategory()?.items || []).find(x => x.id === assetId);

    const card = [...assetGrid.querySelectorAll('.asset-item')].find(el => el.dataset.assetId === assetId);

    const nameEl = card?.querySelector('.asset-name');

    if(!item || !card || !nameEl || card.querySelector('.asset-rename-input')) return;


    const previousName = item.name || 'asset';

    const previousDraggable = card.draggable;

    const input = createAssetRenameInput(previousName);

    card.draggable = false;

    nameEl.replaceWith(input);

    input.focus();

    input.select();

    let done = false;

    const restore = () => {

        if(input.isConnected) input.replaceWith(nameEl);

        card.draggable = previousDraggable;

    };

    const finish = async save => {

        if(done) return;

        done = true;

        const name = input.value.trim();

        if(!save || !name || name === previousName){

            restore();

            return;

        }

        input.disabled = true;

        try {

            if(assetLibraryIsLocal() || item.file){

                await applyAssetLocalRename(item, name);

            } else {

                const data = await smartCanvasAssetClient.renameLibraryItem(assetId, name);

                setAssetLibraryFromResponse(data);

            }

        } catch(err){

            restore();

            toast(err.message || tr('smart.assetAddFail'));

        }

    };

    bindAssetRenameInputEvents(input, finish);

}

let assetGridEventsBound = false;

function bindAssetItemEvents(){
    if(!assetGrid || assetGridEventsBound) return;
    assetGridEventsBound = true;

    assetGrid.addEventListener('click', async event => {
        const add = event.target.closest('[data-asset-add-files]');
        if(add){
            event.preventDefault();
            event.stopPropagation();
            if(parseAssetSmartClassId(ctx.activeAssetCategoryId())){
                toast('智能分类不能直接添加素材，请选择文件夹');
                return;
            }
            assetAddFilesInput?.click();
            return;
        }

        const rename = event.target.closest('[data-rename-asset]');
        if(rename){
            event.preventDefault();
            event.stopPropagation();
            beginAssetInlineRename(rename.dataset.renameAsset);
            return;
        }

        const renameLocal = event.target.closest('[data-rename-local-asset]');
        if(renameLocal){
            event.preventDefault();
            event.stopPropagation();
            beginAssetInlineRename(renameLocal.dataset.renameLocalAsset || '');
            return;
        }

        const deleteLocal = event.target.closest('[data-delete-local-asset]');
        if(deleteLocal){
            event.preventDefault();
            event.stopPropagation();
            deleteLocal.disabled = true;
            await deleteLocalAssetFromPanel(deleteLocal.dataset.deleteLocalAsset || '');
            return;
        }

        const deleteAsset = event.target.closest('[data-delete-asset]');
        if(deleteAsset){
            event.preventDefault();
            event.stopPropagation();
            deleteAsset.disabled = true;
            try {
                const data = await smartCanvasAssetClient.deleteLibraryItem(deleteAsset.dataset.deleteAsset);
                setAssetLibraryFromResponse(data, {render:false});
                removeAssetCard(deleteAsset.dataset.deleteAsset);
                syncAssetLibraryControls();
            } catch(err){
                deleteAsset.disabled = false;
                toast(err.message || tr('smart.assetAddFail'));
            }
        }
    });

    assetGrid.addEventListener('dragstart', event => {
        const el = event.target.closest('.asset-item');
        if(!el) return;
        event.dataTransfer.effectAllowed = 'copy';
        const item = (activeAssetCategory()?.items || []).find(x => x.id === el.dataset.assetId);
        event.dataTransfer.setData('application/x-smart-asset', JSON.stringify(assetNodeImageFromItem(item || {url:el.dataset.url, name:el.dataset.name, kind:el.dataset.kind})));
        event.dataTransfer.setData('text/plain', el.dataset.url || '');
    });

    assetGrid.addEventListener('error', event => {
        const img = event.target;
        if(!(img instanceof HTMLImageElement)) return;
        const original = img.dataset.originalSrc || '';
        if(!img.dataset.previewSrc || !original) return;
        if(img.dataset.previewKind === 'video'){
            const tpl = document.createElement('template');
            tpl.innerHTML = smartVideoFallbackHtml(original, img.dataset.videoFallbackAttrs || '');
            img.replaceWith(tpl.content.firstElementChild);
            return;
        }
        if(img.getAttribute('src') !== original) img.src = original;
    }, true);
}

async function addUrlToAssetLibrary(url, name=''){

    if(assetLibraryIsLocal()) return addUrlToLocalAssetLibrary(url, name);

    const cat = activeAssetCategory();

    if(!cat){ toast(tr('smart.assetNoFolder')); return; }

    const beforeIds = new Set([...assetGrid.querySelectorAll('.asset-item')].map(el => el.dataset.assetId));

    const data = await smartCanvasAssetClient.createLibraryItem({library_id:ctx.activeAssetLibraryId(), category_id:cat.id, url, name});

    setAssetLibraryFromResponse(data, {render:false});

    const inserted = (activeAssetCategory()?.items || []).filter(item => !beforeIds.has(item.id));

    syncAssetGridAfterMutation({insertItems:inserted});

    toast(tr('smart.assetSaved'));

}

function localAssetFolderPath(){

    const cat = activeAssetCategory();

    return cat && cat.id !== '__root__' ? (cat.id || '') : '';

}

function setLocalAssetLibraryFromResponse(data){

    localAssetLibrary = {items:Array.isArray(data.items) ? data.items : localAssetLibrary.items, tree:data.tree || localAssetLibrary.tree};

}

async function addFilesToActiveAssetLibrary(files=[]){
    const supported = [...(files || [])].filter(isSupportedUploadFile);
    if(!supported.length) return [];
    if(parseAssetSmartClassId(ctx.activeAssetCategoryId())){
        toast('智能分类不能直接添加素材，请选择文件夹');
        return [];
    }
    if(assetLibraryIsLocal()) return addFilesToLocalAssetLibrary(supported);
    if(!activeAssetCategory()){
        toast(tr('smart.assetNoFolder'));
        return [];
    }
    const uploaded = await uploadFiles(supported);
    for(const file of uploaded) if(file?.url) await addUrlToAssetLibrary(file.url, file.name || '');
    return uploaded;
}

async function addFilesToLocalAssetLibrary(files=[]){

    const supported = [...(files || [])].filter(isSupportedUploadFile);

    if(!supported.length) return [];

    const beforeIds = new Set([...assetGrid.querySelectorAll('.asset-item')].map(el => el.dataset.assetId));

    const data = await smartCanvasAssetClient.uploadLocalFiles(
        localAssetFolderPath(),
        supported,
        tr('smart.assetAddFail')
    );

    const localData = await smartCanvasAssetClient.listLocalAssets();

    setLocalAssetLibraryFromResponse(localData);

    const inserted = (activeAssetCategory()?.items || []).filter(item => !beforeIds.has(item.id));

    syncAssetGridAfterMutation({insertItems:inserted});

    toast(`已保存 ${data.files?.length || 0} 个本地素材`);

    return data.files || [];

}

async function addLocalPathsToLocalAssetLibrary(paths=[]){

    const imported = await importSmartLocalImages(paths);

    return addUrlItemsToLocalAssetLibrary(imported.map(item => ({url:item.url, name:item.name || smartImageNameFromUrl(item.url)})));

}

async function addUrlItemsToLocalAssetLibrary(items=[]){

    const list = (items || []).filter(item => item?.url);

    if(!list.length) return [];

    const beforeIds = new Set([...assetGrid.querySelectorAll('.asset-item')].map(el => el.dataset.assetId));

    const data = await smartCanvasAssetClient.importLocalUrls(
        localAssetFolderPath(),
        list.map(item => ({url:item.url, name:item.name || smartImageNameFromUrl(item.url)})),
        tr('smart.assetAddFail')
    );

    setLocalAssetLibraryFromResponse(data);

    const inserted = (activeAssetCategory()?.items || []).filter(item => !beforeIds.has(item.id));

    syncAssetGridAfterMutation({insertItems:inserted});

    toast(`已保存 ${data.count || 0} 个本地素材`);

    return data.files || [];

}

async function addUrlToLocalAssetLibrary(url, name=''){

    return addUrlItemsToLocalAssetLibrary([{url, name:name || smartImageNameFromUrl(url)}]);

}

async function deleteLocalAssetFromPanel(itemId){

    const item = (activeAssetCategory()?.items || []).find(x => x.id === itemId)

        || (localAssetLibrary.items || []).find(x => x.id === itemId || x.file === itemId);

    if(!item) return;

    try {

        const data = await smartCanvasAssetClient.deleteLocalItems([item.file || item.id], '删除失败');

        const localData = await smartCanvasAssetClient.listLocalAssets();

        setLocalAssetLibraryFromResponse(localData);

        removeAssetCard(item.id);
        syncAssetLibraryControls();

        toast(data.deleted?.length ? '已删除本地素材' : '未找到要删除的本地素材');

    } catch(err){

        toast(err.message || '删除失败');

    }

}

function hasCanvasImageDrag(event){

    return Array.from(event.dataTransfer?.types || []).includes('application/x-smart-canvas-image');

}

function setAssetDragOver(active){

    if(!assetDropZone || !assetPanel) return;

    assetDropZone.classList.toggle('drag-over', !!active);

    assetPanel.classList.toggle('drag-over', !!active);

}

function handleAssetPanelDragOver(e){

    if(hasCanvasImageDrag(e) || hasSmartImageDropData(e.dataTransfer)){

        e.preventDefault();

        e.stopPropagation();

        e.dataTransfer.dropEffect = 'copy';

        setAssetDragOver(true);

    }

}

async function handleAssetPanelDrop(e){

    if(!hasCanvasImageDrag(e) && !hasSmartImageDropData(e.dataTransfer)) return;

    e.preventDefault();

    e.stopPropagation();

    setAssetDragOver(false);

    const raw = e.dataTransfer.getData('application/x-smart-canvas-image');

    if(raw){

        try {

            const payload = JSON.parse(raw);

            if(payload?.url) await addUrlToAssetLibrary(payload.url, payload.name || '');

            return;

        } catch(e) {

            toast(tr('smart.assetAddFail'));

            return;

        }

    }

    try {

        const payload = await resolveSmartImageDropPayload(e.dataTransfer);

        if(payload.type === 'files') {

            await addFilesToActiveAssetLibrary(payload.files);

        } else if(payload.type === 'localPaths') {

            if(assetLibraryIsLocal()) await addLocalPathsToLocalAssetLibrary(payload.localPaths);

            else {

                const imported = await importSmartLocalImages(payload.localPaths);

                for(const file of imported) if(file?.url) await addUrlToAssetLibrary(file.url, file.name || '');

            }

        } else if(payload.type === 'url') {

            await addUrlToAssetLibrary(payload.url, smartImageNameFromUrl(payload.url));

        }

    } catch(err) {

        toast(err.message || tr('smart.assetAddFail'));

    }

}

assetDropZone?.addEventListener('dragover', e => {

    if(hasCanvasImageDrag(e) || hasSmartImageDropData(e.dataTransfer)){

        e.preventDefault();

        e.stopPropagation();

        assetDropZone?.classList.add('drag-over');

    }

});

assetDropZone?.addEventListener('dragleave', () => assetDropZone?.classList.remove('drag-over'));

assetDropZone?.addEventListener('drop', handleAssetPanelDrop);

assetPanel?.addEventListener('dragover', handleAssetPanelDragOver);

assetPanel?.addEventListener('dragleave', e => { if(!assetPanel?.contains(e.relatedTarget)) setAssetDragOver(false); });

assetPanel?.addEventListener('drop', handleAssetPanelDrop);

createMenu?.addEventListener('mousedown', event => event.stopPropagation());

createMenu?.addEventListener('click', event => {

    event.stopPropagation();

    const command = event.target.closest('[data-canvas-command]');
    if(command) runCanvasCommand(command.dataset.canvasCommand || '');

});

    return {
        assetCategories,
        assetLibraries,
        assetLibraryIsLocal,
        rememberCanvasAssetLibrarySelection,
        restoreCanvasAssetLibrarySelection,
        activeAssetTabCategory,
        loadAssetLibrary,
        handleAssetLibraryUpdatedMessage,
        connectAssetLibrarySyncSocket,
        setAssetLibraryFromResponse,
        toggleAssetLibrary,
        assetCategoryForMention,
        assetMediaKind,
        assetNodeImageFromItem,
        closeAssetPickers,
        renderAssetLibrary,
        openAssetNameDialog,
        bindAssetItemEvents,
        addUrlToAssetLibrary,
        localAssetFolderPath,
        setLocalAssetLibraryFromResponse,
        addFilesToActiveAssetLibrary,
        setAssetDragOver
    };

}
