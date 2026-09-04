(function(global){
    'use strict';

    function create(options={}){
        const cfg = options || {};
        const call = (name, fallback) => {
            const fn = cfg[name];
            return typeof fn === 'function' ? fn : fallback;
        };
        const escapeHtml = call('escapeHtml', value => String(value ?? ''));
        const escapeAttr = call('escapeAttr', escapeHtml);
        const tr = call('tr', key => key);
        const imageForDisplay = call('imageForDisplay', image => image);
        const selectedImage = call('getSelectedImage', () => ({nodeId:'', index:-1}));
        const maxVisibleRows = () => Math.max(1, Number(call('getMaxVisibleRows', () => 3)()) || 3);

        function render(node, layout={}){
            const imgs = (node?.images || []).map(imageForDisplay);
            const recoverTask = call('smartRecoverableImageTask', () => null)(node);
            if(recoverTask && imgs.length === 0){
                return call('imageTaskRecoverBodyHtml', () => '')(node, recoverTask, layout);
            }

            if(node?.queued && imgs.length === 0 && !node.pending){
                return `<div class="loading-cell single queued" style="width:${layout.width}px;height:${layout.height}px"></div>`;
            }

            if(node?.pending && imgs.length === 0){
                const count = Math.max(1, Number(node.pending) || 1);
                if(count <= 1){
                    return `<div class="loading-cell single" style="width:${layout.width}px;height:${layout.height}px"></div>`;
                }
                const cols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(count))));
                const rows = Math.ceil(count / cols);
                return `<div class="loading-skeleton" style="grid-template-columns:repeat(${cols}, 1fr);grid-template-rows:repeat(${rows}, 1fr);width:${layout.width}px;height:${layout.height}px;padding:8px;box-sizing:border-box">${Array.from({length:count}).map(() => '<div class="loading-cell"></div>').join('')}</div>`;
            }

            const selected = selectedImage() || {};
            if(imgs.length > 1 && call('shouldSimplifyMultiMedia', () => false)()){
                const img = imgs[0];
                return `<div class="image-wrap multi-media-summary" data-image-index="0" data-media-signature="${escapeAttr(`${call('mediaKindForItem', () => 'image')(img)}:${img?.url || ''}`)}" style="--node-img-w:${layout.width}px;--node-img-h:${layout.height}px">${call('multiMediaSummaryHtml', call('singleMediaHtml', () => ''))(img, layout.width, layout.height)}<span class="multi-media-count" aria-label="共 ${imgs.length} 条素材">${imgs.length}</span></div>`;
            }
            if(imgs.length > 1){
                const visibleCount = Math.min(imgs.length, Math.max(1, Number(layout.visibleCount || 5)));
                const visibleImgs = imgs.slice(0, visibleCount);
                return `<div class="thumb-grid single-row is-overlap is-photo-stack" data-thumb-scroll="1" style="--thumb-size:${layout.thumb}px; --thumb-overlap:0px">${visibleImgs.map((img, i) => `<div class="thumb-item ${selected.nodeId === node.id && selected.index === i ? 'image-selected' : ''}" data-image-index="${i}" data-media-signature="${escapeAttr(`${call('mediaKindForItem', () => 'image')(img)}:${img?.url || ''}`)}" style="--thumb-stack-order:${visibleImgs.length - i}">${call('thumbMediaHtml', () => '')(img)}</div>`).join('')}</div>`;
            }

            if(imgs[0]){
                const img = imgs[0];
                return `<div class="image-wrap has-outside-image-name ${selected.nodeId === node.id && selected.index === 0 ? 'image-selected' : ''}" data-image-index="0" data-media-signature="${escapeAttr(`${call('mediaKindForItem', () => 'image')(img)}:${img?.url || ''}`)}" style="--node-img-w:${layout.width}px;--node-img-h:${layout.height}px">${call('singleMediaHtml', () => '')(img, layout.width, layout.height)}${call('imageNameBadgeHtml', () => '')(img, {outside:true})}${call('imageResolutionBadgeHtml', () => '')(img)}</div>`;
            }

            return `<div class="node-upload-shell">
                <button class="node-drop" type="button" data-upload-action="files" title="选择图片、视频或音频" aria-label="选择图片、视频或音频">
                    <span class="upload-node-main"><i data-lucide="upload-cloud"></i></span>
                    <span class="upload-node-title">${escapeHtml(tr('smart.createImportNode'))}</span>
                    <span class="upload-node-sub">点击选择素材</span>
                </button>
                <span class="upload-node-drag-hint">也可拖拽或粘贴素材到节点</span>
            </div>`;
        }

        return Object.freeze({render});
    }

    global.SmartCanvasImageRenderer = Object.freeze({create});
})(window);
