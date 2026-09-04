(function(global){
    'use strict';

    function orderedNodes(nodes, options={}){
        const source = Array.isArray(nodes) ? nodes.filter(node => typeof options.shouldMount !== 'function' || options.shouldMount(node)) : [];
        return source.slice();
    }

    function shellHtml(options={}){
        const node = options.node || {};
        const view = options.view || {};
        const layout = options.layout || {};
        const esc = typeof options.escapeHtml === 'function' ? options.escapeHtml : value => String(value ?? '');
        const id = esc(node.id || '');
        const title = esc(options.title ?? view.title ?? node.title ?? '');
        const deleteBtn = options.deleteBtn || '';
        const floatingActions = options.floatingActions || '';
        const toolbar = options.toolbar || '';
        const runtime = options.runtime || '';
        const meta = options.meta || '';
        const body = options.body || '';
        const hint = options.hint || '';
        const resizeHandle = options.resizeHandle || '';
        const ports = options.ports || '<div class="node-port port-in" data-port="in" title="input"></div><div class="node-port port-out" data-port="out" title="output"></div>';
        const left = Number(node.x) || 0;
        const top = Number(node.y) || 0;
        const width = Number(layout.width) || 0;
        const height = Number(layout.height) || 0;
        return `<div class="${esc(view.className || 'image-node')}" data-id="${id}" style="left:${left}px;top:${top}px;width:${width}px;height:${height}px">
            <div class="node-head"><div class="node-title">${title}</div><div class="node-actions">${deleteBtn}</div></div>
            ${floatingActions}
            ${toolbar}
            ${runtime}
            <div class="node-body">${body}</div>
            ${meta}
            <div class="node-hint">${hint}</div>
            ${resizeHandle}
            ${ports}
        </div>`;
    }

    global.SmartCanvasNodeRenderPrimitives = Object.freeze({orderedNodes, shellHtml});
})(window);
