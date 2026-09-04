(function attachSmartCanvasParameterController(global){
    'use strict';

    function controlTypeKey(element){
        if(!element?.classList) return '';
        return Array.from(element.classList).find(name => name !== 'smart-control' && name.endsWith('-control')) || '';
    }

    const batchParameterGroups = Object.freeze({
        imageModel:Object.freeze(['model']),
        videoModel:Object.freeze(['videoModel']),
        imageSize:Object.freeze([
            'resolution', 'ratio', 'customRatio', 'customRatioWidth', 'customRatioHeight',
            'customWidth', 'customHeight', 'customSize'
        ]),
        modelscopeSize:Object.freeze([
            'msResolution', 'msRatio', 'msCustomRatio', 'msCustomRatioWidth', 'msCustomRatioHeight',
            'msCustomWidth', 'msCustomHeight', 'msCustomSize'
        ]),
        videoSize:Object.freeze(['videoAspect', 'videoResolution']),
        quality:Object.freeze(['quality'])
    });

    function batchGroupForParameter(key){
        return Object.entries(batchParameterGroups).find(([, keys]) => keys.includes(key))?.[0] || '';
    }

    function copyBatchParameterGroup(source, target, group){
        const keys = batchParameterGroups[group] || [];
        keys.forEach(key => {
            if(Object.prototype.hasOwnProperty.call(source || {}, key)) target[key] = source[key];
            else delete target[key];
        });
        return target;
    }

    function batchParameterGroupEquals(left, right, group){
        const keys = batchParameterGroups[group] || [];
        return keys.every(key => Object.is(left?.[key], right?.[key]));
    }

    class SmartCanvasParameterPanelController {
        constructor(options={}){
            this.root = options.root || null;
            this.render = typeof options.render === 'function' ? options.render : () => {};
            this.setTimeout = typeof options.setTimeout === 'function'
                ? options.setTimeout
                : global.setTimeout?.bind(global);
            this.clearTimeout = typeof options.clearTimeout === 'function'
                ? options.clearTimeout
                : global.clearTimeout?.bind(global);
            this.requestIdleCallback = typeof options.requestIdleCallback === 'function'
                ? options.requestIdleCallback
                : global.requestIdleCallback?.bind(global);
            this.cancelIdleCallback = typeof options.cancelIdleCallback === 'function'
                ? options.cancelIdleCallback
                : global.cancelIdleCallback?.bind(global);
            this.requestAnimationFrame = typeof options.requestAnimationFrame === 'function'
                ? options.requestAnimationFrame
                : global.requestAnimationFrame?.bind(global);
            this.timerId = null;
            this.idleId = null;
            this.sequence = 0;
        }

        cancelScheduled(){
            if(this.timerId !== null && this.clearTimeout) this.clearTimeout(this.timerId);
            if(this.idleId !== null && this.cancelIdleCallback) this.cancelIdleCallback(this.idleId);
            this.timerId = null;
            this.idleId = null;
        }

        schedule(delay=120){
            this.cancelScheduled();
            const sequence = ++this.sequence;
            const run = () => {
                this.timerId = null;
                this.idleId = null;
                if(sequence !== this.sequence) return;
                this.render();
            };
            if(this.requestIdleCallback){
                this.idleId = this.requestIdleCallback(run, {timeout:Math.max(180, Number(delay) + 260)});
            } else if(this.setTimeout){
                this.timerId = this.setTimeout(run, Math.max(0, Number(delay) || 0));
            } else {
                run();
            }
            return sequence;
        }

        captureOpenControl(){
            const element = this.root?.querySelector?.('.smart-control.pinned, .smart-control.interacting');
            const key = controlTypeKey(element);
            if(!key) return null;
            return {
                key,
                pinned:Boolean(element.classList.contains('pinned')),
                interacting:Boolean(element.classList.contains('interacting'))
            };
        }

        restoreOpenControl(state){
            if(!state?.key) return false;
            const element = this.root?.querySelector?.(`.smart-control.${state.key}`);
            if(!element) return false;
            if(state.pinned) element.classList.add('pinned');
            if(state.interacting) element.classList.add('interacting');
            return true;
        }

        captureScroll(){
            if(!this.root) return null;
            return {
                top:this.root.scrollTop || 0,
                left:this.root.scrollLeft || 0,
                sizePickers:[...this.root.querySelectorAll('.size-picker-control')].map(control => ({
                    key:controlTypeKey(control),
                    lists:[...control.querySelectorAll('.size-picker-list')].map(list => ({
                        top:list.scrollTop || 0,
                        left:list.scrollLeft || 0
                    }))
                }))
            };
        }

        restoreScroll(snapshot){
            if(!snapshot || !this.root) return false;
            const apply = () => {
                this.root.scrollTop = snapshot.top || 0;
                this.root.scrollLeft = snapshot.left || 0;
                const used = new Set();
                (snapshot.sizePickers || []).forEach(item => {
                    const pickers = [...this.root.querySelectorAll('.size-picker-control')];
                    const index = pickers.findIndex((control, pickerIndex) => {
                        return !used.has(pickerIndex) && (!item.key || controlTypeKey(control) === item.key);
                    });
                    if(index < 0) return;
                    used.add(index);
                    const lists = pickers[index].querySelectorAll('.size-picker-list');
                    (item.lists || []).forEach((position, listIndex) => {
                        const list = lists[listIndex];
                        if(!list) return;
                        list.scrollTop = position.top || 0;
                        list.scrollLeft = position.left || 0;
                    });
                });
            };
            apply();
            this.requestAnimationFrame?.(apply);
            return true;
        }

        destroy(){
            this.cancelScheduled();
            this.sequence += 1;
            this.root = null;
        }
    }

    global.SmartCanvasParameterPanelController = SmartCanvasParameterPanelController;
    global.SmartCanvasParameterPanelUtils = Object.freeze({controlTypeKey});
    global.SmartCanvasParameterBatchUtils = Object.freeze({
        groups:batchParameterGroups,
        groupForParameter:batchGroupForParameter,
        copyGroup:copyBatchParameterGroup,
        groupEquals:batchParameterGroupEquals
    });
})(window);
