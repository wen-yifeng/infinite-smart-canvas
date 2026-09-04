/*
 * Smart Canvas shared transport helpers.
 *
 * Transport adapters share fetch binding, id encoding and response error
 * parsing instead of duplicating them in every client module.
 */
(function attachSmartCanvasHttp(root){
    function defaultFetch(...args){
        if(typeof fetch !== 'function') throw new Error('fetch is not available');
        return fetch(...args);
    }

    function requireId(value, label='id'){
        const id = String(value ?? '').trim();
        if(!id) throw new Error(`${label} is required`);
        return encodeURIComponent(id);
    }

    async function responseErrorMessage(response, fallback='请求失败'){
        let data = null;
        try {
            const source = typeof response?.clone === 'function' ? response.clone() : response;
            data = await source?.json?.();
        } catch(_) {}
        const detail = data?.detail ?? data?.error ?? data?.message;
        if(typeof detail === 'string' && detail.trim()) return detail;
        if(Array.isArray(detail)){
            const message = detail.map(item => item?.msg || item?.message || String(item)).join('\n').trim();
            if(message) return message;
        }
        try {
            const text = await response?.text?.();
            if(text && String(text).trim()) return String(text).trim();
        } catch(_) {}
        return fallback;
    }

    root.SmartCanvasHttp = Object.freeze({defaultFetch, requireId, responseErrorMessage});
})(typeof window !== 'undefined' ? window : globalThis);
