(function attachSmartCanvasPerformance(global){
    'use strict';

    class SmartCanvasPerformanceMetrics {
        constructor({limit=120, now=() => performance.now()}={}){
            this.limit = Math.max(10, Number(limit) || 120);
            this.now = now;
            this.samples = [];
        }
        start(name, meta={}){
            return {name:String(name || 'operation'), startedAt:this.now(), meta:{...meta}};
        }
        end(token, meta={}){
            if(!token) return null;
            const sample = {
                name:token.name,
                duration:Math.max(0, this.now() - Number(token.startedAt || 0)),
                at:Date.now(),
                meta:{...(token.meta || {}), ...meta}
            };
            this.samples.push(sample);
            if(this.samples.length > this.limit) this.samples.splice(0, this.samples.length - this.limit);
            return sample;
        }
        snapshot(){ return this.samples.map(sample => ({...sample, meta:{...sample.meta}})); }
        clear(){ this.samples.length = 0; }
    }

    global.SmartCanvasPerformanceMetrics = SmartCanvasPerformanceMetrics;
    global.smartCanvasPerformance = new SmartCanvasPerformanceMetrics();
})(window);
