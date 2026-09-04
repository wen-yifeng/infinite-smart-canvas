(function(root){
    'use strict';

    function syncError(message){
        return new Error(`Smart Canvas sync failed: ${message}`);
    }

    function canvasUrl(basePath, canvasId){
        const base = String(basePath || '/api/canvases').replace(/\/+$/, '');
        const id = String(canvasId || '').trim();
        if(!id) throw syncError('canvas id is required');
        return `${base}/${encodeURIComponent(id)}`;
    }

    async function parseJson(response){
        if(!response || typeof response.json !== 'function') return {};
        try { return await response.json(); }
        catch(_error){ return {}; }
    }

    class SmartCanvasCanvasSyncClient {
        constructor({
            basePath = '/api/canvases',
            fetchImpl = null,
        } = {}){
            this.basePath = String(basePath || '/api/canvases');
            const defaultFetch = typeof root.fetch === 'function' ? root.fetch.bind(root) : null;
            this.fetchImpl = typeof fetchImpl === 'function' ? fetchImpl : defaultFetch;
            if(typeof this.fetchImpl !== 'function') throw syncError('fetch implementation is unavailable');
        }

        async read({canvasId, suffix='', signal}={}){
            const baseUrl = canvasUrl(this.basePath, canvasId);
            const tail = String(suffix || '').replace(/^\/+/, '');
            const url = tail ? `${baseUrl}/${tail}` : baseUrl;
            let response;
            try {
                response = await this.fetchImpl(url, {method:'GET', signal});
            } catch(error){
                throw syncError(error?.message || String(error));
            }
            return {
                response,
                status:Number(response?.status || 0),
                ok:response?.ok === true,
                data:await parseJson(response),
            };
        }

        load({canvasId, signal}={}){
            return this.read({canvasId, signal});
        }

        loadMeta({canvasId, signal}={}){
            return this.read({canvasId, suffix:'meta', signal});
        }

        loadLogs({canvasId, offset = 0, limit = 40, signal}={}){
            const suffix = `logs?offset=${Number(offset) || 0}&limit=${Number(limit) || 40}`;
            return this.read({canvasId, suffix, signal});
        }

        appendLog({canvasId, entry}={}){
            const url = canvasUrl(this.basePath, canvasId) + '/logs';
            const body = entry && typeof entry === 'object' ? entry : {};
            const run = async () => {
                let response;
                try {
                    response = await this.fetchImpl(url, {
                        method:'POST',
                        headers:{'Content-Type':'application/json'},
                        body:JSON.stringify({entry: body}),
                    });
                } catch(error){
                    throw syncError(error?.message || String(error));
                }
                return {response, status:Number(response?.status || 0), ok:response?.ok === true, data:await parseJson(response)};
            };
            return run();
        }
        async save({canvasId, patch, fallbackPayload}){
            const url = canvasUrl(this.basePath, canvasId);
            const request = (method, body) => this.fetchImpl(url, {
                method,
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify(body),
            });
            let response;
            try {
                response = await request('PATCH', patch || {});
                if(response?.status === 404){
                    response = await request('PUT', fallbackPayload || patch || {});
                }
            } catch(error){
                const detail = error?.message || String(error);
                throw syncError(detail);
            }
            return {
                response,
                status:Number(response?.status || 0),
                ok:response?.ok === true,
                data:await parseJson(response),
            };
        }
    }

    root.SmartCanvasCanvasSyncClient = SmartCanvasCanvasSyncClient;
})(typeof window !== 'undefined' ? window : globalThis);
