(function(global){
    'use strict';

    function asId(value){
        return value == null ? '' : String(value);
    }

    function uniqueIds(ids){
        return [...new Set((Array.isArray(ids) ? ids : []).map(asId).filter(Boolean))];
    }

    function nodeIdSet(nodes){
        return new Set((Array.isArray(nodes) ? nodes : []).map(node => asId(node?.id)).filter(Boolean));
    }

    function validIds(ids, nodes){
        const allowed = nodeIdSet(nodes);
        return uniqueIds(ids).filter(id => allowed.has(id));
    }

    function nodeIds(selection={}, nodes=[]){
        const ids = validIds(selection.ids, nodes);
        if(ids.length) return ids;
        const primaryId = asId(selection.primaryId);
        return primaryId && nodeIdSet(nodes).has(primaryId) ? [primaryId] : [];
    }

    function primaryId(selection={}, nodes=[]){
        const ids = nodeIds(selection, nodes);
        const requested = asId(selection.primaryId);
        return requested && ids.includes(requested) ? requested : (ids[0] || '');
    }

    function imageSelection(image={}){
        const nodeId = asId(image?.nodeId);
        const rawIndex = Number(image?.index);
        return {nodeId, index:Number.isFinite(rawIndex) ? rawIndex : -1};
    }

    function emptyImage(){ return {nodeId:'', index:-1}; }

    function selectionSnapshot(selection={}, nodes=[]){
        const ids = nodeIds(selection, nodes);
        return {
            primaryId: primaryId(selection, nodes),
            ids: ids.length > 1 ? ids : [],
            image: imageSelection(selection.image)
        };
    }

    function toggleNode(selection={}, nodeId, nodes=[]){
        const id = asId(nodeId);
        const available = nodeIdSet(nodes);
        if(!id || !available.has(id)) return selectionSnapshot(selection, nodes);
        const current = nodeIds(selection, nodes);
        const removing = current.includes(id);
        const next = removing ? current.filter(item => item !== id) : [...current, id];
        const requestedPrimary = asId(selection.primaryId);
        const nextPrimary = next.length > 1
            ? (!removing ? id : (next.includes(requestedPrimary) ? requestedPrimary : next[next.length - 1]))
            : (next[0] || '');
        return {
            primaryId: nextPrimary,
            ids: next.length > 1 ? next : [],
            image: emptyImage()
        };
    }

    function rectFromPoints(a={}, b={}){
        const ax = Number(a.x) || 0, ay = Number(a.y) || 0;
        const bx = Number(b.x) || 0, by = Number(b.y) || 0;
        return {
            x:Math.min(ax, bx),
            y:Math.min(ay, by),
            width:Math.abs(bx - ax),
            height:Math.abs(by - ay)
        };
    }

    function rectIntersects(a={}, b={}){
        const ax = Number(a.x) || 0, ay = Number(a.y) || 0;
        const aw = Math.max(0, Number(a.width) || 0), ah = Math.max(0, Number(a.height) || 0);
        const bx = Number(b.x) || 0, by = Number(b.y) || 0;
        const bw = Math.max(0, Number(b.width) || 0), bh = Math.max(0, Number(b.height) || 0);
        return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
    }

    function hitIds(nodes=[], selectionRect={}, rectForNode){
        const getRect = typeof rectForNode === 'function' ? rectForNode : node => node;
        return (Array.isArray(nodes) ? nodes : [])
            .filter(node => node?.id && rectIntersects(getRect(node) || {}, selectionRect))
            .map(node => asId(node.id));
    }

    function applyRect(selection={}, nodes=[], selectionRect={}, options={}){
        const available = nodeIdSet(nodes);
        const hits = hitIds(nodes, selectionRect, options.rectForNode);
        let next;
        if(options.toggle){
            const initial = new Set(nodeIds({ids:options.initialSelectedIds}, nodes));
            hits.forEach(id => initial.has(id) ? initial.delete(id) : initial.add(id));
            next = (Array.isArray(nodes) ? nodes : []).map(node => asId(node?.id)).filter(id => initial.has(id));
        } else {
            next = hits;
        }
        next = next.filter(id => available.has(id));
        return {
            primaryId: next.length === 1 ? next[0] : '',
            ids: next.length > 1 ? next : [],
            image: emptyImage()
        };
    }

    global.SmartCanvasSelectionPrimitives = Object.freeze({
        asId,
        uniqueIds,
        nodeIds,
        primaryId,
        imageSelection,
        emptyImage,
        selectionSnapshot,
        toggleNode,
        rectFromPoints,
        rectIntersects,
        hitIds,
        applyRect
    });
})(window);
