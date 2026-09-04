(function(root){
    'use strict';

    function errorMessage(message){
        return new Error(`Smart Canvas upload failed: ${message}`);
    }

    function requireBlob(blob){
        if(blob === null || blob === undefined){
            throw errorMessage('blob is required');
        }
        return blob;
    }

    function requireName(name){
        const normalized = String(name ?? '').trim();
        if(!normalized) throw errorMessage('file name is required');
        return normalized;
    }

    async function responseText(response){
        if(!response || typeof response.text !== 'function') return '';
        try { return String(await response.text() || '').trim(); }
        catch(_error){ return ''; }
    }

    class SmartCanvasUploadClient {
        constructor({
            endpoint = '/api/ai/upload',
            fetchImpl = root.fetch,
            FormDataCtor = root.FormData,
        } = {}){
            this.endpoint = String(endpoint || '/api/ai/upload');
            // Window.fetch requires the Window receiver. Keep injected test/custom fetch functions unchanged.
            this.fetchImpl = fetchImpl === root.fetch && typeof fetchImpl === 'function' ? fetchImpl.bind(root) : fetchImpl;
            this.FormDataCtor = FormDataCtor;
            if(typeof this.fetchImpl !== 'function') throw errorMessage('fetch implementation is unavailable');
            if(typeof this.FormDataCtor !== 'function') throw errorMessage('FormData implementation is unavailable');
        }

        async request(items){
            const form = new this.FormDataCtor();
            items.forEach(item => form.append('files', item.blob, item.name));
            let response;
            try {
                response = await this.fetchImpl(this.endpoint, {method:'POST', body:form});
            } catch(error){
                const detail = error?.message || String(error);
                throw errorMessage(detail);
            }
            if(!response || response.ok !== true){
                const status = response && (response.status || response.statusText) ? ` (${response.status || response.statusText})` : '';
                const detail = await responseText(response);
                throw errorMessage(`HTTP request failed${status}${detail ? `: ${detail}` : ''}`);
            }
            let data;
            try {
                data = await response.json();
            } catch(error){
                const detail = error?.message || String(error);
                throw errorMessage(`invalid JSON response${detail ? `: ${detail}` : ''}`);
            }
            if(!data || !Array.isArray(data.files)){
                throw errorMessage('response must contain a files array');
            }
            return data.files;
        }

        async uploadOne(blob, name){
            const files = await this.request([{blob:requireBlob(blob), name:requireName(name)}]);
            return files[0] || null;
        }

        async uploadMany(items){
            const source = Array.isArray(items) ? items : [];
            if(!source.length) return [];
            const normalized = source.map(item => ({
                blob: requireBlob(item?.blob),
                name: requireName(item?.name),
            }));
            return this.request(normalized);
        }
    }

    root.SmartCanvasUploadClient = SmartCanvasUploadClient;
})(typeof window !== 'undefined' ? window : globalThis);
