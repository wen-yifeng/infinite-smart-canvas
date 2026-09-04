/*
 * Smart Canvas runtime configuration transport adapter.
 *
 * The main editor consumes normalized configuration data; this module owns the
 * HTTP boundary for `/api/config` and keeps host fetch binding explicit.
 */
(function attachSmartCanvasConfigClient(root){
    function errorMessage(message){
        return new Error(`Smart Canvas config failed: ${message}`);
    }

    const responseErrorMessage = root.SmartCanvasHttp.responseErrorMessage;

    class SmartCanvasConfigClient {
        constructor({endpoint='/api/config', fetchImpl=null}={}){
            this.endpoint = String(endpoint || '/api/config');
            const defaultFetch = typeof root.fetch === 'function' ? root.fetch.bind(root) : null;
            this.fetchImpl = typeof fetchImpl === 'function' ? fetchImpl : defaultFetch;
            if(typeof this.fetchImpl !== 'function') throw errorMessage('fetch implementation is unavailable');
        }

        async load({signal}={}){
            let response;
            try {
                response = await this.fetchImpl(this.endpoint, {method:'GET', signal});
            } catch(error){
                throw errorMessage(error?.message || String(error));
            }
            if(!response?.ok) throw errorMessage(await responseErrorMessage(response));
            try {
                return await response.json();
            } catch(error){
                throw errorMessage(`invalid JSON response${error?.message ? `: ${error.message}` : ''}`);
            }
        }
    }

    root.SmartCanvasConfigClient = SmartCanvasConfigClient;
    root.SmartCanvasConfigClientInternals = Object.freeze({responseErrorMessage});
})(typeof window !== 'undefined' ? window : globalThis);
