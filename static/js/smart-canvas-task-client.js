/*
 * Smart Canvas task transport adapter.
 *
 * This module owns HTTP/JSON protocol details for task-related endpoints only.
 * Provider selection, task lifecycle, polling policy and node result mapping stay
 * in smart-canvas.js / smart-canvas-tasks.js.
 */
(function attachSmartCanvasTaskClient(root){
    const defaultFetch = root.SmartCanvasHttp.defaultFetch;

    const encodeId = (value) => root.SmartCanvasHttp.requireId(value, 'task id');

    function errorMessageFromData(data, fallback){
        const detail = data?.detail ?? data?.error ?? data?.message;
        if(typeof detail === 'string' && detail.trim()) return detail;
        if(Array.isArray(detail)){
            const message = detail.map(item => item?.msg || item?.message || String(item)).join('\n').trim();
            if(message) return message;
        }
        return fallback;
    }

    async function readResponse(response, fallback='请求失败'){
        let data = null;
        let text = '';
        try {
            data = await response.clone().json();
        } catch(_) {
            try { text = await response.text(); } catch(__) {}
        }
        if(!response.ok) throw new Error(errorMessageFromData(data, text || fallback));
        return data;
    }

    function jsonRequest(fetchImpl, url, options={}){
        const request = {...options};
        if(request.body !== undefined && request.body !== null && typeof request.body !== 'string'){
            request.body = JSON.stringify(request.body);
            request.headers = {'Content-Type':'application/json', ...(request.headers || {})};
        }
        return fetchImpl(url, request);
    }

    class SmartCanvasTaskClient {
        constructor(options={}){
            this.fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : defaultFetch;
            this.imagePath = options.imagePath || '/api/canvas-image-tasks';
            this.videoPath = options.videoPath || '/api/canvas-video';
            this.imageQueryPath = options.imageQueryPath || '/api/image-task-query';
        }

        async requestJson(url, options={}, config={}){
            const fallback = config.fallback || '请求失败';
            const response = await jsonRequest(this.fetchImpl, url, options);
            const data = await readResponse(response, fallback);
            if(config.requireSuccess && data?.success === false){
                throw new Error(errorMessageFromData(data, fallback));
            }
            return config.unwrapData ? (data?.data ?? data) : data;
        }

        createImageTask(payload, idempotencyKey='', fallback='任务提交失败'){
            const headers = {};
            if(idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey;
            return this.requestJson(this.imagePath, {
                method:'POST', headers, body:payload,
            }, {fallback});
        }

        getImageTask(taskId, signal, fallback='任务查询失败'){
            return this.requestJson(`${this.imagePath}/${encodeId(taskId)}`, {signal}, {fallback});
        }

        createVideo(payload, fallback='任务提交失败'){
            return this.requestJson(this.videoPath, {method:'POST', body:payload}, {fallback});
        }

        queryImageTask(providerId, taskId, signal, fallback='任务查询失败'){
            return this.requestJson(this.imageQueryPath, {
                method:'POST', body:{provider_id:providerId || 'comfly', task_id:taskId}, signal,
            }, {fallback});
        }
    }

    root.SmartCanvasTaskClient = SmartCanvasTaskClient;
    root.SmartCanvasTaskClientInternals = Object.freeze({errorMessageFromData, encodeId});
})(typeof window !== 'undefined' ? window : globalThis);
