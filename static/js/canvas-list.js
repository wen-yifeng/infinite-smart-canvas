// canvas-list.js — Project Workspace.

// Two-pane: LEFT project list, RIGHT pannable/zoomable board of canvas cards.

// Self-contained; relies only on global fetch / StudioI18n / lucide.

/* ===== Shared UI helpers ===== */

const { escapeAttr, escapeHtml, refreshIcons } = window.SmartCanvasUiUtils;

function langIsEn(){ return window.StudioI18n?.lang?.() === 'en'; }

function L(zh, en){ return langIsEn() ? en : zh; }


const CANVAS_LIST_PROJECT_KEY = 'canvasListCurrentProjectId';

const SMART_LAST_CANVAS_KEY = 'smartCanvas.lastCanvas.v1';

function rememberedProjectId(){

    try {

        return new URLSearchParams(window.location.search).get('project') || localStorage.getItem(CANVAS_LIST_PROJECT_KEY) || 'default';

    } catch(e){

        return 'default';

    }

}

function rememberProjectId(pid){

    if(!pid) return;

    try { localStorage.setItem(CANVAS_LIST_PROJECT_KEY, pid); } catch(e){}

}

function rememberLastCanvas(c){

    if(!c?.id) return;

    try { localStorage.setItem(SMART_LAST_CANVAS_KEY, JSON.stringify({id:String(c.id), project:c.project || currentProjectId || 'default'})); } catch(e){}

}

function lastOpenedCanvas(){

    try {

        const raw = JSON.parse(localStorage.getItem(SMART_LAST_CANVAS_KEY) || 'null');

        return raw?.id ? canvases.find(c => String(c.id) === String(raw.id)) : null;

    } catch(e){ return null; }

}

function canvasListApiSettingsUrl(){

    const url = new URL('/static/api-settings.html', window.location.origin);

    url.searchParams.set('embed', '1');

    return `${url.pathname}${url.search}`;

}

function bindCanvasListApiSettingsFrameShortcuts(){

    const frameWindow = canvasListApiSettingsFrame?.contentWindow;

    if(!frameWindow || frameWindow.__smartCanvasListSettingsShortcutsBound) return;

    frameWindow.__smartCanvasListSettingsShortcutsBound = true;

    frameWindow.addEventListener('keydown', event => {

        const isSettingsToggle = (event.code === 'Digit4' || event.code === 'KeyZ')
            && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
        if(!isSettingsToggle || (event.code === 'KeyZ' && isCanvasListShortcutBlocked(event.target))) return;

        event.preventDefault();

        event.stopPropagation();

        closeCanvasListSettings();

    }, true);

}

function syncCanvasListApiSettingsFrame(){

    const frameWindow = canvasListApiSettingsFrame?.contentWindow;

    if(!frameWindow) return;

    bindCanvasListApiSettingsFrameShortcuts();

    const theme = document.documentElement.classList.contains('theme-dark') ? 'dark' : 'light';

    frameWindow.postMessage({type:'studio-theme', theme}, location.origin);

    const lang = window.StudioI18n?.lang?.();

    if(lang) frameWindow.postMessage({type:'studio-lang', lang}, location.origin);

}

function showCanvasListApiSettingsStatus(text){

    if(!canvasListApiSettingsStatus) return;

    canvasListApiSettingsStatus.textContent = text || '';

    window.clearTimeout(canvasListApiSettingsHideTimer);

    if(text) canvasListApiSettingsHideTimer = window.setTimeout(() => {

        if(canvasListApiSettingsStatus) canvasListApiSettingsStatus.textContent = '';

    }, 2400);

}

function openCanvasListSettings(){

    if(!canvasListApiSettingsModal) return;

    window.clearTimeout(canvasListApiSettingsHideTimer);

    canvasListApiSettingsModal.hidden = false;

    requestAnimationFrame(() => canvasListApiSettingsModal.classList.add('open'));

    if(!canvasListApiSettingsFrame?.getAttribute('src')) canvasListApiSettingsFrame.src = canvasListApiSettingsUrl();

    else syncCanvasListApiSettingsFrame();

    refreshIcons();

}

function closeCanvasListSettings(){

    if(!canvasListApiSettingsModal || canvasListApiSettingsModal.hidden) return;

    canvasListApiSettingsModal.classList.remove('open');

    window.setTimeout(() => {

        if(!canvasListApiSettingsModal.classList.contains('open')) canvasListApiSettingsModal.hidden = true;

    }, 150);

    canvasSettingsLink?.focus({preventScroll:true});

}

function canvasSortText(value){

    const labels = {

        manual: L('手动排序','Manual order'),

        updated: L('最近修改','Recently updated'),

        name: L('名称','Name'),

        nodes: L('节点数量','Node count')

    };

    return labels[value] || labels.manual;

}

function syncCanvasSortMenu(){

    const value = canvasSortMode || canvasSortSelect?.value || 'manual';

    if(canvasSortSelect && canvasSortSelect.value !== value) canvasSortSelect.value = value;

    if(canvasSortButtonLabel) canvasSortButtonLabel.textContent = canvasSortText(value);

    canvasSortOptions.forEach(option => {

        const selected = option.dataset.sortValue === value;

        option.setAttribute('aria-selected', selected ? 'true' : 'false');

        option.tabIndex = selected ? 0 : -1;

        option.classList.toggle('active', selected);

    });

}

function closeCanvasSortMenu({restoreFocus = false} = {}){

    if(!canvasSortMenu || canvasSortMenu.hidden) return;

    canvasSortMenu.hidden = true;

    canvasSortButton?.setAttribute('aria-expanded','false');

    canvasSortButton?.classList.remove('open');

    if(restoreFocus) canvasSortButton?.focus({preventScroll:true});

}

function openCanvasSortMenu(){

    if(!canvasSortMenu || !canvasSortButton) return;

    syncCanvasSortMenu();

    canvasSortMenu.hidden = false;

    canvasSortButton.setAttribute('aria-expanded','true');

    canvasSortButton.classList.add('open');

    const active = canvasSortOptions.find(option => option.classList.contains('active')) || canvasSortOptions[0];

    active?.focus({preventScroll:true});

}

function selectCanvasSort(value){

    if(!['manual','updated','name','nodes'].includes(value)) value = 'manual';

    canvasSortMode = value;

    if(canvasSortSelect) canvasSortSelect.value = value;

    syncCanvasSortMenu();

    closeCanvasSortMenu();

    renderBoard();

    canvasSortButton?.focus({preventScroll:true});

}

function moveCanvasSortFocus(step){

    if(!canvasSortMenu || canvasSortMenu.hidden || !canvasSortOptions.length) return;

    const current = Math.max(0, canvasSortOptions.indexOf(document.activeElement));

    const next = canvasSortOptions[(current + step + canvasSortOptions.length) % canvasSortOptions.length];

    next?.focus({preventScroll:true});

}

function isCanvasListShortcutBlocked(target){

    if(target?.closest?.('input, textarea, select, option, [contenteditable="true"], [contenteditable="plaintext-only"]')) return true;

    return !!document.querySelector('.ws-create-card, .ws-card-pop, .ws-card-title-input, .ws-card.confirming-delete, .ws-newproj-row.active, .ws-trash-panel.active, .ws-home-sort-menu:not([hidden])');

}

const canvasListView = window.SmartCanvasCanvasListView.create({
    escapeAttr,
    escapeHtml,
    tr:L,
    isEnglish:langIsEn
});

/* ===== DOM refs ===== */
const board = document.getElementById('board');

const boardWorld = document.getElementById('boardWorld');

const projectListEl = document.getElementById('projectList');

const trashEntryBtn = document.getElementById('trashEntry');

const trashBadge = document.getElementById('trashBadge');

const trashPanel = document.getElementById('trashPanel');

