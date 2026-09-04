(function(global){
    'use strict';

    const DEFAULT_MIN_SCALE = 0.06;
    const DEFAULT_MAX_SCALE = 8;

    function finite(value, fallback=0){
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    }

    function safeScale(value, fallback=1){
        const n = Number(value);
        if(!Number.isFinite(n) || n <= 0) return Number.isFinite(Number(fallback)) && Number(fallback) > 0 ? Number(fallback) : 1;
        return n;
    }

    function clampScale(value, min=DEFAULT_MIN_SCALE, max=DEFAULT_MAX_SCALE, fallback=1){
        const lo = Math.max(0.0001, finite(min, DEFAULT_MIN_SCALE));
        const hi = Math.max(lo, finite(max, DEFAULT_MAX_SCALE));
        return Math.max(lo, Math.min(hi, safeScale(value, fallback)));
    }

    function normalizeViewport(viewport, defaults={}){
        const source = viewport || {};
        return {
            x: finite(source.x, finite(defaults.x, 0)),
            y: finite(source.y, finite(defaults.y, 0)),
            scale: safeScale(source.scale, finite(defaults.scale, 1))
        };
    }

    function screenToWorld(point, viewport, rect={left:0, top:0}){
        const view = normalizeViewport(viewport);
        const sx = finite(point?.x, 0) - finite(rect?.left, 0);
        const sy = finite(point?.y, 0) - finite(rect?.top, 0);
        return {x:(sx - view.x) / view.scale, y:(sy - view.y) / view.scale};
    }

    function worldToScreen(point, viewport, rect={left:0, top:0}){
        const view = normalizeViewport(viewport);
        return {
            x:finite(rect?.left, 0) + finite(point?.x, 0) * view.scale + view.x,
            y:finite(rect?.top, 0) + finite(point?.y, 0) * view.scale + view.y
        };
    }

    function viewportCenter(viewport, size={width:0, height:0}){
        const view = normalizeViewport(viewport);
        return {
            x:(finite(size.width, 0) / 2 - view.x) / view.scale,
            y:(finite(size.height, 0) / 2 - view.y) / view.scale
        };
    }

    function normalizeRect(rect){
        if(!rect) return null;
        const x = finite(rect.x, NaN), y = finite(rect.y, NaN);
        const width = Math.max(0, finite(rect.width, NaN));
        const height = Math.max(0, finite(rect.height, NaN));
        if(!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) return null;
        return {x, y, width, height};
    }

    function contentBounds(rects, options={}){
        const valid = (rects || []).map(normalizeRect).filter(Boolean);
        const padding = Math.max(0, finite(options.padding, 0));
        if(!valid.length){
            const empty = normalizeRect(options.emptyRect) || {x:0, y:0, width:0, height:0};
            return {
                minX:empty.x - padding, minY:empty.y - padding,
                maxX:empty.x + empty.width + padding, maxY:empty.y + empty.height + padding,
                width:Math.max(1, empty.width + padding * 2),
                height:Math.max(1, empty.height + padding * 2),
                count:0
            };
        }
        const minX = Math.min(...valid.map(r => r.x)) - padding;
        const minY = Math.min(...valid.map(r => r.y)) - padding;
        const maxX = Math.max(...valid.map(r => r.x + r.width)) + padding;
        const maxY = Math.max(...valid.map(r => r.y + r.height)) + padding;
        return {minX, minY, maxX, maxY, width:Math.max(1, maxX - minX), height:Math.max(1, maxY - minY), count:valid.length};
    }

    function fitViewport({rects=[], viewport={}, size={}, padding=0, minScale=DEFAULT_MIN_SCALE, maxScale=DEFAULT_MAX_SCALE, emptyScale=0.45}={}){
        const bounds = contentBounds(rects, {padding});
        const width = Math.max(1, finite(size.width, 0));
        const height = Math.max(1, finite(size.height, 0));
        const scale = bounds.count
            ? clampScale(Math.min(width / bounds.width, height / bounds.height), minScale, maxScale, 1)
            : clampScale(emptyScale, minScale, maxScale, 1);
        const centerX = (bounds.minX + bounds.maxX) / 2;
        const centerY = (bounds.minY + bounds.maxY) / 2;
        return {x:width / 2 - centerX * scale, y:height / 2 - centerY * scale, scale, bounds};
    }

    function zoomAtScreenPoint(viewport, nextScale, point, options={}){
        const current = normalizeViewport(viewport);
        const sx = finite(point?.x, 0), sy = finite(point?.y, 0);
        const before = screenToWorld({x:sx, y:sy}, current);
        const scale = clampScale(nextScale, options.minScale, options.maxScale, current.scale);
        return {scale, x:sx - before.x * scale, y:sy - before.y * scale};
    }

    function centerOnWorldPoint(viewport, point, size={width:0, height:0}){
        const view = normalizeViewport(viewport);
        return {x:finite(size.width, 0) / 2 - finite(point?.x, 0) * view.scale, y:finite(size.height, 0) / 2 - finite(point?.y, 0) * view.scale, scale:view.scale};
    }

    function viewportKey(viewport, options={}){
        const view = normalizeViewport(viewport);
        const overview = finite(options.overviewScale, 0.28);
        const compact = finite(options.compactScale, 0.62);
        const overviewCell = Math.max(1, finite(options.overviewCell, 1000));
        const fullCell = Math.max(1, finite(options.fullCell, 2500));
        const tier = view.scale <= overview ? 'overview' : view.scale <= compact ? 'compact' : 'full';
        const cell = tier === 'full' ? fullCell : overviewCell;
        return [tier, Math.floor((-view.x / view.scale) / cell), Math.floor((-view.y / view.scale) / cell)].join(':');
    }

    global.SmartCanvasViewportPrimitives = {
        DEFAULT_MIN_SCALE,
        DEFAULT_MAX_SCALE,
        safeScale,
        clampScale,
        normalizeViewport,
        screenToWorld,
        worldToScreen,
        viewportCenter,
        normalizeRect,
        contentBounds,
        fitViewport,
        zoomAtScreenPoint,
        centerOnWorldPoint,
        viewportKey
    };
})(window);