/**
 * Home-page static view factories.
 *
 * This classic-script module owns static DOM construction only. canvas-list.js
 * keeps list state, drag/drop, network calls, and business event bindings.
 */
(function () {
    'use strict';

    function coverPreviewSrc(url){
        const text = String(url || '');
        if(!text || text.startsWith('data:') || text.startsWith('blob:')) return text;
        if(!text.startsWith('/output/') && !text.startsWith('/assets/')) return text;
        if(!/\.(png|jpe?g|webp|gif|bmp|avif|tiff?|mp4|webm|mov|m4v|avi|mkv)(\?|#|$)/i.test(text)) return text;
        return `/api/media-preview?w=512&url=${encodeURIComponent(text)}`;
    }

    function create({escapeAttr, escapeHtml, tr, isEnglish}={}) {
        function formatTime(value) {
            if(!value) return '--';

            const raw = Number(value);
            const time = raw < 10000000000 ? raw * 1000 : raw;
            const date = new Date(time);

            if(Number.isNaN(date.getTime())) return '--';

            return date.toLocaleString(isEnglish() ? 'en-US' : 'zh-CN', {
                month:'2-digit',
                day:'2-digit',
                hour:'2-digit',
                minute:'2-digit'
            });
        }

        function renderIcon(icon, size=16) {
            if(!icon || icon === '🧩') return `<i data-lucide="layers" style="width:${size}px;height:${size}px"></i>`;
            if(/[^\x00-\x7F]/.test(icon)) return escapeHtml(icon);

            return `<i data-lucide="${escapeHtml(icon)}" style="width:${size}px;height:${size}px"></i>`;
        }

        function createNewCanvasCard() {
            const card = document.createElement('div');
            card.className = 'ws-new-canvas-card';
            card.innerHTML = `
                <button class="ws-new-canvas-create" type="button" data-av-interaction="top" data-av-pointer="off">
                    <span class="ws-new-canvas-icon"><i data-lucide="plus"></i></span>
                    <span class="ws-new-canvas-title">${tr('新建智能画布','New smart canvas')}</span>
                    <span class="ws-new-canvas-sub">${tr('从空白画布开始创作','Start with a blank canvas')}</span>
                </button>`;

            return card;
        }

        function createSearchEmptyState() {
            const state = document.createElement('div');
            state.className = 'ws-home-search-empty';
            state.innerHTML = `<i data-lucide="search-x"></i><strong>${tr('没有匹配的画布','No matching canvases')}</strong><span>${tr('换个关键词试试','Try another search term')}</span>`;

            return state;
        }

        function createProjectDeleteConfirm(project) {
            const box = document.createElement('div');
            box.className = 'ws-project-confirm';
            box.innerHTML = `
                <div class="ws-project-confirm-title">${tr('删除项目','Delete project')}「${escapeHtml(project.name)}」？${tr('其画布将移回默认项目。','Canvases move back to Default.')}</div>
                <div class="ws-project-confirm-actions">
                    <button class="ws-confirm-btn" type="button">${tr('删除','Delete')}</button>
                    <button class="ws-cancel-btn" type="button">${tr('取消','Cancel')}</button>
                </div>`;

            return box;
        }

        function createProjectRow(project, {active=false, count=0, isDefault=false}={}) {
            const row = document.createElement('button');
            row.className = `ws-project-row${active ? ' active' : ''}`;
            row.dataset.projectId = project.id;
            row.dataset.avInteraction = 'top';
            row.innerHTML = `
                <span class="ws-project-icon"><i data-lucide="${isDefault ? 'folder' : 'folder-open'}" class="w-4 h-4"></i></span>
                <span class="ws-project-name">${escapeHtml(project.name)}</span>
                <span class="ws-project-count">${count}</span>
                <span class="ws-project-actions">
                    <button class="ws-proj-act rename" type="button" title="${tr('重命名','Rename')}" aria-label="${tr('重命名','Rename')}"><i data-lucide="pencil" class="w-3.5 h-3.5"></i></button>
                    ${isDefault ? '' : `<button class="ws-proj-act del" type="button" title="${tr('删除','Delete')}" aria-label="${tr('删除','Delete')}"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>`}
                </span>`;

            return row;
        }

        function createTrashEmptyState() {
            const empty = document.createElement('div');
            empty.className = 'ws-trash-empty';
            empty.textContent = tr('回收站为空','Trash is empty');
            return empty;
        }

        function createTrashCard(canvas, {projectName}={}) {
            const card = document.createElement('div');
            card.className = 'ws-trash-card';
            card.dataset.canvasId = canvas.id;
            card.innerHTML = `
                <div class="ws-card-top">
                    <span class="ws-card-icon">${renderIcon(/[^\x00-\x7F]/.test(canvas.icon || '') ? 'sparkles' : canvas.icon, 17)}</span>
                    <span class="ws-card-kind smart">${tr('智能','Smart')}</span>
                </div>
                <div class="ws-card-title">${escapeHtml(canvas.title)}</div>
                <div class="ws-card-meta"><span class="ws-card-nodes">${escapeHtml(projectName)}</span><span class="ws-card-meta-dot"></span><span class="ws-card-time">${formatTime(canvas.deleted_at)}</span></div>
                <div class="ws-card-actions">
                    <button class="ws-trash-act restore" type="button"><i data-lucide="rotate-ccw" class="w-3.5 h-3.5"></i><span>${tr('恢复','Restore')}</span></button>
                    <button class="ws-trash-act purge" type="button"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i><span>${tr('彻底删除','Delete')}</span></button>
                </div>
                <div class="ws-trash-confirm">
                    <div class="ws-trash-confirm-title">${tr('彻底删除？不可恢复','Delete permanently?')}</div>
                    <div class="ws-trash-confirm-actions">
                        <button class="ws-trash-confirm-yes" type="button">${tr('删除','Delete')}</button>
                        <button class="ws-trash-confirm-no" type="button">${tr('取消','Cancel')}</button>
                    </div>
                </div>`;

            return card;
        }

        function createProjectRenameInput(project) {
            const input = document.createElement('input');
            input.type = 'text';
            input.maxLength = 60;
            input.value = project.name;
            input.className = 'ws-project-name-input';
            return input;
        }

        function createNewCanvasForm() {
            const form = document.createElement('div');
            form.className = 'ws-create-card launcher-create-card';
            form.innerHTML = `
                <div class="ws-create-title">${tr('新建智能画布','New smart canvas')}</div>
                <input class="ws-create-input" type="text" maxlength="80" placeholder="${tr('画布名称（可留空）','Canvas name (optional)')}">
                <div class="ws-create-actions">
                    <button class="ws-create-confirm" type="button">${tr('创建','Create')}</button>
                    <button class="ws-create-cancel" type="button">${tr('取消','Cancel')}</button>
                </div>`;

            return form;
        }

        function createCardMenu() {
            const menu = document.createElement('div');
            menu.className = 'ws-card-pop';
            menu.innerHTML = `
                <button class="ws-pop-item" data-act="rename"><i data-lucide="pencil" class="w-4 h-4"></i><span>${tr('重命名','Rename')}</span></button>
                <button class="ws-pop-item" data-act="export"><i data-lucide="download" class="w-4 h-4"></i><span>${tr('导出画布','Export canvas')}</span></button>
                <button class="ws-pop-item" data-act="export-assets"><i data-lucide="archive" class="w-4 h-4"></i><span>${tr('导出画布 + 资源','Export with assets')}</span></button>
                <div class="ws-pop-sep"></div>
                <button class="ws-pop-item danger" data-act="delete"><i data-lucide="trash-2" class="w-4 h-4"></i><span>${tr('删除','Delete')}</span></button>`;

            return menu;
        }

        function createCanvasTitleInput(canvas) {
            const input = document.createElement('input');
            input.type = 'text';
            input.maxLength = 80;
            input.value = canvas.title || '';
            input.className = 'ws-card-title-input';
            return input;
        }

        function createCanvasCard(canvas, {clipboardCanvasId, selectedCanvasId}={}) {
            const card = document.createElement('div');
            const selected = selectedCanvasId === String(canvas.id);

            card.className = 'ws-card'
                + (String(canvas.color || '').trim() ? ' cc-marked' : '')
                + (clipboardCanvasId === canvas.id ? ' cut' : '')
                + (selected ? ' selected' : '');
            card.dataset.canvasId = canvas.id;
            card.dataset.avInteraction = 'top';
            card.setAttribute('aria-selected', selected ? 'true' : 'false');

            const cover = canvas.cover_url
                ? `<img class="ws-card-cover-image" src="${escapeAttr(coverPreviewSrc(canvas.cover_url))}" alt="" loading="lazy" draggable="false">`
                : '<div class="ws-card-cover-empty"><i data-lucide="sparkles"></i></div>';

            card.innerHTML = `
                <div class="ws-card-cover">
                    ${cover}
                    <button class="ws-card-menu" type="button" title="${tr('更多','More')}" aria-label="${tr('更多','More')}"><i data-lucide="more-horizontal" class="w-4 h-4"></i></button>
                </div>
                <div class="ws-card-body">
                    <div class="ws-card-title-row">
                        <div class="ws-card-title">${escapeHtml(canvas.title)}</div>
                        <button class="ws-card-rename" type="button" title="${tr('重命名','Rename')}" aria-label="${tr('重命名','Rename')}"><i data-lucide="pencil" class="w-3.5 h-3.5"></i></button>
                    </div>
                    <div class="ws-card-meta">
                        <span class="ws-card-meta-default">
                            <span class="ws-card-nodes">${canvas.node_count != null ? canvas.node_count : 0} ${tr('节点','nodes')}</span>
                            <span class="ws-card-meta-dot"></span>
                            <span class="ws-card-time">${formatTime(canvas.updated_at || canvas.created_at)}</span>
                        </span>
                        <span class="ws-card-selection-hint"><i data-lucide="mouse-pointer-2"></i>${tr('已选中 · 双击打开','Selected · Double-click to open')}</span>
                    </div>
                </div>
                <div class="ws-card-delete-confirm">
                    <div class="ws-card-delete-title">${tr('移入回收站？','Move to trash?')}</div>
                    <div class="ws-card-delete-actions">
                        <button class="ws-card-delete-yes" type="button">${tr('删除','Delete')}</button>
                        <button class="ws-card-delete-no" type="button">${tr('取消','Cancel')}</button>
                    </div>
                </div>`;

            return card;
        }

        return Object.freeze({
            formatTime,
            renderIcon,
            createNewCanvasCard,
            createSearchEmptyState,
            createProjectDeleteConfirm,
            createProjectRow,
            createTrashEmptyState,
            createTrashCard,
            createProjectRenameInput,
            createNewCanvasForm,
            createCardMenu,
            createCanvasTitleInput,
            createCanvasCard
        });
    }

    window.SmartCanvasCanvasListView = Object.freeze({create});
}());