const trashListEl = document.getElementById('trashList');

const trashCloseBtn = document.getElementById('trashClose');

const newProjectBtn = document.getElementById('newProjectBtn');

const newProjectRow = document.getElementById('newProjectRow');

const newProjectInput = document.getElementById('newProjectInput');

const newProjectConfirm = document.getElementById('newProjectConfirm');

const newProjectCancel = document.getElementById('newProjectCancel');

const pasteCanvasBtn = document.getElementById('pasteCanvasBtn');

const statusEl = document.getElementById('boardStatus');

const canvasImportInput = document.getElementById('canvasImportInput');

const canvasSettingsLink = document.getElementById('canvasSettingsLink');

const canvasListApiSettingsModal = document.getElementById('canvasListApiSettingsModal');

const canvasListApiSettingsFrame = document.getElementById('canvasListApiSettingsFrame');

const canvasListApiSettingsClose = document.getElementById('canvasListApiSettingsClose');

const canvasListApiSettingsStatus = document.getElementById('canvasListApiSettingsStatus');

let canvasListApiSettingsHideTimer = 0;

const canvasSearchInput = document.getElementById('canvasSearchInput');

const canvasSortSelect = document.getElementById('canvasSortSelect');

const canvasSortButton = document.getElementById('canvasSortButton');

const canvasSortButtonLabel = document.getElementById('canvasSortButtonLabel');

const canvasSortMenu = document.getElementById('canvasSortMenu');

const canvasSortOptions = Array.from(document.querySelectorAll('.ws-home-sort-option'));

const homeProjectName = document.getElementById('homeProjectName');

const homeCanvasCount = document.getElementById('homeCanvasCount');

const homeNewCanvasBtn = document.getElementById('homeNewCanvasBtn');

const homeImportCanvasBtn = document.getElementById('homeImportCanvasBtn');

/* ===== State ===== */

let projects = [];

let canvases = [];          // all canvases across projects

let deletedCanvases = [];

let currentProjectId = rememberedProjectId();

let pendingDeleteProjectId = null;

let statusTimer = null;

let clipboardCanvasId = null;   // 剪切的画布（切到别的项目后粘贴）

let selectedCanvasId = '';       // 首页单击反馈；双击仍负责打开画布

let canvasSearchQuery = '';

let canvasSortMode = 'manual';

let canvasOrderSaveToken = 0;

let canvasOrderSaveChain = Promise.resolve();

// board viewport (mirrors smart-canvas math)

const viewport = { x: 0, y: 0, scale: 1 };

const MIN_SCALE = 0.3, MAX_SCALE = 2;

/* ===== Status toast ===== */

function setStatus(text){

    if(!statusEl) return;

    if(!text){ statusEl.classList.remove('show'); return; }

    statusEl.textContent = text;

    statusEl.classList.add('show');

    clearTimeout(statusTimer);

    statusTimer = setTimeout(() => statusEl.classList.remove('show'), 2200);

}

/* ===== Viewport math (mirrors smart-canvas.js) ===== */

function applyViewport(){

    boardWorld.style.transform = 'none';

    board.style.backgroundSize = '120px 120px, 120px 120px, 24px 24px';

    board.style.backgroundPosition = '0 0, 0 0, 0 0';

}

function boardCenterWorld(){

    return {

        x: (board.clientWidth / 2 - viewport.x) / viewport.scale,

        y: (board.clientHeight / 2 - viewport.y) / viewport.scale

    };

}

function resetView(){

    viewport.x = 0;

    viewport.y = 0;

    viewport.scale = 1;

    applyViewport();

}

/* ===== Board pan & zoom (disabled in launcher-only mode) ===== */

let panState = null;





/* ===== Data loading ===== */

function canvasesInProject(pid){ return canvases.filter(c => (c.project || 'default') === pid); }

function visibleCanvases(){ return canvasesInProject(currentProjectId); }

function canvasTimestamp(c){

    const raw = Number(c?.updated_at || c?.created_at || 0);

    return raw && raw < 10000000000 ? raw * 1000 : raw;

}

function displayedCanvases(){

    let items = visibleCanvases().slice();

    const query = canvasSearchQuery.trim().toLocaleLowerCase(langIsEn() ? 'en-US' : 'zh-CN');

    if(query){

        items = items.filter(item => String(item.title || '').toLocaleLowerCase(langIsEn() ? 'en-US' : 'zh-CN').includes(query));

    }

    if(canvasSortMode === 'updated') items.sort((a, b) => canvasTimestamp(b) - canvasTimestamp(a));

    if(canvasSortMode === 'name') items.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), langIsEn() ? 'en' : 'zh-CN', {numeric:true, sensitivity:'base'}));

    if(canvasSortMode === 'nodes') items.sort((a, b) => Number(b.node_count || 0) - Number(a.node_count || 0));

    return items;

}

function updateHomeToolbar(displayCount = displayedCanvases().length){

    const project = projects.find(item => item.id === currentProjectId);

    const total = visibleCanvases().length;

    if(homeProjectName) homeProjectName.textContent = project?.name || L('默认项目','Default');

    if(homeCanvasCount){

        homeCanvasCount.textContent = canvasSearchQuery.trim()

            ? L(`${displayCount} / ${total} 个画布`, `${displayCount} of ${total} canvases`)

            : L(`${total} 个画布`, `${total} ${total === 1 ? 'canvas' : 'canvases'}`);

    }

    if(canvasSearchInput) canvasSearchInput.placeholder = L('搜索画布…','Search canvases…');

    const sortLabels = [

        L('手动排序','Manual order'),

        L('最近修改','Recently updated'),

        L('名称','Name'),

        L('节点数量','Node count')

    ];

    if(canvasSortSelect?.options){

        Array.from(canvasSortSelect.options).forEach((option, index) => {

            if(sortLabels[index]) option.textContent = sortLabels[index];

        });

    }

    canvasSortOptions.forEach(option => {

        const value = option.dataset.sortValue;

        const index = ['manual','updated','name','nodes'].indexOf(value);

        const label = option.querySelector('span');

        if(label && sortLabels[index]) label.textContent = sortLabels[index];

    });

    syncCanvasSortMenu();

    homeNewCanvasBtn?.querySelector('span')?.replaceChildren(L('新建画布','New canvas'));

    homeImportCanvasBtn?.querySelector('span')?.replaceChildren(L('导入','Import'));

}

function updateBoardHeader(){ updateHomeToolbar(); }

async function loadAll(){

    try {

        const [pRes, cRes] = await Promise.all([

            fetch('/api/projects'),

            fetch('/api/canvases')

        ]);

        const pData = pRes.ok ? await pRes.json() : { projects: [] };

        const cData = cRes.ok ? await cRes.json() : { canvases: [] };

        projects = (pData.projects || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));

        if(!projects.length) projects = [{ id: 'default', name: L('默认项目','Default'), order: 0, canvas_count: 0 }];

        canvases = (cData.canvases || []).filter(c => c.kind === 'smart');

        // pick first project (prefer default / order 0)

        if(!projects.find(p => p.id === currentProjectId)){

            const def = projects.find(p => p.id === 'default') || projects.slice().sort((a, b) => (a.order || 0) - (b.order || 0))[0];

            currentProjectId = def ? def.id : 'default';

        }

        rememberProjectId(currentProjectId);

        renderProjects();

        renderBoard();

        resetView();

        refreshTrashCount();

    } catch(e){

        console.error(e);

        setStatus(L('加载失败','Load failed'));

    }

}

function projectCanvasCount(pid){

    const p = projects.find(x => x.id === pid);

    // prefer live count from canvases array; fall back to server count

    const live = canvasesInProject(pid).length;

    return canvases.length ? live : (p?.canvas_count || 0);

}

/* ===== Project sidebar rendering ===== */

