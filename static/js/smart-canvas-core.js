/*
 * Stateful primitives intentionally kept framework-free so the legacy editor can
 * migrate incrementally. The editor owns the actual canvas fields; this module
 * owns history and command boundaries only.
 */
(function attachSmartCanvasCore(global){
    class SmartCanvasStore {
        constructor({snapshot, restore, limit=40, isSuppressed=() => false}={}){
            this.snapshot = snapshot;
            this.restoreSnapshot = restore;
            this.limit = limit;
            this.isSuppressed = isSuppressed;
            this.undoStack = [];
            this.redoStack = [];
            this.pending = null;
            this.listeners = new Set();
        }
        subscribe(listener){
            this.listeners.add(listener);
            return () => this.listeners.delete(listener);
        }
        emit(event){ this.listeners.forEach(listener => listener(event)); }
        checkpoint(meta={}){
            if(this.isSuppressed() || !this.snapshot) return false;
            this.undoStack.push(this.snapshot());
            if(this.undoStack.length > this.limit) this.undoStack.shift();
            this.redoStack.length = 0;
            this.emit({type:'checkpoint', ...meta});
            return true;
        }
        begin(meta={}){
            if(this.isSuppressed() || !this.snapshot) return false;
            this.pending = {snapshot:this.snapshot(), meta};
            return true;
        }
        commit(){
            if(!this.pending) return false;
            this.undoStack.push(this.pending.snapshot);
            if(this.undoStack.length > this.limit) this.undoStack.shift();
            this.redoStack.length = 0;
            this.emit({type:'commit', ...this.pending.meta});
            this.pending = null;
            return true;
        }
        discard(){ this.pending = null; }
        undo(){
            if(!this.undoStack.length || !this.snapshot || !this.restoreSnapshot) return false;
            this.redoStack.push(this.snapshot());
            if(this.redoStack.length > this.limit) this.redoStack.shift();
            this.restoreSnapshot(this.undoStack.pop());
            this.emit({type:'undo'});
            return true;
        }
        redo(){
            if(!this.redoStack.length || !this.snapshot || !this.restoreSnapshot) return false;
            this.undoStack.push(this.snapshot());
            if(this.undoStack.length > this.limit) this.undoStack.shift();
            this.restoreSnapshot(this.redoStack.pop());
            this.emit({type:'redo'});
            return true;
        }
        execute(name, mutate, {capture=true}={}){
            if(capture) this.begin({name});
            const result = mutate();
            if(capture){
                if(result === false) this.discard();
                else this.commit();
            }
            this.emit({type:'command', name, result});
            return result;
        }
    }

    class SmartCanvasCommandBus {
        constructor({store, listeners=[]}={}){
            this.store = store || null;
            this.listeners = new Set(listeners);
        }
        subscribe(listener){
            if(typeof listener !== 'function') return () => {};
            this.listeners.add(listener);
            return () => this.listeners.delete(listener);
        }
        emit(event){ this.listeners.forEach(listener => listener(event)); }
        execute(name, mutate, options={}){
            const command = {name:String(name || 'anonymous'), startedAt:Date.now()};
            this.emit({type:'command-start', command});
            try {
                const result = this.store?.execute(command.name, mutate, options);
                this.emit({type:'command-end', command, result, accepted:result !== false});
                return result;
            } catch(error) {
                this.emit({type:'command-error', command, error});
                throw error;
            }
        }
        begin(meta={}){ this.emit({type:'transaction-start', meta}); return this.store?.begin(meta) || false; }
        commit(){ const result = this.store?.commit() || false; this.emit({type:'transaction-end', result, accepted:result}); return result; }
        discard(){ this.store?.discard(); this.emit({type:'transaction-discard'}); }
        undo(){ const result = this.store?.undo() || false; this.emit({type:'undo', accepted:result}); return result; }
        redo(){ const result = this.store?.redo() || false; this.emit({type:'redo', accepted:result}); return result; }
        get pending(){ return Boolean(this.store?.pending); }
        get undoStack(){ return this.store?.undoStack || []; }
        get redoStack(){ return this.store?.redoStack || []; }
    }

    class SmartCanvasDocumentStore {
        constructor(){
            this.baseline = null;
            this.listeners = new Set();
        }
        subscribe(listener){
            this.listeners.add(listener);
            return () => this.listeners.delete(listener);
        }
        emit(event){
            this.listeners.forEach(listener => listener(event));
        }
        clone(value){
            if(value === undefined || value === null) return value;
            try { return JSON.parse(JSON.stringify(value)); }
            catch(e) { return typeof value === 'object' ? {...value} : value; }
        }
        equal(left, right){
            return JSON.stringify(left) === JSON.stringify(right);
        }
        setBaseline(document){
            this.baseline = this.clone(document);
            this.emit({type:'baseline', document:this.clone(this.baseline)});
            return this.baseline;
        }
        getBaseline(){
            return this.clone(this.baseline || {});
        }
        buildPatch(current, {clientId='', fallbackUpdatedAt=0}={}){
            const document = current || {};
            const baseline = this.baseline || {};
            const beforeById = new Map((baseline.nodes || []).filter(node => node?.id).map(node => [node.id, node]));
            const currentNodes = (document.nodes || []).filter(node => node?.id);
            const currentIds = new Set(currentNodes.map(node => node.id));
            const nodes_upsert = currentNodes
                .filter(node => !this.equal(node, beforeById.get(node.id)))
                .map(node => this.clone(node));
            const nodes_delete = [...beforeById.keys()].filter(nodeId => !currentIds.has(nodeId));
            const patch = {
                nodes_upsert,
                nodes_delete,
                base_updated_at: baseline.updated_at || document.updated_at || fallbackUpdatedAt || 0,
                base_revision: baseline.revision || document.revision || 0,
                client_id: clientId || ''
            };
            ['connections', 'viewport', 'settings', 'ui_state', 'title', 'icon'].forEach(key => {
                if(!this.equal(document[key], baseline[key])) patch[key] = this.clone(document[key]);
            });
            return patch;
        }
        hasChanges(patch){
            if(!patch) return false;
            return Boolean(
                (patch.nodes_upsert || []).length
                || (patch.nodes_delete || []).length
                || ['connections', 'viewport', 'settings', 'ui_state', 'title', 'icon']
                    .some(key => Object.prototype.hasOwnProperty.call(patch, key))
            );
        }
    }

    class SmartCanvasConnectionRenderer {
        constructor(world){
            this.world = world;
        }
        mount(connectionHtml){
            const tpl = document.createElement('template');
            tpl.innerHTML = String(connectionHtml || '').trim();
            const next = tpl.content.firstElementChild;
            if(!next) return null;
            const current = this.world.querySelector(':scope > svg.connection-layer');
            if(current) current.replaceWith(next);
            else this.world.prepend(next);
            return next;
        }
    }

    class SmartCanvasNodeRenderer {
        constructor(world){
            this.world = world;
            this.htmlById = new Map();
        }
        collectReusable(nodes, canReuse){
            const nodeMap = new Map(nodes.map(node => [node.id, node]));
            const reusable = new Map();
            this.world.querySelectorAll(':scope > .image-node').forEach(el => {
                const node = nodeMap.get(el.dataset.id);
                if(canReuse(node, el)) reusable.set(node.id, el);
            });
            return reusable;
        }
        parseNode(html){
            const tpl = document.createElement('template');
            tpl.innerHTML = String(html || '').trim();
            const node = tpl.content.firstElementChild;
            return node?.classList?.contains('image-node') ? node : null;
        }
        invalidate(ids=null){
            if(ids === null || ids === undefined){
                this.htmlById.clear();
                return;
            }
            const values = typeof ids === 'string' ? [ids] : ids;
            for(const id of values || []){
                const key = String(id || '');
                if(key) this.htmlById.delete(key);
            }
        }
        mount({entries, transplant, captureMediaStates, restoreMediaStates}){
            const currentById = new Map();
            this.world.querySelectorAll(':scope > .image-node').forEach(el => {
                if(el.dataset.id) currentById.set(el.dataset.id, el);
            });
            const nextIds = new Set(entries.map(entry => String(entry.node?.id || '')).filter(Boolean));
            let mediaStates = null;
            let changed = false;
            const ensureMediaStates = () => {
                if(mediaStates === null) mediaStates = typeof captureMediaStates === 'function' ? captureMediaStates() : [];
                return mediaStates;
            };

            entries.forEach(entry => {
                const id = String(entry.node?.id || '');
                if(!id) return;
                const current = currentById.get(id);
                if(current && this.htmlById.get(id) === entry.html) return;
                const fresh = this.parseNode(entry.html);
                if(!fresh) return;
                if(current){
                    ensureMediaStates();
                    if(typeof transplant === 'function') transplant(current, fresh);
                    current.replaceWith(fresh);
                } else {
                    this.world.appendChild(fresh);
                }
                this.htmlById.set(id, entry.html);
                changed = true;
            });

            currentById.forEach((element, id) => {
                if(nextIds.has(id)) return;
                element.remove();
                this.htmlById.delete(id);
                changed = true;
            });
            [...this.htmlById.keys()].forEach(id => {
                if(!nextIds.has(id)) this.htmlById.delete(id);
            });
            if(mediaStates !== null && typeof restoreMediaStates === 'function') restoreMediaStates(mediaStates);
            return {changed, mediaRestored:mediaStates !== null};
        }
    }

    class SmartCanvasRenderScheduler {
        constructor(render){
            this.render = render;
            this.raf = 0;
            this.lastViewportKey = '';
        }
        schedule(){
            if(this.raf) return;
            this.raf = requestAnimationFrame(() => {
                this.raf = 0;
                this.render();
            });
        }
        scheduleForViewport(key){
            if(key === this.lastViewportKey) return;
            this.lastViewportKey = key;
            this.schedule();
        }
    }

    global.SmartCanvasStore = SmartCanvasStore;
    global.SmartCanvasCommandBus = SmartCanvasCommandBus;
    global.SmartCanvasDocumentStore = SmartCanvasDocumentStore;
    global.SmartCanvasConnectionRenderer = SmartCanvasConnectionRenderer;
    global.SmartCanvasNodeRenderer = SmartCanvasNodeRenderer;
    global.SmartCanvasRenderScheduler = SmartCanvasRenderScheduler;
})(window);

