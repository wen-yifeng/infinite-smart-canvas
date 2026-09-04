/*
 * Smart Canvas document model.
 *
 * The legacy editor still stores plain JSON objects in `nodes` and
 * `connections`. This module is intentionally data-only: it normalizes the
 * document at the boundaries and provides indexes/queries for UI and command
 * code without taking ownership of provider or DOM behavior.
 */
(function attachSmartCanvasModel(global){
    const NODE_TYPES = Object.freeze({image: 'smart-image', chat: 'smart-chat'});
    const DEFAULT_VIEWPORT = Object.freeze({x:0, y:0, scale:1});
    const MAX_LOGS = 500;

    function clone(value){
        if(value === undefined || value === null) return value;
        try { return JSON.parse(JSON.stringify(value)); }
        catch(e) { return typeof value === 'object' ? {...value} : value; }
    }
    function finite(value, fallback=0){
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    }
    function nodeType(node){ return String(node?.type || NODE_TYPES.image); }
    function isNode(node){ return Boolean(node && typeof node === 'object' && String(node.id || '').trim()); }
    function isImage(node){ return nodeType(node) === NODE_TYPES.image; }
    function isChat(node){ return nodeType(node) === NODE_TYPES.chat; }
    function isCollectionNode(node){ return isImage(node) && Boolean(node?.collectionId || node?.collection_id); }

    function normalizeNode(raw){
        if(!isNode(raw) || (!isImage(raw) && !isChat(raw))) return null;
        const node = clone(raw) || {};
        node.id = String(node.id).trim();
        node.type = nodeType(node);
        node.x = finite(node.x, 0);
        node.y = finite(node.y, 0);
        if(node.w !== undefined) node.w = Math.max(1, finite(node.w, 1));
        if(node.h !== undefined) node.h = Math.max(1, finite(node.h, 1));
        if(isImage(node)) {
            if(!Array.isArray(node.images)) node.images = [];
            if(Array.isArray(node.inputNodeIds)) node.inputNodeIds = Array.from(new Set(node.inputNodeIds.map(String).filter(id => id && id !== node.id)));
            return node;
        }
        node.title = String(node.title || 'AI 对话').trim() || 'AI 对话';
        node.w = Math.max(320, finite(node.w, 520));
        node.h = Math.max(360, finite(node.h, 620));
        node.chatProviderId = String(node.chatProviderId || '');
        node.chatModel = String(node.chatModel || '');
        node.chatDraft = String(node.chatDraft || '');
        node.chatTargetNodeId = String(node.chatTargetNodeId || '');
        node.inputNodeIds = Array.from(new Set((Array.isArray(node.inputNodeIds) ? node.inputNodeIds : []).map(String).filter(id => id && id !== node.id)));
        const rawRoles = node.chatAttachmentRoles && typeof node.chatAttachmentRoles === 'object' ? node.chatAttachmentRoles : {};
        node.chatAttachmentRoles = Object.fromEntries(Object.entries(rawRoles).map(([id, role]) => [String(id), String(role || 'product')]).filter(([id]) => id && id !== node.id));
        node.messages = (Array.isArray(node.messages) ? node.messages : []).map(message => ({
            id:String(message?.id || ''),
            role:message?.role === 'assistant' ? 'assistant' : 'user',
            text:String(message?.text || ''),
            optimizedPrompt:String(message?.optimizedPrompt || ''),
            error:Boolean(message?.error),
            createdAt:finite(message?.createdAt, 0)
        })).filter(message => message.id || message.text).slice(-40);
        node.promptHistory = (Array.isArray(node.promptHistory) ? node.promptHistory : []).map(entry => ({
            id:String(entry?.id || ''),
            targetNodeId:String(entry?.targetNodeId || ''),
            previousPrompt:String(entry?.previousPrompt || ''),
            nextPrompt:String(entry?.nextPrompt || ''),
            createdAt:finite(entry?.createdAt, 0)
        })).filter(entry => entry.targetNodeId).slice(-20);
        delete node.chatRunning;
        delete node.chatAbort;
        node.images = [];
        return node;
    }

    function normalizeConnections(rawConnections, nodes){
        const validIds = new Set(nodes.map(node => node.id));
        const seen = new Set();
        return (Array.isArray(rawConnections) ? rawConnections : []).reduce((result, raw) => {
            if(!raw || typeof raw !== 'object') return result;
            const from = String(raw.from || '').trim();
            const to = String(raw.to || '').trim();
            if(!from || !to || from === to || !validIds.has(from) || !validIds.has(to)) return result;
            const kind = String(raw.kind || 'flow');
            const key = `${from}\u0000${to}\u0000${kind}`;
            if(seen.has(key)) return result;
            seen.add(key);
            result.push({...clone(raw), from, to, kind});
            return result;
        }, []);
    }

    function normalizeDocument(raw){
        const source = clone(raw || {}) || {};
        const seen = new Set();
        const nodes = (Array.isArray(source.nodes) ? source.nodes : []).map(normalizeNode).filter(node => {
            if(!node || seen.has(node.id)) return false;
            seen.add(node.id);
            return true;
        });
        const nodeIds = new Set(nodes.map(node => node.id));
        nodes.forEach(node => {
            if(Array.isArray(node.inputNodeIds)) node.inputNodeIds = node.inputNodeIds.filter(id => nodeIds.has(id) && id !== node.id);
        });
        const viewport = source.viewport && typeof source.viewport === 'object' ? source.viewport : {};
        const result = {
            ...source,
            nodes,
            connections: normalizeConnections(source.connections, nodes),
            viewport: {
                x: finite(viewport.x, DEFAULT_VIEWPORT.x),
                y: finite(viewport.y, DEFAULT_VIEWPORT.y),
                scale: Math.max(0.05, Math.min(8, finite(viewport.scale, DEFAULT_VIEWPORT.scale)))
            },
            logs: Array.isArray(source.logs) ? source.logs.slice(-MAX_LOGS) : [],
            settings: source.settings && typeof source.settings === 'object' ? clone(source.settings) : {},
            ui_state: source.ui_state && typeof source.ui_state === 'object' ? clone(source.ui_state) : {}
        };
        result.schema_version = Math.max(2, Number(result.schema_version) || 0);
        return result;
    }

    function createIndexes(document){
        const nodes = Array.isArray(document?.nodes) ? document.nodes : [];
        const nodesById = new Map(nodes.filter(isNode).map(node => [node.id, node]));
        const incoming = new Map();
        const outgoing = new Map();
        nodes.forEach(node => { incoming.set(node.id, []); outgoing.set(node.id, []); });
        (document?.connections || []).forEach(connection => {
            if(!nodesById.has(connection.from) || !nodesById.has(connection.to)) return;
            outgoing.get(connection.from).push(connection);
            incoming.get(connection.to).push(connection);
        });
        return {nodesById, incoming, outgoing};
    }
    function collectionNodes(document){ return (document?.nodes || []).filter(isCollectionNode); }
    function nodeSummary(node){
        return {
            id: node?.id || '',
            type: nodeType(node),
            title: node?.title || '',
            imageCount: Array.isArray(node?.images) ? node.images.length : 0,
            messageCount: Array.isArray(node?.messages) ? node.messages.length : 0,
            running: Boolean(node?.running || node?.pending || node?.queued)
        };
    }

    class SmartCanvasDocumentModel {
        constructor(document={}){ this.replace(document); }
        replace(document){ this.document = normalizeDocument(document); this.rebuild(); return this.document; }
        rebuild(){ this.indexes = createIndexes(this.document); return this.indexes; }
        getNode(id){ return this.indexes.nodesById.get(id) || null; }
        incoming(id){ return this.indexes.incoming.get(id) || []; }
        outgoing(id){ return this.indexes.outgoing.get(id) || []; }
        summary(){
            return {
                nodeCount: this.document.nodes.length,
                connectionCount: this.document.connections.length,
                collectionCount: collectionNodes(this.document).length
            };
        }
        toJSON(){ return clone(this.document); }
    }

    global.SmartCanvasNodeTypes = NODE_TYPES;
    global.SmartCanvasDocumentModel = SmartCanvasDocumentModel;
    global.SmartCanvasDocumentPrimitives = Object.freeze({
        clone, normalizeNode, normalizeDocument, normalizeConnections, createIndexes,
        collectionNodes, nodeSummary, isImage, isChat, isCollectionNode
    });
})(window);
