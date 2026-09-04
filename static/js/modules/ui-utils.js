/**
 * Cross-page UI helpers shared by the home page, API settings, and canvas.
 *
 * This remains a classic-script IIFE because the application loads scripts in
 * dependency order rather than as ES modules. Consumers destructure only the
 * helpers they use from window.SmartCanvasUiUtils.
 */
(function () {
    'use strict';

    function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[char]));
    }

    function escapeAttr(value) {
        return escapeHtml(value).replace(/`/g, '&#96;');
    }

    function refreshIcons(root = document) {
        if (window.lucide) window.lucide.createIcons({ root });
    }

    function tr(key) {
        return window.StudioI18n?.t ? window.StudioI18n.t(key) : key;
    }

    function uid(prefix = 'id') {
        return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
    }

    window.SmartCanvasUiUtils = Object.freeze({
        escapeHtml,
        escapeAttr,
        refreshIcons,
        tr,
        uid
    });
}());
