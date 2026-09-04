/*
 * Smart Canvas generation protocol adapter.
 *
 * Provider selection, prompt assembly, task polling and node/UI orchestration
 * remain in smart-canvas.js.
 */
(function attachSmartCanvasGenerationClient(root){
    const defaultFetch = root.SmartCanvasHttp.defaultFetch;


    const responseErrorMessage = root.SmartCanvasHttp.responseErrorMessage;

    class SmartCanvasGenerationClient {
        constructor(options={}){
            this.fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : defaultFetch;
        }

        async requestJson(url, options={}, fallback='请求失败'){
            const response = await this.fetchImpl(url, options);
            if(!response.ok) throw new Error(await responseErrorMessage(response, fallback));
            return response.json();
        }

        postJson(endpoint, payload, options={}){
            const url = String(endpoint || '').trim();
            if(!url) throw new Error('generation endpoint is required');
            return this.requestJson(url, {
                method:'POST',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify(payload || {}),
                signal:options.signal,
            }, options.fallback || '生成请求失败');
        }
    }

    root.SmartCanvasGenerationClient = SmartCanvasGenerationClient;
    root.SmartCanvasGenerationClientInternals = Object.freeze({responseErrorMessage});
})(typeof window !== 'undefined' ? window : globalThis);