function renderProjects(){

    projectListEl.innerHTML = '';

    projects.forEach(p => {

        if(pendingDeleteProjectId === p.id){

            const box = canvasListView.createProjectDeleteConfirm(p);

            box.querySelector('.ws-confirm-btn').onclick = () => deleteProject(p.id);

            box.querySelector('.ws-cancel-btn').onclick = () => { pendingDeleteProjectId = null; renderProjects(); };

            projectListEl.appendChild(box);

            return;

        }

        const row = canvasListView.createProjectRow(p, {

            active:p.id === currentProjectId,

            count:projectCanvasCount(p.id),

            isDefault:p.id === 'default'

        });

        row.onclick = e => {

            if(e.target.closest('.ws-proj-act')) return;

            selectProject(p.id);

        };

        const renameBtn = row.querySelector('.ws-proj-act.rename');

        if(renameBtn) renameBtn.onclick = e => { e.stopPropagation(); startProjectRename(p.id, row); };

        const delBtn = row.querySelector('.ws-proj-act.del');

        if(delBtn) delBtn.onclick = e => { e.stopPropagation(); pendingDeleteProjectId = p.id; renderProjects(); };

        projectListEl.appendChild(row);

    });

    refreshIcons(projectListEl);

}
function selectProject(pid){

    if(pid === currentProjectId && !trashPanel.classList.contains('active')) return;

    currentProjectId = pid;

    rememberProjectId(pid);

    closeTrashView();

    renderProjects();

    renderBoard();

    resetView();

}

function startProjectRename(pid, row){

    const p = projects.find(x => x.id === pid);

    if(!p) return;

    const nameEl = row.querySelector('.ws-project-name');

    if(!nameEl || nameEl.querySelector('input')) return;

    const input = canvasListView.createProjectRenameInput(p);

    nameEl.replaceWith(input);

    input.focus(); input.select();

    input.onclick = e => e.stopPropagation();

    let done = false;

    const finish = commit => {

        if(done) return; done = true;

        const v = input.value.trim();

        if(commit && v && v !== p.name) renameProject(pid, v);

        else renderProjects();

    };

    input.onblur = () => finish(true);

    input.onkeydown = e => {

        e.stopPropagation();

        if(e.key === 'Enter'){ e.preventDefault(); finish(true); }

        if(e.key === 'Escape'){ e.preventDefault(); finish(false); }

    };

}

/* ===== Project CRUD ===== */

function openNewProject(){

    newProjectRow.classList.add('active');

    newProjectInput.value = '';

    newProjectInput.focus();

}

function closeNewProject(){

    newProjectRow.classList.remove('active');

    newProjectInput.value = '';

}

async function createProject(){

    const name = newProjectInput.value.trim() || L('新项目','New project');

    closeNewProject();

    try {

        const res = await fetch('/api/projects', {

            method: 'POST',

            headers: { 'Content-Type': 'application/json' },

            body: JSON.stringify({ name })

        });

        if(!res.ok) throw new Error('create project failed');

        const data = await res.json();

        const proj = data.project;

        if(proj){

            projects.push(proj);

            projects.sort((a, b) => (a.order || 0) - (b.order || 0));

            selectProject(proj.id);

            renderProjects();

        }

    } catch(e){

        console.error(e); setStatus(L('创建项目失败','Create project failed'));

    }

}

async function renameProject(pid, name){

    const p = projects.find(x => x.id === pid);

    if(p) p.name = name;

    renderProjects();

    if(pid === currentProjectId) updateBoardHeader();

    try {

        const res = await fetch(`/api/projects/${encodeURIComponent(pid)}`, {

            method: 'POST',

            headers: { 'Content-Type': 'application/json' },

            body: JSON.stringify({ name })

        });

        if(!res.ok) throw new Error('rename project failed');

    } catch(e){ console.error(e); setStatus(L('重命名失败','Rename failed')); loadAll(); }

}

async function deleteProject(pid){

    pendingDeleteProjectId = null;

    try {

        const res = await fetch(`/api/projects/${encodeURIComponent(pid)}`, { method: 'DELETE' });

        if(!res.ok) throw new Error('delete project failed');

        // canvases of deleted project move back to default

        canvases.forEach(c => { if((c.project || 'default') === pid) c.project = 'default'; });

        projects = projects.filter(p => p.id !== pid);

        if(currentProjectId === pid) currentProjectId = 'default';

        rememberProjectId(currentProjectId);

        renderProjects();

        renderBoard();

    } catch(e){ console.error(e); setStatus(L('删除项目失败','Delete project failed')); loadAll(); }

}

/* ===== Board rendering ===== */

function renderBoard(){

    const items = displayedCanvases();

    if(selectedCanvasId && !items.some(item => String(item.id) === selectedCanvasId)) selectedCanvasId = '';

    boardWorld.innerHTML = '';

    items.forEach(c => boardWorld.appendChild(buildCard(c)));

    if(canvasSearchQuery.trim()){

        if(!items.length) boardWorld.appendChild(buildSearchEmptyState());

    } else {

        boardWorld.appendChild(buildNewCanvasCard());

    }

    boardWorld.classList.toggle('is-filtered-or-sorted', !!canvasSearchQuery.trim() || canvasSortMode !== 'manual');

    updateHomeToolbar(items.length);

    updatePasteBtn();

    refreshIcons(boardWorld);

}

function syncCanvasCardSelection(){

    boardWorld.querySelectorAll('.ws-card[data-canvas-id]').forEach(card => {

        const selected = card.dataset.canvasId === selectedCanvasId;

        card.classList.toggle('selected', selected);

        card.setAttribute('aria-selected', selected ? 'true' : 'false');

    });

}

function selectCanvasCard(canvasId){

    selectedCanvasId = String(canvasId || '');

    syncCanvasCardSelection();

}

function clearCanvasCardSelection(){

    if(!selectedCanvasId) return;

    selectedCanvasId = '';

    syncCanvasCardSelection();

}

function buildNewCanvasCard(){
    const card = canvasListView.createNewCanvasCard();

    card.addEventListener('mousedown', event => event.stopPropagation());
    card.querySelector('.ws-new-canvas-create').addEventListener('click', event => {
        event.stopPropagation();
        openCreateCard(boardCenterWorld());
    });

    return card;
}

function buildSearchEmptyState(){
    return canvasListView.createSearchEmptyState();
}

async function importCanvasArchive(file){

    if(!file) return;

    if(!/\.zip$/i.test(file.name || '')){

        setStatus(L('请选择 ZIP 画布包','Choose a canvas ZIP package'));

        return;

    }

    setStatus(L('正在导入画布与素材...','Importing canvas and assets...'));

    const body = new FormData();

    body.append('archive', file, file.name);

    body.append('project', currentProjectId);

    try {

        const response = await fetch('/api/canvas-import', {method:'POST', body});

        const data = await response.json().catch(() => ({}));

        if(!response.ok) throw new Error(data.detail || 'import failed');

        if(data.canvas){

            canvases.push(data.canvas);

            renderProjects();

            renderBoard();

        }

        setStatus(L('画布与素材已导入','Canvas and assets imported'));

    } catch(error) {

        console.error(error);

        setStatus(error.message || L('导入失败','Import failed'));

    } finally {

        if(canvasImportInput) canvasImportInput.value = '';

    }

}

function buildCard(c){
    const card = canvasListView.createCanvasCard(c, {
        clipboardCanvasId,
        selectedCanvasId
    });

    attachCardDrag(card, c);

    card.querySelector('.ws-card-rename').onpointerdown = e => e.stopPropagation();
    card.querySelector('.ws-card-menu').onmousedown = e => e.stopPropagation();
    card.querySelector('.ws-card-delete-confirm').onmousedown = e => e.stopPropagation();

    return card;
}

