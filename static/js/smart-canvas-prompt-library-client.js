/*
 * Smart Canvas prompt-library transport adapter.
 * Composer/template state and rendering remain in smart-canvas.js.
 */
(function attachSmartCanvasPromptLibraryClient(root){
    const defaultFetch = root.SmartCanvasHttp.defaultFetch;
    const requireId = root.SmartCanvasHttp.requireId;
    const responseErrorMessage = root.SmartCanvasHttp.responseErrorMessage;
    class SmartCanvasPromptLibraryClient {
        constructor(options={}){
            this.fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : defaultFetch;
            this.libraryPath = options.libraryPath || '/api/prompt-libraries';
            this.fallbackPath = options.fallbackPath || '/api/smart-canvas/prompt-templates';
            this.itemsPath = options.itemsPath || `${this.libraryPath}/items`;
            this.categoriesPath = options.categoriesPath || `${this.libraryPath}/categories`;
        }
        async requestJson(url, options={}, fallback='请求失败'){
            const response = await this.fetchImpl(url, options);
            if(!response.ok) throw new Error(await responseErrorMessage(response, fallback));
            return response.json();
        }
        json(url, method, body, fallback){
            return this.requestJson(url, {method, headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)}, fallback);
        }
        listLibraries(){ return this.requestJson(this.libraryPath, {}, '提示词库加载失败'); }
        listBuiltinTemplates(){ return this.requestJson(this.fallbackPath, {}, '系统提示词加载失败'); }
        createItem(payload){ return this.json(this.itemsPath, 'POST', payload, '创建提示词失败'); }
        updateItem(itemId, payload){ return this.json(`${this.itemsPath}/${requireId(itemId, 'template id')}`, 'PATCH', payload, '保存提示词失败'); }
        deleteItem(itemId){ return this.requestJson(`${this.itemsPath}/${requireId(itemId, 'template id')}`, {method:'DELETE'}, '删除提示词失败'); }
        createCategory(payload){ return this.json(this.categoriesPath, 'POST', payload, '新增分组失败'); }
        renameCategory(categoryId, payload){ return this.json(`${this.categoriesPath}/${requireId(categoryId, 'category id')}`, 'PATCH', payload, '重命名失败'); }
        deleteCategory(categoryId){ return this.requestJson(`${this.categoriesPath}/${requireId(categoryId, 'category id')}`, {method:'DELETE'}, '删除失败'); }
    }
    root.SmartCanvasPromptLibraryClient = SmartCanvasPromptLibraryClient;
    root.SmartCanvasPromptLibraryClientInternals = Object.freeze({requireId, responseErrorMessage});
})(typeof window !== 'undefined' ? window : globalThis);
