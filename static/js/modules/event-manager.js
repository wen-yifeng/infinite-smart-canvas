/**
 * 事件监听器生命周期管理模块
 * 统一追踪 smart-canvas.js 的全局事件监听，并在页面卸载时清理。
 * 
 * 使用 eventManager.addGlobal() 注册全局监听器，页面卸载时自动清理。
 */

class EventListenerManager {
    constructor() {
        this.globalListeners = new Map(); // 全局监听器追踪
        
        // 页面卸载时自动清理全局监听器
        if (typeof window !== 'undefined') {
            window.addEventListener('beforeunload', () => this.cleanupAll(), {once: true});
        }
    }

    /**
     * 添加并追踪全局监听器 (window/document)
     */
    addGlobal(target, event, handler, options = {}) {
        const existingKey = this._findGlobalListenerKey(target, event, handler, options);

        if (existingKey) {
            console.warn('[EventManager] 重复添加全局监听器:', event);
            return () => {}; // 返回空清理函数
        }

        const key = Symbol(event);
        target.addEventListener(event, handler, options);
        this.globalListeners.set(key, { target, event, handler, options });

        // 返回清理函数
        return () => this.removeGlobal(target, event, handler, options);
    }

    /**
     * 移除并停止追踪全局监听器
     */
    removeGlobal(target, event, handler, options = {}) {
        const key = this._findGlobalListenerKey(target, event, handler, options);
        const listener = key ? this.globalListeners.get(key) : null;

        if (listener) {
            target.removeEventListener(event, handler, listener.options);
            this.globalListeners.delete(key);
            return true;
        }
        return false;
    }

    /**
     * 清理所有全局监听器
     */
    cleanupAll() {
        let count = 0;
        for (const [key, { target, event, handler, options }] of this.globalListeners) {
            target.removeEventListener(event, handler, options);
            count++;
        }
        this.globalListeners.clear();
        console.log(`[EventManager] 已清理 ${count} 个全局监听器`);
        return count;
    }

    /**
     * 获取当前追踪的监听器统计
     */
    getStats() {
        return {
            global: this.globalListeners.size,
            total: this.globalListeners.size
        };
    }

    _captureFlag(options) {
        return typeof options === 'boolean' ? options : Boolean(options?.capture);
    }

    _findGlobalListenerKey(target, event, handler, options) {
        const capture = this._captureFlag(options);
        for (const [key, listener] of this.globalListeners) {
            if (listener.target === target &&
                listener.event === event &&
                listener.handler === handler &&
                this._captureFlag(listener.options) === capture) {
                return key;
            }
        }
        return null;
    }
}

// 创建全局单例
const eventManager = new EventListenerManager();

// 导出到全局作用域
if (typeof window !== 'undefined') {
    window.eventManager = eventManager;
}