/**
 * Static presentation helper for the canvas command menu.
 * Command state, availability, and execution stay in smart-canvas.js.
 */
(function attachSmartCanvasCommandMenuView(global){
    'use strict';

    function create({escapeHtml}={}){
        function html(items=[], activeIndex=0){
            if(!items.length) return '<div class="canvas-command-empty">没有匹配命令</div>';

            return items.map((item, index) => `<button class="canvas-command-item ${index === activeIndex ? 'active' : ''}" type="button" role="menuitem" data-canvas-command="${item.id}" ${item.available ? '' : 'disabled'}><i data-lucide="${item.icon}"></i><span>${escapeHtml(item.label)}</span>${item.available ? '' : '<small>当前不可用</small>'}</button>`).join('');
        }

        return Object.freeze({html});
    }

    global.SmartCanvasCommandMenuView = Object.freeze({create});
})(window);
