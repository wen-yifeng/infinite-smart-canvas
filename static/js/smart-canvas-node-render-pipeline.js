(function(global){
    'use strict';

    function create(options={}){
        const {
            nodeRenderPrimitives = global.SmartCanvasNodeRenderPrimitives,
            nodeViewPrimitives = global.SmartCanvasNodeViewPrimitives,
        } = options;
        if(!nodeRenderPrimitives || typeof nodeRenderPrimitives.orderedNodes !== 'function' || typeof nodeRenderPrimitives.shellHtml !== 'function'){
            throw new Error('Smart Canvas node render primitives are required');
        }

        function buildEntries(nodes, context={}){
            const {
                shouldMount = () => true,
                emptyTitle = '',
                primaryId = '',
                isSelected = () => false,
                isDragging = () => false,
                renderMode = () => 'full',
                nodeScale = () => 1,
                imageLayout = () => ({width:0, height:0}),
                nodeBodyHtml = () => '',
                smartCompactNodeHtml = () => '',
                escapeHtml = value => String(value ?? ''),
                tr = key => key,
                runTimePillHtml = () => '',
                nodeMetaHtml = () => '',
            } = context;

            const ordered = nodeRenderPrimitives.orderedNodes(nodes, {shouldMount});
            return ordered.map(node => {
                const view = nodeViewPrimitives?.describe
                    ? nodeViewPrimitives.describe(node, {
                        emptyTitle,
                        primaryId,
                        isSelected,
                        isDragging,
                        renderMode,
                    })
                    : {
                        node,
                        images:node.images || [],
                        title:node.title || '',
                        isImageNode:node.type === 'smart-image' || !node.type,
                        isQueued:Boolean(node.queued && !(node.images || []).length && !node.pending),
                        isEmpty:false,
                        isHistory:false,
                        isGroup:false,
                        isPending:Boolean(node.pending),
                        renderMode:'full',
                        className:'image-node',
                    };
                const {images:imgs, title, isQueued, isEmpty, isGroup:groupNode, isPending, isChatNode, renderMode:mode} = view;
                const scale = nodeScale(node);
                const layout = imageLayout(imgs, scale, node);
                if(mode !== 'full') return {node, html:smartCompactNodeHtml(node, layout, mode, title, isPending)};
                const body = nodeBodyHtml(node, layout);
                const primaryImage = (imgs || []).find(item => item?.url);
                // Every non-group node containing one image can replace that image, including generated output.
                const replaceBtn = !isChatNode && !groupNode && primaryImage && imgs.length === 1
                    ? `<button class="mini-x image-overlay-control node-replace" type="button" data-smart-node-action="replace-input" data-node-id="${escapeHtml(node.id)}" title="替换图片" aria-label="替换图片"><i data-lucide="image-up"></i></button>`
                    : '';
                const downloadBtn = !isChatNode && !groupNode && primaryImage
                    ? `<button class="mini-x image-overlay-control node-download" type="button" data-smart-node-action="download" data-node-id="${escapeHtml(node.id)}" title="下载" aria-label="下载"><i data-lucide="download"></i></button>`
                    : '';
                const deleteBtn = groupNode ? '' : `${replaceBtn}${downloadBtn}<button class="mini-x image-overlay-control node-delete" type="button" title="${escapeHtml(tr('smart.deleteNode'))}" aria-label="${escapeHtml(tr('smart.deleteNode'))}"><i data-lucide="trash-2"></i></button>`;
                const hint = isChatNode ? '' : (isPending
                        ? escapeHtml(tr('smart.hintPending'))
                        : (imgs.length > 1 ? escapeHtml(tr('smart.hintMulti')) : imgs.length ? escapeHtml(tr('smart.hintSingle')) : escapeHtml(tr('smart.hintEmpty'))));
                const html = nodeRenderPrimitives.shellHtml({
                    node,
                    view,
                    layout,
                    title,
                    deleteBtn,
                    floatingActions:'',
                    toolbar:'',
                    runtime:runTimePillHtml(node),
                    body,
                    meta:nodeMetaHtml(node, view),
                    hint,
                    resizeHandle:isChatNode || imgs.length || node.pending || isQueued ? '<div class="node-resize-handle" data-resize="1"></div>' : '',
                    escapeHtml,
                });
                return {node, html};
            });
        }

        return Object.freeze({buildEntries});
    }

    global.SmartCanvasNodeRenderPipeline = Object.freeze({create});
})(window);
