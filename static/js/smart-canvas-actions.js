(function attachSmartCanvasActions(global){
    'use strict';

    class SmartCanvasActionDispatcher {
        constructor({root=document, actionAttribute='data-smart-action', stopAttribute='data-smart-stop'}={}){
            this.root = root;
            this.actionAttribute = actionAttribute;
            this.stopAttribute = stopAttribute;
            this.handlers = new Map();
            this.bound = false;
            this.onClick = this.onClick.bind(this);
        }

        register(name, handler){
            const key = String(name || '').trim();
            if(!key || typeof handler !== 'function') throw new TypeError('action handler must be a function');
            this.handlers.set(key, handler);
            return this;
        }

        registerMany(handlers={}){
            Object.entries(handlers).forEach(([name, handler]) => this.register(name, handler));
            return this;
        }

        start(){
            if(this.bound || !this.root?.addEventListener) return this;
            this.root.addEventListener('click', this.onClick);
            this.bound = true;
            return this;
        }

        stop(){
            if(!this.bound || !this.root?.removeEventListener) return this;
            this.root.removeEventListener('click', this.onClick);
            this.bound = false;
            return this;
        }

        actionElement(target){
            const element = target?.closest?.(`[${this.actionAttribute}]`);
            return element && this.root?.contains?.(element) ? element : null;
        }

        stopElement(target){
            const element = target?.closest?.(`[${this.stopAttribute}]`);
            return element && this.root?.contains?.(element) ? element : null;
        }

        onClick(event){
            const stopElement = this.stopElement(event.target);
            const element = this.actionElement(event.target);
            if(element){
                const action = element.getAttribute(this.actionAttribute) || '';
                const handler = this.handlers.get(action);
                if(handler) handler(event, element);
            }
            if(stopElement) event.stopPropagation();
        }
    }

    global.SmartCanvasActionDispatcher = SmartCanvasActionDispatcher;
})(window);
