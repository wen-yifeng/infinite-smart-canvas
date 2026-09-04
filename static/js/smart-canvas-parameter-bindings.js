(function attachSmartCanvasParameterBindings(global){
    'use strict';

    function stopEvent(event){
        event?.preventDefault?.();
        event?.stopPropagation?.();
    }

    class SmartCanvasParameterBindings {
        constructor(options={}){
            this.root = options.root || null;
            this.callbacks = options.callbacks || {};
        }

        callback(name, payload){
            const handler = this.callbacks?.[name];
            return typeof handler === 'function' ? handler(payload) : undefined;
        }

        bind(root=this.root){
            this.root = root || this.root;
            if(!this.root?.querySelectorAll) return false;
            this.bindControlShells();
            this.bindSmartParameters();
            this.bindSizeScopes();
            this.bindInputs();
            this.bindToggles();
            this.bindTrustedSources();
            return true;
        }

        bindControlShells(){
            this.root.querySelectorAll('.smart-control').forEach(control => {
                control.onmouseleave = () => {
                    control.classList.remove('interacting');
                };
            });
            this.root.querySelectorAll('.smart-control > .smart-pill').forEach(pill => {
                pill.onclick = event => {
                    stopEvent(event);
                    const control = pill.parentElement;
                    const wasPinned = control?.classList?.contains('pinned');
                    this.callback('closeAllPopovers');
                    if(!wasPinned) control?.classList?.add('pinned');
                };
            });
        }

        bindSmartParameters(){
            this.root.querySelectorAll('[data-smart-param]').forEach(button => {
                button.onclick = event => {
                    stopEvent(event);
                    this.callback('markInteracting', {element:button});
                    const providerControl = button.closest?.('.provider-control[data-provider-scope]');
                    const key = button.dataset?.smartParam || '';
                    const value = button.dataset?.smartValue;
                    if(providerControl && (key === 'provider_id' || key === 'videoProvider')){
                        this.callback('providerSelect', {
                            scope:providerControl.dataset?.providerScope || '',
                            providerId:value,
                            button,
                            event
                        });
                        return;
                    }
                    this.callback('smartParam', {key, value, button, event});
                };
            });
        }

        bindSizeScopes(){
            this.root.querySelectorAll('[data-size-scope]').forEach(button => {
                button.onclick = event => {
                    stopEvent(event);
                    this.callback('markInteracting', {element:button});
                    this.callback('sizeScope', {
                        prefix:button.dataset?.sizePrefix || '',
                        scope:button.dataset?.sizeScope || '',
                        button,
                        event
                    });
                };
            });
        }

        bindInputs(){
            this.root.querySelectorAll('[data-param]').forEach(input => {
                input.onclick = event => event?.stopPropagation?.();
                input.oninput = input.onchange = event => {
                    event?.stopPropagation?.();
                    this.callback('input', {
                        key:input.dataset?.param || '',
                        value:input.value,
                        input,
                        event
                    });
                };
            });
        }

        bindToggles(){
            this.root.querySelectorAll('[data-toggle-param]').forEach(button => {
                button.onclick = event => {
                    stopEvent(event);
                    this.callback('toggle', {key:button.dataset?.toggleParam || '', button, event});
                };
            });
        }

        bindTrustedSources(){
            this.root.querySelectorAll('[data-trusted-source]').forEach(button => {
                button.onclick = event => {
                    stopEvent(event);
                    return this.callback('trustedSource', {
                        source:button.dataset?.trustedSource || '',
                        button,
                        event
                    });
                };
            });
        }
    }

    global.SmartCanvasParameterBindings = SmartCanvasParameterBindings;
    global.SmartCanvasParameterBindingUtils = Object.freeze({stopEvent});
})(window);