/* ===== Persistent launcher ordering ===== */
let cardDragState = null; // custom drag state: { cardId, cardEl, ghostEl, offsetX, offsetY, origOrder, origIndex, targetIndex, targetCard, placeAfter, dropRow, scrollTimer }

function replaceVisibleCanvasOrder(orderedIds){

    const ids = orderedIds.map(String);

    const replacement = new Map(visibleCanvases().map(item => [String(item.id), item]));

    let cursor = 0;

    canvases = canvases.map(item => {

        if(!replacement.has(String(item.id))) return item;

        return replacement.get(ids[cursor++]) || item;

    });

}

function persistCanvasOrder(previousOrder){

    const requestToken = ++canvasOrderSaveToken;

    const orderedIds = canvases.map(item => item.id);

    const save = async () => {

        try {

            const res = await fetch('/api/canvases/order', {

                method:'PATCH',

                headers:{'Content-Type':'application/json'},

                body:JSON.stringify({canvas_ids:orderedIds})

            });

            if(!res.ok) throw new Error('canvas order save failed');

            const data = await res.json();

            if(requestToken !== canvasOrderSaveToken || cardDragState) return;

            if(Array.isArray(data.canvases)) canvases = data.canvases.filter(item => item.kind === 'smart');

            renderBoard();

        } catch(error) {

            console.error(error);

            if(requestToken !== canvasOrderSaveToken || cardDragState) return;

            canvases = previousOrder;

            renderBoard();

        }

    };

    canvasOrderSaveChain = canvasOrderSaveChain.catch(() => {}).then(save);

    return canvasOrderSaveChain;

}

function reorderVisibleCanvas(dragId, targetId, placeAfter){

    const ordered = visibleCanvases();

    const from = ordered.findIndex(item => String(item.id) === String(dragId));

    const target = ordered.findIndex(item => String(item.id) === String(targetId));

    if(from < 0 || target < 0 || String(dragId) === String(targetId)) return;

    const previousOrder = canvases.slice();

    const [dragged] = ordered.splice(from, 1);

    let insertion = target;

    if(from < target) insertion -= 1;

    if(placeAfter) insertion += 1;

    ordered.splice(Math.max(0, Math.min(ordered.length, insertion)), 0, dragged);

    replaceVisibleCanvasOrder(ordered.map(item => item.id));

    renderBoard();

    persistCanvasOrder(previousOrder);

}

/* ===== Card drag vs click ===== */

