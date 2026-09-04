/* Pure node presentation state. Rendering remains in the legacy editor for now;
 * this module only turns mutable node data + interaction state into a stable
 * view model, making the eventual renderer extraction incremental and safe. */
(function attachSmartCanvasNodeView(global){
    function describe(node, context={}){
        const images = Array.isArray(node?.images) ? node.images : [];
        const type = String(node?.type || 'smart-image');
        const isImageNode = type === 'smart-image' || !node?.type;
        const isChatNode = type === 'smart-chat';
        const isQueued = Boolean(node?.queued && images.length === 0 && !node?.pending);
        const isEmpty = isImageNode && images.length === 0 && !node?.pending && !isQueued;
        const isHistory = Boolean(isImageNode && (node?.isHistoryGroup || node?.historyFor));
        const isGroup = isImageNode && images.length > 1;
        const isPending = Boolean((node?.pending || isQueued) && images.length === 0);
        const title = isChatNode ? (node?.title || 'AI 对话') : (images.length > 1 ? 'Group' : images.length ? 'Image' : (context.emptyTitle || '导入素材'));
        const isSelected = Boolean(context.isSelected?.(node?.id));
        const isPrimary = Boolean(context.primaryId && context.primaryId === node?.id);
        const isDragging = Boolean(context.isDragging?.(node));
        const renderMode = context.renderMode?.(node) || 'full';
        const className = [
            'image-node',
            isChatNode ? 'smart-chat-node' : '',
            isEmpty ? 'empty-node' : '',
            isGroup ? 'group-node' : '',
            isHistory ? 'history-group-node' : '',
            isSelected ? 'selected' : '',
            isPrimary ? 'primary-selected' : '',
            isDragging ? 'dragging' : '',
            node?.running ? 'node-running' : '',
            isPending ? 'node-pending' : ''
        ].filter(Boolean).join(' ');
        return {node, type, images, title, isImageNode, isChatNode, isQueued, isEmpty, isHistory, isGroup, isPending, isSelected, isPrimary, isDragging, renderMode, className};
    }
    global.SmartCanvasNodeViewPrimitives = Object.freeze({describe});
})(window);
