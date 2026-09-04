/*
 * Smart Canvas UI state boundary.
 *
 * The editor is still a legacy script, so this store deliberately exposes
 * stable sub-objects that the legacy code can reference while mutations are
 * migrated into explicit methods. It owns transient UI state only; document
 * persistence remains the responsibility of SmartCanvasDocumentStore.
 */
(function attachSmartCanvasState(global){
    const clone = value => {
        if(value === undefined || value === null) return value;
        try { return JSON.parse(JSON.stringify(value)); }
        catch(_) { return typeof value === 'object' ? {...value} : value; }
    };

    class SmartCanvasStateStore {
        constructor(initial={}){
            this.selection = {
                primaryId: String(initial.selection?.primaryId || ''),
                ids: Array.isArray(initial.selection?.ids) ? [...new Set(initial.selection.ids.filter(Boolean).map(String))] : [],
                image: {
                    nodeId: String(initial.selection?.image?.nodeId || ''),
                    index: Number.isFinite(Number(initial.selection?.image?.index)) ? Number(initial.selection.image.index) : -1
                }
            };
            this.view = {
                viewport: {
                    x: Number(initial.view?.viewport?.x) || 0,
                    y: Number(initial.view?.viewport?.y) || 0,
                    scale: Number(initial.view?.viewport?.scale) > 0 ? Number(initial.view.viewport.scale) : 1
                }
            };
            this.run = {
                cascadeRuns: initial.run?.cascadeRuns instanceof Map ? initial.run.cascadeRuns : new Map(),
                taskEvents: initial.run?.taskEvents instanceof Map ? initial.run.taskEvents : new Map(),
                activePolls: initial.run?.activePolls instanceof Map ? initial.run.activePolls : new Map()
            };
            this.ui = {
                composerDockCollapsed: initial.ui?.composerDockCollapsed !== false
            };
            this.interaction = {
                active: String(initial.interaction?.active || 'idle'),
                drag: initial.interaction?.drag ?? null,
                selection: initial.interaction?.selection ?? null,
                pan: initial.interaction?.pan ?? null,
                resize: initial.interaction?.resize ?? null,
                thumbDrag: initial.interaction?.thumbDrag ?? null,
                portDrag: initial.interaction?.portDrag ?? null,
                minimap: initial.interaction?.minimap ?? null,
                minimapDrag: Boolean(initial.interaction?.minimapDrag),
                zoomPreview: initial.interaction?.zoomPreview ?? null,
                didPan: Boolean(initial.interaction?.didPan)
            };
            this.sync = {
                status: ['saved', 'dirty', 'saving', 'merged', 'error', 'offline', 'conflict'].includes(initial.sync?.status) ? initial.sync.status : 'saved',
                message: String(initial.sync?.message || ''),
                updatedAt: Number(initial.sync?.updatedAt) || 0
            };
            this.listeners = new Set();
        }
        subscribe(listener){
            if(typeof listener !== 'function') return () => {};
            this.listeners.add(listener);
            return () => this.listeners.delete(listener);
        }
        emit(event){
            this.listeners.forEach(listener => {
                try { listener(event, this); } catch(error) { setTimeout(() => { throw error; }, 0); }
            });
        }
        setSelection(next={}, meta={}){
            const previous = this.selectionSnapshot();
            const ids = Array.isArray(next.ids) ? [...new Set(next.ids.filter(Boolean).map(String))] : previous.ids;
            const primaryId = next.primaryId === undefined ? previous.primaryId : String(next.primaryId || '');
            const image = next.image === undefined ? previous.image : {
                nodeId: String(next.image?.nodeId || ''),
                index: Number.isFinite(Number(next.image?.index)) ? Number(next.image.index) : -1
            };
            this.selection = {primaryId, ids, image};
            this.emit({type:'selection', previous, current:this.selectionSnapshot(), ...meta});
            return this.selection;
        }
        selectionSnapshot(){ return clone(this.selection); }
        installLegacySelectionAliases(root=globalThis, aliases={}){
            const target = root || globalThis;
            const mapping = {
                primaryId: String(aliases.primaryId || 'selectedId'),
                ids: String(aliases.ids || 'selectedIds'),
                image: String(aliases.image || 'selectedImage')
            };
            Object.entries(mapping).forEach(([field, name]) => {
                const descriptor = Object.getOwnPropertyDescriptor(target, name);
                if(descriptor && !descriptor.configurable && !(descriptor.get && descriptor.set)){
                    throw new TypeError(`legacy selection alias is not configurable: ${name}`);
                }
                Object.defineProperty(target, name, {
                    configurable:true,
                    enumerable:false,
                    get:() => {
                        const value = this.selection[field];
                        return field === 'ids' || field === 'image' ? clone(value) : value;
                    },
                    set:value => {
                        const next = field === 'ids'
                            ? {ids:value}
                            : field === 'image'
                                ? {image:value}
                                : {primaryId:value};
                        this.setSelection(next, {source:'legacy-selection-alias'});
                    }
                });
            });
            return this;
        }
        uninstallLegacySelectionAliases(root=globalThis, aliases={}){
            const target = root || globalThis;
            [aliases.primaryId || 'selectedId', aliases.ids || 'selectedIds', aliases.image || 'selectedImage']
                .map(String)
                .forEach(name => {
                    const descriptor = Object.getOwnPropertyDescriptor(target, name);
                    if(descriptor?.configurable && descriptor.get && descriptor.set) delete target[name];
                });
            return this;
        }
        clearSelection(meta={}){
            return this.setSelection({primaryId:'', ids:[], image:{nodeId:'', index:-1}}, meta);
        }setViewport(next={}, meta={}){
            const previous = {...this.view.viewport};
            const source = next || {};
            if(Number.isFinite(Number(source.x))) this.view.viewport.x = Number(source.x);
            if(Number.isFinite(Number(source.y))) this.view.viewport.y = Number(source.y);
            if(Number(source.scale) > 0) this.view.viewport.scale = Number(source.scale);
            this.emit({type:'viewport', previous, current:{...this.view.viewport}, ...meta});
            return this.view.viewport;
        }
        setComposerDockCollapsed(collapsed, meta={}){
            const next = Boolean(collapsed);
            const previous = this.ui.composerDockCollapsed;
            this.ui.composerDockCollapsed = next;
            if(previous !== next) this.emit({type:'composer-dock', previous, current:next, ...meta});
            return next;
        }
        beginInteraction(kind, payload=null, meta={}){
            const allowed = ['drag', 'selection', 'pan', 'resize', 'thumbDrag', 'portDrag', 'minimap', 'previewPan'];
            const next = allowed.includes(kind) ? kind : 'idle';
            const previous = this.interaction.active || 'idle';
            allowed.forEach(field => {
                if(field === 'previewPan') return;
                if(field === 'minimap') this.interaction.minimapDrag = false;
                else this.interaction[field] = null;
            });
            this.interaction.active = next;
            if(next === 'minimap') this.interaction.minimapDrag = Boolean(payload ?? true);
            else if(next !== 'previewPan' && next !== 'idle') this.interaction[next] = payload;
            this.emit({type:'interaction', previous, current:next, ...meta});
            return payload;
        }
        endInteraction(kind='', meta={}){
            const previous = this.interaction.active || 'idle';
            if(kind && previous !== kind) return false;
            if(previous === 'minimap') this.interaction.minimapDrag = false;
            else if(previous && previous !== 'idle' && previous !== 'previewPan') this.interaction[previous] = null;
            this.interaction.active = 'idle';
            this.emit({type:'interaction', previous, current:'idle', ...meta});
            return true;
        }
        setSyncStatus(status, message='', meta={}){
            const allowed = ['saved', 'dirty', 'saving', 'merged', 'error', 'offline', 'conflict'];
            const next = allowed.includes(status) ? status : 'error';
            const previous = {...this.sync};
            this.sync = {
                status: next,
                message: String(message || ''),
                updatedAt: Date.now()
            };
            if(previous.status !== this.sync.status || previous.message !== this.sync.message){
                this.emit({type:'sync-status', previous, current:{...this.sync}, ...meta});
            }
            return {...this.sync};
        }
        syncSnapshot(){ return {...this.sync}; }
        snapshot(){
            return {
                selection: this.selectionSnapshot(),
                view:{viewport:{...this.view.viewport}},
                ui:{composerDockCollapsed:this.ui.composerDockCollapsed},
                sync:this.syncSnapshot()
            };
        }
    }

    global.SmartCanvasStateStore = SmartCanvasStateStore;
})(window);