function attachCardDrag(card, c){

    card.addEventListener('pointerdown', event => {

        if(event.pointerType === 'mouse' && event.button !== 0) return;

        const targetEl = event.target instanceof Element ? event.target : null;

        if(targetEl?.closest('button,input,.ws-card-delete-confirm,.ws-card-title-input')) return;

        if(canvasSortMode !== 'manual' || canvasSearchQuery.trim()) return;

        const pointerId = event.pointerId;

        const startX = event.clientX;

        const startY = event.clientY;

        const threshold = 5;

        function removePendingListeners(){

            document.removeEventListener('pointermove', onMove);

            document.removeEventListener('pointerup', onEnd);

            document.removeEventListener('pointercancel', onEnd);

        }

        function onMove(e){

            if(e.pointerId !== pointerId) return;

            const dx = e.clientX - startX;

            const dy = e.clientY - startY;

            if(Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;

            removePendingListeners();

            e.preventDefault();

            startCardDrag(card, c, e);

        }

        function onEnd(e){

            if(e.pointerId !== pointerId) return;

            removePendingListeners();

        }

        document.addEventListener('pointermove', onMove, { passive:false });

        document.addEventListener('pointerup', onEnd);

        document.addEventListener('pointercancel', onEnd);

    });

    card.addEventListener('dragstart', event => event.preventDefault());

    card.addEventListener('dblclick', e => {

        const targetEl = e.target instanceof Element ? e.target : null;

        if(targetEl?.closest('.ws-card-title-input,.ws-card-menu,.ws-card-delete-confirm,button,input')) return;

        openCanvas(c);

    });

}

/* ===== Custom drag system (Pointer Events) ===== */

function startCardDrag(card, c, event){

    const rect = card.getBoundingClientRect();

    const ghost = card.cloneNode(true);

    ghost.style.cssText = 'position:fixed;left:0;top:0;width:' + rect.width + 'px;height:' + rect.height + 'px;z-index:1000;pointer-events:none;opacity:0.92;transform:translate(' + Math.round(rect.left) + 'px,' + Math.round(rect.top) + 'px) scale(0.96) rotate(-1.5deg);border-radius:16px;box-shadow:0 24px 64px rgba(0,0,0,.48);transition:transform .03s linear;';
    ghost.classList.remove('dragging');
    ghost.classList.add('ws-card-drag-ghost');

    document.body.appendChild(ghost);

    const placeholder = document.createElement('div');

    placeholder.className = 'ws-card-drag-placeholder';

    placeholder.style.height = Math.round(rect.height) + 'px';

    placeholder.setAttribute('aria-hidden', 'true');

    card.parentNode.insertBefore(placeholder, card);
    card.classList.add('dragging');
    card.remove();
    document.body.classList.add('home-reordering');

    cardDragState = {
        cardId: c.id, cardEl: card, ghostEl: ghost, placeholderEl: placeholder,
        offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top,
        origOrder: canvases.slice(), targetCard: null, placeAfter: false,
        dropRow: null, scrollTimer: null, scrollDirection: 0,
        targetFrame: 0, pendingTarget: null, lastRowIndex: null,
        pointerId: event.pointerId,
        lastPointer: { x: event.clientX, y: event.clientY },
    };


    document.addEventListener('pointermove', onCardDragMove);

    document.addEventListener('pointerup', onCardDragEnd);

    document.addEventListener('pointercancel', onCardDragEnd);

    document.addEventListener('keydown', onCardDragKeydown);

}

function onCardDragMove(event){

    const s = cardDragState;

    if(!s || event.pointerId !== s.pointerId) return;

    s.lastPointer = { x: event.clientX, y: event.clientY };

    s.ghostEl.style.transform = 'translate(' + Math.round(event.clientX - s.offsetX) + 'px,' + Math.round(event.clientY - s.offsetY) + 'px) scale(0.96) rotate(-1.5deg)';
    handleDragScroll(event);

    const targetEl = event.target instanceof Element ? event.target : null;

    const projectRow = targetEl?.closest('.ws-project-row');

    const prevDropRow = s.dropRow;

    s.dropRow = null;

    if(projectRow){

        const pid = projectRow.dataset.projectId;

        if(pid && pid !== currentProjectId){

            s.dropRow = pid;

            projectRow.classList.add('drag-over');

        }

    }

    if(prevDropRow && prevDropRow !== s.dropRow){

        document.querySelectorAll('.ws-project-row.drag-over').forEach(el => el.classList.remove('drag-over'));

    }

    scheduleCardDragTargetUpdate(event.clientX, event.clientY);
}

function scheduleCardDragTargetUpdate(clientX, clientY){
    const s = cardDragState;
    if(!s) return;
    s.pendingTarget = { x: clientX, y: clientY };
    if(s.targetFrame) return;
    s.targetFrame = requestAnimationFrame(() => {
        const current = cardDragState;
        if(!current || current !== s) return;
        s.targetFrame = 0;
        const target = s.pendingTarget;
        if(target) updateCardDragTarget(target.x, target.y);
    });
}

function cardDragRows(cards){
    const measured = cards.map(el => ({ el, rect: el.getBoundingClientRect() }))
        .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
    const rows = [];
    measured.forEach(item => {

        const row = rows[rows.length - 1];

        const tolerance = Math.max(12, Math.min(32, item.rect.height * 0.18));

        if(!row || Math.abs(item.rect.top - row.top) > tolerance){

            rows.push({ top: item.rect.top, bottom: item.rect.bottom, items: [item] });

            return;

        }

        row.bottom = Math.max(row.bottom, item.rect.bottom);

        row.items.push(item);

    });

    rows.forEach(row => row.items.sort((a, b) => a.rect.left - b.rect.left));

    return rows;

}

function findCardDragTarget(clientX, clientY, previousRowIndex, previousTargetCard, previousPlaceAfter){
    const worldRect = boardWorld.getBoundingClientRect();

    const cards = Array.from(boardWorld.querySelectorAll('.ws-card[data-canvas-id]'));

    const rows = cardDragRows(cards);

    if(!rows.length) return null;

    const firstRow = rows[0];

    const lastRow = rows[rows.length - 1];

    const horizontalPadding = 24;

    const verticalPadding = 24;

    const endZone = 80;

    if(clientX < worldRect.left - horizontalPadding || clientX > worldRect.right + horizontalPadding

        || clientY < firstRow.top - verticalPadding || clientY > lastRow.bottom + endZone){

        return null;

    }
    if(clientY > lastRow.bottom + verticalPadding){
        return { targetCard: lastRow.items[lastRow.items.length - 1].el, placeAfter: true, rowIndex: rows.length - 1 };
    }

    let rowIndex = 0;
    for(let index = 0; index < rows.length - 1; index++){
        const nextCenter = (rows[index + 1].top + rows[index + 1].bottom) / 2;
        // Switch rows at the target row center, not at the midpoint between rows.
        const boundary = nextCenter;
        if(clientY >= boundary + 8){
            rowIndex = index + 1;
            continue;
        }
        if(clientY <= boundary - 8){
            rowIndex = index;
            break;
        }
        rowIndex = (previousRowIndex === index || previousRowIndex === index + 1)
            ? previousRowIndex
            : (clientY < boundary ? index : index + 1);
        if(rowIndex === index) break;
    }

    const row = rows[rowIndex];
    const beforeItem = row.items.find(item => clientX < item.rect.left + item.rect.width / 2);
    let targetCard = beforeItem ? beforeItem.el : row.items[row.items.length - 1].el;
    let placeAfter = !beforeItem;

    if(previousTargetCard && previousTargetCard === targetCard && previousPlaceAfter !== placeAfter){
        const rect = previousTargetCard.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        if(placeAfter && clientX < centerX + 8){
            placeAfter = false;
        } else if(!placeAfter && clientX > centerX - 8){
            placeAfter = true;
        }
    }
    return { targetCard, placeAfter, rowIndex };
}

function animateCardReflow(beforeRects){
    if(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    boardWorld.querySelectorAll('.ws-card[data-canvas-id]').forEach(card => {
        const before = beforeRects.get(card);
        if(!before) return;
        card.getAnimations().forEach(animation => animation.cancel());
        const after = card.getBoundingClientRect();
        const dx = before.left - after.left;
        const dy = before.top - after.top;
        if(Math.abs(dx) < 1 && Math.abs(dy) < 1) return;

        card.animate([

            { transform: `translate(${Math.round(dx)}px, ${Math.round(dy)}px)` },
            { transform: 'translate(0, 0)' }
        ], { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
    });
}

function updateCardDragTarget(clientX, clientY){
    const s = cardDragState;
    if(!s || canvasSortMode !== 'manual' || canvasSearchQuery.trim()) return;
    const target = findCardDragTarget(clientX, clientY, s.lastRowIndex, s.targetCard, s.placeAfter);
    const targetCard = target?.targetCard || null;
    const placeAfter = !!target?.placeAfter;
    if(target?.rowIndex != null) s.lastRowIndex = target.rowIndex;
    const targetChanged = s.targetCard !== targetCard;
    const directionChanged = s.placeAfter !== placeAfter;


    if(s.targetCard && (targetChanged || directionChanged)){

        s.targetCard.classList.remove('drop-before', 'drop-after');

    }

    if(!targetCard){

        s.targetCard = null;

        s.placeAfter = false;

        return;

    }

    if(targetChanged || directionChanged){
        const beforeRects = new Map(
            Array.from(boardWorld.querySelectorAll('.ws-card[data-canvas-id]'))
                .map(card => [card, card.getBoundingClientRect()])
        );
        targetCard.classList.add(placeAfter ? 'drop-after' : 'drop-before');

        if(placeAfter) targetCard.after(s.placeholderEl);

        else targetCard.before(s.placeholderEl);

        animateCardReflow(beforeRects);

    }

    s.targetCard = targetCard;

    s.placeAfter = placeAfter;

}

function onCardDragEnd(event){

    const s = cardDragState;

    if(!s || event.pointerId !== s.pointerId) return;

    if(event.type === 'pointercancel'){

        cancelCardDrag();

        return;

    }

    const targetId = s.targetCard ? s.targetCard.dataset.canvasId : null;

    const placeAfter = s.placeAfter;

    const dropPid = (() => {

        const targetEl = event.target instanceof Element ? event.target : null;

        const row = targetEl?.closest('.ws-project-row');

        if(row){

            const pid = row.dataset.projectId;

            if(pid && pid !== currentProjectId) return pid;

        }

        return null;

    })();

    cleanupCardDrag();

    if(dropPid){

        moveCanvasToProject(s.cardId, dropPid);

        return;

    }

    if(targetId && String(targetId) !== String(s.cardId)){

        reorderVisibleCanvas(s.cardId, targetId, placeAfter);

        return;

    }

    canvases = s.origOrder;

    renderBoard();

}

function onCardDragKeydown(event){

    if(event.key === 'Escape' && cardDragState){

        event.preventDefault();

        cancelCardDrag();

    }

}

function cancelCardDrag(){

    const s = cardDragState;

    if(!s) return;

    cleanupCardDrag();

    canvases = s.origOrder;

    renderBoard();

}

function cleanupCardDrag(){

    const s = cardDragState;

    if(!s) return;

    if(s.ghostEl && s.ghostEl.parentNode) s.ghostEl.parentNode.removeChild(s.ghostEl);

    if(s.placeholderEl && s.placeholderEl.parentNode) s.placeholderEl.parentNode.removeChild(s.placeholderEl);

    if(s.cardEl) s.cardEl.classList.remove('dragging');

    if(s.targetCard) s.targetCard.classList.remove('drop-before', 'drop-after');
    document.querySelectorAll('.ws-project-row.drag-over').forEach(el => el.classList.remove('drag-over'));
    if(s.scrollTimer){ clearInterval(s.scrollTimer); s.scrollTimer = null; }
    if(s.targetFrame){ cancelAnimationFrame(s.targetFrame); s.targetFrame = 0; }
    s.pendingTarget = null;
    document.removeEventListener('pointermove', onCardDragMove);
    document.removeEventListener('pointerup', onCardDragEnd);
    document.removeEventListener('pointercancel', onCardDragEnd);
    document.removeEventListener('keydown', onCardDragKeydown);
    document.body.classList.remove('home-reordering');
    cardDragState = null;
}


function handleDragScroll(event){

    const s = cardDragState;

    if(!s) return;

    const boardEl = document.getElementById('board');
    if(!boardEl) return;

    const rect = boardEl.getBoundingClientRect();

    const edge = 40;

    let scrollDir = 0;

    if(event.clientY - rect.top < edge) scrollDir = -1;

    else if(rect.bottom - event.clientY < edge) scrollDir = 1;

    else if(event.clientX - rect.left < edge) scrollDir = -2;

    else if(rect.right - event.clientX < edge) scrollDir = 2;

    if(scrollDir !== s.scrollDirection && s.scrollTimer){

        clearInterval(s.scrollTimer);

        s.scrollTimer = null;

    }

    s.scrollDirection = scrollDir;

    if(scrollDir && !s.scrollTimer){

        s.scrollTimer = setInterval(() => {

            const b = document.getElementById('board');

            if(!b) return;

            const speed = 12;

            if(s.scrollDirection === -1) b.scrollTop -= speed;

            else if(s.scrollDirection === 1) b.scrollTop += speed;

            else if(s.scrollDirection === -2) b.scrollLeft -= speed;
            else if(s.scrollDirection === 2) b.scrollLeft += speed;
            if(s.lastPointer) scheduleCardDragTargetUpdate(s.lastPointer.x, s.lastPointer.y);
        }, 16);
    } else if(!scrollDir && s.scrollTimer){

        clearInterval(s.scrollTimer);

        s.scrollTimer = null;

    }

}

function openCanvas(c){

    const enc = encodeURIComponent(c.id);

    const project = encodeURIComponent(c.project || currentProjectId || 'default');

    rememberProjectId(c.project || currentProjectId || 'default');

    rememberLastCanvas(c);

    window.location.href = `/static/smart-canvas.html?id=${enc}&project=${project}&v=2026.08.09.1786289706002`;

}

/* ===== Card create flow ===== */

let createCardEl = null;

function closeCreateCard(){

    createCardEl?.remove();

    createCardEl = null;

    const trigger = boardWorld.querySelector('.ws-new-canvas-card');

    if(trigger) trigger.hidden = false;

}

function openCreateCard(worldPt){

    closeCreateCard();

    closeCardMenu();

    const el = canvasListView.createNewCanvasForm();

    const trigger = boardWorld.querySelector('.ws-new-canvas-card');

    if(trigger) trigger.hidden = true;

    boardWorld.appendChild(el);

    createCardEl = el;

    el.addEventListener('mousedown', e => e.stopPropagation());

    const input = el.querySelector('.ws-create-input');

    input.focus();

    const confirm = () => createCanvasOnBoard(input.value.trim(), worldPt);

    el.querySelector('.ws-create-confirm').onclick = confirm;

    el.querySelector('.ws-create-cancel').onclick = closeCreateCard;

    input.onkeydown = e => {

        e.stopPropagation();

        if(e.key === 'Enter'){ e.preventDefault(); confirm(); }

        if(e.key === 'Escape'){ e.preventDefault(); closeCreateCard(); }

    };

}

async function createCanvasOnBoard(title, worldPt){

    const base = L('智能画布','Smart canvas');

    const name = title || `${base} ${new Date().toLocaleTimeString(langIsEn() ? 'en-US' : 'zh-CN', { hour: '2-digit', minute: '2-digit' })}`;

    closeCreateCard();

    try {

        const res = await fetch('/api/canvases', {

            method: 'POST',

            headers: { 'Content-Type': 'application/json' },

            body: JSON.stringify({

                title: name,

                icon: 'sparkles',

                kind: 'smart',

                project: currentProjectId,

                board_x: Math.round(worldPt.x),

                board_y: Math.round(worldPt.y)

            })

        });

        if(!res.ok) throw new Error('create canvas failed');

        const data = await res.json();

        const nc = data.canvas;

        if(nc){

            if(nc.project == null) nc.project = currentProjectId;

            if(nc.board_x == null) nc.board_x = Math.round(worldPt.x);

            if(nc.board_y == null) nc.board_y = Math.round(worldPt.y);

            canvases.push(nc);

            renderBoard();

            renderProjects();

        }

    } catch(e){ console.error(e); setStatus(L('创建失败','Create failed')); }

}

/* ===== Card context menu (rename / delete / move) ===== */

function closeCardMenu(){ document.querySelector('.ws-card-pop')?.remove(); }

function openCardMenu(canvasId, anchorBtn){

    closeCardMenu();

    const c = canvases.find(x => x.id === canvasId);

    if(!c) return;

    const pop = canvasListView.createCardMenu();
    document.body.appendChild(pop);

    const r = anchorBtn.getBoundingClientRect();

    const w = pop.offsetWidth || 188, h = pop.offsetHeight || 120;

    let left = Math.min(r.left, window.innerWidth - w - 12);

    let top = r.bottom + 6;

    if(top + h > window.innerHeight - 12) top = r.top - h - 6;

    pop.style.left = Math.round(Math.max(12, left)) + 'px';

    pop.style.top = Math.round(Math.max(12, top)) + 'px';

    pop.querySelector('[data-act="rename"]').onclick = () => { closeCardMenu(); startCardRename(canvasId); };
    pop.querySelector('[data-act="export"]').onclick = () => { closeCardMenu(); exportCanvas(canvasId); };
    pop.querySelector('[data-act="export-assets"]').onclick = () => { closeCardMenu(); exportCanvasWithResources(canvasId); };
    pop.querySelector('[data-act="delete"]').onclick = () => { closeCardMenu(); showCardDeleteConfirm(canvasId); };
    refreshIcons(pop);

}

function showCardDeleteConfirm(canvasId){

    const card = boardWorld.querySelector(`.ws-card[data-canvas-id="${CSS.escape(canvasId)}"]`);

    if(!card) return;

    boardWorld.querySelectorAll('.ws-card.confirming-delete').forEach(el => {

        if(el !== card) el.classList.remove('confirming-delete');

    });

    card.classList.add('confirming-delete');

}

/* ===== Export canvas (download the full canvas JSON) ===== */

async function exportCanvas(id){

    const c = canvases.find(x => x.id === id);

    setStatus(L('正在导出...','Exporting...'));

    try {

        const res = await fetch(`/api/canvases/${encodeURIComponent(id)}`);

        if(!res.ok) throw new Error('export failed');

        const data = await res.json();

        const cv = data.canvas || data;

        const base = String((c?.title) || cv.title || 'canvas').replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 60) || 'canvas';

        const blob = new Blob([JSON.stringify(cv, null, 2)], { type: 'application/json' });

        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');

        a.href = url; a.download = base + '.json';

        document.body.appendChild(a); a.click(); a.remove();

        setTimeout(() => URL.revokeObjectURL(url), 1500);

        setStatus(L('已导出','Exported'));

    } catch(e){ console.error(e); setStatus(L('导出失败','Export failed')); }

}

/* ===== Export canvas with referenced resources (ZIP helpers in zip-utils.js) ===== */

async function exportCanvasWithResources(id){

    const c = canvases.find(x => x.id === id);

    setStatus(L('正在收集资源...','Collecting assets...'));

    try {

        const res = await fetch(`/api/canvases/${encodeURIComponent(id)}`);

        if(!res.ok) throw new Error('export failed');

        const data = await res.json();

        const cv = data.canvas || data;

        const Z = SmartCanvasZipUtils;

        const base = Z.safeExportBase((c?.title) || cv.title || 'canvas');

        const urls = Z.collectCanvasResourceUrls(cv).slice(0, 1000);

        const usedNames = new Set(['canvas.json', 'resources-manifest.json']);

        const TE = new TextEncoder();

        const entries = [{ name:'canvas.json', bytes:TE.encode(JSON.stringify(cv, null, 2)) }];

        const manifest = [];

        let skipped = 0;

        for(let i = 0; i < urls.length; i++){

            const url = urls[i];

            try {

                const bytes = await Z.fetchResourceBytes(url);

                const name = Z.exportResourceName(url, i, usedNames);

                entries.push({ name, bytes });

                manifest.push({ url, file:name, size:bytes.length });

            } catch(e) {

                skipped++;

                manifest.push({ url, skipped:true, reason:String(e?.message || e || 'fetch failed').slice(0, 120) });

            }

        }

        entries.push({ name:'resources-manifest.json', bytes:TE.encode(JSON.stringify({ canvas_id:id, resources:manifest }, null, 2)) });

        const blob = Z.createZipBlob(entries);

        const href = URL.createObjectURL(blob);

        const a = document.createElement('a');

        a.href = href;

        a.download = `${base}.zip`;

        document.body.appendChild(a); a.click(); a.remove();

        setTimeout(() => URL.revokeObjectURL(href), 1500);

        const included = Math.max(0, entries.length - 2);

        setStatus(skipped

            ? L(`已导出，跳过 ${skipped} 个资源`, `Exported, skipped ${skipped} assets`)

            : L(`已导出 ${included} 个资源`, `Exported ${included} assets`));

    } catch(e){ console.error(e); setStatus(L('导出失败','Export failed')); }

}

/* ===== Cut / paste a canvas across projects ===== */


function updatePasteBtn(){

    if(!pasteCanvasBtn) return;

    const show = !!clipboardCanvasId && canvases.some(x => x.id === clipboardCanvasId);

    pasteCanvasBtn.style.display = show ? 'inline-flex' : 'none';

}

async function pasteCanvas(){

    if(!clipboardCanvasId) return;

    const c = canvases.find(x => x.id === clipboardCanvasId);

    const targetPid = currentProjectId;

    clipboardCanvasId = null;

    if(!c){ updatePasteBtn(); renderBoard(); return; }

    if((c.project || 'default') === targetPid){ renderBoard(); setStatus(L('已在当前项目','Already in this project')); return; }

    await moveCanvasToProject(c.id, targetPid);

}

function startCardRename(canvasId){

    const card = boardWorld.querySelector(`.ws-card[data-canvas-id="${CSS.escape(canvasId)}"]`);

    const c = canvases.find(x => x.id === canvasId);

    if(!card || !c) return;

    const titleEl = card.querySelector('.ws-card-title');

    if(!titleEl || titleEl.querySelector('input')) return;

    const input = canvasListView.createCanvasTitleInput(c);

    titleEl.innerHTML = ''; titleEl.appendChild(input);

    input.onmousedown = e => e.stopPropagation();

    input.onclick = e => e.stopPropagation();

    input.focus(); input.select();

    let done = false;

    const finish = commit => {

        if(done) return; done = true;

        const v = input.value.trim();

        if(commit && v && v !== c.title) setCanvasTitle(canvasId, v);

        else renderBoard();

    };

    input.onblur = () => finish(true);

    input.onkeydown = e => {

        e.stopPropagation();

        if(e.key === 'Enter'){ e.preventDefault(); finish(true); }

        if(e.key === 'Escape'){ e.preventDefault(); finish(false); }

    };

}

async function setCanvasTitle(id, title){

    const c = canvases.find(x => x.id === id);

    if(c) c.title = title;

    renderBoard();

    await persistMeta(id, { title });

}

async function moveCanvasToProject(id, projectId){

    const c = canvases.find(x => x.id === id);

    if(!c) return;

    const previousOrder = canvases.slice();

    const previousCanvas = { ...c };

    c.project = projectId;

    canvases = canvases.filter(item => item !== c);

    canvases.push(c);

    renderBoard();

    renderProjects();

    const saved = await persistMeta(id, { project: projectId });

    if(!saved){

        Object.assign(c, previousCanvas);

        canvases = previousOrder;

        renderBoard();

        renderProjects();

        return;

    }

    setStatus(L('已移动到项目末尾','Moved to project end'));

}

/* ===== Card meta persist (POST /meta) ===== */

async function persistMeta(id, patch){

    try {

        const res = await fetch(`/api/canvases/${encodeURIComponent(id)}/meta`, {

            method: 'POST',

            headers: { 'Content-Type': 'application/json' },

            body: JSON.stringify(patch)

        });

        if(!res.ok) throw new Error('meta save failed');

        const data = await res.json();

        if(data.canvas){

            const idx = canvases.findIndex(x => x.id === id);

            if(idx >= 0) canvases[idx] = { ...canvases[idx], ...data.canvas };

            return data.canvas;

        }

        return null;

    } catch(e){

        console.error(e);

        setStatus(L('保存失败','Save failed'));

        return null;

    }

}

/* ===== Delete canvas (soft -> trash, with confirm) ===== */

async function deleteCanvas(id){

    const c = canvases.find(x => x.id === id);

    if(!c) return;

    try {

        const res = await fetch(`/api/canvases/${encodeURIComponent(id)}`, { method: 'DELETE' });

        if(!res.ok) throw new Error('delete failed');

        canvases = canvases.filter(x => x.id !== id);

        renderBoard();

        renderProjects();

        refreshTrashCount();

        setStatus(L('已移入回收站','Moved to trash'));

    } catch(e){ console.error(e); setStatus(L('删除失败','Delete failed')); }

}

/* ===== Trash / recycle bin ===== */

async function refreshTrashCount(){

    try {

        const res = await fetch('/api/canvases/trash');

        if(!res.ok) return;

        const data = await res.json();

        deletedCanvases = (data.canvases || []).filter(c => c.kind === 'smart');

        const n = deletedCanvases.length;

        trashBadge.textContent = String(n);

        trashBadge.classList.toggle('visible', n > 0);

    } catch(e){}

}

async function openTrashView(){

    trashEntryBtn.classList.add('active');

    trashPanel.classList.add('active');

    closeCardMenu(); closeCreateCard();

    await loadTrash();

}

function closeTrashView(){

    trashEntryBtn.classList.remove('active');

    trashPanel.classList.remove('active');

}

async function loadTrash(){

    try {

        const res = await fetch('/api/canvases/trash');

        if(!res.ok) throw new Error('trash load failed');

        const data = await res.json();

        deletedCanvases = (data.canvases || []).filter(c => c.kind === 'smart');

        renderTrash();

        const n = deletedCanvases.length;

        trashBadge.textContent = String(n);

        trashBadge.classList.toggle('visible', n > 0);

    } catch(e){ console.error(e); setStatus(L('加载回收站失败','Load trash failed')); }

}

function renderTrash(){

    trashListEl.innerHTML = '';

    if(!deletedCanvases.length){

        trashListEl.appendChild(canvasListView.createTrashEmptyState());

        return;

    }

    deletedCanvases.forEach(c => {

        const projectName = (projects.find(p => p.id === (c.project || 'default')) || {}).name || L('默认项目','Default');

        const card = canvasListView.createTrashCard(c, {projectName});

        card.querySelector('.ws-trash-act.restore').onclick = () => restoreCanvas(c.id);

        card.querySelector('.ws-trash-act.purge').onclick = () => card.classList.add('confirming');

        card.querySelector('.ws-trash-confirm-yes').onclick = () => purgeCanvas(c.id);

        card.querySelector('.ws-trash-confirm-no').onclick = () => card.classList.remove('confirming');

        trashListEl.appendChild(card);

    });

    refreshIcons(trashListEl);

}
async function restoreCanvas(id){

    try {

        const res = await fetch(`/api/canvases/${encodeURIComponent(id)}/restore`, { method: 'POST' });

        if(!res.ok) throw new Error('restore failed');

        deletedCanvases = deletedCanvases.filter(c => c.id !== id);

        await loadAll();           // restored canvas returns to its stored project

        renderTrash();

        setStatus(L('已恢复','Restored'));

    } catch(e){ console.error(e); setStatus(L('恢复失败','Restore failed')); }

}

async function purgeCanvas(id){

    try {

        const res = await fetch(`/api/canvases/${encodeURIComponent(id)}/purge`, { method: 'DELETE' });

        if(!res.ok) throw new Error('purge failed');

        deletedCanvases = deletedCanvases.filter(c => c.id !== id);

        renderTrash();

        const n = deletedCanvases.length;

        trashBadge.textContent = String(n);

        trashBadge.classList.toggle('visible', n > 0);

        setStatus(L('已彻底删除','Deleted'));

    } catch(e){ console.error(e); setStatus(L('删除失败','Delete failed')); }

}

/* ===== Event bindings ===== */

board?.addEventListener('click', event => {

    if(event.target === board || event.target === boardWorld) clearCanvasCardSelection();

});

pasteCanvasBtn?.addEventListener('click', pasteCanvas);

homeNewCanvasBtn?.addEventListener('click', () => openCreateCard(boardCenterWorld()));

homeImportCanvasBtn?.addEventListener('click', () => canvasImportInput?.click());

canvasSearchInput?.addEventListener('input', event => {

    canvasSearchQuery = event.target.value || '';

    renderBoard();

});

canvasSortSelect?.addEventListener('change', event => {

    canvasSortMode = event.target.value || 'manual';

    syncCanvasSortMenu();

    closeCanvasSortMenu();

    renderBoard();

});

canvasSortButton?.addEventListener('click', () => {

    if(canvasSortMenu?.hidden) openCanvasSortMenu();

    else closeCanvasSortMenu({restoreFocus:true});

});

canvasSortOptions.forEach(option => {

    option.addEventListener('click', () => selectCanvasSort(option.dataset.sortValue));

    option.addEventListener('keydown', event => {

        if(event.key === 'ArrowDown'){ event.preventDefault(); moveCanvasSortFocus(1); }

        else if(event.key === 'ArrowUp'){ event.preventDefault(); moveCanvasSortFocus(-1); }

        else if(event.key === 'Home'){ event.preventDefault(); canvasSortOptions[0]?.focus({preventScroll:true}); }

        else if(event.key === 'End'){ event.preventDefault(); canvasSortOptions.at(-1)?.focus({preventScroll:true}); }

        else if(event.key === 'Enter' || event.key === ' '){ event.preventDefault(); selectCanvasSort(option.dataset.sortValue); }

        else if(event.key === 'Escape'){ event.preventDefault(); event.stopPropagation(); closeCanvasSortMenu({restoreFocus:true}); }

    });

});

canvasSortButton?.addEventListener('keydown', event => {

    if(event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' '){ event.preventDefault(); openCanvasSortMenu(); }

    else if(event.key === 'Escape'){ event.preventDefault(); event.stopPropagation(); closeCanvasSortMenu({restoreFocus:true}); }

});

newProjectBtn.addEventListener('click', openNewProject);

newProjectConfirm.addEventListener('click', createProject);

newProjectCancel.addEventListener('click', closeNewProject);

newProjectInput.addEventListener('keydown', e => {

    if(e.key === 'Enter'){ e.preventDefault(); createProject(); }

    if(e.key === 'Escape'){ e.preventDefault(); closeNewProject(); }

});

trashEntryBtn.addEventListener('click', () => {

    if(trashPanel.classList.contains('active')) closeTrashView();

    else openTrashView();

});

trashCloseBtn.addEventListener('click', closeTrashView);

// close card menu when clicking outside

document.addEventListener('mousedown', e => {

    if(document.querySelector('.ws-card-pop') && !e.target.closest('.ws-card-pop') && !e.target.closest('.ws-card-menu')){

        closeCardMenu();

    }

    if(canvasSortMenu && !canvasSortMenu.hidden && !e.target.closest('#canvasSortControl')){

        closeCanvasSortMenu();

    }

    if(document.querySelector('.ws-card.confirming-delete') && !e.target.closest('.ws-card.confirming-delete')){

        boardWorld.querySelectorAll('.ws-card.confirming-delete').forEach(el => el.classList.remove('confirming-delete'));

    }

});

document.addEventListener('keydown', e => {

    if(canvasListApiSettingsModal?.classList.contains('open')){

        const isSettingsToggle = (e.code === 'Digit4' || e.code === 'KeyZ')
            && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
        if(e.key === 'Escape' || (isSettingsToggle && (e.code !== 'KeyZ' || !isCanvasListShortcutBlocked(e.target)))){

            e.preventDefault();

            e.stopPropagation();

            closeCanvasListSettings();

        }

        return;

    }

    if(e.code === 'Digit4' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !isCanvasListShortcutBlocked(e.target)){

        e.preventDefault();

        e.stopPropagation();

        openCanvasListSettings();

        return;

    }

    if(e.code === 'KeyZ' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !isCanvasListShortcutBlocked(e.target)){

        e.preventDefault();

        e.stopPropagation();

        if(canvasListApiSettingsModal?.classList.contains('open')) closeCanvasListSettings();
        else openCanvasListSettings();

        return;

    }

    if(e.code === 'KeyB' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !isCanvasListShortcutBlocked(e.target)){

        const recent = lastOpenedCanvas();

        if(!recent) return;

        e.preventDefault();

        e.stopPropagation();

        openCanvas(recent);

        return;

    }

    if(e.key !== 'Escape') return;

    if(canvasSortMenu && !canvasSortMenu.hidden){

        e.preventDefault();

        closeCanvasSortMenu({restoreFocus:true});

        return;

    }

    closeCardMenu();

    closeCreateCard();

    boardWorld.querySelectorAll('.ws-card.confirming-delete').forEach(el => el.classList.remove('confirming-delete'));

    if(trashPanel.classList.contains('active')) closeTrashView();

});

canvasImportInput?.addEventListener('change', event => importCanvasArchive(event.target.files?.[0]));

// language switch from parent (index.html) via postMessage

window.addEventListener('message', event => {

    if(event.origin && event.origin !== location.origin) return;

    if(event.data?.type === 'api-settings-close'){

        closeCanvasListSettings();

        return;

    }

    if(event.data?.type === 'providers-changed'){

        if(canvasListApiSettingsModal?.classList.contains('open')) showCanvasListApiSettingsStatus('已保存');

        return;

    }

    if(event.data?.type === 'studio-lang'){

        if(event.data.lang && window.StudioI18n) StudioI18n.set(event.data.lang);

        window.StudioI18n?.apply?.();

        renderProjects();

        renderBoard();

        if(trashPanel.classList.contains('active')) renderTrash();

        refreshIcons();

    }

});

/* ===== Boot ===== */

canvasListApiSettingsFrame?.addEventListener('load', syncCanvasListApiSettingsFrame);

canvasListApiSettingsClose?.addEventListener('click', closeCanvasListSettings);

canvasListApiSettingsModal?.addEventListener('mousedown', event => {

    if(event.target === canvasListApiSettingsModal) closeCanvasListSettings();

});

canvasSettingsLink?.addEventListener('click', event => {

    event.preventDefault();

    openCanvasListSettings();

});

window.StudioI18n?.apply?.();

/* A canvas handing off with ?settings=1 opens the settings surface directly. */
if(new URLSearchParams(window.location.search).get('settings') === '1'){
    openCanvasListSettings();
    const cleaned = new URL(window.location.href);
    cleaned.searchParams.delete('settings');
    window.history.replaceState({}, '', `${cleaned.pathname}${cleaned.search}${cleaned.hash}`);
}

boardWorld.addEventListener('click', event => {
    const card = event.target.closest('.ws-card[data-canvas-id]');
    if(!card) return;
    const canvasId = card.dataset.canvasId;

    if(event.target.closest('.ws-card-rename')){
        event.preventDefault();
        event.stopPropagation();
        startCardRename(canvasId);
        return;
    }

    if(event.target.closest('.ws-card-menu')){
        event.stopPropagation();
        openCardMenu(canvasId, card.querySelector('.ws-card-menu'));
        return;
    }

    if(event.target.closest('.ws-card-delete-yes')){
        event.stopPropagation();
        deleteCanvas(canvasId);
        return;
    }

    if(event.target.closest('.ws-card-delete-no')){
        event.stopPropagation();
        card.classList.remove('confirming-delete');
        return;
    }

    if(event.target.closest('button,input,.ws-card-delete-confirm')) return;

    selectCanvasCard(canvasId);
});

applyViewport();

loadAll();

refreshIcons();
