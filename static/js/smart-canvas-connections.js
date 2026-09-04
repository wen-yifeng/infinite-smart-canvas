(function(global){
    'use strict';

    function normalizeConnection(connection, index=0){
        const from = String(connection?.from || '').trim();
        const to = String(connection?.to || '').trim();
        const kind = String(connection?.kind || 'flow').trim() || 'flow';
        return {...(connection || {}), from, to, kind, index:Number.isFinite(Number(connection?.index)) ? Number(connection.index) : index};
    }

    function filterConnections(connections, nodeMap){
        return (connections || [])
            .map((connection, index) => normalizeConnection(connection, index))
            .filter(connection => connection.from && connection.to && connection.from !== connection.to && (!nodeMap || (nodeMap.has(connection.from) && nodeMap.has(connection.to))));
    }

    function buildRenderItems(connections, options={}){
        const nodeMap = options.nodeMap || new Map();
        const getScopeId = typeof options.getScopeId === 'function' ? options.getScopeId : (() => '');
        const conns = filterConnections(connections, nodeMap);
        const buckets = new Map();
        const items = [];
        conns.forEach(connection => {
            const kind = connection.kind;
            const fromScope = kind === 'history' ? '' : String(getScopeId(connection.from) || '');
            const toScope = kind === 'history' ? '' : String(getScopeId(connection.to) || '');
            if(fromScope && fromScope === toScope) return;
            const isMemberTarget = Boolean(toScope && toScope !== connection.to);
            if(isMemberTarget){
                const key = `${connection.from}|${toScope}|${kind}`;
                let bucket = buckets.get(key);
                if(!bucket){
                    bucket = {merged:true, from:connection.from, toId:toScope, kind, indices:[], targets:[]};
                    buckets.set(key, bucket);
                    items.push(bucket);
                }
                bucket.indices.push(connection.index);
                bucket.targets.push(connection.to);
            } else {
                items.push({merged:false, from:connection.from, toId:connection.to, kind, indices:[connection.index], targets:[connection.to]});
            }
        });
        return {items, connections:conns};
    }

    function portPoints(fromRect, toRect, kind='flow'){
        const from = fromRect || {x:0, y:0, width:0, height:0};
        const to = toRect || {x:0, y:0, width:0, height:0};
        const history = kind === 'history';
        const fx = history ? Number(from.x) + Number(from.width) / 2 : Number(from.x) + Number(from.width);
        const fy = history ? Number(from.y) + Number(from.height) : Number(from.y) + Number(from.height) / 2;
        const tx = history ? Number(to.x) + Number(to.width) / 2 : Number(to.x);
        const ty = history ? Number(to.y) : Number(to.y) + Number(to.height) / 2;
        return {fx, fy, tx, ty};
    }

    function curveFor(fromRect, toRect, kind='flow'){
        const {fx, fy, tx, ty} = portPoints(fromRect, toRect, kind);
        const dx = Math.max(50, Math.abs(tx - fx) * 0.45);
        const dy = Math.max(36, Math.abs(ty - fy) * 0.45);
        const curve = kind === 'history'
            ? `M${fx} ${fy} C ${fx} ${fy+dy}, ${tx} ${ty-dy}, ${tx} ${ty}`
            : `M${fx} ${fy} C ${fx+dx} ${fy}, ${tx-dx} ${ty}, ${tx} ${ty}`;
        return {fx, fy, tx, ty, mx:(fx + tx) / 2, my:(fy + ty) / 2, curve};
    }

    function connectionKey(connection){
        const c = normalizeConnection(connection);
        return `${c.from}->${c.to}:${c.kind}`;
    }

    function connectionsForKinds(connections, kinds=['input', 'flow']){
        const allowed = new Set(kinds || []);
        return (connections || []).filter(connection => {
            if(!connection?.from || !connection?.to || connection.from === connection.to) return false;
            return allowed.has(connection.kind || 'flow');
        });
    }

    function incomingNodeIds(node, connections, kinds=['input'], options={}){
        if(!node?.id) return [];
        const allowed = new Set(kinds || []);
        const ids = new Set();
        connectionsForKinds(connections, kinds).forEach(connection => {
            if(connection.to === node.id) ids.add(connection.from);
        });
        if(options.useConnections === false && allowed.has('input')){
            (options.legacyInputNodeIds || node.inputNodeIds || []).forEach(id => {
                if(id && id !== node.id) ids.add(id);
            });
        }
        return [...ids];
    }

    function outgoingConnections(nodeId, connections, kinds=['input']){
        if(!nodeId) return [];
        return connectionsForKinds(connections, kinds).filter(connection => connection.from === nodeId);
    }

    function upstreamNodeIds(nodeId, connections, kinds=['input', 'flow']){
        if(!nodeId) return [];
        const conns = connectionsForKinds(connections, kinds);
        const result = [];
        const seen = new Set([nodeId]);
        const walk = id => {
            conns.forEach(connection => {
                if(connection.to !== id || seen.has(connection.from)) return;
                seen.add(connection.from);
                walk(connection.from);
                result.push(connection.from);
            });
        };
        walk(nodeId);
        return result;
    }

global.SmartCanvasConnectionPrimitives = {
        normalizeConnection,
        filterConnections,
        buildRenderItems,
        portPoints,
        curveFor,
        connectionKey,
        connectionsForKinds,
        incomingNodeIds,
        outgoingConnections,
        upstreamNodeIds,
    };
})(window);
